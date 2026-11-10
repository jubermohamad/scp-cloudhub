import type { TenantScope } from '../access';
import { JobStatus } from '../constants';
import type { DataExportDatabase, Queryable } from '../db';
import { ListRequest, ListSpec } from '../listQuery';
import { SqlParams, likePattern, tenantScopeClause, whereClause } from '../sql';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface JobRecord {
  id: string;
  profileId: string;
  exportName: string;
  tenantId: string;
  clusterId: string;
  clusterName: string;
  datasetId: string;
  datasetDisplayName: string;
  datasetUuid: string;
  status: JobStatus;
  trigger: string;
  priority: number;
  scheduledTime: string;
  assignedTime: string | null;
  startedTime: string | null;
  completedTime: string | null;
  durationSeconds: number | null;
  retryCount: number;
  maxRetries: number;
  rowsExported: number | null;
  bytesExported: number | null;
  filesDelivered: number | null;
  errorMessage: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  requestedBy: string | null;
  createdAt: string;
}

export interface JobDetailRecord extends JobRecord {
  watermarkFrom: string | null;
  watermarkTo: string | null;
  outputFiles: unknown[];
  manifest: Record<string, unknown> | null;
  logs: string | null;
}

const DURATION = 'EXTRACT(EPOCH FROM (j.completed_time - j.started_time))';

const BASE = `
  SELECT j.*, p.name AS export_name, c.cluster_name, d.dataset_id AS dataset_code,
         d.display_name AS dataset_display_name, a.agent_name AS assigned_agent_name,
         ${DURATION} AS duration_seconds
    FROM data_export.jobs j
    JOIN data_export.export_profiles p ON p.id = j.profile_id
    JOIN data_export.clusters c ON c.id = j.cluster_id
    JOIN data_export.datasets d ON d.id = j.dataset_id
    LEFT JOIN data_export.agents a ON a.id = j.assigned_agent_id`;

export const JOB_LIST: ListSpec = {
  sortable: {
    createdAt: 'j.created_at',
    scheduledTime: 'j.scheduled_time',
    startedTime: 'j.started_time',
    completedTime: 'j.completed_time',
    status: 'j.status',
    rowsExported: 'j.rows_exported',
    bytesExported: 'j.bytes_exported',
    durationSeconds: DURATION,
    exportName: 'p.name',
    tenantId: 'j.tenant_id',
  },
  defaultSort: { field: 'createdAt', order: 'desc' },
  filters: ['tenantId', 'clusterId', 'status', 'datasetId', 'exportId', 'from', 'to'],
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : ((value as string | null) ?? null));
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function mapJob(row: Row): JobRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    exportName: row.export_name,
    tenantId: row.tenant_id,
    clusterId: row.cluster_id,
    clusterName: row.cluster_name,
    datasetId: row.dataset_code,
    datasetDisplayName: row.dataset_display_name,
    datasetUuid: row.dataset_id,
    status: row.status,
    trigger: row.trigger,
    priority: row.priority,
    scheduledTime: iso(row.scheduled_time) as string,
    assignedTime: iso(row.assigned_time),
    startedTime: iso(row.started_time),
    completedTime: iso(row.completed_time),
    durationSeconds: row.duration_seconds === null ? null : Math.round(Number(row.duration_seconds)),
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    rowsExported: num(row.rows_exported),
    bytesExported: num(row.bytes_exported),
    filesDelivered: row.files_delivered,
    errorMessage: row.error_message,
    assignedAgentId: row.assigned_agent_id,
    assignedAgentName: row.assigned_agent_name,
    requestedBy: row.requested_by,
    createdAt: iso(row.created_at) as string,
  };
}

function mapJobDetail(row: Row): JobDetailRecord {
  return {
    ...mapJob(row),
    watermarkFrom: row.watermark_from,
    watermarkTo: row.watermark_to,
    outputFiles: row.output_files ?? [],
    manifest: row.manifest,
    logs: row.logs,
  };
}

export interface NewJob {
  id: string;
  profileId: string;
  datasetId: string;
  clusterId: string;
  tenantId: string;
  status: 'CREATED' | 'QUEUED';
  trigger: 'SCHEDULE' | 'MANUAL';
  priority: number;
  scheduledTime: Date;
  maxRetries: number;
  requestedBy: string | null;
}

/** Everything an agent needs to run a claimed job, read in the claim transaction. */
export interface ClaimedJobRow {
  job: Row;
  profile: Row;
  dataset: Row;
  destination: Row;
  watermark: string | null;
}

export class JobRepository {
  constructor(private readonly db: DataExportDatabase) {}

  /* ---------- user-facing ---------- */

  async list(request: ListRequest, scope: TenantScope) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      tenantScopeClause('j.tenant_id', scope, params),
      request.search &&
        `(p.name ILIKE ${params.add(likePattern(request.search))} OR d.dataset_id ILIKE $${params.values.length})`,
      filters.tenantId && `j.tenant_id = ${params.add(filters.tenantId)}`,
      filters.clusterId && `j.cluster_id = ${params.add(filters.clusterId)}`,
      filters.status && `j.status = ${params.add(filters.status)}`,
      filters.datasetId && `j.dataset_id = ${params.add(filters.datasetId)}`,
      filters.exportId && `j.profile_id = ${params.add(filters.exportId)}`,
      filters.from && `j.created_at >= ${params.add(filters.from)}`,
      filters.to && `j.created_at <= ${params.add(filters.to)}`,
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM data_export.jobs j
         JOIN data_export.export_profiles p ON p.id = j.profile_id
         JOIN data_export.datasets d ON d.id = j.dataset_id ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query(
      `${BASE} ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return { items: result.rows.map(mapJob), total: Number(count.rows[0].total) };
  }

  async findById(id: string, db: Queryable = this.db): Promise<JobDetailRecord | null> {
    const result = await db.query(`${BASE} WHERE j.id = $1`, [id]);
    return result.rows[0] ? mapJobDetail(result.rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<JobRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.db.query(`${BASE} WHERE j.id = ANY($1::uuid[]) ORDER BY d.dataset_id`, [ids]);
    return result.rows.map(mapJob);
  }

  async insertJobs(jobs: NewJob[], tx: Queryable) {
    for (const job of jobs) {
      await tx.query(
        `INSERT INTO data_export.jobs (id, profile_id, dataset_id, cluster_id, tenant_id, status, trigger, priority,
           scheduled_time, max_retries, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (profile_id, dataset_id, scheduled_time) DO NOTHING`,
        [
          job.id,
          job.profileId,
          job.datasetId,
          job.clusterId,
          job.tenantId,
          job.status,
          job.trigger,
          job.priority,
          job.scheduledTime,
          job.maxRetries,
          job.requestedBy,
        ],
      );
    }
  }

  /** Re-queues a failed or cancelled job for a fresh attempt. Returns false if it was not in a retryable state. */
  async retry(id: string, tx: Queryable): Promise<boolean> {
    const result = await tx.query(
      `UPDATE data_export.jobs
          SET status = 'QUEUED', trigger = 'RETRY', priority = GREATEST(priority, 200), not_before = NULL,
              assigned_agent_id = NULL, assigned_time = NULL, started_time = NULL, completed_time = NULL,
              progress_time = NULL, error_message = NULL, retry_count = retry_count + 1,
              max_retries = GREATEST(max_retries, retry_count + 1), updated_at = NOW()
        WHERE id = $1 AND status IN ('FAILED', 'CANCELLED')`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async cancel(id: string, reason: string, tx: Queryable): Promise<boolean> {
    const result = await tx.query(
      `UPDATE data_export.jobs
          SET status = 'CANCELLED', error_message = $2, completed_time = NOW(), updated_at = NOW()
        WHERE id = $1 AND status IN ('CREATED', 'QUEUED', 'ASSIGNED', 'RUNNING', 'UPLOADING')`,
      [id, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /* ---------- agent protocol ---------- */

  /**
   * Assigns the next due job for a cluster to an agent. `SKIP LOCKED` lets many
   * agents (and replicas of this backend) claim concurrently without blocking or
   * double-assigning. Agents run one job at a time, so any job still held by
   * this agent is from before a restart and is released for retry first.
   */
  async claim(agentId: string, clusterId: string): Promise<ClaimedJobRow | null> {
    return this.db.transaction(async tx => {
      await tx.query(
        `UPDATE data_export.jobs
            SET status = CASE WHEN retry_count < max_retries THEN 'QUEUED' ELSE 'FAILED' END,
                retry_count = CASE WHEN retry_count < max_retries THEN retry_count + 1 ELSE retry_count END,
                error_message = 'Agent restarted while the job was in progress',
                assigned_agent_id = NULL, assigned_time = NULL, updated_at = NOW(),
                completed_time = CASE WHEN retry_count < max_retries THEN NULL ELSE NOW() END
          WHERE assigned_agent_id = $1 AND status IN ('ASSIGNED', 'RUNNING', 'UPLOADING')`,
        [agentId],
      );
      const claimed = await tx.query(
        `UPDATE data_export.jobs j
            SET status = 'ASSIGNED', assigned_agent_id = $1, assigned_time = NOW(), progress_time = NOW(),
                updated_at = NOW()
          WHERE j.id = (
            SELECT id FROM data_export.jobs
             WHERE cluster_id = $2 AND status = 'QUEUED' AND COALESCE(not_before, scheduled_time) <= NOW()
             ORDER BY priority DESC, scheduled_time ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING j.*`,
        [agentId, clusterId],
      );
      const job = claimed.rows[0];
      if (!job) return null;
      const [profile, dataset, destination, watermark] = await Promise.all([
        tx.query('SELECT * FROM data_export.export_profiles WHERE id = $1', [job.profile_id]),
        tx.query('SELECT * FROM data_export.datasets WHERE id = $1', [job.dataset_id]),
        tx.query(
          `SELECT dest.* FROM data_export.destinations dest
             JOIN data_export.export_profiles p ON p.destination_id = dest.id WHERE p.id = $1`,
          [job.profile_id],
        ),
        tx.query<{ last_success_value: string | null }>(
          'SELECT last_success_value FROM data_export.watermarks WHERE profile_id = $1 AND dataset_id = $2',
          [job.profile_id, job.dataset_id],
        ),
      ]);
      const watermarkValue = watermark.rows[0]?.last_success_value ?? null;
      await tx.query('UPDATE data_export.jobs SET watermark_from = $2 WHERE id = $1', [job.id, watermarkValue]);
      return {
        job,
        profile: profile.rows[0],
        dataset: dataset.rows[0],
        destination: destination.rows[0],
        watermark: watermarkValue,
      };
    });
  }

  /** Marks a claimed job failed before the agent starts it (e.g. the dataset has no SQL). */
  async failClaimed(jobId: string, agentId: string, message: string) {
    await this.db.query(
      `UPDATE data_export.jobs SET status = 'FAILED', error_message = $3, completed_time = NOW(), updated_at = NOW()
        WHERE id = $1 AND assigned_agent_id = $2 AND status = 'ASSIGNED'`,
      [jobId, agentId, message],
    );
  }

  /** Moves a job forward (ASSIGNED → RUNNING → UPLOADING). Returns the updated row, or null if not allowed. */
  async progress(
    jobId: string,
    agentId: string,
    update: { status: 'RUNNING' | 'UPLOADING'; rowsExported?: number; bytesExported?: number },
  ): Promise<Row | null> {
    const allowedFrom = update.status === 'RUNNING' ? ['ASSIGNED', 'RUNNING'] : ['RUNNING', 'UPLOADING'];
    const result = await this.db.query(
      `UPDATE data_export.jobs
          SET status = $3, progress_time = NOW(), updated_at = NOW(),
              started_time = COALESCE(started_time, NOW()),
              rows_exported = COALESCE($4, rows_exported), bytes_exported = COALESCE($5, bytes_exported)
        WHERE id = $1 AND assigned_agent_id = $2 AND status = ANY($6::text[])
        RETURNING *`,
      [jobId, agentId, update.status, update.rowsExported ?? null, update.bytesExported ?? null, allowedFrom],
    );
    return result.rows[0] ?? null;
  }

  async findRaw(jobId: string, db: Queryable = this.db): Promise<Row | null> {
    const result = await db.query('SELECT * FROM data_export.jobs WHERE id = $1', [jobId]);
    return result.rows[0] ?? null;
  }

  /**
   * Completes a job and, for incremental exports, advances the watermark in the
   * same transaction, so a watermark only moves when its export succeeded.
   */
  async complete(
    jobId: string,
    agentId: string,
    values: {
      rowsExported: number;
      bytesExported: number;
      files: unknown[];
      manifest: unknown;
      watermarkValue: string | null;
      logs: string | null;
    },
    tx: Queryable,
  ): Promise<Row | null> {
    const result = await tx.query(
      `UPDATE data_export.jobs j
          SET status = 'COMPLETED', completed_time = NOW(), progress_time = NOW(), updated_at = NOW(),
              started_time = COALESCE(started_time, assigned_time),
              rows_exported = $3, bytes_exported = $4, files_delivered = $5, output_files = $6,
              manifest = $7, logs = $8, error_message = NULL,
              watermark_to = COALESCE($9, watermark_from)
        WHERE j.id = $1 AND j.assigned_agent_id = $2 AND j.status IN ('RUNNING', 'UPLOADING')
        RETURNING j.*`,
      [
        jobId,
        agentId,
        values.rowsExported,
        values.bytesExported,
        values.files.length,
        JSON.stringify(values.files),
        JSON.stringify(values.manifest),
        values.logs,
        values.watermarkValue,
      ],
    );
    const job = result.rows[0];
    if (!job) return null;
    if (values.watermarkValue !== null) {
      await tx.query(
        `INSERT INTO data_export.watermarks (id, profile_id, dataset_id, tenant_id, last_success_value, last_job_id, updated_at)
         SELECT gen_random_uuid(), j.profile_id, j.dataset_id, j.tenant_id, $2, j.id, NOW()
           FROM data_export.jobs j JOIN data_export.export_profiles p ON p.id = j.profile_id
          WHERE j.id = $1 AND p.export_mode = 'INCREMENTAL'
         ON CONFLICT (profile_id, dataset_id)
         DO UPDATE SET last_success_value = EXCLUDED.last_success_value, last_job_id = EXCLUDED.last_job_id,
                       tenant_id = EXCLUDED.tenant_id, updated_at = NOW()`,
        [jobId, values.watermarkValue],
      );
    }
    return job;
  }

  /**
   * Records a failure. Retryable failures with attempts left go back to the
   * queue after an exponential backoff (2, 4, 8 … minutes, capped at an hour).
   */
  async fail(
    jobId: string,
    agentId: string | null,
    values: { errorMessage: string; retryable: boolean; logs: string | null },
    tx: Queryable = this.db,
  ): Promise<{ willRetry: boolean } | null> {
    const result = await tx.query<{ status: string }>(
      `UPDATE data_export.jobs
          SET status = CASE WHEN $3 AND retry_count < max_retries THEN 'QUEUED' ELSE 'FAILED' END,
              not_before = CASE WHEN $3 AND retry_count < max_retries
                                THEN NOW() + LEAST(POWER(2, retry_count + 1), 60) * INTERVAL '1 minute' END,
              retry_count = CASE WHEN $3 AND retry_count < max_retries THEN retry_count + 1 ELSE retry_count END,
              completed_time = CASE WHEN $3 AND retry_count < max_retries THEN NULL ELSE NOW() END,
              assigned_agent_id = CASE WHEN $3 AND retry_count < max_retries THEN NULL ELSE assigned_agent_id END,
              error_message = $4, logs = COALESCE($5, logs), progress_time = NOW(), updated_at = NOW()
        WHERE id = $1 AND ($2::uuid IS NULL OR assigned_agent_id = $2)
          AND status IN ('ASSIGNED', 'RUNNING', 'UPLOADING')
        RETURNING status`,
      [jobId, agentId, values.retryable, values.errorMessage.slice(0, 4000), values.logs],
    );
    const row = result.rows[0];
    return row ? { willRetry: row.status === 'QUEUED' } : null;
  }

  /** Destinations used by enabled exports on a cluster that are due a live health check. */
  async destinationsDueForCheck(clusterId: string, intervalMinutes: number) {
    const result = await this.db.query(
      `SELECT DISTINCT dest.id, dest.type, dest.configuration_json
         FROM data_export.destinations dest
         JOIN data_export.export_profiles p ON p.destination_id = dest.id
        WHERE p.cluster_id = $1 AND p.enabled AND dest.enabled
          AND dest.type IN ('ADLS_GEN2', 'SFTP')
          AND (dest.last_test_at IS NULL OR dest.last_test_at < NOW() - $2 * INTERVAL '1 minute')`,
      [clusterId, intervalMinutes],
    );
    return result.rows.map(row => ({
      id: row.id as string,
      type: row.type as 'ADLS_GEN2' | 'SFTP',
      configuration: (row.configuration_json ?? {}) as Record<string, string>,
    }));
  }

  /** True when the destination is used by an export on the cluster (agents may only report on those). */
  async clusterUsesDestination(clusterId: string, destinationId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM data_export.export_profiles WHERE cluster_id = $1 AND destination_id = $2 LIMIT 1',
      [clusterId, destinationId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
