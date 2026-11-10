# Control plane

The control plane is the Backstage backend plugin `@internal/plugin-data-export-hub-backend`, with plugin id `data-export`. It is served at `/api/data-export`. If `POSTGRES_HOST` is unset, it logs a warning and stays disabled.

## Layers

| Layer | Files | Rule |
|---|---|---|
| Router | `src/router.ts` | HTTP only: authenticate, call a service, map errors (400, 401, 403, 404, 409) |
| Services | `src/services/*.ts` | Business rules and authorization. Most checks need the stored record's tenant, so they can't be decided in the router. |
| Repositories | `src/repositories/*.ts` | The only SQL. Every list takes a tenant scope. |
| Pure modules | `access.ts`, `health.ts`, `listQuery.ts`, `validation.ts`, `sql.ts`, `constants.ts` | Unit tested without a database |

| Service | Covers |
|---|---|
| `CatalogService` | Datasets, lineage, cycle prevention |
| `DestinationService` | Destinations, validation-only test |
| `FleetService` | Clusters (retire and restore, never delete) and agents |
| `ClusterSyncService` | Platform Registry discovery ([cluster registry](cluster-registry.md)) |
| `ExportService` | Profiles, reference checks, Run now, next-run calculation |
| `JobService` | Executions list, retry, cancel, manifest and log downloads |
| `AgentGateway` | The agent protocol |
| `DashboardService` | Dashboard, filter options, audit log |

## Callers and authentication

| Path | Caller | How it is authenticated |
|---|---|---|
| `/…` | Users | Backstage sign-in token. Roles are derived from Entra groups ([RBAC](rbac.md)). |
| `/agent/…` | Cluster agents | Entra access token from the agent's workload identity. Backstage verifies it (signature, issuer, audience) via `backend.auth.externalAccess` type `jwks`, restricted to this plugin. The subject `external:data-export-agent:<oid>` must match a registered agent on a non-retired cluster. |
| `/internal/…` | Scheduler plugin | Backstage service token; the subject must be `plugin:data-export-scheduler` |

## Lists

Every list endpoint is server-paginated (`page` from 0, `pageSize` 1–200), sorted (`sortBy` from a per-list whitelist, `sortOrder`), searched (`search`, ILIKE with wildcards escaped) and filtered. Requests are parsed by `parseListQuery`: unknown sort fields return 400, and filter values are validated (UUIDs, tenant slugs, ISO dates). A stable tiebreaker on `id` keeps pages consistent. The response is `{ items, total, page, pageSize }`.

## Reference checks on exports

An export is saved only when all of these hold:

- the caller is an admin of the export's tenant, and of the old tenant too if the export is moving;
- the cluster is registered for that tenant and environment and is not retired;
- the destination is shared or belongs to the tenant, is enabled, and is `ADLS_GEN2` or `SFTP`;
- every dataset exists, is enabled and has a SQL template;
- for `INCREMENTAL`, every dataset supports incremental export and has a watermark column;
- compression `SNAPPY` is only used with `PARQUET`.

Saving a changed cron expression resets `last_scheduled_at` to now, so a past occurrence of the new schedule never fires. Re-enabling an export does the same, so it never back-fills runs missed while disabled.

## Agent protocol

| Endpoint | Behaviour |
|---|---|
| `POST /agent/heartbeat` | Updates the agent (name, version, status, capabilities, `last_seen`) and appends to `agent_heartbeats`. Applies destination check results, but only for destinations its own cluster's exports use. Returns intervals and the destinations due a live check (every 15 minutes while in use). |
| `POST /agent/jobs/claim` | First releases any job still held by this agent, which means the agent restarted mid-job; that job is retried. Then claims the highest-priority due `QUEUED` job for the agent's cluster. A job that has become unrunnable (export disabled, dataset without SQL, destination disabled) is failed with the reason and the next one is tried. Returns 204 when there is nothing to do. |
| `POST /agent/jobs/{id}/progress` | ASSIGNED → RUNNING → UPLOADING, plus row and byte counts. Returns `continue: false` if the job was cancelled or reassigned, and 409 for an illegal transition. |
| `POST /agent/jobs/{id}/complete` | Records files, manifest and logs, and advances the watermark in the same transaction. Returns 409 if the job is no longer this agent's. |
| `POST /agent/jobs/{id}/fail` | Re-queues retryable failures with backoff of 2, 4, 8 … minutes (capped at 60) while attempts remain; otherwise `FAILED`. |

An agent can only see and change jobs on its own cluster. Jobs on other clusters return 404.

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PGSSLMODE` | — | The CloudHub database (shared with other plugins) |
| `DATA_EXPORT_ADMIN_GROUPS` | — | Additional platform admin groups, comma-separated; built-in groups are always enabled |
| `CLOUDHUB_DATA_EXPORT_GROUP_ID` | `ea5a79c7-5b88-4108-9c2e-9e88bffff673` | Entra object ID checked during sign-in for `grp-cloudhub-data-export` membership |
| `DATA_EXPORT_TENANT_GROUP_PREFIX` | `cloudhub.dataexport.tenant.` | Prefix of tenant role groups |
| `DATA_EXPORT_AGENT_AUDIENCE` | `api://cloudhub-data-export` | Audience of agent tokens (`app-config.production.yaml`) |
| `AUTH_MICROSOFT_TENANT_ID` | — | Entra tenant whose JWKS and issuer agent tokens are verified against |
| `CLOUDHUB_DATA_EXPORT_STORAGE_ACCOUNT` or `AZURE_STORAGE_ACCOUNT` | `cloudhubdataexports` | Storage account name used when auto-creating tenant destinations |
| `CLOUDHUB_DATA_EXPORT_STORAGE_ACCOUNT_RESOURCE_ID` | — | Optional full Azure resource ID for the storage account; if account name is not set directly, it is derived from this value |
| `CLOUDHUB_DATA_EXPORT_STORAGE_CLIENT_ID` | — | Optional service principal / managed identity client ID surfaced in runtime config and destination metadata |

## Testing

```bash
cd plugins/data-export-hub-backend && yarn test --watchAll=false        # unit and router tests
DATA_EXPORT_TEST_PG_HOST=<disposable postgres> yarn test --watchAll=false dataExport.integration
```

The integration suite drops the `data_export` schema and the `pr_*` tables, so use a throwaway database. It drives the real router, the real scheduler and the agent protocol end to end, and checks the v2 → v3 upgrade.
