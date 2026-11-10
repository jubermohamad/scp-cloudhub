import crypto from 'crypto';
import { EventEmitter } from 'events';
import type { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  CreateGpuInstanceInput,
  GpuComputeOptions,
  GpuInstanceEvent,
  GpuInstanceRecord,
  GpuInstanceStatus,
  GpuQuotaCheckResult,
  GpuSkuId,
  GpuSkuOption,
  PersonaRole,
  GpuNetworkSubnet,
  GpuOnboardedVnet,
  GpuNetworkProfileDiagnostics,
} from '../types';
import { AzureProvider } from '../providers/azureProvider';
import {
  GpuTerraformCloudService,
  GpuWorkflowDispatchResult,
} from './gpuTerraformCloudService';
import { GpuQuotaService, estimateExpiry } from './gpuQuotaService';
import { GpuVmPowerService } from './gpuVmPowerService';
import { CloudHubNetworksService } from './cloudHubNetworksService';

// Platform-owned resource group. Never selectable by end users.
const RESOURCE_GROUP = 'rg-gpu-sdc';
const NAME_RE = /^[a-z0-9-]{3,63}$/;
const LEASE_DURATIONS = ['7d', '30d', '90d', 'no-expiry'];

// Only these two GPU SKUs are exposed to users. No other VM size is allowed.
const GPU_SKUS: GpuSkuOption[] = [
  {
    id: 'a100',
    label: 'NC24ads A100 v4',
    vmSize: 'Standard_NC24ads_A100_v4',
    gpuFamily: 'standardNCADSA100v4Family',
  },
  {
    id: 'h100',
    label: 'NC80adis H100 v5',
    vmSize: 'Standard_NC80adis_H100_v5',
    gpuFamily: 'StandardNCadsH100v5Family',
  },
];

const SELECT_GPU_INSTANCE = `
  SELECT
    id,
    name,
    gpu_sku AS "gpuSku",
    vm_size AS "vmSize",
    region,
    resource_group AS "resourceGroup",
    subscription_id AS "subscriptionId",
    subnet_id AS "subnetId",
    environment,
    cost_center AS "costCenter",
    owner,
    business_justification AS "businessJustification",
    lease_duration AS "leaseDuration",
    terraform_repository AS "terraformRepository",
    terraform_branch AS "terraformBranch",
    workflow_run_id AS "workflowRunId",
    workflow_run_url AS "workflowRunUrl",
    mode,
    status,
    status_message AS "statusMessage",
    failure_reason AS "failureReason",
    requested_by AS "requestedBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    expires_at AS "expiresAt",
    deleted_at AS "deletedAt"
  FROM control_plane_gpu_instances
`;

/**
 * Error carrying an HTTP status so the router can map validation/RBAC/quota
 * failures to the right status code while surfacing a friendly message.
 */
export class GpuComputeError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GpuComputeError';
    this.status = status;
  }
}

export interface GpuComputeDeps {
  logger: LoggerService;
  getPool: () => Pool | null;
  terraform: GpuTerraformCloudService;
  quota: GpuQuotaService;
  power: GpuVmPowerService;
  azure: AzureProvider;
  networks: CloudHubNetworksService;
  audit: (input: {
    actorRef: string;
    role: PersonaRole;
    action: string;
    targetType: string;
    targetId?: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

/**
 * GpuComputeService
 *
 * Self-service GPU VM provisioning: validates the request against the
 * allow-listed SKU catalog and naming rules, checks Azure GPU quota, renders
 * the Terraform tfvars payload, dispatches the fixed GitHub Actions workflow
 * in scp-azure-terraform-modules (feature/juber-ai-vm only), and persists
 * auditable metadata. The Terraform module itself always targets
 * `rg-gpu-sdc`; only the subnet/network placement is user-selected.
 */
export class GpuComputeService {
  private readonly deps: GpuComputeDeps;
  private readonly memory = new Map<string, GpuInstanceRecord>();
  private readonly eventMemory = new Map<string, GpuInstanceEvent[]>();
  private readonly gpuEventBus = new EventEmitter();

  constructor(deps: GpuComputeDeps) {
    this.deps = deps;
  }

  private pool(): Pool | null {
    return this.deps.getPool();
  }

  private async logEvent(input: {
    instanceId: string;
    level?: GpuInstanceEvent['level'];
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<GpuInstanceEvent> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const event: GpuInstanceEvent = {
      id,
      instanceId: input.instanceId,
      level: input.level ?? 'info',
      message: input.message,
      metadata: input.metadata,
      createdAt,
    };
    const pool = this.pool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO control_plane_gpu_instance_events
            (id, instance_id, level, message, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            event.id,
            event.instanceId,
            event.level,
            event.message,
            event.metadata ? JSON.stringify(event.metadata) : null,
            createdAt,
          ],
        );
      } catch (error) {
        this.deps.logger.warn(
          `[gpu-compute] failed to persist event: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      const list = this.eventMemory.get(input.instanceId) ?? [];
      list.push(event);
      this.eventMemory.set(input.instanceId, list);
    }
    this.gpuEventBus.emit(input.instanceId, event);
    return event;
  }

  onInstanceEvent(
    instanceId: string,
    listener: (event: GpuInstanceEvent) => void,
  ): () => void {
    this.gpuEventBus.on(instanceId, listener);
    return () => {
      this.gpuEventBus.off(instanceId, listener);
    };
  }

  async listEvents(instanceId: string): Promise<GpuInstanceEvent[]> {
    const pool = this.pool();
    if (pool) {
      const result = await pool.query(
        `SELECT
           id,
           instance_id AS "instanceId",
           level,
           message,
           metadata,
           created_at AS "createdAt"
         FROM control_plane_gpu_instance_events
         WHERE instance_id = $1
         ORDER BY created_at DESC
         LIMIT 2000`,
        [instanceId],
      );
      return result.rows.map(row => ({
        id: row.id,
        instanceId: row.instanceId,
        level: row.level,
        message: row.message,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: new Date(row.createdAt).toISOString(),
      }));
    }
    return (this.eventMemory.get(instanceId) ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getOptions(): Promise<GpuComputeOptions> {
    return {
      skus: GPU_SKUS,
      leaseDurations: LEASE_DURATIONS,
      onboardedVnets: this.onboardedVnets(),
      resourceGroup: RESOURCE_GROUP,
      terraformRepository: this.deps.terraform.repository(),
      terraformBranch: this.deps.terraform.branch(),
    };
  }

  private genericGpuProfiles(): Array<{
    name: string;
    network: {
      subscriptionId: string;
      resourceGroup: string;
      vnetName: string;
      subnetName: string;
      region: string;
    };
  }> {
    return Object.entries(this.deps.networks.getAll())
      .filter(
        ([name]) =>
          name === 'gpu' ||
          (name.startsWith('gpu-') &&
            !name.startsWith('gpu-a100') &&
            !name.startsWith('gpu-h100')),
      )
      .map(([name, network]) => ({ name, network }));
  }

  private profilesForSku(gpuSku: GpuSkuId): {
    profiles: Array<{
      name: string;
      source: 'sku' | 'generic-fallback';
      network: {
        subscriptionId: string;
        resourceGroup: string;
        vnetName: string;
        subnetName: string;
        region: string;
      };
    }>;
    usedGenericFallback: boolean;
  } {
    const skuProfiles = this.deps.networks.listByPrefix(`gpu-${gpuSku}`);

    if (skuProfiles.length > 0) {
      return {
        profiles: skuProfiles.map(item => ({
          ...item,
          source: 'sku' as const,
        })),
        usedGenericFallback: false,
      };
    }

    const generic = this.genericGpuProfiles().map(item => ({
      ...item,
      source: 'generic-fallback' as const,
    }));

    return {
      profiles: generic,
      usedGenericFallback: generic.length > 0,
    };
  }

  private onboardedVnetsForSku(gpuSku: GpuSkuId): GpuOnboardedVnet[] {
    const resolved = this.profilesForSku(gpuSku);

    if (resolved.usedGenericFallback) {
      this.deps.logger.warn(
        `[gpu-compute] No gpu-${gpuSku}* profiles found; using generic gpu* network profiles. Configure gpu-${gpuSku}* profiles for explicit SKU governance.`,
      );
    }

    const unique = new Map<string, GpuOnboardedVnet>();
    for (const { network } of resolved.profiles) {
      const entry: GpuOnboardedVnet = {
        subscriptionId: network.subscriptionId,
        resourceGroup: network.resourceGroup,
        vnetName: network.vnetName,
        region: network.region,
      };
      const key = `${entry.subscriptionId}|${entry.resourceGroup}|${entry.vnetName}|${entry.region}`;
      unique.set(key, entry);
    }

    return Array.from(unique.values());
  }

  private onboardedVnets(gpuSku?: GpuSkuId): GpuOnboardedVnet[] {
    if (gpuSku) {
      const scoped = this.onboardedVnetsForSku(gpuSku);
      if (scoped.length === 0) {
        this.deps.logger.warn(
          `[gpu-compute] No network profiles found for GPU SKU '${gpuSku}'. Configure cloudhub.networks entries named gpu-${gpuSku}* (for example gpu-${gpuSku}-primary).`,
        );
      }
      return scoped;
    }

    const all = new Map<string, GpuOnboardedVnet>();
    for (const sku of GPU_SKUS.map(item => item.id)) {
      for (const vnet of this.onboardedVnetsForSku(sku)) {
        const key = `${vnet.subscriptionId}|${vnet.resourceGroup}|${vnet.vnetName}|${vnet.region}`;
        all.set(key, vnet);
      }
    }

    const vnets = Array.from(all.values());
    if (vnets.length === 0) {
      this.deps.logger.warn(
        '[gpu-compute] No GPU network profiles found. Configure cloudhub.networks entries named gpu-a100* and/or gpu-h100*.',
      );
    }
    return vnets;
  }

  async getVnets(input?: { gpuSku?: GpuSkuId }): Promise<GpuOnboardedVnet[]> {
    return this.onboardedVnets(input?.gpuSku);
  }

  getNetworkProfileDiagnostics(): GpuNetworkProfileDiagnostics {
    return {
      bySku: {
        a100: this.profilesForSku('a100').profiles,
        h100: this.profilesForSku('h100').profiles,
      },
      allProfileNames: Object.keys(this.deps.networks.getAll()).sort(),
    };
  }

  async getNetworkOptions(input: {
    gpuSku: GpuSkuId;
    subscriptionId: string;
    vnetName: string;
    region: string;
  }): Promise<GpuNetworkSubnet[]> {
    const vnet = this.onboardedVnets(input.gpuSku).find(
      item =>
        item.subscriptionId === input.subscriptionId &&
        item.vnetName === input.vnetName,
    );
    if (!vnet || vnet.region !== input.region.toLowerCase())
      throw new GpuComputeError(
        'VNet is not onboarded or does not match the deployment region',
      );
    const subnets = await this.deps.azure.discoverGpuSubnets({
      subscriptionId: vnet.subscriptionId,
      resourceGroup: vnet.resourceGroup,
      vnetName: vnet.vnetName,
      region: vnet.region,
    });
    return subnets
      .filter(subnet => subnet.availableIpAddresses > 0)
      .map(
        ({
          name,
          addressRange,
          totalAddresses,
          usedAddresses,
          availableIpAddresses,
        }) => ({
          name,
          addressRange,
          totalAddresses,
          usedAddresses,
          availableIpAddresses,
          lowCapacity: availableIpAddresses <= 32,
        }),
      );
  }

  private resolveSku(gpuSku: GpuSkuId): GpuSkuOption {
    const sku = GPU_SKUS.find(s => s.id === gpuSku);
    if (!sku) {
      throw new GpuComputeError(
        `Unsupported GPU SKU '${gpuSku}'. Allowed values: ${GPU_SKUS.map(
          s => s.id,
        ).join(', ')}`,
      );
    }
    return sku;
  }

  private validateCreateInput(input: CreateGpuInstanceInput): GpuSkuOption {
    if (!NAME_RE.test(input.name)) {
      throw new GpuComputeError(
        'name must match ^[a-z0-9-]{3,63}$ (lowercase letters, numbers, hyphens only)',
      );
    }
    const sku = this.resolveSku(input.gpuSku);
    if (!input.region?.trim()) {
      throw new GpuComputeError('region is required');
    }
    if (!input.subscriptionId?.trim()) {
      throw new GpuComputeError('subscriptionId is required');
    }
    if (!input.vnetName?.trim()) {
      throw new GpuComputeError('vnetName is required');
    }
    if (!input.subnetName?.trim()) {
      throw new GpuComputeError('subnetName is required');
    }
    if (!input.owner?.trim()) {
      throw new GpuComputeError('owner is required');
    }
    if (!input.businessJustification?.trim()) {
      throw new GpuComputeError('businessJustification is required');
    }
    if (!LEASE_DURATIONS.includes(input.leaseDuration)) {
      throw new GpuComputeError(
        `leaseDuration must be one of: ${LEASE_DURATIONS.join(', ')}`,
      );
    }
    return sku;
  }

  async checkQuota(input: {
    gpuSku: GpuSkuId;
    region: string;
  }): Promise<GpuQuotaCheckResult> {
    const sku = this.resolveSku(input.gpuSku);
    return this.deps.quota.checkQuota({
      gpuSku: sku.id,
      vmSize: sku.vmSize,
      region: input.region,
    });
  }

  private buildTfvars(input: {
    name: string;
    sku: GpuSkuOption;
    region: string;
    subnetId: string;
    environment: string;
    owner: string;
  }): Record<string, unknown> {
    return {
      env: input.environment,
      region_code: input.region,
      tenancy: 'st',
      tenant_id: 'all',
      override_vm_name: input.name,
      resource_group_name: RESOURCE_GROUP,
      location: input.region,
      subnet_id: input.subnetId,
      vm_size: input.sku.vmSize,
      tags: {
        owner: input.owner,
        environment: input.environment,
        'managed-by': 'cloudhub-gpu-compute',
      },
    };
  }

  private mapRow(row: Record<string, any>): GpuInstanceRecord {
    return {
      id: row.id,
      name: row.name,
      gpuSku: row.gpuSku,
      vmSize: row.vmSize,
      region: row.region,
      resourceGroup: row.resourceGroup,
      subscriptionId: row.subscriptionId,
      subnetId: row.subnetId,
      environment: row.environment,
      owner: row.owner,
      businessJustification: row.businessJustification,
      leaseDuration: row.leaseDuration,
      terraformRepository: row.terraformRepository,
      terraformBranch: row.terraformBranch,
      workflowRunId: row.workflowRunId,
      workflowRunUrl: row.workflowRunUrl,
      mode: row.mode,
      status: row.status,
      statusMessage: row.statusMessage,
      failureReason: row.failureReason,
      requestedBy: row.requestedBy,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    };
  }

  async create(input: CreateGpuInstanceInput): Promise<GpuInstanceRecord> {
    const sku = this.validateCreateInput(input);
    const vnet = this.onboardedVnets(sku.id).find(
      item =>
        item.subscriptionId === input.subscriptionId &&
        item.vnetName === input.vnetName &&
        item.region === input.region.toLowerCase(),
    );
    if (!vnet)
      throw new GpuComputeError(
        'Selected VNet is not onboarded or does not match the deployment region',
        400,
      );
    const discovered = await this.deps.azure.discoverGpuSubnets({
      subscriptionId: input.subscriptionId,
      resourceGroup: vnet.resourceGroup,
      vnetName: input.vnetName,
      region: input.region,
    });
    const subnet = discovered.find(item => item.name === input.subnetName);
    if (!subnet)
      throw new GpuComputeError(
        'Selected subnet does not exist in the selected VNet or region',
        400,
      );
    if (subnet.availableIpAddresses <= 0)
      throw new GpuComputeError(
        'Selected subnet has no available IP addresses',
        409,
      );

    const quota = await this.deps.quota.checkQuota({
      gpuSku: sku.id,
      vmSize: sku.vmSize,
      region: input.region,
    });
    if (!quota.sufficient) {
      throw new GpuComputeError(quota.message, 409);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await this.logEvent({
      instanceId: id,
      level: 'info',
      message: `GPU VM '${input.name}' requested (${sku.vmSize} in ${input.region})`,
      metadata: { actorRef: input.actorRef, gpuSku: sku.id },
    });
    await this.logEvent({
      instanceId: id,
      level: 'info',
      message: 'Validating Azure GPU quota and network placement',
      metadata: { quota: { available: quota.available, limit: quota.limit } },
    });

    const tfvars = this.buildTfvars({
      name: input.name,
      sku,
      region: input.region,
      subnetId: subnet.id,
      environment: 'dev',
      owner: input.owner,
    });
    await this.logEvent({
      instanceId: id,
      level: 'info',
      message: 'Rendered Terraform tfvars for workspace',
      metadata: {
        subnetId: subnet.id,
        resourceGroup: RESOURCE_GROUP,
        vmSize: sku.vmSize,
      },
    });

    let dispatch: GpuWorkflowDispatchResult;
    try {
      dispatch = await this.deps.terraform.dispatch({
        requestId: id,
        action: 'apply',
        vmName: input.name,
        vmSize: sku.vmSize,
        subnetId: subnet.id,
        location: input.region,
        resourceGroupName: RESOURCE_GROUP,
        tfvarsJson: JSON.stringify(tfvars),
      });
      if (dispatch.mode !== 'terraform-cloud') {
        throw new GpuComputeError(
          'Terraform Cloud returned non-production mode; provisioning aborted.',
          503,
        );
      }
    } catch (error) {
      const message = `Failed to dispatch GPU provisioning workflow: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.logEvent({ instanceId: id, level: 'error', message });
      throw new GpuComputeError(message, 502);
    }

    await this.logEvent({
      instanceId: id,
      level: 'success',
      message: `Terraform Cloud run dispatched (${dispatch.runId})`,
      metadata: {
        runId: dispatch.runId,
        repository: dispatch.repository,
        branch: dispatch.branch,
        htmlUrl: dispatch.htmlUrl,
      },
    });

    const record: GpuInstanceRecord = {
      id,
      name: input.name,
      gpuSku: sku.id,
      vmSize: sku.vmSize,
      region: input.region,
      resourceGroup: RESOURCE_GROUP,
      subscriptionId: input.subscriptionId,
      subnetId: subnet.id,
      environment: 'dev',
      owner: input.owner,
      businessJustification: input.businessJustification,
      leaseDuration: input.leaseDuration,
      terraformRepository: dispatch.repository,
      terraformBranch: dispatch.branch,
      workflowRunId: dispatch.runId,
      workflowRunUrl: dispatch.htmlUrl || null,
      mode: dispatch.mode,
      status: 'PROVISIONING' as GpuInstanceStatus,
      statusMessage: 'GPU VM provisioning workflow dispatched',
      failureReason: null,
      requestedBy: input.actorRef,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: estimateExpiry(input.leaseDuration, now),
      deletedAt: null,
    };

    const pool = this.pool();
    if (pool) {
      await pool.query(
        `INSERT INTO control_plane_gpu_instances (
          id, name, gpu_sku, vm_size, region, resource_group, subscription_id,
          subnet_id, environment, cost_center, owner, business_justification,
          lease_duration, terraform_repository, terraform_branch,
          workflow_run_id, workflow_run_url, mode, status, status_message,
          failure_reason, requested_by, created_at, updated_at, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          record.id,
          record.name,
          record.gpuSku,
          record.vmSize,
          record.region,
          record.resourceGroup,
          record.subscriptionId,
          record.subnetId,
          record.environment,
          '',
          record.owner,
          record.businessJustification,
          record.leaseDuration,
          record.terraformRepository,
          record.terraformBranch,
          record.workflowRunId,
          record.workflowRunUrl,
          record.mode,
          record.status,
          record.statusMessage,
          record.failureReason,
          record.requestedBy,
          now,
          now,
          record.expiresAt,
        ],
      );
    } else {
      this.memory.set(id, record);
    }

    await this.logEvent({
      instanceId: id,
      level: 'info',
      message: 'GPU instance record persisted; waiting for Terraform run',
      metadata: { status: record.status },
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'gpu-instance.create',
      targetType: 'gpu-instance',
      targetId: id,
      payload: { name: input.name, gpuSku: sku.id, region: input.region },
    });

    return record;
  }

  async list(): Promise<GpuInstanceRecord[]> {
    const pool = this.pool();
    if (pool) {
      const result = await pool.query(
        `${SELECT_GPU_INSTANCE} ORDER BY created_at DESC`,
      );
      return result.rows.map(row => this.mapRow(row));
    }
    return Array.from(this.memory.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async get(id: string): Promise<GpuInstanceRecord | null> {
    const pool = this.pool();
    if (pool) {
      const result = await pool.query(`${SELECT_GPU_INSTANCE} WHERE id = $1`, [
        id,
      ]);
      return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }
    return this.memory.get(id) ?? null;
  }

  private async updateStatus(
    id: string,
    fields: Partial<
      Pick<
        GpuInstanceRecord,
        | 'status'
        | 'statusMessage'
        | 'failureReason'
        | 'workflowRunId'
        | 'workflowRunUrl'
        | 'deletedAt'
      >
    >,
  ): Promise<GpuInstanceRecord | null> {
    const now = new Date();
    const pool = this.pool();
    if (pool) {
      const result = await pool.query(
        `UPDATE control_plane_gpu_instances SET
          status = COALESCE($2, status),
          status_message = COALESCE($3, status_message),
          failure_reason = COALESCE($4, failure_reason),
          workflow_run_id = COALESCE($5, workflow_run_id),
          workflow_run_url = COALESCE($6, workflow_run_url),
          deleted_at = COALESCE($7, deleted_at),
          updated_at = $8
        WHERE id = $1
        RETURNING *`,
        [
          id,
          fields.status ?? null,
          fields.statusMessage ?? null,
          fields.failureReason ?? null,
          fields.workflowRunId ?? null,
          fields.workflowRunUrl ?? null,
          fields.deletedAt ?? null,
          now,
        ],
      );
      if (!result.rows[0]) return null;
      return this.get(id);
    }

    const existing = this.memory.get(id);
    if (!existing) return null;
    const updated: GpuInstanceRecord = {
      ...existing,
      ...fields,
      updatedAt: now.toISOString(),
    };
    this.memory.set(id, updated);
    return updated;
  }

  async refreshStatus(id: string): Promise<GpuInstanceRecord | null> {
    const record = await this.get(id);
    if (!record) return record;

    if (record.status === 'STARTING' || record.status === 'STOPPING') {
      const power = await this.deps.power.getPowerState(
        record.resourceGroup,
        record.name,
      );
      if (record.status === 'STARTING' && power === 'running') {
        await this.logEvent({
          instanceId: id,
          level: 'success',
          message: 'GPU VM is running',
          metadata: { previousStatus: record.status, powerState: power },
        });
        return this.updateStatus(id, {
          status: 'READY',
          statusMessage: 'GPU VM is running',
        });
      }
      if (record.status === 'STOPPING' && power === 'deallocated') {
        await this.logEvent({
          instanceId: id,
          level: 'success',
          message: 'GPU VM stopped (deallocated)',
          metadata: { previousStatus: record.status, powerState: power },
        });
        return this.updateStatus(id, {
          status: 'STOPPED',
          statusMessage: 'GPU VM is stopped (deallocated)',
        });
      }
      return record;
    }

    if (!record.workflowRunId) return record;
    if (record.status === 'READY' || record.status === 'DELETED') {
      return record;
    }

    const run = await this.deps.terraform.runStatus(record.workflowRunId);
    if (run.status !== 'completed') {
      await this.logEvent({
        instanceId: id,
        level: 'info',
        message: `Terraform run status: ${run.status}`,
        metadata: { runId: run.runId, status: run.status },
      });
      return record;
    }

    const succeeded = run.conclusion === 'success';
    if (record.status === 'DELETING') {
      await this.logEvent({
        instanceId: id,
        level: succeeded ? 'success' : 'error',
        message: succeeded
          ? 'GPU VM destroyed successfully'
          : 'GPU VM destroy workflow failed',
        metadata: { runId: run.runId, conclusion: run.conclusion },
      });
      return this.updateStatus(id, {
        status: succeeded ? 'DELETED' : 'DELETE_FAILED',
        statusMessage: succeeded
          ? 'GPU VM destroyed successfully'
          : 'GPU VM destroy workflow failed',
        deletedAt: succeeded ? new Date().toISOString() : undefined,
      });
    }
    await this.logEvent({
      instanceId: id,
      level: succeeded ? 'success' : 'error',
      message: succeeded
        ? 'GPU VM provisioned successfully'
        : 'GPU VM provisioning workflow failed',
      metadata: { runId: run.runId, conclusion: run.conclusion },
    });
    return this.updateStatus(id, {
      status: succeeded ? 'READY' : 'FAILED',
      statusMessage: succeeded
        ? 'GPU VM provisioned successfully'
        : 'GPU VM provisioning workflow failed',
      failureReason: succeeded ? null : 'Terraform apply workflow failed',
    });
  }

  async remove(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GpuInstanceRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new GpuComputeError('GPU instance not found', 404);
    }
    if (record.status === 'DELETING' || record.status === 'DELETED') {
      throw new GpuComputeError(
        `GPU instance is already ${record.status.toLowerCase()}`,
        409,
      );
    }

    await this.logEvent({
      instanceId: input.id,
      level: 'info',
      message: 'GPU VM destroy requested',
      metadata: { actorRef: input.actorRef, previousStatus: record.status },
    });

    const tfvars = this.buildTfvars({
      name: record.name,
      sku: this.resolveSku(record.gpuSku),
      region: record.region,
      subnetId: record.subnetId,
      environment: record.environment,
      owner: record.owner,
    });

    let dispatch: GpuWorkflowDispatchResult;
    try {
      dispatch = await this.deps.terraform.dispatch({
        requestId: record.id,
        action: 'destroy',
        vmName: record.name,
        vmSize: record.vmSize,
        subnetId: record.subnetId,
        location: record.region,
        resourceGroupName: RESOURCE_GROUP,
        tfvarsJson: JSON.stringify(tfvars),
      });
      if (dispatch.mode !== 'terraform-cloud') {
        throw new GpuComputeError(
          'Terraform Cloud returned non-production mode; destroy aborted.',
          503,
        );
      }
    } catch (error) {
      const message = `Failed to dispatch GPU destroy workflow: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.logEvent({ instanceId: input.id, level: 'error', message });
      throw new GpuComputeError(message, 502);
    }

    await this.logEvent({
      instanceId: input.id,
      level: 'success',
      message: `Destroy Terraform run dispatched (${dispatch.runId})`,
      metadata: { runId: dispatch.runId, htmlUrl: dispatch.htmlUrl },
    });

    const updated = await this.updateStatus(input.id, {
      status: 'DELETING',
      statusMessage: 'GPU VM destroy workflow dispatched',
      workflowRunId: dispatch.runId,
      workflowRunUrl: dispatch.htmlUrl || undefined,
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'gpu-instance.delete',
      targetType: 'gpu-instance',
      targetId: input.id,
      payload: { name: record.name },
    });

    return updated ?? record;
  }

  async start(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GpuInstanceRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new GpuComputeError('GPU instance not found', 404);
    }
    if (record.status !== 'STOPPED' && record.status !== 'START_FAILED') {
      throw new GpuComputeError(
        `GPU instance cannot be started from status ${record.status}`,
        409,
      );
    }

    await this.logEvent({
      instanceId: input.id,
      level: 'info',
      message: 'GPU VM start requested',
      metadata: { actorRef: input.actorRef },
    });

    try {
      await this.deps.power.start(record.resourceGroup, record.name);
    } catch (error) {
      const message = `Failed to start GPU VM: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.logEvent({ instanceId: input.id, level: 'error', message });
      throw new GpuComputeError(message, 502);
    }

    const updated = await this.updateStatus(input.id, {
      status: 'STARTING',
      statusMessage: 'Start requested',
      failureReason: null,
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'gpu-instance.start',
      targetType: 'gpu-instance',
      targetId: input.id,
      payload: { name: record.name },
    });

    return updated ?? record;
  }

  async stop(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GpuInstanceRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new GpuComputeError('GPU instance not found', 404);
    }
    if (record.status !== 'READY' && record.status !== 'STOP_FAILED') {
      throw new GpuComputeError(
        `GPU instance cannot be stopped from status ${record.status}`,
        409,
      );
    }

    await this.logEvent({
      instanceId: input.id,
      level: 'info',
      message: 'GPU VM stop requested',
      metadata: { actorRef: input.actorRef },
    });

    try {
      await this.deps.power.stop(record.resourceGroup, record.name);
    } catch (error) {
      const message = `Failed to stop GPU VM: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.logEvent({ instanceId: input.id, level: 'error', message });
      throw new GpuComputeError(message, 502);
    }

    const updated = await this.updateStatus(input.id, {
      status: 'STOPPING',
      statusMessage: 'Stop requested',
      failureReason: null,
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'gpu-instance.stop',
      targetType: 'gpu-instance',
      targetId: input.id,
      payload: { name: record.name },
    });

    return updated ?? record;
  }

  // ─── GPU VNet Management (admin functions) ────────────────────────────────

  /**
   * List managed VNets (from database)
   */
  async listManagedVnets(gpuSku?: GpuSkuId): Promise<any[]> {
    const pool = this.pool();
    if (!pool) {
      return [];
    }

    try {
      let query = `
        SELECT 
          v.id,
          v.subscription_id as "subscriptionId",
          v.resource_group as "resourceGroup",
          v.vnet_name as "vnetName",
          v.region,
          COALESCE(array_agg(s.gpu_sku ORDER BY s.gpu_sku), '{}') as "gpuSkus",
          v.created_at as "createdAt",
          v.updated_at as "updatedAt"
        FROM control_plane_gpu_vnets v
        LEFT JOIN control_plane_gpu_vnet_skus s ON v.id = s.vnet_id
      `;

      let params: string[] = [];
      if (gpuSku) {
        query += ` WHERE s.gpu_sku = $1 OR s.gpu_sku IS NULL`;
        params = [gpuSku];
      }

      query += ` GROUP BY v.id, v.subscription_id, v.resource_group, v.vnet_name, v.region, v.created_at, v.updated_at
                 ORDER BY v.region, v.vnet_name`;

      const result = await pool.query(query, params);
      return result.rows.map(row => ({
        ...row,
        gpuSkus: (row.gpuSkus && row.gpuSkus.length > 0) ? row.gpuSkus : ['a100', 'h100'],
      }));
    } catch (error) {
      this.deps.logger.error(
        `Failed to list managed GPU VNets: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Create or update a managed VNet
   */
  async createManagedVnet(input: {
    subscriptionId: string;
    resourceGroup: string;
    vnetName: string;
    region: string;
    gpuSkus?: ('a100' | 'h100')[];
  }): Promise<any> {
    const pool = this.pool();
    if (!pool) {
      throw new GpuComputeError('Database not available');
    }

    if (!input.subscriptionId || !input.resourceGroup || !input.vnetName || !input.region) {
      throw new GpuComputeError('All VNet fields are required');
    }

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const vnetResult = await client.query(
          `INSERT INTO control_plane_gpu_vnets (subscription_id, resource_group, vnet_name, region, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (subscription_id, resource_group, vnet_name, region) DO UPDATE SET updated_at = NOW()
           RETURNING id, subscription_id, resource_group, vnet_name, region, created_at, updated_at`,
          [input.subscriptionId, input.resourceGroup, input.vnetName, input.region],
        );

        const vnetId = vnetResult.rows[0].id;

        // Clear and update SKUs
        await client.query('DELETE FROM control_plane_gpu_vnet_skus WHERE vnet_id = $1', [vnetId]);

        const skus = input.gpuSkus || ['a100', 'h100'];
        for (const sku of skus) {
          await client.query(
            'INSERT INTO control_plane_gpu_vnet_skus (vnet_id, gpu_sku) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [vnetId, sku],
          );
        }

        await client.query('COMMIT');

        return {
          ...vnetResult.rows[0],
          subscriptionId: vnetResult.rows[0].subscription_id,
          resourceGroup: vnetResult.rows[0].resource_group,
          vnetName: vnetResult.rows[0].vnet_name,
          createdAt: vnetResult.rows[0].created_at,
          updatedAt: vnetResult.rows[0].updated_at,
          gpuSkus: skus,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      throw new GpuComputeError(
        `Failed to create VNet: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get a managed VNet by ID
   */
  async getManagedVnetById(id: string): Promise<any | null> {
    const pool = this.pool();
    if (!pool) {
      return null;
    }

    try {
      const result = await pool.query(
        `SELECT 
          v.id,
          v.subscription_id as "subscriptionId",
          v.resource_group as "resourceGroup",
          v.vnet_name as "vnetName",
          v.region,
          v.created_at as "createdAt",
          v.updated_at as "updatedAt",
          COALESCE(array_agg(s.gpu_sku ORDER BY s.gpu_sku), '{}') as "gpuSkus"
         FROM control_plane_gpu_vnets v
         LEFT JOIN control_plane_gpu_vnet_skus s ON v.id = s.vnet_id
         WHERE v.id = $1
         GROUP BY v.id, v.subscription_id, v.resource_group, v.vnet_name, v.region, v.created_at, v.updated_at`,
        [id],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        ...row,
        gpuSkus: (row.gpuSkus && row.gpuSkus.length > 0) ? row.gpuSkus : ['a100', 'h100'],
      };
    } catch (error) {
      this.deps.logger.error(
        `Failed to get managed VNet: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Update GPU SKUs for a managed VNet
   */
  async updateManagedVnetSkus(id: string, gpuSkus: ('a100' | 'h100')[]): Promise<any> {
    const pool = this.pool();
    if (!pool) {
      throw new GpuComputeError('Database not available');
    }

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify VNet exists
        const vnetResult = await client.query(
          'SELECT * FROM control_plane_gpu_vnets WHERE id = $1',
          [id],
        );

        if (vnetResult.rows.length === 0) {
          throw new GpuComputeError('VNet not found', 404);
        }

        // Update SKUs
        await client.query('DELETE FROM control_plane_gpu_vnet_skus WHERE vnet_id = $1', [id]);

        for (const sku of gpuSkus) {
          await client.query(
            'INSERT INTO control_plane_gpu_vnet_skus (vnet_id, gpu_sku) VALUES ($1, $2)',
            [id, sku],
          );
        }

        await client.query('COMMIT');

        const updated = await this.getManagedVnetById(id);
        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      throw new GpuComputeError(
        `Failed to update VNet SKUs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Delete a managed VNet
   */
  async deleteManagedVnet(id: string): Promise<void> {
    const pool = this.pool();
    if (!pool) {
      throw new GpuComputeError('Database not available');
    }

    try {
      const result = await pool.query('DELETE FROM control_plane_gpu_vnets WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        throw new GpuComputeError('VNet not found', 404);
      }
    } catch (error) {
      if (error instanceof GpuComputeError) {
        throw error;
      }
      throw new GpuComputeError(
        `Failed to delete VNet: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async runLogs(id: string): Promise<{ mode: string; runId: string | null; lines: string[] }> {
    const record = await this.get(id);
    if (!record) {
      throw new GpuComputeError('GPU instance not found', 404);
    }
    if (!record.workflowRunId) {
      return { mode: record.mode, runId: null, lines: [] };
    }
    const result = await this.deps.terraform.runLogs(record.workflowRunId);
    return {
      mode: result.mode,
      runId: result.runId,
      lines: result.lines,
    };
  }
}
