"""Guard: global.imageRegistry mirrors ALL bundled third-party images.

SCP (and any air-gapped cluster) cannot pull docker.io/quay.io directly; the
pipeline mirrors third-party images into a private ACR. The chart already
prefixes the 10 first-party app images via image.registry, but the third-party
infra images (postgres, redis, keycloak, temporal*, minio/mc, apisix) were
standalone full refs the prefix never touched. `global.imageRegistry`, applied
via the `aw.infraImage` helper, rewrites ONLY their registry host to the mirror
while preserving repo path + tag. Unset (default) -> byte-identical strings.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
MIRROR = "mirror.example.io"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

# Third-party images that render in the DEFAULT (auto-setup) temporal mode, and
# their expected mirrored form. Rewrite rule: a registry host (quay.io) is
# swapped; docker-hub short refs get the mirror prepended, keeping repo + tag.
THIRD_PARTY_EXPECTED = {
    "postgres:16-alpine": f"{MIRROR}/postgres:16-alpine",
    "redis:7-alpine": f"{MIRROR}/redis:7-alpine",
    "quay.io/keycloak/keycloak:23.0": f"{MIRROR}/keycloak/keycloak:23.0",
    "temporalio/auto-setup:1.29.6": f"{MIRROR}/temporalio/auto-setup:1.29.6",
    "temporalio/admin-tools:1.30.4": f"{MIRROR}/temporalio/admin-tools:1.30.4",
    "apache/apisix:3.8.0-debian": f"{MIRROR}/apache/apisix:3.8.0-debian",
    # minio/mc default to :latest ON PURPOSE (pinning older would downgrade existing
    # installs; minio won't boot on newer on-disk data). The mirror rewrite still only
    # touches the registry host — repo path + tag (incl. :latest) are preserved.
    "minio/minio:latest": f"{MIRROR}/minio/minio:latest",
    "minio/mc:latest": f"{MIRROR}/minio/mc:latest",
}


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


def _all_images(rendered: str) -> set[str]:
    images: set[str] = set()
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") not in ("Deployment", "StatefulSet", "Job", "CronJob"):
            continue
        spec = (
            doc["spec"]["jobTemplate"]["spec"]["template"]["spec"]
            if doc["kind"] == "CronJob"
            else doc["spec"]["template"]["spec"]
        )
        for c in spec.get("containers", []) + spec.get("initContainers", []):
            images.add(c["image"])
    return images


def test_mirror_rewrites_every_third_party_image():
    images = _all_images(_render("--set", f"global.imageRegistry={MIRROR}"))
    # Every third-party image must appear in its mirrored form...
    for original, mirrored in THIRD_PARTY_EXPECTED.items():
        assert mirrored in images, f"{original} not mirrored to {mirrored}; got {sorted(images)}"
    # ...and none of the original third-party registries must survive. Compare each
    # registry (first path segment) by exact equality — `<host> in registries` trips
    # CodeQL's URL-substring heuristic, and `==` is the exact match it recommends.
    registries = {i.split("/", 1)[0] for i in images}
    assert not any(r == "quay.io" for r in registries), sorted(images)
    assert not any(i in THIRD_PARTY_EXPECTED for i in images), sorted(images)
    # First-party app images keep their own image.registry (mirror is third-party only).
    assert any(r == "assemblyrgacr.azurecr.io" for r in registries), sorted(images)


def test_mirror_rewrites_split_temporal_server_image():
    """The split-mode temporal server image (only rendered in split mode) is
    also mirrored."""
    images = _all_images(
        _render("--set", f"global.imageRegistry={MIRROR}", "--set", "infra.temporal.mode=split")
    )
    assert f"{MIRROR}/temporalio/server:1.30.4" in images, sorted(images)
    assert "temporalio/server:1.30.4" not in images


def test_unset_mirror_is_byte_identical():
    images = _all_images(_render())
    for original in THIRD_PARTY_EXPECTED:
        assert original in images, f"{original} changed when global.imageRegistry unset"
