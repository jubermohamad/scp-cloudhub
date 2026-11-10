"""Guards for values-invhub-dev.yaml -- assembly as a drop-in next to InvHub, in the
dev-assembly namespace of a shared InvHub AKS cluster we do not own.

Each assertion pins a deliberate choice that a well-meaning edit would undo:

  * a dedicated Azure INTERNAL LB with APISIX terminating TLS itself (mode apisix)
    for assembly.invhub.fseng.net, which also drives KEYCLOAK_EXPECTED_ISSUER. The
    shared ingress-nginx works too -- mode ingress, exercised at the bottom of this
    file -- but couples us to another team's controller and needs the hostname
    repointed in the IH-owned DNS zone;
  * no nodeSelectors: the cluster has a single node pool, so values-dev's
    workload=infra|app selectors would leave every pod unschedulable;
  * NetworkPolicies off: default-deny and the same-namespace allow both match POD
    sources, so they sever the internal-LB -> APISIX path and kubelet probes. This
    instance went dark that way once;
  * the InvHub contract itself: the copilot CORS origin, both allowlists, and the
    Keycloak flows integration.

Secrets are ref+op:// pointers into the 1Password Assembly item, resolved by
`vals eval` at deploy -- so every render here needs
--set validation.allowPlaceholders=true (the chart refuses an unresolved ref).
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
OVERLAY = CHART / "values-invhub-dev.yaml"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _values() -> dict:
    assert OVERLAY.exists(), "values-invhub-dev.yaml missing"
    return yaml.safe_load(OVERLAY.read_text())


def _render() -> str:
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "-f", str(OVERLAY),
            "--set", "validation.allowPlaceholders=true",
            # Secrets are supplied at deploy from 1Password (empty in the overlay);
            # for a cluster-less render, allowPlaceholders relaxes the checks and a
            # stub covers infra.postgres.password (still guarded by `required`).
            "--set", "infra.postgres.password=test-pg",
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_overlay_gateway_is_internal_lb():
    """Assembly is its own front door on a dedicated Azure INTERNAL LB. No
    loadBalancerIP -- Azure assigns the VNet address."""
    svc = _values()["apisix"]["service"]
    assert svc["type"] == "LoadBalancer"
    assert svc["annotations"]["service.beta.kubernetes.io/azure-load-balancer-internal"] == "true"
    assert not svc.get("loadBalancerIP")


def test_overlay_tls_and_issuer_hostname():
    tls = _values()["apisix"]["tls"]
    assert tls["enabled"] is True
    assert tls["mode"] == "apisix"
    assert tls["publicHostname"] == "assembly.invhub.fseng.net"
    assert tls["existingSecret"] == "apisix-tls"


def test_overlay_cors_restates_defaults_plus_invhub_wildcard():
    """Helm lists REPLACE on override -- the overlay must restate the chart
    defaults it still wants alongside the InvHub origin. The InvHub origin is a
    *.invhub.fseng.net subdomain wildcard (copilot + any future subdomain), anchored
    so only exact <sub>.invhub.fseng.net hosts match."""
    origins = _values()["apisix"]["cors"]["allowOriginsRegex"]
    assert "^http://localhost(?::(?:80|3000|5173))?$" in origins
    assert r"^https://[^/]+\.app\.github\.dev$" in origins
    assert r"^https://[^/]+\.invhub\.fseng\.net$" in origins


def test_overlay_allowlists_and_flows_integration():
    values = _values()
    # Domain wildcards, not a host list: every in-VNet api_request target lives in
    # one of these three domains, so a new in-cluster API needs no chart edit.
    # NOT *.svc.cluster.local -- other teams' namespaces on this shared cluster
    # stay closed.
    assert values["urlValidation"]["allowHosts"].split(",") == [
        "*.dev-assembly.svc.cluster.local",
        "*.dev-copilot.svc.cluster.local",
        "*.invhub.fseng.net",
    ]
    # The op-sourced extras channel is wired to 1Password (empty field -> "" -> no
    # env). It must stay a ref+op:// pointer: a literal host list here would bypass
    # the "committed baseline is reviewable in a diff" split.
    assert values["urlValidation"]["extraAllowHosts"] == (
        "ref+op://nfrx352u56ryvyevbdyilpcji4/Assembly/dev-assembly-eng/"
        "urlValidation__extraAllowHosts"
    )
    # 1Password ref, not a literal -- redundant with the chart's auto-derivation
    # from flowsIntegration.serviceUser (below) as long as it stays empty/matching;
    # kept as a ref so ADDITIONAL subjects could be added without a chart release.
    assert values["sandboxTrigger"]["webhookRunAllowlist"] == (
        "ref+op://nfrx352u56ryvyevbdyilpcji4/Assembly/dev-assembly-eng/"
        "sandboxTrigger__webhookRunAllowlist"
    )
    flows = values["infra"]["keycloak"]["flowsIntegration"]
    assert flows["enabled"] is True
    assert flows["webOrigins"] == ["https://copilot.invhub.fseng.net"]


def test_overlay_network_policies_off_no_node_selectors_no_tag_pin():
    values = _values()
    # NetworkPolicies stay OFF on this shared cluster: default-deny plus the
    # same-namespace-only allow match POD sources, so they sever the internal-LB ->
    # APISIX path and kubelet probes. Turning them on took this instance dark.
    assert values["networkPolicies"]["enabled"] is False
    assert values["infra"]["nodeSelector"] == {}
    assert values["scheduling"]["nodeSelector"] == {}
    # image.tag is pinned at upgrade time (release-tagged images), never here.
    assert "tag" not in values.get("image", {})


def test_overlay_secrets_are_ref_op_references():
    """Every secret-bearing string must be a ref+op:// reference into the
    1Password Assembly item (a pointer, not a credential) so the committed overlay
    can never carry a real secret; `vals eval` resolves them at deploy, and a plain
    helm render without vals is refused by the chart's unresolved-ref guard."""
    values = _values()

    def walk(node, path):
        if isinstance(node, dict):
            for key, value in node.items():
                yield from walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                yield from walk(value, f"{path}[{i}]")
        elif isinstance(node, str):
            yield path, node

    secretish = ("password", "secret", "apikey", "key", "token")
    for path, value in walk(values, ""):
        leaf = path.rsplit(".", 1)[-1].lower()
        if any(marker in leaf for marker in secretish) and value:
            # non-secret exceptions: the TLS Secret NAME, pull-secret name, images
            if leaf in ("existingsecret", "name", "image", "mcimage"):
                continue
            assert value.startswith("ref+op://"), (
                f"{path} must be a ref+op:// reference into 1Password, not a literal: {value!r}"
            )


def test_overlay_renders_expected_cluster_shape():
    rendered = _render()
    docs = [d for d in yaml.safe_load_all(rendered) if d]
    # NetworkPolicies are OFF on this shared cluster (see the NP test) -> none render;
    # default-deny would sever the internal-LB -> APISIX path and take the instance dark.
    netpols = {d["metadata"]["name"] for d in docs if d.get("kind") == "NetworkPolicy"}
    assert not netpols, f"expected no NetworkPolicies with NP off, got {sorted(netpols)}"
    assert "workload: app" not in rendered
    assert "workload: infra" not in rendered
    # Default mode apisix: internal LB, APISIX terminates on :443, no Ingress.
    apisix_svc = next(
        d for d in docs if d.get("kind") == "Service" and d["metadata"]["name"] == "t-data-assembly-apisix"
    )
    assert apisix_svc["spec"]["type"] == "LoadBalancer"
    assert (
        apisix_svc["metadata"]["annotations"][
            "service.beta.kubernetes.io/azure-load-balancer-internal"
        ]
        == "true"
    )
    assert {p["port"] for p in apisix_svc["spec"]["ports"]} == {80, 443}
    assert "loadBalancerIP" not in apisix_svc["spec"]
    assert not [d for d in docs if d.get("kind") == "Ingress"], "mode apisix must not create an Ingress"
    # the ssls-assembly init container carries the TLS cert into APISIX
    apisix_dep = next(
        d for d in docs if d.get("kind") == "Deployment" and d["metadata"]["name"] == "t-data-assembly-apisix"
    )
    inits = {c["name"] for c in apisix_dep["spec"]["template"]["spec"].get("initContainers", [])}
    assert "assemble-tls" in inits
    # The InvHub origin (*.invhub.fseng.net wildcard) reaches the routes ConfigMap,
    # and the flows Job exists.
    assert r"[^/]+\.invhub\.fseng\.net" in rendered
    assert any(
        d.get("kind") == "Job" and d["metadata"]["name"] == "t-data-assembly-keycloak-flows-integration"
        for d in docs
    )


def test_overlay_ingress_alternative_renders():
    """The documented mode-ingress alternative must render cleanly: a plain
    ClusterIP behind ingress-nginx (cert-manager ingress-shim), APISIX TLS off, no
    init container. Guards the header block so the alternative can never silently rot."""
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "-f", str(OVERLAY),
            "--set", "validation.allowPlaceholders=true",
            "--set", "infra.postgres.password=test-pg",
            # swap to the documented alternative
            "--set", "apisix.service.type=ClusterIP",
            "--set", "apisix.tls.mode=ingress",
            "--set", "apisix.tls.ingress.className=nginx",
            "--set", "apisix.tls.ingress.clusterIssuer=letsencrypt-production",
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    docs = [d for d in yaml.safe_load_all(r.stdout) if d]
    svc = next(d for d in docs if d.get("kind") == "Service" and d["metadata"]["name"] == "t-data-assembly-apisix")
    assert svc["spec"]["type"] == "ClusterIP"
    assert {p["port"] for p in svc["spec"]["ports"]} == {80}
    ing = next((d for d in docs if d.get("kind") == "Ingress"), None)
    assert ing is not None, "mode ingress must render an Ingress"
    assert ing["spec"]["rules"][0]["host"] == "assembly.invhub.fseng.net"
    assert (
        ing["metadata"]["annotations"]["cert-manager.io/cluster-issuer"]
        == "letsencrypt-production"
    )
    dep = next(d for d in docs if d.get("kind") == "Deployment" and d["metadata"]["name"] == "t-data-assembly-apisix")
    spec = dep["spec"]["template"]["spec"]
    assert "tls" not in {v["name"] for v in spec["volumes"]}
    assert "assemble-tls" not in {c["name"] for c in spec.get("initContainers", [])}
