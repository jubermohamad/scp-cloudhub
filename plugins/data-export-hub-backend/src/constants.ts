/**
 * Shared enumerations for the Data Export Hub control plane.
 *
 * Values are stored as upper-case codes in PostgreSQL and rendered as labels
 * by the frontend. The application validates them on write; the schema keeps
 * them as plain text so adding a value never needs a migration.
 */
export const EXPORT_ENVIRONMENTS = ['PRODUCTION', 'STAGING', 'SIT', 'DEVELOPMENT'] as const;

export const EXPORT_SCHEDULES = [
  'RUN_ONCE',
  'ONCE',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'CUSTOM_CRON',
] as const;

/** Preset schedules expanded to cron expressions (minute hour dom month dow), evaluated in UTC. */
export const SCHEDULE_PRESETS: Record<string, string> = {
  RUN_ONCE: '0 0 1 1 *',
  ONCE: '0 0 1 1 *',
  HOURLY: '0 * * * *',
  DAILY: '0 2 * * *',
  WEEKLY: '0 2 * * 1',
  MONTHLY: '0 2 1 * *',
};

export const EXPORT_FORMATS = ['PARQUET', 'CSV', 'TSV', 'JSON'] as const;
export const EXPORT_MODES = ['FULL', 'INCREMENTAL', 'SNAPSHOT'] as const;
export const COMPRESSIONS = ['NONE', 'GZIP', 'SNAPPY'] as const;
export const WATERMARK_STRATEGIES = ['GREATER_THAN', 'GREATER_OR_EQUAL'] as const;

/** Destination types that have a delivery provider in the agent. Only these can be created. */
export const DESTINATION_TYPES = ['ADLS_GEN2', 'SFTP'] as const;

export const DESTINATION_STATUSES = ['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN'] as const;

/**
 * Configuration keys required per destination type. ADLS uses the agent's
 * workload identity, so it has no secret. SFTP's private key lives in Key
 * Vault and is referenced by `secretRef`; its host key must be pinned.
 */
export const DESTINATION_REQUIRED_FIELDS: Record<(typeof DESTINATION_TYPES)[number], readonly string[]> = {
  // fileSystem defaults to `data-export-hub` when omitted.
  ADLS_GEN2: ['accountName'],
  SFTP: ['host', 'username', 'remotePath', 'secretRef', 'hostKeyFingerprint'],
};

export const SOURCE_PRODUCTS = ['NETREVEAL', 'SRI', 'AISTORE', 'EUREKA', 'SENSAAI_SANCTIONS'] as const;

export const DATASET_CATEGORIES = [
  'ALERTS',
  'CASES',
  'CUSTOMERS',
  'CDD',
  'WORKFLOW',
  'SCREENING',
  'AUDIT',
  'REFERENCE_DATA',
] as const;

export const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;

export const JOB_STATUSES = [
  'CREATED',
  'QUEUED',
  'ASSIGNED',
  'RUNNING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Jobs an agent holds. If the agent goes OFFLINE these are reclaimed by the scheduler. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['ASSIGNED', 'RUNNING', 'UPLOADING'];
/** Jobs that can still be cancelled. */
export const CANCELLABLE_JOB_STATUSES: readonly JobStatus[] = ['CREATED', 'QUEUED', 'ASSIGNED', 'RUNNING', 'UPLOADING'];
export const RETRYABLE_JOB_STATUSES: readonly JobStatus[] = ['FAILED', 'CANCELLED'];

export const JOB_PRIORITY_SCHEDULED = 100;
export const JOB_PRIORITY_MANUAL = 200;
export const JOB_MAX_RETRIES_DEFAULT = 3;

/** Status an agent reports about itself. Health is derived from heartbeat age. */
export const AGENT_STATUSES = ['ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN'] as const;

/** Derived health. Thresholds are minutes since the last heartbeat. */
export const HEALTH_STATES = ['HEALTHY', 'WARNING', 'CRITICAL', 'OFFLINE'] as const;
export type Health = (typeof HEALTH_STATES)[number];
export const HEALTH_THRESHOLD_MINUTES = { warning: 5, critical: 10, offline: 15 } as const;

/** Agents send a heartbeat this often; the control plane tells them so in each response. */
export const AGENT_HEARTBEAT_SECONDS = 60;
export const AGENT_POLL_SECONDS = 15;
/** How often a destination used by a cluster's exports gets a live check from that cluster's agent. */
export const DESTINATION_CHECK_INTERVAL_MINUTES = 15;

export const ADMIN_GROUP_DEFAULT = 'CloudHub.DataExport.Admin';

/**
 * Tenant roles come from Entra groups named `<prefix><tenant>.admin` and
 * `<prefix><tenant>.user`, e.g. CloudHub.DataExport.Tenant.visa.Admin.
 * Override the prefix with DATA_EXPORT_TENANT_GROUP_PREFIX.
 */
export const TENANT_GROUP_PREFIX_DEFAULT = 'cloudhub.dataexport.tenant.';

/** Backstage subject prefix configured for agent tokens (backend.auth.externalAccess jwks.subjectPrefix). */
export const AGENT_SUBJECT_PREFIX = 'external:data-export-agent:';
/** Service principal of the scheduler plugin when it calls this plugin. */
export const SCHEDULER_SUBJECT = 'plugin:data-export-scheduler';

/** Applied to the dashboard's "top" widgets. */
export const DASHBOARD_WINDOW_DAYS = 7;
