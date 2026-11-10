"""Guards for explicit-only secret sourcing.

The chart is a pure function of values: every secret comes explicitly from
`.Values.secrets` (sourced at deploy from 1Password for persistent clusters, or
generated-and-passed by `deploy/bootstrap.sh` for throwaway perf clusters). The
chart no longer looks up or generates anything, so `helm template` == `helm
upgrade`, and empty required secrets fail render-time validation (unless
`validation.allowPlaceholders` for render-only, or `secrets.existingSecret`).

These tests lock that in: no `lookup`/`randAlphaNum`, provided values render
byte-for-byte, and every required key fails closed when empty.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
TPL = CHART / "templates"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

FERNET = "StCYwnX1kEcds8ZDSRQCcXhSI9oLwuDUcErahChyT-s="  # valid 44-char urlsafe-b64

# A minimal, fully-valid render: every value the fail-closed validation requires.
MINIMAL = [
    "--set", "infra.enabled=true",
    "--set", "infra.postgres.password=prov-pg",
    "--set", "infra.keycloak.adminPassword=prov-kc-admin",
    "--set", "secrets.bootstrapAdminPassword=prov-boot",
    "--set", "secrets.jwtSecret=prov-jwt",
    "--set", f"secrets.fernetKey={FERNET}",
    "--set", "secrets.internalServiceApiKey=prov-internal",
    "--set", "secrets.sandboxInternalServiceApiKey=prov-sandbox",
    "--set", "secrets.workspaceManagerInternalServiceApiKey=prov-wm",
    "--set", "secrets.llmGateway.userKeysInternalApiKey=prov-ukey",
    "--set", "secrets.llmGateway.adminKey=prov-admin",
]
# Full render: MINIMAL + optional provider keys + the flows integration.
PROVIDED = MINIMAL + [
    "--set", "secrets.azureFoundry.url=https://foundry.example",
    "--set", "secrets.azureFoundry.apiKey=prov-foundry-key",
    "--set", "infra.keycloak.flowsIntegration.enabled=true",
    "--set", "secrets.invhubServiceUserPassword=prov-flows",
]
# The keys that used to self-generate and are now fail-closed.
REQUIRED_INTERNAL_KEYS = [
    "secrets.internalServiceApiKey",
    "secrets.sandboxInternalServiceApiKey",
    "secrets.workspaceManagerInternalServiceApiKey",
    "secrets.llmGateway.userKeysInternalApiKey",
    "secrets.llmGateway.adminKey",
]


def _render(*extra, allow_placeholders=False):
    args = ["helm", "template", "t", str(CHART)]
    if allow_placeholders:
        args += ["--set", "validation.allowPlaceholders=true"]
    return subprocess.run(args + list(extra), capture_output=True, text=True)


def _docs(*extra, allow_placeholders=False):
    r = _render(*extra, allow_placeholders=allow_placeholders)
    assert r.returncode == 0, r.stderr
    return [d for d in yaml.safe_load_all(r.stdout) if d]


def _secret(docs, name):
    for d in docs:
        if d.get("kind") == "Secret" and d["metadata"]["name"] == name:
            return d["stringData"]
    raise AssertionError(f"Secret {name} not rendered")


# --- The chart is pure: no cluster lookup, no generation --------------------

def test_secrets_template_has_no_lookup_or_generation():
    """secrets.yaml renders straight from values — no `lookup` (so template ==
    upgrade) and no `randAlphaNum` (deterministic, so checksum/secrets can hash
    the rendered Secret)."""
    text = (TPL / "secrets.yaml").read_text()
    assert 'lookup "v1" "Secret"' not in text
    assert "randAlphaNum" not in text
    assert "b64dec" not in text


def test_infra_secret_render_has_no_lookup():
    """postgres-secret / keycloak-secret render from explicit values only."""
    text = (TPL / "infra.yaml").read_text()
    assert "get $pgCur" not in text
    assert "get $kcCur" not in text
    assert 'lookup "v1" "Secret" .Release.Namespace "postgres-secret"' not in text
    assert 'lookup "v1" "Secret" .Release.Namespace "keycloak-secret"' not in text


def test_postgres_url_derives_from_explicit_password_no_lookup():
    """aw.postgresUrl builds database-url from the explicit infra.postgres.password
    with no lookup (it self-healed from the live postgres-secret before)."""
    helpers = (TPL / "_helpers.tpl").read_text()
    pg_url_def = helpers.split('define "aw.postgresUrl"', 1)[1].split("{{- define", 1)[0]
    assert 'lookup "v1" "Secret"' not in pg_url_def
    assert ".Values.infra.postgres.password" in pg_url_def


# --- Provided values win byte-for-byte --------------------------------------

def test_provided_values_win_byte_for_byte():
    docs = _docs(*PROVIDED)
    platform = _secret(docs, "platform-secrets")
    assert platform["jwt-secret"] == "prov-jwt"
    assert platform["fernet-key"] == FERNET
    assert platform["internal-service-api-key"] == "prov-internal"
    assert platform["assembly-llm-gateway-admin-key"] == "prov-admin"
    assert platform["azure-foundry-url"] == "https://foundry.example"
    assert platform["azure-foundry-api-key"] == "prov-foundry-key"
    assert _secret(docs, "postgres-secret")["password"] == "prov-pg"
    kc = _secret(docs, "t-data-assembly-keycloak-secret")
    assert kc["admin-password"] == "prov-kc-admin"
    assert kc["invhub-service-user-password"] == "prov-flows"


def test_database_url_embeds_explicit_postgres_password():
    """database-url is derived from the explicit pg password, verbatim."""
    url = _secret(_docs(*PROVIDED), "platform-secrets")["database-url"]
    assert url == "postgresql+asyncpg://assembly:prov-pg@t-data-assembly-postgres:5432/workflows_db"


def test_llm_gateway_variants_inherit_base_when_unset():
    """Variant keys default to their base key (a values-level default, not a
    lookup) — mirrors capturing only the base key in 1Password."""
    p = _secret(_docs(*PROVIDED), "platform-secrets")
    assert p["assembly-llm-gateway-user-keys-internal-api-key-agents"] == "prov-ukey"
    assert p["assembly-llm-gateway-admin-key-autonomous-executor"] == "prov-admin"


# --- Fail closed on empty required secrets ----------------------------------

@pytest.mark.parametrize("key", REQUIRED_INTERNAL_KEYS)
def test_empty_internal_key_fails_closed(key):
    r = _render(*PROVIDED, "--set", f"{key}=")
    assert r.returncode != 0
    assert f"{key} is empty" in r.stderr


def test_empty_jwt_fails_closed():
    r = _render(*PROVIDED, "--set", "secrets.jwtSecret=")
    assert r.returncode != 0
    assert "secrets.jwtSecret is empty" in r.stderr


def test_empty_fernet_fails_closed():
    r = _render(*PROVIDED, "--set", "secrets.fernetKey=")
    assert r.returncode != 0
    assert "secrets.fernetKey is empty" in r.stderr


# --- Escape hatches still work ----------------------------------------------

def test_azure_foundry_omitted_when_unset():
    """Optional provider keys are absent unless explicitly set."""
    platform = _secret(_docs(*MINIMAL), "platform-secrets")
    assert "azure-foundry-url" not in platform
    assert "azure-foundry-api-key" not in platform


def test_allow_placeholders_lets_invhub_overlay_render():
    """values-invhub-dev ships runtime secrets as ref+op:// references; CI renders
    it for review with allowPlaceholders (which permits unresolved refs) + a
    postgres stub for the `required`. Without vals the ref passes through literally
    — proving vals is what turns it into a real secret at deploy."""
    docs = _docs(
        "-f", str(CHART / "values-invhub-dev.yaml"),
        "--set", "infra.postgres.password=stub",
        allow_placeholders=True,
    )
    assert _secret(docs, "platform-secrets")["jwt-secret"].startswith("ref+op://")
