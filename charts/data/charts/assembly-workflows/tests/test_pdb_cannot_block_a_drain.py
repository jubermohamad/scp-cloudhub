"""No PodDisruptionBudget may permit zero disruptions.

A PDB with `minAvailable: N` against exactly N pods allows **no** evictions at
all, so the workload can never be drained:

    Drain node ... failed evicting postgres-...
    blocked by pdb postgres-pdb (MinAvailable: 1) (ExpectedPods: 1)

That is not a theoretical reading. It blocked the Calico rollout (#2111) on
`assembly-perf-small`, and `assembly-perf-medium` carried four such PDBs
(`postgres`, `postgres-temporal`, `redis`, `temporal-worker`), each reporting
`disruptionsAllowed: 0`. A self-blocking PDB also blocks Kubernetes version
upgrades, node pool resizing and autoscaler consolidation — everything that
drains a node.

Hand-patching does not hold: helm recreated all four from the chart on the next
upgrade. The fix has to live here.

## Why the assertion is computed, not hardcoded

The check renders the chart, matches every PDB to the workload its selector
actually targets, reads that workload's **rendered** replica count, and
reproduces the Kubernetes disruption controller's arithmetic. Hardcoding a list
of "known bad" PDB names would pass the moment someone adds the eleventh one —
which is precisely how this shipped, since ten app-tier PDBs already guard on
`replicas > 1` and the infra ones were simply written without it.

## Percentages round UP, and that is load-bearing

`maxUnavailable: 25%` against 2 replicas yields 1, not 0. Verified against a
live cluster rather than assumed, because assuming round-down would flag nine
safe PDBs as broken and invite a "fix" that changes working behaviour:

    assembly-engine-subflow-worker-pdb  maxUnavail=25%  expected=2  desiredHealthy=1  allowed=1
    assembly-engine-worker-pdb          maxUnavail=25%  expected=6  desiredHealthy=4  allowed=2

so `ceil` is the correct operator for both fields (k8s `GetScaledValueFromIntOrPercent`
with `roundUp=true` in the disruption controller).
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

import pytest
import yaml

_CHART = Path(__file__).resolve().parents[1]

_BASE_ARGS = [
    "--set", "validation.allowPlaceholders=true",
    "--set", "infra.postgres.password=placeholder-for-template-test",
]

# Configurations that change WHICH PDBs render, beyond the values files. The
# Temporal topologies are the ones that matter: auto-setup renders `temporal`,
# split renders `temporal-frontend`/`-history`/`-matching`/`-worker`, and those
# split replica counts default to 1 for frontend and worker.
_TOPOLOGIES = {
    "infra-auto-setup": [
        *_BASE_ARGS,
        "--set", "infra.enabled=true",
        "--set", "infra.temporal.mode=auto-setup",
    ],
    "infra-split": [
        *_BASE_ARGS,
        "--set", "infra.enabled=true",
        "--set", "infra.temporal.mode=split",
    ],
    "infra-split-postgres-temporal": [
        *_BASE_ARGS,
        "--set", "infra.enabled=true",
        "--set", "infra.temporal.mode=split",
        "--set", "infra.postgresTemporal.enabled=true",
    ],
}

_VALUES = sorted(_CHART.glob("values*.yaml"))

# Workload kinds a PDB can legitimately select.
_WORKLOAD_KINDS = {"Deployment", "StatefulSet", "ReplicaSet"}


def _render(extra_args: list[str], values_file: Path | None = None) -> str:
    cmd = ["helm", "template", "t", str(_CHART)]
    if values_file is not None:
        cmd += ["-f", str(values_file)]
    cmd += extra_args
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        pytest.fail(f"helm template failed: {result.stderr[:500]}")
    return result.stdout


def _docs(rendered: str) -> list[dict]:
    return [d for d in yaml.safe_load_all(rendered) if d]


def _scaled(value, replicas: int) -> int:
    """Kubernetes' GetScaledValueFromIntOrPercent with roundUp=True."""
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if text.endswith("%"):
        return math.ceil(int(text[:-1]) * replicas / 100)
    return int(text)


def _disruptions_allowed(spec: dict, replicas: int) -> int:
    """What the disruption controller would publish as `disruptionsAllowed`.

    Assumes every pod healthy, which is the best case — if a PDB permits zero
    disruptions with everything healthy, it permits zero always.
    """
    if "maxUnavailable" in spec:
        max_unavailable = _scaled(spec["maxUnavailable"], replicas)
        desired_healthy = max(replicas - max_unavailable, 0)
    else:
        desired_healthy = _scaled(spec["minAvailable"], replicas)
    return replicas - desired_healthy


def _pdbs_with_replica_counts(rendered: str) -> list[tuple[str, dict, str, int]]:
    """(pdb name, pdb spec, workload name, replicas) for every rendered PDB."""
    docs = _docs(rendered)
    workloads = [d for d in docs if d.get("kind") in _WORKLOAD_KINDS]
    out = []
    for pdb in [d for d in docs if d.get("kind") == "PodDisruptionBudget"]:
        selector = pdb["spec"].get("selector", {}).get("matchLabels", {})
        assert selector, f"{pdb['metadata']['name']} has no matchLabels selector"
        matched = [
            w
            for w in workloads
            if all(
                w["spec"]["template"]["metadata"].get("labels", {}).get(k) == v
                for k, v in selector.items()
            )
        ]
        assert matched, (
            f"{pdb['metadata']['name']} selects {selector} but no rendered "
            f"Deployment/StatefulSet carries those labels — a PDB matching "
            f"nothing is dead config that still blocks nothing and hides bugs"
        )
        assert len(matched) == 1, (
            f"{pdb['metadata']['name']} selects {len(matched)} workloads; the "
            f"replica arithmetic below assumes exactly one"
        )
        workload = matched[0]
        out.append(
            (
                pdb["metadata"]["name"],
                pdb["spec"],
                workload["metadata"]["name"],
                int(workload["spec"].get("replicas", 1)),
            )
        )
    return out


def _assert_no_pdb_blocks_a_drain(rendered: str, label: str) -> int:
    entries = _pdbs_with_replica_counts(rendered)
    offenders = []
    for name, spec, workload, replicas in entries:
        allowed = _disruptions_allowed(spec, replicas)
        if allowed < 1:
            budget = (
                f"maxUnavailable={spec['maxUnavailable']}"
                if "maxUnavailable" in spec
                else f"minAvailable={spec['minAvailable']}"
            )
            offenders.append(
                f"{name} ({budget}) against {workload} replicas={replicas} "
                f"-> disruptionsAllowed={allowed}"
            )
    assert not offenders, (
        f"[{label}] PDBs that permit ZERO disruptions, so the node can never be "
        f"drained and a Calico enablement / k8s upgrade / node resize hangs:\n  "
        + "\n  ".join(offenders)
    )
    return len(entries)


@pytest.mark.parametrize("topology", sorted(_TOPOLOGIES))
def test_no_pdb_blocks_a_drain_in_any_topology(topology: str):
    rendered = _render(_TOPOLOGIES[topology])
    assert _assert_no_pdb_blocks_a_drain(rendered, topology) >= 0


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_no_pdb_blocks_a_drain_in_any_overlay(values_file: Path):
    """Every shipped overlay, since replica counts are exactly what they tune."""
    rendered = _render([*_BASE_ARGS, "--set", "infra.enabled=true"], values_file)
    _assert_no_pdb_blocks_a_drain(rendered, values_file.name)


def test_the_four_that_were_broken_on_perf_medium_are_fixed():
    """Named regression guard for the PDBs observed at disruptionsAllowed: 0.

    Generic assertions can drift; these four are the measured evidence, so they
    are pinned by name. Each must now either not render or permit a disruption.
    """
    rendered = _render(_TOPOLOGIES["infra-split-postgres-temporal"])
    by_name = {n: (s, r) for n, s, _w, r in _pdbs_with_replica_counts(rendered)}

    for name in (
        "postgres-pdb",
        "postgres-temporal-pdb",
        "redis-pdb",
        "temporal-worker-pdb",
    ):
        if name in by_name:
            spec, replicas = by_name[name]
            assert _disruptions_allowed(spec, replicas) >= 1, (
                f"{name} still blocks its own eviction"
            )


def test_single_replica_workloads_get_no_pdb():
    """A PDB over one pod protects nothing and can only ever get in the way.

    Evicting the only replica is an outage whether or not a PDB exists; the PDB
    just converts a brief, recoverable outage into a permanently stuck drain.
    The chart's ten application PDBs already gate on `replicas > 1` — this
    pins the infra ones to the same rule so the file has one convention rather
    than two, which is how the inconsistency arose in the first place.
    """
    for topology, args in _TOPOLOGIES.items():
        rendered = _render(args)
        for name, _spec, workload, replicas in _pdbs_with_replica_counts(rendered):
            assert replicas > 1, (
                f"[{topology}] {name} targets {workload} with replicas={replicas}; "
                f"a PDB over a single replica cannot protect availability and "
                f"risks blocking drains — gate it on `replicas > 1`"
            )
