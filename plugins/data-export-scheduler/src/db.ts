import { Pool, PoolClient } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';

/** Lowest data_export schema version this scheduler understands (owned by the data-export-hub-backend plugin). */
export const REQUIRED_SCHEMA_VERSION = 3;

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Same connection settings as the data-export-hub-backend plugin, which owns the schema. */
export function poolFromEnv(logger: LoggerService): Pool | null {
  const host = process.env.POSTGRES_HOST;
  if (!host) {
    logger.warn('[data-export-scheduler] POSTGRES_HOST is not set; scheduler is disabled');
    return null;
  }
  return new Pool({
    host,
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    user: process.env.POSTGRES_USER ?? 'backstage',
    password: process.env.POSTGRES_PASSWORD ?? 'backstage',
    database: process.env.POSTGRES_DB ?? 'backstage',
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 4,
  });
}

export class SchedulerDatabase implements Queryable {
  constructor(private readonly pool: Pool) {}

  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params) as Promise<{ rows: T[]; rowCount: number | null }>;
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client as unknown as Queryable);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** False until the hub plugin has applied the migrations this scheduler relies on. */
  async schemaReady(): Promise<boolean> {
    try {
      const result = await this.pool.query<{ version: number | null }>(
        'SELECT MAX(version) AS version FROM data_export.schema_migrations',
      );
      return (result.rows[0]?.version ?? 0) >= REQUIRED_SCHEMA_VERSION;
    } catch {
      return false;
    }
  }

  end() {
    return this.pool.end();
  }
}
