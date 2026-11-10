"""sandbox-execute's limits must be survivable, because they are now enforced.

Until #2118 they were not. The egress filter placed the service in a cgroup at
the cgroup2 root, outside the kubelet hierarchy, where there is no ancestor
carrying `cpu.max`/`memory.max` — so whatever the chart declared applied to
nothing. Measured on assembly-aks-dev: 516 core-seconds burned against a
declared cap of 0.5 cores, with 0.15s of it accounted to the pod.

Nesting the tree back under the pod cgroup makes those numbers real. That is the
correct behaviour, and it is also the moment every value in this block starts
mattering — including ones written while they were inert. The base default was
`1Gi / 500m`, which is not a plausible budget for the one service whose job is
running arbitrary user code: a pandas frame or an lxml parse in a `custom_code`
node, across 4 uvicorn workers.

There is precedent, from the last time this service ran under a real cap:
values-small.yaml raised its limit to 2 because sandbox-execute — not Postgres —
became the throughput ceiling, CPU-throttled at its limit while the code-worker
idled at 0.08 cores.

Asserted on RENDERED output: the values files deep-merge, so an overlay that
sets only `limits.memory` silently inherits the base `limits.cpu`, and reading
the overlay alone would miss it. That merge is exactly how dev ended up
declaring a 0.5-core cap nobody chose.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

_CHART = Path(__file__).resolve().parents[1]
_VALUES = sorted(_CHART.glob("values*.yaml"))

# Floors, not targets. A deployment may legitimately ask for more; asking for
# materially less means user code gets throttled or OOMKilled mid-run, which
# surfaces to the author as a mysterious failed node.
_MIN_CPU_CORES = 1.0
_MIN_MEMORY_BYTES = 2 * 1024**3


def _render(values_file: Path) -> str:
    result = subprocess.run(
        [
            "helm", "template", "t", str(_CHART),
            "-f", str(values_file),
            "--set", "validation.allowPlaceholders=true",
            "--set", "infra.postgres.password=placeholder-for-template-test",
        ],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        pytest.fail(f"helm template failed for {values_file.name}: {result.stderr[:400]}")
    return result.stdout


def _sandbox_execute_limits(rendered: str) -> dict | None:
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") != "Deployment":
            continue
        if doc["metadata"]["name"] != "t-data-assembly-sandbox-execute":
            continue
        container = doc["spec"]["template"]["spec"]["containers"][0]
        return container.get("resources", {}).get("limits")
    return None


def _cores(value) -> float:
    text = str(value)
    return float(text[:-1]) / 1000 if text.endswith("m") else float(text)


def _bytes(value) -> int:
    text = str(value)
    for suffix, mult in (("Gi", 1024**3), ("Mi", 1024**2), ("Ki", 1024)):
        if text.endswith(suffix):
            return int(float(text[: -len(suffix)]) * mult)
    return int(text)


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_cpu_limit_can_actually_run_user_code(values_file: Path):
    limits = _sandbox_execute_limits(_render(values_file))
    if limits is None:
        pytest.skip("sandbox-execute not rendered by this overlay")
    if "cpu" not in limits:
        return  # No cap at all is permitted: nothing to throttle.

    cores = _cores(limits["cpu"])
    assert cores >= _MIN_CPU_CORES, (
        f"{values_file.name}: sandbox-execute capped at {limits['cpu']} CPU. "
        f"Since #2118 this cap is ENFORCED, and it throttles the process that "
        f"runs custom_code — the author sees a slow or timing-out node with no "
        f"error explaining why. Raise it or remove it."
    )


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_memory_limit_leaves_room_for_a_real_payload(values_file: Path):
    limits = _sandbox_execute_limits(_render(values_file))
    if limits is None:
        pytest.skip("sandbox-execute not rendered by this overlay")
    if "memory" not in limits:
        return

    size = _bytes(limits["memory"])
    assert size >= _MIN_MEMORY_BYTES, (
        f"{values_file.name}: sandbox-execute capped at {limits['memory']}. "
        f"Since #2118 this cap is ENFORCED and the cgroup OOM-kills rather than "
        f"returning an error, so a pandas/lxml payload takes the node's whole "
        f"execution down. This is the same failure that forced the "
        f"document-extraction limit up from 256Mi."
    )


def test_the_base_default_is_the_one_most_deployments_get():
    """Overlays deep-merge, so the base default is the effective value.

    dev sets only `limits.memory` and inherited `limits.cpu: 500m` from here
    without anyone choosing it. Guarding the base is what stops that recurring.
    """
    limits = _sandbox_execute_limits(_render(_CHART / "values.yaml"))
    assert limits is not None
    assert _cores(limits["cpu"]) >= _MIN_CPU_CORES
    assert _bytes(limits["memory"]) >= _MIN_MEMORY_BYTES
