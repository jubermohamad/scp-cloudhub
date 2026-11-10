import type { Queryable } from './db';

export interface AuditEntry {
  actor: string;
  action: string;
  entityType: 'dataset' | 'destination' | 'cluster' | 'agent' | 'export' | 'job' | 'system';
  entityId?: string | null;
  tenantId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Appends to the audit trail. Callers pass the transaction they changed data
 * in, so the audit record commits or rolls back with the change it describes.
 */
export async function recordAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO data_export.audit_events (actor, action, entity_type, entity_id, tenant_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.actor,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.tenantId ?? null,
      JSON.stringify(entry.details ?? {}),
    ],
  );
}
