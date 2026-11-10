"""Regression test for #218 (reopened): the APISIX gateway must be able to read
Keycloak's large response-header block, and every logout must be able to come back.

Two independent defects produced the same user-visible symptom -- "log out and you get a
500 instead of the login screen" -- with the flavor depending on the environment:

1. **Header buffer.** An *authenticated* `GET /realms/<realm>/protocol/openid-connect/auth`
   (which the SPA hits whenever anything re-triggers login while the SSO session is still
   alive) answers 302 with a header block measured at **4607 bytes** on dev-assembly:
   `KC_RESTART` (1079 B) + `KEYCLOAK_IDENTITY`/`_LEGACY` (757 + 741 B signed JWTs) +
   `KEYCLOAK_SESSION`/`_LEGACY` + `AUTH_SESSION_ID`/`_LEGACY` + four expiry `Set-Cookie`s
   + a ~394 B `Location` carrying the OIDC fragment. nginx's default `proxy_buffer_size`
   is one memory page (4 KB), so nginx aborted the response with
   `upstream sent too big header while reading response header from upstream` -> 502.
   Where `sanitize-upstream-5xx` is configured that 502 reaches the browser as a raw
   `{"error":"internal_server_error","message":"Internal server error"}` page; where it
   isn't, as nginx's plain 502 page. Same bug, two looks.

   #218 was originally closed as "not reproducing" after a browser re-test on the *local*
   stack, where the same response measures ~3.4 KB -- under the 4 KB page only by luck
   (short `http://localhost` redirect_uri, no HSTS header). Its closing comment predicted
   the resurfacing condition exactly: "re-open if a browser login 502 resurfaces (e.g. for
   a user with many roles -> larger KEYCLOAK_IDENTITY cookie)". A longer public hostname
   plus a longer redirect_uri did it. Because a config-text assertion is all that stands
   between this and a silent regression, the buffer is asserted in EVERY APISIX config
   source -- the #118 lesson: this repo has four, and a fix that lands in one leaves the
   others broken with nothing in CI to notice.

2. **`post.logout.redirect.uris` delimiter.** Keycloak stores that client attribute as a
   single **`##`-delimited** string (`OIDCAdvancedConfigWrapper` joins/splits on `##`).
   The Helm realm import joined with commas, so the whole value was one opaque URI that
   matched nothing and Keycloak rejected every logout with its own "Invalid redirect uri"
   error page -- the third flavor of the same report.

Neither assertion proves live behavior (see the header of
test_apisix_security_headers.py for why that distinction has burned this repo before);
both were validated live against dev-assembly before merging.
"""

from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]

# Every APISIX config source that owns an `nginx_config` block. A gateway missing the
# bump 502s on Keycloak's authenticated /auth redirect.
_NGINX_CONFIGS = [
    _REPO_ROOT / "infra" / "apisix" / "config-standalone.yaml",
    _REPO_ROOT / "k8s" / "base" / "infra" / "apisix" / "config-standalone.yaml",
    _REPO_ROOT / "k8s" / "overlays" / "modules" / "workflows" / "apisix-config-override.yaml",
    _REPO_ROOT / "helm" / "assembly-workflows" / "templates" / "configmap-apisix.yaml",
]

# Measured worst case is 4607 B and grows with hostname/redirect_uri length and role
# count, so require materially more than the 4 KB default rather than a token bump.
_MIN_BUFFER_KB = 8

_HELM_REALM_IMPORT = _REPO_ROOT / "helm" / "assembly-workflows" / "templates" / "infra.yaml"
_SEED_REALM = _REPO_ROOT / "scripts" / "keycloak" / "seed-realm.sh"


def _buffer_size_kb(text: str, directive: str) -> int:
    """Parse the kB value out of e.g. `proxy_buffer_size 16k;` / `proxy_buffers 8 16k;`."""
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith(f"{directive} "):
            continue
        # Last token before the ';' carries the size for both directive shapes.
        size = line.rstrip(";").split()[-1].lower()
        assert size.endswith("k"), f"expected a kB size in {line!r}"
        return int(size[:-1])
    return 0


@pytest.mark.parametrize("config_path", _NGINX_CONFIGS, ids=lambda p: str(p.parent.name) + "/" + p.name)
def test_apisix_config_raises_keycloak_response_header_buffer(config_path: Path):
    assert config_path.exists(), f"missing APISIX config: {config_path}"
    text = config_path.read_text(encoding="utf-8")

    buffer_size = _buffer_size_kb(text, "proxy_buffer_size")
    assert buffer_size >= _MIN_BUFFER_KB, (
        f"{config_path.name}: proxy_buffer_size is {buffer_size or 'unset (nginx default 4k)'} "
        f"-- Keycloak's authenticated /auth 302 header block measures ~4.6 KB and overflows "
        f"it, producing a 502 the user sees as a 500 page after logout (#218)"
    )
    buffers = _buffer_size_kb(text, "proxy_buffers")
    assert buffers >= buffer_size, (
        f"{config_path.name}: proxy_buffers ({buffers}k) must be at least as large as "
        f"proxy_buffer_size ({buffer_size}k)"
    )

    # The directives must be in a raw nginx snippet: APISIX's ngx_tpl.lua renders only the
    # `nginx_config.http` keys it knows by name, so `proxy_buffer_size:` as a YAML key
    # under `http:` looks right and does nothing.
    # (Match YAML-key lines only; the explanatory comments above each snippet legitimately
    # mention `proxy_buffer_size:` when describing this very trap.)
    yaml_key_lines = [
        line for line in text.splitlines() if line.strip().startswith("proxy_buffer_size:")
    ]
    assert not yaml_key_lines, (
        f"{config_path.name}: proxy_buffer_size must be an nginx directive inside a "
        f"*_configuration_snippet, not a `nginx_config.http` YAML key -- APISIX silently "
        f"drops unknown keys there"
    )


def test_helm_realm_import_uses_hash_delimited_post_logout_uris():
    """Keycloak splits post.logout.redirect.uris on '##'; a comma-joined list matches
    nothing and every logout fails with Keycloak's "Invalid redirect uri" page. The realm
    import delegates the value to the aw.keycloak.seedPostLogoutRedirectUris helper (shared
    with the reconcile Job), so the '##' join is asserted at that single source of truth."""
    assert _HELM_REALM_IMPORT.exists(), f"missing {_HELM_REALM_IMPORT}"
    text = _HELM_REALM_IMPORT.read_text(encoding="utf-8")

    attribute_lines = [
        line.strip()
        for line in text.splitlines()
        if '"post.logout.redirect.uris"' in line and ":" in line
    ]
    assert attribute_lines, "infra.yaml no longer sets post.logout.redirect.uris"

    for line in attribute_lines:
        value = line.split(":", 1)[1].strip().rstrip(",")
        # Either the shared '##' seed helper, or a literal that itself uses '##'.
        via_helper = "aw.keycloak.seedPostLogoutRedirectUris" in value
        assert via_helper or "##" in value, (
            f"post.logout.redirect.uris must be '##'-joined (helper or literal): {line}"
        )
        # A comma in an INLINE literal means at least one pair is still comma-joined.
        if not via_helper:
            assert "," not in value.strip('"'), (
                f"post.logout.redirect.uris still contains a comma-joined pair -- Keycloak "
                f"reads the whole string as ONE uri and rejects every logout: {line}"
            )

    # Single source of truth for the join, consumed by both the realm seed and the reconcile
    # Job (aw.keycloak.frontendClientPatchJson): it MUST use '##', never ','.
    helpers = _HELM_REALM_IMPORT.parent / "_helpers.tpl"
    assert helpers.exists(), f"missing {helpers}"
    marker = 'define "aw.keycloak.seedPostLogoutRedirectUris"'
    helper_text = helpers.read_text(encoding="utf-8")
    assert marker in helper_text, "seedPostLogoutRedirectUris helper missing"
    # Scope to this define block (up to the next helper); it has an inner {{- end -}}
    # from the `with`, so splitting on the first {{- end would stop short of the join.
    body = helper_text.split(marker, 1)[1].split("{{- define", 1)[0]
    assert 'join "##"' in body, "seedPostLogoutRedirectUris must join post-logout URIs on '##'"
    assert 'join ","' not in body, (
        "seedPostLogoutRedirectUris still comma-joins -- Keycloak rejects every logout"
    )


def test_seed_realm_uses_hash_delimited_post_logout_uris():
    """Same delimiter rule for the compose/local seeding path."""
    assert _SEED_REALM.exists(), f"missing {_SEED_REALM}"
    text = _SEED_REALM.read_text(encoding="utf-8")
    assert '"##".join(' in text, (
        "seed-realm.sh must join post-logout redirect URIs with '##' (Keycloak's "
        "delimiter), not with a comma"
    )
    assert 'attributes["post.logout.redirect.uris"] = POST_LOGOUT_REDIRECT_URIS' in text
