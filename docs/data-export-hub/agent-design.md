# Agent design

`data-export-agent` (`services/data-export-agent/`) is a Node.js 22 and TypeScript service. One copy runs on each AKS cluster: a Deployment with `replicas: 1` and the `Recreate` strategy, in namespace `cloudhub-system`. Recreate means two agents never overlap during a rollout. The agent does the work CloudHub must not do: it runs the extract, writes files and delivers them. It only ever connects outbound.

Implementation details and the full configuration table are in `services/data-export-agent/README.md`. The deployment chart is `charts/platform/data-export-agent/`.

## Loops

| Loop | Interval | Does |
|---|---|---|
| Heartbeat | Every 60 s, interval set by the control plane | Reports name, version, status and capabilities (formats, providers, export modes, Kubernetes version, `kube-system` UID). Runs requested destination checks and reports them in the next heartbeat. Keeps running during jobs. |
| Poll | Every 15 s while idle | `POST /agent/jobs/claim`. Runs at most one job at a time. |

Status is `ONLINE`, or `DEGRADED` after a retryable job failure or while a destination check is failing. On SIGTERM the agent stops claiming, gives a running job `SHUTDOWN_GRACE_SECONDS` (300 by default) to finish, then aborts it and reports it as a retryable failure. The pod's termination grace period is that value plus 60 seconds. `/healthz` and `/readyz` back the Kubernetes probes; ready means a heartbeat has succeeded.

## One job

```
claim ─▶ validate (SQL, destination config, format) ─▶ progress RUNNING
      ─▶ connect to the read replica (Entra token password) + guardrails
      ─▶ stream rows ─▶ writer (+ SHA-256 while writing) ─▶ progress (≤ every 30 s)
      ─▶ progress UPLOADING ─▶ provider.upload(data) ─▶ checksum.sha256 ─▶ manifest.json
      ─▶ complete(rows, bytes, files, manifest, watermarkValue, log tail)
      ─▶ retention (if retentionDays) ─▶ clean work dir
```

- A progress response of `continue: false` (job cancelled or reassigned) stops the job immediately. Output is discarded and nothing more is reported.
- Errors are classified. Transient ones are reported with `retryable: true`: network, timeouts, HTTP 408/429/5xx, PostgreSQL connection, resource, lock and serialisation errors, and shutdown. Permanent ones are reported with `retryable: false`: SQL syntax or permission errors, read-only violations, authentication failures, invalid configuration, unknown destination types, and host key mismatches.
- The last 64 KB of the job log goes back with `complete` or `fail`.
- The work directory (an `emptyDir` at `/work`) is wiped at startup and after every job.

## Extraction

The extraction rules are described in [security](security.md#database-guardrails) and [watermark processing](watermark-processing.md):

- **Guardrails:** `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, `SET statement_timeout='7200s'`, then a check that `transaction_read_only` is on.
- **Modes:** FULL runs the template as is, INCREMENTAL wraps it with a watermark predicate, and SNAPSHOT runs in a `REPEATABLE READ READ ONLY` transaction.
- **Streaming:** results come through a server-side cursor in batches of 1,000 rows, so memory stays flat regardless of export size.
- **Watermark precision:** incremental runs read the watermark column as PostgreSQL text, so values round-trip exactly, including microsecond timestamps.

## Formats

| Format | Compression | Notes |
|---|---|---|
| Parquet | SNAPPY (default), GZIP or none, inside the file | All fields optional. numeric is written as text, so it stays exact; cast it to DECIMAL downstream. |
| CSV | GZIP (`.gz`) or none | RFC 4180, header row |
| TSV | GZIP or none | Header row; `\`, tab, CR and LF escaped |
| JSON | GZIP or none | Newline-delimited objects |

## Delivery providers

Providers implement `DestinationProvider { validate(), upload(), healthCheck(), applyRetention?() }` and are registered by type in `src/providers/registry.ts`.

| Provider | Authentication | Upload | Health check | Retention |
|---|---|---|---|---|
| **ADLS Gen2** | Workload identity (Storage Blob Data Contributor) | Into `[path/]tenant/<tenant>/exports/<profile>/<yyyy>/<mm>/<dd>/<jobId>/`, manifest last | File system exists; write and delete a probe file | Deletes dated folders older than `retentionDays` under the profile folder |
| **SFTP** | Private key from Key Vault (`secretRef`), fetched with the workload identity | Same layout under `remotePath`; `.part` then rename; directories created | Connect and `stat remotePath` | Same, per profile folder |

The SFTP host key **must** match `hostKeyFingerprint`; a comma-separated list is allowed for key rotation. Snowflake, Databricks and S3 are deliberately not implemented. To add one, implement the interface, register it, add the type to `DESTINATION_TYPES` and `DESTINATION_REQUIRED_FIELDS` in the control plane, and add its fields to `plugins/data-export-hub/src/destinationFields.ts`.

## Identity and configuration

All credentials come from Azure Workload Identity, using variables injected by the webhook. The agent **refuses to start** if a password-style variable is present: `PGPASSWORD`, `AZURE_CLIENT_SECRET`, `AZURE_STORAGE_KEY`, and similar. Required settings are `CONTROL_PLANE_URL`, `CONTROL_PLANE_SCOPE` (default `api://cloudhub-data-export/.default`), `CLUSTER_NAME`, `PGHOST`, `PGDATABASE` and `PGUSER`. Invalid configuration exits with code 78 and lists every problem.

## Image and resources

The image is multi-stage on `node:22-alpine` and runs as uid 1000 on a read-only root filesystem with all capabilities dropped. It is built from the repo root:

```bash
docker build -f services/data-export-agent/Dockerfile -t <registry>/data-export-agent:<version> .
```

Default resources are 100m CPU and 256 Mi memory requested, with a 1 Gi memory limit. The work directory is limited to 20 Gi; size it for the largest single export file.

## Tests

| Command | Covers |
|---|---|
| `cd services/data-export-agent && yarn test --watchAll=false` | Unit tests |
| `DATA_EXPORT_AGENT_IT=1 yarn test --watchAll=false src/integration.test.ts` | Real PostgreSQL and SFTP containers |
| `DATA_EXPORT_E2E=1 yarn test --watchAll=false src/e2e.test.ts` | The whole platform: the real control plane router and scheduler, the agent, PostgreSQL and SFTP |
