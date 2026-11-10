"""The components demo needs, which the chart could not express before.

Demo runs from hand-applied manifests, so these existed only there. Each is opt-in —
a default install renders none of them — because each carries a cost the default
install should not pay: an extra pooler hop, an unauthenticated UI, or 101 Service
ports. The assertions below pin both halves: absent by default, correct when enabled.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
FERNET = "StCYwnX1kEcds8ZDSRQCcXhSI9oLwuDUcErahChyT-s="

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

BASE = [
    "--set", "validation.allowPlaceholders=true",
    "--set", "infra.enabled=true",
    "--set", "infra.postgres.password=pw",
    "--set", "infra.keycloak.adminPassword=kc",
    "--set", f"secrets.fernetKey={FERNET}",
]


def _docs(*extra: str):
    r = subprocess.run(
        ["helm", "template", "t", str(CHART), *BASE, *extra], capture_output=True, text=True
    )
    assert r.returncode == 0, r.stderr
    return [d for d in yaml.safe_load_all(r.stdout) if d]


def _by(docs, kind, name):
    return next((d for d in docs if d.get("kind") == kind and d["metadata"]["name"] == name), None)


# --- pgbouncer ---------------------------------------------------------------

def test_pgbouncer_absent_by_default():
    docs = _docs()
    assert _by(docs, "Deployment", "t-data-assembly-pgbouncer") is None
    assert _by(docs, "Service", "t-data-assembly-pgbouncer") is None


def test_pgbouncer_renders_and_reads_the_postgres_secret():
    docs = _docs("--set", "infra.pgbouncer.enabled=true")
    dep = _by(docs, "Deployment", "t-data-assembly-pgbouncer")
    assert dep is not None
    env = {e["name"]: e for e in dep["spec"]["template"]["spec"]["containers"][0]["env"]}
    # Credentials come from the same Secret infra.yaml uses — never inlined values.
    for key in ("DB_USER", "DB_PASSWORD"):
        assert env[key]["valueFrom"]["secretKeyRef"]["name"] == "postgres-secret"
    assert env["DB_HOST"]["value"] == "t-data-assembly-postgres"
    assert env["POOL_MODE"]["value"] == "transaction"
    svc = _by(docs, "Service", "t-data-assembly-pgbouncer")
    assert [p["port"] for p in svc["spec"]["ports"]] == [6432]


def test_pgbouncer_does_not_repoint_services():
    """Enabling the pooler must not silently move traffic onto it.

    transaction pooling breaks session state (asyncpg prepared statements), so
    repointing is a deliberate per-service DSN change, not a side effect of this flag.
    """
    docs = _docs("--set", "infra.pgbouncer.enabled=true")
    core = _by(docs, "Deployment", "t-data-assembly-core")
    env = {e["name"]: e for e in core["spec"]["template"]["spec"]["containers"][0]["env"]}
    ref = env.get("POSTGRES_URL") or env.get("DATABASE_URL")
    # Still sourced from the platform Secret (which points at postgres), not pgbouncer.
    assert ref is None or "valueFrom" in ref


# --- temporal-ui -------------------------------------------------------------

def test_temporal_ui_absent_by_default():
    assert _by(_docs(), "Deployment", "t-data-assembly-temporal-ui") is None


def test_temporal_ui_renders_but_is_not_routed_through_apisix():
    docs = _docs("--set", "infra.temporal.ui.enabled=true")
    assert _by(docs, "Deployment", "t-data-assembly-temporal-ui") is not None
    svc = _by(docs, "Service", "t-data-assembly-temporal-ui")
    assert svc["spec"]["type"] == "ClusterIP"
    # It ships no auth of its own — no gateway route may expose it.
    routes = _by(docs, "ConfigMap", "t-data-assembly-apisix-routes")
    assert "temporal-ui" not in routes["data"]["apisix-routes.yaml"]


# --- mcp-hub dynamic ports ---------------------------------------------------

def test_mcp_dynamic_ports_absent_by_default():
    svc = _by(_docs(), "Service", "t-data-assembly-mcp-hub")
    assert [p["port"] for p in svc["spec"]["ports"]] == [8011]


def test_mcp_dynamic_ports_enumerate_the_range_inclusively():
    docs = _docs(
        "--set", "mcpHub.dynamicPorts.enabled=true",
        "--set", "mcpHub.dynamicPorts.from=9000",
        "--set", "mcpHub.dynamicPorts.to=9003",
    )
    ports = [p["port"] for p in _by(docs, "Service", "t-data-assembly-mcp-hub")["spec"]["ports"]]
    assert ports == [8011, 9000, 9001, 9002, 9003], ports


# --- file-search S3 + keycloak backend client secret -------------------------

def test_file_search_s3_defaults_to_the_bundled_minio_credentials():
    docs = _docs(
        "--set", "minio.enabled=true",
        "--set", "minio.rootUser=miniouser",
        "--set", "minio.rootPassword=miniopass",
    )
    data = _by(docs, "Secret", "platform-secrets")["stringData"]
    assert data["file-search-s3-access-key"] == "miniouser"
    assert data["file-search-s3-secret-key"] == "miniopass"


def test_explicit_file_search_credentials_win_over_minio():
    docs = _docs(
        "--set", "minio.enabled=true",
        "--set", "minio.rootUser=miniouser",
        "--set", "secrets.fileSearch.s3AccessKey=externalkey",
    )
    data = _by(docs, "Secret", "platform-secrets")["stringData"]
    assert data["file-search-s3-access-key"] == "externalkey"


def test_keycloak_backend_client_secret_only_when_set():
    assert "keycloak-backend-client-secret" not in _by(_docs(), "Secret", "platform-secrets")["stringData"]
    docs = _docs("--set", "secrets.keycloakBackendClientSecret=shh")
    assert "keycloak-backend-client-secret" in _by(docs, "Secret", "platform-secrets")["stringData"]


# --- application database name -----------------------------------------------

def test_database_name_defaults_to_workflows_db():
    docs = _docs()
    dsns = {
        line.split("postgres:5432/")[1].split()[0].strip("\"'")
        for d in docs if d.get("kind") == "Secret" and d["metadata"]["name"] == "platform-secrets"
        for line in [d["stringData"].get("database-url", "")] if "postgres:5432/" in line
    }
    assert dsns == {"workflows_db"}, dsns


def test_database_name_is_configurable():
    """Demo's data lives in assembly_db; a deploy pointed at the default name would
    come up against an EMPTY database rather than fail, so this must be a knob."""
    docs = _docs("--set", "infra.postgres.databaseName=assembly_db")
    sec = _by(docs, "Secret", "platform-secrets")["stringData"]["database-url"]
    assert sec.endswith("/assembly_db"), sec
    # postgres-init must create the same database it is pointed at
    init = _by(docs, "Job", "t-data-assembly-postgres-init")
    script = yaml.dump(init["spec"]["template"]["spec"])
    assert "CREATE DATABASE assembly_db" in script
    assert "workflows_db" not in script
