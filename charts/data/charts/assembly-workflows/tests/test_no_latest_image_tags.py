"""Guard: images render with a pinned (non-`:latest`) tag.

SCP forbids unpinned images. minio/mc are the deliberate exception in the DEFAULT
render: they stay `:latest` on purpose — pinning an older version here would
DOWNGRADE existing `:latest` installs, and minio refuses to start on newer
on-disk data (xl-meta) → boot loop. `values-scp.yaml` pins them for FRESH SCP
installs (no existing data), so the no-`:latest` rule is enforced there instead
(see `test_scp_overlay_pins_every_image`). Renders the fully-self-contained stack
so every bundled image is present.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

# Repos allowed to render `:latest` in the DEFAULT stack (see module docstring);
# the values-scp overlay pins them and is checked separately.
_DEFAULT_LATEST_ALLOWED = ("minio/minio", "minio/mc")


def _render(*extra: str) -> str:
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "infra.enabled=true",
            "--set", "infra.postgres.password=test-pg",
            "--set", "infra.postgresTemporal.enabled=true",
            "--set", "minio.enabled=true",
            "--set", "agentsSubflowWorker.enabled=true",
            "--set", "validation.allowPlaceholders=true",
            *extra,
        ],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


def _images(rendered: str):
    """Yield (owner, image) for every container image in the rendered manifests."""
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") not in ("Deployment", "StatefulSet", "Job", "CronJob"):
            continue
        spec = (
            doc["spec"]["jobTemplate"]["spec"]["template"]["spec"]
            if doc["kind"] == "CronJob"
            else doc["spec"]["template"]["spec"]
        )
        for c in spec.get("containers", []) + spec.get("initContainers", []):
            yield f'{doc["metadata"]["name"]}/{c["name"]}', c["image"]


def _is_latest_or_untagged(image: str) -> bool:
    if "@" in image:
        return False  # digest-pinned (repo@sha256:…) is reproducible
    # The tag lives in the FINAL path component; a ":" before the last "/" is a
    # registry port (host:5000/repo), not a tag.
    last = image.rsplit("/", 1)[-1]
    return ":" not in last or last.rsplit(":", 1)[1] == "latest"


def test_no_latest_or_untagged_images():
    offenders = [
        f"{owner}={image}"
        for owner, image in _images(_render())
        if _is_latest_or_untagged(image)
        # minio/mc intentionally stay :latest in the default render (see docstring)
        and not any(allow in image for allow in _DEFAULT_LATEST_ALLOWED)
    ]
    assert not offenders, f"images with :latest / no tag: {offenders}"


def test_scp_overlay_pins_every_image():
    """The SCP overlay must pin EVERY image (incl. minio/mc) — no `:latest` at all."""
    offenders = [
        f"{owner}={image}"
        for owner, image in _images(_render("-f", str(CHART / "values-scp.yaml")))
        if _is_latest_or_untagged(image)
    ]
    assert not offenders, f"values-scp.yaml renders unpinned images: {offenders}"
