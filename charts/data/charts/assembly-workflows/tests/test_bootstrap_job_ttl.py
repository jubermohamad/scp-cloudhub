"""Guard: helm-`--wait`-tracked bootstrap Jobs must not self-delete mid-wait.

`postgres-init` and `temporal-namespace-setup` (default, non-split temporal) are REGULAR
Jobs, not helm hooks, so `helm upgrade --wait` polls them to completion. They finish in
seconds, but `--wait` keeps polling for as long as the whole rollout takes; if
`ttlSecondsAfterFinished` fires inside that window the Job is deleted and helm reports
`Job/... not ready. status: NotFound ... context deadline exceeded` -> a spurious
UPGRADE FAILED, with any post-upgrade hooks (the keycloak flows reconcile) never running.
Observed on dev-assembly: a 12-min worker rollout deleted both Jobs at the 5-min mark.

So their TTL must exceed the deploy `--wait` timeout (deploy.yml uses 12m) with margin.
The split-mode `temporal-namespace-setup` is a post-upgrade HOOK and exempt -- hooks are
not polled by the main `--wait`.
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

# Must exceed deploy.yml's `--timeout 12m` (720s) so a completed Job cannot TTL-delete while
# helm --wait is still polling it on a slow rollout.
MIN_TTL_SECONDS = 900
WAIT_TRACKED_BOOTSTRAP_JOBS = ("t-data-assembly-postgres-init", "t-data-assembly-temporal-namespace-setup")


def _rendered_jobs() -> dict:
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "infra.enabled=true",
            "--set", "validation.allowPlaceholders=true",
            "--set", "infra.postgres.password=test-pg",
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    return {
        d["metadata"]["name"]: d
        for d in yaml.safe_load_all(r.stdout)
        if d and d.get("kind") == "Job"
    }


def test_wait_tracked_bootstrap_jobs_ttl_outlasts_wait_timeout():
    jobs = _rendered_jobs()
    for name in WAIT_TRACKED_BOOTSTRAP_JOBS:
        assert name in jobs, f"{name} Job did not render with infra.enabled=true"
        job = jobs[name]
        # These must stay REGULAR Jobs (hooks aren't polled by the main --wait); if one is
        # ever converted to a hook, revisit this guard rather than silently passing.
        anns = job["metadata"].get("annotations", {}) or {}
        assert "helm.sh/hook" not in anns, (
            f"{name} became a helm hook; the TTL race no longer applies -- update this guard"
        )
        ttl = job["spec"].get("ttlSecondsAfterFinished")
        assert ttl is not None and ttl >= MIN_TTL_SECONDS, (
            f"{name} ttlSecondsAfterFinished={ttl} must be >= {MIN_TTL_SECONDS}s (> the 12m "
            f"deploy --wait timeout) so it cannot self-delete while helm --wait is still "
            f"polling it on a slow rollout -> spurious UPGRADE FAILED"
        )
