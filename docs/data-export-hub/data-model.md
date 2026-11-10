# Data model

Everything lives in the PostgreSQL schema `data_export`, in CloudHub's database. The `data-export` backend plugin owns the schema and applies migrations on start (`plugins/data-export-hub-backend/src/migrations.ts`). Each migration runs once, in a transaction, and is recorded in `data_export.schema_migrations`. Never edit a shipped migration; add a new version.

| Version | Adds |
|---|---|
| 1 | datasets, destinations, export_profiles, export_profile_datasets, export_runs, watermarks |
| 2 | Tenant isolation (`tenant_id`, `owner_id`), cluster and agent registries, catalog retention and incremental fields |
| 3 | Job queue, agent heartbeats, agent identities, enterprise catalog fields, dataset dependencies, export modes and delivery options, cluster retirement and Platform Registry linkage, per-profile watermarks, audit events, metric samples. Phase 1 `export_runs` are moved into `jobs`. |

Enumerations are stored as upper-case text. The application validates them on write, so adding a value needs no migration.

## Tables

### `datasets` — data catalog

| Column | Notes |
|---|---|
| `id` UUID, `dataset_id` | `dataset_id` is the unique catalog code, e.g. `NR_V_CASES` |
| `display_name`, `business_description` | |
| `source_product` | `NETREVEAL`, `SRI`, `AISTORE`, `EUREKA`, `SENSAAI_SANCTIONS` |
| `source_domain`, `category` | Category: `ALERTS`, `CASES`, `CUSTOMERS`, `CDD`, `WORKFLOW`, `SCREENING`, `AUDIT`, `REFERENCE_DATA` |
| `owner_team`, `support_email` | Support contact |
| `classification` | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`. A dataset with PII cannot be `PUBLIC`. |
| `contains_pii`, `contains_sensitive_data` | |
| `estimated_daily_volume` BIGINT, `refresh_pattern`, `retention_days` | |
| `supports_incremental`, `watermark_column`, `watermark_strategy` | Incremental export requires a watermark column |
| `primary_keys` JSONB, `source_tables` TEXT[], `column_metadata` JSONB, `sample_schema` JSONB | `column_metadata` items: `{name, type?, description?, nullable?, pii?}` |
| `sql_template` | A single `SELECT` or `WITH … SELECT`, run by agents in a read-only session |
| `enabled` | Disabled datasets cannot be added to exports or dispatched |

### `dataset_dependencies` — lineage

`(dataset_id, depends_on_id)` means *dataset_id is derived from depends_on_id*. Self-references are blocked by a CHECK. Cycles are rejected by the API.

### `destinations`

`type` is `ADLS_GEN2` or `SFTP` (older rows may carry other types, which cannot run). `configuration_json` holds non-secret settings only. `tenant_id` is NULL for a shared, platform-managed destination. `status`, `last_test_at` and `last_test_message` hold the latest live check reported by an agent.

### `export_profiles`

| Column | Notes |
|---|---|
| `tenant_id`, `owner_id`, `created_by` | Ownership. `owner_id` defaults to the creator. |
| `cluster_id` | A registered cluster of the same tenant and environment |
| `environment`, `namespace` | |
| `schedule`, `cron_expression` | Presets expand to cron. Evaluated in UTC. |
| `export_mode` | `FULL`, `INCREMENTAL`, `SNAPSHOT` |
| `file_format`, `compression` | `PARQUET` (default, `SNAPPY`), `CSV`, `TSV`, `JSON` (`GZIP` default, or `NONE`) |
| `retention_days` | Retention of delivered files, enforced by the agent |
| `watermark_strategy` | `GREATER_THAN` (default) or `GREATER_OR_EQUAL`. Incremental only. |
| `destination_id`, `enabled` | |
| `last_scheduled_at` | Scheduler bookkeeping: the last occurrence turned into jobs |

`export_profile_datasets(profile_id, dataset_id)` holds the datasets, at most 50 per profile.

### `clusters` — cluster registry

`cluster_name`, `subscription_id`, `resource_group`, `environment`, `region` and `tenant_id`. `platform_registry_id` is set for clusters synced from Platform Registry, which are read-only in Data Export Hub. `is_retired` and `retired_at` replace deletion: clusters are never deleted. `last_synced_at` records the last sync. A cluster is unique by `(tenant_id, cluster_name)`.

### `agents` — agent registry

`cluster_id`, `agent_name` and `identity_subject` (unique Entra object id of the agent's workload identity). `agent_version`, `status` (as reported), `last_seen` and `capabilities_json` are written by heartbeats.

Cluster health is derived from the cluster's most recently seen agent, not stored on the cluster:

| Health | Rule |
|---|---|
| `HEALTHY` | Heartbeat < 5 min ago and the agent reports ONLINE |
| `WARNING` | Heartbeat 5–10 min ago, or the agent reports DEGRADED |
| `CRITICAL` | Heartbeat 10–15 min ago |
| `OFFLINE` | Heartbeat > 15 min ago, never, or the agent reported OFFLINE |

### `agent_heartbeats`

One row per heartbeat: `agent_id`, `cluster_id`, `status`, `heartbeat_time` and `version`. Kept for 7 days.

### `jobs` — the job queue and execution history

| Column | Notes |
|---|---|
| `profile_id`, `dataset_id`, `cluster_id`, `tenant_id` | Tenant is copied from the profile when the job is created |
| `status` | See [architecture](architecture.md#job-states) |
| `trigger`, `priority` | `SCHEDULE` (100), `MANUAL` (200), `RETRY` (≥ 200) |
| `scheduled_time` | The cron occurrence, or the request time. Unique with profile and dataset. |
| `not_before` | Retry backoff: not claimable before this time |
| `assigned_agent_id`, `assigned_time`, `started_time`, `completed_time`, `progress_time` | |
| `retry_count`, `max_retries` (3) | |
| `rows_exported`, `bytes_exported`, `files_delivered` | |
| `watermark_from`, `watermark_to` | Watermark at claim and after completion |
| `output_files` JSONB, `manifest` JSONB, `logs` | `logs` is the last 64 KB |
| `error_message`, `requested_by` | |

### `watermarks`

One row per `(profile_id, dataset_id)`, holding `last_success_value`, `last_job_id` and `tenant_id`. Written only when an incremental job completes. See [watermark processing](watermark-processing.md).

### `audit_events`

Append-only: `occurred_at`, `actor`, `action` (e.g. `export.created`, `job.cancelled`, `cluster.retired`), `entity_type`, `entity_id`, `tenant_id` and `details`. Written in the same transaction as the change it records.

### `metric_samples`

`captured_at`, `metric`, `value` and `tenant_id`, sampled every minute by the scheduler: `queue_depth`, `running_jobs`, `connected_agents` and `registered_agents`. Kept for 30 days. Throughput figures (exports started, completed and failed; rows; bytes; duration) are computed from `jobs`, so they always match the Executions page.

## Indexes that carry the load

| Index | Serves |
|---|---|
| `idx_jobs_claim (cluster_id, priority DESC, scheduled_time) WHERE status='QUEUED'` | Agent claims |
| `idx_jobs_open (status) WHERE status IN (open states)` | Dispatch, reclaim, dashboard |
| `idx_jobs_tenant_created`, `idx_jobs_created`, `idx_jobs_profile` | Executions lists |
| `idx_export_profiles_schedulable (cluster_id) WHERE enabled` | Scheduler tick |
| `idx_agent_heartbeats_agent`, `idx_agent_heartbeats_time` | Agent detail, pruning |
| `idx_audit_tenant_time`, `idx_metric_samples` | Audit log, dashboard trend |
