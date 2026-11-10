"""Guard that assembly-llm-gateway waits for postgres before starting (in-cluster infra).

Real bug caught live on a fresh SCP pentest install (2026-08-11): assembly-llm-gateway had no
initContainer gating it on postgres readiness, unlike keycloak (wait-for-keycloak-db) and
assembly-core (wait-migrate). Its lifespan startup seeds `gateway_config` (the Azure Foundry
url/key/model-list row the UI reads for provider/model info) from env vars exactly ONCE on
boot, treating a DB-connect failure as non-fatal and never retrying. On a cold multi-service
install this pod can start before the postgres pod accepts connections, so the seed silently
never happens and the UI shows no provider/models forever -- with the pod otherwise healthy
and zero restarts, giving no visible signal that anything is wrong. Restarting the pod after
postgres is up is a viable workaround, but the chart should not depend on an operator noticing
and doing that by hand.
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
    "--set", "secrets.jwtSecret=dev-jwt",
    "--set", f"secrets.fernetKey={FERNET}",
    "--set", "secrets.internalServiceApiKey=dev-internal",
    "--set", "secrets.sandboxInternalServiceApiKey=dev-sandbox",
    "--set", "secrets.workspaceManagerInternalServiceApiKey=dev-wm",
    "--set", "secrets.llmGateway.userKeysInternalApiKey=dev-ukey",
    "--set", "secrets.llmGateway.adminKey=dev-admin",
]


def _render(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["helm", "template", "t", str(CHART), *REQUIRED_SECRETS, *extra],
        capture_output=True, text=True,
    )


def _llm_gateway_deployment_doc(stdout: str) -> str:
    for doc in stdout.split("---\n"):
        if "kind: Deployment" in doc and "name: t-data-assembly-llm-gateway\n" in doc:
            return doc
    raise AssertionError("no assembly-llm-gateway Deployment doc found in render output")


def test_llm_gateway_waits_for_postgres_when_infra_enabled():
    r = _render("--set", "infra.enabled=true")
    assert r.returncode == 0, r.stderr
    doc = _llm_gateway_deployment_doc(r.stdout)
    assert "initContainers:" in doc, (
        "assembly-llm-gateway must gate startup on postgres readiness when infra.enabled=true "
        "-- without it, a cold install can start this pod before postgres accepts connections, "
        "the one-shot gateway_config seed silently fails, and the UI never shows the "
        "configured provider/models (caught live on the SCP pentest cluster, 2026-08-11)"
    )
    assert "wait-for-postgres" in doc
    assert "until psql" in doc


def test_llm_gateway_skips_the_wait_on_external_infra():
    # external-infra installs assume their DB is already up -- same convention as
    # assembly-core's wait-migrate (infra.yaml / assembly-core.yaml).
    r = _render("--set", "infra.enabled=false")
    assert r.returncode == 0, r.stderr
    doc = _llm_gateway_deployment_doc(r.stdout)
    assert "initContainers:" not in doc
