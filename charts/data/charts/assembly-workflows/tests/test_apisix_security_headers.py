"""Regression test for #1532: the APISIX gateway must set baseline security
response headers on every route (clickjacking / MIME-sniff / referrer).

The docker-compose config (infra/apisix/apisix.yaml) carries a global
`response-rewrite` rule that sets the headers, and works fine there because
its `global_rules` has no other `response-rewrite`-using rule to conflict with.

The Helm (cluster) config was DELIBERATELY EXCLUDED here for a while (#1547):
`files/apisix-routes.yaml` ALSO has a pre-existing `sanitize-upstream-5xx`
global rule using `response-rewrite`, and APISIX's response-rewrite plugin
gates its entire behavior -- headers included -- on a single `vars` condition
per plugin instance (see apisix/plugins/response-rewrite.lua). Two global
rules both configuring response-rewrite do not compose the way #1532's
original fix assumed: the 5xx-only body substitution started firing on EVERY
response (including 2xx), with Content-Length left at the real pre-rewrite
length, hanging every client. This config-text-only test suite is exactly why
that regression shipped undetected -- it asserted the rule's *presence*, not
its *live behavior*.

#1584 re-implements the Helm-chart headers via a raw nginx `add_header`
snippet (templates/configmap-apisix.yaml's `http_server_configuration_snippet`)
instead of a second `response-rewrite` global rule -- it never touches
`global_rules` at all, so it can't hit the same composition bug. Live-validated
via curl against a real deployed cluster (see PR description) before merging,
not just this config-text assertion -- config-text-only is exactly how #1534
shipped broken in the first place.
"""

import re
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]

_CONFIGS = [
    _REPO_ROOT / "infra" / "apisix" / "apisix.yaml",
]

_REQUIRED_HEADERS = [
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Content-Security-Policy",
]

_HELM_NGINX_CONFIG = _REPO_ROOT / "helm" / "assembly-workflows" / "templates" / "configmap-apisix.yaml"
_APISIX_ROUTES = _REPO_ROOT / "helm" / "assembly-workflows" / "files" / "apisix-routes.yaml"


@pytest.mark.parametrize("config_path", _CONFIGS, ids=lambda p: p.name)
def test_apisix_config_sets_security_headers(config_path: Path):
    assert config_path.exists(), f"missing APISIX config: {config_path}"
    text = config_path.read_text(encoding="utf-8")

    # The dedicated global rule must be present...
    assert "security-headers" in text, (
        f"{config_path.name}: no 'security-headers' global rule (#1532)"
    )
    # ...applied via response-rewrite...
    assert "response-rewrite" in text
    # ...and set each baseline header.
    for header in _REQUIRED_HEADERS:
        assert header in text, f"{config_path.name}: missing {header} (#1532)"

    # Clickjacking protection must not be the framing-breaking DENY/'none' —
    # the app frames its own preview/docs same-origin.
    assert "SAMEORIGIN" in text, f"{config_path.name}: X-Frame-Options should be SAMEORIGIN"
    assert "frame-ancestors 'self'" in text, f"{config_path.name}: CSP should allow same-origin frames"


def test_helm_chart_sets_security_headers_via_add_header_not_response_rewrite():
    """#1584: the Helm chart's headers must come from nginx add_header, never from a
    2nd response-rewrite global rule (that's the exact #1547 regression class)."""
    assert _HELM_NGINX_CONFIG.exists(), f"missing {_HELM_NGINX_CONFIG}"
    text = _HELM_NGINX_CONFIG.read_text(encoding="utf-8")

    for header in _REQUIRED_HEADERS:
        assert f'add_header {header}' in text, (
            f"configmap-apisix.yaml: missing 'add_header {header}' (#1584)"
        )
    assert "SAMEORIGIN" in text, "X-Frame-Options should be SAMEORIGIN"
    assert "frame-ancestors 'self'" in text, "CSP should allow same-origin frames"
    # "always" is required so headers also apply to non-2xx responses, matching what
    # the reverted global-rule version covered. Match actual directive lines only
    # (not this file's own explanatory comments, which also mention "add_header").
    directive_lines = re.findall(r'^\s*add_header\s+\S+.*$', text, re.MULTILINE)
    assert len(directive_lines) == len(_REQUIRED_HEADERS), (
        f"expected {len(_REQUIRED_HEADERS)} add_header directive lines, found "
        f"{len(directive_lines)}: {directive_lines}"
    )
    assert all(line.rstrip().endswith("always;") for line in directive_lines), (
        f"every add_header line must end in 'always;' so headers apply to error "
        f"responses too, not just 2xx: {directive_lines}"
    )

    # The actual regression-prevention assertion: this file's headers must NOT be
    # implemented via a response-rewrite plugin declaration (that's what broke #1547).
    # Match the YAML plugin-key form specifically, not this file's own prose
    # (comments above legitimately say "response-rewrite" without a trailing colon).
    assert "response-rewrite:" not in text, (
        "configmap-apisix.yaml must not declare a response-rewrite plugin for "
        "security headers (#1547 regression class) -- use nginx add_header instead"
    )


def test_apisix_routes_global_rules_untouched_by_1584():
    """#1584 must not add anything to apisix-routes.yaml's global_rules -- the whole
    point of the nginx-add_header approach is to avoid touching it at all."""
    assert _APISIX_ROUTES.exists(), f"missing {_APISIX_ROUTES}"
    text = _APISIX_ROUTES.read_text(encoding="utf-8")
    # Match the actual rule id line, not the explanatory NOTE comment (#1547) that
    # legitimately mentions "security-headers" by name when describing the revert.
    assert "id: security-headers" not in text, (
        "apisix-routes.yaml must not carry a 'security-headers' global rule -- "
        "headers are implemented via nginx add_header in configmap-apisix.yaml instead "
        "(#1584), specifically to avoid the response-rewrite composition bug (#1547)"
    )
