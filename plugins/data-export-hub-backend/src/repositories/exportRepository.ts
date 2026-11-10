import type { TenantScope } from '../access';
import type { DataExportDatabase, Queryable } from '../db';
import { ListRequest, ListSpec } from '../listQuery';
import { SqlParams, likePattern, tenantScopeClause, whereClause } from '../sql';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface ProfileRecord {
  id: string;
  name: string;
  tenantId: string;
  ownerId: string;
  createdBy: string | null;
  clusterId: string;
  clusterName: string;
  environment: string;
  namespace: string | null;
  schedule: string;
  cronExpression: string;
  exportMode: string;
  fileFormat: string;
  compression: string;
  retentionDays: number | null;
  watermarkStrategy: string | null;
  destinationId: string;
  destinationName: string | null;
  destinationType: string | null;
  packageCode: string | null;
  packageName: string | null;
  customerName: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  datasets: Array<{ id: string; datasetId: string; displayName: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileValues {
  name: string;
  tenantId: string;
  clusterId: string;
  environment: string;
  namespace: string | null;
  schedule: string;
  cronExpression: string;
  exportMode: string;
  fileFormat: string;
  compression: string;
  retentionDays: number | null;
  watermarkStrategy: string | null;
  destinationId: string;
  enabled: boolean;
  packageCode?: string | null;
  packageName?: string | null;
  customerName?: string | null;
}

const BASE = `
  SELECT p.*, c.cluster_name, dest.name AS destination_name, dest.type AS destination_type,
         lr.last_run_at, lr.last_run_status
    FROM data_export.export_profiles p
    JOIN data_export.clusters c ON c.id = p.cluster_id
    LEFT JOIN data_export.destinations dest ON dest.id = p.destination_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(j.started_time, j.scheduled_time) AS last_run_at, j.status AS last_run_status
        FROM data_export.jobs j
       WHERE j.profile_id = p.id
       ORDER BY j.created_at DESC
       LIMIT 1
    ) lr ON TRUE`;

export const EXPORT_LIST: ListSpec = {
  sortable: {
    name: 'x.name',
    tenantId: 'x.tenant_id',
    environment: 'x.environment',
    exportMode: 'x.export_mode',
    fileFormat: 'x.file_format',
    enabled: 'x.enabled',
    lastRunAt: 'x.last_run_at',
    createdAt: 'x.created_at',
    updatedAt: 'x.updated_at',
  },
  defaultSort: { field: 'name', order: 'asc' },
  filters: ['tenantId', 'clusterId', 'environment', 'status', 'datasetId', 'ownerId'],
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : ((value as string | null) ?? null));

const COLUMNS: Record<keyof ProfileValues, string> = {
  name: 'name',
  tenantId: 'tenant_id',
  clusterId: 'cluster_id',
  environment: 'environment',
  namespace: 'namespace',
  schedule: 'schedule',
  cronExpression: 'cron_expression',
  exportMode: 'export_mode',
  fileFormat: 'file_format',
  compression: 'compression',
  retentionDays: 'retention_days',
  watermarkStrategy: 'watermark_strategy',
  destinationId: 'destination_id',
  enabled: 'enabled',
  packageCode: 'package_code',
  packageName: 'package_name',
  customerName: 'customer_name',
};

export class ExportRepository {
  constructor(private readonly db: DataExportDatabase) {}

  private async hydrate(rows: Row[]): Promise<ProfileRecord[]> {
    if (rows.length === 0) return [];
    const datasetRows = await this.db.query<Row>(
      `SELECT pd.profile_id, d.id, d.dataset_id, d.display_name
         FROM data_export.export_profile_datasets pd
         JOIN data_export.datasets d ON d.id = pd.dataset_id
        WHERE pd.profile_id = ANY($1::uuid[])
        ORDER BY d.dataset_id`,
      [rows.map(row => row.id)],
    );
    const byProfile = new Map<string, ProfileRecord['datasets']>();
    for (const row of datasetRows.rows) {
      const list = byProfile.get(row.profile_id) ?? [];
      list.push({ id: row.id, datasetId: row.dataset_id, displayName: row.display_name });
      byProfile.set(row.profile_id, list);
    }
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      tenantId: row.tenant_id,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      clusterId: row.cluster_id,
      clusterName: row.cluster_name,
      environment: row.environment,
      namespace: row.namespace,
      schedule: row.schedule,
      cronExpression: row.cron_expression,
      exportMode: row.export_mode,
      fileFormat: row.file_format,
      compression: row.compression,
      retentionDays: row.retention_days,
      watermarkStrategy: row.watermark_strategy,
      destinationId: row.destination_id,
      destinationName: row.destination_name,
      destinationType: row.destination_type,
      packageCode: row.package_code ?? null,
      packageName: row.package_name ?? null,
      customerName: row.customer_name ?? null,
      enabled: row.enabled,
      lastRunAt: iso(row.last_run_at),
      lastRunStatus: row.last_run_status,
      datasets: byProfile.get(row.id) ?? [],
      createdAt: iso(row.created_at) as string,
      updatedAt: iso(row.updated_at) as string,
    }));
  }

  async list(request: ListRequest, scope: TenantScope) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      tenantScopeClause('x.tenant_id', scope, params),
      request.search && `x.name ILIKE ${params.add(likePattern(request.search))}`,
      filters.tenantId && `x.tenant_id = ${params.add(filters.tenantId)}`,
      filters.clusterId && `x.cluster_id = ${params.add(filters.clusterId)}`,
      filters.environment && `x.environment = ${params.add(filters.environment)}`,
      filters.status === 'ACTIVE' && 'x.enabled',
      filters.status === 'DISABLED' && 'NOT x.enabled',
      filters.ownerId && `x.owner_id = ${params.add(filters.ownerId)}`,
      filters.datasetId &&
        `EXISTS (SELECT 1 FROM data_export.export_profile_datasets pd
                  WHERE pd.profile_id = x.id AND pd.dataset_id = ${params.add(filters.datasetId)})`,
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM (${BASE}) x ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query<Row>(
      `SELECT * FROM (${BASE}) x ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return { items: await this.hydrate(result.rows), total: Number(count.rows[0].total) };
  }

  async findById(id: string, db: Queryable = this.db): Promise<ProfileRecord | null> {
    const result = await db.query<Row>(`SELECT * FROM (${BASE}) x WHERE x.id = $1`, [id]);
    const [profile] = await this.hydrate(result.rows);
    return profile ?? null;
  }

  async owners(scope: TenantScope): Promise<string[]> {
    const params = new SqlParams();
    const where = whereClause([tenantScopeClause('tenant_id', scope, params)]);
    const result = await this.db.query<{ owner_id: string }>(
      `SELECT DISTINCT owner_id FROM data_export.export_profiles ${where} ORDER BY owner_id`,
      params.values,
    );
    return result.rows.map(row => row.owner_id);
  }

  async tenants(): Promise<string[]> {
    const result = await this.db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM data_export.clusters UNION SELECT tenant_id FROM data_export.export_profiles
       UNION SELECT tenant_id FROM data_export.destinations WHERE tenant_id IS NOT NULL ORDER BY 1`,
    );
    return result.rows.map(row => row.tenant_id);
  }

  async insert(
    id: string,
    values: ProfileValues,
    owner: { ownerId: string; createdBy: string },
    datasetIds: string[],
    tx: Queryable,
  ) {
    const keys = Object.keys(COLUMNS) as Array<keyof ProfileValues>;
    const params = new SqlParams();
    const placeholders = [params.add(id), params.add(owner.ownerId), params.add(owner.createdBy)];
    for (const key of keys) placeholders.push(params.add(values[key]));
    await tx.query(
      `INSERT INTO data_export.export_profiles (id, owner_id, created_by, ${keys.map(key => COLUMNS[key]).join(', ')},
         last_scheduled_at)
       VALUES (${placeholders.join(', ')}, NOW())`,
      params.values,
    );
    await this.replaceDatasets(id, datasetIds, tx);
  }

  /**
   * Updates a profile. When the schedule changes, `last_scheduled_at` resets to
   * now so the scheduler does not fire a past occurrence of the new schedule.
   */
  async update(id: string, values: Partial<ProfileValues>, datasetIds: string[] | undefined, tx: Queryable) {
    const params = new SqlParams();
    const sets: string[] = [];
    for (const [key, value] of Object.entries(values) as Array<[keyof ProfileValues, unknown]>) {
      if (value === undefined) continue;
      sets.push(`${COLUMNS[key]} = ${params.add(value)}`);
    }
    if (values.cronExpression !== undefined) {
      sets.push(
        `last_scheduled_at = CASE WHEN cron_expression IS DISTINCT FROM ${params.add(values.cronExpression)}
                                  THEN NOW() ELSE last_scheduled_at END`,
      );
    }
    if (values.enabled === true) {
      // Re-enabling must not back-fill occurrences missed while disabled.
      sets.push('last_scheduled_at = CASE WHEN NOT enabled THEN NOW() ELSE last_scheduled_at END');
    }
    sets.push('updated_at = NOW()');
    await tx.query(
      `UPDATE data_export.export_profiles SET ${sets.join(', ')} WHERE id = ${params.add(id)}`,
      params.values,
    );
    if (datasetIds) await this.replaceDatasets(id, datasetIds, tx);
  }

  private async replaceDatasets(profileId: string, datasetIds: string[], tx: Queryable) {
    await tx.query('DELETE FROM data_export.export_profile_datasets WHERE profile_id = $1', [profileId]);
    if (datasetIds.length === 0) return;
    await tx.query(
      `INSERT INTO data_export.export_profile_datasets (profile_id, dataset_id) SELECT $1, UNNEST($2::uuid[])`,
      [profileId, datasetIds],
    );
  }

  async delete(id: string, tx: Queryable) {
    await tx.query('DELETE FROM data_export.export_profiles WHERE id = $1', [id]);
  }

  async countEnabled(scope: TenantScope): Promise<number> {
    const params = new SqlParams();
    const where = whereClause(['enabled', tenantScopeClause('tenant_id', scope, params)]);
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM data_export.export_profiles ${where}`,
      params.values,
    );
    return Number(result.rows[0].count);
  }
}
