"""Guard the singleton infra-tier pod spread (#1606).

Real incident: assembly-perf-medium's 2nd infra node (added by PR #1594) sat at 19% memory while
ALL FIVE singleton infra Deployments (postgres, postgres-temporal, redis, keycloak, minio) stayed
on the original node at 96%+ -- Kubernetes never proactively reschedules an already-Running pod
just because a new node joins the pool, so the shared nodeSelector alone never fixed the imbalance.
kubelet evicted postgres-temporal (the durable Temporal DB) twice under routine load as a direct
result. Fix: soft (preferred, not required) mutual podAntiAffinity so a future rollout actually
spreads these 5 pods, gated by scheduling.infraSingletonSpread.enabled (off by default, on for the
perf overlay).
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
    "--set", "infra.postgresTemporal.enabled=true",
    "--set", "minio.enabled=true",
]

SINGLETON_DEPLOYMENTS = ["t-data-assembly-postgres", "t-data-assembly-postgres-temporal", "t-data-assembly-redis", "t-data-assembly-keycloak", "t-data-assembly-minio"]


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


def test_spread_disabled_by_default_no_render_change():
    r = _render()
    assert r.returncode == 0, r.stderr
    assert "infra-singleton" not in r.stdout


def test_enabling_spread_does_not_crash_the_render():
    r = _render("--set", "scheduling.infraSingletonSpread.enabled=true")
    assert r.returncode == 0, r.stderr


def test_all_five_singletons_get_soft_anti_affinity():
    r = _render("--set", "scheduling.infraSingletonSpread.enabled=true")
    assert r.returncode == 0, r.stderr
    for name in SINGLETON_DEPLOYMENTS:
        doc = _deployment_doc(r.stdout, name)
        assert "infra-singleton: \"true\"" in doc, f"{name} missing the spread label"
        assert "podAntiAffinity" in doc, f"{name} missing podAntiAffinity"
        assert "preferredDuringSchedulingIgnoredDuringExecution" in doc, (
            f"{name} anti-affinity must be soft (preferred), not hard -- only 2 infra nodes exist "
            "on the small/medium tiers for 5 singleton pods, a hard constraint would strand pods "
            "Pending once the first node fills past 2-3 of them"
        )


def test_no_other_deployments_get_the_spread_label():
    # Scoped fix: app-tier and split-Temporal pods must NOT get this anti-affinity -- they're
    # stateless and already spread fine via normal scheduling; adding this everywhere would dilute
    # the signal and could fight with existing topology spread constraints.
    r = _render("--set", "scheduling.infraSingletonSpread.enabled=true",
                "--set", "infra.temporal.mode=split")
    assert r.returncode == 0, r.stderr
    # 2 occurrences per singleton Deployment: once as the pod's own label, once again as the
    # podAntiAffinity's labelSelector match value.
    assert r.stdout.count('infra-singleton: "true"') == 2 * len(SINGLETON_DEPLOYMENTS)
