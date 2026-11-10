"""Guards for assembly-aks-dev rollout.noSurge (#1631).

The dev cluster runs close to capacity; default RollingUpdate surge pods leave
replacements Pending and make Helm time out. values-dev.yaml must keep
rollout.noSurge enabled and render zero-surge strategies on app-tier Deployments.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
VALUES_DEV = CHART / "values-dev.yaml"

NO_SURGE_DEPLOYMENTS = [
    "t-data-assembly-core",
    "t-data-assembly-engine",
    "t-data-assembly-engine-worker",
    "t-data-assembly-llm-gateway",
    "t-data-assembly-frontend",
]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


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


def test_values_dev_enables_rollout_no_surge():
    values = yaml.safe_load(VALUES_DEV.read_text()) or {}
    assert values.get("rollout", {}).get("noSurge") is True, (
        "values-dev.yaml must set rollout.noSurge: true for assembly-aks-dev (#1631)"
    )


def test_values_dev_render_stamps_zero_surge_on_app_deployments():
    rendered = _render_dev()
    assert rendered.returncode == 0, rendered.stderr
    for name in NO_SURGE_DEPLOYMENTS:
        doc = _deployment_doc(rendered.stdout, name)
        assert "maxSurge: 0" in doc, f"{name} must not create surge pods on dev"
        assert "maxUnavailable: 1" in doc, f"{name} must free old capacity first"
