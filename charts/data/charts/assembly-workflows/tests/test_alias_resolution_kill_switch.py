"""Guard the alias-resolution kill switch on the sandbox trigger.

Two properties, both easy to get wrong:

1. The default render must be UNCHANGED (env absent), so enabling aliases needs
   no values edit and existing deployments diff cleanly.
2. Setting it false must actually emit ``WEBHOOK_ALIAS_RESOLUTION_ENABLED=false``.
   The obvious template spelling ``| default true`` silently breaks this: Helm's
   ``default`` treats ``false`` as empty, so an explicit false reads back as true
   and the switch never fires. This test is the reason that bug did not ship.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
ENV_NAME = "WEBHOOK_ALIAS_RESOLUTION_ENABLED"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _trigger_env(*extra: str) -> list[dict]:
    result = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "-s", "templates/assembly-sandbox-trigger.yaml",
            "--set", "validation.allowPlaceholders=true",
            *extra,
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    # The template renders more than one doc (Deployment + Service/HPA); pick the
    # Deployment by kind rather than assuming an order.
    deployment = next(
        d
        for d in yaml.safe_load_all(result.stdout)
        if d
        and d.get("kind") == "Deployment"
        and d["metadata"]["name"] == "t-data-assembly-sandbox-trigger"
    )
    containers = deployment["spec"]["template"]["spec"]["containers"]
    assert len(containers) == 1
    return containers[0].get("env", [])


def test_kill_switch_env_absent_by_default():
    names = {e["name"] for e in _trigger_env()}
    assert ENV_NAME not in names


def test_kill_switch_env_emitted_when_disabled():
    env = _trigger_env("--set", "sandboxTrigger.aliasResolutionEnabled=false")
    values = [e.get("value") for e in env if e["name"] == ENV_NAME]
    assert values == ["false"]


def test_kill_switch_env_absent_when_explicitly_enabled():
    env = _trigger_env("--set", "sandboxTrigger.aliasResolutionEnabled=true")
    assert ENV_NAME not in {e["name"] for e in env}
