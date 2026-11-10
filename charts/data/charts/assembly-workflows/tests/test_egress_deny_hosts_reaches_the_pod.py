"""`denyHosts` must reach the container, or it protects nothing (#2131).

The egress filter's six built-in denies cover PRIVATE ranges only. A cluster's
own public ingress is a public address, so `custom_code` could connect straight
back to the platform's front door — measured on dev: `/api/v1/health` 200,
Keycloak `openid-configuration` 200, `/webhook/...` 405, all from a code node.

The fix is a configurable deny list. Which makes this the load-bearing test:
**a security value that never reaches the pod spec is inert**, and this repo has
already shipped exactly that failure twice — the NetworkPolicies enforced by no
policy engine (#2111), and the egress filter itself, which shipped with no
`values*.yaml` entry at all so a default deploy still refused networked code.

Asserted on RENDERED output for the same reason: the values files deep-merge,
and only the rendered spec is what the pod actually gets.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

_CHART = Path(__file__).resolve().parents[1]
_VALUES = sorted(_CHART.glob("values*.yaml"))

ENV_NAME = "EXECUTE_CODE_EGRESS_FILTER_DENY_HOSTS"


def _render(values_file: Path | None = None, sets: list[str] | None = None) -> str:
    cmd = [
        "helm", "template", "t", str(_CHART),
        "--set", "validation.allowPlaceholders=true",
        "--set", "infra.postgres.password=placeholder-for-template-test",
    ]
    if values_file is not None:
        cmd += ["-f", str(values_file)]
    for s in sets or []:
        cmd += ["--set", s]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        pytest.fail(f"helm template failed: {result.stderr[:400]}")
    return result.stdout


def _sandbox_execute_env(rendered: str) -> dict[str, str] | None:
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") != "Deployment":
            continue
        if doc["metadata"]["name"] != "t-data-assembly-sandbox-execute":
            continue
        container = doc["spec"]["template"]["spec"]["containers"][0]
        return {e["name"]: e.get("value", "") for e in container.get("env", [])}
    return None


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_the_variable_exists_in_every_overlay(values_file: Path):
    """Absent means the code default silently wins and the deny is unreachable."""
    env = _sandbox_execute_env(_render(values_file))
    if env is None:
        pytest.skip("sandbox-execute not rendered by this overlay")
    assert ENV_NAME in env, (
        f"{values_file.name}: {ENV_NAME} missing from the rendered pod spec — "
        "the deny list cannot be configured, so the cluster's own public ingress "
        "stays reachable from a code node (#2131)"
    )


def test_a_configured_host_actually_lands_in_the_container():
    """The whole point: value in -> value on the pod."""
    env = _sandbox_execute_env(
        _render(sets=["sandboxExecute.egressFilter.denyHosts={assembly.example.com}"])
    )
    assert env is not None
    assert env[ENV_NAME] == "assembly.example.com"


def test_multiple_hosts_are_comma_joined_for_the_filter():
    """The filter splits on commas; a rendered YAML list would be unparseable."""
    env = _sandbox_execute_env(
        _render(sets=[
            "sandboxExecute.egressFilter.denyHosts="
            "{assembly.example.com,51.132.165.237,203.0.113.0/24}"
        ])
    )
    assert env is not None
    assert env[ENV_NAME] == "assembly.example.com,51.132.165.237,203.0.113.0/24"


def test_default_is_empty_not_missing():
    """Empty is a valid state — it must render as "" rather than vanish.

    A missing key and an empty one behave identically in the filter, but only
    the empty one proves the plumbing exists to be filled in later.
    """
    env = _sandbox_execute_env(_render())
    assert env is not None
    assert env[ENV_NAME] == ""
