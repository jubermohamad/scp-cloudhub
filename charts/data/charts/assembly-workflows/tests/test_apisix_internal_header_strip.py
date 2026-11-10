"""Regression test for #118: an unauthenticated external client could forge
X-Internal-Service-Key (the shipped default value) + an arbitrary X-User-ID
through the public gateway and be authenticated as that user by every backend
service's no-bearer-JWT auth fallback -- full cross-user impersonation, no
token required.

The fix strips X-Internal-Service-Key/X-Service-Name/X-User-ID at the APISIX
edge. This repo has FOUR independently-maintained APISIX config sources
(docker-compose, the k8s "base" mirror, the Helm chart used by real
dev-AKS/EKS deploys, and the k8s "workflows" overlay) -- the initial #118 fix
only touched the first two, leaving the Helm-deployed cluster and the
overlay's config still exploitable via the exact same bypass, with nothing in
CI to catch the gap. This test closes that hole: every config source must
strip all three headers.

Merged into the EXISTING `forwarded-proto-rule` (docker-compose/k8s-base) or
`proxy-rewrite`-using global rule (Helm/overlay) rather than added as a new
global_rules entry -- confirmed live that two global_rules entries
configuring the same plugin do NOT compose (only the first-listed one's
plugin config takes effect); see test_apisix_no_duplicate_global_plugins.py
for the accompanying static guard against reintroducing that bug class.
"""

import re
from pathlib import Path

import yaml
import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]

_CONFIGS = [
    _REPO_ROOT / "infra" / "apisix" / "apisix.yaml",
    _REPO_ROOT / "helm" / "assembly-workflows" / "files" / "apisix-routes.yaml",
    _REPO_ROOT / "k8s" / "overlays" / "modules" / "workflows" / "config" / "apisix-routes.yaml",
]

_STRIPPED_HEADERS = [
    "X-Internal-Service-Key",
    "X-Service-Name",
    "X-User-ID",
]

# Same fragment-extraction approach as test_apisix_no_duplicate_global_plugins.py:
# some of these files use APISIX's `vars: [[key, op, value], ...]` list-as-dict-key
# syntax elsewhere, which breaks a naive whole-document yaml.safe_load.
_GLOBAL_RULES_BLOCK = re.compile(
    r"^global_rules:\n((?:[ \t].*\n?|\n)*)", re.MULTILINE
)


def _load_global_rules(config_path: Path) -> list[dict]:
    text = config_path.read_text(encoding="utf-8")
    match = _GLOBAL_RULES_BLOCK.search(text)
    if not match:
        return []
    fragment = "global_rules:\n" + match.group(1)
    doc = yaml.safe_load(fragment)
    return (doc or {}).get("global_rules") or []


@pytest.mark.parametrize("config_path", _CONFIGS, ids=lambda p: p.name)
def test_internal_trust_headers_stripped_on_every_config_source(config_path: Path):
    assert config_path.exists(), f"missing APISIX config: {config_path}"
    global_rules = _load_global_rules(config_path)

    removed: set[str] = set()
    for rule in global_rules:
        proxy_rewrite = (rule.get("plugins") or {}).get("proxy-rewrite") or {}
        removed.update((proxy_rewrite.get("headers") or {}).get("remove") or [])

    missing = [h for h in _STRIPPED_HEADERS if h not in removed]
    assert not missing, (
        f"{config_path.name}: global_rules do not strip {missing} (#118) -- an "
        f"external client can forge these to bypass the no-bearer-JWT internal-"
        f"service auth fallback on every backend service reachable through this "
        f"gateway config"
    )


def test_internal_trust_header_strip_shares_the_forwarded_proto_rule():
    """Pins the composition-safe implementation: the header-strip must live in
    the SAME global rule that already configures proxy-rewrite (forwarded-proto
    on docker-compose/k8s-base, forwarded-proto-rule on Helm/overlay), not a
    second one -- see test_apisix_no_duplicate_global_plugins.py."""
    for config_path in _CONFIGS:
        global_rules = _load_global_rules(config_path)
        rules_with_strip = [
            rule["id"]
            for rule in global_rules
            if _STRIPPED_HEADERS[0]
            in ((rule.get("plugins") or {}).get("proxy-rewrite") or {}).get(
                "headers", {}
            ).get("remove", [])
        ]
        assert len(rules_with_strip) == 1, (
            f"{config_path.name}: expected exactly one global rule with the "
            f"header-strip, found {rules_with_strip}"
        )
