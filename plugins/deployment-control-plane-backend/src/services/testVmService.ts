import crypto from 'crypto';
import type { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  CreateTestVmInput,
  PersonaRole,
  TestVmOptions,
  TestVmRecord,
  TestVmSizeOption,
  TestVmStatus,
} from '../types';
import { VmTerraformCloudService } from './vmTerraformCloudService';
import { AzureProvider } from '../providers/azureProvider';
import {
  buildSubnetId,
  CloudHubNetworksService,
} from './cloudHubNetworksService';

const NAME_RE = /^[a-z0-9-]{3,63}$/;
const HOURS_PER_MONTH = 730;

/**
 * Fixed placement for one-click test VMs. Not user-selectable — the whole
 * point of the card is that a name is the only required input. Mirrors the
 * defaults baked into deployments/vm-self-service. Read per call so config
 * changes do not need a restart.
 */
function resourceGroup(): string {
  return process.env.CLOUDHUB_TEST_VM_RESOURCE_GROUP || 'rg-cloudhub';
}

function region(): string {
  return process.env.CLOUDHUB_TEST_VM_REGION || 'swedencentral';
}

function regionCode(): string {
  return process.env.CLOUDHUB_TEST_VM_REGION_CODE || 'sdc';
}

/** Tagged so CloudHub's env=dev start/stop filter picks the VM up. */
const ENVIRONMENT = 'dev';

// Must stay a subset of the allow-list in vm-self-service/variables.tf.
const SIZES: TestVmSizeOption[] = [
  {
    id: 'b1s',
    label: 'B1s — Low Cost',
    vmSize: 'Standard_B1s',
    vcpus: 1,
    memoryGb: 1,
    hourlyUsd: 0.0108,
    monthlyUsd: Math.round(0.0108 * HOURS_PER_MONTH * 100) / 100,
  },
  {
    id: 'b1ms',
    label: 'B1ms — Low Cost',
    vmSize: 'Standard_B1ms',
    vcpus: 1,
    memoryGb: 2,
    hourlyUsd: 0.0216,
    monthlyUsd: Math.round(0.0216 * HOURS_PER_MONTH * 100) / 100,
  },
  {
    id: 'b2s',
    label: 'B2s — Small',
    vmSize: 'Standard_B2s',
    vcpus: 2,
    memoryGb: 4,
    hourlyUsd: 0.0416,
    monthlyUsd: Math.round(0.0416 * HOURS_PER_MONTH * 100) / 100,
  },
];

const SELECT_TEST_VM = `
  SELECT
    id,
    name,
    vm_size AS "vmSize",
    region,
    resource_group AS "resourceGroup",
    subnet_id AS "subnetId",
    environment,
    owner,
    terraform_repository AS "terraformRepository",
    terraform_branch AS "terraformBranch",
    workflow_run_id AS "workflowRunId",
    workflow_run_url AS "workflowRunUrl",
    mode,
    status,
    status_message AS "statusMessage",
    failure_reason AS "failureReason",
    monthly_usd AS "monthlyUsd",
    requested_by AS "requestedBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    deleted_at AS "deletedAt"
  FROM control_plane_test_vms
`;

export class TestVmError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TestVmError';
    this.status = status;
  }
}

export interface TestVmDeps {
  logger: LoggerService;
  getPool: () => Pool | null;
  terraform: VmTerraformCloudService;
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
 * One-click low-cost test VM provisioning. Placement, image and networking are
 * fixed; the caller supplies a name and optionally a size from the allow-list.
 */
export class TestVmService {
  private readonly deps: TestVmDeps;
  private readonly memory = new Map<string, TestVmRecord>();

  constructor(deps: TestVmDeps) {
    this.deps = deps;
  }

  private ensureTerraformConfigured(): void {
    if (!this.deps.terraform.configured()) {
      throw new TestVmError(
        'Terraform Cloud provisioning is not configured. Required: CLOUDHUB_TFC_TOKEN, CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID, and GITHUB_TOKEN (or GITHUB_ACTIONS_TOKEN).',
        503,
      );
    }
  }

  private hasNetworkConfig(): boolean {
    return this.deps.networks.hasProfile('testvm');
  }

  private async resolveSubnetId(): Promise<string> {
    let network;
    try {
      network = this.deps.networks.getNetworkProfile('testvm');
    } catch (error) {
      throw new TestVmError(
        error instanceof Error
          ? error.message
          : 'Network profile testvm is not configured',
        503,
      );
    }

    const expectedSubnetId = buildSubnetId(network).toLowerCase();

    const subnets = await this.deps.azure.discoverGpuSubnets({
      subscriptionId: network.subscriptionId,
      resourceGroup: network.resourceGroup,
      vnetName: network.vnetName,
      region: network.region,
    });
    const subnet = subnets.find(
      item =>
        item.name === network.subnetName ||
        item.id.toLowerCase() === expectedSubnetId,
    );
    if (!subnet?.id) {
      this.deps.logger.warn(
        `[test-vm] Azure discovery did not return subnet '${network.subnetName}' in ${network.vnetName}; using configured profile subnet id`,
      );
      return buildSubnetId(network);
    }
    return subnet.id;
  }

  getOptions(): TestVmOptions {
    const networkHint = this.deps.networks.hasProfile('testvm')
      ? this.deps.networks.subnetIdFor('testvm')
      : '';

    return {
      sizes: SIZES,
      defaultSize: SIZES[0].vmSize,
      resourceGroup: resourceGroup(),
      region: region(),
      environment: ENVIRONMENT,
      subnetId: networkHint,
      terraformRepository: this.deps.terraform.repository(),
      terraformBranch: this.deps.terraform.branch(),
      configured: this.deps.terraform.configured() && this.hasNetworkConfig(),
    };
  }

  private resolveSize(vmSize?: string): TestVmSizeOption {
    if (!vmSize) return SIZES[0];
    const match = SIZES.find(s => s.vmSize === vmSize || s.id === vmSize);
    if (!match) {
      throw new TestVmError(
        `vmSize must be one of: ${SIZES.map(s => s.vmSize).join(', ')}`,
      );
    }
    return match;
  }

  private buildTfvars(
    name: string,
    size: TestVmSizeOption,
    owner: string,
    resolvedSubnetId: string,
  ) {
    return JSON.stringify(
      {
        override_vm_name: name,
        resource_group_name: resourceGroup(),
        location: region(),
        subnet_id: resolvedSubnetId,
        vm_size: size.vmSize,
        env: ENVIRONMENT,
        region_code: regionCode(),
        tenancy: 'st',
        tenant_id: 'all',
        tags: {
          env: ENVIRONMENT,
          owner,
          'managed-by': 'cloudhub',
          purpose: 'self-service-test-vm',
        },
      },
      null,
      2,
    );
  }

  async create(input: CreateTestVmInput): Promise<TestVmRecord> {
    if (!NAME_RE.test(input.name ?? '')) {
      throw new TestVmError(
        'name must be 3-63 characters of lowercase letters, numbers and hyphens',
      );
    }
    const resolvedSubnetId = await this.resolveSubnetId();
    this.ensureTerraformConfigured();

    const existing = await this.list();
    if (existing.some(vm => vm.name === input.name)) {
      throw new TestVmError(`A test VM named "${input.name}" already exists`, 409);
    }

    const size = this.resolveSize(input.vmSize);
    const owner = input.owner?.trim() || input.actorRef;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const record: TestVmRecord = {
      id,
      name: input.name,
      vmSize: size.vmSize,
      region: region(),
      resourceGroup: resourceGroup(),
      subnetId: resolvedSubnetId,
      environment: ENVIRONMENT,
      owner,
      terraformRepository: this.deps.terraform.repository(),
      terraformBranch: this.deps.terraform.branch(),
      workflowRunId: null,
      workflowRunUrl: null,
      mode: 'terraform-cloud',
      status: 'PENDING',
      statusMessage: null,
      failureReason: null,
      monthlyUsd: size.monthlyUsd,
      requestedBy: input.actorRef,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await this.persist(record);

    try {
      const dispatch = await this.deps.terraform.dispatch({
        requestId: id,
        action: 'apply',
        vmName: input.name,
        tfvarsJson: this.buildTfvars(
          input.name,
          size,
          owner,
          resolvedSubnetId,
        ),
      });

      if (dispatch.mode !== 'terraform-cloud') {
        throw new TestVmError(
          'Terraform Cloud returned non-production mode; provisioning aborted.',
          503,
        );
      }

      record.mode = dispatch.mode;
      record.workflowRunId = dispatch.runId;
      record.workflowRunUrl = dispatch.htmlUrl || null;
      record.status = 'PROVISIONING';
      record.statusMessage = 'Terraform Cloud run queued against azure-linux-virtual-machine.';
    } catch (error) {
      record.status = 'FAILED';
      record.failureReason =
        error instanceof Error ? error.message : String(error);
      record.updatedAt = new Date().toISOString();
      await this.persist(record);
      await this.deps.audit({
        actorRef: input.actorRef,
        role: input.role,
        action: 'test-vm.create',
        targetType: 'test-vm',
        targetId: id,
        payload: {
          name: record.name,
          vmSize: record.vmSize,
          mode: record.mode,
          status: record.status,
          failureReason: record.failureReason,
        },
      });
      throw error instanceof TestVmError
        ? error
        : new TestVmError(record.failureReason ?? 'Terraform Cloud dispatch failed', 502);
    }

    record.updatedAt = new Date().toISOString();
    await this.persist(record);

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'test-vm.create',
      targetType: 'test-vm',
      targetId: id,
      payload: {
        name: record.name,
        vmSize: record.vmSize,
        mode: record.mode,
        status: record.status,
      },
    });

    return record;
  }

  async list(): Promise<TestVmRecord[]> {
    const pool = this.deps.getPool();
    if (!pool) {
      return Array.from(this.memory.values())
        .filter(vm => vm.status !== 'DELETED')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const result = await pool.query(
      `${SELECT_TEST_VM} WHERE status <> 'DELETED' ORDER BY created_at DESC`,
    );
    return result.rows as TestVmRecord[];
  }

  async get(id: string): Promise<TestVmRecord | null> {
    const pool = this.deps.getPool();
    if (!pool) return this.memory.get(id) ?? null;
    const result = await pool.query(`${SELECT_TEST_VM} WHERE id = $1`, [id]);
    return (result.rows[0] as TestVmRecord) ?? null;
  }

  async refreshStatus(id: string): Promise<TestVmRecord | null> {
    const record = await this.get(id);
    if (!record?.workflowRunId) return record;
    if (record.status !== 'PROVISIONING' && record.status !== 'DELETING') {
      return record;
    }

    try {
      const run = await this.deps.terraform.runStatus(record.workflowRunId);
      if (run.status === 'completed') {
        const succeeded = run.conclusion === 'success';
        record.status = this.terminalStatus(record.status, succeeded);
        record.statusMessage = succeeded
          ? null
          : `Terraform run finished with conclusion "${run.conclusion}".`;
        if (!succeeded) record.failureReason = record.statusMessage;
        if (record.status === 'DELETED') {
          record.deletedAt = new Date().toISOString();
        }
        record.updatedAt = new Date().toISOString();
        await this.persist(record);
      }
    } catch (error) {
      this.deps.logger.warn(
        `[test-vm] status refresh failed for ${record.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return record;
  }

  private terminalStatus(
    current: TestVmStatus,
    succeeded: boolean,
  ): TestVmStatus {
    if (current === 'DELETING') return succeeded ? 'DELETED' : 'DELETE_FAILED';
    return succeeded ? 'READY' : 'FAILED';
  }

  async remove(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<TestVmRecord> {
    this.ensureTerraformConfigured();
    const record = await this.get(input.id);
    if (!record) throw new TestVmError('Test VM not found', 404);
    if (record.status === 'DELETING' || record.status === 'DELETED') {
      throw new TestVmError(`Test VM is already ${record.status}`, 409);
    }

    try {
      const dispatch = await this.deps.terraform.dispatch({
        requestId: record.id,
        action: 'destroy',
        vmName: record.name,
        tfvarsJson: '',
      });
      if (dispatch.mode !== 'terraform-cloud') {
        throw new TestVmError(
          'Terraform Cloud returned non-production mode; destroy aborted.',
          503,
        );
      }
      record.workflowRunId = dispatch.runId;
      record.workflowRunUrl = dispatch.htmlUrl || null;
      record.status = 'DELETING';
      record.statusMessage = 'Terraform destroy queued.';
    } catch (error) {
      record.status = 'DELETE_FAILED';
      record.failureReason =
        error instanceof Error ? error.message : String(error);
    }

    record.updatedAt = new Date().toISOString();
    await this.persist(record);

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'test-vm.delete',
      targetType: 'test-vm',
      targetId: record.id,
      payload: { name: record.name, status: record.status },
    });

    return record;
  }

  private async persist(record: TestVmRecord): Promise<void> {
    const pool = this.deps.getPool();
    if (!pool) {
      this.memory.set(record.id, { ...record });
      return;
    }
    await pool.query(
      `INSERT INTO control_plane_test_vms (
         id, name, vm_size, region, resource_group, subnet_id, environment,
         owner, terraform_repository, terraform_branch, workflow_run_id,
         workflow_run_url, mode, status, status_message, failure_reason,
         monthly_usd, requested_by, created_at, updated_at, deleted_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
       )
       ON CONFLICT (id) DO UPDATE SET
         workflow_run_id = EXCLUDED.workflow_run_id,
         workflow_run_url = EXCLUDED.workflow_run_url,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         status_message = EXCLUDED.status_message,
         failure_reason = EXCLUDED.failure_reason,
         updated_at = EXCLUDED.updated_at,
         deleted_at = EXCLUDED.deleted_at`,
      [
        record.id,
        record.name,
        record.vmSize,
        record.region,
        record.resourceGroup,
        record.subnetId,
        record.environment,
        record.owner,
        record.terraformRepository,
        record.terraformBranch,
        record.workflowRunId,
        record.workflowRunUrl,
        record.mode,
        record.status,
        record.statusMessage,
        record.failureReason,
        record.monthlyUsd,
        record.requestedBy,
        record.createdAt,
        record.updatedAt,
        record.deletedAt,
      ],
    );
  }
}
