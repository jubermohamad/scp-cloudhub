"""Static guard for #1588: a genuinely-unmatched /api/* path must get a fast,
explicit 404 from APISIX itself, not fall through to the frontend catch-all
(`uri: /*`) and hang. The frontend's own nginx.conf has an `/api` proxy_pass
to a docker-compose-only upstream name that doesn't exist in this chart's
topology, so a request forwarded there hangs until nginx's own generous
proxy_read_timeout (300s) instead of failing fast.

The `echo` plugin used here must be enabled in TWO places for correctness:
`configmap-apisix.yaml`'s `config.yaml` `plugins:` list (the system-level
plugin whitelist -- confirmed live: this is what the actual running APISIX
instance's `/usr/local/apisix/conf/config.yaml` reflects) AND declared in
`apisix-routes.yaml`'s own bottom-of-file `plugins:` list. Empirically,
`echo` was observed to function correctly live even before the
`config.yaml` addition -- APISIX 3.8.0's standalone/config-sync mode
appears to load a plugin referenced in the routes data file's own `plugins:`
list independent of `config.yaml`'s whitelist -- but `config.yaml` is the
documented, canonical mechanism and was added for correctness/determinism
regardless of that observed behavior.

This is a CONFIG-TEXT check only -- it cannot prove the live routing/latency
behavior (radix-tree route priority, actual response time). That was
verified live on `assembly-perf-small` (redeployed clean, from only the
committed diff): unmatched /api/* now returns 404 in under 30ms (down from a
10s+ hang), while real /api/... routes and genuine SPA client routes (which
must still fall through to the frontend catch-all) were unaffected.
"""

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_ROUTES_FILE = _REPO_ROOT / "helm" / "assembly-workflows" / "files" / "apisix-routes.yaml"
_CONFIGMAP_TEMPLATE = (
    _REPO_ROOT / "helm" / "assembly-workflows" / "templates" / "configmap-apisix.yaml"
)


def test_echo_plugin_enabled_in_configmap_apisix_whitelist():
    text = _CONFIGMAP_TEMPLATE.read_text(encoding="utf-8")
    # Scope to the `plugins:` block specifically, not just anywhere in the file,
    # so this doesn't pass on an unrelated stray mention of "echo".
    start = text.index("plugins:")
    end = text.index("nginx_config:", start)
    block = text[start:end]
    assert "- echo" in block, (
        "the api-not-found route's echo plugin (#1588) must be enabled in "
        "configmap-apisix.yaml's config.yaml plugins whitelist -- this is "
        "the canonical, documented mechanism controlling which plugins the "
        "real APISIX instance loads (confirmed against the live pod's "
        "/usr/local/apisix/conf/config.yaml)"
    )


def test_api_not_found_route_exists_before_frontend_catchall():
    text = _ROUTES_FILE.read_text(encoding="utf-8")

    assert "id: api-not-found" in text, (
        "missing the api-not-found route (#1588) -- unmatched /api/* paths "
        "will fall through to the frontend catch-all and hang instead of "
        "getting a fast 404"
    )
    assert "uri: /api/*" in text, "api-not-found route must match uri: /api/*"

    not_found_pos = text.index("id: api-not-found")
    frontend_pos = text.index("id: frontend")
    assert not_found_pos < frontend_pos, (
        "api-not-found route must be defined before the frontend catch-all "
        "route (both match overlapping paths; while APISIX's radix-tree "
        "matching is priority/specificity-based rather than strictly "
        "declaration-order, keeping the more-specific route defined first "
        "in the file matches every other route's convention here)"
    )

    # The route must actually short-circuit (echo) rather than proxy to a
    # real upstream that could itself hang -- and it needs SOME upstream
    # configured (a formality target only) since APISIX 503s a route with a
    # plugin but no upstream block at all.
    fragment = text[not_found_pos : frontend_pos]
    assert "echo:" in fragment, (
        "api-not-found route must use the echo plugin to short-circuit "
        "before any upstream call"
    )
    assert "upstream:" in fragment, (
        "api-not-found route needs a formality upstream block -- APISIX "
        "returns 503 'missing upstream configuration' for a route with a "
        "plugin but no upstream at all, even when that plugin (echo) would "
        "otherwise short-circuit before ever reaching it"
    )
    assert "status_code: 404" in fragment, (
        "api-not-found route's echo plugin must return 404, not APISIX's "
        "default 503 for a route with no reachable upstream"
    )
