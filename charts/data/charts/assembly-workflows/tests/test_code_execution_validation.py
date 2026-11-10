"""The code-worker's execution backend must actually be deployed.

``agentsCodeWorker.codeExecutionTarget: sandbox-service`` delegates ``/execute-code``
to the assembly-sandbox-execute Deployment. With ``sandboxExecute.enabled=false`` there
is no backend, and the failure only surfaces at RUNTIME — a node in the UI erroring with
"Docker is required for secure code execution" — rather than at render.

That combination is easy to reach: values-scp.yaml pins ``sandbox-service`` (so the
code-worker isn't privileged), while an operator may disable ``sandboxExecute`` because
that pod *is* privileged and a locked-down PodSecurity namespace can reject it. Observed
live on the SCP dev cluster. These render-only assertions fail the install instead.
"""

import pathlib
import shutil
import subprocess

import pytest

CHART = pathlib.Path(__file__).resolve().parents[1]
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


def _render(target: str, sandbox_enabled: bool) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            *REQUIRED_SECRETS,
            "--set", f"agentsCodeWorker.codeExecutionTarget={target}",
            "--set", f"sandboxExecute.enabled={str(sandbox_enabled).lower()}",
        ],
        capture_output=True,
        text=True,
    )


def test_sandbox_service_without_the_service_fails():
    r = _render("sandbox-service", False)
    assert r.returncode != 0, "render must fail when the delegation target is absent"
    assert "codeExecutionTarget=sandbox-service requires sandboxExecute.enabled=true" in r.stderr


def test_sandbox_service_with_the_service_renders():
    assert _render("sandbox-service", True).returncode == 0


def test_local_nsjail_does_not_need_the_sandbox_service():
    """local-nsjail executes in-pod, so the service is genuinely optional."""
    assert _render("local-nsjail", False).returncode == 0


def test_scp_overlay_is_self_consistent():
    """values-scp.yaml pins sandbox-service; it must not ship with the service off."""
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "-f", str(CHART / "values-scp.yaml"),
            "--set", "validation.allowPlaceholders=true",
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert "assembly-sandbox-execute" in r.stdout
