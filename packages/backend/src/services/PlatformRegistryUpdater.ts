/**
 * PlatformRegistryUpdater.ts
 *
 * Best-effort bridge from the provisioning workflow to the Platform Registry.
 *
 * The Platform Registry (pr_* tables) is owned by plugin-platform-registry-backend
 * and shares the same `backstage` database. To keep the two plugins decoupled we
 * do NOT import its service; instead we perform a narrow, resilient UPDATE of the
 * cluster's lifecycle `status` by name. If the registry table or row is not
 * present (e.g. the cluster has not been discovered/registered yet, or Postgres
 * is not configured) the update is skipped and reported as not-applied — the
 * Infrastructure Request's own `registryStatus` remains the source of truth for
 * the wizard.
 */

import { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

export interface RegistryUpdateResult {
  applied: boolean;
  reason?: string;
}

export class PlatformRegistryUpdater {
  private readonly logger: LoggerService;
  private readonly pool: Pool | null;

  constructor(logger: LoggerService, pool: Pool | null) {
    this.logger = logger;
    this.pool = pool;
  }

  static fromEnv(logger: LoggerService): PlatformRegistryUpdater {
    const host = process.env.POSTGRES_HOST;
    if (!host) {
      return new PlatformRegistryUpdater(logger, null);
    }
    const pool = new Pool({
      host,
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      user: process.env.POSTGRES_USER ?? 'backstage',
      password: process.env.POSTGRES_PASSWORD ?? 'backstage',
      database: process.env.POSTGRES_DB ?? 'backstage',
      ssl: pgSslConfig(),
    });
    return new PlatformRegistryUpdater(logger, pool);
  }

  get backend(): 'postgres' | 'memory' {
    return this.pool ? 'postgres' : 'memory';
  }

  /**
   * Update the lifecycle status of a registered cluster by name. Resilient:
   * returns `{ applied: false }` (never throws) when Postgres is unavailable,
   * the pr_clusters table is missing, or no matching cluster row exists.
   */
  async updateClusterLifecycle(
    clusterName: string,
    status: string,
  ): Promise<RegistryUpdateResult> {
    if (!this.pool) {
      return { applied: false, reason: 'no-postgres' };
    }
    try {
      const result = await this.pool.query(
        `UPDATE pr_clusters
            SET status = $2, last_synced_at = NOW()
          WHERE cluster_name = $1`,
        [clusterName, status],
      );
      const applied = (result.rowCount ?? 0) > 0;
      if (applied) {
        this.logger.info(
          `[provisioning] Platform Registry: ${clusterName} lifecycle -> ${status}`,
        );
      } else {
        this.logger.info(
          `[provisioning] Platform Registry: no cluster row for ${clusterName}; recorded on request only`,
        );
      }
      return { applied, reason: applied ? undefined : 'no-cluster-row' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[provisioning] Platform Registry update skipped for ${clusterName}: ${msg}`,
      );
      return { applied: false, reason: msg };
    }
  }
}
