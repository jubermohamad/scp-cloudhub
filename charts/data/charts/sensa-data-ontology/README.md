# sensa-data-ontology Helm Chart

Deploys the Lens semantic ontology platform to Kubernetes.

## Services

| Pod | Port | Description |
|-----|------|-------------|
| `registry` | 8000 | Concept registry — CRUD, bindings, glossary |
| `compile` | 8000 | ConceptQueryPlan → SQL compiler |
| `execute` | 8000 | SQL execution against source catalogs |
| `ai` | 8000 | NL → plan via LiteLLM (Haiku-first, Sonnet escalation) |
| `mcp` | 8000 | MCP server for Claude/agent integrations |
| `console` | 80 | React SPA (nginx, also proxies execute/ai) |
| `docs` | 80 | VitePress docs site (served under `/docs/`) |

## Prerequisites

- Kubernetes 1.24+
- nginx ingress controller (`ingressClassName: nginx`)
- An existing Postgres 14+ instance **or** set `postgres.enabled: true`
- ACR pull secret for `symphonyfs.azurecr.io`
- Anthropic API key
- **Keycloak configured for Lens** (auth is on by default) — realm, the `lens` +
  `lens-backend` clients, the audience mapper, publish roles. See
  **[KEYCLOAK.md](./KEYCLOAK.md)**.

> **Auth is ON by default** (`<svc>.env.authEnabled: "true"`). You must fill the
> `keycloak.*` values and `secrets.keycloakClientSecret` (below), or every
> request 401s. For a dev deploy with no Keycloak, set each service's
> `env.authEnabled: "false"`.

## Quick install

```bash
helm install lens ./lens-platform/deploy/helm \
  --namespace sensa-data-ontology \
  --create-namespace \
  --set image.tag=<git-branch-or-sha> \
  --set ingress.host=lens.example.com \
  --set postgres.enabled=false \
  --set postgres.host=<pg-host> \
  --set postgres.port=5432 \
  --set postgres.username=lens \
  --set postgres.database=lens \
  --set registry.runMigrations=true \
  --set secrets.create=true \
  --set secrets.postgresPassword=<pg-password> \
  --set secrets.anthropicApiKey=<api-key> \
  --set secrets.keycloakClientSecret=<lens-backend-secret> \
  --set keycloak.url=https://keycloak.example.com \
  --set keycloak.realm=<realm> \
  --set keycloak.allowOrigins=https://lens.example.com \
  --set imageCredentials.create=true \
  --set imageCredentials.username=<acr-user> \
  --set imageCredentials.password=<acr-password>
```

> Auth is on by default, so `keycloak.url` / `keycloak.realm` /
> `secrets.keycloakClientSecret` are required and Keycloak must be set up per
> [KEYCLOAK.md](./KEYCLOAK.md). For a no-auth dev install, drop the keycloak
> lines and add `--set registry.env.authEnabled=false` (and the same for
> `compile`/`execute`/`ai`/`mcp`).

## Upgrade

```bash
helm upgrade lens ./lens-platform/deploy/helm \
  --namespace sensa-data-ontology \
  --reuse-values \
  --set image.tag=<new-tag>
```

## Values reference

### Image

| Key | Default | Description |
|-----|---------|-------------|
| `image.registry` | `symphonyfs.azurecr.io` | Container registry |
| `image.repository` | `sensa-data-ontology` | Image repository prefix |
| `image.tag` | `main` | Image tag — set to a branch name or SHA |
| `image.pullPolicy` | `Always` | Pull policy |

### Image pull secret

| Key | Default | Description |
|-----|---------|-------------|
| `imageCredentials.create` | `false` | Create the pull secret from values |
| `imageCredentials.secretName` | `symphonyfs-acr-secret` | Secret name (must match `imagePullSecrets`) |
| `imageCredentials.dockerConfigJson` | `""` | Full `.dockerconfigjson` blob (takes precedence) |
| `imageCredentials.username` | `""` | ACR username (used when `dockerConfigJson` is empty) |
| `imageCredentials.password` | `""` | ACR password |

Set `imageCredentials.create: false` and pre-create the secret externally if you manage pull secrets via sealed-secrets or a vault.

### Ingress

| Key | Default | Description |
|-----|---------|-------------|
| `ingress.enabled` | `true` | Enable ingress resources |
| `ingress.host` | `lens.example.com` | Hostname for all routes |
| `ingress.className` | `nginx` | Ingress class |
| `ingress.tls.enabled` | `false` | Enable TLS |
| `ingress.tls.cert` | `""` | PEM certificate (use `--set-file ingress.tls.cert=tls.crt`) |
| `ingress.tls.key` | `""` | PEM private key (use `--set-file ingress.tls.key=tls.key`) |

Two ingress resources are created:

- **`lens-api`** — strips the `/api/v1/<service>` prefix via `rewrite-target: /$2` and routes to `registry` and `mcp`.
- **`lens`** — passes paths through as-is; `/docs` → docs pod, `/` → console pod.

### Secrets

| Key | Default | Description |
|-----|---------|-------------|
| `existingSecret` | `lens-secrets` | Name of the secret the pods read at runtime |
| `secrets.create` | `false` | Create `lens-secrets` from the values below |
| `secrets.postgresPassword` | `""` | Postgres password (only if `postgres.enabled: false`) |
| `secrets.anthropicApiKey` | `""` | Anthropic API key (required for AI service) |
| `secrets.keycloakClientSecret` | `""` | `lens-backend` client secret — **required when auth is on** |

Set `secrets.create: false` to provide `lens-secrets` via an external mechanism (sealed-secrets, ESO, etc.) with keys `postgres-password`, `anthropic-api-key`, `keycloak-client-secret`.

`secrets.keycloakClientSecret` is **required** when any service runs with
`authEnabled=true` (the default): without it (and without `LENS_SERVICE_TOKEN`)
the services can't mint outbound tokens, so `execute→compile→registry` and the
AI pipeline return 401.

### Authentication (Keycloak)

Fill these to match your Keycloak (see **[KEYCLOAK.md](./KEYCLOAK.md)** for the
IdP-side setup this depends on):

| Key | Default | Description |
|-----|---------|-------------|
| `keycloak.url` | `""` | Keycloak base URL, e.g. `https://keycloak.example.com` |
| `keycloak.realm` | `""` | Realm name |
| `keycloak.issuer` | `""` | Expected token `iss`; set **only** when the browser-facing URL differs from `keycloak.url` (external issuer + in-cluster JWKS). Empty → derived from `url`/`realm` |
| `keycloak.audience` | `"lens"` | Expected `aud`. Needs a Keycloak **audience mapper** stamping this value, or every request 401s. Set `""` to skip aud verification |
| `keycloak.clientId` | `"lens"` | Public browser/PKCE client; its roles (`resource_access.lens.roles`) are read for publish scopes |
| `keycloak.serviceClientId` | `"lens-backend"` | Confidential client for `client_credentials` service-to-service calls |
| `keycloak.allowOrigins` | `""` | Comma-separated CORS origins, e.g. `https://<host>`. Defaults to local dev origins when empty |
| `<svc>.env.authEnabled` | `"true"` | Per-service auth toggle (`registry`/`compile`/`execute`/`ai`/`mcp`). On by default |

Each service runs `check_auth_config()` at startup and logs a warning when auth
is on but `KEYCLOAK_URL` is the in-cluster default or no service credential is
set — check the pod logs if requests 401 unexpectedly.

### Postgres

| Key | Default | Description |
|-----|---------|-------------|
| `postgres.enabled` | `false` | Deploy a chart-managed Postgres StatefulSet |
| `postgres.host` | `""` | Existing Postgres host (required when `enabled: false`) |
| `postgres.port` | `5432` | Postgres port |
| `postgres.username` | `""` | Database username |
| `postgres.database` | `""` | Database name |
| `postgres.image` | `postgres:14` | Image (chart-managed only) |
| `postgres.storage` | `10Gi` | PVC size (chart-managed only) |
| `postgres.storageClass` | `managed-csi` | Storage class (chart-managed only) |

Cross-namespace example (existing Postgres in the `lens` namespace):

```
postgres.host=postgres.lens.svc.cluster.local
```

### Registry

| Key | Default | Description |
|-----|---------|-------------|
| `registry.replicas` | `1` | Pod count |
| `registry.runMigrations` | `false` | Run migrations on startup — set `true` on first install only |
| `registry.env.authEnabled` | `"true"` | Enable JWT auth (default on; see Authentication) |
| `registry.env.logLevel` | `INFO` | Log level |

Set `registry.runMigrations: true` on **first install only**. On subsequent upgrades leave it `false` — the pod that holds the schema lock will run migrations and all others wait.

### AI service

| Key | Default | Description |
|-----|---------|-------------|
| `ai.env.defaultModel` | `anthropic/claude-haiku-4-5` | First-attempt model |
| `ai.env.escalationModel` | `anthropic/claude-sonnet-4-6` | Retry model |
| `ai.env.allowedModels` | `"...haiku...,..sonnet..."` | Comma-separated allowed models |
| `ai.env.maxRetries` | `3` | Max LLM retry attempts |

## TLS example

```bash
helm upgrade lens ./lens-platform/deploy/helm \
  --namespace sensa-data-ontology \
  --reuse-values \
  --set ingress.tls.enabled=true \
  --set-file ingress.tls.cert=./tls.crt \
  --set-file ingress.tls.key=./tls.key
```

## Running database migrations

Migrations are controlled by `registry.runMigrations`. Enable it for first install:

```bash
helm install lens ./lens-platform/deploy/helm \
  --namespace sensa-data-ontology \
  --create-namespace \
  --set registry.runMigrations=true \
  ... (other values)
```

For subsequent upgrades, omit `runMigrations` (it defaults to `false`).

## Routing summary

| Path | Destination | Notes |
|------|-------------|-------|
| `/api/v1/registry/*` | `registry:8000` | Prefix stripped by ingress rewrite |
| `/api/v1/mcp/*` | `mcp:8000` | Prefix stripped by ingress rewrite |
| `/api/v1/execute/*` | `execute:8000` | Proxied by console nginx (not in ingress) |
| `/api/v1/ai/*` | `ai:8000` | Proxied by console nginx (not in ingress) |
| `/docs` | `docs:80` | VitePress site (no rewrite) |
| `/` | `console:80` | React SPA |

## Publishing the chart

Trigger the `copy-chart-to-helm-repo` GitHub Actions workflow to copy this chart to `SymphonySensa/helm` as `charts/sensa-data-ontology`.
