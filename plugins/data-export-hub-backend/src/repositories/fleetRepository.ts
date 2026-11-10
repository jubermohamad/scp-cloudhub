import type { TenantScope } from '../access';
import type { Health } from '../constants';
import type { DataExportDatabase, Queryable } from '../db';
import { healthRankSql, healthSql } from '../health';
import { ListRequest, ListSpec } from '../listQuery';
import { SqlParams, likePattern, tenantScopeClause, whereClause } from '../sql';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface AgentRecord {
  id: string;
  agentName: string | null;
  clusterId: string;
  clusterName: string;
  tenantId: string;
  identitySubject: string;
  agentVersion: string | null;
  reportedStatus: string;
  health: Health;
  lastSeen: string | null;
  capabilities: Record<string, unknown>;
  createdAt: string;
}

export interface ClusterRecord {
  id: string;
  clusterName: string;
  subscriptionId: string | null;
  resourceGroup: string | null;
  environment: string;
  region: string | null;
  tenantId: string;
  platformRegistryId: string | null;
  isRetired: boolean;
  retiredAt: string | null;
  lastSyncedAt: string | null;
  health: Health;
  agentVersion: string | null;
  lastHeartbeat: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : ((value as string | null) ?? null));

const AGENT_HEALTH = healthSql('a.last_seen', 'a.status');

/** Clusters with health and agent details taken from their most recently seen agent. */
const CLUSTER_BASE = `
  SELECT c.*, la.agent_version AS latest_agent_version, la.last_seen AS latest_last_seen,
         ${healthSql('la.last_seen', 'la.status')} AS health,
         (SELECT COUNT(*) FROM data_export.agents a2 WHERE a2.cluster_id = c.id) AS agent_count
    FROM data_export.clusters c
    LEFT JOIN LATERAL (
      SELECT a.agent_version, a.last_seen, a.status FROM data_export.agents a
       WHERE a.cluster_id = c.id
       ORDER BY a.last_seen DESC NULLS LAST, a.created_at DESC
       LIMIT 1
    ) la ON TRUE`;

export const CLUSTER_LIST: ListSpec = {
  sortable: {
    clusterName: 'x.cluster_name',
    tenantId: 'x.tenant_id',
    environment: 'x.environment',
    region: 'x.region',
    health: healthRankSql('x.health'),
    lastHeartbeat: 'x.latest_last_seen',
  },
  defaultSort: { field: 'clusterName', order: 'asc' },
  filters: ['tenantId', 'environment', 'status', 'includeRetired'],
};

const AGENT_BASE = `
  SELECT a.*, c.cluster_name, c.tenant_id, ${AGENT_HEALTH} AS health
    FROM data_export.agents a
    JOIN data_export.clusters c ON c.id = a.cluster_id`;

export const AGENT_LIST: ListSpec = {
  sortable: {
    clusterName: 'x.cluster_name',
    agentName: 'x.agent_name',
    tenantId: 'x.tenant_id',
    agentVersion: 'x.agent_version',
    lastSeen: 'x.last_seen',
    health: healthRankSql('x.health'),
  },
  defaultSort: { field: 'clusterName', order: 'asc' },
  filters: ['tenantId', 'clusterId', 'status'],
};

function mapCluster(row: Row): ClusterRecord {
  return {
    id: row.id,
    clusterName: row.cluster_name,
    subscriptionId: row.subscription_id,
    resourceGroup: row.resource_group,
    environment: row.environment,
    region: row.region,
    tenantId: row.tenant_id,
    platformRegistryId: row.platform_registry_id,
    isRetired: row.is_retired,
    retiredAt: iso(row.retired_at),
    lastSyncedAt: iso(row.last_synced_at),
    health: row.health,
    agentVersion: row.latest_agent_version ?? null,
    lastHeartbeat: iso(row.latest_last_seen),
    agentCount: Number(row.agent_count ?? 0),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  };
}

function mapAgent(row: Row): AgentRecord {
  return {
    id: row.id,
    agentName: row.agent_name,
    clusterId: row.cluster_id,
    clusterName: row.cluster_name,
    tenantId: row.tenant_id,
    identitySubject: row.identity_subject,
    agentVersion: row.agent_version,
    reportedStatus: row.status,
    health: row.health,
    lastSeen: iso(row.last_seen),
    capabilities: row.capabilities_json ?? {},
    createdAt: iso(row.created_at) as string,
  };
}

export interface ClusterValues {
  clusterName: string;
  subscriptionId: string | null;
  resourceGroup: string | null;
  environment: string;
  region: string | null;
  tenantId: string;
}

export class FleetRepository {
  constructor(private readonly db: DataExportDatabase) {}

  /* ---------- clusters ---------- */

  async listClusters(request: ListRequest, scope: TenantScope) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      tenantScopeClause('x.tenant_id', scope, params),
      filters.includeRetired !== 'true' && 'NOT x.is_retired',
      request.search &&
        `(x.cluster_name ILIKE ${params.add(likePattern(request.search))} OR x.region ILIKE $${params.values.length})`,
      filters.tenantId && `x.tenant_id = ${params.add(filters.tenantId)}`,
      filters.environment && `x.environment = ${params.add(filters.environment)}`,
      filters.status && `x.health = ${params.add(filters.status)}`,
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM (${CLUSTER_BASE}) x ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query(
      `SELECT * FROM (${CLUSTER_BASE}) x ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return { items: result.rows.map(mapCluster), total: Number(count.rows[0].total) };
  }

  async findCluster(id: string, db: Queryable = this.db): Promise<ClusterRecord | null> {
    const result = await db.query(`SELECT * FROM (${CLUSTER_BASE}) x WHERE x.id = $1`, [id]);
    return result.rows[0] ? mapCluster(result.rows[0]) : null;
  }

  /** Health of every active cluster in scope, for dashboards and filter options. */
  async clusterHealthSummary(scope: TenantScope) {
    const params = new SqlParams();
    const where = whereClause(['NOT x.is_retired', tenantScopeClause('x.tenant_id', scope, params)]);
    const result = await this.db.query(
      `SELECT x.id, x.cluster_name, x.tenant_id, x.health FROM (${CLUSTER_BASE}) x ${where} ORDER BY x.cluster_name`,
      params.values,
    );
    return result.rows.map(row => ({
      id: row.id as string,
      clusterName: row.cluster_name as string,
      tenantId: row.tenant_id as string,
      health: row.health as Health,
    }));
  }

  async insertCluster(id: string, values: ClusterValues, tx: Queryable, platformRegistryId: string | null = null) {
    await tx.query(
      `INSERT INTO data_export.clusters
         (id, cluster_name, subscription_id, resource_group, environment, region, tenant_id,
          platform_registry_id, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, CASE WHEN $8::varchar IS NULL THEN NULL ELSE NOW() END)`,
      [
        id,
        values.clusterName,
        values.subscriptionId,
        values.resourceGroup,
        values.environment,
        values.region,
        values.tenantId,
        platformRegistryId,
      ],
    );
  }

  async updateCluster(id: string, values: ClusterValues, tx: Queryable) {
    await tx.query(
      `UPDATE data_export.clusters SET
         cluster_name = $2, subscription_id = $3, resource_group = $4,
         environment = $5, region = $6, tenant_id = $7, updated_at = NOW()
       WHERE id = $1`,
      [id, values.clusterName, values.subscriptionId, values.resourceGroup, values.environment, values.region, values.tenantId],
    );
  }

  async setRetired(id: string, retired: boolean, tx: Queryable) {
    await tx.query(
      `UPDATE data_export.clusters
          SET is_retired = $2, retired_at = CASE WHEN $2 THEN COALESCE(retired_at, NOW()) ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1`,
      [id, retired],
    );
  }

  async countExportsForCluster(id: string, db: Queryable = this.db): Promise<number> {
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM data_export.export_profiles WHERE cluster_id = $1',
      [id],
    );
    return Number(result.rows[0].count);
  }

  /* ---------- agents ---------- */

  async listAgents(request: ListRequest, scope: TenantScope) {
    const params = new SqlParams();
    const { filters } = request;
    const where = whereClause([
      tenantScopeClause('x.tenant_id', scope, params),
      request.search &&
        `(x.agent_name ILIKE ${params.add(likePattern(request.search))} OR x.cluster_name ILIKE $${params.values.length})`,
      filters.tenantId && `x.tenant_id = ${params.add(filters.tenantId)}`,
      filters.clusterId && `x.cluster_id = ${params.add(filters.clusterId)}`,
      filters.status && `x.health = ${params.add(filters.status)}`,
    ]);
    const count = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM (${AGENT_BASE}) x ${where}`,
      params.values,
    );
    const limit = params.add(request.pageSize);
    const offset = params.add(request.offset);
    const result = await this.db.query(
      `SELECT * FROM (${AGENT_BASE}) x ${where} ORDER BY ${request.orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return { items: result.rows.map(mapAgent), total: Number(count.rows[0].total) };
  }

  async agentsForCluster(clusterId: string): Promise<AgentRecord[]> {
    const result = await this.db.query(
      `${AGENT_BASE} WHERE a.cluster_id = $1 ORDER BY a.last_seen DESC NULLS LAST, a.created_at DESC`,
      [clusterId],
    );
    return result.rows.map(mapAgent);
  }

  async findAgent(id: string, db: Queryable = this.db): Promise<AgentRecord | null> {
    const result = await db.query(`${AGENT_BASE} WHERE a.id = $1`, [id]);
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async findAgentBySubject(subject: string): Promise<(AgentRecord & { clusterRetired: boolean }) | null> {
    const result = await this.db.query<Row>(
      `SELECT a.*, c.cluster_name, c.tenant_id, c.is_retired AS cluster_retired, ${AGENT_HEALTH} AS health
         FROM data_export.agents a JOIN data_export.clusters c ON c.id = a.cluster_id
        WHERE a.identity_subject = $1`,
      [subject],
    );
    const row = result.rows[0];
    return row ? { ...mapAgent(row), clusterRetired: row.cluster_retired } : null;
  }

  async recentHeartbeats(agentId: string, limit = 50) {
    const result = await this.db.query(
      `SELECT heartbeat_time, status, version FROM data_export.agent_heartbeats
        WHERE agent_id = $1 ORDER BY heartbeat_time DESC LIMIT $2`,
      [agentId, limit],
    );
    return result.rows.map(row => ({
      heartbeatTime: iso(row.heartbeat_time) as string,
      status: row.status as string,
      version: row.version as string | null,
    }));
  }

  async insertAgent(
    values: { id: string; clusterId: string; agentName: string | null; identitySubject: string },
    tx: Queryable,
  ) {
    await tx.query(
      `INSERT INTO data_export.agents (id, cluster_id, agent_name, identity_subject, status)
       VALUES ($1, $2, $3, $4, 'UNKNOWN')`,
      [values.id, values.clusterId, values.agentName, values.identitySubject],
    );
  }

  async updateAgent(id: string, patch: { agentName?: string | null; identitySubject?: string }, tx: Queryable) {
    await tx.query(
      `UPDATE data_export.agents SET
         agent_name = CASE WHEN $2::boolean THEN $3 ELSE agent_name END,
         identity_subject = COALESCE($4, identity_subject)
       WHERE id = $1`,
      [id, patch.agentName !== undefined, patch.agentName ?? null, patch.identitySubject ?? null],
    );
  }

  async deleteAgent(id: string, tx: Queryable) {
    await tx.query('DELETE FROM data_export.agents WHERE id = $1', [id]);
  }

  /** Records a heartbeat: updates the agent's current state and appends to its history. */
  async recordHeartbeat(
    agentId: string,
    clusterId: string,
    values: { agentName: string; version: string; status: string; capabilities: Record<string, unknown> },
    tx: Queryable,
  ) {
    await tx.query(
      `UPDATE data_export.agents
          SET agent_name = $2, agent_version = $3, status = $4, capabilities_json = $5, last_seen = NOW()
        WHERE id = $1`,
      [agentId, values.agentName, values.version, values.status, JSON.stringify(values.capabilities)],
    );
    await tx.query(
      `INSERT INTO data_export.agent_heartbeats (agent_id, cluster_id, status, version) VALUES ($1, $2, $3, $4)`,
      [agentId, clusterId, values.status, values.version],
    );
  }

  async countAgents(scope: TenantScope) {
    const params = new SqlParams();
    const where = whereClause(['NOT c.is_retired', tenantScopeClause('c.tenant_id', scope, params)]);
    const result = await this.db.query<{ total: string; connected: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE ${AGENT_HEALTH} IN ('HEALTHY', 'WARNING')
                                 AND a.last_seen > NOW() - INTERVAL '5 minutes') AS connected
         FROM data_export.agents a JOIN data_export.clusters c ON c.id = a.cluster_id ${where}`,
      params.values,
    );
    return { registered: Number(result.rows[0].total), connected: Number(result.rows[0].connected) };
  }
}
