/**
 * Ordered, append-only schema migrations for the `data_export` schema.
 *
 * Each migration runs once inside a transaction and is recorded in
 * `data_export.schema_migrations`. Never edit a migration that has shipped;
 * add a new version instead.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'create_control_plane_tables',
    sql: `
CREATE TABLE IF NOT EXISTS data_export.datasets (
  id UUID PRIMARY KEY,
  dataset_id VARCHAR(128) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  product VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  sql_template TEXT,
  watermark_column VARCHAR(255),
  watermark_strategy TEXT,
  primary_keys TEXT[] NOT NULL DEFAULT '{}',
  source_tables TEXT[] NOT NULL DEFAULT '{}',
  columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_volume VARCHAR(100),
  retention VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_export.destinations (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL UNIQUE,
  configuration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  owner VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  last_test_at TIMESTAMPTZ,
  last_test_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_export.export_profiles (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  tenant VARCHAR(120) NOT NULL,
  cluster VARCHAR(255) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  namespace VARCHAR(255),
  schedule VARCHAR(20) NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  format VARCHAR(20) NOT NULL,
  destination_id UUID NOT NULL REFERENCES data_export.destinations(id),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_export.export_profile_datasets (
  profile_id UUID NOT NULL REFERENCES data_export.export_profiles(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES data_export.datasets(id),
  PRIMARY KEY (profile_id, dataset_id)
);

CREATE TABLE IF NOT EXISTS data_export.export_runs (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES data_export.export_profiles(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES data_export.datasets(id),
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  requested_by VARCHAR(255),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  rows_exported BIGINT,
  file_path TEXT,
  error_message TEXT,
  logs TEXT,
  output_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  manifest JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_runs_created
  ON data_export.export_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_runs_profile
  ON data_export.export_runs (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_runs_status
  ON data_export.export_runs (status);

CREATE TABLE IF NOT EXISTS data_export.watermarks (
  id UUID PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES data_export.datasets(id) ON DELETE CASCADE,
  tenant VARCHAR(120) NOT NULL,
  last_success_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dataset_id, tenant)
);
`,
  },
  {
    version: 2,
    name: 'tenant_isolation_cluster_agent_registry_catalog',
    sql: `
-- Cluster registry (first-class clusters, owned by a tenant)
CREATE TABLE data_export.clusters (
  id UUID PRIMARY KEY,
  cluster_name VARCHAR(63) NOT NULL,
  subscription_id VARCHAR(36),
  resource_group VARCHAR(90),
  environment VARCHAR(50) NOT NULL,
  region VARCHAR(64),
  tenant_id VARCHAR(63) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cluster_name)
);
CREATE INDEX idx_clusters_tenant ON data_export.clusters (tenant_id);

-- Agent registry. Agent version, status and last heartbeat for a cluster are
-- derived from its most recently seen agent rather than copied onto clusters.
CREATE TABLE data_export.agents (
  id UUID PRIMARY KEY,
  cluster_id UUID NOT NULL REFERENCES data_export.clusters(id) ON DELETE CASCADE,
  agent_version VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  last_seen TIMESTAMPTZ,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agents_cluster ON data_export.agents (cluster_id, last_seen DESC NULLS LAST);

-- Tenant isolation and ownership on export profiles. Free-text tenants become
-- slugs; free-text clusters become registry entries owned by that tenant.
ALTER TABLE data_export.export_profiles ADD COLUMN tenant_id VARCHAR(63);
UPDATE data_export.export_profiles
   SET tenant_id = COALESCE(
     NULLIF(TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(TRIM(tenant), '[^a-zA-Z0-9]+', '-', 'g'))), ''),
     'unassigned');
ALTER TABLE data_export.export_profiles ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE data_export.export_profiles ADD COLUMN owner_id VARCHAR(255);
UPDATE data_export.export_profiles SET owner_id = COALESCE(created_by, 'unknown');
ALTER TABLE data_export.export_profiles ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE data_export.export_profiles
  ADD COLUMN cluster_id UUID REFERENCES data_export.clusters(id);
INSERT INTO data_export.clusters (id, cluster_name, environment, tenant_id)
  SELECT gen_random_uuid(), LEFT(cluster, 63), MIN(environment), tenant_id
    FROM data_export.export_profiles
   GROUP BY tenant_id, LEFT(cluster, 63)
ON CONFLICT (tenant_id, cluster_name) DO NOTHING;
UPDATE data_export.export_profiles p
   SET cluster_id = c.id
  FROM data_export.clusters c
 WHERE c.tenant_id = p.tenant_id AND c.cluster_name = LEFT(p.cluster, 63);
ALTER TABLE data_export.export_profiles ALTER COLUMN cluster_id SET NOT NULL;
ALTER TABLE data_export.export_profiles DROP COLUMN cluster;
ALTER TABLE data_export.export_profiles DROP COLUMN tenant;
CREATE INDEX idx_export_profiles_tenant ON data_export.export_profiles (tenant_id);
CREATE INDEX idx_export_profiles_cluster ON data_export.export_profiles (cluster_id);

-- Destinations: NULL tenant_id marks a shared, platform-managed destination.
ALTER TABLE data_export.destinations ADD COLUMN tenant_id VARCHAR(63);
CREATE INDEX idx_destinations_tenant ON data_export.destinations (tenant_id);

-- Business-oriented data catalog fields.
ALTER TABLE data_export.datasets
  ADD COLUMN supports_incremental BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE data_export.datasets
  ADD COLUMN retention_days INTEGER CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 3650);
UPDATE data_export.datasets
   SET retention_days = NULLIF(SUBSTRING(retention FROM '^[[:space:]]*([0-9]{1,4})')::int, 0)
 WHERE retention ~ '^[[:space:]]*[0-9]{1,4}'
   AND SUBSTRING(retention FROM '^[[:space:]]*([0-9]{1,4})')::int <= 3650;
ALTER TABLE data_export.datasets DROP COLUMN retention;
`,
  },
  {
    version: 3,
    name: 'job_queue_agents_heartbeats_catalog_audit',
    sql: `
-- Enterprise data catalog
ALTER TABLE data_export.datasets RENAME COLUMN description TO business_description;
ALTER TABLE data_export.datasets RENAME COLUMN product TO source_product;
UPDATE data_export.datasets SET source_product = CASE
    WHEN LOWER(REGEXP_REPLACE(source_product, '[^a-zA-Z]', '', 'g')) = 'netreveal' THEN 'NETREVEAL'
    WHEN LOWER(REGEXP_REPLACE(source_product, '[^a-zA-Z]', '', 'g')) = 'sri' THEN 'SRI'
    WHEN LOWER(REGEXP_REPLACE(source_product, '[^a-zA-Z]', '', 'g')) = 'aistore' THEN 'AISTORE'
    WHEN LOWER(REGEXP_REPLACE(source_product, '[^a-zA-Z]', '', 'g')) IN ('eureka', 'eurekaflows') THEN 'EUREKA'
    WHEN LOWER(source_product) LIKE '%sanction%' THEN 'SENSAAI_SANCTIONS'
    ELSE UPPER(REGEXP_REPLACE(source_product, '[^a-zA-Z0-9]+', '_', 'g'))
  END;
ALTER TABLE data_export.datasets
  ADD COLUMN source_domain TEXT,
  ADD COLUMN owner_team TEXT,
  ADD COLUMN support_email TEXT,
  ADD COLUMN estimated_daily_volume BIGINT CHECK (estimated_daily_volume IS NULL OR estimated_daily_volume >= 0),
  ADD COLUMN refresh_pattern TEXT,
  ADD COLUMN sample_schema JSONB,
  ADD COLUMN classification VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN contains_pii BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN contains_sensitive_data BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE data_export.datasets SET estimated_daily_volume = estimated_volume::BIGINT
 WHERE estimated_volume ~ '^[0-9]{1,15}$';
ALTER TABLE data_export.datasets DROP COLUMN estimated_volume;
ALTER TABLE data_export.datasets ALTER COLUMN primary_keys DROP DEFAULT;
ALTER TABLE data_export.datasets ALTER COLUMN primary_keys TYPE JSONB USING TO_JSONB(primary_keys);
ALTER TABLE data_export.datasets ALTER COLUMN primary_keys SET DEFAULT '[]'::jsonb;
ALTER TABLE data_export.datasets RENAME COLUMN columns_json TO column_metadata;
-- NetReveal AML data (customers, alerts, cases, screening) carries personal data:
-- classify existing NetReveal datasets conservatively until owners review them.
UPDATE data_export.datasets
   SET classification = 'CONFIDENTIAL', contains_pii = TRUE, contains_sensitive_data = TRUE
 WHERE source_product = 'NETREVEAL';

CREATE TABLE data_export.dataset_dependencies (
  dataset_id UUID NOT NULL REFERENCES data_export.datasets(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES data_export.datasets(id) ON DELETE CASCADE,
  PRIMARY KEY (dataset_id, depends_on_id),
  CHECK (dataset_id <> depends_on_id)
);
CREATE INDEX idx_dataset_dependencies_upstream ON data_export.dataset_dependencies (depends_on_id);

-- Export profile delivery options and scheduler bookkeeping
ALTER TABLE data_export.export_profiles RENAME COLUMN format TO file_format;
ALTER TABLE data_export.export_profiles
  ADD COLUMN export_mode VARCHAR(20) NOT NULL DEFAULT 'FULL',
  ADD COLUMN retention_days INTEGER CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 3650),
  ADD COLUMN compression VARCHAR(10),
  ADD COLUMN watermark_strategy VARCHAR(30),
  ADD COLUMN last_scheduled_at TIMESTAMPTZ;
UPDATE data_export.export_profiles
   SET compression = CASE WHEN file_format = 'PARQUET' THEN 'SNAPPY' ELSE 'GZIP' END;
ALTER TABLE data_export.export_profiles ALTER COLUMN compression SET NOT NULL;
CREATE INDEX idx_export_profiles_schedulable ON data_export.export_profiles (cluster_id) WHERE enabled;
CREATE INDEX idx_export_profiles_owner ON data_export.export_profiles (owner_id);

-- Cluster registry: Platform Registry linkage and soft retirement (never deleted)
ALTER TABLE data_export.clusters
  ADD COLUMN platform_registry_id VARCHAR(64) UNIQUE,
  ADD COLUMN is_retired BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN retired_at TIMESTAMPTZ,
  ADD COLUMN last_synced_at TIMESTAMPTZ;

-- Agent registry: each agent authenticates with its own workload identity.
ALTER TABLE data_export.agents
  ADD COLUMN agent_name VARCHAR(255),
  ADD COLUMN identity_subject VARCHAR(255);
ALTER TABLE data_export.agents ALTER COLUMN agent_version DROP NOT NULL;
-- Agents registered before identities existed cannot authenticate until an
-- admin sets their identity; give them a placeholder that matches no token.
UPDATE data_export.agents SET identity_subject = 'unassigned:' || id::text WHERE identity_subject IS NULL;
ALTER TABLE data_export.agents ALTER COLUMN identity_subject SET NOT NULL;
ALTER TABLE data_export.agents ADD CONSTRAINT agents_identity_subject_key UNIQUE (identity_subject);

CREATE TABLE data_export.agent_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES data_export.agents(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES data_export.clusters(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  heartbeat_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version VARCHAR(50)
);
CREATE INDEX idx_agent_heartbeats_agent ON data_export.agent_heartbeats (agent_id, heartbeat_time DESC);
CREATE INDEX idx_agent_heartbeats_time ON data_export.agent_heartbeats (heartbeat_time);

-- Job queue. One job per profile, dataset and scheduled occurrence.
CREATE TABLE data_export.jobs (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES data_export.export_profiles(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES data_export.datasets(id),
  cluster_id UUID NOT NULL REFERENCES data_export.clusters(id),
  tenant_id VARCHAR(63) NOT NULL,
  status VARCHAR(20) NOT NULL,
  trigger VARCHAR(20) NOT NULL DEFAULT 'SCHEDULE',
  priority INTEGER NOT NULL DEFAULT 100,
  scheduled_time TIMESTAMPTZ NOT NULL,
  -- Retry backoff: a re-queued job is not claimable before this time.
  not_before TIMESTAMPTZ,
  assigned_agent_id UUID REFERENCES data_export.agents(id) ON DELETE SET NULL,
  assigned_time TIMESTAMPTZ,
  started_time TIMESTAMPTZ,
  completed_time TIMESTAMPTZ,
  progress_time TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  rows_exported BIGINT,
  bytes_exported BIGINT,
  files_delivered INTEGER,
  watermark_from TEXT,
  watermark_to TEXT,
  output_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  manifest JSONB,
  logs TEXT,
  requested_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, dataset_id, scheduled_time)
);
CREATE INDEX idx_jobs_claim ON data_export.jobs (cluster_id, priority DESC, scheduled_time) WHERE status = 'QUEUED';
CREATE INDEX idx_jobs_open ON data_export.jobs (status)
  WHERE status IN ('CREATED', 'QUEUED', 'ASSIGNED', 'RUNNING', 'UPLOADING');
CREATE INDEX idx_jobs_tenant_created ON data_export.jobs (tenant_id, created_at DESC);
CREATE INDEX idx_jobs_created ON data_export.jobs (created_at DESC);
CREATE INDEX idx_jobs_profile ON data_export.jobs (profile_id, created_at DESC);
CREATE INDEX idx_jobs_completed ON data_export.jobs (completed_time) WHERE completed_time IS NOT NULL;

-- Phase 1 run requests become jobs. They were queued before any agent existed,
-- so open ones are cancelled rather than executed long after they were asked for.
INSERT INTO data_export.jobs (id, profile_id, dataset_id, cluster_id, tenant_id, status, trigger, priority,
    scheduled_time, requested_by, rows_exported, error_message, logs, output_files, manifest,
    started_time, completed_time, created_at)
  SELECT r.id, r.profile_id, r.dataset_id, p.cluster_id, p.tenant_id,
         CASE WHEN r.status IN ('COMPLETED', 'FAILED') THEN r.status ELSE 'CANCELLED' END,
         -- Runs requested in one transaction share created_at; offset them by a
         -- microsecond so each keeps its own (profile, dataset, scheduled_time).
         'MANUAL', 200,
         r.created_at + (ROW_NUMBER() OVER (PARTITION BY r.profile_id, r.dataset_id, r.created_at ORDER BY r.id) - 1)
           * INTERVAL '1 microsecond',
         r.requested_by, r.rows_exported,
         COALESCE(r.error_message,
           CASE WHEN r.status NOT IN ('COMPLETED', 'FAILED') THEN 'Requested before the export agent was available' END),
         r.logs, r.output_files, r.manifest, r.start_time, r.end_time, r.created_at
    FROM data_export.export_runs r
    JOIN data_export.export_profiles p ON p.id = r.profile_id;
DROP TABLE data_export.export_runs;

-- Watermarks are kept per export profile and dataset, so two profiles that
-- export the same dataset for one tenant never skip each other's rows.
-- Nothing wrote watermarks before this release.
DELETE FROM data_export.watermarks;
ALTER TABLE data_export.watermarks DROP CONSTRAINT IF EXISTS watermarks_dataset_id_tenant_key;
ALTER TABLE data_export.watermarks RENAME COLUMN tenant TO tenant_id;
ALTER TABLE data_export.watermarks
  ADD COLUMN profile_id UUID NOT NULL REFERENCES data_export.export_profiles(id) ON DELETE CASCADE,
  ADD COLUMN last_job_id UUID;
ALTER TABLE data_export.watermarks ADD CONSTRAINT watermarks_profile_dataset_key UNIQUE (profile_id, dataset_id);

-- Governance: append-only audit trail of every change and system action.
CREATE TABLE data_export.audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(64),
  tenant_id VARCHAR(63),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_audit_time ON data_export.audit_events (occurred_at DESC);
CREATE INDEX idx_audit_tenant_time ON data_export.audit_events (tenant_id, occurred_at DESC);

-- Operational metrics sampled by the scheduler (queue depth, connected agents, ...).
CREATE TABLE data_export.metric_samples (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metric VARCHAR(64) NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  tenant_id VARCHAR(63)
);
CREATE INDEX idx_metric_samples ON data_export.metric_samples (metric, captured_at DESC);
`,
  },
  {
    version: 4,
    name: 'export_packages_and_customer_cluster_simplification',
    sql: `
CREATE TABLE IF NOT EXISTS data_export.export_packages (
  id UUID PRIMARY KEY,
  package_code VARCHAR(64) UNIQUE NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  description TEXT,
  dataset_ids TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE data_export.export_profiles
  ADD COLUMN IF NOT EXISTS package_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS package_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
`,
  },
  {
    version: 5,
    name: 'remove_seeded_netreveal_defaults',
    sql: `
-- Ground-zero cleanup: remove historical seeded package/dataset defaults.
DELETE FROM data_export.export_packages
 WHERE package_code = ANY(ARRAY[
   'alerting-detection',
   'case-center-wlm',
   'customer-data-cdd-worldcheck',
   'workflow-audit',
   'core-references'
 ]::varchar[]);

WITH seeded AS (
  SELECT id
    FROM data_export.datasets
   WHERE dataset_id = ANY(ARRAY[
     'NR_AML_ALERT_HEADER',
     'NR_AML_MON_ALERT',
     'NR_EXT_ALERTS',
     'NR_FSCS',
     'NR_V_CASES',
     'NR_V_CC_ALERTS',
     'NR_CUSTOMER_CASES',
     'NR_WLM_SWIFT_MATCH_DETAILS',
     'NR_WLM_SUBJECT_MATCH_DETAILS',
     'NR_CUSTOMERS',
     'NR_CUSTOMER_DYNAMIC',
     'NR_CUSTOMER_CDD_RISK',
     'NR_CDD_HISTORY',
     'NR_WC_DATA',
     'NR_WC_LIST_ROW',
     'NR_WORKFLOW_NOTE',
     'NR_WORKFLOW_ACTION_LOG',
     'NR_WORKFLOW_ACTIONS',
     'NR_WORKFLOW_STATUSES',
     'NR_ACCOUNTS',
     'NR_USERS',
     'NR_LIST_DEFINITION',
     'NR_DOMAIN_REPORTING_REASON',
     'NR_ACQ_BATCH_PROCESS'
   ]::varchar[])
)
DELETE FROM data_export.export_profile_datasets
 WHERE dataset_id IN (SELECT id FROM seeded);

WITH seeded AS (
  SELECT id
    FROM data_export.datasets
   WHERE dataset_id = ANY(ARRAY[
     'NR_AML_ALERT_HEADER',
     'NR_AML_MON_ALERT',
     'NR_EXT_ALERTS',
     'NR_FSCS',
     'NR_V_CASES',
     'NR_V_CC_ALERTS',
     'NR_CUSTOMER_CASES',
     'NR_WLM_SWIFT_MATCH_DETAILS',
     'NR_WLM_SUBJECT_MATCH_DETAILS',
     'NR_CUSTOMERS',
     'NR_CUSTOMER_DYNAMIC',
     'NR_CUSTOMER_CDD_RISK',
     'NR_CDD_HISTORY',
     'NR_WC_DATA',
     'NR_WC_LIST_ROW',
     'NR_WORKFLOW_NOTE',
     'NR_WORKFLOW_ACTION_LOG',
     'NR_WORKFLOW_ACTIONS',
     'NR_WORKFLOW_STATUSES',
     'NR_ACCOUNTS',
     'NR_USERS',
     'NR_LIST_DEFINITION',
     'NR_DOMAIN_REPORTING_REASON',
     'NR_ACQ_BATCH_PROCESS'
   ]::varchar[])
)
DELETE FROM data_export.jobs
 WHERE dataset_id IN (SELECT id FROM seeded);

WITH seeded AS (
  SELECT id
    FROM data_export.datasets
   WHERE dataset_id = ANY(ARRAY[
     'NR_AML_ALERT_HEADER',
     'NR_AML_MON_ALERT',
     'NR_EXT_ALERTS',
     'NR_FSCS',
     'NR_V_CASES',
     'NR_V_CC_ALERTS',
     'NR_CUSTOMER_CASES',
     'NR_WLM_SWIFT_MATCH_DETAILS',
     'NR_WLM_SUBJECT_MATCH_DETAILS',
     'NR_CUSTOMERS',
     'NR_CUSTOMER_DYNAMIC',
     'NR_CUSTOMER_CDD_RISK',
     'NR_CDD_HISTORY',
     'NR_WC_DATA',
     'NR_WC_LIST_ROW',
     'NR_WORKFLOW_NOTE',
     'NR_WORKFLOW_ACTION_LOG',
     'NR_WORKFLOW_ACTIONS',
     'NR_WORKFLOW_STATUSES',
     'NR_ACCOUNTS',
     'NR_USERS',
     'NR_LIST_DEFINITION',
     'NR_DOMAIN_REPORTING_REASON',
     'NR_ACQ_BATCH_PROCESS'
   ]::varchar[])
)
DELETE FROM data_export.watermarks
 WHERE dataset_id IN (SELECT id FROM seeded);

WITH seeded AS (
  SELECT id
    FROM data_export.datasets
   WHERE dataset_id = ANY(ARRAY[
     'NR_AML_ALERT_HEADER',
     'NR_AML_MON_ALERT',
     'NR_EXT_ALERTS',
     'NR_FSCS',
     'NR_V_CASES',
     'NR_V_CC_ALERTS',
     'NR_CUSTOMER_CASES',
     'NR_WLM_SWIFT_MATCH_DETAILS',
     'NR_WLM_SUBJECT_MATCH_DETAILS',
     'NR_CUSTOMERS',
     'NR_CUSTOMER_DYNAMIC',
     'NR_CUSTOMER_CDD_RISK',
     'NR_CDD_HISTORY',
     'NR_WC_DATA',
     'NR_WC_LIST_ROW',
     'NR_WORKFLOW_NOTE',
     'NR_WORKFLOW_ACTION_LOG',
     'NR_WORKFLOW_ACTIONS',
     'NR_WORKFLOW_STATUSES',
     'NR_ACCOUNTS',
     'NR_USERS',
     'NR_LIST_DEFINITION',
     'NR_DOMAIN_REPORTING_REASON',
     'NR_ACQ_BATCH_PROCESS'
   ]::varchar[])
)
DELETE FROM data_export.dataset_dependencies
 WHERE dataset_id IN (SELECT id FROM seeded)
    OR depends_on_id IN (SELECT id FROM seeded);

DELETE FROM data_export.datasets
 WHERE dataset_id = ANY(ARRAY[
   'NR_AML_ALERT_HEADER',
   'NR_AML_MON_ALERT',
   'NR_EXT_ALERTS',
   'NR_FSCS',
   'NR_V_CASES',
   'NR_V_CC_ALERTS',
   'NR_CUSTOMER_CASES',
   'NR_WLM_SWIFT_MATCH_DETAILS',
   'NR_WLM_SUBJECT_MATCH_DETAILS',
   'NR_CUSTOMERS',
   'NR_CUSTOMER_DYNAMIC',
   'NR_CUSTOMER_CDD_RISK',
   'NR_CDD_HISTORY',
   'NR_WC_DATA',
   'NR_WC_LIST_ROW',
   'NR_WORKFLOW_NOTE',
   'NR_WORKFLOW_ACTION_LOG',
   'NR_WORKFLOW_ACTIONS',
   'NR_WORKFLOW_STATUSES',
   'NR_ACCOUNTS',
   'NR_USERS',
   'NR_LIST_DEFINITION',
   'NR_DOMAIN_REPORTING_REASON',
   'NR_ACQ_BATCH_PROCESS'
 ]::varchar[]);

UPDATE data_export.export_profiles
   SET package_code = NULL,
       package_name = NULL
 WHERE package_code = ANY(ARRAY[
   'alerting-detection',
   'case-center-wlm',
   'customer-data-cdd-worldcheck',
   'workflow-audit',
   'core-references'
 ]::varchar[]);
`,
  },
];
