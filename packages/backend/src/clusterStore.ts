/**
 * clusterStore.ts
 *
 * Lightweight PostgreSQL persistence for onboarded AKS clusters.
 * Replaces the ephemeral module-level Map so data survives container restarts.
 *
 * The store is optional by design: when no connection string is provided
 * (e.g. in unit tests) every method is a no-op and the in-memory Map in
 * createCostAutomationRouter.ts continues to act as the sole data store.
 */

import { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  OnboardedCluster,
  ClusterSchedule,
  ScheduleExecutionLogEntry,
  ScheduledAction,
  ExecutionResult,
} from './costAutomationTypes';

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS onboarded_clusters (
    cluster_name    TEXT PRIMARY KEY,
    resource_group  TEXT NOT NULL DEFAULT '',
    subscription_id TEXT NOT NULL DEFAULT '',
    environment     TEXT NOT NULL,
    auth_mode       TEXT NOT NULL DEFAULT 'local',
    power_state     TEXT NOT NULL DEFAULT 'Unknown',
    status          TEXT NOT NULL DEFAULT 'ONBOARDED',
    capabilities    TEXT NOT NULL DEFAULT 'start,stop,downsize',
    onboarded_at    TEXT NOT NULL
  );
`;

const UPSERT_SQL = `
  INSERT INTO onboarded_clusters
    (cluster_name, resource_group, subscription_id, environment,
     auth_mode, power_state, status, capabilities, onboarded_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (cluster_name) DO UPDATE SET
    resource_group  = EXCLUDED.resource_group,
    subscription_id = EXCLUDED.subscription_id,
    environment     = EXCLUDED.environment,
    auth_mode       = EXCLUDED.auth_mode,
    power_state     = EXCLUDED.power_state,
    status          = EXCLUDED.status,
    capabilities    = EXCLUDED.capabilities,
    onboarded_at    = EXCLUDED.onboarded_at;
`;

const SELECT_ALL_SQL = `SELECT * FROM onboarded_clusters;`;

// ─── Schedule DDL / DML ──────────────────────────────────────────────────────

const CREATE_SCHEDULES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cluster_schedules (
    cluster_name       TEXT PRIMARY KEY,
    timezone           TEXT NOT NULL DEFAULT 'UTC',
    stop_cron          TEXT,
    stop_day           INT,
    stop_local_time    TEXT,
    start_cron         TEXT,
    start_day          INT,
    start_local_time   TEXT,
    enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at         TEXT NOT NULL,
    last_action        TEXT,
    last_executed_at   TEXT,
    last_action_result TEXT,
    paused             BOOLEAN NOT NULL DEFAULT FALSE,
    holiday_calendar   TEXT,
    override_action    TEXT,
    override_expires_at TEXT
  );
`;

// ─── Execution log DDL / DML ─────────────────────────────────────────────────

const CREATE_EXECUTION_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schedule_execution_log (
    id              SERIAL PRIMARY KEY,
    cluster_name    TEXT        NOT NULL,
    action          TEXT        NOT NULL,
    result          TEXT        NOT NULL,
    cron            TEXT,
    timezone        TEXT,
    reason          TEXT,
    error_message   TEXT,
    initiated_by    TEXT        NOT NULL DEFAULT 'aks-scheduler-azure-function',
    executed_at     TEXT        NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_execution_log_cluster
    ON schedule_execution_log (cluster_name);
  CREATE INDEX IF NOT EXISTS idx_execution_log_executed_at
    ON schedule_execution_log (executed_at DESC);
`;

// Idempotent schema migrations — add columns that may be missing in existing installs.
const SCHEDULE_MIGRATIONS: string[] = [
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS timezone           TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS stop_cron          TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS stop_day           INT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS stop_local_time    TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS start_cron         TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS start_day          INT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS start_local_time   TEXT`,
  // Execution feedback columns (added in v2 schema)
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS last_action        TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS last_executed_at   TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS last_action_result TEXT`,
  // Pause / holiday / override columns (added in v3 schema)
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS paused              BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS holiday_calendar    TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS override_action     TEXT`,
  `ALTER TABLE cluster_schedules ADD COLUMN IF NOT EXISTS override_expires_at TEXT`,
];

const UPSERT_SCHEDULE_SQL = `
  INSERT INTO cluster_schedules
    (cluster_name, timezone, stop_cron, stop_day, stop_local_time,
     start_cron, start_day, start_local_time, enabled, updated_at,
     paused, holiday_calendar, override_action, override_expires_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (cluster_name) DO UPDATE SET
    timezone             = EXCLUDED.timezone,
    stop_cron            = EXCLUDED.stop_cron,
    stop_day             = EXCLUDED.stop_day,
    stop_local_time      = EXCLUDED.stop_local_time,
    start_cron           = EXCLUDED.start_cron,
    start_day            = EXCLUDED.start_day,
    start_local_time     = EXCLUDED.start_local_time,
    enabled              = EXCLUDED.enabled,
    updated_at           = EXCLUDED.updated_at,
    paused               = EXCLUDED.paused,
    holiday_calendar     = EXCLUDED.holiday_calendar,
    override_action      = EXCLUDED.override_action,
    override_expires_at  = EXCLUDED.override_expires_at;
`;

const UPDATE_LAST_ACTION_SQL = `
  UPDATE cluster_schedules
  SET last_action        = $2,
      last_executed_at   = $3,
      last_action_result = $4
  WHERE cluster_name = $1;
`;

const INSERT_EXECUTION_LOG_SQL = `
  INSERT INTO schedule_execution_log
    (cluster_name, action, result, cron, timezone, reason, error_message, initiated_by, executed_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING *;
`;

const SELECT_EXECUTION_LOG_SQL = `
  SELECT * FROM schedule_execution_log
  WHERE cluster_name = $1
  ORDER BY executed_at DESC
  LIMIT $2;
`;

function rowToSchedule(row: Record<string, any>): ClusterSchedule {
  const toEntry = (
    cron: string | null,
    day: number | null,
    time: string | null,
  ): ClusterSchedule['stop'] => {
    if (!cron || day === null || !time) return null;
    return { cron, dayOfWeek: day, time };
  };
  return {
    clusterName: row.cluster_name as string,
    timezone: (row.timezone as string | null) ?? 'UTC',
    stop: toEntry(row.stop_cron, row.stop_day, row.stop_local_time),
    start: toEntry(row.start_cron, row.start_day, row.start_local_time),
    enabled: row.enabled as boolean,
    updatedAt: row.updated_at as string,
    lastAction: (row.last_action as ScheduledAction | null) ?? null,
    lastExecutedAt: (row.last_executed_at as string | null) ?? null,
    lastActionResult:
      (row.last_action_result as ExecutionResult | null) ?? null,
    paused: (row.paused as boolean | null) ?? false,
    holidayCalendar: (row.holiday_calendar as string | null) ?? null,
    overrideAction: (row.override_action as 'START' | 'STOP' | null) ?? null,
    overrideExpiresAt: (row.override_expires_at as string | null) ?? null,
  };
}

function rowToExecutionLog(
  row: Record<string, any>,
): ScheduleExecutionLogEntry {
  return {
    id: row.id as number,
    clusterName: row.cluster_name as string,
    action: row.action as ScheduledAction,
    result: row.result as ExecutionResult,
    cron: (row.cron as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    initiatedBy: row.initiated_by as string,
    executedAt: row.executed_at as string,
  };
}

function rowToCluster(row: Record<string, string>): OnboardedCluster {
  return {
    clusterName: row.cluster_name,
    resourceGroup: row.resource_group,
    subscriptionId: row.subscription_id,
    environment: row.environment as OnboardedCluster['environment'],
    authMode: row.auth_mode as OnboardedCluster['authMode'],
    powerState: row.power_state as OnboardedCluster['powerState'],
    status: row.status as OnboardedCluster['status'],
    capabilities: row.capabilities.split(
      ',',
    ) as OnboardedCluster['capabilities'],
    onboardedAt: row.onboarded_at,
  };
}

export class ClusterStore {
  private pool: Pool;
  private logger: LoggerService;
  private ready = false;

  constructor(pool: Pool, logger: LoggerService) {
    this.pool = pool;
    this.logger = logger;
  }

  /** Create all tables if missing. Must be called once at plugin startup. */
  async init(): Promise<void> {
    try {
      await this.pool.query(CREATE_TABLE_SQL);
      await this.pool.query(CREATE_SCHEDULES_TABLE_SQL);
      await this.pool.query(CREATE_EXECUTION_LOG_TABLE_SQL);
      // Run idempotent migrations to extend schema on existing installs.
      for (const sql of SCHEDULE_MIGRATIONS) {
        await this.pool.query(sql);
      }
      this.ready = true;
      this.logger.info('[cluster-store] Tables ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[cluster-store] Failed to create tables: ${msg}`);
    }
  }

  /** Load all persisted clusters. Returns [] if the store is not ready. */
  async loadAll(): Promise<OnboardedCluster[]> {
    if (!this.ready) return [];
    try {
      const result = await this.pool.query(SELECT_ALL_SQL);
      return result.rows.map(rowToCluster);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[cluster-store] loadAll failed: ${msg}`);
      return [];
    }
  }

  /** Persist (insert or update) a single cluster record. */
  async upsert(cluster: OnboardedCluster): Promise<void> {
    if (!this.ready) return;
    try {
      await this.pool.query(UPSERT_SQL, [
        cluster.clusterName,
        cluster.resourceGroup,
        cluster.subscriptionId,
        cluster.environment,
        cluster.authMode,
        cluster.powerState,
        cluster.status,
        cluster.capabilities.join(','),
        cluster.onboardedAt,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] upsert failed for "${cluster.clusterName}": ${msg}`,
      );
    }
  }

  /** Remove a cluster record by name. No-op if the row does not exist. */
  async remove(clusterName: string): Promise<void> {
    if (!this.ready) return;
    try {
      await this.pool.query(
        'DELETE FROM onboarded_clusters WHERE cluster_name = $1',
        [clusterName],
      );
      // Also remove any associated schedule.
      await this.pool.query(
        'DELETE FROM cluster_schedules WHERE cluster_name = $1',
        [clusterName],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] remove failed for "${clusterName}": ${msg}`,
      );
    }
  }

  // ─── Schedule methods ──────────────────────────────────────────────────────

  /** Persist (insert or update) a schedule. */
  async upsertSchedule(schedule: ClusterSchedule): Promise<void> {
    if (!this.ready) return;
    try {
      await this.pool.query(UPSERT_SCHEDULE_SQL, [
        schedule.clusterName,
        schedule.timezone,
        schedule.stop?.cron ?? null,
        schedule.stop?.dayOfWeek ?? null,
        schedule.stop?.time ?? null,
        schedule.start?.cron ?? null,
        schedule.start?.dayOfWeek ?? null,
        schedule.start?.time ?? null,
        schedule.enabled,
        schedule.updatedAt,
        schedule.paused,
        schedule.holidayCalendar ?? null,
        schedule.overrideAction ?? null,
        schedule.overrideExpiresAt ?? null,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] upsertSchedule failed for "${schedule.clusterName}": ${msg}`,
      );
    }
  }

  /** Load the schedule for a single cluster. Returns null if none exists. */
  async loadSchedule(clusterName: string): Promise<ClusterSchedule | null> {
    if (!this.ready) return null;
    try {
      const result = await this.pool.query(
        'SELECT * FROM cluster_schedules WHERE cluster_name = $1',
        [clusterName],
      );
      return result.rows.length ? rowToSchedule(result.rows[0]) : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] loadSchedule failed for "${clusterName}": ${msg}`,
      );
      return null;
    }
  }

  /** Load all persisted schedules. Returns [] if the store is not ready. */
  async loadAllSchedules(): Promise<ClusterSchedule[]> {
    if (!this.ready) return [];
    try {
      const result = await this.pool.query('SELECT * FROM cluster_schedules;');
      return result.rows.map(rowToSchedule);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[cluster-store] loadAllSchedules failed: ${msg}`);
      return [];
    }
  }

  /** Remove a schedule. No-op if none exists. */
  async removeSchedule(clusterName: string): Promise<void> {
    if (!this.ready) return;
    try {
      await this.pool.query(
        'DELETE FROM cluster_schedules WHERE cluster_name = $1',
        [clusterName],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] removeSchedule failed for "${clusterName}": ${msg}`,
      );
    }
  }

  // ─── Execution log methods ─────────────────────────────────────────────────

  /**
   * Append one execution log row and update the last_action columns on the
   * cluster_schedules row for fast UX feedback.  Returns the inserted row.
   */
  async recordExecution(entry: {
    clusterName: string;
    action: string;
    result: string;
    cron?: string | null;
    timezone?: string | null;
    reason?: string | null;
    errorMessage?: string | null;
    initiatedBy?: string;
    executedAt: string;
  }): Promise<ScheduleExecutionLogEntry | null> {
    if (!this.ready) return null;
    const {
      clusterName,
      action,
      result,
      cron = null,
      timezone = null,
      reason = null,
      errorMessage = null,
      initiatedBy = 'aks-scheduler-azure-function',
      executedAt,
    } = entry;
    try {
      const res = await this.pool.query(INSERT_EXECUTION_LOG_SQL, [
        clusterName,
        action,
        result,
        cron,
        timezone,
        reason,
        errorMessage,
        initiatedBy,
        executedAt,
      ]);
      // Also update the fast-access columns on cluster_schedules (best-effort).
      await this.pool.query(UPDATE_LAST_ACTION_SQL, [
        clusterName,
        action,
        executedAt,
        result,
      ]);
      return rowToExecutionLog(res.rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] recordExecution failed for "${clusterName}": ${msg}`,
      );
      return null;
    }
  }

  /**
   * Return up to `limit` most-recent execution log rows for a cluster,
   * newest first.  Returns [] if the store is not ready or none exist.
   */
  async getExecutionLog(
    clusterName: string,
    limit = 50,
  ): Promise<ScheduleExecutionLogEntry[]> {
    if (!this.ready) return [];
    try {
      const res = await this.pool.query(SELECT_EXECUTION_LOG_SQL, [
        clusterName,
        limit,
      ]);
      return res.rows.map(rowToExecutionLog);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[cluster-store] getExecutionLog failed for "${clusterName}": ${msg}`,
      );
      return [];
    }
  }

  /** Build a Pool from environment variables (POSTGRES_HOST, _PORT, _USER, _PASSWORD, _DB). */
  static fromEnv(logger: LoggerService): ClusterStore | null {
    const host = process.env.POSTGRES_HOST;
    if (!host) {
      logger.info(
        '[cluster-store] POSTGRES_HOST not set — running without persistence',
      );
      return null;
    }
    const pool = new Pool({
      host,
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      user: process.env.POSTGRES_USER ?? 'backstage',
      password: process.env.POSTGRES_PASSWORD ?? 'backstage',
      database: process.env.POSTGRES_DB ?? 'backstage',
      ssl: pgSslConfig(),
    });
    return new ClusterStore(pool, logger);
  }
}
