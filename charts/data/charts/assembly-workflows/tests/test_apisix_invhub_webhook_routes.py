"""Regression guard for #1614 (InvHub legacy webhook drop-in).

The upstream platform calls public ``/webhook/*`` and
``/webhook-service/release/{releaseId}/webhook/*`` paths. Those must be wired on
every maintained APISIX config source (docker-compose, k8s base mirror, Helm
chart for dev-AKS/EKS) with the same rewrite into the sandbox webhook-compat
router — otherwise InvHub works locally but 404s in cluster, or vice versa.

This is a static config-text check (same class as
test_apisix_internal_header_strip.py); it does not prove live routing.
"""

from __future__ import annotations

from pathlib import Path

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]

_YAML_CONFIGS = [
    _REPO_ROOT / "infra" / "apisix" / "apisix.yaml",
    _REPO_ROOT / "k8s" / "base" / "infra" / "apisix" / "apisix.yaml",
]

_HELM_ROUTES = _REPO_ROOT / "helm" / "assembly-workflows" / "files" / "apisix-routes.yaml"

_WEBHOOK_SERVICE_REGEX = r"^/webhook-service/release/[^/]+/webhook/(.*)"
_WEBHOOK_SERVICE_TARGET = "/api/sandbox/api/v1/webhook/$1"
_WEBHOOK_REGEX = r"^/webhook/(.*)"
_WEBHOOK_TARGET = "/api/sandbox/api/v1/webhook/$1"

_HELM_MARKERS = (
    _WEBHOOK_SERVICE_REGEX,
    _WEBHOOK_SERVICE_TARGET,
    _WEBHOOK_REGEX,
    _WEBHOOK_TARGET,
    "/webhook-service",
    "/webhook",
)


def _load_routes(config_path: Path) -> list[dict]:
    doc = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    return list(doc.get("routes") or [])


def _route_uris(route: dict) -> list[str]:
    if "uris" in route:
        return list(route["uris"] or [])
    uri = route.get("uri")
    return [uri] if uri else []


def _regex_uri(route: dict) -> tuple[str, str] | None:
    rewrite = (route.get("plugins") or {}).get("proxy-rewrite") or {}
    pair = rewrite.get("regex_uri")
    if not pair or len(pair) != 2:
        return None
    return str(pair[0]), str(pair[1])


def _find_route_with_rewrite(routes: list[dict], pattern: str, target: str) -> dict | None:
    for route in routes:
        pair = _regex_uri(route)
        if pair == (pattern, target):
            return route
    return None


def _assert_yaml_config_has_invhub_routes(config_path: Path) -> None:
    routes = _load_routes(config_path)

    svc_route = _find_route_with_rewrite(
        routes, _WEBHOOK_SERVICE_REGEX, _WEBHOOK_SERVICE_TARGET
    )
    assert svc_route is not None, (
        f"{config_path.name}: missing InvHub /webhook-service rewrite "
        f"({_WEBHOOK_SERVICE_REGEX} -> {_WEBHOOK_SERVICE_TARGET})"
    )
    svc_uris = _route_uris(svc_route)
    assert any(u.startswith("/webhook-service") for u in svc_uris), (
        f"{config_path.name}: webhook-service route must match /webhook-service "
        f"(got uris={svc_uris!r})"
    )

    hook_route = _find_route_with_rewrite(routes, _WEBHOOK_REGEX, _WEBHOOK_TARGET)
    assert hook_route is not None, (
        f"{config_path.name}: missing /webhook rewrite "
        f"({_WEBHOOK_REGEX} -> {_WEBHOOK_TARGET})"
    )
    hook_uris = _route_uris(hook_route)
    assert any(u.startswith("/webhook") for u in hook_uris), (
        f"{config_path.name}: webhook route must match /webhook (got uris={hook_uris!r})"
    )


def test_release_scope_allows_public_webhook_prefixes():
    scope_path = _REPO_ROOT / "release-scope.yaml"
    doc = yaml.safe_load(scope_path.read_text(encoding="utf-8")) or {}
    allowed = set(doc.get("allowed_apisix_route_prefixes") or [])
    assert "/webhook" in allowed, (
        "release-scope.yaml must allow /webhook — InvHub and Flows-compat clients "
        "hit this prefix on the public gateway"
    )
    assert "/webhook-service" in allowed, (
        "release-scope.yaml must allow /webhook-service — InvHub's hardcoded "
        "release-scoped webhook path must not be blocked by the route allowlist"
    )


def test_invhub_webhook_routes_present_on_parseable_apisix_configs():
    for config_path in _YAML_CONFIGS:
        assert config_path.exists(), f"missing APISIX config: {config_path}"
        _assert_yaml_config_has_invhub_routes(config_path)


def test_helm_apisix_routes_declares_invhub_webhook_rewrites():
    """Helm chart routes embed Go templates — assert by text, not full YAML parse."""
    assert _HELM_ROUTES.exists(), f"missing Helm APISIX routes: {_HELM_ROUTES}"
    text = _HELM_ROUTES.read_text(encoding="utf-8")
    missing = [marker for marker in _HELM_MARKERS if marker not in text]
    assert not missing, (
        f"{_HELM_ROUTES.name}: missing InvHub webhook route markers {missing} — "
        "cluster deploys would not expose the legacy public webhook paths"
    )
