"""Guards for #2008: SANDBOX_EXECUTE_CODE_URL on every engine deployment.

The agent node's built-in ``run_code`` tool executes inside the general worker
activity — not on the code-worker queue. Wiring ``SANDBOX_EXECUTE_CODE_URL`` only
on ``assembly-engine-code-worker`` left the code interpreter dead on every cluster:
the engine fell back to ``ASSEMBLY_SANDBOX_URL`` (trigger pod), got a 404 on
``/execute-code``, then tried the in-process Docker interpreter and failed with
"Docker is required for secure code execution".

The var now lives in the shared ``aw.agentEnv`` helper so all engine deployments
get it. These tests lock that wiring in.
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
HELPERS = CHART / "templates" / "_helpers.tpl"
CODE_WORKER_TEMPLATE = CHART / "templates" / "assembly-engine-code-worker.yaml"
ENV_NAME = "SANDBOX_EXECUTE_CODE_URL"
DEFAULT_EXECUTE_URL = "http://t-data-assembly-sandbox-execute:8003"
TRIGGER_URL = "http://t-data-assembly-sandbox-trigger:8003"

ENGINE_DEPLOYMENTS = (
    "t-data-assembly-engine",
    "t-data-assembly-engine-worker",
    "t-data-assembly-engine-code-worker",
)

requires_helm = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _render(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm",
            "template",
            "t",
            str(CHART),
            "--set",
            "validation.allowPlaceholders=true",
            *extra,
        ],
        capture_output=True,
        text=True,
    )


def _deployment_doc(rendered: str, name: str) -> str:
    marker = f"\nkind: Deployment\nmetadata:\n  name: {name}\n"
    idx = rendered.find(marker)
    assert idx != -1, f"Deployment {name} not found in render"
    end = rendered.find("\n---\n", idx)
    return rendered[idx : end if end != -1 else None]


def _env_map_from_deployment(doc: str) -> dict[str, str]:
    parsed = yaml.safe_load(doc)
    env_map: dict[str, str] = {}
    for container in parsed["spec"]["template"]["spec"]["containers"]:
        for entry in container.get("env") or []:
            if "name" not in entry:
                continue
            if "value" in entry:
                env_map[entry["name"]] = str(entry["value"])
    return env_map


def test_agent_env_helper_declares_sandbox_execute_code_url():
    """The shared aw.agentEnv block must wire the execute-service URL."""
    text = HELPERS.read_text()
    block_match = re.search(
        r'{{- define "aw\.agentEnv" -}}(.*?){{- end -}}',
        text,
        re.DOTALL,
    )
    assert block_match, "aw.agentEnv helper not found in _helpers.tpl"
    block = block_match.group(1)
    assert f"- name: {ENV_NAME}" in block
    assert "sandboxExecuteCodeUrl" in block
    assert "sandbox-execute:8003" in block
    assert "Code execution is unaffected" not in text, (
        "stale comment claimed only the code-worker needed SANDBOX_EXECUTE_CODE_URL"
    )


def test_code_worker_template_does_not_duplicate_sandbox_execute_code_url():
    """#2008 moved the var into aw.agentEnv — a per-deployment copy regresses."""
    text = CODE_WORKER_TEMPLATE.read_text()
    matches = list(re.finditer(rf"- name: {ENV_NAME}\s*$", text, re.MULTILINE))
    assert not matches, (
        f"{CODE_WORKER_TEMPLATE.name} must not declare {ENV_NAME} directly; "
        "it comes from aw.agentEnv on every engine deployment"
    )


@requires_helm
@pytest.mark.parametrize("deployment", ENGINE_DEPLOYMENTS)
def test_default_render_sets_sandbox_execute_code_url_on_engine_deployments(deployment: str):
    """Every engine deployment must reach the execute pod, not the trigger."""
    rendered = _render()
    assert rendered.returncode == 0, rendered.stderr
    env = _env_map_from_deployment(_deployment_doc(rendered.stdout, deployment))
    assert ENV_NAME in env, f"{deployment} is missing {ENV_NAME}"
    assert env[ENV_NAME] == DEFAULT_EXECUTE_URL
    assert env[ENV_NAME] != TRIGGER_URL


@requires_helm
def test_subflow_worker_gets_sandbox_execute_code_url_when_enabled():
    rendered = _render("--set", "agentsSubflowWorker.enabled=true")
    assert rendered.returncode == 0, rendered.stderr
    env = _env_map_from_deployment(
        _deployment_doc(rendered.stdout, "t-data-assembly-engine-subflow-worker"),
    )
    assert env.get(ENV_NAME) == DEFAULT_EXECUTE_URL


@requires_helm
def test_values_can_override_sandbox_execute_code_url():
    custom = "http://custom-execute:9999"
    rendered = _render("--set", f"agents.sandboxExecuteCodeUrl={custom}")
    assert rendered.returncode == 0, rendered.stderr
    env = _env_map_from_deployment(_deployment_doc(rendered.stdout, "t-data-assembly-engine-worker"))
    assert env[ENV_NAME] == custom
