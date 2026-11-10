import type { DataExportDatabase, Queryable } from '../db';
import { ListRequest, ListSpec } from '../listQuery';
import { SqlParams, likePattern, whereClause } from '../sql';
import type { DatasetColumn, DatasetInput } from '../validation';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface DatasetRecord {
  id: string;
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
  updatedAt: string;
}

export interface LineageNode {
  id: string;
  datasetId: string;
  displayName: string;
  category: string;
  enabled: boolean;
}

export const DATASET_LIST: ListSpec = {
  sortable: {
    datasetId: 'd.dataset_id',
    displayName: 'd.display_name',
    sourceProduct: 'd.source_product',
    category: 'd.category',
    classification: 'd.classification',
    updatedAt: 'd.updated_at',
  },
  defaultSort: { field: 'datasetId', order: 'asc' },
  filters: ['sourceProduct', 'category', 'classification', 'status', 'containsPii', 'supportsIncremental', 'hasSqlTemplate'],
};

const SELECT = `SELECT d.*,
    ARRAY(SELECT dd.depends_on_id::text FROM data_export.dataset_dependencies dd
           WHERE dd.dataset_id = d.id ORDER BY dd.depends_on_id) AS depends_on
  FROM data_export.datasets d`;

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : (value as string));

function mapDataset(row: Row): DatasetRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    displayName: row.display_name,
    businessDescription: row.business_description,
    sourceProduct: row.source_product,
    sourceDomain: row.source_domain,
    category: row.category,
    ownerTeam: row.owner_team,
    supportEmail: row.support_email,
    classification: row.classification,
    containsPii: row.contains_pii,
    containsSensitiveData: row.contains_sensitive_data,
    estimatedDailyVolume: row.estimated_daily_volume === null ? null : Number(row.estimated_daily_volume),
    refreshPattern: row.refresh_pattern,
    retentionDays: row.retention_days,
    supportsIncremental: row.supports_incremental,
    watermarkColumn: row.watermark_column,
    watermarkStrategy: row.watermark_strategy,
    primaryKeys: row.primary_keys ?? [],
    sourceTables: row.source_tables ?? [],
    columnMetadata: row.column_metadata ?? [],
    sampleSchema: row.sample_schema,
    sqlTemplate: row.sql_template,
    dependsOn: row.depends_on ?? [],
    enabled: row.enabled,
    updatedAt: iso(row.updated_at),
  };
}

/** Catalog fields → column, with JSON encoding where the column is JSONB. */
const WRITABLE: Record<string, { column: string; json?: boolean }> = {
  displayName: { column: 'display_name' },
  businessDescription: { column: 'business_description' },
  sourceProduct: { column: 'source_product' },
  sourceDomain: { column: 'source_domain' },
  category: { column: 'category' },
  ownerTeam: { column: 'owner_team' },
  supportEmail: { column: 'support_email' },
  classification: { column: 'classification' },
  containsPii: { column: 'contains_pii' },
  containsSensitiveData: { column: 'contains_sensitive_data' },
  estimatedDailyVolume: { column: 'estimated_daily_volume' },
  refreshPattern: { column: 'refresh_pattern' },
  retentionDays: { column: 'retention_days' },
  supportsIncremental: { column: 'supports_incremental' },
  watermarkColumn: { column: 'watermark_column' },
  watermarkStrategy: { column: 'watermark_strategy' },
  primaryKeys: { column: 'primary_keys', json: true },
  sourceTables: { column: 'source_tables' },
  columnMetadata: { column: 'column_metadata', json: true },
  sampleSchema: { column: 'sample_schema', json: true },
  sqlTemplate: { column: 'sql_template' },
  enabled: { column: 'enabled' },
};

const encode = (key: string, value: unknown) =>
  WRITABLE[key].json && value !== null ? JSON.stringify(value) : value;

export class CatalogRepository {
  constructor(private readonly db: DataExportDatabase) {}

  async list(request: ListRequest) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      request.search &&
        `(d.dataset_id ILIKE ${params.add(likePattern(request.search))} OR d.display_name ILIKE $${params.values.length}
          OR d.business_description ILIKE $${params.values.length})`,
      filters.sourceProduct && `d.source_product = ${params.add(filters.sourceProduct)}`,
      filters.category && `d.category = ${params.add(filters.category)}`,
      filters.classification && `d.classification = ${params.add(filters.classification)}`,
      filters.status === 'ENABLED' && 'd.enabled',
      filters.status === 'DISABLED' && 'NOT d.enabled',
      filters.containsPii === 'true' && 'd.contains_pii',
      filters.containsPii === 'false' && 'NOT d.contains_pii',
      filters.supportsIncremental === 'true' && 'd.supports_incremental AND d.watermark_column IS NOT NULL',
      filters.supportsIncremental === 'false' && 'NOT d.supports_incremental',
      // Only datasets with SQL can be exported; the export wizard asks for these.
      filters.hasSqlTemplate === 'true' && 'd.sql_template IS NOT NULL',
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM data_export.datasets d ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query(
      `${SELECT} ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return { items: result.rows.map(mapDataset), total: Number(count.rows[0].total) };
  }

  async findById(id: string): Promise<DatasetRecord | null> {
    const result = await this.db.query(`${SELECT} WHERE d.id = $1`, [id]);
    return result.rows[0] ? mapDataset(result.rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<DatasetRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.db.query(`${SELECT} WHERE d.id = ANY($1::uuid[])`, [ids]);
    return result.rows.map(mapDataset);
  }

  /** Options for filter drop-downs: every dataset, enabled first. */
  async options() {
    const result = await this.db.query(
      'SELECT id, dataset_id, display_name FROM data_export.datasets ORDER BY enabled DESC, dataset_id',
    );
    return result.rows.map(row => ({ id: row.id, datasetId: row.dataset_id, displayName: row.display_name }));
  }

  async insert(id: string, values: DatasetInput, tx: Queryable) {
    const keys = Object.keys(WRITABLE).filter(key => (values as unknown as Row)[key] !== undefined);
    const params = new SqlParams();
    const placeholders = [params.add(id), params.add(values.datasetId)];
    for (const key of keys) placeholders.push(params.add(encode(key, (values as unknown as Row)[key])));
    await tx.query(
      `INSERT INTO data_export.datasets (id, dataset_id, ${keys.map(key => WRITABLE[key].column).join(', ')})
       VALUES (${placeholders.join(', ')})`,
      params.values,
    );
    await this.replaceDependencies(id, values.dependsOn, tx);
  }

  async update(id: string, patch: Partial<DatasetInput>, tx: Queryable) {
    const params = new SqlParams();
    const sets: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!WRITABLE[key] || value === undefined) continue;
      sets.push(`${WRITABLE[key].column} = ${params.add(encode(key, value))}`);
    }
    if (sets.length > 0) {
      await tx.query(
        `UPDATE data_export.datasets SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ${params.add(id)}`,
        params.values,
      );
    }
    if (patch.dependsOn) await this.replaceDependencies(id, patch.dependsOn, tx);
  }

  private async replaceDependencies(id: string, dependsOn: string[], tx: Queryable) {
    await tx.query('DELETE FROM data_export.dataset_dependencies WHERE dataset_id = $1', [id]);
    if (dependsOn.length === 0) return;
    await tx.query(
      `INSERT INTO data_export.dataset_dependencies (dataset_id, depends_on_id)
       SELECT $1, UNNEST($2::uuid[])`,
      [id, dependsOn],
    );
  }

  /** Every dataset downstream of `id` (that depends on it, directly or transitively). */
  async downstreamIds(id: string, db: Queryable = this.db): Promise<string[]> {
    const result = await db.query<{ id: string }>(
      `WITH RECURSIVE down(id) AS (
         SELECT dataset_id FROM data_export.dataset_dependencies WHERE depends_on_id = $1
         UNION
         SELECT dd.dataset_id FROM data_export.dataset_dependencies dd JOIN down ON dd.depends_on_id = down.id
       ) SELECT id::text FROM down`,
      [id],
    );
    return result.rows.map(row => row.id);
  }

  /** The dataset plus everything reachable upstream and downstream, with the edges between them. */
  async lineage(id: string) {
    const nodes = await this.db.query<Row>(
      `WITH RECURSIVE
         up(id) AS (
           SELECT depends_on_id FROM data_export.dataset_dependencies WHERE dataset_id = $1
           UNION
           SELECT dd.depends_on_id FROM data_export.dataset_dependencies dd JOIN up ON dd.dataset_id = up.id
         ),
         down(id) AS (
           SELECT dataset_id FROM data_export.dataset_dependencies WHERE depends_on_id = $1
           UNION
           SELECT dd.dataset_id FROM data_export.dataset_dependencies dd JOIN down ON dd.depends_on_id = down.id
         ),
         members(id) AS (SELECT $1::uuid UNION SELECT id FROM up UNION SELECT id FROM down)
       SELECT d.id, d.dataset_id, d.display_name, d.category, d.enabled
         FROM data_export.datasets d JOIN members m ON m.id = d.id
        ORDER BY d.dataset_id`,
      [id],
    );
    const ids = nodes.rows.map(row => row.id);
    const edges = await this.db.query(
      `SELECT depends_on_id AS "from", dataset_id AS "to" FROM data_export.dataset_dependencies
        WHERE dataset_id = ANY($1::uuid[]) AND depends_on_id = ANY($1::uuid[])`,
      [ids],
    );
    return {
      nodes: nodes.rows.map(
        (row): LineageNode => ({
          id: row.id,
          datasetId: row.dataset_id,
          displayName: row.display_name,
          category: row.category,
          enabled: row.enabled,
        }),
      ),
      edges: edges.rows.map(row => ({ from: row.from as string, to: row.to as string })),
    };
  }

  async countEnabled(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM data_export.datasets WHERE enabled',
    );
    return Number(result.rows[0].count);
  }
}
