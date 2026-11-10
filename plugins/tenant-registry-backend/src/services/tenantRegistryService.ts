import crypto from 'crypto';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  ClusterRecord,
  CreateTenantInput,
  DiscoveredCluster,
  NodePoolRecord,
  TenantRecord,
} from '../types';
import { TenantRegistryDatabase } from '../db';

export interface ListQueryOptions {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

const TENANT_SORT_COLUMNS: Record<string, string> = {
  tenantName: 'tenant_name',
  cloudProvider: 'cloud_provider',
  subscriptionId: 'subscription_id',
  createdAt: 'created_at',
};

const CLUSTER_SORT_COLUMNS: Record<string, string> = {
  clusterName: 'cluster_name',
  region: 'region',
  environment: 'environment',
  provisioningState: 'provisioning_state',
  createdAt: 'created_at',
};

function nowIso() {
  return new Date().toISOString();
}

export class TenantRegistryService {
  private readonly db: TenantRegistryDatabase;
  private readonly logger: LoggerService;

  constructor(db: TenantRegistryDatabase, logger: LoggerService) {
    this.db = db;
    this.logger = logger;
  }

  async listTenants(
    options: ListQueryOptions,
  ): Promise<PaginatedResult<TenantRecord>> {
    const sortColumn =
      TENANT_SORT_COLUMNS[options.sortBy ?? 'createdAt'] ?? 'created_at';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const offset = Math.max(0, options.page) * Math.max(1, options.pageSize);
    const limit = Math.max(1, options.pageSize);
    const search = options.search?.trim().toLowerCase() ?? '';
    const hasSearch = Boolean(search);

    const whereSql = hasSearch
      ? `WHERE LOWER(tenant_name) LIKE $1 OR LOWER(COALESCE(business_unit, '')) LIKE $1 OR LOWER(subscription_id) LIKE $1`
      : '';
    const countParams = hasSearch ? [`%${search}%`] : [];
    const listParams = hasSearch
      ? [`%${search}%`, limit, offset]
      : [limit, offset];

    const countRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tenants ${whereSql}`,
      countParams,
    );

    const items = await this.db.query<TenantRecord>(
      `
      SELECT
        id,
        tenant_name AS "tenantName",
        business_unit AS "businessUnit",
        cloud_provider AS "cloudProvider",
        subscription_id AS "subscriptionId",
        regions,
        environments,
        (
          SELECT COUNT(*)::int
          FROM clusters c
          WHERE c.tenant_id = tenants.id
        ) AS "clusterCount",
        created_at AS "createdAt"
      FROM tenants
      ${whereSql}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${hasSearch ? 2 : 1}
      OFFSET $${hasSearch ? 3 : 2}
    `,
      listParams,
    );

    return {
      items,
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async getTenant(
    id: string,
  ): Promise<(TenantRecord & { clusters: ClusterRecord[] }) | null> {
    const tenants = await this.db.query<TenantRecord>(
      `
      SELECT
        id,
        tenant_name AS "tenantName",
        business_unit AS "businessUnit",
        cloud_provider AS "cloudProvider",
        subscription_id AS "subscriptionId",
        regions,
        environments,
        created_at AS "createdAt"
      FROM tenants
      WHERE id = $1
      `,
      [id],
    );

    if (!tenants.length) {
      return null;
    }

    const clusters = await this.db.query<ClusterRecord>(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        cluster_name AS "clusterName",
        subscription_id AS "subscriptionId",
        resource_group AS "resourceGroup",
        region,
        environment,
        kubernetes_version AS "kubernetesVersion",
        provisioning_state AS "provisioningState",
        cloud_provider AS "cloudProvider",
        onboarded,
        onboarding_state AS "onboardingState",
        tags,
        catalog_entity_ref AS "catalogEntityRef",
        created_at AS "createdAt"
      FROM clusters
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      `,
      [id],
    );

    return { ...tenants[0], clusters };
  }

  async createTenant(input: CreateTenantInput): Promise<TenantRecord> {
    const id = crypto.randomUUID();
    const createdAt = nowIso();

    await this.db.query(
      `
      INSERT INTO tenants
        (id, tenant_name, business_unit, cloud_provider, subscription_id, regions, environments, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        id,
        input.tenantName,
        input.businessUnit ?? null,
        input.cloudProvider,
        input.subscriptionId,
        input.regions,
        input.environments,
        createdAt,
      ],
    );

    const subscriptionId = crypto.randomUUID();
    await this.db.query(
      `
      INSERT INTO subscriptions (id, subscription_id, subscription_name, cloud_provider)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (subscription_id)
      DO NOTHING
      `,
      [
        subscriptionId,
        input.subscriptionId,
        input.subscriptionId,
        input.cloudProvider,
      ],
    );

    for (const env of input.environments) {
      const envId = crypto.randomUUID();
      await this.db.query(
        `
        INSERT INTO environments (id, tenant_id, environment_name, region)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, environment_name, region)
        DO NOTHING
        `,
        [envId, id, env, input.regions[0] ?? null],
      );
    }

    this.logger.info(`[tenant-registry] tenant created: ${input.tenantName}`);

    return {
      id,
      tenantName: input.tenantName,
      businessUnit: input.businessUnit ?? null,
      cloudProvider: input.cloudProvider,
      subscriptionId: input.subscriptionId,
      regions: input.regions,
      environments: input.environments,
      createdAt,
    };
  }

  async deleteTenant(id: string): Promise<void> {
    await this.db.query('DELETE FROM tenants WHERE id = $1', [id]);
  }

  async listClusters(
    options: ListQueryOptions,
  ): Promise<PaginatedResult<ClusterRecord>> {
    const sortColumn =
      CLUSTER_SORT_COLUMNS[options.sortBy ?? 'createdAt'] ?? 'created_at';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const offset = Math.max(0, options.page) * Math.max(1, options.pageSize);
    const limit = Math.max(1, options.pageSize);
    const search = options.search?.trim().toLowerCase() ?? '';
    const hasSearch = Boolean(search);

    const whereSql = hasSearch
      ? `WHERE LOWER(cluster_name) LIKE $1 OR LOWER(resource_group) LIKE $1 OR LOWER(COALESCE(environment, '')) LIKE $1`
      : '';
    const countParams = hasSearch ? [`%${search}%`] : [];
    const listParams = hasSearch
      ? [`%${search}%`, limit, offset]
      : [limit, offset];

    const countRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM clusters ${whereSql}`,
      countParams,
    );

    const items = await this.db.query<ClusterRecord>(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        cluster_name AS "clusterName",
        subscription_id AS "subscriptionId",
        resource_group AS "resourceGroup",
        region,
        environment,
        kubernetes_version AS "kubernetesVersion",
        provisioning_state AS "provisioningState",
        cloud_provider AS "cloudProvider",
        onboarded,
        onboarding_state AS "onboardingState",
        tags,
        catalog_entity_ref AS "catalogEntityRef",
        created_at AS "createdAt"
      FROM clusters
      ${whereSql}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${hasSearch ? 2 : 1}
      OFFSET $${hasSearch ? 3 : 2}
      `,
      listParams,
    );

    return {
      items,
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async getCluster(id: string): Promise<ClusterRecord | null> {
    const rows = await this.db.query<ClusterRecord>(
      `
      SELECT
        id,
        tenant_id AS "tenantId",
        cluster_name AS "clusterName",
        subscription_id AS "subscriptionId",
        resource_group AS "resourceGroup",
        region,
        environment,
        kubernetes_version AS "kubernetesVersion",
        provisioning_state AS "provisioningState",
        cloud_provider AS "cloudProvider",
        onboarded,
        onboarding_state AS "onboardingState",
        tags,
        catalog_entity_ref AS "catalogEntityRef",
        created_at AS "createdAt"
      FROM clusters
      WHERE id = $1
      `,
      [id],
    );
    return rows[0] ?? null;
  }

  async deleteCluster(id: string): Promise<void> {
    await this.db.query('DELETE FROM clusters WHERE id = $1', [id]);
  }

  async clusterAlreadyOnboarded(
    clusterName: string,
    subscriptionId: string,
  ): Promise<boolean> {
    const rows = await this.db.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM clusters
      WHERE cluster_name = $1
        AND subscription_id = $2
      `,
      [clusterName, subscriptionId],
    );

    return Number(rows[0]?.count ?? 0) > 0;
  }

  async onboardCluster(input: {
    tenantId: string;
    cluster: DiscoveredCluster;
    nodePools: NodePoolRecord[];
    catalogEntityRef: string | null;
    validationIssues: string[];
    actorRef: string;
  }): Promise<ClusterRecord> {
    const clusterId = crypto.randomUUID();

    await this.db.query(
      `
      INSERT INTO clusters
        (
          id, tenant_id, cluster_name, subscription_id, resource_group, region, environment,
          kubernetes_version, provisioning_state, cloud_provider,
          onboarded, onboarding_state, tags, catalog_entity_ref, created_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Azure', TRUE, $10, $11, $12, $13)
      `,
      [
        clusterId,
        input.tenantId,
        input.cluster.clusterName,
        input.cluster.subscriptionId,
        input.cluster.resourceGroup,
        input.cluster.region,
        input.cluster.environment,
        input.cluster.kubernetesVersion,
        input.cluster.provisioningState,
        input.validationIssues.length ? 'validation_failed' : 'onboarded',
        input.cluster.tags,
        input.catalogEntityRef,
        nowIso(),
      ],
    );

    for (const pool of input.nodePools) {
      await this.db.query(
        `
        INSERT INTO node_pools (id, cluster_id, nodepool_name, vm_size, node_count, mode)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          crypto.randomUUID(),
          clusterId,
          pool.nodepoolName,
          pool.vmSize,
          pool.nodeCount,
          pool.mode,
        ],
      );
    }

    await this.db.query(
      `
      INSERT INTO onboarding_history (id, cluster_id, status, validation_errors, message, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        crypto.randomUUID(),
        clusterId,
        input.validationIssues.length ? 'warning' : 'success',
        JSON.stringify(input.validationIssues),
        input.validationIssues.length
          ? 'Onboarded with validation warnings'
          : 'Onboarded',
        nowIso(),
      ],
    );

    await this.logAudit({
      actorRef: input.actorRef,
      action: 'cluster-onboard',
      targetType: 'cluster',
      targetId: clusterId,
      payload: {
        clusterName: input.cluster.clusterName,
        subscriptionId: input.cluster.subscriptionId,
        validationIssues: input.validationIssues,
      },
    });

    const cluster = await this.getCluster(clusterId);
    if (!cluster) {
      throw new Error('Cluster was onboarded but retrieval failed');
    }

    return cluster;
  }

  async logAudit(input: {
    actorRef: string;
    action: string;
    targetType: string;
    targetId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO onboarding_audit_logs
        (id, actor_ref, action, target_type, target_id, payload, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        crypto.randomUUID(),
        input.actorRef,
        input.action,
        input.targetType,
        input.targetId ?? null,
        JSON.stringify(input.payload),
        nowIso(),
      ],
    );
  }
}
