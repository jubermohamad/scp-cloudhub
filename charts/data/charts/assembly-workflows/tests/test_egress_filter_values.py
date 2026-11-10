"""The egress filter must reach the pod, and never be enabled without DNS.

Two failure modes this guards, both of which have real precedent in this repo:

1. **A values key that never reaches the container.** The filter itself is
   proven working on dev, but it shipped with no `values*.yaml` entry at all, so
   a default deploy still refused networked `custom_code`. A control that exists
   in code and not in the rendered pod spec is inert — the same shape as the
   NetworkPolicies that were enforced by nothing (#2111) and the docs gate that
   read a settings default and never fired.

2. **Enabled without a resolver.** The DNS exception is scoped to the jailed
   cgroup on udp/53. With the filter on and `dnsIP` empty, jailed code can reach
   public IPs but cannot resolve a single name — so the capability the filter
   restores is unusable, and it fails in a way that looks like a network outage
   rather than a misconfiguration.

Asserted on RENDERED output, not on the values files, because the rendered spec
is what the pod actually gets.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

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


def _env_value(rendered: str, name: str) -> str | None:
    """The value of `name` in the sandbox-execute container env, or None."""
    lines = rendered.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == f"- name: {name}":
            for follow in lines[i + 1 : i + 3]:
                if "value:" in follow:
                    return follow.split("value:", 1)[1].strip().strip('"')
    return None


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_filter_setting_reaches_the_pod(values_file: Path):
    """Present in every overlay — absent means the code default silently wins."""
    rendered = _render(values_file)
    assert _env_value(rendered, "EXECUTE_CODE_EGRESS_FILTER") is not None, (
        f"{values_file.name}: EXECUTE_CODE_EGRESS_FILTER is not in the rendered "
        f"pod spec, so the chart cannot control it"
    )


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_enabled_filter_always_has_a_resolver(values_file: Path):
    """Filter on + no DNS = code can reach IPs but resolve no names."""
    rendered = _render(values_file)
    enabled = (_env_value(rendered, "EXECUTE_CODE_EGRESS_FILTER") or "false").lower() == "true"
    if not enabled:
        return
    dns = _env_value(rendered, "EXECUTE_CODE_EGRESS_FILTER_DNS_IP") or ""
    assert dns.strip(), (
        f"{values_file.name}: egress filter is enabled with no "
        f"EXECUTE_CODE_EGRESS_FILTER_DNS_IP — jailed code will resolve nothing"
    )


def test_chart_default_is_off():
    """Off by default: the filter needs cgroup2 + iptables + privileged, and a
    filter that cannot install must never be assumed present."""
    rendered = _render(_CHART / "values.yaml")
    assert (_env_value(rendered, "EXECUTE_CODE_EGRESS_FILTER") or "").lower() == "false"


@pytest.mark.parametrize("overlay", ["values-dev.yaml", "values-demo.yaml"])
def test_clusters_running_user_code_have_it_on(overlay: str):
    """dev and demo run real user workflows that use allowNetworkAccess.

    Measured on demo: 338 of 3238 custom_code executions (10.4%) across 140
    traces — check-detection, Name Screening, Citi L1/L2, the AML TM workflows.
    They are refused outright without this.
    """
    path = _CHART / overlay
    if not path.exists():
        pytest.skip(f"{overlay} not present")
    rendered = _render(path)
    assert (_env_value(rendered, "EXECUTE_CODE_EGRESS_FILTER") or "").lower() == "true", (
        f"{overlay}: users on this cluster run networked code nodes; disabling "
        f"the filter refuses them"
    )
