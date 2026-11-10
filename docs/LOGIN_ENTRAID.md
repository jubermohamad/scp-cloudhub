# Entra ID Login Comparison: platform_cloudhub vs log-router

Date captured: 2026-08-13
Scope: Code-level login/auth implementation + Azure App Service configuration

## 1) platform_cloudhub (Backstage app)

### 1.1 Code-level implementation

Primary flow:
- Login is handled by Backstage Microsoft provider (application-level OAuth), not by App Service Easy Auth.
- UI triggers sign-in popup via Backstage Microsoft auth API.
- Backend has Backstage auth backend + Microsoft provider module enabled.

Key files and behavior:
- app-config.yaml
  - auth.providers.microsoft.production uses:
    - AUTH_MICROSOFT_CLIENT_ID
    - AUTH_MICROSOFT_CLIENT_SECRET
    - AUTH_MICROSOFT_TENANT_ID
  - signIn resolvers include:
    - userIdMatchingUserEntityAnnotation
    - emailMatchingUserEntityProfileEmail
  - allows sign-in without catalog user in this file (dangerouslyAllowSignInWithoutUserInCatalog: true)
- app-config.production.yaml
  - same Microsoft provider configuration for production
  - CloudHub production no longer loads the Microsoft Graph org provider, so login does not depend on Graph permissions
- packages/app/src/components/CloudHubSignInPage.tsx
  - custom sign-in page
  - silent auto-login attempt on load
  - popup login via getBackstageIdentity({ instantPopup: true })
  - hard-coded expected callback hint for failures:
    - /api/auth/microsoft/handler/frame
  - explicit user-facing guidance on AADSTS500113 (redirect URI missing)
- packages/backend/src/index.ts
  - registers:
    - @backstage/plugin-auth-backend
    - @backstage/plugin-auth-backend-module-microsoft-provider
  - optional guest provider is feature-flagged via CLOUDHUB_ENABLE_GUEST_AUTH
- packages/backend/src/cloudhubPermissionPolicy.ts
  - post-login authorization is group/persona-based in Backstage permission policy
  - strict mode defaults to deny for unmapped or guest users

Important architecture point:
- In cloudhub, Entra login session is established in Backstage itself (frontend/backend pair), not at App Service edge.

### 1.2 Azure App Service implementation (live)

Web apps:
- cloudhub-frontend (RG: rg-cfe-apps-mj)
- cloudhub-backend (RG: rg-cfe-apps-mj)
- Plan: app-service-cfe (PremiumV2, Linux)

Auth state (live):
- cloudhub-frontend authsettings/authsettingsV2: platform.enabled = false
- cloudhub-backend authsettings/authsettingsV2: platform.enabled = false
- Meaning: App Service Easy Auth is disabled for both cloudhub apps.

Login-critical production app settings required on cloudhub-backend:
- APP_BASE_URL = https://cloudhub.symphonyai.cloud
- BACKEND_BASE_URL = https://cloudhub.symphonyai.cloud
- APP_CONFIG_backend_baseUrl = https://cloudhub.symphonyai.cloud
- APP_CONFIG_auth_providers_microsoft_production_callbackUrl = https://cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame
- AUTH_MICROSOFT_CLIENT_ID set
- AUTH_MICROSOFT_CLIENT_SECRET set
- AUTH_MICROSOFT_TENANT_ID set

Deploy workflow behavior (important):
- Workflow updates Entra app registration redirect URI during deploy.
- Workflow writes auth-related app settings every release.
- The workflow now rejects `.azurewebsites.net` production URL values and never derives auth URLs from an App Service default hostname.

### 1.3 Why cloudhub can break after rebuild/release

Most likely break vectors from the previous design:
- Release-time overwrite risk:
  - Login behavior depends on mutable app settings pushed during deployment each time.
  - A missing `BACKEND_BASE_URL` previously caused the pipeline to derive an Azure default hostname.
- Callback/redirect fragility:
  - If APP_BASE_URL changes, callback URL and app registration redirect must stay perfectly aligned.
  - Any temporary mismatch yields AADSTS500113 or failed popup completion.
- Dual source of truth risk:
  - Backstage config files + APP_CONFIG_* runtime overrides + deployment workflow transformations can diverge.
- Permanent guard:
  - `APP_CONFIG_backend_baseUrl` is now explicitly aligned with the canonical public `APP_BASE_URL`.


## 2) log-router (FastAPI app)

### 2.1 Code-level implementation

Primary flow:
- Sign-in is handled by App Service Easy Auth (edge authentication).
- Application code does not initiate OIDC login redirects or validate tokens directly.
- App only reads Easy Auth principal headers and enforces app-role authorization.

Key files and behavior:
- src/auth.py
  - documents architecture explicitly:
    - Easy Auth performs Entra ID sign-in
    - app receives X-MS-CLIENT-PRINCIPAL and X-MS-CLIENT-PRINCIPAL-NAME
  - decodes principal header payload and extracts role claims
  - enforces two app roles:
    - LogRouter.Admin
    - LogRouter.Reader
  - returns 401 if unauthenticated
  - returns 403 if role missing
- src/config.py
  - auth_enabled: bool = true by default
  - when false (local/dev), app grants local-dev admin context
- route-level enforcement is systematic across web routes:
  - reader dependencies for read pages
  - admin dependencies for write/admin actions

Important architecture point:
- In log-router, app assumes identity has already been established upstream by App Service.

### 2.2 Azure App Service implementation (live)

Web app:
- app-svc-logrouter-prod (RG: rg-service-bus-datadog)
- Plan: ASP-rgservicebusdatadog-a6e9 (PremiumV4, Linux)

Auth state (live):
- authsettingsV2 platform.enabled = true
- globalValidation.requireAuthentication = true
- unauthenticatedClientAction = RedirectToLoginPage
- redirectToProvider = azureactivedirectory
- excludedPaths for webhook ingress:
  - /api/events/datadog
  - /api/v1/events
- azureActiveDirectory enabled with clientId and secret setting name
- WEBSITE_AUTH_CONFIG_FILE_PATH points to /home/site/wwwroot/config.json

Additional notes:
- App setting WEBSITE_AUTH_AAD_ALLOWED_TENANTS is present.
- App auth config is edge-centric and stable for container restarts because sign-in enforcement is external to app runtime logic.


## 3) How log-router Entra integration differs from platform_cloudhub

### 3.1 Core architectural difference

- platform_cloudhub:
  - App-level OAuth in Backstage (frontend popup + backend provider callback).
  - App Service auth disabled.
  - More moving parts during deploy (APP_BASE_URL, callback URL, app registration redirect URI, auth provider env vars).
  - Catalog sync does not depend on Microsoft Graph in production after the stability change.

- log-router:
  - Edge-level OAuth in App Service Easy Auth.
  - App code only performs role authorization from injected principal headers.
  - Container updates usually do not alter login mechanics, because auth is enforced outside the app.

### 3.2 Why log-router is stable while cloudhub breaks after rebuilds

- log-router stability factors:
  - Easy Auth is enabled and persistent at platform layer.
  - App code has no popup/callback redirect choreography.
  - Auth config is centralized in App Service authsettingsV2.

- cloudhub instability factors:
  - Login correctness depends on release pipeline writing exact app settings each run.
  - Redirect URI registration and callback URL alignment are mutable at deploy-time.
  - Multiple auth-related values can drift across frontend/backstage config/env/workflow.

### 3.3 Concrete mismatch/risk currently visible in cloudhub

- Production deployment now keeps APP_BASE_URL, BACKEND_BASE_URL, and
  APP_CONFIG_backend_baseUrl on the canonical public origin and rejects
  `.azurewebsites.net` values before writing App Service settings.


## 4) Recommended remediation path for platform_cloudhub login reliability

1. Make one canonical source of truth for auth URLs.
- Define canonical values for:
  - APP_BASE_URL
  - BACKEND_BASE_URL
  - callback URL
- Ensure all workflow writes derive strictly from those canonical values.

2. Fix backend base URL override behavior.
- Keep `APP_CONFIG_backend_baseUrl` aligned with the canonical public `APP_BASE_URL` because the frontend proxies `/api` and the OAuth flow must remain single-origin.

3. Add deploy-time hard validation gates.
- Fail deployment if any of these differ from expected:
  - Entra app redirect URI list contains exact callback URL
  - backend app settings callback URL equals canonical callback URL
  - APP_BASE_URL/BACKEND_BASE_URL hostnames are not loopback and are internally consistent

4. Add post-deploy auth smoke test (not only health endpoint).
- Current health checks verify readiness but not auth flow.
- Add non-interactive check that validates Microsoft auth endpoints respond as expected (302 to login, callback reachable, no AADSTS error pattern).

5. Reduce secret/config mutation during normal releases.
- Prefer immutable/referenced secret sources and avoid rewriting login settings every deploy unless changed.

6. Optional architecture hardening.
- Consider moving to App Service Easy Auth for cloudhub if product constraints allow, to reduce app-level OAuth coupling across frontend/backend release changes.


## 5) Quick summary

- log-router works reliably because Entra login is enforced at App Service (Easy Auth), while application code only authorizes roles from trusted headers.
- platform_cloudhub is more fragile because login is implemented inside Backstage and tightly coupled to deploy-time environment/callback/redirect synchronization.
- Primary immediate fix target: deployment auth setting normalization (especially backend base URL and callback consistency) plus strict auth smoke checks in release pipeline.
