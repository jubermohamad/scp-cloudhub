"""Guard: imagePullSecrets reach EVERY infra pod, not just app pods.

`aw.imagePullSecrets` was wired only on the first-party app workloads. On a
cluster whose third-party images come from a private mirror ACR (SCP), the infra
pods (postgres, redis, keycloak, temporal*, minio, the setup Jobs) also need the
pull secret or they ImagePullBackOff. Additive: renders nothing when no pull
secret is configured (default render unchanged).
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
SECRET = "acr-secret"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _render(*extra: str) -> str:
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "infra.enabled=true",
            "--set", "infra.postgres.password=test-pg",
            "--set", "infra.postgresTemporal.enabled=true",
            "--set", "minio.enabled=true",
            "--set", "validation.allowPlaceholders=true",
            *extra,
        ],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


# Infra workloads that must honour the pull secret (by metadata.name substring).
INFRA_WORKLOADS = {"postgres", "redis", "keycloak", "temporal", "minio"}


def _infra_pod_specs(rendered: str):
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") not in ("Deployment", "StatefulSet", "Job"):
            continue
        name = doc["metadata"]["name"]
        if not any(w in name for w in INFRA_WORKLOADS):
            continue
        # skip first-party app deployments that merely contain 'temporal' etc. — none do
        yield name, doc["spec"]["template"]["spec"]


def test_pull_secret_on_every_infra_pod_when_set():
    rendered = _render("--set", f"image.pullSecrets[0].name={SECRET}")
    specs = list(_infra_pod_specs(rendered))
    assert specs, "no infra workloads rendered"
    for name, spec in specs:
        names = [s["name"] for s in spec.get("imagePullSecrets", [])]
        assert SECRET in names, f"infra workload {name} missing imagePullSecrets {SECRET}"


def test_no_pull_secret_by_default():
    rendered = _render()
    for name, spec in _infra_pod_specs(rendered):
        assert "imagePullSecrets" not in spec, f"{name} has imagePullSecrets when none configured"
