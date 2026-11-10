import { randomUUID } from 'crypto';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { SchedulerDatabase } from './db';
import { dueOccurrence } from './schedule';

export const JOB_PRIORITY_SCHEDULED = 100;
export const JOB_MAX_RETRIES = 3;
/** Agents heartbeat every 60s; after 15 minutes of silence they are OFFLINE and their jobs are reclaimed. */
export const AGENT_OFFLINE_MINUTES = 15;
/** A claimed job the agent never started (e.g. it crashed right after claiming). */
export const ASSIGNED_STALL_MINUTES = 10;
/** Queries run with statement_timeout=7200s; allow headroom for upload before declaring a job stalled. */
export const RUNNING_STALL_MINUTES = 150;

export interface TickResult {
  jobsCreated: number;
  jobsQueued: number;
  jobsRejected: number;
  jobsReclaimed: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/**
 * Turns export schedules into queued work and keeps the queue healthy.
 * Jobs move CREATED → QUEUED here; agents take them from QUEUED onwards.
 */
export class ExportScheduler {
  constructor(
    private readonly db: SchedulerDatabase,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Creates one CREATED job per dataset for each enabled profile whose cron
   * fired since it was last scheduled. Idempotent: the (profile, dataset,
   * scheduled_time) unique key absorbs repeats from overlapping runs.
   */
  async createDueJobs(now: Date = new Date()): Promise<number> {
    const profiles = await this.db.query<Row>(
      `SELECT p.id, p.cron_expression, p.tenant_id, p.cluster_id,
              COALESCE(p.last_scheduled_at, p.created_at) AS since,
              ARRAY(SELECT pd.dataset_id::text FROM data_export.export_profile_datasets pd
                     WHERE pd.profile_id = p.id) AS dataset_ids
         FROM data_export.export_profiles p
         JOIN data_export.clusters c ON c.id = p.cluster_id
        WHERE p.enabled AND NOT c.is_retired`,
    );
    let created = 0;
    for (const profile of profiles.rows) {
      const due = dueOccurrence(profile.cron_expression, new Date(profile.since), now);
      if (!due) continue;
      created += await this.db.transaction(async tx => {
        let inserted = 0;
        for (const datasetId of profile.dataset_ids as string[]) {
          const result = await tx.query(
            `INSERT INTO data_export.jobs (id, profile_id, dataset_id, cluster_id, tenant_id, status, trigger,
               priority, scheduled_time, max_retries, requested_by)
             VALUES ($1, $2, $3, $4, $5, 'CREATED', 'SCHEDULE', $6, $7, $8, 'system:data-export-scheduler')
             ON CONFLICT (profile_id, dataset_id, scheduled_time) DO NOTHING`,
            [
              randomUUID(),
              profile.id,
              datasetId,
              profile.cluster_id,
              profile.tenant_id,
              JOB_PRIORITY_SCHEDULED,
              due,
              JOB_MAX_RETRIES,
            ],
          );
          inserted += result.rowCount ?? 0;
        }
        await tx.query(
          `UPDATE data_export.export_profiles SET last_scheduled_at = $2
            WHERE id = $1 AND (last_scheduled_at IS NULL OR last_scheduled_at < $2)`,
          [profile.id, due],
        );
        return inserted;
      });
    }
    return created;
  }

  /**
   * Promotes CREATED jobs to QUEUED once they are runnable, or closes them
   * with the reason they cannot run, so agents only ever see work they can do.
   */
  async dispatch(): Promise<{ queued: number; rejected: number }> {
    const result = await this.db.query<{ status: string }>(
      `WITH checked AS (
         SELECT j.id,
           CASE
             WHEN NOT p.enabled THEN 'CANCELLED'
             WHEN c.is_retired OR NOT d.enabled OR d.sql_template IS NULL OR dest.id IS NULL OR NOT dest.enabled
               OR dest.type NOT IN ('ADLS_GEN2', 'SFTP')
               OR (p.export_mode = 'INCREMENTAL' AND d.watermark_column IS NULL) THEN 'FAILED'
             ELSE 'QUEUED'
           END AS next_status,
           CASE
             WHEN NOT p.enabled THEN 'The export was disabled before the job was queued'
             WHEN c.is_retired THEN 'Cluster ' || c.cluster_name || ' is retired'
             WHEN NOT d.enabled THEN 'Dataset ' || d.dataset_id || ' is disabled'
             WHEN d.sql_template IS NULL THEN 'Dataset ' || d.dataset_id || ' has no SQL template'
             WHEN dest.id IS NULL OR NOT dest.enabled THEN 'The destination is disabled'
             WHEN dest.type NOT IN ('ADLS_GEN2', 'SFTP') THEN 'Destination type ' || dest.type || ' has no delivery provider'
             WHEN p.export_mode = 'INCREMENTAL' AND d.watermark_column IS NULL
               THEN 'Dataset ' || d.dataset_id || ' has no watermark column for incremental export'
           END AS reason
           FROM data_export.jobs j
           JOIN data_export.export_profiles p ON p.id = j.profile_id
           JOIN data_export.clusters c ON c.id = j.cluster_id
           JOIN data_export.datasets d ON d.id = j.dataset_id
           LEFT JOIN data_export.destinations dest ON dest.id = p.destination_id
          WHERE j.status = 'CREATED'
          FOR UPDATE OF j SKIP LOCKED
       )
       UPDATE data_export.jobs j
          SET status = checked.next_status, error_message = checked.reason, updated_at = NOW(),
              completed_time = CASE WHEN checked.next_status = 'QUEUED' THEN NULL ELSE NOW() END
         FROM checked
        WHERE j.id = checked.id
        RETURNING j.status`,
    );
    const queued = result.rows.filter(row => row.status === 'QUEUED').length;
    return { queued, rejected: result.rows.length - queued };
  }

  /**
   * Reclaims jobs whose agent has gone OFFLINE, was removed, never started a
   * claimed job, or stopped reporting progress. They go back to the queue
   * with a short backoff while attempts remain, otherwise they fail.
   */
  async reclaim(): Promise<number> {
    const result = await this.db.query(
      `WITH stale AS (
         SELECT j.id,
           CASE
             WHEN j.assigned_agent_id IS NULL OR a.id IS NULL THEN 'The agent running this job was removed'
             WHEN a.last_seen IS NULL OR a.last_seen < NOW() - INTERVAL '${AGENT_OFFLINE_MINUTES} minutes'
               THEN 'Agent ' || COALESCE(a.agent_name, a.id::text) || ' stopped sending heartbeats'
             WHEN j.status = 'ASSIGNED' AND j.progress_time < NOW() - INTERVAL '${ASSIGNED_STALL_MINUTES} minutes'
               THEN 'The agent claimed this job but never started it'
             ELSE 'No progress reported for ${RUNNING_STALL_MINUTES} minutes'
           END AS reason
           FROM data_export.jobs j
           LEFT JOIN data_export.agents a ON a.id = j.assigned_agent_id
          WHERE j.status IN ('ASSIGNED', 'RUNNING', 'UPLOADING')
            AND (
              j.assigned_agent_id IS NULL OR a.id IS NULL
              OR a.last_seen IS NULL OR a.last_seen < NOW() - INTERVAL '${AGENT_OFFLINE_MINUTES} minutes'
              OR (j.status = 'ASSIGNED' AND j.progress_time < NOW() - INTERVAL '${ASSIGNED_STALL_MINUTES} minutes')
              OR j.progress_time < NOW() - INTERVAL '${RUNNING_STALL_MINUTES} minutes'
            )
          FOR UPDATE OF j SKIP LOCKED
       )
       UPDATE data_export.jobs j
          SET status = CASE WHEN j.retry_count < j.max_retries THEN 'QUEUED' ELSE 'FAILED' END,
              not_before = CASE WHEN j.retry_count < j.max_retries THEN NOW() + INTERVAL '2 minutes' END,
              retry_count = CASE WHEN j.retry_count < j.max_retries THEN j.retry_count + 1 ELSE j.retry_count END,
              completed_time = CASE WHEN j.retry_count < j.max_retries THEN NULL ELSE NOW() END,
              assigned_agent_id = CASE WHEN j.retry_count < j.max_retries THEN NULL ELSE j.assigned_agent_id END,
              error_message = stale.reason, updated_at = NOW()
         FROM stale
        WHERE j.id = stale.id`,
    );
    return result.rowCount ?? 0;
  }

  /** Samples queue and fleet gauges for the dashboard's trend and for capacity review. */
  async sampleMetrics(): Promise<void> {
    await this.db.query(
      `INSERT INTO data_export.metric_samples (metric, value)
       SELECT 'queue_depth', COUNT(*) FROM data_export.jobs WHERE status IN ('CREATED', 'QUEUED')
       UNION ALL
       SELECT 'running_jobs', COUNT(*) FROM data_export.jobs WHERE status IN ('ASSIGNED', 'RUNNING', 'UPLOADING')
       UNION ALL
       SELECT 'connected_agents', COUNT(*) FROM data_export.agents WHERE last_seen > NOW() - INTERVAL '5 minutes'
       UNION ALL
       SELECT 'registered_agents', COUNT(*) FROM data_export.agents`,
    );
  }

  async tick(now: Date = new Date()): Promise<TickResult> {
    const jobsCreated = await this.createDueJobs(now);
    const { queued, rejected } = await this.dispatch();
    const jobsReclaimed = await this.reclaim();
    await this.sampleMetrics();
    if (jobsCreated || queued || rejected || jobsReclaimed) {
      this.logger.info(
        `[data-export-scheduler] created ${jobsCreated}, queued ${queued}, rejected ${rejected}, reclaimed ${jobsReclaimed}`,
      );
    }
    return { jobsCreated, jobsQueued: queued, jobsRejected: rejected, jobsReclaimed };
  }

  /** Deletes heartbeat history and metric samples past retention, in bounded batches. */
  async housekeeping(heartbeatDays = 7, metricDays = 30): Promise<{ heartbeats: number; metrics: number }> {
    const prune = async (table: string, column: string, days: number) => {
      let total = 0;
      for (;;) {
        const result = await this.db.query(
          `DELETE FROM data_export.${table} WHERE id IN (
             SELECT id FROM data_export.${table} WHERE ${column} < NOW() - $1 * INTERVAL '1 day' LIMIT 20000)`,
          [days],
        );
        total += result.rowCount ?? 0;
        if ((result.rowCount ?? 0) < 20000) return total;
      }
    };
    return {
      heartbeats: await prune('agent_heartbeats', 'heartbeat_time', heartbeatDays),
      metrics: await prune('metric_samples', 'captured_at', metricDays),
    };
  }
}
