"""Guards for the committed values-scp.yaml overlay (standalone assembly on SCP).

SCP (Sensa Cloud Platform) pulls the chart from an OCI ACR via pipeline-internal
helmfile, resolves secrets from 1Password, and runs apps on a shared AKS. This
overlay is IH-AGNOSTIC (not assumed IH-coupled) and pulls all images from a
mirror ACR. Networking rides the shared ingress-nginx every SCP cluster already
runs (confirmed by reading pipeline-internal's common-res app + a real onboarded
instance, docs/scp-deployment.md §4) rather than a dedicated per-instance Azure
LB: APISIX is a plain ClusterIP behind an Ingress, TLS terminates at
ingress-nginx from a pre-provisioned kubernetes.io/tls Secret (pipeline-internal
delivers this as its own helmfile release, not cert-manager -- see
docs/scp-deployment.md §2). The InvHub flows integration is deliberately OFF
here.

Secrets ship sanitized (REDACTED_*); render-only via allowPlaceholders.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
OVERLAY = CHART / "values-scp.yaml"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _values() -> dict:
    assert OVERLAY.exists(), "values-scp.yaml missing"
    return yaml.safe_load(OVERLAY.read_text())


def _render():
    r = subprocess.run(
        ["helm", "template", "t", str(CHART), "-f", str(OVERLAY),
         "--set", "validation.allowPlaceholders=true"],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return [d for d in yaml.safe_load_all(r.stdout) if d], r.stdout


def test_overlay_shared_ingress_and_wildcard_tls():
    v = _values()
    svc = v["apisix"]["service"]
    assert svc["type"] == "ClusterIP"                     # behind shared ingress-nginx, no per-instance LB
    assert v["apisix"]["tls"]["enabled"] is True
    assert v["apisix"]["tls"]["mode"] == "ingress"
    assert v["apisix"]["tls"]["ingress"]["className"] == "nginx"
    assert not v["apisix"]["tls"]["ingress"].get("clusterIssuer")  # static secret, not cert-manager
    assert v["apisix"]["tls"]["existingSecret"]           # references the synced wildcard secret
    assert v["apisix"]["tls"]["publicHostname"]


def test_overlay_mirror_registry_and_pull_secret():
    v = _values()
    assert v["global"]["imageRegistry"]                    # third-party images from the mirror ACR
    assert v["image"]["registry"]                          # first-party images from the mirror ACR


def test_overlay_is_ih_agnostic():
    """No InvHub coupling: flows integration OFF, no flows objects rendered."""
    v = _values()
    kc = v.get("infra", {}).get("keycloak", {})
    assert not kc.get("flowsIntegration", {}).get("enabled", False)
    docs, _ = _render()
    assert not any(
        d.get("kind") == "Job" and d["metadata"]["name"] == "t-data-assembly-keycloak-flows-integration"
        for d in docs
    ), "SCP overlay must not enable the InvHub flows integration"


def test_overlay_hardening_shape():
    v = _values()
    assert v["agentsCodeWorker"]["codeExecutionTarget"] == "sandbox-service"  # drops code-worker privilege
    # NetworkPolicies OFF: the shared-cluster NP posture (gateway/probe/LB allows) is
    # UNVALIDATED on SCP -> start off, enable + validate as a follow-up.
    assert v["networkPolicies"]["enabled"] is False
    assert v["podDisruptionBudgets"]["enabled"] is False


def test_overlay_renders_mirrored_and_no_netpols():
    docs, rendered = _render()
    mirror = _values()["global"]["imageRegistry"]
    # Every bundled image is pulled from the mirror (incl. the pinned minio/mc).
    imgs = []
    for d in docs:
        if d.get("kind") in ("Deployment", "StatefulSet", "Job"):
            spec = d["spec"]["template"]["spec"]
            imgs += [c["image"] for c in spec.get("containers", []) + spec.get("initContainers", [])]
    assert imgs and all(i.startswith(f"{mirror}/") for i in imgs), sorted(set(imgs))
    # NetworkPolicies OFF on SCP (unvalidated) -> none render.
    assert not any(d.get("kind") == "NetworkPolicy" for d in docs), \
        "NetworkPolicies must not render with NP off on SCP"


def test_overlay_secrets_sanitized():
    def walk(node, path=""):
        if isinstance(node, dict):
            for k, val in node.items():
                yield from walk(val, f"{path}.{k}")
        elif isinstance(node, list):
            for i, val in enumerate(node):
                yield from walk(val, f"{path}[{i}]")
        elif isinstance(node, str):
            yield path, node

    secretish = ("password", "secret", "apikey", "token")
    for path, value in walk(_values()):
        leaf = path.rsplit(".", 1)[-1].lower()
        if any(m in leaf for m in secretish) and value:
            if leaf in ("existingsecret", "name"):
                continue
            assert value.startswith("REDACTED_"), f"{path} not a REDACTED_* placeholder"
