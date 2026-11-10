"""Guards for the InvHub-compat APISIX routes: health route + per-route CORS.

InvHub's health indicator GETs /webhook-service/release/0.0.0/health (the
releaseId is always 0.0.0, derived from EUREKA_FLOWS with no override); without
a dedicated route it proxies unrewritten to sandbox-trigger and 404s. Browser
-direct InvHub calls (narrative agent + the eureka-auth get-token POST) need
CORS headers on the responses, which the global cors plugin alone does not
provide safely: APISIX merges the GLOBAL cors defaults (expose_headers "*" +
allow_credential true) into a route-level cors config, and that merged combo
FAILS schema validation -- APISIX standalone then SILENTLY DROPS the route
(falls through to the frontend catch-all -> 405). Production-verified on
dev-assembly. Hence every route-level cors block must define EVERY key and
keep allow_credential false.

Origins are values-driven via apisix.cors.allowOriginsRegex (one knob for the
global block and all per-route blocks).
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
ROUTES_FILE = CHART / "files" / "apisix-routes.yaml"

DEFAULT_ORIGIN_REGEXES = [
    "^http://localhost(?::(?:80|3000|5173))?$",
    r"^https://[^/]+\.app\.github\.dev$",
]

CORS_ROUTE_IDS = [
    "assembly-eureka-auth-token",
    "webhook-service-compat-proxy",
    "webhook-compat-proxy",
]

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _render_routes(*extra_args: str) -> tuple[dict, str]:
    """Render only the apisix-routes ConfigMap; return (parsed routes yaml, raw payload text)."""
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "-s", "templates/configmap-apisix-routes.yaml",
            "--set", "validation.allowPlaceholders=true",
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    cm = next(d for d in yaml.safe_load_all(r.stdout) if d and d["kind"] == "ConfigMap")
    payload = cm["data"]["apisix-routes.yaml"]
    return yaml.safe_load(payload), payload


def _route(routes: dict, route_id: str) -> dict:
    matches = [rt for rt in routes["routes"] if rt.get("id") == route_id]
    assert len(matches) == 1, f"route {route_id}: expected exactly 1, found {len(matches)}"
    return matches[0]


def _global_cors(routes: dict) -> dict:
    matches = [p for p in routes["plugins"] if p.get("name") == "cors"]
    assert len(matches) == 1, "expected exactly one global cors plugin entry"
    return matches[0]["config"]


def test_webhook_service_health_route():
    routes, _ = _render_routes()
    rt = _route(routes, "webhook-service-health")
    # Exact uri (no uris list, no vars): APISIX standalone's tinyyaml crashes
    # on the nested inline arrays a `vars` matcher needs, so the route must be
    # expressible as a plain full-match uri.
    assert rt.get("uri") == "/webhook-service/release/0.0.0/health"
    assert "uris" not in rt
    assert "vars" not in rt
    assert rt.get("priority") == 100
    assert rt["plugins"]["proxy-rewrite"]["uri"] == "/api/v1/health"
    assert "t-data-assembly-core:8000" in rt["upstream"]["nodes"]


def test_health_route_defined_before_compat_proxy():
    """Keep the exact health route above the /webhook-service/* compat proxy."""
    text = ROUTES_FILE.read_text()
    health = text.find("id: webhook-service-health")
    compat = text.find("id: webhook-service-compat-proxy")
    assert health != -1, "webhook-service-health route missing from files/apisix-routes.yaml"
    assert compat != -1
    assert health < compat, "health route must be defined before webhook-service-compat-proxy"


def test_per_route_cors_credential_safe():
    routes, _ = _render_routes()
    for route_id in CORS_ROUTE_IDS:
        rt = _route(routes, route_id)
        cors = rt["plugins"].get("cors")
        assert cors is not None, f"route {route_id} must carry a route-level cors plugin"
        # Every key must be defined explicitly, otherwise the global cors
        # defaults merge in and the expose_headers "*" + allow_credential true
        # combination fails schema validation -> silent route drop -> 405.
        for key in (
            "allow_origins_by_regex",
            "allow_methods",
            "allow_headers",
            "expose_headers",
            "allow_credential",
        ):
            assert key in cors, f"route {route_id} cors must define {key}"
        assert cors["allow_credential"] is False, f"route {route_id} cors allow_credential must be false"
        for key in ("allow_methods", "allow_headers", "expose_headers"):
            assert cors[key] != "*", f"route {route_id} cors {key} must be concrete, not '*'"


def test_cors_origins_flow_from_values(tmp_path):
    """apisix.cors.allowOriginsRegex must drive the global AND per-route origins."""
    extra_origin = r"^https://copilot\.invhub\.example$"
    values = tmp_path / "cors.yaml"
    values.write_text(
        yaml.safe_dump(
            {"apisix": {"cors": {"allowOriginsRegex": DEFAULT_ORIGIN_REGEXES + [extra_origin]}}}
        )
    )
    routes, _ = _render_routes("-f", str(values))
    assert extra_origin in _global_cors(routes)["allow_origins_by_regex"]
    for route_id in CORS_ROUTE_IDS:
        cors = _route(routes, route_id)["plugins"]["cors"]
        assert extra_origin in cors["allow_origins_by_regex"], (
            f"route {route_id} cors origins must come from apisix.cors.allowOriginsRegex"
        )


def test_global_cors_default_render_unchanged():
    """Default render of the global cors block must stay byte-stable.

    The origins are emitted with `squote` because the default regexes carry
    `\\.` -- valid in single-quoted YAML, an invalid escape in double-quoted
    YAML. This test locks both the parsed values and the exact single-quoted
    source lines so a quoting refactor can't silently change the rendered
    ConfigMap for existing deployments.
    """
    routes, payload = _render_routes()
    assert _global_cors(routes)["allow_origins_by_regex"] == DEFAULT_ORIGIN_REGEXES
    assert "- '^http://localhost(?::(?:80|3000|5173))?$'" in payload
    assert r"- '^https://[^/]+\.app\.github\.dev$'" in payload


def test_no_inline_nested_arrays_in_routes_file():
    """APISIX standalone parses its config with tinyyaml, which crashes the pod
    on nested inline arrays (e.g. vars: [["uri","~~","..."]]). Block-style
    nested sequences are fine; the flow-style `[[` form must never appear."""
    assert "[[" not in ROUTES_FILE.read_text()
