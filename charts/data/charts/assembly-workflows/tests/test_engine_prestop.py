"""Guard the assembly-engine preStop drain hook.

An HPA-driven scale-down that kills ready replicas has a race between SIGTERM
delivery and the Service's endpoint-list update: a request can land on a pod
in the window after it starts terminating but before kube-proxy removes it.
This exact race was found+fixed on assembly-llm-gateway (issue #1526, PR
#1530): an 8->2 scale-down (six pods killed simultaneously) produced 2/2710
connection-refused failures with no preStop hook, 0/1859 with a 5s preStop
sleep added.

assembly-engine's HPA is default-ON in this chart's base values (unlike
llm-gateway's opt-in one), so it's higher-stakes -- any real, non-perf-tier
deployment relies on it today. Applied the same preStop fix proactively
(issue #1531). Two live scale-down reproductions on assembly-perf-small
(2026-07-04, staggered single-pod-at-a-time removals under this cluster's
HPA scale-down policy, ~20k dense request samples across both events) did
NOT catch a failure -- unlike llm-gateway's clear-cut simultaneous-batch
case, this is a milder scale-down shape. Not catching a failure in a milder
scenario doesn't rule out the race under a more severe simultaneous-kill
event (not reproduced here due to a load-harness reliability issue, not a
platform finding) -- the fix is applied as a low-cost, consistent-with-
llm-gateway precaution, not because a failure was directly observed here.
"""

import pathlib
import re

TEMPLATE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "templates"
    / "assembly-engine.yaml"
)


def _lifecycle_block(text: str) -> str:
    m = re.search(r"^(\s*)lifecycle:\s*$", text, re.MULTILINE)
    assert m, "no lifecycle block found in assembly-engine.yaml"
    indent = len(m.group(1))
    block = []
    for ln in text[m.end():].splitlines():
        if ln.strip() and (len(ln) - len(ln.lstrip())) <= indent:
            break
        block.append(ln)
    return "\n".join(block)


def test_engine_has_prestop_drain_hook():
    text = TEMPLATE.read_text()
    block = _lifecycle_block(text)
    assert "preStop:" in block, (
        "assembly-engine must have a preStop hook to avoid the "
        "SIGTERM/endpoint-removal race during HPA scale-down (see module "
        "docstring, issue #1531)"
    )
    m = re.search(r"sleep\s+(\d+)", block)
    assert m, "preStop hook must sleep for a fixed duration before exiting"
    sleep_seconds = int(m.group(1))
    assert sleep_seconds >= 5, (
        f"preStop sleep is {sleep_seconds}s, below the 5s used for the "
        f"sibling llm-gateway fix (issue #1526) -- don't shorten it "
        f"without re-validating"
    )


def test_engine_termination_grace_period_covers_prestop_sleep():
    text = TEMPLATE.read_text()
    block = _lifecycle_block(text)
    sleep_seconds = int(re.search(r"sleep\s+(\d+)", block).group(1))
    grace_match = re.search(
        r"^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$", text, re.MULTILINE
    )
    # #1537 made this explicit in the chart so the preStop-sleep safety margin
    # is visible and not silently tied to a k8s default that could change.
    assert grace_match is not None, (
        "assembly-engine must set terminationGracePeriodSeconds explicitly "
        "(issue #1537) — do not rely on the implicit 30s default"
    )
    grace_period = int(grace_match.group(1))
    assert grace_period > sleep_seconds, (
        f"terminationGracePeriodSeconds ({grace_period}s) must leave room "
        f"beyond the preStop sleep ({sleep_seconds}s) for graceful shutdown, "
        f"or SIGKILL fires before the app can finish shutting down cleanly"
    )
