"""Regression: no overlay may resolve to the privileged local-nsjail path.

`agentsCodeWorker.codeExecutionTarget: local-nsjail` is a triple hazard (#2086):

1. `app/core/execution/sandbox.py` appends ``--disable_clone_newnet`` whenever a
   custom_code node requests network, so the jailed process keeps the pod
   network namespace — cloud metadata (169.254.169.254) and in-cluster services
   become reachable from user-authored canvas code.
2. ``assembly-engine-code-worker.yaml`` keys its ``securityContext.privileged``
   off this exact value, so selecting it also grants the worker privileged.
3. It hard-fails custom_code on a non-root code-worker anyway (see the note at
   values-public-perf.yaml:27).

The chart default used to be ``local-nsjail``. Overlays that set neither key —
values-small / values-medium / values-large — silently inherited it, so the
SIZE tiers a customer install starts from were the exposed ones.

These tests pin the safe default and, more importantly, assert it through
`helm template` so a future overlay cannot reintroduce the hazard by omission.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

CHART = Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

# Every overlay shipped in the chart. Adding a new values-*.yaml automatically
# enrolls it — that is the point.
OVERLAYS = sorted(p.name for p in CHART.glob("values-*.yaml"))


def _load(name: str) -> dict:
    return yaml.safe_load((CHART / name).read_text()) or {}


def _render(overlay: str | None) -> str:
    # allowPlaceholders satisfies the chart's secrets validation (validate.yaml);
    # same escape hatch the other guard tests use.
    cmd = [
        "helm", "template", "test-release", str(CHART),
        "--set", "validation.allowPlaceholders=true",
        # The perf overlays set infra.enabled=true, which makes the postgres
        # password mandatory. Supplying a dummy keeps every overlay renderable
        # so none is silently skipped by this guard.
        "--set", "infra.postgres.password=placeholder-for-template-test",
    ]
    if overlay:
        cmd += ["-f", str(CHART / overlay)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        pytest.fail(f"helm template failed for {overlay or '<defaults>'}:\n{result.stderr}")
        # Unreachable: pytest.fail raises. Explicit so the annotated
        # -> dict return type has no implicit None fall-through.
        raise AssertionError("unreachable")
    return result.stdout


def _code_worker_doc(rendered: str) -> dict:
    for doc in yaml.safe_load_all(rendered):
        if (
            doc
            and doc.get("kind") == "Deployment"
            and doc["metadata"]["name"].endswith("assembly-engine-code-worker")
        ):
            return doc
    pytest.fail("assembly-engine-code-worker Deployment not found in rendered output")


def test_chart_default_is_sandbox_service():
    """The default a fresh/customer install gets must be the safe one."""
    values = _load("values.yaml") if (CHART / "values.yaml").exists() else {}
    assert values["agentsCodeWorker"]["codeExecutionTarget"] == "sandbox-service"


@pytest.mark.parametrize("overlay", OVERLAYS)
def test_no_overlay_declares_local_nsjail(overlay: str):
    """An overlay may omit the key (inheriting the safe default) but never set the hazard."""
    target = _load(overlay).get("agentsCodeWorker", {}).get("codeExecutionTarget")
    assert target != "local-nsjail", (
        f"{overlay} selects local-nsjail, which grants privileged:true and "
        f"hard-fails custom_code. Use sandbox-service."
    )


@pytest.mark.parametrize("overlay", [None, *OVERLAYS])
def test_rendered_code_worker_is_never_privileged(overlay):
    """The property that actually matters — assert on rendered output, not values.

    Covers overlays that inherit by omission, which is exactly how
    values-small/medium/large acquired the privileged variant.
    """
    doc = _code_worker_doc(_render(overlay))
    containers = doc["spec"]["template"]["spec"]["containers"]
    for container in containers:
        privileged = (container.get("securityContext") or {}).get("privileged")
        assert privileged is not True, (
            f"{overlay or '<chart defaults>'} renders code-worker container "
            f"'{container['name']}' with privileged: true"
        )


@pytest.mark.parametrize("overlay", [None, *OVERLAYS])
def test_rendered_code_worker_never_targets_local_nsjail(overlay):
    doc = _code_worker_doc(_render(overlay))
    for container in doc["spec"]["template"]["spec"]["containers"]:
        for env in container.get("env") or []:
            if env.get("name") == "CODE_INTERPRETER_EXECUTION_TARGET":
                assert env.get("value") != "local-nsjail", (
                    f"{overlay or '<chart defaults>'} renders "
                    f"CODE_INTERPRETER_EXECUTION_TARGET=local-nsjail"
                )
