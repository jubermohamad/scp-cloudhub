import { randomUUID } from 'crypto';
import { Caller, canViewTenant, requirePlatformAdmin, visibleTenants } from '../access';
import { recordAudit } from '../audit';
import type { DataExportDatabase } from '../db';
import { ConflictError, NotFoundError, mapUniqueViolation } from '../errors';
import { Page, pageOf, parseListQuery } from '../listQuery';
import { AGENT_LIST, AgentRecord, CLUSTER_LIST, ClusterRecord, FleetRepository } from '../repositories/fleetRepository';
import { isUuid, validateAgentInput, validateClusterInput } from '../validation';

export interface ClusterDetail extends ClusterRecord {
  agents: AgentRecord[];
}

/**
 * Cluster and agent registries. Clusters are never deleted: they are retired,
 * which stops scheduling on them while keeping their history. Clusters synced
 * from Platform Registry are read-only here; Platform Registry is their source.
 */
export class FleetService {
  readonly repo: FleetRepository;

  constructor(private readonly db: DataExportDatabase) {
    this.repo = new FleetRepository(db);
  }

  /* ---------- clusters ---------- */

  async listClusters(query: Record<string, unknown>, caller: Caller): Promise<Page<ClusterRecord>> {
    const request = parseListQuery(query, CLUSTER_LIST, 'x.id');
    const { items, total } = await this.repo.listClusters(request, visibleTenants(caller));
    return pageOf(items, total, request);
  }

  private async visibleCluster(id: string, caller: Caller): Promise<ClusterRecord> {
    const cluster = isUuid(id) ? await this.repo.findCluster(id) : null;
    if (!cluster || !canViewTenant(caller, cluster.tenantId)) throw new NotFoundError(`Cluster ${id} not found`);
    return cluster;
  }

  async getCluster(id: string, caller: Caller): Promise<ClusterDetail> {
    const cluster = await this.visibleCluster(id, caller);
    return { ...cluster, agents: await this.repo.agentsForCluster(cluster.id) };
  }

  clusterHealth(caller: Caller) {
    return this.repo.clusterHealthSummary(visibleTenants(caller));
  }

  async createCluster(input: unknown, caller: Caller): Promise<ClusterDetail> {
    requirePlatformAdmin(caller);
    const values = validateClusterInput(input);
    const id = randomUUID();
    try {
      await this.db.transaction(async tx => {
        await this.repo.insertCluster(id, values, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'cluster.registered',
          entityType: 'cluster',
          entityId: id,
          tenantId: values.tenantId,
          details: { clusterName: values.clusterName, environment: values.environment },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, `Cluster ${values.clusterName} is already registered for ${values.tenantId}`);
    }
    return this.getCluster(id, caller);
  }

  async updateCluster(id: string, input: unknown, caller: Caller): Promise<ClusterDetail> {
    requirePlatformAdmin(caller);
    const existing = await this.visibleCluster(id, caller);
    if (existing.platformRegistryId) {
      throw new ConflictError(`${existing.clusterName} is managed by Platform Registry; change it there`);
    }
    const values = validateClusterInput(input);
    // Exports inherit tenant and environment from their cluster; moving a
    // cluster that exports use would silently move those exports too.
    const changesScope = values.tenantId !== existing.tenantId || values.environment !== existing.environment;
    if (changesScope && (await this.repo.countExportsForCluster(existing.id)) > 0) {
      throw new ConflictError('Cannot change the tenant or environment of a cluster that exports use');
    }
    try {
      await this.db.transaction(async tx => {
        await this.repo.updateCluster(existing.id, values, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'cluster.updated',
          entityType: 'cluster',
          entityId: existing.id,
          tenantId: values.tenantId,
          details: { clusterName: values.clusterName },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, `Cluster ${values.clusterName} is already registered for ${values.tenantId}`);
    }
    return this.getCluster(id, caller);
  }

  async setRetired(id: string, retired: boolean, caller: Caller): Promise<ClusterDetail> {
    requirePlatformAdmin(caller);
    const existing = await this.visibleCluster(id, caller);
    if (existing.isRetired !== retired) {
      await this.db.transaction(async tx => {
        await this.repo.setRetired(existing.id, retired, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action: retired ? 'cluster.retired' : 'cluster.restored',
          entityType: 'cluster',
          entityId: existing.id,
          tenantId: existing.tenantId,
          details: { clusterName: existing.clusterName },
        });
      });
    }
    return this.getCluster(id, caller);
  }

  /* ---------- agents ---------- */

  async listAgents(query: Record<string, unknown>, caller: Caller): Promise<Page<AgentRecord>> {
    const request = parseListQuery(query, AGENT_LIST, 'x.id');
    const { items, total } = await this.repo.listAgents(request, visibleTenants(caller));
    return pageOf(items, total, request);
  }

  async getAgent(id: string, caller: Caller) {
    const agent = isUuid(id) ? await this.repo.findAgent(id) : null;
    if (!agent || !canViewTenant(caller, agent.tenantId)) throw new NotFoundError(`Agent ${id} not found`);
    return { ...agent, heartbeats: await this.repo.recentHeartbeats(agent.id) };
  }

  countAgents(caller: Caller) {
    return this.repo.countAgents(visibleTenants(caller));
  }

  async registerAgent(clusterId: string, input: unknown, caller: Caller): Promise<AgentRecord> {
    requirePlatformAdmin(caller);
    const cluster = await this.visibleCluster(clusterId, caller);
    if (cluster.isRetired) throw new ConflictError(`${cluster.clusterName} is retired`);
    const values = validateAgentInput(input);
    const id = randomUUID();
    try {
      await this.db.transaction(async tx => {
        await this.repo.insertAgent(
          {
            id,
            clusterId: cluster.id,
            agentName: values.agentName ?? null,
            identitySubject: values.identitySubject as string,
          },
          tx,
        );
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'agent.registered',
          entityType: 'agent',
          entityId: id,
          tenantId: cluster.tenantId,
          details: { clusterName: cluster.clusterName, identitySubject: values.identitySubject },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, 'That workload identity is already registered to an agent');
    }
    return (await this.repo.findAgent(id)) as AgentRecord;
  }

  async updateAgent(id: string, input: unknown, caller: Caller): Promise<AgentRecord> {
    requirePlatformAdmin(caller);
    const agent = await this.getAgent(id, caller);
    const patch = validateAgentInput(input, true);
    try {
      await this.db.transaction(async tx => {
        await this.repo.updateAgent(agent.id, patch, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'agent.updated',
          entityType: 'agent',
          entityId: agent.id,
          tenantId: agent.tenantId,
          details: { fields: Object.keys(patch) },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, 'That workload identity is already registered to an agent');
    }
    return (await this.repo.findAgent(id)) as AgentRecord;
  }

  async deleteAgent(id: string, caller: Caller): Promise<void> {
    requirePlatformAdmin(caller);
    const agent = await this.getAgent(id, caller);
    await this.db.transaction(async tx => {
      await this.repo.deleteAgent(agent.id, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: 'agent.removed',
        entityType: 'agent',
        entityId: agent.id,
        tenantId: agent.tenantId,
        details: { clusterName: agent.clusterName, identitySubject: agent.identitySubject },
      });
    });
  }
}
