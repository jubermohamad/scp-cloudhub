import { Pool, PoolClient } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { MIGRATIONS } from './migrations';

/** Anything that can run a parameterised query: the pool or a transaction client. */
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

/**
 * Owns the PostgreSQL pool for the Data Export Hub control plane.
 * Reuses the CloudHub database connection variables used by other plugins.
 */
export class DataExportDatabase implements Queryable {
  private ready = false;

  constructor(
    private readonly pool: Pool,
    private readonly logger: LoggerService,
  ) {}

  static fromEnv(logger: LoggerService): DataExportDatabase | null {
    const host = process.env.POSTGRES_HOST;
    if (!host) {
      logger.warn(
        '[data-export-hub] POSTGRES_HOST is not set; Data Export Hub is disabled',
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
    return new DataExportDatabase(pool, logger);
  }

  isReady(): boolean {
    return this.ready;
  }

  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) {
    return this.pool.query<T>(text, params) as Promise<{
      rows: T[];
      rowCount: number | null;
    }>;
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

  /** Applies pending migrations in version order. Safe to run on every start. */
  async migrate(): Promise<void> {
    await this.pool.query('CREATE SCHEMA IF NOT EXISTS data_export');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS data_export.schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    const applied = await this.pool.query<{ version: number }>(
      'SELECT version FROM data_export.schema_migrations',
    );
    const appliedVersions = new Set(applied.rows.map(row => row.version));

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;
      await this.transaction(async tx => {
        await tx.query(migration.sql);
        await tx.query(
          'INSERT INTO data_export.schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name],
        );
      });
      this.logger.info(
        `[data-export-hub] Applied migration ${migration.version} (${migration.name})`,
      );
    }
    this.ready = true;
  }
}
