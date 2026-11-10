"""Systemic guard: no container may render duplicate env names, in any overlay.

A duplicated env key (chart-emitted value + the same name re-declared through
extraEnv, or two overlay fragments colliding) is rejected by Kubernetes
server-side apply and has produced real boot failures in this chart's history
(see values-dev.yaml's poller-env note). `helm template` and even
`--dry-run=server` do NOT catch it, so this test renders every committed
overlay and asserts uniqueness per container.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

OVERLAYS = [
    None,  # chart defaults
    "values-dev.yaml",
    "values-demo.yaml",
    "values-small.yaml",
    "values-medium.yaml",
    "values-large.yaml",
    "values-prod-perf.yaml",
    "values-perf-tierA.yaml",
    "values-public-perf.yaml",
    "values-public-perf-medium-workers.yaml",
    "values-invhub-dev.yaml",
    "values-scp.yaml",
]

# Render every pod-template-bearing workload kind the chart emits.
WORKLOAD_KINDS = {"Deployment", "StatefulSet", "Job", "CronJob", "DaemonSet"}


def _pod_spec(doc: dict) -> dict | None:
    if doc.get("kind") == "CronJob":
        return doc["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    if doc.get("kind") in WORKLOAD_KINDS:
        return doc["spec"]["template"]["spec"]
    return None


@pytest.mark.parametrize("overlay", OVERLAYS, ids=lambda o: o or "defaults")
def test_no_duplicate_env_names_per_container(overlay):
    args = [
        "helm", "template", "t", str(CHART),
        "--set", "validation.allowPlaceholders=true",
        # Some overlays enable infra without shipping a DB password (deployed
        # with a separate secrets overlay); satisfy the `required` check.
        # Inert for overlays that don't enable infra.
        "--set", "infra.postgres.password=test-pg",
    ]
    if overlay is not None:
        overlay_path = CHART / overlay
        assert overlay_path.exists(), f"missing overlay {overlay}"
        args += ["-f", str(overlay_path)]
    # Exercise the optional subflow worker + infra pods in the defaults render too.
    if overlay is None:
        args += ["--set", "agentsSubflowWorker.enabled=true", "--set", "infra.enabled=true"]
    r = subprocess.run(args, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr

    for doc in yaml.safe_load_all(r.stdout):
        if not doc:
            continue
        pod_spec = _pod_spec(doc)
        if pod_spec is None:
            continue
        workload = f'{doc["kind"]}/{doc["metadata"]["name"]}'
        for container in pod_spec.get("containers", []) + pod_spec.get("initContainers", []):
            names = [e["name"] for e in container.get("env", [])]
            dupes = sorted({n for n in names if names.count(n) > 1})
            assert not dupes, (
                f"{overlay or 'defaults'}: {workload} container {container['name']} "
                f"renders duplicate env names {dupes} -- server-side apply rejects this"
            )
