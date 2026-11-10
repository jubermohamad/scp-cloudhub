"""Guard the assembly-llm-gateway preStop drain hook.

An HPA-driven scale-down that kills several ready replicas at once has a
race between SIGTERM delivery and the Service's endpoint-list update: a
request can land on a pod in the ~1s window after it starts terminating
but before kube-proxy removes it from the Service. Measured live on
assembly-perf-small (2026-07-04): an 8->2 scale-down (six pods killed
simultaneously) produced 2/2710 connection-refused failures, all
timestamped within 1s of the pods' Killing events, with no preStop hook.
With a 5s preStop sleep added, the identical scenario produced 0/1859
failures (issue #1526, PR #1530).

This test fails if anyone removes/shortens the preStop hook without
updating this guard deliberately.
"""

import pathlib
import re

TEMPLATE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "templates"
    / "assembly-llm-gateway.yaml"
)


def _lifecycle_block(text: str) -> str:
    m = re.search(r"^(\s*)lifecycle:\s*$", text, re.MULTILINE)
    assert m, "no lifecycle block found in assembly-llm-gateway.yaml"
    indent = len(m.group(1))
    block = []
    for ln in text[m.end():].splitlines():
        if ln.strip() and (len(ln) - len(ln.lstrip())) <= indent:
            break
        block.append(ln)
    return "\n".join(block)


def test_llm_gateway_has_prestop_drain_hook():
    text = TEMPLATE.read_text()
    block = _lifecycle_block(text)
    assert "preStop:" in block, (
        "assembly-llm-gateway must have a preStop hook to avoid the "
        "SIGTERM/endpoint-removal race during HPA scale-down (see module "
        "docstring, issue #1526)"
    )
    m = re.search(r"sleep\s+(\d+)", block)
    assert m, "preStop hook must sleep for a fixed duration before exiting"
    sleep_seconds = int(m.group(1))
    assert sleep_seconds >= 5, (
        f"preStop sleep is {sleep_seconds}s, below the 5s validated live "
        f"against a real 8->2 scale-down (issue #1526) — don't shorten it "
        f"without re-validating"
    )


def test_llm_gateway_termination_grace_period_covers_prestop_sleep():
    text = TEMPLATE.read_text()
    block = _lifecycle_block(text)
    sleep_seconds = int(re.search(r"sleep\s+(\d+)", block).group(1))
    grace_match = re.search(
        r"^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$", text, re.MULTILINE
    )
    # #1537 made this explicit in the chart so the preStop-sleep safety margin
    # is visible and not silently tied to a k8s default that could change.
    assert grace_match is not None, (
        "assembly-llm-gateway must set terminationGracePeriodSeconds explicitly "
        "(issue #1537) — do not rely on the implicit 30s default"
    )
    grace_period = int(grace_match.group(1))
    assert grace_period > sleep_seconds, (
        f"terminationGracePeriodSeconds ({grace_period}s) must leave room "
        f"beyond the preStop sleep ({sleep_seconds}s) for graceful shutdown, "
        f"or SIGKILL fires before the app can finish shutting down cleanly"
    )
