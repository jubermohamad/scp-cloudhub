import { randomUUID } from 'crypto';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { recordAudit } from '../audit';
import type { DataExportDatabase, Queryable } from '../db';
import { ServiceUnavailableError } from '../errors';
import { FleetRepository } from '../repositories/fleetRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface ClusterSyncResult {
  created: number;
  updated: number;
  retired: number;
  restored: number;
  skipped: Array<{ clusterName: string; reason: string }>;
  ranAt: string;
}

export interface RegistryCluster {
  id: string;
  clusterName: string;
  clusterType: string | null;
  provider: string | null;
  region: string | null;
  resourceGroup: string | null;
  status: string | null;
  platformCode: string | null;
  environmentName: string | null;
  environmentType: string | null;
  cloudProvider: string | null;
  accountIdentifier: string | null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/** Converts a Platform Registry platform code to a Data Export Hub tenant slug. */
export function tenantSlug(platformCode: string): string {
  return platformCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * Maps Platform Registry environment names (prod, qa, dev, …) to the four
 * Data Export Hub environments. The name wins over the coarse type
 * (prod / non-prod) because "non-prod" alone cannot say which tier it is.
 */
export function mapEnvironment(name: string | null, type: string | null): string | null {
  const normalized = (name ?? '').toLowerCase();
  if (/^(prod|production|prd|live)\b/.test(normalized)) return 'PRODUCTION';
  if (/^(stag|staging|stg|uat|preprod|pre-prod)/.test(normalized)) return 'STAGING';
  if (/^(sit|qa|test|int)/.test(normalized)) return 'SIT';
  if (/^(dev|development|sandbox|sbx)/.test(normalized)) return 'DEVELOPMENT';
  if ((type ?? '').toLowerCase() === 'prod') return 'PRODUCTION';
  return null;
}

export function isAks(cluster: Pick<RegistryCluster, 'clusterType' | 'provider'>): boolean {
  return (cluster.clusterType ?? '').toUpperCase() === 'AKS' || (cluster.provider ?? '').toUpperCase() === 'AZURE';
}

/**
 * Discovers AKS clusters from CloudHub Platform Registry (tables pr_* in the
 * same database) and reconciles the Data Export Hub cluster registry:
 * creates new clusters, updates metadata, retires clusters that are gone or
 * inactive, and restores ones that come back. Nothing is ever deleted.
 * A manually registered cluster with the same tenant and name is adopted.
 */
export class ClusterSyncService {
  private readonly fleet: FleetRepository;

  constructor(
    private readonly db: DataExportDatabase,
    private readonly logger: LoggerService,
  ) {
    this.fleet = new FleetRepository(db);
  }

  private async readRegistry(): Promise<RegistryCluster[]> {
    const exists = await this.db.query<Record<string, string | null>>(
      `SELECT to_regclass('pr_clusters')::text AS pr_clusters,
              to_regclass('pr_platforms')::text AS pr_platforms,
              to_regclass('pr_environments')::text AS pr_environments,
              to_regclass('pr_cloud_accounts')::text AS pr_cloud_accounts`,
    );
    const missing = Object.entries(exists.rows[0] ?? {})
      .filter(([, relation]) => !relation)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new ServiceUnavailableError(
        `Platform Registry is unavailable: missing ${missing.join(', ')}. Ensure both plugins use the same PostgreSQL database and restart CloudHub.`,
      );
    }
    const result = await this.db.query<Row>(
      `SELECT c.id::text AS id, c.cluster_name, c.cluster_type, c.provider, c.region, c.resource_group, c.status,
              p.platform_code, e.environment_name, e.environment_type, a.cloud_provider, a.account_identifier
         FROM pr_clusters c
         LEFT JOIN pr_platforms p ON p.id = c.platform_id
         LEFT JOIN pr_environments e ON e.id = c.environment_id
         LEFT JOIN pr_cloud_accounts a ON a.id = c.cloud_account_id`,
    );
    return result.rows.map(row => ({
      id: row.id,
      clusterName: row.cluster_name,
      clusterType: row.cluster_type,
      provider: row.provider,
      region: row.region,
      resourceGroup: row.resource_group,
      status: row.status,
      platformCode: row.platform_code,
      environmentName: row.environment_name,
      environmentType: row.environment_type,
      cloudProvider: row.cloud_provider,
      accountIdentifier: row.account_identifier,
    }));
  }

  async run(actor: string): Promise<ClusterSyncResult> {
    const result: ClusterSyncResult = {
      created: 0,
      updated: 0,
      retired: 0,
      restored: 0,
      skipped: [],
      ranAt: new Date().toISOString(),
    };
    const registry = await this.readRegistry();
    if (registry.length === 0) {
      result.skipped.push({
        clusterName: '*',
        reason:
          'Platform Registry has no active clusters to sync; no changes were applied',
      });
      return result;
    }

    const active = new Set<string>();
    for (const source of registry.filter(isAks)) {
      if ((source.status ?? 'active').toLowerCase() !== 'active') continue;
      const tenantId = source.platformCode
        ? tenantSlug(source.platformCode)
        : 'cms';
      const environment =
        mapEnvironment(source.environmentName, source.environmentType) ??
        'DEVELOPMENT';
      if (!tenantId) {
        result.skipped.push({ clusterName: source.clusterName, reason: 'no platform (tenant) assigned' });
        continue;
      }
      if (!environment) {
        result.skipped.push({
          clusterName: source.clusterName,
          reason: `environment "${source.environmentName ?? source.environmentType ?? 'unknown'}" has no mapping`,
        });
        continue;
      }
      active.add(source.id);
      const subscriptionId =
        source.accountIdentifier && GUID.test(source.accountIdentifier) && source.accountIdentifier !== ZERO_GUID
          ? source.accountIdentifier.toLowerCase()
          : null;
      const values = {
        clusterName: source.clusterName.slice(0, 63),
        subscriptionId,
        resourceGroup: source.resourceGroup,
        environment,
        region: source.region,
        tenantId,
      };
      try {
        await this.db.transaction(tx => this.reconcile(tx, source.id, values, actor, result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.skipped.push({ clusterName: source.clusterName, reason: message });
      }
    }

    const retired = await this.db.transaction(async tx => {
      const gone = await tx.query<{ id: string; cluster_name: string; tenant_id: string }>(
        `UPDATE data_export.clusters SET is_retired = TRUE, retired_at = NOW(), updated_at = NOW(), last_synced_at = NOW()
          WHERE platform_registry_id IS NOT NULL AND NOT is_retired
            AND NOT (platform_registry_id = ANY($1::text[]))
          RETURNING id, cluster_name, tenant_id`,
        [[...active]],
      );
      for (const row of gone.rows) {
        await recordAudit(tx, {
          actor,
          action: 'cluster.retired',
          entityType: 'cluster',
          entityId: row.id,
          tenantId: row.tenant_id,
          details: { clusterName: row.cluster_name, reason: 'no longer active in Platform Registry' },
        });
      }
      return gone.rowCount ?? 0;
    });
    result.retired = retired;
    this.logger.info(
      `[data-export-hub] Cluster sync: ${result.created} created, ${result.updated} updated, ` +
        `${result.retired} retired, ${result.restored} restored, ${result.skipped.length} skipped`,
    );
    return result;
  }

  private async reconcile(
    tx: Queryable,
    registryId: string,
    values: {
      clusterName: string;
      subscriptionId: string | null;
      resourceGroup: string | null;
      environment: string;
      region: string | null;
      tenantId: string;
    },
    actor: string,
    result: ClusterSyncResult,
  ) {
    // Prefer the cluster already linked to this registry id; otherwise adopt a
    // manually registered cluster with the same tenant and name.
    const linked = await tx.query<Row>(
      `SELECT * FROM data_export.clusters
        WHERE platform_registry_id = $1
           OR (platform_registry_id IS NULL AND tenant_id = $2 AND cluster_name = $3)
        ORDER BY (platform_registry_id = $1) DESC NULLS LAST
        LIMIT 1
        FOR UPDATE`,
      [registryId, values.tenantId, values.clusterName],
    );
    const existing = linked.rows[0];
    if (!existing) {
      const id = randomUUID();
      await this.fleet.insertCluster(id, values, tx, registryId);
      await recordAudit(tx, {
        actor,
        action: 'cluster.discovered',
        entityType: 'cluster',
        entityId: id,
        tenantId: values.tenantId,
        details: { clusterName: values.clusterName, platformRegistryId: registryId },
      });
      result.created += 1;
      return;
    }

    // Exports inherit tenant and environment from their cluster, so a registry
    // change that would move them is reported instead of applied.
    const movesScope = existing.tenant_id !== values.tenantId || existing.environment !== values.environment;
    if (movesScope && (await this.fleet.countExportsForCluster(existing.id, tx)) > 0) {
      result.skipped.push({
        clusterName: values.clusterName,
        reason: 'tenant or environment changed in Platform Registry while exports use this cluster',
      });
      return;
    }
    await tx.query(
      `UPDATE data_export.clusters SET
         platform_registry_id = $2, cluster_name = $3, subscription_id = COALESCE($4, subscription_id),
         resource_group = $5, environment = $6, region = $7, tenant_id = $8,
         is_retired = FALSE, retired_at = NULL, last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [
        existing.id,
        registryId,
        values.clusterName,
        values.subscriptionId,
        values.resourceGroup,
        values.environment,
        values.region,
        values.tenantId,
      ],
    );
    if (existing.is_retired) {
      result.restored += 1;
      await recordAudit(tx, {
        actor,
        action: 'cluster.restored',
        entityType: 'cluster',
        entityId: existing.id,
        tenantId: values.tenantId,
        details: { clusterName: values.clusterName, reason: 'active again in Platform Registry' },
      });
    } else {
      result.updated += 1;
    }
  }
}
