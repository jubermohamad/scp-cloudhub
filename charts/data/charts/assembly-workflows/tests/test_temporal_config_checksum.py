"""Guard the checksum/config annotations on Temporal's subPath-mounted ConfigMaps (#1322).

Same bug class as #1319/#1321/#1323: subPath mounts are never live-refreshed by kubelet, so
without a checksum annotation a `helm upgrade` updates the ConfigMap object but never actually
triggers a rollout to pick it up. temporal-dynamic-config (auto-setup + split modes) and
temporal-split-config (split mode) both lacked this. They're now split into their own
configmap-*.yaml files (required -- a template including its own file to hash itself causes
infinite recursion in Helm's engine, which is exactly why every other checksum annotation in
this chart already targets a dedicated file rather than the file containing the Deployment).
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
    "--set", "infra.enabled=true",
    "--set", "infra.postgresTemporal.enabled=true",
]


def _render(mode: str) -> str:
    r = subprocess.run(
        ["helm", "template", "t", str(CHART), "--set", f"infra.temporal.mode={mode}",
         *REQUIRED_SECRETS],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


def _deployment_doc(rendered: str, name: str) -> str:
    marker = f"\nkind: Deployment\nmetadata:\n  name: {name}\n"
    idx = rendered.find(marker)
    assert idx != -1, f"Deployment {name} not found in render"
    end = rendered.find("\n---\n", idx)
    return rendered[idx:end if end != -1 else None]


def test_auto_setup_temporal_has_dynamic_config_checksum():
    doc = _deployment_doc(_render("auto-setup"), "t-data-assembly-temporal")
    assert "checksum/temporal-dynamic-config:" in doc


def test_split_mode_deployments_have_both_checksums():
    rendered = _render("split")
    for name in ["t-data-assembly-temporal-frontend", "t-data-assembly-temporal-history", "t-data-assembly-temporal-matching", "t-data-assembly-temporal-worker"]:
        doc = _deployment_doc(rendered, name)
        assert "checksum/temporal-split-config:" in doc, f"{name} missing split-config checksum"
        assert "checksum/temporal-dynamic-config:" in doc, f"{name} missing dynamic-config checksum"


def test_checksum_changes_when_dynamic_config_content_changes():
    # Regression guard for the actual bug: the checksum must be a function of the ConfigMap's
    # OWN content, not a static/constant string that happens to satisfy the presence check above.
    base = _deployment_doc(_render("auto-setup"), "t-data-assembly-temporal")
    base_checksum = [l for l in base.splitlines() if "checksum/temporal-dynamic-config:" in l][0]

    r = subprocess.run(
        ["helm", "template", "t", str(CHART), "--set", "infra.temporal.mode=auto-setup",
         "--set", "infra.temporal.dynamicConfig.perfOptimized=true", *REQUIRED_SECRETS],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    changed = _deployment_doc(r.stdout, "t-data-assembly-temporal")
    changed_checksum = [l for l in changed.splitlines() if "checksum/temporal-dynamic-config:" in l][0]
    assert base_checksum != changed_checksum


def test_no_duplicate_configmap_resources():
    # The extraction into dedicated files must not leave the ConfigMap defined twice.
    rendered = _render("split")
    assert rendered.count("\n  name: t-data-assembly-temporal-dynamic-config\n") == 1
    assert rendered.count("\n  name: t-data-assembly-temporal-split-config\n") == 1
