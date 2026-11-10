import type { TenantScope } from '../access';
import type { DataExportDatabase } from '../db';
import { ListRequest, ListSpec } from '../listQuery';
import { SqlParams, likePattern, tenantScopeClause, whereClause } from '../sql';

export const AUDIT_LIST: ListSpec = {
  sortable: { occurredAt: 'e.occurred_at', action: 'e.action', actor: 'e.actor' },
  defaultSort: { field: 'occurredAt', order: 'desc' },
  filters: ['tenantId', 'entityType', 'from', 'to'],
};

export class AuditRepository {
  constructor(private readonly db: DataExportDatabase) {}

  async list(request: ListRequest, scope: TenantScope) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      tenantScopeClause('e.tenant_id', scope, params),
      request.search &&
        `(e.action ILIKE ${params.add(likePattern(request.search))} OR e.actor ILIKE $${params.values.length}
          OR e.entity_id ILIKE $${params.values.length})`,
      filters.tenantId && `e.tenant_id = ${params.add(filters.tenantId)}`,
      filters.entityType && `e.entity_type = ${params.add(filters.entityType)}`,
      filters.from && `e.occurred_at >= ${params.add(filters.from)}`,
      filters.to && `e.occurred_at <= ${params.add(filters.to)}`,
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM data_export.audit_events e ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query(
      `SELECT e.* FROM data_export.audit_events e ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return {
      items: result.rows.map(row => ({
        id: String(row.id),
        occurredAt: (row.occurred_at as Date).toISOString(),
        actor: row.actor as string,
        action: row.action as string,
        entityType: row.entity_type as string,
        entityId: row.entity_id as string | null,
        tenantId: row.tenant_id as string | null,
        details: (row.details ?? {}) as Record<string, unknown>,
      })),
      total: Number(count.rows[0].total),
    };
  }
}
