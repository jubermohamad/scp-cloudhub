"""Guards for assembly-aks-dev values-dev.yaml invariants (#1621, #1150).

PR #1628 (draft) covers the deploy-aks-dev workflow flags (#1613–#1621); PR
#1634 covers the later SSA/bootstrap-Job steps (#1626, #1633). These assert the
values-dev.yaml deltas that blocked or would have silently broken end-to-end
deploys when kubectl-vs-Helm drift was reconciled — without needing a cluster.
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
VALUES_DEV = CHART / "values-dev.yaml"

POLLER_ENV_NAMES = (
    "TEMPORAL_WORKFLOW_TASK_POLLER_MIN",
    "TEMPORAL_WORKFLOW_TASK_POLLER_INITIAL",
    "TEMPORAL_ACTIVITY_TASK_POLLER_MIN",
    "TEMPORAL_ACTIVITY_TASK_POLLER_INITIAL",
)

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _load_values_dev() -> dict:
    return yaml.safe_load(VALUES_DEV.read_text()) or {}


def _render_dev() -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm",
            "template",
            "t",
            str(CHART),
            "--values",
            str(VALUES_DEV),
            "--set",
            "validation.allowPlaceholders=true",
        ],
        capture_output=True,
        text=True,
    )


def _deployment_doc(rendered: str, name: str) -> str:
    marker = f"\nkind: Deployment\nmetadata:\n  name: {name}\n"
    idx = rendered.find(marker)
    assert idx != -1, f"Deployment {name} not found in render"
    end = rendered.find("\n---\n", idx)
    return rendered[idx : end if end != -1 else None]


def _env_names_from_deployment(doc: str) -> list[str]:
    parsed = yaml.safe_load(doc)
    containers = parsed["spec"]["template"]["spec"]["containers"]
    names: list[str] = []
    for container in containers:
        for entry in container.get("env") or []:
            if "name" in entry:
                names.append(entry["name"])
    return names


def _parse_storage_gi(value: str) -> int:
    match = re.fullmatch(r"(\d+)(Gi|G)", str(value).strip())
    assert match, f"expected storage quantity like 20Gi, got {value!r}"
    return int(match.group(1))


def test_dev_overlay_keeps_postgres_temporal_disabled():
    """#1620/#1621: flipping postgresTemporal.enabled true orphans live Temporal history.

    Temporal on assembly-aks-dev is still connected to the shared postgres
    instance. Enabling the dedicated postgres-temporal path would redirect it
    onto an empty DB on the next deploy.
    """
    values = _load_values_dev()
    assert values["infra"]["postgresTemporal"]["enabled"] is False


def test_dev_overlay_postgres_storage_at_least_live_pvc_capacity():
    """#1621: PVC storage requests cannot shrink — must stay >= live postgres-pvc."""
    values = _load_values_dev()
    storage = values["infra"]["postgres"]["storage"]
    assert _parse_storage_gi(storage) >= 20, (
        "infra.postgres.storage must stay >= the live 20Gi postgres-pvc capacity"
    )


def test_dev_agents_worker_poller_tuning_uses_dedicated_keys_not_extra_env():
    """#1621: duplicate TEMPORAL_*_POLLER_* env names block server-side apply."""
    values = _load_values_dev()
    temporal = values["agentsWorker"]["temporal"]
    for key in (
        "workflowTaskPollerMin",
        "workflowTaskPollerInitial",
        "activityTaskPollerMin",
        "activityTaskPollerInitial",
    ):
        assert key in temporal, f"agentsWorker.temporal.{key} must be set via dedicated keys"

    extra_env = values["agentsWorker"].get("extraEnv") or []
    extra_names = {entry["name"] for entry in extra_env if isinstance(entry, dict)}
    for name in POLLER_ENV_NAMES:
        assert name not in extra_names, (
            f"{name} must not be re-declared in agentsWorker.extraEnv — "
            "assembly-engine-worker.yaml already emits it from agentsWorker.temporal.*"
        )


def test_dev_worker_replicas_match_live_scale():
    """#1150/#1621: --take-ownership makes chart replicas authoritative over kubectl scale."""
    values = _load_values_dev()
    assert values["agentsWorker"]["replicas"] >= 6
    assert values["agentsCodeWorker"]["replicas"] >= 2


def test_dev_render_temporal_uses_shared_postgres_not_postgres_temporal():
    """Rendered Temporal pods must target postgres when postgresTemporal is disabled."""
    rendered = _render_dev()
    assert rendered.returncode == 0, rendered.stderr
    for seeds_block in re.findall(
        r"- name: POSTGRES_SEEDS\n\s+value: (\S+)", rendered.stdout
    ):
        assert seeds_block.endswith("-postgres"), (
            "with infra.postgresTemporal.enabled=false, POSTGRES_SEEDS must be postgres"
        )
    assert "kind: Deployment\nmetadata:\n  name: postgres-temporal\n" not in rendered.stdout


def test_dev_render_engine_worker_env_names_are_unique():
    """Helm render must not emit duplicate container env var names on the worker."""
    rendered = _render_dev()
    assert rendered.returncode == 0, rendered.stderr
    doc = _deployment_doc(rendered.stdout, "t-data-assembly-engine-worker")
    names = _env_names_from_deployment(doc)
    dupes = sorted({n for n in names if names.count(n) > 1})
    assert not dupes, f"assembly-engine-worker has duplicate env names: {dupes}"
