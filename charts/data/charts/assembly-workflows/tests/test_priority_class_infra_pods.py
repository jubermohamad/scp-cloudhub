"""Guard that scheduling.priorityClasses.enabled actually attaches priorityClassName to
infra-tier AND app-tier pods, and that enabling it never crashes the render (#1282, #1600).

Real incident: assembly-perf-small's shared infra node hosted an unrelated foreign workload
with no priorityClassName; under memory pressure kubelet evicted the legitimate `temporal`
pod instead, because eviction ranking only considers requests-exceeded + usage when priority
is equal (both were effectively priority 0 -- the `platform-services` PriorityClass existed in
the chart but was never attached to any pod spec, a no-op even when enabled). Two separate
regressions are guarded here:

1. Before this fix, flipping `scheduling.priorityClasses.enabled: true` (as the perf overlay
   now does) crashed the render entirely: `.platformServices.value` was nil because no default
   for `platformServices` existed in values.yaml, so `| default 100` never got a chance to
   apply (Go template errors on a nil-pointer field access before evaluating a pipeline).
2. Even with the crash fixed, `priorityClassName` was never actually referenced by any pod
   spec -- enabling the flag created the PriorityClass object but attached it to nothing.
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
]

INFRA_DEPLOYMENTS = [
    "t-data-assembly-postgres", "t-data-assembly-redis", "t-data-assembly-keycloak", "t-data-assembly-postgres-temporal", "t-data-assembly-minio",
    "t-data-assembly-temporal-frontend", "t-data-assembly-temporal-history", "t-data-assembly-temporal-matching", "t-data-assembly-temporal-worker",
]

# #1600: app-tier pods (aw.scheduling) previously got no priorityClassName at all, unlike
# infra-tier's aw.infraScheduling -- a foreign workload sharing the app node pool with no
# priority had the same eviction advantage over these as it did over infra pods pre-#1597.
APP_TIER_DEPLOYMENTS = [
    "t-data-assembly-apisix", "t-data-assembly-core", "t-data-assembly-engine", "t-data-assembly-engine-worker",
    "t-data-assembly-engine-code-worker", "t-data-assembly-engine-subflow-worker",
    "t-data-assembly-llm-gateway", "t-data-assembly-mcp-hub", "t-data-assembly-sandbox-trigger",
    "t-data-assembly-sandbox-execute", "t-data-assembly-frontend",
]


def _render(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["helm", "template", "t", str(CHART), "--set", "infra.enabled=true",
         "--set", "infra.temporal.mode=split", "--set", "infra.postgresTemporal.enabled=true",
         "--set", "minio.enabled=true", "--set", "agentsSubflowWorker.enabled=true",
         *REQUIRED_SECRETS, *extra],
        capture_output=True, text=True,
    )


def test_priority_classes_disabled_by_default_no_render_change():
    r = _render()
    assert r.returncode == 0, r.stderr
    assert "priorityClassName: t-data-assembly-platform-services" not in r.stdout
    assert "kind: PriorityClass" not in r.stdout


def test_enabling_priority_classes_does_not_crash_the_render():
    # Regression guard for the nil-pointer bug: enabling the flag with no other
    # override used to fail with "nil pointer evaluating interface {}.value".
    r = _render("--set", "scheduling.priorityClasses.enabled=true")
    assert r.returncode == 0, r.stderr
    assert "nil pointer" not in r.stderr


def test_enabling_priority_classes_attaches_it_to_infra_pods():
    r = _render("--set", "scheduling.priorityClasses.enabled=true")
    assert r.returncode == 0, r.stderr
    for name in INFRA_DEPLOYMENTS:
        # Isolate this Deployment's own document to avoid false-passes from a
        # different resource earlier in the render.
        marker = f"\nkind: Deployment\nmetadata:\n  name: {name}\n"
        idx = r.stdout.find(marker)
        assert idx != -1, f"Deployment {name} not found in render"
        next_doc = r.stdout.find("\n---\n", idx)
        doc = r.stdout[idx:next_doc if next_doc != -1 else None]
        assert "priorityClassName: t-data-assembly-platform-services" in doc, (
            f"Deployment {name} missing priorityClassName despite priorityClasses.enabled=true"
        )


def test_enabling_priority_classes_attaches_it_to_app_tier_pods():
    r = _render("--set", "scheduling.priorityClasses.enabled=true")
    assert r.returncode == 0, r.stderr
    for name in APP_TIER_DEPLOYMENTS:
        marker = f"\nkind: Deployment\nmetadata:\n  name: {name}\n"
        idx = r.stdout.find(marker)
        assert idx != -1, f"Deployment {name} not found in render"
        next_doc = r.stdout.find("\n---\n", idx)
        doc = r.stdout[idx:next_doc if next_doc != -1 else None]
        assert "priorityClassName: t-data-assembly-platform-services" in doc, (
            f"Deployment {name} missing priorityClassName despite priorityClasses.enabled=true"
        )


def test_enabling_priority_classes_creates_the_priority_class_resource():
    r = _render("--set", "scheduling.priorityClasses.enabled=true")
    assert r.returncode == 0, r.stderr
    assert "kind: PriorityClass" in r.stdout
    assert "name: t-data-assembly-platform-services" in r.stdout


def test_custom_priority_value_is_honored():
    r = _render("--set", "scheduling.priorityClasses.enabled=true",
                "--set", "scheduling.priorityClasses.platformServices.value=250")
    assert r.returncode == 0, r.stderr
    assert "value: 250" in r.stdout
