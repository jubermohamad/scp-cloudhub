import {
  CLASSIFICATIONS,
  COMPRESSIONS,
  DATASET_CATEGORIES,
  DESTINATION_REQUIRED_FIELDS,
  DESTINATION_TYPES,
  EXPORT_ENVIRONMENTS,
  EXPORT_FORMATS,
  EXPORT_MODES,
  EXPORT_SCHEDULES,
  SCHEDULE_PRESETS,
  SOURCE_PRODUCTS,
  WATERMARK_STRATEGIES,
} from './constants';

export class ValidationError extends Error {
  constructor(readonly details: string[]) {
    super(details.join('; '));
    this.name = 'ValidationError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATASET_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CLUSTER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const COLUMN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON_FIELD_PATTERN = /^[\d*/,-]+$/;
/** Keys that look like credentials. Secrets must live in Key Vault. */
const CREDENTIAL_KEY_PATTERN = /password|passwd|secret(?!ref)|token|apikey|privatekey|credential|connectionstring|saskey/i;
const STORAGE_ACCOUNT_PATTERN = /^[a-z0-9]{3,24}$/;
const FILE_SYSTEM_PATTERN = /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/;
/** `kv://<vault-name>/<secret-name>` — Key Vault naming rules. */
const SECRET_REF_PATTERN = /^kv:\/\/[A-Za-z][A-Za-z0-9-]{1,22}[A-Za-z0-9]\/[A-Za-z0-9-]{1,127}$/;
/** OpenSSH-style SHA256 fingerprint: `SHA256:` + 43 base64 characters (padding optional). */
const HOST_KEY_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}=?$/;
const MAX_RETENTION_DAYS = 3650;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  return fields.length === 5 && fields.every(field => CRON_FIELD_PATTERN.test(field));
}

/** Expands a schedule preset, or validates and returns a custom cron expression. */
export function resolveSchedule(schedule: string, cronExpression?: string | null): { cronExpression: string } {
  if (schedule === 'CUSTOM_CRON') {
    if (!cronExpression || !isValidCron(cronExpression)) {
      throw new ValidationError(['cronExpression must be a 5-field cron expression']);
    }
    return { cronExpression: cronExpression.trim().replace(/\s+/g, ' ') };
  }
  const preset = SCHEDULE_PRESETS[schedule as keyof typeof SCHEDULE_PRESETS];
  if (!preset) {
    throw new ValidationError([`schedule must be one of ${EXPORT_SCHEDULES.join(', ')}`]);
  }
  return { cronExpression: preset };
}

function requireString(body: Record<string, unknown>, key: string, errors: string[], maxLength = 255) {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${key} is required`);
    return undefined;
  }
  if (value.length > maxLength) {
    errors.push(`${key} must be at most ${maxLength} characters`);
    return undefined;
  }
  return value.trim();
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  errors: string[],
  maxLength = 255,
): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    errors.push(`${key} must be a string of at most ${maxLength} characters`);
    return undefined;
  }
  return value.trim();
}

function requireEnum<T extends readonly string[]>(
  body: Record<string, unknown>,
  key: string,
  allowed: T,
  errors: string[],
): T[number] | undefined {
  const value = body[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${key} must be one of ${allowed.join(', ')}`);
    return undefined;
  }
  return value as T[number];
}

function optionalEnum<T extends readonly string[]>(
  body: Record<string, unknown>,
  key: string,
  allowed: T,
  errors: string[],
): T[number] | null | undefined {
  if (body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  return requireEnum(body, key, allowed, errors);
}

function requireTenantId(body: Record<string, unknown>, errors: string[]): string | undefined {
  if (!isTenantId(body.tenantId)) {
    errors.push('tenantId must be lower-case letters, digits and hyphens, e.g. visa');
    return undefined;
  }
  return body.tenantId;
}

function optionalBoolean(body: Record<string, unknown>, key: string, errors: string[]): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    errors.push(`${key} must be a boolean`);
    return undefined;
  }
  return value;
}

function optionalInteger(
  body: Record<string, unknown>,
  key: string,
  errors: string[],
  min: number,
  max: number,
): number | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${key} must be a whole number between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function optionalJsonObject(
  body: Record<string, unknown>,
  key: string,
  errors: string[],
  maxBytes: number,
): Record<string, unknown> | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${key} must be a JSON object`);
    return undefined;
  }
  if (JSON.stringify(value).length > maxBytes) {
    errors.push(`${key} must be at most ${Math.round(maxBytes / 1024)} KB`);
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function bodyOf(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['request body must be a JSON object']);
  }
  return input as Record<string, unknown>;
}

export function throwIfErrors(errors: string[]): void {
  if (errors.length > 0) throw new ValidationError(errors);
}

function stringArray(body: Record<string, unknown>, key: string, errors: string[]): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    errors.push(`${key} must be an array of strings`);
    return undefined;
  }
  return value.map(item => item.trim()).filter(Boolean);
}

/* ---------- data catalog ---------- */

export interface DatasetColumn {
  name: string;
  type?: string;
  description?: string;
  nullable?: boolean;
  pii?: boolean;
}

function columnList(body: Record<string, unknown>, errors: string[]): DatasetColumn[] | undefined {
  const value = body.columnMetadata;
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 1000) {
    errors.push('columnMetadata must be an array of at most 1000 entries');
    return undefined;
  }
  const columns: DatasetColumn[] = [];
  value.forEach((item, index) => {
    const column = (item ?? {}) as Record<string, unknown>;
    if (typeof column.name !== 'string' || !COLUMN_NAME_PATTERN.test(column.name)) {
      errors.push(`columnMetadata[${index}].name must be a valid column name`);
      return;
    }
    if (column.type !== undefined && (typeof column.type !== 'string' || column.type.length > 64)) {
      errors.push(`columnMetadata[${index}].type must be a string of at most 64 characters`);
      return;
    }
    if (
      column.description !== undefined &&
      (typeof column.description !== 'string' || column.description.length > 1000)
    ) {
      errors.push(`columnMetadata[${index}].description must be a string of at most 1000 characters`);
      return;
    }
    for (const flag of ['nullable', 'pii'] as const) {
      if (column[flag] !== undefined && typeof column[flag] !== 'boolean') {
        errors.push(`columnMetadata[${index}].${flag} must be a boolean`);
        return;
      }
    }
    columns.push({
      name: column.name,
      ...(column.type ? { type: column.type as string } : {}),
      ...(column.description ? { description: column.description as string } : {}),
      ...(column.nullable !== undefined ? { nullable: column.nullable as boolean } : {}),
      ...(column.pii !== undefined ? { pii: column.pii as boolean } : {}),
    });
  });
  return columns;
}

/**
 * Stored templates are executed by agents inside a read-only session, but they
 * must still be a single SELECT (or WITH … SELECT) so a template cannot smuggle
 * in a second statement.
 */
function validSqlTemplate(sql: string | null | undefined, errors: string[]) {
  if (!sql) return;
  const normalized = sql.replace(/;\s*$/, '');
  if (!/^(select|with)\s/i.test(normalized) || normalized.includes(';')) {
    errors.push('sqlTemplate must be a single SELECT statement');
  }
}

export interface DatasetInput {
  datasetId: string;
  displayName: string;
  businessDescription: string | null;
  sourceProduct: string;
  sourceDomain: string | null;
  category: string;
  ownerTeam: string | null;
  supportEmail: string | null;
  classification: string;
  containsPii: boolean;
  containsSensitiveData: boolean;
  estimatedDailyVolume: number | null;
  refreshPattern: string | null;
  retentionDays: number | null;
  supportsIncremental: boolean;
  watermarkColumn: string | null;
  watermarkStrategy: string | null;
  primaryKeys: string[];
  sourceTables: string[];
  columnMetadata: DatasetColumn[];
  sampleSchema: Record<string, unknown> | null;
  sqlTemplate: string | null;
  dependsOn: string[];
  enabled: boolean;
}

/** Cross-field catalog rules, checked on create and on the merged record after an update. */
export function catalogProblems(dataset: {
  supportsIncremental: boolean;
  watermarkColumn: string | null;
  containsPii: boolean;
  classification: string;
}): string[] {
  const problems: string[] = [];
  if (dataset.supportsIncremental && !dataset.watermarkColumn) {
    problems.push('watermarkColumn is required when supportsIncremental is true');
  }
  if (dataset.containsPii && dataset.classification === 'PUBLIC') {
    problems.push('a dataset containing PII cannot be classified PUBLIC');
  }
  return problems;
}

/** Validates each catalog field present in `body`. Shared by create and update. */
function datasetFields(body: Record<string, unknown>, errors: string[]): Partial<DatasetInput> {
  const result: Partial<DatasetInput> = {};
  const assign = <K extends keyof DatasetInput>(key: K, value: DatasetInput[K] | undefined) => {
    if (value !== undefined) result[key] = value;
  };

  if (body.displayName !== undefined) assign('displayName', requireString(body, 'displayName', errors, 255));
  if (body.sourceProduct !== undefined) assign('sourceProduct', requireEnum(body, 'sourceProduct', SOURCE_PRODUCTS, errors));
  if (body.category !== undefined) assign('category', requireEnum(body, 'category', DATASET_CATEGORIES, errors));
  if (body.classification !== undefined) {
    assign('classification', requireEnum(body, 'classification', CLASSIFICATIONS, errors));
  }
  assign('businessDescription', optionalString(body, 'businessDescription', errors, 8000));
  assign('sourceDomain', optionalString(body, 'sourceDomain', errors, 100));
  assign('ownerTeam', optionalString(body, 'ownerTeam', errors, 255));
  const supportEmail = optionalString(body, 'supportEmail', errors, 255);
  if (supportEmail && !EMAIL_PATTERN.test(supportEmail)) errors.push('supportEmail must be an email address');
  assign('supportEmail', supportEmail);
  assign('containsPii', optionalBoolean(body, 'containsPii', errors));
  assign('containsSensitiveData', optionalBoolean(body, 'containsSensitiveData', errors));
  assign('estimatedDailyVolume', optionalInteger(body, 'estimatedDailyVolume', errors, 0, Number.MAX_SAFE_INTEGER));
  assign('refreshPattern', optionalString(body, 'refreshPattern', errors, 255));
  assign('retentionDays', optionalInteger(body, 'retentionDays', errors, 1, MAX_RETENTION_DAYS));
  assign('supportsIncremental', optionalBoolean(body, 'supportsIncremental', errors));
  assign('watermarkColumn', optionalString(body, 'watermarkColumn', errors, 128));
  if (result.watermarkColumn && !COLUMN_NAME_PATTERN.test(result.watermarkColumn)) {
    errors.push('watermarkColumn must be a valid column name');
  }
  assign('watermarkStrategy', optionalString(body, 'watermarkStrategy', errors, 1000));
  assign('primaryKeys', stringArray(body, 'primaryKeys', errors));
  assign('sourceTables', stringArray(body, 'sourceTables', errors));
  assign('columnMetadata', columnList(body, errors));
  assign('sampleSchema', optionalJsonObject(body, 'sampleSchema', errors, 64 * 1024));
  const sqlTemplate = optionalString(body, 'sqlTemplate', errors, 20000);
  validSqlTemplate(sqlTemplate, errors);
  assign('sqlTemplate', sqlTemplate);
  const dependsOn = stringArray(body, 'dependsOn', errors);
  if (dependsOn && !dependsOn.every(isUuid)) errors.push('dependsOn must contain dataset UUIDs');
  else assign('dependsOn', dependsOn ? [...new Set(dependsOn)] : undefined);
  assign('enabled', optionalBoolean(body, 'enabled', errors));
  return result;
}

export function validateDatasetInput(input: unknown): DatasetInput {
  const body = bodyOf(input);
  const errors: string[] = [];
  const datasetId = requireString(body, 'datasetId', errors, 128);
  if (datasetId && !DATASET_ID_PATTERN.test(datasetId)) {
    errors.push('datasetId must be upper-case letters, digits and underscores, e.g. NR_V_CASES');
  }
  if (body.displayName === undefined) errors.push('displayName is required');
  if (body.category === undefined) errors.push('category is required');
  const fields = datasetFields(body, errors);
  const values: DatasetInput = {
    datasetId: datasetId as string,
    displayName: fields.displayName as string,
    businessDescription: fields.businessDescription ?? null,
    sourceProduct: fields.sourceProduct ?? 'NETREVEAL',
    sourceDomain: fields.sourceDomain ?? null,
    category: fields.category as string,
    ownerTeam: fields.ownerTeam ?? null,
    supportEmail: fields.supportEmail ?? null,
    classification: fields.classification ?? 'INTERNAL',
    containsPii: fields.containsPii ?? false,
    containsSensitiveData: fields.containsSensitiveData ?? false,
    estimatedDailyVolume: fields.estimatedDailyVolume ?? null,
    refreshPattern: fields.refreshPattern ?? null,
    retentionDays: fields.retentionDays ?? null,
    supportsIncremental: fields.supportsIncremental ?? false,
    watermarkColumn: fields.watermarkColumn ?? null,
    watermarkStrategy: fields.watermarkStrategy ?? null,
    primaryKeys: fields.primaryKeys ?? [],
    sourceTables: fields.sourceTables ?? [],
    columnMetadata: fields.columnMetadata ?? [],
    sampleSchema: fields.sampleSchema ?? null,
    sqlTemplate: fields.sqlTemplate ?? null,
    dependsOn: fields.dependsOn ?? [],
    enabled: fields.enabled ?? true,
  };
  errors.push(...catalogProblems(values));
  throwIfErrors(errors);
  return values;
}

/** Partial update. Cross-field rules are checked by the service against the merged record. */
export function validateDatasetPatch(input: unknown): Partial<DatasetInput> {
  const body = bodyOf(input);
  const errors: string[] = [];
  if (body.datasetId !== undefined) errors.push('datasetId cannot be changed');
  const patch = datasetFields(body, errors);
  throwIfErrors(errors);
  return patch;
}

/* ---------- exports ---------- */

export interface ExportInput {
  name: string;
  tenantId: string;
  customerName?: string | null;
  packageCode?: string | null;
  packageCodes?: string[];
  packageName?: string | null;
  environment: string;
  clusterId: string;
  namespace: string | null;
  schedule: string;
  cronExpression: string;
  exportMode: string;
  fileFormat: string;
  compression: string;
  retentionDays: number | null;
  watermarkStrategy: string | null;
  destinationId: string;
  datasetIds: string[];
  enabled: boolean;
}

export function defaultCompression(fileFormat: string): string {
  return fileFormat === 'PARQUET' ? 'SNAPPY' : 'GZIP';
}

export function validateExportInput(input: unknown): ExportInput {
  const body = bodyOf(input);
  const errors: string[] = [];

  const packageCode = optionalString(body, 'packageCode', errors, 64) ?? null;
  const packageCodesRaw = body.packageCodes;
  let packageCodes: string[] = [];
  if (packageCodesRaw !== undefined) {
    if (!Array.isArray(packageCodesRaw)) {
      errors.push('packageCodes must be an array of package codes');
    } else {
      const invalid = packageCodesRaw.some(
        value => typeof value !== 'string' || value.trim().length === 0 || value.length > 64,
      );
      if (invalid) {
        errors.push('packageCodes must contain non-empty strings up to 64 characters');
      } else {
        packageCodes = [...new Set(packageCodesRaw.map(value => value.trim()))];
      }
    }
  }
  const packageName = optionalString(body, 'packageName', errors, 255) ?? null;
  const customerName = optionalString(body, 'customerName', errors, 255) ?? null;

  let nameValue = body.name;
  if (!nameValue && (packageName || packageCode)) {
    nameValue = packageName || packageCode;
  }
  const name = requireString({ ...body, name: nameValue }, 'name', errors, 120);
  const tenantId = requireTenantId(body, errors);
  const environmentValue = body.environment ?? 'PRODUCTION';
  const environment = requireEnum(
    { ...body, environment: environmentValue },
    'environment',
    EXPORT_ENVIRONMENTS,
    errors,
  );
  const schedule = requireEnum(body, 'schedule', EXPORT_SCHEDULES, errors);
  const fileFormatValue = body.fileFormat ?? (packageCode ? 'TSV' : undefined);
  const fileFormat = requireEnum(
    { ...body, fileFormat: fileFormatValue },
    'fileFormat',
    EXPORT_FORMATS,
    errors,
  );
  const exportMode = body.exportMode === undefined ? 'FULL' : requireEnum(body, 'exportMode', EXPORT_MODES, errors);
  const compression =
    body.compression === undefined || body.compression === null
      ? fileFormat && defaultCompression(fileFormat)
      : requireEnum(body, 'compression', COMPRESSIONS, errors);
  if (compression === 'SNAPPY' && fileFormat && fileFormat !== 'PARQUET') {
    errors.push('SNAPPY compression is only available for PARQUET');
  }
  const watermarkStrategy = optionalEnum(body, 'watermarkStrategy', WATERMARK_STRATEGIES, errors);
  const retentionDays = optionalInteger(body, 'retentionDays', errors, 1, MAX_RETENTION_DAYS) ?? null;
  if (!isUuid(body.clusterId)) errors.push('clusterId must be the UUID of a registered cluster');
  if (body.destinationId !== undefined && !isUuid(body.destinationId)) {
    errors.push('destinationId must be a UUID');
  }

  let datasetIds = body.datasetIds as string[] | undefined;
  if (!packageCode && packageCodes.length === 0) {
    if (!Array.isArray(datasetIds) || datasetIds.length === 0) {
      errors.push('datasetIds must contain at least one dataset');
    } else if (datasetIds.length > 50) {
      errors.push('datasetIds may contain at most 50 datasets');
    } else if (!datasetIds.every(isUuid)) {
      errors.push('datasetIds must contain only UUIDs');
    }
  } else if (datasetIds !== undefined) {
    if (!Array.isArray(datasetIds) || !datasetIds.every(isUuid)) {
      errors.push('datasetIds must contain only UUIDs');
    }
  } else {
    datasetIds = [];
  }

  let cronExpression = '';
  if (schedule) {
    try {
      cronExpression = resolveSchedule(schedule, body.cronExpression as string | undefined).cronExpression;
    } catch (error) {
      errors.push((error as ValidationError).details?.[0] ?? 'invalid schedule');
    }
  }

  const namespace = optionalString(body, 'namespace', errors, 255) ?? null;
  const enabled = optionalBoolean(body, 'enabled', errors) ?? true;
  throwIfErrors(errors);

  return {
    name: name as string,
    tenantId: tenantId as string,
    customerName,
    packageCode,
    packageCodes,
    packageName,
    environment: environment as string,
    clusterId: body.clusterId as string,
    namespace,
    schedule: schedule as string,
    cronExpression,
    exportMode: exportMode as string,
    fileFormat: fileFormat as string,
    compression: compression as string,
    retentionDays,
    watermarkStrategy:
      exportMode === 'INCREMENTAL' ? watermarkStrategy ?? 'GREATER_THAN' : null,
    destinationId: (body.destinationId as string) || '',
    datasetIds: [...new Set(datasetIds as string[])],
    enabled,
  };
}

/* ---------- destinations ---------- */

export interface DestinationInput {
  type: string;
  name: string;
  configuration: Record<string, string>;
  enabled: boolean;
  owner: string | null;
  /** null means a shared, platform-managed destination; files still land under tenant/<tenant>/. */
  tenantId: string | null;
}

/**
 * Checks destination configuration without contacting the destination.
 * Returns human-readable problems; an empty array means the shape is valid.
 */
export function destinationConfigProblems(type: string, configuration: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (!(DESTINATION_TYPES as readonly string[]).includes(type)) {
    return [`${type} destinations have no delivery provider; use ${DESTINATION_TYPES.join(' or ')}`];
  }
  for (const [key, value] of Object.entries(configuration)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) {
      problems.push(`${key} looks like a credential; store it in Key Vault and use secretRef`);
    }
    if (value !== undefined && value !== null && typeof value !== 'string') {
      problems.push(`configuration.${key} must be a string`);
    }
  }
  for (const key of DESTINATION_REQUIRED_FIELDS[type as (typeof DESTINATION_TYPES)[number]]) {
    const value = configuration[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      problems.push(`configuration.${key} is required for ${type}`);
    }
  }
  const get = (key: string) => (typeof configuration[key] === 'string' ? (configuration[key] as string).trim() : '');
  if (type === 'ADLS_GEN2') {
    if (get('accountName') && !STORAGE_ACCOUNT_PATTERN.test(get('accountName'))) {
      problems.push('configuration.accountName must be 3–24 lower-case letters and digits');
    }
    if (get('fileSystem') && !FILE_SYSTEM_PATTERN.test(get('fileSystem'))) {
      problems.push('configuration.fileSystem must be a valid ADLS file system name');
    }
    if (get('path') && (get('path').startsWith('/') || get('path').includes('..'))) {
      problems.push('configuration.path must be a relative path without ".."');
    }
  }
  if (type === 'SFTP') {
    if (get('port') && !/^\d{1,5}$/.test(get('port'))) problems.push('configuration.port must be a number');
    if (get('secretRef') && !SECRET_REF_PATTERN.test(get('secretRef'))) {
      problems.push('configuration.secretRef must look like kv://<vault-name>/<secret-name>');
    }
    if (get('hostKeyFingerprint') && !HOST_KEY_FINGERPRINT_PATTERN.test(get('hostKeyFingerprint'))) {
      problems.push('configuration.hostKeyFingerprint must look like SHA256:<base64>, as printed by ssh-keygen -lf');
    }
    if (get('remotePath') && get('remotePath').includes('..')) {
      problems.push('configuration.remotePath must not contain ".."');
    }
  }
  return problems;
}

export function validateDestinationInput(input: unknown): DestinationInput {
  const body = bodyOf(input);
  const errors: string[] = [];
  const type = requireEnum(body, 'type', DESTINATION_TYPES, errors);
  const name = requireString(body, 'name', errors, 120);
  const configuration = body.configuration;
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    errors.push('configuration must be an object');
  } else if (type) {
    errors.push(...destinationConfigProblems(type, configuration as Record<string, unknown>));
  }
  let tenantId: string | null = null;
  if (body.tenantId !== undefined && body.tenantId !== null && body.tenantId !== '') {
    tenantId = requireTenantId(body, errors) ?? null;
  }
  const owner = optionalString(body, 'owner', errors, 255) ?? null;
  const enabled = optionalBoolean(body, 'enabled', errors) ?? true;
  throwIfErrors(errors);
  const normalized = Object.fromEntries(
    Object.entries(configuration as Record<string, string>).map(([key, value]) => [key, value.trim()]),
  );
  if (type === 'ADLS_GEN2' && !normalized.fileSystem) normalized.fileSystem = 'data-export-hub';
  return { type: type as string, name: name as string, configuration: normalized, enabled, owner, tenantId };
}

/* ---------- clusters and agents ---------- */

export interface ClusterInput {
  clusterName: string;
  subscriptionId: string | null;
  resourceGroup: string | null;
  environment: string;
  region: string | null;
  tenantId: string;
}

export function validateClusterInput(input: unknown): ClusterInput {
  const body = bodyOf(input);
  const errors: string[] = [];
  const clusterName = requireString(body, 'clusterName', errors, 63);
  if (clusterName && !CLUSTER_NAME_PATTERN.test(clusterName)) {
    errors.push(
      'clusterName must start with a letter or digit and contain only letters, digits, hyphens and underscores',
    );
  }
  const subscriptionId = optionalString(body, 'subscriptionId', errors, 36) ?? null;
  if (subscriptionId && !isUuid(subscriptionId)) errors.push('subscriptionId must be an Azure subscription GUID');
  const environment = requireEnum(body, 'environment', EXPORT_ENVIRONMENTS, errors);
  const tenantId = requireTenantId(body, errors);
  const resourceGroup = optionalString(body, 'resourceGroup', errors, 90) ?? null;
  const region = optionalString(body, 'region', errors, 64) ?? null;
  throwIfErrors(errors);
  return {
    clusterName: clusterName as string,
    subscriptionId,
    resourceGroup,
    environment: environment as string,
    region,
    tenantId: tenantId as string,
  };
}

export interface AgentRegistration {
  agentName: string | null;
  identitySubject: string;
}

/**
 * An agent is identified by the Entra object id of its workload identity: the
 * `sub` of the tokens it presents. Version, status and capabilities are
 * reported by the agent itself in heartbeats.
 */
export function validateAgentInput(input: unknown, partial = false): Partial<AgentRegistration> {
  const body = bodyOf(input);
  const errors: string[] = [];
  const result: Partial<AgentRegistration> = {};
  if (!partial || body.identitySubject !== undefined) {
    if (!isUuid(body.identitySubject)) {
      errors.push('identitySubject must be the object id (GUID) of the agent workload identity');
    } else {
      result.identitySubject = (body.identitySubject as string).toLowerCase();
    }
  }
  const agentName = optionalString(body, 'agentName', errors, 255);
  if (agentName !== undefined) result.agentName = agentName;
  throwIfErrors(errors);
  return result;
}
