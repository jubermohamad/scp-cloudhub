"""Guards for the two APISIX TLS termination modes (apisix.tls.mode).

The chart no longer inlines TLS material into the routes ConfigMap via a
`lookup` (helm template != helm upgrade, private key in a ConfigMap). Instead:

  * mode "apisix"  — APISIX terminates TLS on :443, serving `existingSecret`
                     mounted at its default cert path. For standalone clusters
                     (our dev AKS, SCP) with no shared ingress-nginx.
  * mode "ingress" — an ingress-nginx Ingress (optionally cert-manager-issued)
                     terminates TLS and forwards plain HTTP; APISIX runs with
                     TLS off behind it. For clusters that already run
                     ingress-nginx + cert-manager (assembly next to InvHub).

These render against no cluster, so every assertion is structural.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
VALUES = CHART / "values.yaml"
ROUTES_TPL = CHART / "templates" / "configmap-apisix-routes.yaml"
FERNET = "StCYwnX1kEcds8ZDSRQCcXhSI9oLwuDUcErahChyT-s="

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

REQUIRED_SECRETS = [
    "--set", "secrets.jwtSecret=dev-jwt",
    "--set", f"secrets.fernetKey={FERNET}",
    "--set", "secrets.internalServiceApiKey=dev-internal",
    "--set", "secrets.sandboxInternalServiceApiKey=dev-sandbox",
    "--set", "secrets.workspaceManagerInternalServiceApiKey=dev-wm",
    "--set", "secrets.llmGateway.userKeysInternalApiKey=dev-ukey",
    "--set", "secrets.llmGateway.adminKey=dev-admin",
]


def _template(*extra: str, allow_placeholders: bool = True) -> subprocess.CompletedProcess:
    args = ["helm", "template", "t", str(CHART)]
    if allow_placeholders:
        args += ["--set", "validation.allowPlaceholders=true"]
    args += list(extra)
    return subprocess.run(args, capture_output=True, text=True)


def _docs(*extra: str) -> list[dict]:
    r = _template(*extra)
    assert r.returncode == 0, r.stderr
    return [d for d in yaml.safe_load_all(r.stdout) if d]


def _doc(docs, kind, name):
    for d in docs:
        if d.get("kind") == kind and d["metadata"]["name"] == name:
            return d
    return None


def _apisix_ssl_enabled(docs) -> bool:
    cm = _doc(docs, "ConfigMap", "t-data-assembly-apisix-config")
    assert cm is not None, "apisix-config ConfigMap missing"
    inner = yaml.safe_load(cm["data"]["config.yaml"])
    return inner["apisix"]["ssl"]["enable"]


APISIX_ON = [
    "--set", "apisix.tls.enabled=true",
    "--set", "apisix.tls.mode=apisix",
    "--set", "apisix.tls.publicHostname=assembly.example.net",
]
INGRESS_ON = [
    "--set", "apisix.tls.enabled=true",
    "--set", "apisix.tls.mode=ingress",
    "--set", "apisix.tls.publicHostname=assembly.example.net",
    "--set", "apisix.tls.ingress.clusterIssuer=letsencrypt-production",
]


# --- static source + values guards ------------------------------------------

def test_values_defaults():
    tls = yaml.safe_load(VALUES.read_text())["apisix"]["tls"]
    assert tls["enabled"] is False
    assert tls["mode"] == "apisix"
    assert tls["existingSecret"] == "apisix-tls"


def test_routes_configmap_never_inlines_tls():
    """The old lookup+inline workaround must be gone: no cluster lookup and no
    cert/key ever baked into the routes ConfigMap template."""
    src = ROUTES_TPL.read_text()
    assert 'lookup "v1" "Secret"' not in src  # the cluster lookup call itself
    assert "b64dec" not in src
    assert "tls.key" not in src
    assert "BEGIN CERTIFICATE" not in src


# --- default (TLS off) ------------------------------------------------------

def test_tls_off_by_default():
    docs = _docs()
    assert _apisix_ssl_enabled(docs) is False
    svc = _doc(docs, "Service", "t-data-assembly-apisix")
    assert {p["port"] for p in svc["spec"]["ports"]} == {80}
    assert _doc(docs, "Ingress", "t-data-assembly-apisix") is None
    dep = _doc(docs, "Deployment", "t-data-assembly-apisix")
    vols = {v["name"] for v in dep["spec"]["template"]["spec"]["volumes"]}
    assert "tls" not in vols


# --- mode apisix ------------------------------------------------------------

def test_mode_apisix_terminates_locally():
    docs = _docs(*APISIX_ON, "--set", "apisix.tls.existingSecret=my-tls")
    assert _apisix_ssl_enabled(docs) is True

    svc = _doc(docs, "Service", "t-data-assembly-apisix")
    assert {p["port"] for p in svc["spec"]["ports"]} == {80, 443}

    # No ingress-nginx object in this mode.
    assert _doc(docs, "Ingress", "t-data-assembly-apisix") is None

    dep = _doc(docs, "Deployment", "t-data-assembly-apisix")
    spec = dep["spec"]["template"]["spec"]
    vols = {v["name"]: v for v in spec["volumes"]}
    # the TLS Secret is mounted, and an emptyDir holds the assembled apisix.yaml
    assert vols["tls"]["secret"]["secretName"] == "my-tls"
    assert "emptyDir" in vols["generated"]

    # APISIX rejects a handshake whose SNI isn't in `ssls`, and a cert at the
    # default path is NOT enough (verified) -- so an init-container splices the
    # mounted Secret's cert/key into `ssls: []` at startup.
    inits = {c["name"]: c for c in spec.get("initContainers", [])}
    assert "assemble-tls" in inits, "mode apisix needs the ssls-assembly init container"
    init = inits["assemble-tls"]
    script = " ".join(init["command"])
    assert "ssls: []" in script and "/tls/tls.crt" in script and "/tls/tls.key" in script
    im = {m["name"]: m["mountPath"] for m in init["volumeMounts"]}
    assert im["tls"] == "/tls" and im["generated"] == "/generated"

    # the main container reads the ASSEMBLED apisix.yaml (from the emptyDir), not
    # the raw routes ConfigMap
    main = spec["containers"][0]
    ax = next(
        m for m in main["volumeMounts"]
        if m["mountPath"] == "/usr/local/apisix/conf/apisix.yaml"
    )
    assert ax["name"] == "generated" and ax["subPath"] == "apisix.yaml"


def test_mode_apisix_routes_configmap_has_no_cert_material():
    docs = _docs(*APISIX_ON)
    cm = _doc(docs, "ConfigMap", "t-data-assembly-apisix-routes")
    body = cm["data"]["apisix-routes.yaml"]
    assert "ssls: []" in body
    assert "BEGIN CERTIFICATE" not in body
    assert "PRIVATE KEY" not in body


# --- mode ingress -----------------------------------------------------------

def test_mode_ingress_offloads_to_nginx():
    docs = _docs(*INGRESS_ON, "--set", "apisix.tls.existingSecret=my-tls")
    # APISIX stays plain HTTP.
    assert _apisix_ssl_enabled(docs) is False
    svc = _doc(docs, "Service", "t-data-assembly-apisix")
    assert {p["port"] for p in svc["spec"]["ports"]} == {80}
    dep = _doc(docs, "Deployment", "t-data-assembly-apisix")
    assert "tls" not in {v["name"] for v in dep["spec"]["template"]["spec"]["volumes"]}

    ing = _doc(docs, "Ingress", "t-data-assembly-apisix")
    assert ing is not None, "mode ingress must render an Ingress"
    assert ing["spec"]["ingressClassName"] == "nginx"
    assert ing["spec"]["rules"][0]["host"] == "assembly.example.net"
    backend = ing["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]
    assert backend["name"] == "t-data-assembly-apisix" and backend["port"]["number"] == 80
    assert ing["spec"]["tls"][0]["secretName"] == "my-tls"
    ann = ing["metadata"]["annotations"]
    assert ann["cert-manager.io/cluster-issuer"] == "letsencrypt-production"
    assert ann["nginx.ingress.kubernetes.io/ssl-redirect"] == "true"
    # Body cap must match APISIX's 64m so ingress-nginx doesn't 413 large uploads.
    assert ann["nginx.ingress.kubernetes.io/proxy-body-size"] == "64m"


def test_mode_ingress_without_issuer_has_no_certmanager_annotation():
    docs = _docs(
        "--set", "apisix.tls.enabled=true",
        "--set", "apisix.tls.mode=ingress",
        "--set", "apisix.tls.publicHostname=assembly.example.net",
    )
    ing = _doc(docs, "Ingress", "t-data-assembly-apisix")
    assert ing is not None
    assert "cert-manager.io/cluster-issuer" not in ing["metadata"]["annotations"]


def test_ingress_annotations_are_overridable():
    docs = _docs(
        *INGRESS_ON,
        "--set", "apisix.tls.ingress.annotations.nginx\\.ingress\\.kubernetes\\.io/proxy-body-size=200m",
    )
    ing = _doc(docs, "Ingress", "t-data-assembly-apisix")
    assert ing["metadata"]["annotations"]["nginx.ingress.kubernetes.io/proxy-body-size"] == "200m"


# --- validation (fail-closed, only without allowPlaceholders) ---------------

def test_validation_rejects_bad_mode():
    r = _template(*REQUIRED_SECRETS,
                  "--set", "apisix.tls.enabled=true",
                  "--set", "apisix.tls.mode=bogus",
                  "--set", "apisix.tls.publicHostname=x.example.net",
                  allow_placeholders=False)
    assert r.returncode != 0
    assert "apisix.tls.mode" in r.stderr


def test_validation_requires_public_hostname():
    r = _template(*REQUIRED_SECRETS,
                  "--set", "apisix.tls.enabled=true",
                  "--set", "apisix.tls.mode=apisix",
                  allow_placeholders=False)
    assert r.returncode != 0
    assert "publicHostname" in r.stderr


def test_validation_off_when_tls_disabled():
    # TLS disabled -> no mode/hostname required.
    r = _template(*REQUIRED_SECRETS, allow_placeholders=False)
    assert r.returncode == 0, r.stderr


# --- forwarded proto (mode-aware X-Forwarded-Proto) -------------------------

def _routes_body(docs) -> str:
    cm = _doc(docs, "ConfigMap", "t-data-assembly-apisix-routes")
    assert cm is not None, "apisix-routes ConfigMap missing"
    return cm["data"]["apisix-routes.yaml"]


def _forwarded_proto_values(docs) -> set[str]:
    """Every X-Forwarded-Proto value the gateway sets, quoting-agnostic."""
    return {
        line.split(":", 1)[1].strip().strip("\"'")
        for line in _routes_body(docs).splitlines()
        if "X-Forwarded-Proto:" in line
    }


def test_forwarded_proto_tls_off_uses_scheme():
    """No proxy in front => $http_x_forwarded_proto would be EMPTY.

    Regression guard: keying the header off "apisix does not terminate TLS" also caught
    the TLS-disabled case (perf clusters, plain-HTTP installs) and blanked the proto.
    """
    assert _forwarded_proto_values(_docs()) == {"$scheme"}


def test_forwarded_proto_apisix_mode_uses_scheme():
    # mode apisix terminates TLS itself, so $scheme is already https.
    assert _forwarded_proto_values(_docs(*APISIX_ON)) == {"$scheme"}


def test_forwarded_proto_ingress_mode_trusts_incoming_header():
    # Behind ingress-nginx (TLS terminated there, plain HTTP to APISIX) $scheme is
    # http; trusting the proxy's incoming X-Forwarded-Proto keeps it https, so
    # Keycloak (sslRequired=external) doesn't 403 "HTTPS required" and the issuer/
    # redirect URLs stay https. Regression guard for the ingress-mode login break.
    assert _forwarded_proto_values(_docs(*INGRESS_ON)) == {"$http_x_forwarded_proto"}
