"""Guard the dev-only no-surge rollout strategy.

assembly-aks-dev has enough steady-state capacity for the release, but not
enough headroom for Kubernetes' default rolling-update surge pods. The
rollout.noSurge flag is deliberately opt-in so normal clusters keep Kubernetes
defaults while dev frees old pod capacity before scheduling replacements.
"""

import pathlib
import shutil
import subprocess

import pytest

CHART = pathlib.Path(__file__).resolve().parents[1]
FERNET = "StCYwnX1kEcds8ZDSRQCcXhSI9oLwuDUcErahChyT-s="

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

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
    # Unique, non-default creds: minio.enabled=true here would otherwise trip the
    # render-time MinIO-default-credentials-forbidden check (values.yaml's
    # global.environment defaults to "production").
    "--set", "minio.rootUser=dev-minio-user",
    "--set", "minio.rootPassword=dev-minio-pass-not-default",
    "--set", "minio.image=minio/minio:RELEASE.2024-01-01T00-00-00Z",
    "--set", "minio.mcImage=minio/mc:RELEASE.2024-01-01T00-00-00Z",
    "--set", "infra.enabled=true",
    "--set", "infra.temporal.mode=split",
    "--set", "infra.postgresTemporal.enabled=true",
    "--set", "agentsSubflowWorker.enabled=true",
]

NO_SURGE_DEPLOYMENTS = [
    "t-data-assembly-apisix",
    "t-data-assembly-core",
    "t-data-assembly-engine",
    "t-data-assembly-engine-worker",
    "t-data-assembly-engine-subflow-worker",
    "t-data-assembly-llm-gateway",
    "t-data-assembly-frontend",
    "t-data-assembly-redis",
    "t-data-assembly-keycloak",
    "t-data-assembly-temporal-frontend",
    "t-data-assembly-temporal-history",
    "t-data-assembly-temporal-matching",
    "t-data-assembly-temporal-worker",
]

RECREATE_DEPLOYMENTS = ["t-data-assembly-postgres", "t-data-assembly-postgres-temporal", "t-data-assembly-minio"]


def _render(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["helm", "template", "t", str(CHART), *REQUIRED_SECRETS, *extra],
        capture_output=True, text=True,
    )


def _deployment_doc(rendered: str, name: str) -> str:
    marker = f"\nkind: Deployment\nmetadata:\n  name: {name}\n"
    idx = rendered.find(marker)
    assert idx != -1, f"Deployment {name} not found in render"
    end = rendered.find("\n---\n", idx)
    return rendered[idx:end if end != -1 else None]


def test_no_surge_disabled_by_default_does_not_stamp_strategy():
    r = _render()
    assert r.returncode == 0, r.stderr
    for name in NO_SURGE_DEPLOYMENTS:
        doc = _deployment_doc(r.stdout, name)
        assert "strategy:" not in doc, f"{name} should keep the default rollout strategy"


def test_no_surge_enabled_stamps_zero_surge_strategy():
    r = _render("--set", "rollout.noSurge=true")
    assert r.returncode == 0, r.stderr
    for name in NO_SURGE_DEPLOYMENTS:
        doc = _deployment_doc(r.stdout, name)
        assert "strategy:" in doc, f"{name} missing rollout strategy"
        assert "type: RollingUpdate" in doc, f"{name} must stay RollingUpdate"
        assert "maxSurge: 0" in doc, f"{name} must not create surge pods"
        assert "maxUnavailable: 1" in doc, f"{name} must free old capacity first"


def test_no_surge_does_not_override_recreate_deployments():
    r = _render("--set", "rollout.noSurge=true", "--set", "minio.enabled=true")
    assert r.returncode == 0, r.stderr
    for name in RECREATE_DEPLOYMENTS:
        doc = _deployment_doc(r.stdout, name)
        assert "type: Recreate" in doc, f"{name} must keep its Recreate strategy"
        assert "maxSurge: 0" not in doc, f"{name} should not get a second rollout strategy"
        assert "maxUnavailable: 1" not in doc, f"{name} should not get a second rollout strategy"
