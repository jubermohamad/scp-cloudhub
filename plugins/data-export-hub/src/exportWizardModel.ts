import {
  initialDestinationConfig,
  normaliseDestinationConfig,
} from './destinationFields';
import type {
  Compression,
  Dataset,
  DestinationType,
  Environment,
  ExportFormat,
  ExportInput,
  ExportMode,
  ExportProfile,
  Schedule,
  WatermarkStrategy,
} from './types';

export type DatasetOption = Pick<
  Dataset,
  'id' | 'datasetId' | 'displayName'
> & {
  /** Unknown for datasets loaded from an existing export profile. */
  supportsIncremental?: boolean;
};

export type RetentionChoice = '7' | '30' | '90' | 'CUSTOM' | 'NONE';

export interface WizardForm {
  name: string;
  customerName: string;
  tenantId: string;
  environment: Environment;
  clusterId: string;
  clusterLabel: string;
  namespace: string;
  packageCode: string;
  packageCodes: string[];
  packageName: string;
  packageDescription: string;
  schedule: Schedule;
  cronExpression: string;
  exportMode: ExportMode;
  fileFormat: ExportFormat;
  compression: Compression;
  watermarkStrategy: WatermarkStrategy | null;
  retention: RetentionChoice;
  customRetentionDays: string;
  destinationMode: 'existing' | 'new';
  destinationId: string;
  destinationLabel: string;
  newDestinationName: string;
  newDestinationType: DestinationType;
  newDestinationConfig: Record<string, string>;
  datasets: DatasetOption[];
}

export const WIZARD_STEPS = [
  'Customer',
  'Production Cluster',
  'Export Package',
  'Schedule',
  'Review',
] as const;

export const REVIEW_STEP = WIZARD_STEPS.length - 1;

export const FORMATS: ExportFormat[] = ['TSV', 'PARQUET', 'CSV', 'JSON'];
export const SCHEDULES: Schedule[] = [
  'RUN_ONCE',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'CUSTOM_CRON',
];
export const EXPORT_MODES: ExportMode[] = ['FULL', 'INCREMENTAL', 'SNAPSHOT'];

const CRON_PATTERN = /^\s*(\S+\s+){4}\S+\s*$/;

export function defaultCompression(format: ExportFormat): Compression {
  return format === 'PARQUET' ? 'SNAPPY' : 'NONE';
}

/** SNAPPY is only valid inside Parquet files. */
export function compressionOptions(format: ExportFormat): Compression[] {
  return format === 'PARQUET' ? ['SNAPPY', 'GZIP', 'NONE'] : ['NONE', 'GZIP'];
}

export function retentionChoiceFor(days: number | null): RetentionChoice {
  if (days === null) return 'NONE';
  if (days === 7 || days === 30 || days === 90) {
    return String(days) as RetentionChoice;
  }
  return 'CUSTOM';
}

export function retentionDaysFrom(form: WizardForm): number | null {
  switch (form.retention) {
    case 'NONE':
      return null;
    case 'CUSTOM':
      return Number(form.customRetentionDays.trim());
    default:
      return Number(form.retention);
  }
}

export function initialWizardForm(
  profile: ExportProfile | undefined,
  tenantOptions: string[],
): WizardForm {
  const initialTenant =
    profile?.tenantId ?? (tenantOptions.length === 1 ? tenantOptions[0] : '');
  return {
    name: profile?.name ?? '',
    customerName: profile?.customerName ?? initialTenant,
    tenantId: initialTenant,
    environment: 'PRODUCTION',
    clusterId: profile?.clusterId ?? '',
    clusterLabel: profile?.clusterName ?? '',
    namespace: profile?.namespace ?? 'nrod',
    packageCode: profile?.packageCode ?? '',
    packageCodes: profile?.packageCode ? [profile.packageCode] : [],
    packageName: profile?.packageName ?? '',
    packageDescription: '',
    schedule: profile?.schedule ?? 'DAILY',
    cronExpression:
      profile?.schedule === 'CUSTOM_CRON' ? profile.cronExpression : '',
    exportMode: profile?.exportMode ?? 'FULL',
    fileFormat: profile?.fileFormat ?? 'TSV',
    compression: profile?.compression ?? 'NONE',
    watermarkStrategy:
      profile?.watermarkStrategy ?? 'GREATER_THAN',
    retention: profile ? retentionChoiceFor(profile.retentionDays) : '30',
    customRetentionDays:
      profile && retentionChoiceFor(profile.retentionDays) === 'CUSTOM'
        ? String(profile.retentionDays)
        : '',
    destinationMode: 'existing',
    destinationId: profile?.destinationId ?? '',
    destinationLabel: profile?.destinationName ?? 'Azure Blob Storage',
    newDestinationName: '',
    newDestinationType: 'ADLS_GEN2',
    newDestinationConfig: initialDestinationConfig('ADLS_GEN2'),
    datasets: profile?.datasets?.map(dataset => ({ ...dataset })) ?? [],
  };
}

/** Selected datasets that are known not to support incremental export. */
export function nonIncrementalDatasets(
  datasets: DatasetOption[],
): DatasetOption[] {
  return datasets.filter(dataset => dataset.supportsIncremental === false);
}

/** Returns the first problem with a step, or null when the step can be left. */
export function stepProblem(step: number, form: WizardForm): string | null {
  switch (step) {
    case 0:
      if (!form.tenantId) return 'Select a customer.';
      return null;
    case 1:
      if (!form.clusterId) return 'Select a production AKS cluster.';
      return null;
    case 2:
      if (form.packageCodes.length === 0)
        return 'Select at least one standard export package.';
      return null;
    case 3:
      if (
        form.schedule === 'CUSTOM_CRON' &&
        !CRON_PATTERN.test(form.cronExpression)
      ) {
        return 'Enter a 5-field cron expression, for example 0 2 * * *.';
      }
      return null;
    default:
      return null;
  }
}

/** First step with a problem, used to block submit and jump back. */
export function firstInvalidStep(form: WizardForm): number | null {
  for (let step = 0; step < REVIEW_STEP; step += 1) {
    if (stepProblem(step, form)) return step;
  }
  return null;
}

export function buildExportInput(
  form: WizardForm,
  destinationId: string,
  enabled: boolean,
): ExportInput {
  const exportName =
    form.name.trim() ||
    `${form.customerName || form.tenantId} - ${form.packageName || form.packageCode}`;
  return {
    name: exportName,
    tenantId: form.tenantId,
    customerName: form.customerName || form.tenantId,
    packageCode: form.packageCodes.length === 1 ? form.packageCodes[0] : null,
    packageCodes: form.packageCodes,
    packageName: form.packageName,
    environment: 'PRODUCTION',
    clusterId: form.clusterId,
    namespace: form.namespace?.trim() || 'nrod',
    schedule: form.schedule,
    cronExpression:
      form.schedule === 'CUSTOM_CRON' ? form.cronExpression.trim() : undefined,
    exportMode: form.exportMode,
    fileFormat: form.fileFormat,
    compression: form.compression,
    watermarkStrategy:
      form.exportMode === 'INCREMENTAL'
        ? form.watermarkStrategy ?? 'GREATER_THAN'
        : null,
    retentionDays: retentionDaysFrom(form),
    destinationId: destinationId || '',
    datasetIds: form.datasets.map(d => d.id),
    enabled,
  };
}

export function newDestinationInput(form: WizardForm) {
  return {
    type: form.newDestinationType,
    name: form.newDestinationName.trim(),
    configuration: normaliseDestinationConfig(
      form.newDestinationType,
      form.newDestinationConfig,
    ),
    tenantId: form.tenantId,
  };
}

/** Applies a format change, resetting compression to the format's default when it becomes invalid. */
export function withFormat(
  form: WizardForm,
  fileFormat: ExportFormat,
): WizardForm {
  const compression = compressionOptions(fileFormat).includes(form.compression)
    ? form.compression
    : defaultCompression(fileFormat);
  return { ...form, fileFormat, compression };
}

export function scheduleSummary(
  form: Pick<WizardForm, 'schedule' | 'cronExpression'>,
  labels: Record<Schedule, string>,
): string {
  return form.schedule === 'CUSTOM_CRON'
    ? `Custom cron: ${form.cronExpression.trim()}`
    : labels[form.schedule];
}
