"""Guard: externalInfra.keycloak.realm is honoured EVERYWHERE.

The realm value fed the frontend / llm-gateway / expected-issuer / flows Job, but
the realm SEED JSON and every APISIX OIDC route + the eureka-auth rewrite target
hardcoded `assembly-platform`, so a non-default realm half-applied and broke
gateway auth. This threads the value through the seed and the routes ConfigMap.
Default (assembly-platform) render is byte-equivalent (regression).
"""

import pathlib
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
REALM = "acme-realm"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")


def _render(realm: str) -> str:
    r = subprocess.run(
        [
            "helm", "template", "t", str(CHART),
            "--set", "infra.enabled=true",
            "--set", "infra.postgres.password=test-pg",
            "--set", f"externalInfra.keycloak.realm={realm}",
            "--set", "validation.allowPlaceholders=true",
        ],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout


def _cm(rendered: str, name: str) -> str:
    for doc in yaml.safe_load_all(rendered):
        if doc and doc.get("kind") == "ConfigMap" and doc["metadata"]["name"] == name:
            return "\n".join(str(v) for v in doc.get("data", {}).values())
    raise AssertionError(f"ConfigMap {name} not found")


def test_realm_threads_into_seed_and_routes():
    rendered = _render(REALM)
    seed = _cm(rendered, "t-data-assembly-keycloak-realm")
    assert f'"realm": "{REALM}"' in seed and f'"id": "{REALM}"' in seed
    assert '"realm": "assembly-platform"' not in seed and '"id": "assembly-platform"' not in seed

    routes = _cm(rendered, "t-data-assembly-apisix-routes")
    assert f"realms/{REALM}/" in routes            # discovery URLs + eureka rewrite
    assert f"realm: {REALM}" in routes             # per-route oidc realm field
    assert "realms/assembly-platform/" not in routes
    assert "realm: assembly-platform" not in routes
    # client_id is a separate concept and must NOT be rewritten by the realm value.
    assert "client_id: assembly-platform-backend" in routes


def test_default_realm_render_unchanged():
    rendered = _render("assembly-platform")
    seed = _cm(rendered, "t-data-assembly-keycloak-realm")
    routes = _cm(rendered, "t-data-assembly-apisix-routes")
    assert '"realm": "assembly-platform"' in seed
    assert "realms/assembly-platform/" in routes
    assert "realm: assembly-platform" in routes
