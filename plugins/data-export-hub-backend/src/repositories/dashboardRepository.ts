import type { TenantScope } from '../access';
import type { DataExportDatabase } from '../db';
import { SqlParams, tenantScopeClause, whereClause } from '../sql';

/**
 * Aggregates for the operational dashboard. All job figures come from the jobs
 * table so they always agree with the Executions list; "today" is the UTC day.
 */
export class DashboardRepository {
  constructor(private readonly db: DataExportDatabase) {}

  async jobFigures(scope: TenantScope) {
    const params = new SqlParams();
    const scoped = tenantScopeClause('j.tenant_id', scope, params);
    const result = await this.db.query<Record<string, string>>(
      `SELECT
         COUNT(*) FILTER (WHERE j.status IN ('ASSIGNED', 'RUNNING', 'UPLOADING')) AS running,
         COUNT(*) FILTER (WHERE j.status IN ('CREATED', 'QUEUED')) AS queued,
         COUNT(*) FILTER (WHERE j.status = 'COMPLETED' AND j.completed_time >= date_trunc('day', NOW())) AS completed_today,
         COUNT(*) FILTER (WHERE j.status = 'FAILED' AND j.completed_time >= date_trunc('day', NOW())) AS failed_today,
         COALESCE(SUM(j.rows_exported) FILTER (WHERE j.status = 'COMPLETED' AND j.completed_time >= date_trunc('day', NOW())), 0) AS rows_today,
         COALESCE(SUM(j.bytes_exported) FILTER (WHERE j.status = 'COMPLETED' AND j.completed_time >= date_trunc('day', NOW())), 0) AS bytes_today
       FROM data_export.jobs j
       ${whereClause([scoped])}`,
      params.values,
    );
    const row = result.rows[0];
    return {
      running: Number(row.running),
      queued: Number(row.queued),
      completedToday: Number(row.completed_today),
      failedToday: Number(row.failed_today),
      rowsToday: Number(row.rows_today),
      bytesToday: Number(row.bytes_today),
    };
  }

  async topDatasets(scope: TenantScope, windowDays: number, limit = 5) {
    const params = new SqlParams();
    const where = whereClause([
      `j.created_at >= NOW() - ${params.add(windowDays)} * INTERVAL '1 day'`,
      tenantScopeClause('j.tenant_id', scope, params),
    ]);
    const result = await this.db.query(
      `SELECT d.id, d.dataset_id, d.display_name, COUNT(*) AS executions,
              COALESCE(SUM(j.rows_exported) FILTER (WHERE j.status = 'COMPLETED'), 0) AS rows_exported
         FROM data_export.jobs j JOIN data_export.datasets d ON d.id = j.dataset_id
         ${where}
        GROUP BY d.id ORDER BY executions DESC, rows_exported DESC LIMIT ${params.add(limit)}`,
      params.values,
    );
    return result.rows.map(row => ({
      id: row.id as string,
      datasetId: row.dataset_id as string,
      displayName: row.display_name as string,
      executionCount: Number(row.executions),
      rowsExported: Number(row.rows_exported),
    }));
  }

  async topTenants(scope: TenantScope, windowDays: number, limit = 5) {
    const params = new SqlParams();
    const window = params.add(windowDays);
    const where = whereClause([tenantScopeClause('t.tenant_id', scope, params)]);
    const result = await this.db.query(
      `WITH t AS (
         SELECT p.tenant_id, COUNT(*) AS exports FROM data_export.export_profiles p GROUP BY p.tenant_id
       ), b AS (
         SELECT j.tenant_id, COALESCE(SUM(j.bytes_exported), 0) AS bytes
           FROM data_export.jobs j
          WHERE j.status = 'COMPLETED' AND j.completed_time >= NOW() - ${window} * INTERVAL '1 day'
          GROUP BY j.tenant_id
       )
       SELECT t.tenant_id, t.exports, COALESCE(b.bytes, 0) AS bytes
         FROM t LEFT JOIN b ON b.tenant_id = t.tenant_id
         ${where}
        ORDER BY bytes DESC, t.exports DESC LIMIT ${params.add(limit)}`,
      params.values,
    );
    return result.rows.map(row => ({
      tenantId: row.tenant_id as string,
      exports: Number(row.exports),
      bytesExported: Number(row.bytes),
    }));
  }

  async topDestinations(scope: TenantScope, windowDays: number, limit = 5) {
    const params = new SqlParams();
    const where = whereClause([
      `j.status = 'COMPLETED'`,
      `j.completed_time >= NOW() - ${params.add(windowDays)} * INTERVAL '1 day'`,
      tenantScopeClause('j.tenant_id', scope, params),
    ]);
    const result = await this.db.query(
      `SELECT dest.id, dest.name, dest.type, COALESCE(SUM(j.files_delivered), 0) AS files
         FROM data_export.jobs j
         JOIN data_export.export_profiles p ON p.id = j.profile_id
         JOIN data_export.destinations dest ON dest.id = p.destination_id
         ${where}
        GROUP BY dest.id ORDER BY files DESC LIMIT ${params.add(limit)}`,
      params.values,
    );
    return result.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      filesDelivered: Number(row.files),
    }));
  }

  /** Global queue depth, sampled by the scheduler. Not tenant-scoped, so only shown to platform admins. */
  async queueDepth(hours = 24) {
    const result = await this.db.query(
      `SELECT captured_at, value FROM data_export.metric_samples
        WHERE metric = 'queue_depth' AND tenant_id IS NULL AND captured_at >= NOW() - $1 * INTERVAL '1 hour'
        ORDER BY captured_at`,
      [hours],
    );
    return result.rows.map(row => ({ capturedAt: (row.captured_at as Date).toISOString(), value: Number(row.value) }));
  }
}
