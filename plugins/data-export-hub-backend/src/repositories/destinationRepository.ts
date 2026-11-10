import type { TenantScope } from '../access';
import type { DataExportDatabase, Queryable } from '../db';
import { ListRequest, ListSpec } from '../listQuery';
import { SqlParams, likePattern, whereClause } from '../sql';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface DestinationRecord {
  id: string;
  type: string;
  name: string;
  configuration: Record<string, string>;
  enabled: boolean;
  owner: string | null;
  tenantId: string | null;
  status: string;
  lastTestAt: string | null;
  lastTestMessage: string | null;
  updatedAt: string;
}

export const DESTINATION_LIST: ListSpec = {
  sortable: {
    name: 'd.name',
    type: 'd.type',
    tenantId: 'd.tenant_id',
    status: 'd.status',
    lastTestAt: 'd.last_test_at',
  },
  defaultSort: { field: 'name', order: 'asc' },
  filters: ['tenantId', 'status', 'type'],
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : ((value as string | null) ?? null));

export function mapDestination(row: Row): DestinationRecord {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    configuration: row.configuration_json ?? {},
    enabled: row.enabled,
    owner: row.owner,
    tenantId: row.tenant_id,
    status: row.status,
    lastTestAt: iso(row.last_test_at),
    lastTestMessage: row.last_test_message,
    updatedAt: iso(row.updated_at) as string,
  };
}

/** Shared destinations (no tenant) are visible to everyone; tenant destinations only within scope. */
function scopeClause(scope: TenantScope, params: SqlParams) {
  return scope === null ? null : `(d.tenant_id IS NULL OR d.tenant_id = ANY(${params.add(scope)}::text[]))`;
}

export class DestinationRepository {
  constructor(private readonly db: DataExportDatabase) {}

  async list(request: ListRequest, scope: TenantScope) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      scopeClause(scope, params),
      request.search && `d.name ILIKE ${params.add(likePattern(request.search))}`,
      filters.tenantId && `d.tenant_id = ${params.add(filters.tenantId)}`,
      filters.status && `d.status = ${params.add(filters.status)}`,
      filters.type && `d.type = ${params.add(filters.type)}`,
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM data_export.destinations d ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query(
      `SELECT d.* FROM data_export.destinations d ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return { items: result.rows.map(mapDestination), total: Number(count.rows[0].total) };
  }

  async findById(id: string, db: Queryable = this.db): Promise<DestinationRecord | null> {
    const result = await db.query('SELECT * FROM data_export.destinations WHERE id = $1', [id]);
    return result.rows[0] ? mapDestination(result.rows[0]) : null;
  }

  async findByName(name: string, db: Queryable = this.db): Promise<DestinationRecord | null> {
    const result = await db.query('SELECT * FROM data_export.destinations WHERE name = $1', [name]);
    return result.rows[0] ? mapDestination(result.rows[0]) : null;
  }

  async insert(
    values: {
      id: string;
      type: string;
      name: string;
      configuration: Record<string, string>;
      enabled: boolean;
      owner: string | null;
      tenantId: string | null;
    },
    tx: Queryable,
  ) {
    await tx.query(
      `INSERT INTO data_export.destinations (id, type, name, configuration_json, enabled, owner, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [values.id, values.type, values.name, JSON.stringify(values.configuration), values.enabled, values.owner, values.tenantId],
    );
  }

  async update(id: string, patch: { name?: string; enabled?: boolean; owner?: string | null }, tx: Queryable) {
    await tx.query(
      `UPDATE data_export.destinations SET
         name = COALESCE($2, name),
         enabled = COALESCE($3, enabled),
         owner = CASE WHEN $4::boolean THEN $5 ELSE owner END,
         updated_at = NOW()
       WHERE id = $1`,
      [id, patch.name ?? null, patch.enabled ?? null, patch.owner !== undefined, patch.owner ?? null],
    );
  }

  async recordTest(id: string, status: string, message: string, db: Queryable = this.db) {
    await db.query(
      `UPDATE data_export.destinations SET status = $2, last_test_message = $3, last_test_at = NOW() WHERE id = $1`,
      [id, status, message],
    );
  }

  async countEnabled(scope: TenantScope): Promise<number> {
    const params = new SqlParams();
    const where = whereClause(['d.enabled', scopeClause(scope, params)]);
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM data_export.destinations d ${where}`,
      params.values,
    );
    return Number(result.rows[0].count);
  }
}
