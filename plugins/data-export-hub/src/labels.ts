import type {
  Classification,
  Compression,
  DatasetCategory,
  DestinationStatus,
  Environment,
  ExportFormat,
  ExportMode,
  Health,
  JobStatus,
  JobTrigger,
  Schedule,
  SourceProduct,
  WatermarkStrategy,
} from './types';

/** UI labels for the upper-case codes used by the API. */

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  PRODUCTION: 'Production',
  STAGING: 'Staging',
  SIT: 'SIT',
  DEVELOPMENT: 'Development',
};

export const SCHEDULE_LABELS: Record<Schedule, string> = {
  RUN_ONCE: 'Run Once',
  ONCE: 'Run Once',
  HOURLY: 'Hourly',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  CUSTOM_CRON: 'Custom cron',
};

export const SCHEDULE_DESCRIPTIONS: Record<Schedule, string> = {
  RUN_ONCE: 'Executes once on demand without recurring schedule.',
  ONCE: 'Executes once on demand without recurring schedule.',
  HOURLY: 'Runs once every hour.',
  DAILY: 'Runs once a day.',
  WEEKLY: 'Runs once a week.',
  MONTHLY: 'Runs once a month.',
  CUSTOM_CRON: 'Runs on your own five-field cron expression (UTC).',
};

export const EXPORT_MODE_LABELS: Record<ExportMode, string> = {
  FULL: 'Full',
  INCREMENTAL: 'Incremental',
  SNAPSHOT: 'Snapshot',
};

export const EXPORT_MODE_DESCRIPTIONS: Record<ExportMode, string> = {
  FULL: 'Exports every row of each dataset on every run. Simple and self-contained, but the largest files.',
  INCREMENTAL:
    'Exports only rows changed since the previous successful run, tracked by each dataset’s watermark column. Every selected dataset must support incremental export.',
  SNAPSHOT:
    'Exports a point-in-time copy of each dataset, labelled with the run time, so consumers can keep a history of snapshots.',
};

export const WATERMARK_STRATEGY_LABELS: Record<WatermarkStrategy, string> = {
  GREATER_THAN: 'Greater than last watermark (no overlap)',
  GREATER_OR_EQUAL:
    'Greater than or equal to last watermark (re-reads boundary rows)',
};

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  PARQUET: 'Parquet',
  CSV: 'CSV',
  TSV: 'TSV',
  JSON: 'JSON',
};

export const COMPRESSION_LABELS: Record<Compression, string> = {
  NONE: 'None',
  GZIP: 'GZIP',
  SNAPPY: 'Snappy',
};

export const SOURCE_PRODUCT_LABELS: Record<SourceProduct, string> = {
  NETREVEAL: 'NetReveal',
  SRI: 'SymphonyAI Risk Intelligence',
  AISTORE: 'AI Store',
  EUREKA: 'Eureka',
  SENSAAI_SANCTIONS: 'SymphonyAI for Sanctions',
};

export const DATASET_CATEGORY_LABELS: Record<DatasetCategory, string> = {
  ALERTS: 'Alerts',
  CASES: 'Cases',
  CUSTOMERS: 'Customers',
  CDD: 'CDD',
  WORKFLOW: 'Workflow',
  SCREENING: 'Screening',
  AUDIT: 'Audit',
  REFERENCE_DATA: 'Reference Data',
};

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  PUBLIC: 'Public',
  INTERNAL: 'Internal',
  CONFIDENTIAL: 'Confidential',
  RESTRICTED: 'Restricted',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  CREATED: 'Created',
  QUEUED: 'Queued',
  ASSIGNED: 'Assigned',
  RUNNING: 'Running',
  UPLOADING: 'Uploading',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const JOB_TRIGGER_LABELS: Record<JobTrigger, string> = {
  SCHEDULE: 'Schedule',
  MANUAL: 'Manual',
  RETRY: 'Retry',
};

export const HEALTH_LABELS: Record<Health, string> = {
  HEALTHY: 'Healthy',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  OFFLINE: 'Offline',
};

export const DESTINATION_STATUS_LABELS: Record<DestinationStatus, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  FAILED: 'Failed',
  UNKNOWN: 'Not tested',
};

/** Looks a code up in a label map, falling back to the raw code for values the UI does not know. */
export function labelFor(
  labels: Record<string, string>,
  code: string | null | undefined,
): string {
  if (!code) return '—';
  return labels[code] ?? code;
}

/** `[{ value, label }]` for select inputs, in the map's declaration order. */
export function optionsFrom<K extends string>(
  labels: Record<K, string>,
): Array<{ value: K; label: string }> {
  return (Object.keys(labels) as K[]).map(value => ({
    value,
    label: labels[value],
  }));
}
