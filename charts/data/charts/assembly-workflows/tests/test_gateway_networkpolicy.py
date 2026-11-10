"""Guard: the APISIX gateway stays reachable when NetworkPolicy is on.

The chart's default-deny + same-namespace-only allow match POD sources, and a request
arriving from outside (internet, an internal LB, another namespace) has no pod source —
so no `podSelector` can ever match it. Without a gateway-scoped allow, turning on a
policy engine silently takes the public URL offline.

`allow-apisix-public-ingress` covers that unconditionally: it opens ONLY the apisix pod's
two listener ports to any source, so backends stay behind default-deny and callers can
reach the platform only THROUGH the gateway.

This file previously guarded `networkPolicies.allowGatewayIngress`, a gated policy that
rendered a byte-identical rule. It could never admit traffic the unconditional one did
not, so it was deleted; these assertions moved to the surviving policy.

NB the ports are CONTAINER ports (9080/9443), not the Service ports (80/443) —
NetworkPolicy is evaluated at the pod, after Service port translation.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
GATEWAY_ALLOW = "t-data-assembly-allow-apisix-public-ingress"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _netpols(*extra: str):
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "networkPolicies.enabled=true",
            "--set", "validation.allowPlaceholders=true",
            *extra,
        ],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return {
        d["metadata"]["name"]: d
        for d in yaml.safe_load_all(r.stdout)
        if d and d.get("kind") == "NetworkPolicy"
    }


def test_gateway_allow_present_and_scoped():
    pols = _netpols()
    # The baseline policies survive alongside it.
    assert "t-data-assembly-default-deny-ingress" in pols
    assert "t-data-assembly-block-link-local-egress" in pols

    gw = pols.get(GATEWAY_ALLOW)
    assert gw is not None, f"no {GATEWAY_ALLOW}; got {list(pols)}"
    assert gw["spec"]["podSelector"]["matchLabels"]["app"] == "assembly-apisix"
    ingress = gw["spec"]["ingress"]
    ports = {p["port"] for rule in ingress for p in rule.get("ports", [])}
    assert {9080, 9443} <= ports, ports
    # "from any source" == no `from` restriction on the rule.
    assert all(not rule.get("from") for rule in ingress), "gateway allow must not restrict source"


def test_gateway_allow_is_the_only_apisix_scoped_policy():
    """Regression guard for the duplicate that used to sit behind a values flag.

    A second identical policy was harmless (NetworkPolicy rules union), but it made the
    flag read as if it controlled reachability when it could not.
    """
    pols = _netpols()
    apisix_scoped = [
        name for name, p in pols.items()
        if p["spec"].get("podSelector", {}).get("matchLabels", {}).get("app") == "assembly-apisix"
    ]
    assert apisix_scoped == [GATEWAY_ALLOW], apisix_scoped


def test_no_policies_at_all_when_disabled():
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "networkPolicies.enabled=false",
            "--set", "validation.allowPlaceholders=true",
        ],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    assert not [d for d in yaml.safe_load_all(r.stdout) if d and d.get("kind") == "NetworkPolicy"]
