"""The NetworkPolicy set must not deny traffic the platform depends on.

These policies are a trap of a specific kind: `networkPolicies.enabled` defaults
to **true**, so they are ALREADY DEPLOYED on dev and perf-medium — and they are
completely inert, because no policy engine runs there (#2111). Nothing tells you
they are wrong. The day someone enables Calico they begin enforcing, all at once,
and whatever they deny goes down at that moment rather than at review time.

So the chart cannot be checked by reading the policies alone. It has to be
checked by asking, of every path the platform actually needs: **would this
survive enforcement?** Two such paths, both of which were broken on main:

1. **External traffic to a LoadBalancer.** `default-deny-ingress` selects every
   pod; `allow-app-same-namespace-ingress` re-allows only pod->pod *inside the
   namespace*. Traffic arriving from the internet has no pod source, so no rule
   matches it and it is denied. APISIX on dev is a public LoadBalancer, which
   means enabling the engine takes the public URL offline. Demo carries an extra
   `allow-apisix-public-ingress` policy for exactly this; the chart had no
   equivalent.

2. **Pods with no `app` label.** The same-namespace allow is written in terms of
   `app` Exists on BOTH ends, so a pod without that label can neither receive
   traffic nor originate it to anything that is selected. `postgres-init` and
   `temporal-namespace-setup` had no pod labels at all, and both are `until`
   loops against Postgres and `temporal:7233` — under enforcement they would not
   fail, they would **hang forever**, so a fresh install would simply never
   finish coming up.

Asserted on RENDERED output across every values overlay, because whether APISIX
is a LoadBalancer at all is an overlay decision (`ClusterIP` in base,
`LoadBalancer` on dev/demo/public-perf).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

_CHART = Path(__file__).resolve().parents[1]
_VALUES = sorted(_CHART.glob("values*.yaml"))

# Service types that can be reached from outside the cluster, i.e. by a source
# that is not a pod and therefore matches no `podSelector`.
_EXTERNALLY_REACHABLE = ("LoadBalancer", "NodePort")


def _render(values_file: Path) -> list[dict]:
    result = subprocess.run(
        [
            "helm", "template", "t", str(_CHART),
            "-f", str(values_file),
            "--set", "validation.allowPlaceholders=true",
            "--set", "infra.postgres.password=placeholder-for-template-test",
        ],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        pytest.fail(f"helm template failed for {values_file.name}: {result.stderr[:400]}")
    return [d for d in yaml.safe_load_all(result.stdout) if d]


def _pod_template(doc: dict) -> dict | None:
    """The pod template of any workload kind, or None if it has no pods."""
    kind, spec = doc.get("kind"), doc.get("spec", {})
    if kind == "CronJob":
        return spec.get("jobTemplate", {}).get("spec", {}).get("template")
    if kind in ("Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"):
        return spec.get("template")
    return None


def _ingress_policies(docs: list[dict]) -> list[dict]:
    return [
        d for d in docs
        if d.get("kind") == "NetworkPolicy"
        and "Ingress" in (d["spec"].get("policyTypes") or [])
    ]


def _selects(selector: dict | None, labels: dict) -> bool:
    """Does a podSelector match these labels? Empty/absent selector matches all."""
    if not selector:
        return True
    for key, value in (selector.get("matchLabels") or {}).items():
        if labels.get(key) != value:
            return False
    for expr in selector.get("matchExpressions") or []:
        key, op = expr["key"], expr["operator"]
        if op == "Exists" and key not in labels:
            return False
        if op == "DoesNotExist" and key in labels:
            return False
        if op == "In" and labels.get(key) not in expr.get("values", []):
            return False
        if op == "NotIn" and labels.get(key) in expr.get("values", []):
            return False
    return True


def _admits_external(policy: dict, port: int) -> bool:
    """True if this policy admits traffic to `port` from a NON-POD source.

    An ingress rule with no `from` admits every source, including the internet.
    A rule whose `from` is entirely podSelector/namespaceSelector cannot match
    external traffic no matter what ports it lists — which is precisely why
    `allow-app-same-namespace-ingress` does not save the LoadBalancer.
    """
    for rule in policy["spec"].get("ingress") or []:
        sources = rule.get("from")
        if sources:
            external_capable = any("ipBlock" in src for src in sources)
            if not external_capable:
                continue
        ports = rule.get("ports")
        if not ports:
            return True  # no port restriction => all ports
        for entry in ports:
            if entry.get("port") in (port, None):
                return True
    return False


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_every_externally_reachable_service_survives_the_deny(values_file: Path):
    """The class of bug, not the one instance.

    Any future LoadBalancer/NodePort added without a matching ingress allow is
    an outage the moment a policy engine is switched on. Catch it at render time.
    """
    docs = _render(values_file)
    policies = _ingress_policies(docs)
    if not policies:
        pytest.skip("no ingress policies rendered; nothing would be denied")

    for doc in docs:
        if doc.get("kind") != "Service":
            continue
        if doc["spec"].get("type") not in _EXTERNALLY_REACHABLE:
            continue

        name = doc["metadata"]["name"]
        selector = doc["spec"].get("selector") or {}
        # Match the policy against the pods BEHIND the service, via the same
        # labels the Service selects on.
        for port in doc["spec"]["ports"]:
            target = port.get("targetPort", port["port"])
            if not isinstance(target, int):
                continue  # named port; the policy would have to name it too
            admitting = [
                p["metadata"]["name"]
                for p in policies
                if _selects(p["spec"].get("podSelector"), selector)
                and _admits_external(p, target)
            ]
            assert admitting, (
                f"{values_file.name}: Service {name!r} is {doc['spec']['type']} on "
                f"port {port['port']} -> {target}, but NO NetworkPolicy admits "
                f"external traffic to that port. External traffic has no pod "
                f"source, so `allow-app-same-namespace-ingress` cannot match it. "
                f"The moment a policy engine is enabled (#2111) this service "
                f"stops answering."
            )


@pytest.mark.parametrize("values_file", _VALUES, ids=lambda p: p.name)
def test_every_pod_carries_the_label_the_allow_rule_keys_on(values_file: Path):
    """A pod with no `app` label is isolated in BOTH directions.

    `allow-app-same-namespace-ingress` requires `app` Exists on the source as
    well as the destination, so an unlabelled pod cannot even initiate to a
    labelled one. For `postgres-init` / `temporal-namespace-setup` — both `until`
    loops — that means hanging forever, not failing, so a fresh install never
    completes and gives no clear reason why.
    """
    docs = _render(values_file)
    if not _ingress_policies(docs):
        pytest.skip("no ingress policies rendered; nothing would be denied")

    unlabelled = []
    for doc in docs:
        template = _pod_template(doc)
        if template is None:
            continue
        labels = (template.get("metadata") or {}).get("labels") or {}
        if "app" not in labels:
            unlabelled.append(f"{doc['kind']}/{doc['metadata']['name']}")

    assert not unlabelled, (
        f"{values_file.name}: pod templates with no `app` label: {unlabelled}. "
        f"Under the rendered policies these can neither receive traffic nor "
        f"reach any pod that is selected, because the same-namespace allow keys "
        f"on `app` Exists at both ends."
    )
