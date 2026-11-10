import crypto from 'crypto';
import type { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  AzureFoundationOptions,
  AzureFoundationProvisionStatus,
  AzureFoundationResourceOption,
  AzureFoundationResourceRecord,
  AzureFoundationResourceType,
  CreateAzureFoundationResourceInput,
  PersonaRole,
} from '../types';
import { TerraformCloudService } from './terraformCloudService';

const NAME_RE = /^[a-z0-9-]{3,63}$/;

const TFC_ORGANIZATION = 'sensa-cloud-platform';
const REPOSITORY =
  process.env.CLOUDHUB_TFC_REPOSITORY ??
  process.env.TFC_REPOSITORY ??
  'jubermohamad/platform_cloudhub';
const BRANCH = process.env.CLOUDHUB_TFC_BRANCH ?? 'main';

type ModuleConfig = {
  modulePath: string;
  workspacePrefix: string;
  label: string;
};

const MODULE_BY_RESOURCE: Record<AzureFoundationResourceType, ModuleConfig> = {
  'resource-group': {
    modulePath: 'azure-resource-group',
    workspacePrefix: 'fdn-rg-',
    label: 'Azure Resource Group',
  },
  'vnet-subnet': {
    modulePath: 'azure-vnet-subnet',
    workspacePrefix: 'fdn-vnet-',
    label: 'Azure VNet/Subnet',
  },
  'key-vault': {
    modulePath: 'azure-key-vault',
    workspacePrefix: 'fdn-kv-',
    label: 'Secrets Vault',
  },
  'storage-account': {
    modulePath: 'azure-storage-account',
    workspacePrefix: 'fdn-st-',
    label: 'Azure Storage Account',
  },
};

const SELECT_AZURE_FOUNDATION_REQUEST = `
  SELECT
    id,
    resource_type AS "resourceType",
    name,
    provider,
    module_path AS "modulePath",
    terraform_repository AS "terraformRepository",
    terraform_branch AS "terraformBranch",
    workflow_run_id AS "workflowRunId",
    workflow_run_url AS "workflowRunUrl",
    mode,
    status,
    status_message AS "statusMessage",
    failure_reason AS "failureReason",
    properties,
    requested_by AS "requestedBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM control_plane_azure_foundation_requests
`;

class AzureFoundationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AzureFoundationError';
    this.status = status;
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(v => String(v ?? '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }
  return [];
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const norm = value.trim().toLowerCase();
    if (norm === 'true') return true;
    if (norm === 'false') return false;
  }
  return fallback;
}

function defaultsFor(resourceType: AzureFoundationResourceType) {
  switch (resourceType) {
    case 'resource-group':
      return {
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        tenantId: 'all',
        region: 'swedencentral',
      };
    case 'vnet-subnet':
      return {
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        tenantId: 'all',
        location: 'swedencentral',
        addressSpace: ['10.0.0.0/16'],
        subnetAddressPrefixes: ['10.0.1.0/24'],
        createVnet: true,
      };
    case 'key-vault':
      return {
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        namingTenantId: 'all',
        location: 'swedencentral',
        privateDnsZoneIds: ['privatelink.vaultcore.azure.net'],
      };
    case 'storage-account':
      return {
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        tenantId: 'all',
        location: 'swedencentral',
        accountTier: 'Standard',
        accountReplicationType: 'LRS',
      };
    default:
      return {};
  }
}

function terminalStatus(succeeded: boolean): AzureFoundationProvisionStatus {
  return succeeded ? 'READY' : 'FAILED';
}

export interface AzureFoundationResourceDeps {
  logger: LoggerService;
  getPool: () => Pool | null;
  audit: (input: {
    actorRef: string;
    role: PersonaRole;
    action: string;
    targetType: string;
    targetId?: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

export class AzureFoundationResourceService {
  private readonly deps: AzureFoundationResourceDeps;
  private readonly memory = new Map<string, AzureFoundationResourceRecord>();
  private readonly terraformByType: Record<
    AzureFoundationResourceType,
    TerraformCloudService
  >;

  constructor(deps: AzureFoundationResourceDeps) {
    this.deps = deps;
    this.terraformByType = {
      'resource-group': this.newTerraformService('resource-group'),
      'vnet-subnet': this.newTerraformService('vnet-subnet'),
      'key-vault': this.newTerraformService('key-vault'),
      'storage-account': this.newTerraformService('storage-account'),
    };
  }

  private newTerraformService(
    resourceType: AzureFoundationResourceType,
  ): TerraformCloudService {
    const cfg = MODULE_BY_RESOURCE[resourceType];
    return new TerraformCloudService({
      logger: this.deps.logger,
      config: {
        organization: TFC_ORGANIZATION,
        repository: REPOSITORY,
        branch: BRANCH,
        workingDirectory: cfg.modulePath,
        workspacePrefix: cfg.workspacePrefix,
        label: cfg.label,
        logPrefix: `foundation-${resourceType}`,
        committerName: 'CloudHub Azure Foundation',
        committerEmail: 'cloudhub-foundation@symphony.ai',
      },
    });
  }

  getOptions(): AzureFoundationOptions {
    const resources: AzureFoundationResourceOption[] = (
      Object.keys(MODULE_BY_RESOURCE) as AzureFoundationResourceType[]
    ).map(resourceType => ({
      resourceType,
      modulePath: MODULE_BY_RESOURCE[resourceType].modulePath,
      defaults: defaultsFor(resourceType),
    }));

    return {
      provider: 'azure',
      terraformRepository: REPOSITORY,
      terraformBranch: BRANCH,
      resources,
    };
  }

  private ensureConfigured(service: TerraformCloudService): void {
    if (!service.configured()) {
      throw new AzureFoundationError(
        'Terraform Cloud provisioning is not configured. Required: CLOUDHUB_TFC_TOKEN, CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID, and GITHUB_TOKEN (or GITHUB_ACTIONS_TOKEN).',
        503,
      );
    }
  }

  private validateName(name: string, resourceType: AzureFoundationResourceType) {
    if (!NAME_RE.test(name)) {
      throw new AzureFoundationError(
        `${resourceType} name must be 3-63 chars of lowercase letters, numbers, and hyphens`,
      );
    }
  }

  private tfvarsFor(input: CreateAzureFoundationResourceInput): string {
    const resourceType = input.resourceType;
    const p = input.properties ?? {};

    const env = asString(p.env, 'dev');
    const regionCode = asString(p.regionCode, 'sdc');
    const tenancy = asString(p.tenancy, 'st');
    const tenantId = asString(p.tenantId, 'all');
    const location = asString(p.location, 'swedencentral');
    const resourceGroupName = asString(p.resourceGroupName);
    const tags = {
      env,
      owner: input.actorRef,
      'managed-by': 'cloudhub',
      purpose: `foundation-${resourceType}`,
    };

    switch (resourceType) {
      case 'resource-group': {
        const body = {
          env,
          region_code: regionCode,
          tenancy,
          tenant_id: tenantId,
          region: asString(p.region, location),
          name_override: input.name,
          tags,
        };
        return JSON.stringify(body, null, 2);
      }
      case 'vnet-subnet': {
        if (!resourceGroupName) {
          throw new AzureFoundationError('resourceGroupName is required');
        }
        const vnetName = asString(p.vnetName);
        const subnetName = asString(p.subnetName);
        if (!vnetName || !subnetName) {
          throw new AzureFoundationError('vnetName and subnetName are required');
        }
        const body = {
          location,
          resource_group_name: resourceGroupName,
          create_vnet: asBool(p.createVnet, true),
          vnet_name: vnetName,
          subnet_name: subnetName,
          address_space: asStringList(p.addressSpace).length
            ? asStringList(p.addressSpace)
            : ['10.0.0.0/16'],
          subnet_address_prefixes: asStringList(p.subnetAddressPrefixes).length
            ? asStringList(p.subnetAddressPrefixes)
            : ['10.0.1.0/24'],
          service_endpoints: asStringList(p.serviceEndpoints).length
            ? asStringList(p.serviceEndpoints)
            : ['Microsoft.Storage'],
          env,
          region_code: regionCode,
          tenancy,
          tenant_id: tenantId,
          tags,
        };
        return JSON.stringify(body, null, 2);
      }
      case 'key-vault': {
        if (!resourceGroupName) {
          throw new AzureFoundationError('resourceGroupName is required');
        }
        const privateEndpointSubnetId = asString(p.privateEndpointSubnetId);
        if (!privateEndpointSubnetId) {
          throw new AzureFoundationError('privateEndpointSubnetId is required');
        }
        const privateDnsZoneIds = asStringList(p.privateDnsZoneIds);
        if (privateDnsZoneIds.length === 0) {
          throw new AzureFoundationError('privateDnsZoneIds is required');
        }
        const aadTenantId = asString(p.aadTenantId);
        if (!aadTenantId) {
          throw new AzureFoundationError('aadTenantId is required');
        }

        const body = {
          name_override: input.name,
          env,
          region_code: regionCode,
          tenancy,
          naming_tenant_id: asString(p.namingTenantId, tenantId),
          resource_group_name: resourceGroupName,
          location,
          tenant_id: aadTenantId,
          private_endpoint_subnet_id: privateEndpointSubnetId,
          private_dns_zone_ids: privateDnsZoneIds,
          tags,
        };
        return JSON.stringify(body, null, 2);
      }
      case 'storage-account': {
        if (!resourceGroupName) {
          throw new AzureFoundationError('resourceGroupName is required');
        }
        const body = {
          name: input.name.replace(/-/g, ''),
          resource_group_name: resourceGroupName,
          location,
          env,
          region_code: regionCode,
          tenancy,
          tenant_id: tenantId,
          account_tier: asString(p.accountTier, 'Standard'),
          account_replication_type: asString(p.accountReplicationType, 'LRS'),
          tags,
        };
        return JSON.stringify(body, null, 2);
      }
      default:
        throw new AzureFoundationError(
          `Unsupported Azure foundation resource: ${resourceType}`,
        );
    }
  }

  async create(
    input: CreateAzureFoundationResourceInput,
  ): Promise<AzureFoundationResourceRecord> {
    const module = MODULE_BY_RESOURCE[input.resourceType];
    if (!module) {
      throw new AzureFoundationError(
        `Unsupported Azure foundation resource: ${input.resourceType}`,
      );
    }

    this.validateName(input.name, input.resourceType);

    const existing = (await this.list()).find(
      r =>
        r.resourceType === input.resourceType &&
        r.name === input.name &&
        r.status !== 'FAILED',
    );
    if (existing) {
      throw new AzureFoundationError(
        `A ${input.resourceType} request named "${input.name}" already exists`,
        409,
      );
    }

    const tfvarsJson = this.tfvarsFor(input);
    const service = this.terraformByType[input.resourceType];
    this.ensureConfigured(service);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const record: AzureFoundationResourceRecord = {
      id,
      resourceType: input.resourceType,
      name: input.name,
      provider: 'azure',
      modulePath: module.modulePath,
      terraformRepository: service.repository(),
      terraformBranch: service.branch(),
      workflowRunId: null,
      workflowRunUrl: null,
      mode: 'terraform-cloud',
      status: 'PENDING',
      statusMessage: null,
      failureReason: null,
      properties: input.properties,
      requestedBy: input.actorRef,
      createdAt: now,
      updatedAt: now,
    };

    await this.persist(record);

    try {
      const dispatch = await service.dispatch({
        requestId: id,
        action: 'apply',
        vmName: input.name,
        tfvarsJson,
      });

      if (dispatch.mode !== 'terraform-cloud') {
        throw new AzureFoundationError(
          'Terraform Cloud returned non-production mode; provisioning aborted.',
          503,
        );
      }

      record.mode = dispatch.mode;
      record.workflowRunId = dispatch.runId;
      record.workflowRunUrl = dispatch.htmlUrl || null;
      record.status = 'PROVISIONING';
      record.statusMessage = 'Terraform Cloud run queued.';
    } catch (error) {
      record.status = 'FAILED';
      record.failureReason =
        error instanceof Error ? error.message : String(error);
      record.statusMessage = 'Terraform run failed to start.';
    }

    record.updatedAt = new Date().toISOString();
    await this.persist(record);

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'azure-foundation.create',
      targetType: input.resourceType,
      targetId: id,
      payload: {
        name: input.name,
        resourceType: input.resourceType,
        modulePath: record.modulePath,
        mode: record.mode,
        status: record.status,
      },
    });

    return record;
  }

  async list(): Promise<AzureFoundationResourceRecord[]> {
    const pool = this.deps.getPool();
    if (!pool) {
      return Array.from(this.memory.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    }
    const result = await pool.query(
      `${SELECT_AZURE_FOUNDATION_REQUEST} ORDER BY created_at DESC`,
    );
    return result.rows as AzureFoundationResourceRecord[];
  }

  async get(id: string): Promise<AzureFoundationResourceRecord | null> {
    const pool = this.deps.getPool();
    if (!pool) return this.memory.get(id) ?? null;
    const result = await pool.query(
      `${SELECT_AZURE_FOUNDATION_REQUEST} WHERE id = $1`,
      [id],
    );
    return (result.rows[0] as AzureFoundationResourceRecord) ?? null;
  }

  async refreshStatus(id: string): Promise<AzureFoundationResourceRecord | null> {
    const record = await this.get(id);
    if (!record?.workflowRunId) return record ?? null;
    if (record.status !== 'PROVISIONING') {
      return record;
    }

    try {
      const service = this.terraformByType[record.resourceType];
      const run = await service.runStatus(record.workflowRunId);
      if (run.status === 'completed') {
        const succeeded = run.conclusion === 'success';
        record.status = terminalStatus(succeeded);
        record.statusMessage = succeeded
          ? null
          : `Terraform run finished with conclusion "${run.conclusion}".`;
        if (!succeeded) {
          record.failureReason = record.statusMessage;
        }
        record.updatedAt = new Date().toISOString();
        await this.persist(record);
      }
    } catch (error) {
      this.deps.logger.warn(
        `[azure-foundation] status refresh failed for ${record.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return record;
  }

  private async persist(record: AzureFoundationResourceRecord): Promise<void> {
    const pool = this.deps.getPool();
    if (!pool) {
      this.memory.set(record.id, { ...record });
      return;
    }

    await pool.query(
      `INSERT INTO control_plane_azure_foundation_requests (
         id, resource_type, name, provider, module_path,
         terraform_repository, terraform_branch, workflow_run_id,
         workflow_run_url, mode, status, status_message, failure_reason,
         properties, requested_by, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
       )
       ON CONFLICT (id) DO UPDATE SET
         workflow_run_id = EXCLUDED.workflow_run_id,
         workflow_run_url = EXCLUDED.workflow_run_url,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         status_message = EXCLUDED.status_message,
         failure_reason = EXCLUDED.failure_reason,
         properties = EXCLUDED.properties,
         updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.resourceType,
        record.name,
        record.provider,
        record.modulePath,
        record.terraformRepository,
        record.terraformBranch,
        record.workflowRunId,
        record.workflowRunUrl,
        record.mode,
        record.status,
        record.statusMessage,
        record.failureReason,
        record.properties ?? {},
        record.requestedBy,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }
}
