"""Guards for assembly-aks-dev scheduling assumptions.

The CI deploy target is a long-lived dev cluster whose node labels have drifted
across manual operations and autoscaler/nodepool changes. The dev overlay must
not require workload=app/infra labels unless the workflow also owns repairing
those labels first.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
VALUES_DEV = CHART / "values-dev.yaml"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _render_dev() -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--values", str(CHART / "values-dev.yaml"),
            "--set", "validation.allowPlaceholders=true",
        ],
        capture_output=True,
        text=True,
    )


def test_dev_overlay_does_not_require_workload_node_labels():
    r = _render_dev()
    assert r.returncode == 0, r.stderr
    assert "workload: app" not in r.stdout
    assert "workload: infra" not in r.stdout


def test_values_dev_clears_infra_and_scheduling_node_selectors():
    """#1632: drifted workload=app/infra labels must not be required in values."""
    values = yaml.safe_load(VALUES_DEV.read_text()) or {}
    assert values.get("infra", {}).get("nodeSelector") == {}
    assert values.get("scheduling", {}).get("nodeSelector") == {}
