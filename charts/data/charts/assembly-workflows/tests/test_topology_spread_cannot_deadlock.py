"""A hard spread constraint must survive node loss, not just a rollout.

`sandbox-execute` spread its replicas with `whenUnsatisfiable: ScheduleAnyway`
— a preference the scheduler may ignore and, once ignored, never revisits.
Kubernetes does not move running pods to satisfy a soft constraint, so a single
unlucky rollout bunches every replica onto one node permanently.

Measured on assembly-perf-medium (#2123): at `cpu: 4`, three replicas bunched
on one node did **1.84 wf/s against 5.55 spread — a 3x swing**, larger than the
entire CPU-limit ladder measured for #2118. Every rollout in that session
bunched them; it had to be corrected by hand before each run.

## What actually deadlocks a hard constraint — measured, not assumed

#2123 predicted that flipping to `DoNotSchedule` would stall rollouts because
old-revision pods count toward the new pod's skew. **That was tested on
assembly-aks-dev and it is wrong.** A deployment pinned 3-on-1-node, then
switched to a bare `DoNotSchedule`, rolled out cleanly to 1/1/1.

The reason is the scheduler's actual rule. A node is rejected only when::

    (pods_on_that_node + 1) - min_pods_across_eligible_domains > maxSkew

From a bunched 3/0/0 state, placing on an empty node gives `1 - 0 = 1`, which
is within `maxSkew: 1`. The over-full node is rejected; the empty ones are not.
**The minimum-count domain is therefore always spread-feasible**, so a hard
constraint essentially cannot deadlock on its own.

It deadlocks when the minimum-count domain is unschedulable for some OTHER
reason — and node loss is exactly that case. A failed node keeps its pods'
topology slot at zero while carrying
`node.kubernetes.io/unreachable:NoSchedule`, which pods do not tolerate by
default. It is simultaneously the only domain the spread constraint likes and
the one place nothing can land, so every node is rejected:

    0/3 nodes are available: 1 node(s) had untolerated taint(s),
                             2 node(s) didn't match pod topology spread constraints

That is a live capture from this cluster, and it is the same failure #1455/#1456
hit — recorded there as capping single-node-loss capacity at 50% with pods
Pending regardless of CPU headroom, which is what forced engine-worker's
thin-tier soft override.

`nodeTaintsPolicy: Honor` drops untolerated-tainted nodes from the domain set,
so the dead node stops counting and replacements land on the survivors. Same
scenario, with Honor: rolled out 3/3.

These tests therefore treat `nodeTaintsPolicy: Honor` as the load-bearing
requirement for any hard constraint. `matchLabelKeys` is asserted too, but on
the honest, weaker ground stated at its own test.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

_CHART = Path(__file__).resolve().parents[1]
_VALUES = sorted(_CHART.glob("values*.yaml"))


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


def _deployments(rendered: str) -> dict[str, dict]:
    out = {}
    for doc in yaml.safe_load_all(rendered):
        if doc and doc.get("kind") == "Deployment":
            out[doc["metadata"]["name"]] = doc
    return out


def _constraints(dep: dict) -> list[dict]:
    return dep["spec"]["template"]["spec"].get("topologySpreadConstraints") or []


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_hard_spread_survives_node_loss(values_file: Path):
    """THE invariant: DoNotSchedule implies nodeTaintsPolicy: Honor.

    Reproduced live on assembly-aks-dev — without Honor, tainting one of three
    nodes left a replacement pod Pending indefinitely (`1 node(s) had
    untolerated taint(s), 2 node(s) didn't match pod topology spread
    constraints`); with Honor, the identical rollout completed 3/3.

    A hard constraint without this converts a single node failure into a
    permanently under-capacity deployment.
    """
    for name, dep in _deployments(_render(values_file)).items():
        for c in _constraints(dep):
            if c.get("whenUnsatisfiable") != "DoNotSchedule":
                continue
            assert c.get("nodeTaintsPolicy") == "Honor", (
                f"{values_file.name}: {name} spreads HARD but counts tainted and "
                f"unreachable nodes as domains. On node loss the dead node is the "
                f"minimum-count domain — the only one the spread constraint "
                f"accepts — and nothing can schedule there, so replacements stay "
                f"Pending with ample headroom elsewhere. See #1455/#1456, #2123."
            )


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_hard_spread_is_evaluated_per_revision(values_file: Path):
    """Weaker claim than #2123 assumed, kept for correct rollout semantics.

    This does NOT prevent a deadlock: a bare `DoNotSchedule` was measured
    rolling out cleanly from a fully bunched state, because the minimum-count
    domain stays feasible (see module docstring). What it does is stop the
    OUTGOING revision's placement from influencing where the incoming one
    lands, which is upstream's documented guidance for rolling updates and
    keeps the constraint's meaning stable while two ReplicaSets coexist.

    Asserted so the manifests stay consistent, not because it is load-bearing.
    """
    for name, dep in _deployments(_render(values_file)).items():
        for c in _constraints(dep):
            if c.get("whenUnsatisfiable") != "DoNotSchedule":
                continue
            assert "pod-template-hash" in (c.get("matchLabelKeys") or []), (
                f"{values_file.name}: {name} spreads HARD without "
                f"matchLabelKeys: [pod-template-hash], so the outgoing "
                f"ReplicaSet's placement steers the incoming one. See #2123."
            )


def test_sandbox_execute_spread_is_hard_by_default():
    """The actual fix for #2123, on the default values.

    Parameterised per tier like engine-worker, but the DEFAULT must be hard —
    a soft default is what produced the 3x regression.
    """
    dep = _deployments(_render(_CHART / "values.yaml"))["t-data-assembly-sandbox-execute"]
    constraints = _constraints(dep)

    assert constraints, "sandbox-execute must keep a topology spread constraint"
    c = constraints[0]
    assert c["whenUnsatisfiable"] == "DoNotSchedule", (
        "sandbox-execute must spread HARD by default: measured 1.84 vs 5.55 wf/s "
        "bunched vs spread (#2123)"
    )
    assert c["topologyKey"] == "kubernetes.io/hostname"
    assert c["maxSkew"] == 1


def test_sandbox_execute_spread_stays_tier_overridable():
    """Thin-node tiers must retain the escape hatch.

    Where replicas outnumber schedulable nodes, or a node is too full to take
    its share, a hard constraint leaves pods Pending rather than merely
    co-located. `nodeTaintsPolicy: Honor` removes the node-loss case but not
    the too-few-nodes case, so the override still has to work.
    """
    rendered = subprocess.run(
        [
            "helm", "template", "t", str(_CHART),
            "--set", "validation.allowPlaceholders=true",
            "--set", "infra.postgres.password=placeholder-for-template-test",
            "--set", "sandboxExecute.topologySpreadWhenUnsatisfiable=ScheduleAnyway",
        ],
        capture_output=True, text=True, timeout=120,
    )
    assert rendered.returncode == 0, rendered.stderr[:400]
    dep = _deployments(rendered.stdout)["t-data-assembly-sandbox-execute"]
    assert _constraints(dep)[0]["whenUnsatisfiable"] == "ScheduleAnyway"


def test_rollout_strategy_keeps_the_new_revision_placeable():
    """maxSurge must stay 0 while the constraint is hard.

    With `maxSurge: 0` the new ReplicaSet never needs more pods than the old
    one gives up, so on a cluster with exactly as many nodes as replicas there
    is always a domain free for the incoming pod. A surge pod is one MORE pod
    of the new revision than there are free domains, which per-revision
    evaluation does not help with — it would sit Pending and gate the rollout.
    """
    dep = _deployments(_render(_CHART / "values.yaml"))["t-data-assembly-sandbox-execute"]
    rolling = dep["spec"]["strategy"]["rollingUpdate"]

    assert rolling["maxSurge"] == 0, (
        "a hard spread constraint plus maxSurge > 0 can gate the rollout on an "
        "unschedulable surge pod when nodes == replicas"
    )
    assert rolling["maxUnavailable"] >= 1, "maxSurge 0 needs maxUnavailable >= 1 to progress"
