"""Guards for the first-class allowlist values.

ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS (SSRF-guard bypass for specific hostnames,
read by assembly_shared.url_validation on the engine + all three workers) and
WEBHOOK_RUN_ALLOWLIST (cross-owner webhook invoke allowlist, read by
assembly-sandbox) used to be settable only through the generic extraEnv lists.
That pattern is a footgun twice over: helm lists REPLACE wholesale on override,
and re-declaring a chart-emitted env name via extraEnv renders a duplicate env
key that server-side apply rejects. Both are now dedicated values:

  urlValidation.allowHosts          -> ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS
                                       via aw.agentEnv (engine + 3 workers)
  sandboxTrigger.webhookRunAllowlist -> WEBHOOK_RUN_ALLOWLIST (sandbox-trigger)

Empty values emit nothing (fail-closed; default render unchanged).
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

ENGINE_DEPLOYMENTS = [
    "t-data-assembly-engine",
    "t-data-assembly-engine-worker",
    "t-data-assembly-engine-code-worker",
    "t-data-assembly-engine-subflow-worker",
]

#: Other services that call assembly_shared.url_validation and therefore need the
#: same allowlist (they don't consume aw.agentEnv).
VALIDATOR_DEPLOYMENTS = [
    "t-data-assembly-mcp-hub",
    "t-data-assembly-llm-gateway",
]


def _render(*extra_args: str) -> list[dict]:
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "validation.allowPlaceholders=true",
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    return [d for d in yaml.safe_load_all(r.stdout) if d]


def _container_env(docs: list[dict], deployment: str) -> list[dict]:
    for doc in docs:
        if doc.get("kind") == "Deployment" and doc["metadata"]["name"] == deployment:
            containers = doc["spec"]["template"]["spec"]["containers"]
            assert len(containers) == 1, f"{deployment}: expected a single container"
            return containers[0].get("env", [])
    raise AssertionError(f"Deployment {deployment} not found in render")


def _env_values(env: list[dict], name: str) -> list[str]:
    return [e.get("value") for e in env if e["name"] == name]


def test_url_validation_allow_hosts_on_engine_and_all_workers():
    docs = _render(
        "--set", "urlValidation.allowHosts=example.internal",
        "--set", "agentsSubflowWorker.enabled=true",
    )
    for deployment in ENGINE_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == ["example.internal"], (
            f"{deployment}: expected ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS exactly once, got {values}"
        )


def test_url_validation_allow_hosts_reaches_every_validator_consumer():
    """mcp-hub (remote MCP registration, spec-fetch-by-URL) and llm-gateway
    (gateway base URL) call the same assembly_shared validator, so the allowlist
    has to reach them too -- they were skipped while the env lived inside
    aw.agentEnv."""
    docs = _render("--set", "urlValidation.allowHosts=example.internal")
    for deployment in VALIDATOR_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == ["example.internal"], (
            f"{deployment}: expected ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS exactly once, got {values}"
        )


def test_url_validation_allow_hosts_renders_wildcard_entries_verbatim():
    """`*.suffix` wildcards are the preferred form (one entry per domain instead
    of one per service); the `*` must survive YAML quoting untouched."""
    wildcards = "*.dev-assembly.svc.cluster.local,*.invhub.fseng.net"
    docs = _render(
        # helm --set splits on commas, so a multi-entry list must escape them.
        "--set-string", "urlValidation.allowHosts=" + wildcards.replace(",", "\\,"),
        "--set", "agentsSubflowWorker.enabled=true",
    )
    for deployment in ENGINE_DEPLOYMENTS + VALIDATOR_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == [wildcards], f"{deployment}: got {values}"


def test_extra_allow_hosts_merges_with_the_committed_baseline():
    """extraAllowHosts exists so entries that must not be committed (a customer's
    internal zone) or that change without a release can come from 1Password via
    `vals`. It is merged, not an override -- the baseline stays authoritative."""
    docs = _render(
        "--set-string", "urlValidation.allowHosts=*.dev-assembly.svc.cluster.local",
        "--set-string", "urlValidation.extraAllowHosts=api.customer.internal",
        "--set", "agentsSubflowWorker.enabled=true",
    )
    expected = "*.dev-assembly.svc.cluster.local,api.customer.internal"
    for deployment in ENGINE_DEPLOYMENTS + VALIDATOR_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == [expected], f"{deployment}: got {values}"


def test_extra_allow_hosts_alone_still_renders():
    """Either source may be unset — an install can source the whole list from its
    secret store without a committed baseline."""
    docs = _render(
        "--set-string", "urlValidation.extraAllowHosts=*.customer.internal",
        "--set", "agentsSubflowWorker.enabled=true",
    )
    for deployment in ENGINE_DEPLOYMENTS + VALIDATOR_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == ["*.customer.internal"], f"{deployment}: got {values}"


def test_unresolved_op_reference_in_extra_allow_hosts_fails_render():
    """The 1Password form is only meaningful if a MISSING `vals eval` is caught:
    otherwise the literal `ref+op://...` string would ship as a hostname and
    silently allow nothing. aw.validate.noPlaceholders walks the whole values tree,
    so this is covered for extraAllowHosts too."""
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set-string",
            "urlValidation.extraAllowHosts=ref+op://vault/Assembly/assembly-aks-dev/urlValidation__extraAllowHosts",
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode != 0, "an unresolved ref+op:// must fail the render"
    assert "urlValidation.extraAllowHosts" in r.stderr, r.stderr


def test_allow_hosts_absent_by_default():
    """Fail-closed: an empty urlValidation.allowHosts must emit no env at all."""
    docs = _render("--set", "agentsSubflowWorker.enabled=true")
    for deployment in ENGINE_DEPLOYMENTS + VALIDATOR_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == [], f"{deployment}: env must be absent on default render, got {values}"


def test_webhook_run_allowlist_first_class():
    docs = _render("--set", "sandboxTrigger.webhookRunAllowlist=svc@example.com")
    values = _env_values(_container_env(docs, "t-data-assembly-sandbox-trigger"), "WEBHOOK_RUN_ALLOWLIST")
    assert values == ["svc@example.com"]


def test_webhook_run_allowlist_absent_by_default():
    docs = _render()
    values = _env_values(_container_env(docs, "t-data-assembly-sandbox-trigger"), "WEBHOOK_RUN_ALLOWLIST")
    assert values == [], f"WEBHOOK_RUN_ALLOWLIST must be absent on default render, got {values}"


@pytest.mark.parametrize("overlay", ["values-prod-perf.yaml", "values-perf-tierA.yaml"])
def test_perf_overlays_still_set_allow_hosts(overlay):
    """Migration equivalence guard: the perf overlays historically set the SSRF
    allowlist via extraEnv on all four engine/worker components; after moving to
    urlValidation.allowHosts the rendered env must be identical -- same value,
    exactly once per container (a duplicate would break server-side apply)."""
    # The perf overlays enable infra but ship no DB password (deployed with a
    # separate secrets overlay); satisfy the `required` check for render-only.
    docs = _render("-f", str(CHART / overlay), "--set", "infra.postgres.password=test-pg")
    for deployment in ENGINE_DEPLOYMENTS:
        values = _env_values(_container_env(docs, deployment), "ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS")
        assert values == ["perf-mock-llm"], (
            f"{overlay} {deployment}: expected exactly one ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS="
            f"perf-mock-llm, got {values}"
        )


def test_dev_overlay_webhook_allowlist_preserved():
    """Same equivalence guard for values-dev.yaml's WEBHOOK_RUN_ALLOWLIST -- still exactly
    one env entry, no duplicate (a duplicate breaks server-side apply). The value itself is
    a ref+op:// pointer here (unlike dev-assembly-eng/pen-test, assembly-aks-dev doesn't
    enable flowsIntegration, so there's no auto-derivation to fall back on -- this ref IS
    the only source), rendered raw since this render skips `vals eval`."""
    docs = _render("-f", str(CHART / "values-dev.yaml"))
    values = _env_values(_container_env(docs, "t-data-assembly-sandbox-trigger"), "WEBHOOK_RUN_ALLOWLIST")
    assert values == [
        "ref+op://nfrx352u56ryvyevbdyilpcji4/Assembly/assembly-aks-dev/"
        "sandboxTrigger__webhookRunAllowlist"
    ], (
        f"values-dev.yaml: expected exactly one WEBHOOK_RUN_ALLOWLIST, got {values}"
    )
