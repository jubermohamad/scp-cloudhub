"""Guards for assembly-aks-dev sandbox-execute sizing (#values-dev OOM class).

A single sandbox-execute replica is a SPOF: concurrent custom_code nodes can
OOMKill the lone pod (exit 137) and every in-flight execution fails with
"Sandbox /execute-code unreachable". values-dev.yaml documents this incident
and pins replicas=2 with a 3Gi memory limit.
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


def _parse_memory_gi(value: str) -> float:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(Gi|G|Mi|M)", str(value).strip())
    assert match, f"expected memory quantity like 3Gi, got {value!r}"
    amount = float(match.group(1))
    unit = match.group(2)
    if unit in ("Gi", "G"):
        return amount
    return amount / 1024


def test_dev_overlay_sandbox_execute_has_redundant_replicas():
    """Concurrent custom_code must survive a single pod OOM/restart."""
    values = _load_values_dev()
    replicas = values["sandboxExecute"]["replicas"]
    assert replicas >= 2, (
        "sandboxExecute.replicas must stay >= 2 so one OOM/restart does not "
        "take down all code execution on assembly-aks-dev"
    )


def test_dev_overlay_sandbox_execute_memory_limit_has_headroom():
    """Each replica must allow concurrent nsjail executions without OOM."""
    values = _load_values_dev()
    limit = values["sandboxExecute"]["resources"]["limits"]["memory"]
    assert _parse_memory_gi(limit) >= 3, (
        "sandboxExecute.resources.limits.memory must stay >= 3Gi for concurrent "
        "custom_code workloads documented in values-dev.yaml"
    )


def test_dev_render_sandbox_execute_matches_values_replicas():
    """Rendered Deployment must honor values-dev sandboxExecute.replicas."""
    values = _load_values_dev()
    rendered = _render_dev()
    assert rendered.returncode == 0, rendered.stderr
    doc = _deployment_doc(rendered.stdout, "t-data-assembly-sandbox-execute")
    parsed = yaml.safe_load(doc)
    assert parsed["spec"]["replicas"] == values["sandboxExecute"]["replicas"]


def test_dev_overlay_requires_preview_access_token():
    """#1352: AKS-dev must fail-closed on the unauthenticated preview proxy."""
    values = _load_values_dev()
    extra = values.get("sandboxExecute", {}).get("extraEnv") or []
    by_name = {e["name"]: e.get("value") for e in extra if isinstance(e, dict)}
    assert by_name.get("PREVIEW_REQUIRE_ACCESS_TOKEN") == "true"
