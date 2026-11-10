"""Guard against shipping the world-known default admin passwords (#1500).

The chart seeds a realm-admin bootstrap user (admin@assembly.dev, public login)
and a Keycloak console admin. Both had repo-default passwords applied via
``| default`` with no fail-closed validation — unlike jwtSecret/fernetKey. This
test renders the chart with ``helm template`` and asserts the install fails when
either admin password is empty or left at its known default, and passes once
strong values are supplied.
"""

import pathlib
import shutil
import subprocess

import pytest

CHART = pathlib.Path(__file__).resolve().parents[1]
# Valid 44-char urlsafe-base64 shape so the fernetKey validation passes and we
# reach the admin-password checks.
FERNET = "StCYwnX1kEcds8ZDSRQCcXhSI9oLwuDUcErahChyT-s="

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _render(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "infra.enabled=true",
            "--set", "secrets.jwtSecret=dev-jwt",
            "--set", f"secrets.fernetKey={FERNET}",
            "--set", "infra.postgres.password=dev-pg",
            # Internal keys are now fail-closed; supply them so validation reaches
            # the admin-password checks this test targets.
            "--set", "secrets.internalServiceApiKey=dev-internal",
            "--set", "secrets.sandboxInternalServiceApiKey=dev-sandbox",
            "--set", "secrets.workspaceManagerInternalServiceApiKey=dev-wm",
            "--set", "secrets.llmGateway.userKeysInternalApiKey=dev-ukey",
            "--set", "secrets.llmGateway.adminKey=dev-admin",
            *extra,
        ],
        capture_output=True,
        text=True,
    )


def test_empty_bootstrap_admin_password_rejected():
    r = _render()  # bootstrapAdminPassword unset -> empty
    assert r.returncode != 0
    assert "secrets.bootstrapAdminPassword is empty or the known repo default" in r.stderr


def test_known_default_bootstrap_admin_password_rejected():
    r = _render("--set", "secrets.bootstrapAdminPassword=assembly-admin-rotateme")
    assert r.returncode != 0
    assert "secrets.bootstrapAdminPassword is empty or the known repo default" in r.stderr


def test_default_keycloak_console_admin_password_rejected():
    r = _render("--set", "secrets.bootstrapAdminPassword=Str0ng-Boot-Pw",
                "--set", "infra.keycloak.adminPassword=changeme")
    assert r.returncode != 0
    assert "infra.keycloak.adminPassword is empty or the known repo default" in r.stderr


def test_strong_admin_passwords_pass_admin_validation():
    r = _render("--set", "secrets.bootstrapAdminPassword=Str0ng-Boot-Pw",
                "--set", "infra.keycloak.adminPassword=Str0ng-KC-Pw")
    # Our admin-password validation must not fire (other unrelated required
    # values may still be missing, but never our admin checks).
    assert "bootstrapAdminPassword is empty or the known repo default" not in r.stderr
    assert "infra.keycloak.adminPassword is empty or the known repo default" not in r.stderr
