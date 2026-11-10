import type {
  Classification,
  Dataset,
  DatasetCategory,
  DatasetColumn,
  DatasetInput,
  SourceProduct,
} from './types';

/** Editable form state for a catalog dataset. Text inputs hold strings until saved. */
export interface DatasetDraft {
  datasetId: string;
  displayName: string;
  businessDescription: string;
  sourceProduct: SourceProduct;
  sourceDomain: string;
  category: DatasetCategory;
  ownerTeam: string;
  supportEmail: string;
  classification: Classification;
  containsPii: boolean;
  containsSensitiveData: boolean;
  estimatedDailyVolume: string;
  refreshPattern: string;
  retentionDays: string;
  supportsIncremental: boolean;
  watermarkColumn: string;
  watermarkStrategy: string;
  primaryKeys: string;
  sourceTables: string;
  columnMetadata: DatasetColumn[];
  sampleSchema: string;
  sqlTemplate: string;
  dependsOn: string[];
  enabled: boolean;
}

export const EMPTY_DATASET_DRAFT: DatasetDraft = {
  datasetId: '',
  displayName: '',
  businessDescription: '',
  sourceProduct: 'NETREVEAL',
  sourceDomain: '',
  category: 'CASES',
  ownerTeam: '',
  supportEmail: '',
  classification: 'CONFIDENTIAL',
  containsPii: false,
  containsSensitiveData: false,
  estimatedDailyVolume: '',
  refreshPattern: '',
  retentionDays: '',
  supportsIncremental: false,
  watermarkColumn: '',
  watermarkStrategy: '',
  primaryKeys: '',
  sourceTables: '',
  columnMetadata: [],
  sampleSchema: '',
  sqlTemplate: '',
  dependsOn: [],
  enabled: true,
};

export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

/** Parses one column per line: `NAME [TYPE] [- description]`. Used for bulk entry. */
export function parseColumns(text: string): DatasetColumn[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [head, ...rest] = line.split(/\s+-\s+/);
      const [name, ...typeParts] = head.split(/\s+/);
      const type = typeParts.join(' ');
      const description = rest.join(' - ');
      return {
        name,
        ...(type ? { type } : {}),
        ...(description ? { description } : {}),
      };
    });
}

export function datasetToDraft(dataset: Dataset): DatasetDraft {
  return {
    datasetId: dataset.datasetId,
    displayName: dataset.displayName,
    businessDescription: dataset.businessDescription ?? '',
    sourceProduct: dataset.sourceProduct,
    sourceDomain: dataset.sourceDomain ?? '',
    category: dataset.category,
    ownerTeam: dataset.ownerTeam ?? '',
    supportEmail: dataset.supportEmail ?? '',
    classification: dataset.classification,
    containsPii: dataset.containsPii,
    containsSensitiveData: dataset.containsSensitiveData,
    estimatedDailyVolume:
      dataset.estimatedDailyVolume === null
        ? ''
        : String(dataset.estimatedDailyVolume),
    refreshPattern: dataset.refreshPattern ?? '',
    retentionDays:
      dataset.retentionDays === null ? '' : String(dataset.retentionDays),
    supportsIncremental: dataset.supportsIncremental,
    watermarkColumn: dataset.watermarkColumn ?? '',
    watermarkStrategy: dataset.watermarkStrategy ?? '',
    primaryKeys: dataset.primaryKeys.join(', '),
    sourceTables: dataset.sourceTables.join(', '),
    columnMetadata: dataset.columnMetadata.map(column => ({ ...column })),
    sampleSchema: dataset.sampleSchema
      ? JSON.stringify(dataset.sampleSchema, null, 2)
      : '',
    sqlTemplate: dataset.sqlTemplate ?? '',
    dependsOn: [...dataset.dependsOn],
    enabled: dataset.enabled,
  };
}

const nullable = (value: string) => (value.trim() ? value.trim() : null);
const wholeNumber = (value: string) =>
  value.trim() ? Number(value.trim()) : null;

function cleanColumn(column: DatasetColumn): DatasetColumn {
  const result: DatasetColumn = { name: column.name.trim() };
  if (column.type?.trim()) result.type = column.type.trim();
  if (column.description?.trim())
    result.description = column.description.trim();
  if (column.nullable !== undefined) result.nullable = column.nullable;
  if (column.pii !== undefined) result.pii = column.pii;
  return result;
}

/** Converts the form draft to the API body. Empty optional fields are sent as null. Call draftProblem first. */
export function draftToInput(draft: DatasetDraft): DatasetInput {
  return {
    datasetId: draft.datasetId.trim(),
    displayName: draft.displayName.trim(),
    businessDescription: nullable(draft.businessDescription),
    sourceProduct: draft.sourceProduct,
    sourceDomain: nullable(draft.sourceDomain),
    category: draft.category,
    ownerTeam: nullable(draft.ownerTeam),
    supportEmail: nullable(draft.supportEmail),
    classification: draft.classification,
    containsPii: draft.containsPii,
    containsSensitiveData: draft.containsSensitiveData,
    estimatedDailyVolume: wholeNumber(draft.estimatedDailyVolume),
    refreshPattern: nullable(draft.refreshPattern),
    retentionDays: wholeNumber(draft.retentionDays),
    supportsIncremental: draft.supportsIncremental,
    watermarkColumn: nullable(draft.watermarkColumn),
    watermarkStrategy: nullable(draft.watermarkStrategy),
    primaryKeys: splitList(draft.primaryKeys),
    sourceTables: splitList(draft.sourceTables),
    columnMetadata: draft.columnMetadata
      .filter(column => column.name.trim())
      .map(cleanColumn),
    sampleSchema: draft.sampleSchema.trim()
      ? (JSON.parse(draft.sampleSchema) as Record<string, unknown>)
      : null,
    sqlTemplate: nullable(draft.sqlTemplate),
    dependsOn: [...new Set(draft.dependsOn)],
    enabled: draft.enabled,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATASET_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** Problems the form can catch before calling the API. The backend re-checks everything. */
export function draftProblem(
  draft: DatasetDraft,
  selfId?: string,
): string | null {
  if (!draft.datasetId.trim() || !draft.displayName.trim())
    return 'Dataset ID and display name are required.';
  if (!DATASET_ID_PATTERN.test(draft.datasetId.trim()))
    return 'Dataset ID must start with a letter and contain only letters, digits, _ . or -.';
  for (const [label, value] of [
    ['Retention', draft.retentionDays],
    ['Estimated daily volume', draft.estimatedDailyVolume],
  ] as const) {
    if (value.trim() && !/^\d+$/.test(value.trim()))
      return `${label} must be a whole number.`;
  }
  if (
    draft.supportEmail.trim() &&
    !EMAIL_PATTERN.test(draft.supportEmail.trim())
  )
    return 'Support contact must be an email address.';
  if (draft.supportsIncremental && !draft.watermarkColumn.trim())
    return 'Incremental export needs a watermark column.';
  const names = draft.columnMetadata
    .map(column => column.name.trim().toUpperCase())
    .filter(Boolean);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) return `Column ${duplicate} is listed more than once.`;
  if (
    draft.columnMetadata.some(
      column => !column.name.trim() && (column.type || column.description),
    )
  )
    return 'Every column needs a name.';
  if (selfId && draft.dependsOn.includes(selfId))
    return 'A dataset cannot depend on itself.';
  if (draft.sampleSchema.trim()) {
    try {
      const parsed = JSON.parse(draft.sampleSchema);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return 'Sample schema must be a JSON object.';
    } catch {
      return 'Sample schema is not valid JSON.';
    }
  }
  return null;
}
