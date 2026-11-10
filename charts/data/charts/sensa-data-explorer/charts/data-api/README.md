# Helm chart — listops-data-api

Deploys the standalone data API. All previously-hardcoded values (image, DB DSN,
schema, limits, replicas, resources) are now in `values.yaml`, overridable per
environment. The DB DSN lives in a Kubernetes Secret, never inline in the Deployment.

## Database requirement

Provide a database connection using a managed Secret or an explicitly configured
DSN. This chart does not deploy a database, create schemas, or insert sample
records. Keep credentials in your approved secret-management workflow.

## Where the API's DB comes from (precedence)

1. `database.existingSecret` → reference a Secret you manage (recommended).
2. `database.url` → chart creates a Secret from the configured DSN.

## Key values

| Key | Purpose |
|---|---|
| `image.{registry,repository,tag}` | Container image |
| `database.url` | DSN — only used when `existingSecret` is empty (chart creates the Secret) |
| `database.existingSecret` / `database.secretKey` | Reference a Secret you manage instead |
| `database.schema` | `DATA_API_DB_SCHEMA` |
| `settings.{statementTimeoutMs,defaultLimit,maxLimit,rootPath}` | App tuning env |
| `settings.keycloak.issuer` | **The authentication switch, and the only source of identity.** Set it and bearer tokens are verified; empty and every caller is anonymous |
| `settings.keycloak.jwksUrl` | Only where signing keys are reachable at a different address from the issuer |
| `settings.keycloak.{audience,clientId}` | Expected `aud`, and which `resource_access` key carries our roles |
| `replicaCount`, `resources`, `service.*` | Scaling / exposure |

Nothing Keycloak-related is passed to the container unless `settings.keycloak.issuer`
is non-empty. **A deployment without it has no identity at all** — reads work, every
caller is anonymous, and endpoints needing a user return 401. That is the honest
failure mode rather than a silent one, but it does mean an audit trail of nothing but
`anonymous`, so set an issuer anywhere the log matters.

**There is no ingress in this chart.** Network access must be configured through
the environment's approved deployment and access procedures.
