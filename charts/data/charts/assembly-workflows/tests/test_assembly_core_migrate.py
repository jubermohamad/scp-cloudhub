"""Guard against reintroducing the assembly-core migration race (#1299).

A per-pod initContainer running `alembic upgrade head` on every assembly-core
replica independently races on a truly fresh DB: the second replica's
CREATE TABLE hits DuplicateTableError before the first commits. Migrations
now run exactly once via a dedicated Job (assembly-core-migrate-job.yaml)
with implicit parallelism=1; assembly-core.yaml's initContainer only waits
for that Job's result. This test fails if either half of that split ever
runs `alembic upgrade head` directly inside assembly-core.yaml's pod spec, or
if the Job gains explicit parallelism > 1.
"""

import pathlib

TEMPLATES = pathlib.Path(__file__).resolve().parents[1] / "templates"


def test_assembly_core_deployment_does_not_run_alembic_directly():
    # Comments legitimately mention "alembic" while explaining the fix -- only
    # the actual command invocation matters here.
    text = (TEMPLATES / "assembly-core.yaml").read_text()
    assert '"alembic"' not in text and "'alembic'" not in text, (
        "assembly-core.yaml must not run alembic directly in a per-pod "
        "initContainer -- this is the exact race that caused #1299. "
        "Migrations belong in assembly-core-migrate-job.yaml's one-time Job; "
        "this file should only wait on that Job's result."
    )


def test_assembly_core_migrate_job_runs_exactly_once():
    text = (TEMPLATES / "assembly-core-migrate-job.yaml").read_text()
    assert "alembic" in text, "the migrate Job should be the only place alembic runs"
    assert "kind: Job" in text, "migrations must run as a Job, not a Deployment/initContainer"
    # Job default parallelism is 1; explicitly setting it > 1 would reintroduce
    # the concurrent-migration race this fix exists to close.
    assert "parallelism:" not in text, (
        "do not set explicit Job parallelism for the migrate Job -- it must "
        "stay at the implicit default of 1, or concurrent alembic runs can "
        "race on a fresh DB again (#1299)"
    )


def test_assembly_core_migrate_job_is_not_a_helm_hook():
    text = (TEMPLATES / "assembly-core-migrate-job.yaml").read_text()
    # Helm hooks run before the chart's own ConfigMaps/Secrets exist, which
    # deadlocks a fresh install (this Job depends on platform-config and the
    # app secret) -- see temporal-split.yaml's schema-migrate Job for the
    # same reasoning, already learned the hard way once in this chart.
    assert "helm.sh/hook" not in text, (
        "the migrate Job must be a normal resource, not a Helm hook -- hooks "
        "run before ConfigMaps/Secrets exist and would deadlock a fresh install"
    )
