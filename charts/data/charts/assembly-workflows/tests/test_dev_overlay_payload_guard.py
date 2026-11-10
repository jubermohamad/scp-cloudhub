"""Guards for assembly-aks-dev payload-guard + Tier-2 blob-offload (#2023).

PR #2023 raised the dev payload-guard ceiling to 10MB and enabled blob-offload
on all four engine processes (agents API + three worker pools). Partial rollout
— offload on one worker but not another, or workers silently falling back to
the 1.2MB code default because extraEnv replaces rather than merges — causes
opaque decode failures at runtime instead of a clean guard error.

These tests pin the values-dev.yaml contract and verify helm template renders
the same env vars on every deployment that touches the Temporal data converter.
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
VALUES_DEV = CHART / "values-dev.yaml"

PAYLOAD_ENV = {
    "ASSEMBLY_WORKFLOW_PAYLOAD_HARD_LIMIT_BYTES": "10000000",
    "ASSEMBLY_WORKFLOW_PAYLOAD_OFFLOAD_ENABLED": "true",
    "ASSEMBLY_WORKFLOW_PAYLOAD_OFFLOAD_S3_ENDPOINT": "http://minio:9000",
    "ASSEMBLY_WORKFLOW_PAYLOAD_OFFLOAD_TTL_DAYS": "7",
}

ENGINE_DEPLOYMENTS = (
    "t-data-assembly-engine",
    "t-data-assembly-engine-worker",
    "t-data-assembly-engine-code-worker",
    "t-data-assembly-engine-subflow-worker",
)

VALUES_BLOCKS = (
    "agents",
    "agentsWorker",
    "agentsCodeWorker",
    "agentsSubflowWorker",
)

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _load_values_dev() -> dict:
    return yaml.safe_load(VALUES_DEV.read_text()) or {}


def _render_dev() -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm",
            "template",
            "t",
            str(CHART),
            "--values",
            str(VALUES_DEV),
            "--set",
            "validation.allowPlaceholders=true",
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


def _extra_env_map(block: dict) -> dict[str, str]:
    return {
        entry["name"]: str(entry["value"])
        for entry in (block.get("extraEnv") or [])
        if isinstance(entry, dict) and "name" in entry and "value" in entry
    }


def _parse_memory_gi(value: str) -> float:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(Gi|G|Mi|M)", str(value).strip())
    assert match, f"expected memory quantity like 2Gi, got {value!r}"
    amount = float(match.group(1))
    unit = match.group(2)
    if unit in ("Gi", "G"):
        return amount
    return amount / 1024


@pytest.mark.parametrize("block_name", VALUES_BLOCKS)
def test_dev_overlay_values_declare_payload_guard_and_offload(block_name: str):
    """Each engine block must list the full payload/offload quartet in extraEnv."""
    values = _load_values_dev()
    block = values[block_name]
    env = _extra_env_map(block)
    for name, expected in PAYLOAD_ENV.items():
        assert env.get(name) == expected, (
            f"{block_name}.extraEnv[{name}] must be {expected!r} — "
            "extraEnv replaces chart defaults, so omitting it silently drops "
            "dev back to the 1.2MB code default on that process"
        )


def test_dev_overlay_worker_memory_limits_back_the_raised_payload_ceiling():
    """10MB compact_state needs >=2Gi worker limits or rare bursts OOMKill pods."""
    values = _load_values_dev()
    for block_name in ("agentsWorker", "agentsCodeWorker", "agentsSubflowWorker"):
        limit = values[block_name]["resources"]["limits"]["memory"]
        assert _parse_memory_gi(limit) >= 2, (
            f"{block_name}.resources.limits.memory must stay >= 2Gi to back "
            "ASSEMBLY_WORKFLOW_PAYLOAD_HARD_LIMIT_BYTES=10000000 on dev"
        )


@pytest.mark.parametrize("deployment_name", ENGINE_DEPLOYMENTS)
def test_dev_render_engine_deployments_carry_consistent_payload_env(
    deployment_name: str,
):
    """Rendered pods must agree on payload guard + offload — partial enablement breaks decode."""
    rendered = _render_dev()
    assert rendered.returncode == 0, rendered.stderr
    doc = _deployment_doc(rendered.stdout, deployment_name)
    env = _env_map_from_deployment(doc)
    for name, expected in PAYLOAD_ENV.items():
        assert env.get(name) == expected, (
            f"{deployment_name} missing or mismatched {name}={expected!r} "
            f"(got {env.get(name)!r})"
        )
