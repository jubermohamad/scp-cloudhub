"""Infra must be reachable by its real clients and by nobody else.

`default-deny-ingress` + `allow-app-same-namespace-ingress` used to re-admit
*everything*: any pod carrying an `app` label could open a socket to Postgres,
Redis, Keycloak and Temporal. Lateral movement is the standard second move after
an initial foothold, so that made every application pod a stepping stone to the
databases and the identity provider.

This suite guards both halves of the fix, and the second half matters more:

* **tight** — each scoped component is carved out of the blanket allow and has
  its own `*-access` policy;
* **not broken** — every service that genuinely needs a component can still
  reach it.

A policy set that is tight but severs the platform is worse than the status quo,
because it fails at deploy time on a cluster where a policy engine has just been
switched on — which is exactly when nobody wants to be debugging connectivity.

The client expectations are **derived from the rendered pod specs**, not
hardcoded. That is deliberate: a new service wired to `database-url` and *not*
added to `postgres-access` fails here, rather than at 2am on the cluster where
NetworkPolicy is first enforced. The whole class of bug is "the policy and the
deployment drifted apart".
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

_CHART = Path(__file__).resolve().parents[1]

# Rendered once per configuration — helm template is slow enough that doing it
# per test dominates the runtime of the whole guard suite.
_BASE_ARGS = [
    "--set", "validation.allowPlaceholders=true",
    "--set", "infra.postgres.password=placeholder-for-template-test",
    "--set", "infra.enabled=true",
]

# Both Temporal topologies. The default (auto-setup) renders `temporal`; split
# mode renders `temporal-frontend` and friends and moves the database. A policy
# correct in one and wrong in the other is the likeliest way to get this wrong.
_CONFIGS = {
    "auto-setup": _BASE_ARGS,
    "split": _BASE_ARGS + [
        "--set", "infra.temporal.mode=split",
        "--set", "infra.postgresTemporal.enabled=true",
        "--set", "agentsSubflowWorker.enabled=true",
    ],
}

_SCOPED_INFRA = ["assembly-postgres", "assembly-postgres-temporal", "assembly-redis", "assembly-keycloak", "assembly-temporal", "assembly-temporal-frontend"]

# Container ports, NOT Service ports. NetworkPolicy is evaluated at the pod after
# Service port translation, so keycloak is 8080 even though its Service is 8091.
_INFRA_PORT = {
    "assembly-postgres": 5432,
    "assembly-postgres-temporal": 5432,
    "assembly-redis": 6379,
    "assembly-keycloak": 8080,
    "assembly-temporal": 7233,
    "assembly-temporal-frontend": 7233,
}


def _render(args: list[str]) -> list[dict]:
    result = subprocess.run(
        ["helm", "template", "t", str(_CHART), *args],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        pytest.fail(f"helm template failed: {result.stderr[:400]}")
    return [d for d in yaml.safe_load_all(result.stdout) if d]


@pytest.fixture(scope="module", params=list(_CONFIGS), ids=list(_CONFIGS))
def rendered(request):
    return _render(_CONFIGS[request.param])


def _policies(docs: list[dict]) -> dict[str, dict]:
    return {d["metadata"]["name"]: d for d in docs if d.get("kind") == "NetworkPolicy"}


def _workloads(docs: list[dict]) -> dict[str, dict]:
    """app label -> pod template spec, for every Deployment/StatefulSet/Job."""
    out = {}
    for d in docs:
        if d.get("kind") not in ("Deployment", "StatefulSet", "Job"):
            continue
        tpl = d["spec"]["template"]
        app = tpl["metadata"].get("labels", {}).get("app")
        if app:
            out[app] = tpl
    return out


def _clients_of(policy: dict) -> set[str]:
    apps = set()
    for rule in policy["spec"].get("ingress", []) or []:
        for src in rule.get("from", []) or []:
            app = src.get("podSelector", {}).get("matchLabels", {}).get("app")
            if app:
                apps.add(app)
    return apps


def _needs(tpl: dict) -> set[str]:
    """Which infra this pod is actually wired to, read off its rendered spec.

    Keyed on the concrete wiring the chart emits — the `database-url` /
    `redis-url` secret keys and the in-cluster hostnames — rather than on
    service names appearing anywhere in the blob, which produced false hits on
    a component's own name.
    """
    needs: set[str] = set()
    containers = tpl["spec"].get("containers", []) + tpl["spec"].get("initContainers", [])
    for c in containers:
        text = " ".join(map(str, c.get("command", []) or [])) + " " + " ".join(map(str, c.get("args", []) or []))
        for e in c.get("env", []) or []:
            if e.get("value") is not None:
                text += f" {e['name']}={e['value']}"
            # BOTH indirection kinds. Reading only secretKeyRef made this miss
            # REDIS_URL — which comes from a ConfigMap, not the platform secret —
            # so a policy that scoped redis and stranded every engine worker
            # still passed. A dependency scanner with a blind spot is worse than
            # none, because it certifies the thing it cannot see.
            vf = e.get("valueFrom") or {}
            ref = (
                vf.get("secretKeyRef", {}).get("key")
                or vf.get("configMapKeyRef", {}).get("key")
            )
            if ref:
                text += f" {e['name']}<-{ref}"
        for src in c.get("envFrom", []) or []:
            name = (
                src.get("secretRef", {}).get("name")
                or src.get("configMapRef", {}).get("name")
                or ""
            )
            text += f" envFrom={name}"

        if "database-url" in text or "postgres:5432" in text or "KC_DB_URL" in text:
            needs.add("assembly-postgres")
        if "postgres-temporal:5432" in text:
            needs.add("assembly-postgres-temporal")
        if "redis-url" in text or "redis:6379" in text:
            needs.add("assembly-redis")
        if "keycloak:8091" in text:
            needs.add("assembly-keycloak")
        if "temporal:7233" in text or "temporal-frontend:7233" in text:
            needs.add("assembly-temporal")
    return needs


class TestInfraIsCarvedOutOfTheBlanketAllow:
    def test_scoped_infra_is_excluded(self, rendered):
        blanket = _policies(rendered)["t-data-assembly-allow-app-same-namespace-ingress"]
        excluded = set()
        for expr in blanket["spec"]["podSelector"].get("matchExpressions", []):
            if expr["operator"] == "NotIn":
                excluded |= set(expr["values"])

        assert set(_SCOPED_INFRA) <= excluded, (
            f"not carved out of the blanket allow: {sorted(set(_SCOPED_INFRA) - excluded)}. "
            "Any app-labelled pod can reach these, which is the lateral-movement "
            "path this policy set exists to close."
        )

    @pytest.mark.parametrize("component", _SCOPED_INFRA)
    def test_each_excluded_component_has_a_policy_readmitting_it(self, rendered, component):
        """Excluding without re-admitting black-holes the component entirely."""
        policies = _policies(rendered)
        selecting = [
            name for name, p in policies.items()
            if component in _selected_apps(p) and name != "t-data-assembly-allow-app-same-namespace-ingress"
        ]
        assert selecting, (
            f"{component} is excluded from the blanket allow but NO *-access policy "
            f"selects it — it would be unreachable by everything."
        )


def _selected_apps(policy: dict) -> set[str]:
    sel = policy["spec"].get("podSelector", {})
    apps = set()
    if "app" in sel.get("matchLabels", {}):
        apps.add(sel["matchLabels"]["app"])
    for expr in sel.get("matchExpressions", []) or []:
        if expr.get("key") == "app" and expr["operator"] == "In":
            apps |= set(expr["values"])
    return apps


def _excluded_from_blanket(policies: dict[str, dict]) -> set[str]:
    """Apps carved out of the blanket same-namespace allow, as RENDERED.

    Read from the chart output rather than from `_SCOPED_INFRA`, because the two
    answer different questions. `_SCOPED_INFRA` is the intended end state, which
    the isolation tests assert. Reachability has to model what the cluster will
    actually do — and using the intended list here made the invariants report a
    severed client on a policy set that severs nothing.
    """
    blanket = policies.get("t-data-assembly-allow-app-same-namespace-ingress")
    if blanket is None:
        return set()
    excluded: set[str] = set()
    for expr in blanket["spec"]["podSelector"].get("matchExpressions", []) or []:
        if expr.get("key") == "app" and expr["operator"] == "NotIn":
            excluded |= set(expr["values"])
    return excluded


def _can_reach(policies: dict[str, dict], client: str, component: str) -> bool:
    """Would `client` be admitted to `component` by the rendered policy set?

    Both routes the cluster offers: a scoped `*-access` policy naming the
    client, or the blanket same-namespace allow for any component not carved
    out of it.
    """
    targets = ["assembly-temporal", "assembly-temporal-frontend"] if component == "assembly-temporal" else [component]
    excluded = _excluded_from_blanket(policies)

    for target in targets:
        # Route 1: carved out, and re-admitted by name.
        for policy in policies.values():
            if target in _selected_apps(policy) and client in _clients_of(policy):
                return True
        # Route 2: never carved out, so the blanket allow still covers it.
        if target not in excluded:
            return True
    return False


class TestNothingLegitimateIsSevered:
    """The half that matters: tight policies that break the platform are worse.

    These are INVARIANTS, not new behaviour — they hold before this change and
    after it, and they are meant to. They exist to catch the failure mode where
    scoping a component silently strands one of its clients, which surfaces only
    on the first cluster where a policy engine is switched on.

    Expectations are derived from the rendered pod specs, so a new service wired
    to `database-url` without a corresponding policy entry fails HERE.
    """

    def test_every_wired_dependency_is_permitted(self, rendered):
        policies = _policies(rendered)

        missing = [
            f"{app} -> {component}"
            for app, tpl in sorted(_workloads(rendered).items())
            for component in sorted(_needs(tpl))
            if not _can_reach(policies, app, component)
        ]

        assert not missing, (
            "these pods are wired to infra they can no longer reach:\n  "
            + "\n  ".join(missing)
        )

    @pytest.mark.parametrize(
        "job,component",
        [
            ("assembly-postgres-init", "assembly-postgres"),
            ("assembly-core-migrate", "assembly-postgres"),
            ("assembly-temporal-schema-migrate", "assembly-postgres"),
            ("assembly-temporal-table-tuning", "assembly-postgres"),
            ("assembly-temporal-namespace-setup", "assembly-temporal"),
        ],
    )
    def test_bootstrap_jobs_keep_their_access(self, rendered, job, component):
        """Bootstrap Jobs poll in `until` loops — losing access HANGS a fresh install.

        They do not crash and they emit no useful error; the install simply
        never finishes. #2128 labelled these Jobs so the blanket allow could
        match them at all; this asserts the scoped policies did not then quietly
        take that access back.
        """
        if job not in _workloads(rendered):
            pytest.skip(f"{job} not rendered in this configuration")

        assert _can_reach(_policies(rendered), job, component), (
            f"bootstrap job {job!r} cannot reach {component!r} — a fresh install "
            f"would hang forever in its until-loop with no error"
        )


class TestPortsAreEvaluatedAtThePod:
    @pytest.mark.parametrize("component", _SCOPED_INFRA)
    def test_policy_names_the_container_port(self, rendered, component):
        """Service port != container port, and the policy sees the container port.

        Keycloak is the live example: Service 8091 -> targetPort 8080. A policy
        written against 8091 matches nothing and locks out every client, while
        looking entirely reasonable in review. Same trap the apisix policy
        documents for 9080/9443.
        """
        policies = _policies(rendered)
        expected = _INFRA_PORT[component]

        ports = {
            p.get("port")
            for policy in policies.values() if component in _selected_apps(policy)
            for rule in policy["spec"].get("ingress", []) or []
            for p in rule.get("ports", []) or []
        }
        if not ports:
            pytest.skip(f"{component} not rendered in this configuration")
        assert expected in ports, (
            f"{component}: policy allows {sorted(ports)} but the pod listens on "
            f"{expected}. Check you used the container port, not the Service port."
        )


class TestTheSandboxNeedsNothing:
    def test_sandbox_execute_reaches_no_scoped_infra(self, rendered):
        """The pod that runs untrusted user code should need no infra at all.

        `assembly-sandbox-execute` talks only to assembly-core over HTTP — it has
        no database, cache, identity or workflow credentials in its spec. Worth
        asserting rather than assuming: if a future change wires it to Postgres,
        that is a security decision that deserves to be noticed, not a silent
        widening of the blast radius of a `custom_code` escape.
        """
        workloads = _workloads(rendered)
        tpl = workloads.get("assembly-sandbox-execute")
        if tpl is None:
            pytest.skip("sandbox-execute not rendered in this configuration")

        assert _needs(tpl) == set(), (
            f"sandbox-execute is now wired to {sorted(_needs(tpl))}. It runs "
            f"untrusted code; giving it infra credentials widens what a sandbox "
            f"escape reaches."
        )

    def test_sandbox_execute_is_not_a_client_of_any_scoped_policy(self, rendered):
        policies = _policies(rendered)
        granting = [
            name for name, p in policies.items()
            if "assembly-sandbox-execute" in _clients_of(p)
        ]
        assert not granting, (
            f"sandbox-execute was granted infra access by: {granting}. "
            f"It needs none."
        )
