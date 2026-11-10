# Data Export Hub cluster agent

`@internal/data-export-agent` runs as one Deployment (`replicas: 1`) in
`cloudhub-system` on every AKS cluster. CloudHub is the control plane: it
stores export definitions and queues jobs. The agent:

1. heartbeats to CloudHub (status, version, capabilities, destination checks);
2. polls for a job for its own cluster and runs one job at a time;
3. opens a guardrailed, read-only session on the cluster's PostgreSQL read
   replica and streams the dataset query;
4. writes Parquet / CSV / TSV / JSON lines to a local work dir, hashing as it
   writes;
5. uploads the data file, `checksum.sha256` and finally `manifest.json` to
   ADLS Gen2 or SFTP;
6. reports completion (with the new incremental watermark) or failure
   (retryable or not), with the tail of the job log.

CloudHub never executes SQL itself. The wire contract is
[`src/protocol.ts`](src/protocol.ts), mirrored by
`plugins/data-export-hub-backend/src/agentProtocol.ts`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Entry point; wires production dependencies, signals, health server. |
| `src/agent.ts` | Heartbeat and poll loops, destination checks, graceful shutdown. |
| `src/jobRunner.ts` | One job end to end. |
| `src/controlPlaneClient.ts` | HTTP client with timeouts and retries. |
| `src/sql/queryBuilder.ts` | Template validation, FULL / INCREMENTAL / SNAPSHOT statements. |
| `src/sql/source.ts` | PG connections with AAD token passwords and guardrails; streaming. |
| `src/writers/` | Streaming writers, type mapping, hashing sink. |
| `src/manifest.ts` | `checksum.sha256` and `manifest.json`. |
| `src/providers/` | `DestinationProvider` interface, registry, ADLS Gen2, SFTP, Key Vault secrets. |
| `src/config.ts` | Environment configuration and validation. |
| `src/errors.ts`, `src/retry.ts` | Retry classification and backoff. |

## Configuration

Environment variables only, validated at startup (all problems are listed and
the process exits with code 78).

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `CONTROL_PLANE_URL` | yes | | CloudHub base URL. https only (http allowed for localhost). |
| `CONTROL_PLANE_SCOPE` | yes | | e.g. `api://cloudhub-data-export/.default`. |
| `CLUSTER_NAME` | yes | | Cluster name as registered in CloudHub. |
| `PGHOST` | yes | | Read replica host. |
| `PGPORT` | no | `5432` | |
| `PGDATABASE` | yes | | |
| `PGUSER` | yes | | The managed identity's PostgreSQL AAD role. |
| `PGSSLMODE` | no | `verify-full` | `disable`, `require`, `verify-ca`, `verify-full`. |
| `PGSSLROOTCERT` | no | | Path to a CA bundle for verify modes. |
| `WORK_DIR` | no | `<os.tmpdir()>/data-export-agent` | Absolute path; the chart mounts an emptyDir at `/work`. Wiped at startup and after each job. |
| `HEALTH_PORT` | no | `8080` | Serves `/healthz` and `/readyz`. |
| `SHUTDOWN_GRACE_SECONDS` | no | `300` | Time an in-flight job gets after SIGTERM. |
| `AGENT_NAME` | no | `<CLUSTER_NAME>-data-export-agent` | |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`. |

Injected by the workload identity webhook (not set by hand):
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_FEDERATED_TOKEN_FILE`,
`AZURE_AUTHORITY_HOST`.

The agent **refuses to start** if `PGPASSWORD`, `PGPASSFILE`,
`AZURE_CLIENT_SECRET`, `AZURE_CLIENT_CERTIFICATE_PATH`, `AZURE_USERNAME`,
`AZURE_PASSWORD`, `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_KEY` is
set: stored secrets are not supported.

## Behaviour

### Export modes

- **FULL**: runs the dataset `sqlTemplate` as-is.
- **INCREMENTAL** (needs `dataset.watermarkColumn`):

  ```sql
  SELECT src.*, (src."<col>")::text AS "__dxh_watermark__"
  FROM (<template>) AS src
  WHERE src."<col>" > $1          -- >= for GREATER_OR_EQUAL; omitted on the first run
  ORDER BY src."<col>"
  ```

  The extra `__dxh_watermark__` column carries the watermark as PostgreSQL
  renders it, so the value sent back as `watermarkValue` keeps full precision
  (microsecond timestamps, numeric scale, int8 above 2^53) and round-trips
  unchanged as `$1` next time. Writers drop it, so it never reaches the files.
  Because rows arrive ordered by the column, the last non-null value is the
  maximum. An incremental run with no new rows returns `watermarkValue: null`
  (unchanged) and the manifest's `watermark.to` equals `from`.
- **SNAPSHOT**: the query runs inside
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` ... `COMMIT`.

Templates are trimmed, one trailing `;` is stripped, and anything that does
not start with `SELECT`/`WITH` or contains another `;` is refused
(non-retryable). Watermark columns must match `^[A-Za-z_][A-Za-z0-9_$]*$` and
are double-quoted.

### PostgreSQL guardrails

Every source connection runs, in order, before any dataset query:

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SET statement_timeout='7200s';
SHOW transaction_read_only;   -- must be 'on', otherwise the job fails (non-retryable)
```

The password is an Entra access token for
`https://ossrdbms-aad.database.windows.net/.default`, fetched for each new
connection. Results are streamed through `pg-query-stream` (server-side
cursor, batches of 1000 rows); nothing is buffered in full. Even a
data-modifying CTE (`WITH x AS (INSERT ...) SELECT ...`) is rejected by the
server because of the read-only session; the integration test checks this.

### Output files

`<datasetId>.<parquet|csv|tsv|jsonl>[.gz]` (dataset ids are sanitised to
`[A-Za-z0-9._-]`), then `checksum.sha256` (`sha256sum -c` format, data files),
then `manifest.json` (the `Manifest` type in protocol.ts). Consumers must treat
a folder as complete only once `manifest.json` exists.

| Format | Compression | Notes |
| --- | --- | --- |
| PARQUET | NONE / GZIP / SNAPPY (column chunks) | All fields OPTIONAL. |
| CSV | NONE / GZIP (`.gz`) | RFC 4180, CRLF, header row. NULL = empty field. |
| TSV | NONE / GZIP (`.gz`) | Header row; `\`, tab, CR, LF escaped as `\\`, `\t`, `\r`, `\n`. NULL = empty. |
| JSON | NONE / GZIP (`.gz`) | Newline-delimited objects. |

SNAPPY with a text format fails the job (non-retryable).

Parquet type mapping (by pg type OID): int2/int4 → INT32, int8 → INT64,
float4/float8 → DOUBLE, **numeric → UTF8** (exact decimal text; a double would
silently round money and large quantities, so consumers cast to DECIMAL),
bool → BOOLEAN, date/timestamp/timestamptz → TIMESTAMP_MILLIS (`infinity`
becomes NULL), everything else → UTF8 (json/arrays as JSON text, bytea as
base64). Text formats render timestamps as ISO 8601 UTC, bytea as base64,
json/arrays as JSON; int8 and numeric keep their exact string form.

### Failures and retries

`/fail` carries `retryable: true` for transient problems (socket errors,
timeouts, HTTP 408/429/5xx, PG classes 08/53/57P/58 and codes 40001, 40P01,
55P03, 57014, 72000, ssh socket errors, shutdown aborts) and `false` for SQL
syntax/permission errors, read-only violations, authentication failures, bad
definitions, invalid destination config, unknown destination types and SFTP
host key mismatches. Unknown errors are non-retryable.

A `continue: false` answer to any progress call stops the job, discards the
output and sends nothing further. Progress with row/byte counts is sent at most
every 30 s during an extract. Retention (`profile.retentionDays`) runs after a
successful completion when the provider supports it; its failures are logged
only. The per-job log tail (≤ 64 KB) is sent with complete/fail.

### Agent loop

- Heartbeat immediately, then every `heartbeatIntervalSeconds` from the
  response (default 60). Status is `DEGRADED` after a retryable (infrastructure)
  job failure or while any destination check is failing; `ONLINE` otherwise.
- Capabilities: `formats`, `providers`, `exportModes`, plus
  `kubernetesVersion` and `clusterUid` (the `kube-system` namespace UID) when
  the Kubernetes API allows it.
- `destinationsToCheck` from a heartbeat response are checked one at a time
  (60 s timeout each) and reported in the next heartbeat.
- Claims every `pollIntervalSeconds` (default 15) while idle; after a job it
  claims again immediately.
- Control plane calls: 30 s timeout, 5 attempts, exponential backoff with full
  jitter (0.5 s base, 30 s cap) on network errors and 5xx/429.
- SIGTERM/SIGINT: stop claiming, wait up to `SHUTDOWN_GRACE_SECONDS` for the
  running job, then abort it and report it as a retryable failure.
- `/healthz` is 200 while the loops are alive; `/readyz` is 200 once a
  heartbeat succeeded within the last 3 intervals.

## Destinations

### ADLS_GEN2

Config: `accountName` (required), `fileSystem` (default `data-export-hub`),
`path` (optional base prefix). Files go to
`abfss://<fileSystem>@<account>.dfs.core.windows.net/[<path>/]<outputPrefix>/<name>`
via `https://<account>.dfs.core.windows.net`. The identity needs Storage Blob
Data Contributor. Health check: the file system exists and a probe file under
`[<path>/]_health/` can be written and deleted. Retention deletes
`[<path>/]<profilePrefix>/yyyy/mm/dd` directories whose day is earlier than
today (UTC) minus `retentionDays`.

### SFTP

Config: `host`, `port` (default 22), `username`, `remotePath`, `secretRef`
(`kv://<vault>/<secret>`; the secret value is the PEM/OpenSSH private key,
fetched with workload identity at connect time and only held in memory) and
`hostKeyFingerprint` (`SHA256:<base64>` as printed by `ssh-keygen -lf`; a
comma-separated list is accepted for key rotation). **The provider refuses to
connect without a fingerprint** and fails the job (non-retryable) when the
server presents a different key. Files are uploaded as `<name>.part` and
renamed; directories are created recursively. Health check: connect (with host
key verification) and `stat remotePath`. SFTP has no retention.

### Adding a provider

Snowflake, Databricks and S3 are not implemented. To add one:

1. Implement `DestinationProvider` (`src/providers/types.ts`) in
   `src/providers/<name>.ts`: `validate`, `upload` (must upload in the given
   order: data, checksum, manifest last), `healthCheck`, optionally
   `applyRetention`. Take SDK clients through a factory parameter so tests can
   pass fakes, and authenticate with the injected `TokenCredential` (workload
   identity) or a `kv://` secret resolved through `SecretResolver`.
2. Register it in `createDefaultRegistry` (`src/providers/registry.ts`).
3. Add the type to `DestinationType` in `src/protocol.ts` and in the control
   plane's mirror, and to the CloudHub destination UI/validation.
4. Grant the agent identity access to the destination and document it in the
   chart README.

Unknown destination types fail the job as non-retryable with a clear message.

## Run locally

```sh
az login   # DefaultAzureCredential is used when workload identity vars are absent
export CONTROL_PLANE_URL=http://localhost:7007 CONTROL_PLANE_SCOPE=api://cloudhub-data-export/.default \
  CLUSTER_NAME=dev PGHOST=<replica> PGDATABASE=app PGUSER=<your AAD user> WORK_DIR=/tmp/dxa
yarn workspace @internal/data-export-agent build
yarn workspace @internal/data-export-agent start
```

## Tests

```sh
cd services/data-export-agent
yarn test --watchAll=false                       # unit tests
DATA_EXPORT_AGENT_IT=1 yarn test --watchAll=false src/integration.test.ts
```

The integration test starts `postgres:16-alpine` (`dxh-agent-pg`) and
`atmoz/sftp:alpine` (`dxh-agent-sftp`), connects to their bridge IPs, runs
real jobs through the production code (guardrails, Parquet + gzipped CSV, SFTP
with host key verification, manifest/checksum, watermark advance, read-only
enforcement, host key mismatch) against a fake control plane HTTP server, and
removes the containers afterwards. Only the token provider, Key Vault resolver
and control plane are faked. Set `IT_LOG_LEVEL=info` to see agent logs.

## Build the image

From the repository root:

```sh
docker build -f services/data-export-agent/Dockerfile -t <registry>/data-export-agent:<tag> .
```

Multi-stage on `node:22-alpine`: compiles in a builder stage, installs runtime
dependencies with `yarn workspaces focus @internal/data-export-agent --production`,
runs as `node` (uid 1000) with code owned by root, and needs no writable path
other than `WORK_DIR` (`/work`), so it runs with a read-only root filesystem.

## Deploy

Use the Helm chart in `charts/platform/data-export-agent` (see its README for
the managed identity, federated credential, PG role, role assignments and
CloudHub registration).

## Security notes

- Workload identity only; no stored secrets anywhere (and refusal to start if
  some are provided).
- The source session is forced read-only and verified; statements time out
  after 2 h; TLS to PostgreSQL with full verification by default.
- SFTP host keys are always pinned; private keys never touch disk or logs.
- ADLS account names, Key Vault names and paths are validated so a crafted
  destination config cannot redirect requests or climb out of the base path.
- Work files are created `0600` in a `0700` per-job directory and deleted after
  every job, and the whole work dir is wiped at startup.
- Logs never include row data, tokens or secret values.
