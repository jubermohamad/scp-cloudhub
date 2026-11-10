# Keycloak Setup (for this chart)

What must be configured in Keycloak for Lens auth (`authEnabled=true`, the
chart default). Validated against a real QA realm. This is the
IdP-side companion to [README.md](./README.md) — the chart's `keycloak.*` values
and `secrets.keycloakClientSecret` must match what you set up here.

## At a glance

| Keycloak object | Purpose |
|---|---|
| **Realm** | Issues + signs the JWTs. Its URL+realm is the token `iss`. |
| **Client `lens`** (public, PKCE) | Browser / user login — console, Swagger UI, and the password-grant CLI. Holds the publish **roles**. |
| **Client `lens-backend`** (confidential) | Service-to-service `client_credentials`. Holds the shared **secret**. |
| **Audience mapper** → `aud: lens` | Both clients must stamp `lens` into `aud`, or every request 401s. |
| **Client roles** `lens:publish:*` / `lens:publish:<App>` | Gate publish/deprecate per application. |

## 1. Realm

Any realm name (e.g. `lens`). The token issuer is
`https://<keycloak-host>/realms/<realm>` — services verify `iss` against it.
→ chart values `keycloak.url`, `keycloak.realm` (and `keycloak.issuer` if the
browser-facing URL differs from the JWKS-fetch URL).

## 2. Client: `lens` (public — browser & users)

Authorization Code + PKCE (console, Swagger) and the password grant (CLIs).
**No client secret.**

| Setting | Value |
|---|---|
| Client ID | `lens` |
| Client authentication | **Off** (public) |
| Standard flow | **On** (Authorization Code) |
| Direct access grants | **On** (enables the username/password token for CLIs) |
| PKCE (Advanced → Proof Key) | `S256` |
| **Valid redirect URIs** | `https://<host>/*` and `https://<host>/api/v1/*/oauth2-redirect` (Swagger's PKCE callback for every service) |
| **Web origins** | `https://<host>` (CORS; also set `keycloak.allowOrigins`) |

Keycloak writes this client's roles under `resource_access.lens.roles`, read by
the backend (`keycloak.clientId=lens`).

> Missing redirect URI → Swagger/console login fails with **Invalid
> redirect_uri**. Direct Access Grants off → password grant returns
> `unauthorized_client`.

## 3. Client: `lens-backend` (confidential — services)

`client_credentials` for service-to-service (MCP CC mode; compile/execute/AI
minting outbound tokens).

| Setting | Value |
|---|---|
| Client ID | `lens-backend` |
| Client authentication | **On** (confidential) |
| Service accounts roles | **On** (enables `client_credentials`) |
| Credentials → Secret | → chart `secrets.keycloakClientSecret` (secret key `keycloak-client-secret`) |

→ chart value `keycloak.serviceClientId=lens-backend`. Assign the service account
any `lens:publish:*` role it needs (a bare service account reads but 403s on
publish — by design).

## 4. Audience mapper (critical)

Lens verifies `aud` contains `lens` (`keycloak.audience=lens`). Keycloak defaults
to `aud: account`, so **add an Audience mapper** stamping `lens` into the access
token — on both clients (simplest: a **client scope** with an "Audience" mapper,
set as a default scope on `lens` and `lens-backend`).

Mapper: type **Audience**, *Included Client Audience* = `lens`, *Add to access
token* = on.

> Symptom if missing: every authenticated request → **401 Invalid audience**.
> Alternative: set `keycloak.audience=""` to skip aud verification.

## 5. Publish roles (authorization)

Publish/deprecate is gated per application. Create **client roles on `lens`**:

- `lens:publish:*` — publish/deprecate any concept.
- `lens:publish:<App>` — one per application: `CoreBanking`, `AML`, `Sanctions`,
  `KYC`, `RegReporting`, `Fraud`, `CreditRisk`, `CollateralMgmt`,
  `WatchlistMgmt`, `CRM`, `CreditOrigination`, `ReferenceData`.

Assign to users/groups (or the `lens-backend` service account). A concept is
gated by its lead `domain:<App>` tag; the token must carry the matching role or
the request returns **403** naming the missing scope.

> **QA status (as of now):** the `keycloak.setup` Job (see `values.yaml`) has
> created these roles in the QA realm, but none are assigned to a principal
> yet, so publish/deprecate still returns **403** — expected until an admin
> assigns them to a user, group, or the `lens-backend` service account.
> (Keycloak config, not a Lens code change.)

## 6. Keycloak → chart values

| Keycloak | Chart value / secret |
|---|---|
| realm URL | `keycloak.url` + `keycloak.realm` |
| browser-facing issuer (if it differs from `url`) | `keycloak.issuer` |
| audience stamped by the mapper | `keycloak.audience` (`lens`) |
| `lens` client id | `keycloak.clientId` |
| `lens-backend` client id | `keycloak.serviceClientId` |
| `lens-backend` secret | `secrets.keycloakClientSecret` (key `keycloak-client-secret`) |
| ingress origin | `keycloak.allowOrigins` (CORS) |

## 7. Verify

```bash
KC=https://<keycloak-host>; REALM=<realm>; BASE=https://<host>

# Service token — check aud contains "lens" and iss matches
TOKEN=$(curl -s "$KC/realms/$REALM/protocol/openid-connect/token" \
  -d grant_type=client_credentials -d client_id=lens-backend \
  -d client_secret="$KEYCLOAK_CLIENT_SECRET" | jq -r .access_token)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '{iss,aud}'

# Registry: 401 without, 200 with
curl -s -o /dev/null -w "no-token: %{http_code}\n" "$BASE/api/v1/registry/v1/concepts"
curl -s -o /dev/null -w "token:    %{http_code}\n" "$BASE/api/v1/registry/v1/concepts" \
  -H "Authorization: Bearer $TOKEN"
```

Expect `aud` to include `lens`, `iss` = `$KC/realms/$REALM`, then `401` / `200`.
For token usage and MCP-with-a-token, see the platform docs
(`docs/reference/authentication`, `docs/reference/mcp`).
