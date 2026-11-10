"""Guards for the values-driven Keycloak "flows integration" provisioning.

InvHub calls assembly through a fixed ROPC contract: client_id=workflow-canvas
(public, directAccessGrants) plus the realm user invhub_service_user@symphonyai.com,
whose password is shared with InvHub's `flows` Secret. The chart must provision both
on EVERY path:

  * fresh install -> client + user IDENTITY injected into the keycloak-realm seed
                     JSON (--import-realm), never the password: that seed renders
                     into a ConfigMap, which is not a secret store.
  * every path    -> the post-install/post-upgrade kcadm reconcile Job
                     (keycloak-flows-integration) sets the password (secretKeyRef)
                     and the realm role, and converges the client -- because
                     --import-realm is a NO-OP once the realm exists in Postgres
                     (observed drifting on dev-assembly).

Both paths render from the same aw.keycloak.* helpers so they cannot drift, and the
password may only ever reach a pod as a secretKeyRef.
"""

import json
import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
FERNET = "StCYwnX1kEcds8ZDSRQCcXhSI9oLwuDUcErahChyT-s="
TEST_PW = "Sup3r-Secret-Flows-Pw"
ORIGIN = "https://copilot.invhub.example"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

# infra.enabled defaults to false and gates the whole Keycloak stack (realm
# ConfigMap included); infra.postgres.password is `required` once enabled.
INFRA_ON = [
    "--set", "infra.enabled=true",
    "--set", "infra.postgres.password=test-pg",
]

FLOWS_ENABLED = [
    "--set", "infra.keycloak.flowsIntegration.enabled=true",
    "--set", f"secrets.invhubServiceUserPassword={TEST_PW}",
    "--set", f"infra.keycloak.flowsIntegration.webOrigins[0]={ORIGIN}",
]

# Mirrors test_temporal_config_checksum.py: everything the fail-closed
# validation requires, for renders WITHOUT validation.allowPlaceholders.
REQUIRED_SECRETS = [
    "--set", "secrets.bootstrapAdminPassword=Str0ng-Boot-Pw",
    "--set", "infra.keycloak.adminPassword=Str0ng-KC-Pw",
    "--set", "infra.postgres.password=dev-pg",
    "--set", "infra.postgresTemporal.password=dev-pg-temporal",
    "--set", "secrets.keycloakAdminPassword=dev-kc",
    "--set", "secrets.postgresPassword=dev-pg",
    "--set", "secrets.temporalPassword=dev-temporal",
    "--set", "secrets.jwtSecret=dev-jwt",
    "--set", f"secrets.fernetKey={FERNET}",
    "--set", "secrets.internalServiceApiKey=dev-internal",
    "--set", "secrets.sandboxInternalServiceApiKey=dev-sandbox",
    "--set", "secrets.workspaceManagerInternalServiceApiKey=dev-wm",
    "--set", "secrets.llmGateway.userKeysInternalApiKey=dev-ukey",
    "--set", "secrets.llmGateway.adminKey=dev-admin",
    "--set", "infra.enabled=true",
]


def _template(*extra_args: str, allow_placeholders: bool = True) -> subprocess.CompletedProcess:
    args = ["helm", "template", "t", str(CHART)]
    if allow_placeholders:
        args += ["--set", "validation.allowPlaceholders=true"]
    args += list(extra_args)
    return subprocess.run(args, capture_output=True, text=True)


def _docs(*extra_args: str) -> list[dict]:
    r = _template(*INFRA_ON, *extra_args)
    assert r.returncode == 0, r.stderr
    return [d for d in yaml.safe_load_all(r.stdout) if d]


def _doc(docs: list[dict], kind: str, name: str) -> dict | None:
    for doc in docs:
        if doc.get("kind") == kind and doc["metadata"]["name"] == name:
            return doc
    return None


def _realm(docs: list[dict]) -> dict:
    cm = _doc(docs, "ConfigMap", "t-data-assembly-keycloak-realm")
    assert cm is not None, "keycloak-realm ConfigMap not rendered"
    return json.loads(cm["data"]["realm-export.json"])


def _client(realm: dict, client_id: str) -> dict | None:
    matches = [c for c in realm["clients"] if c["clientId"] == client_id]
    assert len(matches) <= 1
    return matches[0] if matches else None


def test_flows_client_and_user_seeded_when_enabled():
    realm = _realm(_docs(*FLOWS_ENABLED))

    client = _client(realm, "workflow-canvas")
    assert client is not None, "workflow-canvas client missing from realm seed"
    assert client["publicClient"] is True
    assert client["directAccessGrantsEnabled"] is True
    # ROPC-only: no redirect URIs, standard flow off (tighter than a kcadm
    # default-created client; the reconcile Job converges live realms to this).
    assert client["standardFlowEnabled"] is False
    assert client["redirectUris"] == []
    assert ORIGIN in client["webOrigins"]

    users = [u for u in realm["users"] if u["username"] == "invhub_service_user@symphonyai.com"]
    assert len(users) == 1, "invhub_service_user missing from realm seed"
    user = users[0]
    # WEBHOOK_RUN_ALLOWLIST matches the token's email claim -> the user MUST
    # carry a verified email (the realm is email-as-username).
    assert user["email"] == "invhub_service_user@symphonyai.com"
    assert user["emailVerified"] is True
    assert user["enabled"] is True
    # withPassword=false: the realm-import creates the user WITHOUT credentials or
    # realm roles — the keycloak-flows-integration Job seeds the password (kcadm
    # set-password from a secretKeyRef) and adds the "user" role after import, so
    # the credential never lands in this (plaintext, broadly-readable) ConfigMap.
    assert "credentials" not in user, "flows password must NOT be embedded in the realm-import ConfigMap"
    assert "realmRoles" not in user, "flows realm role is added by the Job, not the realm import"


def test_realm_json_parses_with_flows_and_public_hostname():
    """The flows members are appended with conditional commas -- guard that the
    JSON stays valid in the fullest configuration (flows + TLS hostname)."""
    realm = _realm(_docs(*FLOWS_ENABLED, "--set", "apisix.tls.publicHostname=assembly.example.net"))
    frontend = _client(realm, "assembly-platform-frontend")
    assert "https://assembly.example.net/*" in frontend["redirectUris"]
    assert _client(realm, "workflow-canvas") is not None


def test_job_rendered_with_hooks_and_secret_refs():
    docs = _docs(*FLOWS_ENABLED)
    job = _doc(docs, "Job", "t-data-assembly-keycloak-flows-integration")
    assert job is not None, "keycloak-flows-integration Job not rendered when enabled"

    annotations = job["metadata"]["annotations"]
    assert annotations["helm.sh/hook"] == "post-install,post-upgrade"
    assert annotations["helm.sh/hook-weight"] == "5"
    assert annotations["helm.sh/hook-delete-policy"] == "before-hook-creation,hook-succeeded"

    container = job["spec"]["template"]["spec"]["containers"][0]
    env = {e["name"]: e for e in container["env"]}
    for name in ("KC_ADMIN_PASSWORD", "FLOWS_USER_PASSWORD"):
        ref = env[name].get("valueFrom", {}).get("secretKeyRef", {})
        assert ref.get("name") == "t-data-assembly-keycloak-secret", f"{name} must come from t-data-assembly-keycloak-secret"
        assert "value" not in env[name], f"{name} must never be an inline value"
    # The secret value must not leak anywhere into the Job manifest itself.
    assert TEST_PW not in yaml.safe_dump(job)


def test_job_absent_by_default():
    assert _doc(_docs(), "Job", "t-data-assembly-keycloak-flows-integration") is None


def test_keycloak_secret_gets_flows_key_only_when_enabled():
    enabled = _doc(_docs(*FLOWS_ENABLED), "Secret", "t-data-assembly-keycloak-secret")
    assert enabled["stringData"]["invhub-service-user-password"] == TEST_PW
    default = _doc(_docs(), "Secret", "t-data-assembly-keycloak-secret")
    assert "invhub-service-user-password" not in default.get("stringData", {})


def test_flows_password_and_infra_validation():
    """Fail-closed validation (only active without allowPlaceholders)."""
    # Enabled without a password -> hard fail naming the missing key.
    r = _template(
        *REQUIRED_SECRETS,
        "--set", "infra.keycloak.flowsIntegration.enabled=true",
        allow_placeholders=False,
    )
    assert r.returncode != 0
    assert "invhubServiceUserPassword" in r.stderr

    # Enabled against external infra -> hard fail (the seed + Job only manage
    # the in-chart Keycloak). infra.enabled=false comes last so it wins.
    r = _template(
        *REQUIRED_SECRETS,
        *FLOWS_ENABLED,
        "--set", "infra.enabled=false",
        allow_placeholders=False,
    )
    assert r.returncode != 0
    assert "infra.enabled" in r.stderr


def test_default_realm_json_unchanged():
    """Backwards-compat: with flowsIntegration off, the realm seed must keep
    exactly today's clients and users, and workflow-canvas must not appear
    anywhere in the render."""
    r = _template(*INFRA_ON)
    assert r.returncode == 0, r.stderr
    realm = _realm([d for d in yaml.safe_load_all(r.stdout) if d])
    assert [c["clientId"] for c in realm["clients"]] == [
        "assembly-platform-backend",
        "assembly-platform-frontend",
    ]
    assert [u["username"] for u in realm["users"]] == ["admin@assembly.dev"]
    assert "workflow-canvas" not in r.stdout


@pytest.mark.parametrize("hostname", [None, "assembly.example.net"])
def test_seed_frontend_lists_stable(hostname):
    """Lock the seed's redirect/webOrigins/post-logout lists to today's exact
    values (with and without apisix.tls.publicHostname) so refactoring them
    through shared helpers stays a semantic no-op."""
    args = []
    expected_redirects = [
        "http://localhost/*",
        "http://localhost:9080/*",
        "https://*.app.github.dev/*",
    ]
    expected_origins = [
        "http://localhost",
        "http://localhost:9080",
        "https://*.app.github.dev",
    ]
    # post.logout.redirect.uris is a single `##`-delimited string (Keycloak splits on
    # "##", never ","); see fc18fb15 / test_apisix_keycloak_header_buffer.py. redirectUris
    # and webOrigins remain real JSON arrays.
    expected_post_logout = "http://localhost/*##http://localhost:9080/*##https://*.app.github.dev/*"
    if hostname:
        args = ["--set", f"apisix.tls.publicHostname={hostname}"]
        expected_redirects = expected_redirects + [f"https://{hostname}/*"]
        expected_origins = expected_origins + [f"https://{hostname}"]
        expected_post_logout += f"##https://{hostname}/*"

    realm = _realm(_docs(*args))
    for client_id in ("assembly-platform-backend", "assembly-platform-frontend"):
        client = _client(realm, client_id)
        assert client["redirectUris"] == expected_redirects, client_id
        assert client["webOrigins"] == expected_origins, client_id
    frontend = _client(realm, "assembly-platform-frontend")
    assert frontend["attributes"]["post.logout.redirect.uris"] == expected_post_logout
    assert frontend["attributes"]["pkce.code.challenge.method"] == "S256"


def test_flows_job_pod_not_selected_by_keycloak_service():
    """The flows Job pod must NOT match the keycloak Service selector.

    The Job pod has no readiness probe, so while it runs it counts Ready; if its
    labels satisfy the keycloak Service selector it is enrolled as a keycloak
    Service endpoint and kube-proxy load-balances real auth traffic to it on
    :8080 where nothing listens -> intermittent "connection refused" for every
    keycloak client, platform-wide (observed on dev-assembly during the rev-8
    upgrade; the flows converge Job could not even reach keycloak itself).
    Regression guard for the app:keycloak label collision.
    """
    docs = _docs(*FLOWS_ENABLED)
    svc = _doc(docs, "Service", "t-data-assembly-keycloak")
    assert svc is not None, "keycloak Service not rendered"
    selector = svc["spec"]["selector"]
    assert selector, "keycloak Service has no selector to guard against"

    job = _doc(docs, "Job", "t-data-assembly-keycloak-flows-integration")
    pod_labels = job["spec"]["template"]["metadata"]["labels"]
    # A pod is selected by a Service iff EVERY selector key/value is present on
    # the pod. The flows Job pod must fail that test.
    assert not all(pod_labels.get(k) == v for k, v in selector.items()), (
        f"flows Job pod labels {pod_labels} satisfy the keycloak Service "
        f"selector {selector} -> the pod is enrolled as a keycloak endpoint"
    )
