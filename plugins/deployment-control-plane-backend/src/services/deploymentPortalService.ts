import crypto from 'crypto';
import { EventEmitter } from 'events';
import type { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  CreatePortalDeploymentInput,
  DiscoveredCluster,
  PersonaRole,
  PortalDeploymentApplicationOption,
  PortalDeploymentDiffStatusView,
  PortalDeploymentOptions,
  PortalDeploymentRecord,
  PortalDeploymentStatus,
  PortalDeploymentStatusView,
  PortalHelmfilePreview,
  PortalSecretProvisionStatusView,
  PortalSecretReadinessReport,
  PortalSecretFieldType,
  PortalSecretFieldInfo,
  PortalSecretUpdateRequest,
  PortalSecretUpdateResult,
} from '../types';
import { canManageSecretValues } from '../rbac';
import { GitHubActionsService } from './githubActionsService';
import { ScriptsApplicationCatalogService } from './scriptsApplicationCatalogService';
import { ScriptsPipelineDeploymentService } from './scriptsPipelineDeploymentService';
import { calculateIngressTarget } from '@internal/plugin-platform-common/backend';
import {
  appInstanceHelmfilePath,
  deploymentRepository,
  diffWorkflowId,
  diffWorkflowInputs,
  workflowRef,
} from './deploymentPipeline';
import {
  IngressDnsService,
  parseKubeContext,
  type HealthProbeResult,
} from './ingressDnsService';

export interface SecretProvisionProgressEvent {
  step: string;
  status: 'INFO' | 'SUCCESS' | 'FAILED' | 'WARNING';
  detail: string;
  timestamp: string;
}

const ENVIRONMENTS = ['dev', 'qa', 'sandbox', 'test'];
const INSTANCE_NAME_RE = /^[a-z0-9-]+$/;
const CUSTOMER_RE = /^[a-z0-9-]+$/;
const MAX_NAMESPACE_LENGTH = 63;
function isSelfApprovalAllowed(): boolean {
  return process.env.ALLOW_SELF_APPROVAL === 'true';
}

function isSelfRejectionExempt(actorRef: string): boolean {
  const normalizedActor = actorRef
    .trim()
    .toLowerCase()
    .replace(/^user:[^/]+\//, '');
  return normalizedActor === 'jubermohamad@symphonysensa.com';
}

const SELECT_PORTAL = `
  SELECT
    id,
    deployment_name AS "deploymentName",
    application,
    instance_name AS "instanceName",
    customer,
    environment,
    cluster,
    subscription_id AS "subscriptionId",
    resource_group AS "resourceGroup",
    chart_version AS "chartVersion",
    ai_store_integration AS "aiStoreIntegration",
    namespace,
    helmfile_path AS "helmfilePath",
    helmfile_content AS "helmfileContent",
    branch,
    commit_sha AS "commitSha",
    pr_url AS "prUrl",
    workflow_run_id AS "workflowRunId",
    workflow_run_url AS "workflowRunUrl",
    status,
    current_step AS "currentStep",
    status_message AS "statusMessage",
    failure_reason AS "failureReason",
    approved_by AS "approvedBy",
    approved_at AS "approvedAt",
    mode,
    requested_by AS "requestedBy",
    requested_at AS "requestedAt",
    created_by AS "createdBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    started_at AS "startedAt",
    completed_at AS "completedAt",
    workflow_repository AS "workflowRepository",
    workflow_id AS "workflowId",
    workflow_ref AS "workflowRef",
    workflow_inputs AS "workflowInputs",
    dispatch_initiated_at AS "dispatchInitiatedAt",
    workflow_run_attempt AS "workflowRunAttempt",
    workflow_status AS "workflowStatus",
    workflow_conclusion AS "workflowConclusion",
    correlation_status AS "correlationStatus",
    correlation_message AS "correlationMessage",
    correlation_attempts AS "correlationAttempts",
    correlation_deadline AS "correlationDeadline",
    last_log_line AS "lastLogLine",
    instance_status AS "instanceStatus",
    instance_mode AS "instanceMode"
  FROM control_plane_portal_deployments
`;

const SELECT_PORTAL_LEGACY = `
  SELECT
    id,
    deployment_name AS "deploymentName",
    application,
    instance_name AS "instanceName",
    customer,
    environment,
    cluster,
    subscription_id AS "subscriptionId",
    resource_group AS "resourceGroup",
    chart_version AS "chartVersion",
    ai_store_integration AS "aiStoreIntegration",
    namespace,
    helmfile_path AS "helmfilePath",
    helmfile_content AS "helmfileContent",
    branch,
    commit_sha AS "commitSha",
    pr_url AS "prUrl",
    workflow_run_id AS "workflowRunId",
    workflow_run_url AS "workflowRunUrl",
    status,
    current_step AS "currentStep",
    status_message AS "statusMessage",
    failure_reason AS "failureReason",
    approved_by AS "approvedBy",
    approved_at AS "approvedAt",
    mode,
    created_by AS "requestedBy",
    created_at AS "requestedAt",
    created_by AS "createdBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    started_at AS "startedAt",
    completed_at AS "completedAt",
    workflow_repository AS "workflowRepository",
    workflow_id AS "workflowId",
    workflow_ref AS "workflowRef",
    workflow_inputs AS "workflowInputs",
    dispatch_initiated_at AS "dispatchInitiatedAt",
    workflow_run_attempt AS "workflowRunAttempt",
    workflow_status AS "workflowStatus",
    workflow_conclusion AS "workflowConclusion",
    correlation_status AS "correlationStatus",
    correlation_message AS "correlationMessage",
    correlation_attempts AS "correlationAttempts",
    correlation_deadline AS "correlationDeadline",
    last_log_line AS "lastLogLine",
    instance_status AS "instanceStatus",
    instance_mode AS "instanceMode"
  FROM control_plane_portal_deployments
`;

/**
 * Error carrying an HTTP status so the router can map validation failures to
 * 400 and everything else to 500 while surfacing a friendly message.
 */
export class PortalDeploymentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PortalDeploymentError';
    this.status = status;
  }
}

export interface DeploymentPortalDeps {
  logger: LoggerService;
  getPool: () => Pool | null;
  getSriProvisionalPool?: () => Pool | null;
  actions: GitHubActionsService;
  catalog?: ScriptsApplicationCatalogService;
  ingress?: IngressDnsService;
  discoverClusters: (input: {
    subscriptionId?: string;
    resourceGroup?: string;
  }) => Promise<DiscoveredCluster[]>;
  listCustomerCatalog?: () => Promise<{
    vaults: string[];
    customersByVault: Record<string, string[]>;
  }>;
  listCustomerCodes: () => Promise<string[]>;
  audit: (input: {
    actorRef: string;
    role: PersonaRole;
    action: string;
    targetType: string;
    targetId?: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  secretReadiness?: {
    check: (input: {
      application: string;
      instanceName: string;
      customer: string;
      vault?: string;
      clusterName?: string;
      includePipelineRefs?: boolean;
      forceRefresh?: boolean;
    }) => Promise<PortalSecretReadinessReport>;
    provision?: (input: {
      application: string;
      instanceName: string;
      customer: string;
      vault?: string;
      clusterName?: string;
      applicationReleaseVersion?: string;
      actorRef: string;
      role: PersonaRole;
      entityResolutionChartVersion?: string;
      onProgress?: (event: SecretProvisionProgressEvent) => void;
    }) => Promise<PortalSecretProvisionStatusView>;
    bootstrapCustomerStructure?: (input: {
      customer: string;
      vault?: string;
    }) => Promise<{ vault: string; item: string; sections: string[] }>;
    updateSecretFieldValue?: (
      input: PortalSecretUpdateRequest,
    ) => Promise<PortalSecretUpdateResult>;
    syncPipelineRefs?: (input: {
      vault: string;
      itemTitleOrId: string;
      namespace: string;
      helmChartVersion: string;
      overlayRef?: string;
    }) => Promise<void>;
    isConfigured?: () => boolean;
  };
}

export interface PortalAppInstanceCheckResult {
  exists: boolean;
  application: string;
  instanceName: string;
  branch: string;
  path: string;
  message: string;
}

interface PortalDiffRunState {
  deploymentId: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  workflowRepository: string;
  workflowId: string;
  workflowRef: string;
  workflowInputs: Record<string, string>;
  dispatchInitiatedAt: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  currentStep: string;
  statusMessage: string | null;
  failureReason: string | null;
  correlationStatus: 'PENDING' | 'CORRELATED' | 'AMBIGUOUS' | 'FAILED';
  correlationMessage: string | null;
  correlationAttempts: number;
  correlationDeadline: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  jobOffsets: Map<number, number>;
}

/**
 * DeploymentPortalService
 *
 * Orchestrates the self-service deploy flow: validate inputs, persist an
 * auditable request, and hand off approved records to the scripts pipeline.
 */
export class DeploymentPortalService {
  private readonly deps: DeploymentPortalDeps & {
    catalog: ScriptsApplicationCatalogService;
    ingress: IngressDnsService;
  };
  private readonly memory = new Map<string, PortalDeploymentRecord>();
  private readonly memoryEvents = new Map<
    string,
    Array<{
      id: string;
      deploymentId: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actor?: string | null;
      actorRole?: string | null;
      note?: string | null;
      createdAt: string;
    }>
  >();
  private readonly diffRuns = new Map<string, PortalDiffRunState>();
  private readonly secretProvisionRuns = new Map<
    string,
    PortalSecretProvisionStatusView
  >();
  private readonly deploymentEventBus = new EventEmitter();

  constructor(deps: DeploymentPortalDeps) {
    this.deps = {
      ...deps,
      catalog:
        deps.catalog ?? new ScriptsApplicationCatalogService(deps.logger),
      ingress: deps.ingress ?? new IngressDnsService(deps.logger),
    };
  }

  private pool(): Pool | null {
    return this.deps.getPool();
  }

  private async tableHasColumn(
    tableName: string,
    columnName: string,
  ): Promise<boolean> {
    const pool = this.pool();
    if (!pool) {
      return true;
    }

    try {
      const res = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1`,
        [tableName, columnName],
      );
      return (res.rowCount ?? 0) > 0;
    } catch {
      return true;
    }
  }

  private async portalSelectQuery(): Promise<string> {
    const hasRequestedBy = await this.tableHasColumn(
      'control_plane_portal_deployments',
      'requested_by',
    );
    return hasRequestedBy ? SELECT_PORTAL : SELECT_PORTAL_LEGACY;
  }

  private async logEvent(input: {
    deploymentId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    actor?: string | null;
    actorRole?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const pool = this.pool();
    const id = crypto.randomUUID();
    const event = {
      id,
      deploymentId: input.deploymentId,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actor: input.actor ?? null,
      actorRole: input.actorRole ?? null,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    };
    if (!pool) {
      this.appendMemoryEvent(event);
      this.deploymentEventBus.emit(input.deploymentId, event);
      return;
    }
    try {
      await pool.query(
        `
        INSERT INTO deployment_events
          (id, deployment_id, event_type, from_status, to_status, actor, actor_role, note, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          normalizeDbValue(id),
          normalizeDbValue(input.deploymentId),
          normalizeDbValue(input.eventType),
          normalizeDbValue(input.fromStatus ?? null),
          normalizeDbValue(input.toStatus ?? null),
          normalizeDbValue(input.actor ?? null),
          normalizeDbValue(input.actorRole ?? null),
          normalizeDbValue(input.note ?? null),
          normalizeDbValue(
            input.metadata ? JSON.stringify(input.metadata) : null,
          ),
        ],
      );
      this.appendMemoryEvent(event);
      this.deploymentEventBus.emit(input.deploymentId, event);
    } catch (error) {
      this.deps.logger.warn(
        `Failed to log event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.appendMemoryEvent(event);
      this.deploymentEventBus.emit(input.deploymentId, event);
    }
  }

  private appendMemoryEvent(event: {
    id: string;
    deploymentId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    actor?: string | null;
    actorRole?: string | null;
    note?: string | null;
    createdAt: string;
  }): void {
    const entries = this.memoryEvents.get(event.deploymentId) ?? [];
    entries.push(event);
    // Bound memory usage for local/no-db mode and DB write failures.
    if (entries.length > 2000) {
      entries.splice(0, entries.length - 2000);
    }
    this.memoryEvents.set(event.deploymentId, entries);
  }

  onDeploymentEvent(
    deploymentId: string,
    listener: (event: {
      id: string;
      deploymentId: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actor?: string | null;
      actorRole?: string | null;
      note?: string | null;
      createdAt: string;
    }) => void,
  ): () => void {
    this.deploymentEventBus.on(deploymentId, listener);
    return () => {
      this.deploymentEventBus.off(deploymentId, listener);
    };
  }

  private async applicationOptions(): Promise<
    PortalDeploymentApplicationOption[]
  > {
    return this.deps.catalog.listApplications();
  }

  async getOptions(): Promise<PortalDeploymentOptions> {
    let customers: string[] = [];
    let vaults: string[] = [];
    let customersByVault: Record<string, string[]> = {};
    if (this.deps.listCustomerCatalog) {
      const catalog = await this.deps.listCustomerCatalog();
      vaults = catalog.vaults;
      customersByVault = catalog.customersByVault;
      customers = Array.from(
        new Set(Object.values(customersByVault).flat()),
      ).sort((left, right) => left.localeCompare(right));
    } else {
      customers = await this.deps.listCustomerCodes();
    }

    if (vaults.length === 0) {
      throw new PortalDeploymentError(
        'No 1Password vaults are available for deployment. Verify 1Password service account configuration and access.',
        503,
      );
    }

    return {
      applications: await this.applicationOptions(),
      environments: [...ENVIRONMENTS],
      vaults,
      customersByVault,
      customers,
      repository: this.executionRepository(),
      branch: workflowRef(),
    };
  }

  async listInstances(application?: string) {
    return this.deps.catalog.listInstances(application);
  }

  private async validate(
    input: CreatePortalDeploymentInput,
    options: PortalDeploymentOptions,
  ): Promise<PortalDeploymentApplicationOption> {
    const app = options.applications.find(a => a.appName === input.application);
    if (!app) {
      throw new PortalDeploymentError(
        `Application '${input.application}' is not supported for deployment.`,
      );
    }

    const name = (input.instanceName ?? '').trim();
    if (!name) {
      throw new PortalDeploymentError('Instance Name is required.');
    }
    if (name.length > MAX_NAMESPACE_LENGTH) {
      throw new PortalDeploymentError(
        `Instance Name must be ${MAX_NAMESPACE_LENGTH} characters or fewer (Kubernetes namespace limit).`,
      );
    }
    if (!INSTANCE_NAME_RE.test(name)) {
      throw new PortalDeploymentError(
        'Instance Name may only contain lowercase letters, numbers, and hyphens.',
      );
    }

    const customer = (input.customer ?? '').trim();
    if (!customer) {
      throw new PortalDeploymentError('Customer is required.');
    }
    if (!CUSTOMER_RE.test(customer)) {
      throw new PortalDeploymentError(
        'Customer may only contain lowercase letters, numbers, and hyphens.',
      );
    }

    const vault = (input.onePasswordVault ?? '').trim();
    if (!vault && options.vaults.length > 0) {
      throw new PortalDeploymentError('1Password Vault selection is required.');
    }
    if (vault && options.vaults.length > 0 && !options.vaults.includes(vault)) {
      throw new PortalDeploymentError(
        `1Password Vault '${vault}' is not available to the current service account.`,
      );
    }

    const environment = input.environment ?? 'dev';
    if (!options.environments.includes(environment)) {
      throw new PortalDeploymentError(
        `Environment '${environment}' is not valid.`,
      );
    }

    const version = (input.chartVersion ?? '').trim();
    if (version) {
      const isValidVersionFormat =
        /^[vV]?\d+(\.\d+)*(-[a-zA-Z0-9_.-]+)?$/.test(version);
      if (!isValidVersionFormat && !app.chartVersions.includes(version)) {
        throw new PortalDeploymentError(
          `Invalid chart version format: '${input.chartVersion}'.`,
        );
      }
    }

    if (!input.clusterName?.trim()) {
      throw new PortalDeploymentError('Cluster is required.');
    }

    await this.assertClusterExists(input);
    await this.assertInstanceUnique(input.application, name);

    return app;
  }

  private async assertClusterExists(
    input: CreatePortalDeploymentInput,
  ): Promise<void> {
    try {
      let clusters = await this.deps.discoverClusters({
        subscriptionId: input.subscriptionId,
        resourceGroup: input.resourceGroup,
      });
      if (clusters.length === 0 && input.resourceGroup) {
        clusters = await this.deps.discoverClusters({
          subscriptionId: input.subscriptionId,
        });
      }
      if (clusters.length === 0) {
        throw new PortalDeploymentError(
          'The selected target cluster is not registered in the Platform Registry.',
        );
      }
      const clusterName = input.clusterName?.trim() ?? '';
      const found = clusters.some(
        c => c.clusterName.toLowerCase() === clusterName.toLowerCase(),
      );
      if (!found) {
        throw new PortalDeploymentError(
          `Cluster '${input.clusterName}' was not found in the selected subscription and resource group.`,
        );
      }
    } catch (error) {
      if (error instanceof PortalDeploymentError) {
        throw error;
      }
      throw new PortalDeploymentError(
        `Platform Registry validation failed: ${toMessage(error)}`,
        503,
      );
    }
  }

  private async assertInstanceUnique(
    application: string,
    instanceName: string,
  ): Promise<void> {
    const existing = (await this.list()).find(
      record =>
        record.application === application &&
        record.instanceName === instanceName &&
        record.status !== 'FAILED',
    );
    if (existing) {
      throw new PortalDeploymentError(
        `Instance ${instanceName} already exists. A deployment definition already exists under: apps/${application}/${instanceName}`,
        409,
      );
    }
  }

  async previewHelmfile(input: {
    application: string;
    instanceName: string;
    clusterName?: string;
    customer: string;
    chartVersion: string;
    aiStoreIntegration: boolean;
  }): Promise<PortalHelmfilePreview> {
    const inspected = (
      await this.deps.catalog.listInstances(input.application)
    ).find(instance => instance.appInstance === input.instanceName);
    const instanceStatus = inspected ? 'EXISTING' : 'NEW';
    const path =
      inspected?.helmfilePath ??
      `apps/${input.application}/${input.instanceName}/helmfile.yaml`;
    const namespace = inspected?.metadata.namespace ?? input.instanceName;
    const environment = inspected?.metadata.envType || 'dev';
    const content = renderHelmfile({
      application: input.application,
      instanceName: input.instanceName,
      customer: input.customer,
      environment,
      clusterName:
        input.clusterName?.trim() || inspected?.metadata.kubeContext || '',
      chartVersion: input.chartVersion,
      aiStoreIntegration: input.aiStoreIntegration,
      namespace,
      instanceStatus,
    });
    return {
      path,
      namespace,
      content,
      clusterName:
        input.clusterName?.trim() || inspected?.metadata.kubeContext || '',
      environment,
      instanceStatus,
    };
  }

  async create(
    input: CreatePortalDeploymentInput,
  ): Promise<PortalDeploymentRecord> {
    if (input.id) {
      const existing = await this.get(input.id);
      if (existing) {
        const sameRequest =
          existing.application === input.application &&
          existing.instanceName === input.instanceName &&
          existing.cluster === (input.clusterName ?? existing.cluster) &&
          existing.createdBy === input.actorRef;
        if (sameRequest) return existing;
        throw new PortalDeploymentError(
          'Deployment request ID is already in use.',
          409,
        );
      }
    }
    const options = await this.getOptions();
    await this.validate(input, options);

    const now = new Date().toISOString();
    const instanceName = input.instanceName.trim();
    const customer = input.customer.trim();
    const selectedVault =
      input.onePasswordVault?.trim() || options.vaults[0] || '';
    const inspected = (
      await this.deps.catalog.listInstances(input.application)
    ).find(instance => instance.appInstance === instanceName);
    const instanceStatus = inspected ? 'EXISTING' : 'NEW';
    const helmfilePath =
      input.helmfilePath?.trim() ||
      inspected?.helmfilePath ||
      `apps/${input.application}/${instanceName}/helmfile.yaml`;
    let selectedCluster:
      | {
          clusterName: string;
          environment?: string;
          resourceGroup?: string;
          subscriptionId?: string;
        }
      | undefined;
    try {
      const discovered = await this.deps.discoverClusters({
        subscriptionId: input.subscriptionId,
        resourceGroup: input.resourceGroup,
      });
      selectedCluster = discovered.find(
        cluster =>
          cluster.clusterName.toLowerCase() ===
          input.clusterName?.trim().toLowerCase(),
      );
    } catch (error) {
      this.deps.logger.warn(
        `[control-plane] could not resolve selected cluster metadata: ${toMessage(
          error,
        )}`,
      );
    }
    const clusterName = input.clusterName?.trim() || '';
    const environment =
      selectedCluster?.environment?.trim() ||
      inspected?.metadata.envType ||
      'dev';
    const namespace = inspected?.metadata.namespace ?? instanceName;
    const helmfileContent =
      input.helmfileContent?.trim() ||
      renderHelmfile({
        application: input.application,
        instanceName,
        customer,
        environment,
        clusterName,
        chartVersion: input.chartVersion,
        aiStoreIntegration: input.aiStoreIntegration,
        namespace,
        instanceStatus,
      });

    const record: PortalDeploymentRecord = {
      id: input.id ?? crypto.randomUUID(),
      deploymentName: `${input.application}-${instanceName}`,
      application: input.application,
      instanceName,
      customer,
      environment,
      cluster: clusterName,
      subscriptionId:
        selectedCluster?.subscriptionId ?? input.subscriptionId ?? '',
      resourceGroup:
        selectedCluster?.resourceGroup ?? input.resourceGroup ?? '',
      chartVersion: input.chartVersion,
      aiStoreIntegration: input.aiStoreIntegration,
      namespace,
      helmfilePath,
      helmfileContent,
      branch: process.env.SYMPHONYFS_WORKFLOW_REF?.trim() || 'main',
      commitSha: null,
      prUrl: null,
      workflowRunId: null,
      workflowRunUrl: null,
      status: 'PENDING',
      currentStep: 'Configuration saved',
      statusMessage: null,
      failureReason: null,
      approvedBy: null,
      approvedAt: null,
      decidedBy: null,
      decidedAt: null,
      mode: 'github-api',
      requestedBy: input.actorRef,
      requestedAt: now,
      createdBy: input.actorRef,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      workflowRepository: null,
      workflowId: null,
      workflowRef: null,
      workflowInputs: selectedVault ? { onePasswordVault: selectedVault } : {},
      dispatchInitiatedAt: null,
      workflowRunAttempt: null,
      workflowStatus: null,
      workflowConclusion: null,
      correlationStatus: 'PENDING',
      correlationMessage: null,
      correlationAttempts: 0,
      correlationDeadline: null,
      lastLogLine: 0,
      configureSkupper: input.configureSkupper,
      triggerFailover: input.triggerFailover,
      actionValidation: input.actionValidation,
      acceptance: input.acceptance,
      instanceMode: input.instanceMode ?? 'auto',
      instanceStatus,
    };

    // Pipeline refs (helm_chart_version, etc.) must exist in 1Password
    // before Run Diff can dispatch — helmfile resolves ref+op://.../pipeline_refs
    // at diff time, not just at apply time, and Run Diff always happens on an
    // already-created record (its route takes the deployment id as a path
    // param). Sync here, before the record is persisted, so a failed write
    // fails deployment creation outright instead of silently leaving Run
    // Diff to fail later with a confusing "missing secret reference" error.
    // approve() also calls this — that's an intentional, idempotent
    // re-verification immediately before dispatching apply, not the primary
    // write path.
    await this.syncPipelineRefs(record);

    await this.persistInsert(record);

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'requested',
      toStatus: record.status,
      actor: input.actorRef,
      actorRole: input.role,
      note: `Deployment configuration saved for ${record.application} instance ${record.instanceName}`,
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'portal-deployment-requested',
      targetType: 'portal-deployment',
      targetId: record.id,
      payload: {
        application: record.application,
        instanceName: record.instanceName,
        customer: record.customer,
        vault: record.workflowInputs?.onePasswordVault ?? null,
        environment: record.environment,
        cluster: record.cluster,
        helmfilePath: record.helmfilePath,
        commitSha: record.commitSha,
        workflowRunId: record.workflowRunId,
        mode: record.mode,
      },
    });

    return record;
  }

  async submitForApproval(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }

    if (record.status === 'PENDING_APPROVAL') {
      return record;
    }

    if (record.status !== 'PENDING') {
      throw new PortalDeploymentError(
        `Only saved deployments can be submitted for approval; current status is ${record.status.toLowerCase()}.`,
        409,
      );
    }

    const now = new Date().toISOString();
    const fromStatus = record.status;
    record.status = 'PENDING_APPROVAL';
    record.currentStep = 'Awaiting CloudHub approval';
    record.statusMessage = input.note ?? null;
    record.updatedAt = now;

    const updated = await this.persistApprovalUpdate(record);
    if (!updated) {
      throw new PortalDeploymentError(
        'Deployment was already submitted, approved, or rejected by another user.',
        409,
      );
    }

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'submitted-for-approval',
      fromStatus,
      toStatus: record.status,
      actor: input.actorRef,
      actorRole: input.role,
      note:
        input.note ??
        `Deployment submitted for approval for ${record.application} instance ${record.instanceName}`,
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'portal-deployment-submitted-for-approval',
      targetType: 'portal-deployment',
      targetId: record.id,
      payload: {
        application: record.application,
        instanceName: record.instanceName,
        customer: record.customer,
        environment: record.environment,
        cluster: record.cluster,
      },
    });

    return record;
  }

  async approve(input: {
    id: string;
    approverRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }
    if (record.status !== 'PENDING' && record.status !== 'PENDING_APPROVAL') {
      throw new PortalDeploymentError(
        `Deployment already ${record.status.toLowerCase()}.`,
        409,
      );
    }
    if (!isSelfApprovalAllowed() && record.createdBy === input.approverRef) {
      throw new PortalDeploymentError(
        'Requesters cannot approve their own deployments.',
        403,
      );
    }

    await this.syncPipelineRefs(record);
    await this.assertAppInstanceExists(record);

    await this.assertSecretsReady(record);

    const now = new Date().toISOString();
    record.approvedBy = input.approverRef;
    record.approvedAt = now;
    record.decidedBy = input.approverRef;
    record.decidedAt = now;
    record.status = 'APPROVED';
    record.currentStep = 'Approval granted; dispatching deployment';
    record.statusMessage = input.note ?? null;
    record.updatedAt = now;

    const updated = await this.persistApprovalUpdate(record);
    if (!updated) {
      throw new PortalDeploymentError(
        'Deployment was already approved or rejected by another admin.',
        409,
      );
    }

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'approved',
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'APPROVED',
      actor: input.approverRef,
      actorRole: input.role,
      note: input.note,
    });

    await this.deps.audit({
      actorRef: input.approverRef,
      role: input.role,
      action: 'portal-deployment-approved',
      targetType: 'portal-deployment',
      targetId: record.id,
      payload: {
        application: record.application,
        instanceName: record.instanceName,
        requestedBy: record.createdBy,
        note: input.note ?? null,
      },
    });

    try {
      await this.orchestrate(record);
    } catch (error) {
      record.status = 'FAILED';
      record.currentStep = 'Failed';
      record.failureReason = toMessage(error);
      record.statusMessage = toMessage(error);
      record.completedAt = new Date().toISOString();
      record.updatedAt = record.completedAt;
      await this.persistUpdate(record);
      throw error instanceof PortalDeploymentError
        ? error
        : new PortalDeploymentError(toMessage(error), 500);
    }

    return record;
  }

  async reject(input: {
    id: string;
    approverRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }
    if (record.status !== 'PENDING' && record.status !== 'PENDING_APPROVAL') {
      throw new PortalDeploymentError(
        `Deployment already ${record.status.toLowerCase()}.`,
        409,
      );
    }
    if (
      !isSelfApprovalAllowed() &&
      !isSelfRejectionExempt(input.approverRef) &&
      record.createdBy === input.approverRef
    ) {
      throw new PortalDeploymentError(
        'Requesters cannot reject their own deployments.',
        403,
      );
    }

    const now = new Date().toISOString();
    record.approvedBy = input.approverRef;
    record.approvedAt = now;
    record.decidedBy = input.approverRef;
    record.decidedAt = now;
    record.status = 'REJECTED';
    record.currentStep = 'Rejected';
    record.failureReason = input.note ?? 'Deployment rejected by approver.';
    record.statusMessage = record.failureReason;
    record.completedAt = now;
    record.updatedAt = now;

    const updated = await this.persistApprovalUpdate(record);
    if (!updated) {
      throw new PortalDeploymentError(
        'Deployment was already approved or rejected by another admin.',
        409,
      );
    }

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'rejected',
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'REJECTED',
      actor: input.approverRef,
      actorRole: input.role,
      note: input.note,
    });

    await this.deps.audit({
      actorRef: input.approverRef,
      role: input.role,
      action: 'portal-deployment-rejected',
      targetType: 'portal-deployment',
      targetId: record.id,
      payload: {
        application: record.application,
        instanceName: record.instanceName,
        requestedBy: record.createdBy,
        note: input.note ?? null,
      },
    });

    return record;
  }

  async syncWorkflowRun(input: {
    workflowRunId: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null;
    htmlUrl?: string | null;
  }): Promise<PortalDeploymentRecord | null> {
    const record = await this.getByWorkflowRunId(input.workflowRunId);
    if (!record) {
      return null;
    }

    const previousStatus = record.status;
    applyRunStatus(record, input.status, input.conclusion);
    if (input.htmlUrl) {
      record.workflowRunUrl = input.htmlUrl;
    }
    record.updatedAt = new Date().toISOString();
    await this.persistUpdate(record);

    if (previousStatus !== record.status) {
      await this.logEvent({
        deploymentId: record.id,
        eventType: 'workflow_status_changed',
        fromStatus: previousStatus,
        toStatus: record.status,
        note: `Workflow run ${input.workflowRunId} status: ${input.status}${
          input.conclusion ? ` (${input.conclusion})` : ''
        }`,
        metadata: {
          workflowStatus: input.status,
          conclusion: input.conclusion,
        },
      });
    }

    return record;
  }

  private executionRepository(): string {
    try {
      return deploymentRepository();
    } catch (error) {
      throw new PortalDeploymentError(toMessage(error), 503);
    }
  }

  async runDiff(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentDiffStatusView> {
    const record = await this.get(input.id);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }

    if (record.status !== 'PENDING' && record.status !== 'PENDING_APPROVAL') {
      throw new PortalDeploymentError(
        `Run Diff is only available before deployment approval; current status is ${record.status.toLowerCase()}.`,
        409,
      );
    }

    const existing = this.diffRuns.get(record.id);
    if (existing && existing.status !== 'completed') {
      return toDiffStatusView(existing);
    }

    // Diff must render the chart version being deployed, not whatever an
    // earlier deploy left in pipeline_refs.
    await this.syncPipelineRefs(record);
    await this.assertSecretsReady(record);

    const repository = this.executionRepository();
    const workflowId = diffWorkflowId();
    const ref = workflowRef();
    const workflowInputs = diffWorkflowInputs(record);
    const dispatchInitiatedAt = new Date().toISOString();

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'diff-dispatching',
      note:
        input.note ??
        'Run Diff requested; dispatching workflow in actionValidation mode.',
      actor: input.actorRef,
      actorRole: input.role,
      metadata: {
        repository,
        workflowId,
        workflowRef: ref,
        workflowInputs,
      },
    });

    const dispatch = await this.deps.actions.dispatch({
      serviceId: record.application,
      repository,
      workflowId,
      ref,
      inputs: workflowInputs,
    });

    const now = new Date().toISOString();
    const state: PortalDiffRunState = {
      deploymentId: record.id,
      workflowRunId: dispatch.runId || null,
      workflowRunUrl: dispatch.htmlUrl || null,
      workflowRepository: repository,
      workflowId,
      workflowRef: ref,
      workflowInputs: dispatch.inputs ?? workflowInputs,
      dispatchInitiatedAt,
      status: dispatch.status,
      conclusion: dispatch.conclusion,
      currentStep: 'Workflow queued',
      statusMessage: 'Diff workflow dispatched.',
      failureReason: null,
      correlationStatus: dispatch.runId ? 'CORRELATED' : 'PENDING',
      correlationMessage: dispatch.runId
        ? 'Workflow run correlated after dispatch.'
        : 'Workflow dispatched; waiting for an unambiguous run to appear.',
      correlationAttempts: 1,
      correlationDeadline: new Date(Date.now() + 5 * 60_000).toISOString(),
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      jobOffsets: new Map<number, number>(),
    };
    applyDiffRunStatus(state, dispatch.status, dispatch.conclusion);
    this.diffRuns.set(record.id, state);

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'diff-dispatched',
      note: state.statusMessage,
      actor: input.actorRef,
      actorRole: input.role,
      metadata: {
        repository: dispatch.repository,
        workflow: dispatch.workflowId,
        ref: dispatch.ref,
        workflowRunId: state.workflowRunId,
        status: state.status,
        conclusion: state.conclusion,
      },
    });

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'portal-deployment-diff-started',
      targetType: 'portal-deployment',
      targetId: record.id,
      payload: {
        application: record.application,
        instanceName: record.instanceName,
        workflowRunId: state.workflowRunId,
        status: state.status,
      },
    });

    return toDiffStatusView(state);
  }

  async getDiffStatus(
    deploymentId: string,
  ): Promise<PortalDeploymentDiffStatusView | null> {
    const state = this.diffRuns.get(deploymentId);
    if (!state) {
      return null;
    }

    try {
      await this.reconcileDiffState(state);
    } catch (error) {
      this.deps.logger.warn(
        `[control-plane] diff status refresh failed for ${deploymentId}: ${toMessage(
          error,
        )}`,
      );
      state.updatedAt = new Date().toISOString();
      state.statusMessage = `Diff status refresh failed: ${toMessage(error)}`;
    }

    return toDiffStatusView(state);
  }

  private async reconcileDiffState(state: PortalDiffRunState): Promise<void> {
    if (!state.workflowRunId) {
      const deadline = Date.parse(state.correlationDeadline);
      if (Date.now() > deadline) {
        state.correlationStatus = 'FAILED';
        state.correlationMessage =
          'Workflow dispatch succeeded, but no matching workflow run appeared before the correlation deadline.';
        applyDiffRunStatus(state, 'completed', 'failure');
        state.failureReason = state.correlationMessage;
        state.statusMessage = state.correlationMessage;
        state.updatedAt = new Date().toISOString();
        await this.logEvent({
          deploymentId: state.deploymentId,
          eventType: 'diff-correlation-failed',
          note: state.correlationMessage,
          metadata: {
            correlationAttempts: state.correlationAttempts,
          },
        });
        return;
      }

      state.correlationAttempts += 1;
      const correlation = await this.deps.actions.findWorkflowRun({
        repository: state.workflowRepository,
        workflowId: state.workflowId,
        ref: state.workflowRef,
        inputs: state.workflowInputs,
        dispatchInitiatedAt: state.dispatchInitiatedAt,
      });
      state.correlationStatus =
        correlation.status === 'ambiguous'
          ? 'AMBIGUOUS'
          : correlation.status === 'correlated'
          ? 'CORRELATED'
          : 'PENDING';
      state.correlationMessage = correlation.message ?? null;
      state.updatedAt = new Date().toISOString();

      if (correlation.run) {
        state.workflowRunId = correlation.run.id;
        state.workflowRunUrl = correlation.run.htmlUrl;
        applyDiffRunStatus(
          state,
          correlation.run.status,
          correlation.run.conclusion,
        );
        await this.logEvent({
          deploymentId: state.deploymentId,
          eventType: 'diff-correlated',
          note: `Diff workflow run ${state.workflowRunId} is now correlated.`,
          metadata: {
            workflowRunId: state.workflowRunId,
            status: state.status,
            conclusion: state.conclusion,
          },
        });
      }
    }

    if (!state.workflowRunId) {
      return;
    }

    const previousStatus = state.status;
    const previousConclusion = state.conclusion;

    const runStatus = await this.deps.actions.runStatus(
      state.workflowRunId,
      state.workflowRepository,
    );
    if (runStatus.htmlUrl) {
      state.workflowRunUrl = runStatus.htmlUrl;
    }
    applyDiffRunStatus(state, runStatus.status, runStatus.conclusion);
    state.updatedAt = new Date().toISOString();

    await this.persistDiffLogs(state);

    if (
      previousStatus !== state.status ||
      previousConclusion !== state.conclusion
    ) {
      await this.logEvent({
        deploymentId: state.deploymentId,
        eventType:
          state.status === 'completed' ? 'diff-completed' : 'diff-status',
        note:
          state.status === 'completed'
            ? `Diff workflow completed with conclusion: ${
                state.conclusion ?? 'unknown'
              }.`
            : `Diff workflow is ${state.status.replace('_', ' ')}.`,
        metadata: {
          workflowRunId: state.workflowRunId,
          status: state.status,
          conclusion: state.conclusion,
        },
      });
    }
  }

  private async persistDiffLogs(state: PortalDiffRunState): Promise<void> {
    if (!state.workflowRunId) {
      return;
    }

    const logs = await this.deps.actions.runLogs(
      state.workflowRunId,
      state.workflowRepository,
    );
    for (const job of logs.jobLines) {
      let offset = state.jobOffsets.get(job.jobId) ?? 0;
      if (offset > job.lines.length) {
        offset = 0;
      }

      const newLines = job.lines.slice(offset);
      for (const line of newLines) {
        await this.logEvent({
          deploymentId: state.deploymentId,
          eventType: 'diff-log',
          note: line,
          metadata: {
            workflowRunId: state.workflowRunId,
            githubJobId: job.jobId,
            githubJobName: job.jobName,
          },
        });
      }

      if (newLines.length > 0) {
        state.jobOffsets.set(job.jobId, offset + newLines.length);
      }
    }
  }

  /**
   * Orchestrate the deployment using the configured backend.
   *
   * This method:
   * Dispatches the approved deployment through the single scripts pipeline
   * adapter.
   */
  private async orchestrate(record: PortalDeploymentRecord): Promise<void> {
    await this.provisionIngressDns(record);
    const backend = new ScriptsPipelineDeploymentService({
      logger: this.deps.logger,
      actions: this.deps.actions,
      persistUpdate: updatedRecord => this.persistUpdate(updatedRecord),
      appendEvent: event => this.logEvent(event),
    });
    await backend.dispatch(record);
  }

  /**
   * Pre-flight DNS gate: the A record must exist before helmfile apply so
   * cert-manager and the ingress bind on first reconcile. The target cluster
   * is the instance helmfile's kubeContext (what the workflow deploys to),
   * falling back to the cluster picked in the wizard.
   */
  private async provisionIngressDns(
    record: PortalDeploymentRecord,
  ): Promise<void> {
    const target = ingressTargetFor(record);
    if (!target) {
      await this.logEvent({
        deploymentId: record.id,
        eventType: 'dns-skipped',
        note: 'Ingress hostname could not be derived from application, customer and instance; DNS was not provisioned.',
      });
      return;
    }

    let kubeContext: string | null = null;
    if (this.deps.ingress.isConfigured()) {
      try {
        const helmfile = await this.deps.actions.readRepositoryFile(
          appInstanceHelmfilePath(record.application, record.instanceName),
          record.branch || workflowRef(),
          this.executionRepository(),
        );
        kubeContext = helmfile ? parseKubeContext(helmfile) : null;
      } catch (error) {
        this.deps.logger.warn(
          `[control-plane] could not read kubeContext for ${
            record.application
          }/${record.instanceName}: ${toMessage(error)}`,
        );
      }
      record.currentStep = `Provisioning DNS for ${target.fqdn}`;
      record.updatedAt = new Date().toISOString();
      await this.persistUpdate(record);
    }

    const result = await this.deps.ingress.ensureARecord({
      target,
      clusterNames: [kubeContext, record.cluster],
    });
    await this.logEvent({
      deploymentId: record.id,
      eventType:
        result.status === 'SKIPPED' ? 'dns-skipped' : 'dns-provisioned',
      note: result.message,
      metadata: {
        fqdn: result.fqdn,
        ip: result.ip,
        action: result.status,
        propagated: result.propagated,
        kubeContext,
      },
    });
  }

  /**
   * One health probe round against the deployed instance's canonical URL.
   * The client polls this (every 5s) after the workflow succeeds.
   */
  async checkApplicationHealth(id: string): Promise<HealthProbeResult> {
    const record = await this.get(id);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }
    if (record.status !== 'SUCCEEDED') {
      throw new PortalDeploymentError(
        `Health checks run after the deployment succeeds; current status is ${record.status.toLowerCase()}.`,
        409,
      );
    }
    const target = ingressTargetFor(record);
    if (!target) {
      throw new PortalDeploymentError(
        'Ingress URL could not be derived for this deployment.',
        422,
      );
    }
    return this.deps.ingress.probeHealth(target);
  }

  async list(): Promise<PortalDeploymentRecord[]> {
    const pool = this.pool();
    if (pool) {
      const selectQuery = await this.portalSelectQuery();
      const res = await pool.query(`${selectQuery} ORDER BY created_at DESC`);
      return res.rows.map(mapRow);
    }
    return Array.from(this.memory.values())
      .map(record => ({ ...record }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reconcileNonTerminalDeployments(): Promise<void> {
    const records = (await this.list()).filter(
      record => !['SUCCEEDED', 'FAILED', 'REJECTED'].includes(record.status),
    );
    for (const record of records) {
      if (!record.workflowRunId) {
        await this.reconcileMissingRun(record);
        continue;
      }
      try {
        await this.getStatus(record.id);
      } catch (error) {
        this.deps.logger.warn(
          `[control-plane] deployment reconciliation failed for ${
            record.id
          }: ${toMessage(error)}`,
        );
      }
    }
  }

  private async reconcileMissingRun(
    record: PortalDeploymentRecord,
  ): Promise<void> {
    if (
      !record.workflowRepository ||
      !record.workflowId ||
      !record.workflowRef ||
      !record.dispatchInitiatedAt
    )
      return;
    const deadline = record.correlationDeadline
      ? Date.parse(record.correlationDeadline)
      : Date.now();
    if (Date.now() > deadline) {
      record.status = 'FAILED';
      record.currentStep = 'Workflow run correlation expired';
      record.failureReason =
        'GitHub dispatch succeeded, but no unambiguous workflow run appeared before the correlation deadline.';
      record.correlationStatus = 'FAILED';
      record.correlationMessage = record.failureReason;
      record.completedAt = new Date().toISOString();
      record.updatedAt = record.completedAt;
      await this.persistUpdate(record);
      await this.logEvent({
        deploymentId: record.id,
        eventType: 'correlation-failed',
        toStatus: record.status,
        note: record.failureReason,
      });
      return;
    }
    record.correlationAttempts += 1;
    const result = await this.deps.actions.findWorkflowRun({
      repository: record.workflowRepository,
      workflowId: record.workflowId,
      ref: record.workflowRef,
      inputs: record.workflowInputs,
      dispatchInitiatedAt: record.dispatchInitiatedAt,
    });
    record.correlationStatus =
      result.status === 'ambiguous'
        ? 'AMBIGUOUS'
        : result.status === 'correlated'
        ? 'CORRELATED'
        : 'PENDING';
    record.correlationMessage = result.message ?? null;
    if (result.run) {
      record.workflowRunId = result.run.id;
      record.workflowRunUrl = result.run.htmlUrl;
      record.workflowRunAttempt = result.run.attempt ?? null;
      record.workflowStatus = result.run.status;
      record.workflowConclusion = result.run.conclusion;
      record.status =
        result.run.status === 'in_progress'
          ? 'DEPLOYING'
          : result.run.status === 'completed'
          ? 'SUCCEEDED'
          : 'QUEUED';
    }
    record.updatedAt = new Date().toISOString();
    await this.persistUpdate(record);
  }

  async get(id: string): Promise<PortalDeploymentRecord | null> {
    const pool = this.pool();
    if (pool) {
      const selectQuery = await this.portalSelectQuery();
      const res = await pool.query(`${selectQuery} WHERE id = $1`, [id]);
      return res.rows.length ? mapRow(res.rows[0]) : null;
    }
    // Must be a copy: callers mutate the record before the approval
    // compare-and-set re-reads the stored status.
    const record = this.memory.get(id);
    return record ? { ...record } : null;
  }

  async getStatus(id: string): Promise<PortalDeploymentStatusView | null> {
    const record = await this.get(id);
    if (!record) return null;

    const terminal =
      record.status === 'SUCCEEDED' ||
      record.status === 'FAILED' ||
      record.status === 'REJECTED';
    if (terminal) {
      return toStatusView(record);
    }
    if (!record.workflowRunId) {
      await this.reconcileMissingRun(record);
      return toStatusView(record);
    }

    try {
      const runStatus = await this.deps.actions.runStatus(
        record.workflowRunId,
        record.workflowRepository ?? undefined,
      );
      applyRunStatus(record, runStatus.status, runStatus.conclusion);
      record.workflowStatus = runStatus.status;
      record.workflowConclusion = runStatus.conclusion;
      if (runStatus.htmlUrl) {
        record.workflowRunUrl = runStatus.htmlUrl;
      }
      record.updatedAt = new Date().toISOString();
      await this.persistUpdate(record);
      await this.persistJobs(record, runStatus.jobs ?? []);
      await this.persistIncrementalLogs(record);
    } catch (error) {
      this.deps.logger.warn(
        `[control-plane] deployment portal status sync failed for ${id}: ${toMessage(
          error,
        )}`,
      );
    }

    return toStatusView(record);
  }

  private async persistJobs(
    record: PortalDeploymentRecord,
    jobs: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    }>,
  ): Promise<void> {
    const pool = this.pool();
    if (!pool) return;
    for (const job of jobs) {
      await pool.query(
        `
        INSERT INTO control_plane_deployment_jobs
          (deployment_id, github_job_id, job_name, status, conclusion, started_at, completed_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (deployment_id, github_job_id) DO UPDATE SET
          job_name = EXCLUDED.job_name, status = EXCLUDED.status,
          conclusion = EXCLUDED.conclusion, started_at = EXCLUDED.started_at,
          completed_at = EXCLUDED.completed_at, updated_at = NOW()
        `,
        [
          record.id,
          job.id,
          job.name,
          job.status,
          job.conclusion,
          job.startedAt ?? null,
          job.completedAt ?? null,
        ],
      );
    }
  }

  private async persistIncrementalLogs(
    record: PortalDeploymentRecord,
  ): Promise<void> {
    if (!record.workflowRunId || record.workflowRunId.startsWith('sim-'))
      return;
    const logs = await this.deps.actions.runLogs(
      record.workflowRunId,
      record.workflowRepository ?? undefined,
    );
    const pool = this.pool();
    if (!pool) return;
    for (const job of logs.jobLines) {
      const offsetResult = await pool.query(
        'SELECT last_log_line FROM control_plane_deployment_jobs WHERE deployment_id = $1 AND github_job_id = $2',
        [record.id, job.jobId],
      );
      let offset = Number(offsetResult.rows[0]?.last_log_line ?? 0);
      if (offset > job.lines.length) {
        offset = 0;
      }
      const newLines = job.lines.slice(offset);
      for (const line of newLines) {
        await this.logEvent({
          deploymentId: record.id,
          eventType: 'github-log',
          note: line,
          metadata: {
            workflowRunId: record.workflowRunId,
            githubJobId: job.jobId,
          },
        });
      }
      if (newLines.length > 0) {
        await pool.query(
          'UPDATE control_plane_deployment_jobs SET last_log_line = $3, updated_at = NOW() WHERE deployment_id = $1 AND github_job_id = $2',
          [record.id, job.jobId, offset + newLines.length],
        );
      }
    }
  }

  async getDeploymentEvents(deploymentId: string): Promise<
    Array<{
      id: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actor?: string | null;
      actorRole?: string | null;
      note?: string | null;
      createdAt: string;
    }>
  > {
    const pool = this.pool();
    if (!pool) {
      return [...(this.memoryEvents.get(deploymentId) ?? [])];
    }
    try {
      const res = await pool.query(
        `
        SELECT
          id, event_type AS "eventType", from_status AS "fromStatus",
          to_status AS "toStatus", actor, actor_role AS "actorRole",
          note, created_at AS "createdAt"
        FROM deployment_events
        WHERE deployment_id = $1
        ORDER BY created_at ASC
        `,
        [deploymentId],
      );
      return res.rows;
    } catch (error) {
      this.deps.logger.warn(
        `[control-plane] failed to read deployment events from DB for ${deploymentId}: ${toMessage(
          error,
        )}`,
      );
      return [...(this.memoryEvents.get(deploymentId) ?? [])];
    }
  }

  async retry(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<PortalDeploymentRecord> {
    const record = await this.get(input.id);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }
    if (record.status !== 'FAILED' || !record.approvedBy) {
      throw new PortalDeploymentError(
        'Only a previously approved failed deployment can be retried.',
        409,
      );
    }

    await this.assertSecretsReady(record);

    const previousStatus = record.status;
    record.status = 'APPROVED';
    record.currentStep = 'Retrying deployment';
    record.failureReason = null;
    record.statusMessage = null;
    record.completedAt = null;
    record.startedAt = new Date().toISOString();
    record.updatedAt = record.startedAt;
    await this.persistUpdate(record);

    await this.logEvent({
      deploymentId: record.id,
      eventType: 'retried',
      fromStatus: previousStatus,
      toStatus: 'VALIDATING',
      actor: input.actorRef,
      actorRole: input.role,
      note: 'Deployment retry initiated',
    });

    try {
      await this.orchestrate(record);
    } catch (error) {
      record.status = 'FAILED';
      record.currentStep = 'Failed';
      record.failureReason = toMessage(error);
      record.statusMessage = toMessage(error);
      record.completedAt = new Date().toISOString();
      record.updatedAt = record.completedAt;
      await this.persistUpdate(record);
      throw error instanceof PortalDeploymentError
        ? error
        : new PortalDeploymentError(toMessage(error), 500);
    }

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'portal-deployment-retried',
      targetType: 'portal-deployment',
      targetId: record.id,
      payload: {
        application: record.application,
        instanceName: record.instanceName,
        workflowRunId: record.workflowRunId,
      },
    });

    return record;
  }

  async updateDeploymentStatusFromWebhook(input: {
    deploymentId: string;
    provisionerStatus: string;
    message: string | null;
  }): Promise<void> {
    const record = await this.get(input.deploymentId);
    if (!record) {
      throw new PortalDeploymentError('Deployment not found.', 404);
    }

    const previousStatus = record.status;
    let newStatus: PortalDeploymentStatus = record.status;
    let currentStep = record.currentStep;
    let statusMessage = input.message;

    switch (input.provisionerStatus.toLowerCase()) {
      case 'running':
      case 'in_progress':
        newStatus = 'DEPLOYING';
        currentStep = 'Provisioner is deploying component';
        statusMessage = input.message || 'Deployment in progress';
        break;
      case 'succeeded':
      case 'completed':
        newStatus = 'SUCCEEDED';
        currentStep = 'Deployment completed successfully';
        statusMessage = input.message || 'Provisioner deployment completed';
        break;
      case 'failed':
        newStatus = 'FAILED';
        currentStep = 'Provisioner deployment failed';
        statusMessage = input.message || 'Provisioner deployment failed';
        break;
      case 'pending':
        newStatus = 'QUEUED';
        currentStep = 'Awaiting provisioner execution';
        statusMessage = input.message || 'Queued for provisioning';
        break;
      default:
        return; // No status change
    }

    record.status = newStatus;
    record.currentStep = currentStep;
    record.statusMessage = statusMessage;
    record.updatedAt = new Date().toISOString();

    if (newStatus === 'SUCCEEDED' || newStatus === 'FAILED') {
      record.completedAt = record.updatedAt;
    }

    await this.persistUpdate(record);

    await this.logEvent({
      deploymentId: input.deploymentId,
      eventType: 'provisioner-status',
      fromStatus: previousStatus,
      toStatus: newStatus,
      note: `Provisioner status: ${input.provisionerStatus}. ${
        statusMessage || ''
      }`,
      metadata: { provisionerStatus: input.provisionerStatus },
    });
  }

  private async persistInsert(record: PortalDeploymentRecord): Promise<void> {
    const pool = this.pool();
    if (!pool) {
      this.memory.set(record.id, { ...record });
      return;
    }
    const hasRequestedBy = await this.tableHasColumn(
      'control_plane_portal_deployments',
      'requested_by',
    );
    if (hasRequestedBy) {
      await pool.query(
        `
        INSERT INTO control_plane_portal_deployments (
          id, deployment_name, application, instance_name, customer, environment,
          cluster, subscription_id, resource_group, chart_version,
          ai_store_integration, namespace, helmfile_path, helmfile_content,
          branch, commit_sha, pr_url, workflow_run_id, workflow_run_url, status,
          current_step, status_message, failure_reason, approved_by, approved_at,
          mode, requested_by, requested_at, created_by, created_at, updated_at,
          started_at, completed_at, sri_deploy_source, backend_source,
          workflow_repository, workflow_id, workflow_ref, workflow_inputs,
          dispatch_initiated_at, workflow_run_attempt, workflow_status,
          workflow_conclusion, correlation_status, correlation_message,
          correlation_attempts, correlation_deadline, last_log_line, instance_status, instance_mode
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50
        )
        `,
        portalInsertParams(record),
      );
      return;
    }

    await pool.query(
      `
      INSERT INTO control_plane_portal_deployments (
        id, deployment_name, application, instance_name, customer, environment,
        cluster, subscription_id, resource_group, chart_version,
        ai_store_integration, namespace, helmfile_path, helmfile_content,
        branch, commit_sha, pr_url, workflow_run_id, workflow_run_url, status,
        current_step, status_message, failure_reason, approved_by, approved_at,
        mode, created_by, created_at, updated_at,
        started_at, completed_at, sri_deploy_source, backend_source,
        workflow_repository, workflow_id, workflow_ref, workflow_inputs,
        dispatch_initiated_at, workflow_run_attempt, workflow_status,
        workflow_conclusion, correlation_status, correlation_message,
        correlation_attempts, correlation_deadline, last_log_line, instance_status, instance_mode
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
        $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49
      )
      `,
      portalInsertParamsLegacy(record),
    );
  }

  private async persistUpdate(record: PortalDeploymentRecord): Promise<void> {
    const pool = this.pool();
    if (!pool) {
      this.memory.set(record.id, { ...record });
      return;
    }
    await pool.query(
      `
      UPDATE control_plane_portal_deployments SET
        commit_sha = $2, pr_url = $3, workflow_run_id = $4,
        workflow_run_url = $5, status = $6, current_step = $7,
        status_message = $8, failure_reason = $9, approved_by = $10,
        approved_at = $11, mode = $12, updated_at = $13, started_at = $14,
        completed_at = $15, workflow_repository = $16, workflow_id = $17,
        workflow_ref = $18, workflow_inputs = $19, dispatch_initiated_at = $20,
        workflow_run_attempt = $21, workflow_status = $22,
        workflow_conclusion = $23, correlation_status = $24,
        correlation_message = $25, correlation_attempts = $26,
        correlation_deadline = $27, last_log_line = $28, instance_status = $29, instance_mode = $30
      WHERE id = $1
      `,
      portalUpdateParams(record),
    );
  }

  private async persistApprovalUpdate(
    record: PortalDeploymentRecord,
  ): Promise<boolean> {
    const pool = this.pool();
    if (!pool) {
      const existing = this.memory.get(record.id);
      if (
        existing?.status !== 'PENDING' &&
        existing?.status !== 'PENDING_APPROVAL'
      ) {
        return false;
      }
      this.memory.set(record.id, { ...record });
      return true;
    }
    const res = await pool.query(
      `
      UPDATE control_plane_portal_deployments SET
        commit_sha = $2, pr_url = $3, workflow_run_id = $4,
        workflow_run_url = $5, status = $6, current_step = $7,
        status_message = $8, failure_reason = $9, approved_by = $10,
        approved_at = $11, mode = $12, updated_at = $13, started_at = $14,
        completed_at = $15, workflow_repository = $16, workflow_id = $17,
        workflow_ref = $18, workflow_inputs = $19, dispatch_initiated_at = $20,
        workflow_run_attempt = $21, workflow_status = $22,
        workflow_conclusion = $23, correlation_status = $24,
        correlation_message = $25, correlation_attempts = $26,
        correlation_deadline = $27, last_log_line = $28, instance_status = $29, instance_mode = $30
      WHERE id = $1 AND status IN ('PENDING', 'PENDING_APPROVAL')
      RETURNING id
      `,
      portalUpdateParams(record),
    );
    return (res.rowCount ?? 0) > 0;
  }

  private async getByWorkflowRunId(
    workflowRunId: string,
  ): Promise<PortalDeploymentRecord | null> {
    const pool = this.pool();
    if (pool) {
      const selectQuery = await this.portalSelectQuery();
      const res = await pool.query(
        `${selectQuery} WHERE workflow_run_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [workflowRunId],
      );
      return res.rows.length ? mapRow(res.rows[0]) : null;
    }
    return (
      Array.from(this.memory.values()).find(
        record => record.workflowRunId === workflowRunId,
      ) ?? null
    );
  }

  private detectFieldType(field: string): PortalSecretFieldType {
    const lowerField = field.toLowerCase();

    if (lowerField.includes('password') || lowerField.includes('passwd')) {
      return 'password';
    }
    if (
      lowerField.includes('certificate') ||
      lowerField.includes('cert') ||
      lowerField.includes('.pem')
    ) {
      return 'certificate';
    }
    if (
      lowerField.includes('private_key') ||
      lowerField.includes('key') ||
      lowerField.includes('.key')
    ) {
      return 'key';
    }
    if (lowerField.includes('license') || lowerField.includes('lic')) {
      return 'license';
    }
    if (lowerField.includes('base64') || lowerField.includes('b64')) {
      return 'base64';
    }
    if (lowerField.includes('pipeline_ref') || lowerField.includes('ref')) {
      return 'pipeline_ref';
    }

    return 'other';
  }

  async getFieldsNeedingValues(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    forceRefresh?: boolean;
  }): Promise<PortalSecretFieldInfo[]> {
    const readiness = await this.getSecretReadiness({
      application: input.application,
      instanceName: input.instanceName,
      customer: input.customer,
      vault: input.vault,
      clusterName: input.clusterName,
      includePipelineRefs: true,
      forceRefresh: input.forceRefresh ?? true,
    });

    const needsValues = [...readiness.missing, ...readiness.placeholders];

    return needsValues.map(finding => ({
      ...finding,
      type: this.detectFieldType(finding.field),
    }));
  }

  private getSecretReadinessService() {
    if (!this.deps.secretReadiness) {
      throw new PortalDeploymentError(
        'Direct 1Password secret readiness is not configured in this environment.',
        503,
      );
    }
    return this.deps.secretReadiness;
  }

  async updateSecretFieldValue(
    input: PortalSecretUpdateRequest,
  ): Promise<PortalSecretUpdateResult> {
    if (!canManageSecretValues(input.role)) {
      throw new PortalDeploymentError(
        'Only platform-admin can update secret values.',
        403,
      );
    }

    const secretReadiness = this.getSecretReadinessService();
    if (!secretReadiness.updateSecretFieldValue) {
      throw new PortalDeploymentError(
        'Direct 1Password field updates are not configured in this environment.',
        503,
      );
    }

    const result = await secretReadiness.updateSecretFieldValue(input);

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'portal-secret-field-updated',
      targetType: '1password-field',
      targetId: `${input.vault}/${input.item}/${input.section ?? 'root'}/${
        input.field
      }`,
      payload: {
        application: input.application,
        instanceName: input.instanceName,
        customer: input.customer,
        reference: `op://${input.vault}/${input.item}/${
          input.section ? `${input.section}/` : ''
        }${input.field}`,
        mode: 'direct',
      },
    });

    return result;
  }

  private async auditSecretProvisionCompletion(
    state: PortalSecretProvisionStatusView,
    actorRef: string,
    role: PersonaRole,
  ): Promise<void> {
    if (state.status !== 'completed') {
      return;
    }

    await this.deps.audit({
      actorRef,
      role,
      action: 'portal-secret-provision-completed',
      targetType: '1password-section',
      targetId: `${state.customer}:${state.sections.join(',')}`,
      payload: {
        application: state.application,
        instanceName: state.instanceName,
        customer: state.customer,
        clusterName: state.clusterName,
        workflowRunId: state.workflowRunId,
        workflowConclusion: state.conclusion,
        readiness: state.readiness?.ready ?? null,
        fieldsGenerated: state.fieldsGenerated,
        sections: state.sections,
      },
    });
  }

  async provisionSecrets(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    applicationReleaseVersion?: string;
    actorRef: string;
    role: PersonaRole;
    bootstrapCustomerStructure?: boolean;
    entityResolutionChartVersion?: string;
    onProgress?: (event: SecretProvisionProgressEvent) => void;
  }): Promise<PortalSecretProvisionStatusView> {
    const application = input.application.trim();
    const instanceName = input.instanceName.trim();
    const customer = input.customer.trim();
    const vault = input.vault?.trim();
    const clusterName = input.clusterName?.trim();

    if (!application || !instanceName || !customer) {
      throw new PortalDeploymentError(
        'application, instanceName, and customer are required for 1Password provisioning.',
      );
    }

    const secretReadiness = this.getSecretReadinessService();
    if (!secretReadiness.provision) {
      throw new PortalDeploymentError(
        'Direct 1Password provisioning is not configured in this environment.',
        503,
      );
    }

    if (input.bootstrapCustomerStructure) {
      if (!secretReadiness.bootstrapCustomerStructure) {
        throw new PortalDeploymentError(
          'Customer 1Password bootstrapping is not configured in this environment.',
          503,
        );
      }

      input.onProgress?.({
        step: 'Bootstrap',
        status: 'INFO',
        detail: `Bootstrapping standard environment sections for customer '${customer}'.`,
        timestamp: new Date().toISOString(),
      });
      await secretReadiness.bootstrapCustomerStructure({
        customer,
        vault,
      });
      input.onProgress?.({
        step: 'Bootstrap',
        status: 'SUCCESS',
        detail: `Customer '${customer}' now has standard environment sections in 1Password.`,
        timestamp: new Date().toISOString(),
      });
    }

    const state = await secretReadiness.provision({
      application,
      instanceName,
      customer,
      vault,
      clusterName,
      applicationReleaseVersion: input.applicationReleaseVersion,
      actorRef: input.actorRef,
      role: input.role,
      entityResolutionChartVersion: input.entityResolutionChartVersion,
      onProgress: input.onProgress,
    });

    this.secretProvisionRuns.set(state.operationId, state);

    await this.deps.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'portal-secret-provision-requested',
      targetType: '1password-section',
      targetId: `${customer}:${state.sections.join(',')}`,
      payload: {
        application,
        instanceName,
        customer,
        vault: vault || null,
        clusterName,
        workflowRepository: state.workflowRepository,
        workflowId: state.workflowId,
        workflowRef: state.workflowRef,
        workflowRunId: state.workflowRunId,
        fieldsGenerated: state.fieldsGenerated,
        sections: state.sections,
        readinessSummary: state.readiness?.summary ?? null,
        mode: 'direct',
      },
    });

    await this.auditSecretProvisionCompletion(
      state,
      input.actorRef,
      input.role,
    );

    return state;
  }

  private async syncPipelineRefs(
    record: PortalDeploymentRecord,
  ): Promise<void> {
    const secretReadiness = this.deps.secretReadiness;
    if (!secretReadiness?.syncPipelineRefs) {
      return;
    }

    if (!record.chartVersion.trim()) {
      return;
    }

    const selectedVault = record.workflowInputs?.onePasswordVault?.trim() || '';
    if (!selectedVault) {
      throw new PortalDeploymentError(
        `Deployment ${record.id} is missing a 1Password vault selection required to sync pipeline refs.`,
        503,
      );
    }

    try {
      await secretReadiness.syncPipelineRefs({
        vault: selectedVault,
        itemTitleOrId: record.customer,
        namespace: record.namespace,
        helmChartVersion: record.chartVersion,
      });
    } catch (error) {
      const devModeBypass =
        process.env.NODE_ENV === 'development' ||
        process.env.ENABLE_MOCK_CATALOG === 'true';
      if (
        typeof secretReadiness.isConfigured === 'function' &&
        !secretReadiness.isConfigured() &&
        devModeBypass
      ) {
        this.deps.logger.warn(
          `[control-plane] 1Password service account is not configured; skipping pipeline_refs sync for deployment ${record.id} because development/mock mode is enabled: ${toMessage(error)}`,
        );
        return;
      }
      throw error;
    }
  }

  async verifyAppInstanceExists(input: {
    application: string;
    instanceName: string;
    branch?: string;
  }): Promise<PortalAppInstanceCheckResult> {
    const application = input.application.trim();
    const instanceName = input.instanceName.trim();
    const branch = input.branch?.trim() || 'main';
    if (!application || !instanceName) {
      throw new PortalDeploymentError(
        'application and instanceName are required to verify a deployment instance.',
      );
    }

    const repository = this.executionRepository();
    const exists = await this.deps.actions.verifyAppInstanceExists(
      application,
      instanceName,
      branch,
      repository,
    );
    const path = appInstanceHelmfilePath(application, instanceName);
    return {
      exists,
      application,
      instanceName,
      branch,
      path,
      message: exists
        ? `App instance '${path}' exists in ${repository}@${branch}.`
        : `App instance '${path}' does not exist in ${repository}@${branch}. Ensure the instance folder is committed or bootstrapped.`,
    };
  }

  private async assertAppInstanceExists(
    record: PortalDeploymentRecord,
  ): Promise<void> {
    const check = await this.verifyAppInstanceExists({
      application: record.application,
      instanceName: record.instanceName,
      branch: record.branch,
    });

    if (!check.exists) {
      throw new PortalDeploymentError(check.message, 409);
    }
  }

  async getSecretProvisionStatus(
    operationId: string,
  ): Promise<PortalSecretProvisionStatusView | null> {
    const state = this.secretProvisionRuns.get(operationId);
    if (!state) {
      return null;
    }

    return state;
  }

  private readinessRepository(): string {
    return (
      process.env.CLOUDHUB_1PASSWORD_WORKFLOW_REPOSITORY?.trim() ||
      process.env.SYMPHONYFS_SCRIPTS_REPOSITORY?.trim() ||
      'jubermohamad/platform_cloudhub'
    );
  }

  private readinessWorkflowId(): string {
    return (
      process.env.CLOUDHUB_1PASSWORD_READINESS_WORKFLOW_ID?.trim() ||
      'onepassword-readiness.yml'
    );
  }

  private readinessWorkflowRef(): string {
    return (
      process.env.CLOUDHUB_1PASSWORD_READINESS_WORKFLOW_REF?.trim() ||
      process.env.SYMPHONYFS_WORKFLOW_REF?.trim() ||
      'main'
    );
  }

  private parseRunnerReadiness(
    logs: string[],
  ): PortalSecretReadinessReport | null {
    const marker = logs
      .map(
        line => line.match(/CLOUDHUB_READINESS_RESULT=([A-Za-z0-9+/=]+)/)?.[1],
      )
      .find(Boolean);
    if (!marker) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(marker, 'base64').toString('utf8'),
      ) as PortalSecretReadinessReport;
      if (
        typeof parsed.ready !== 'boolean' ||
        !Array.isArray(parsed.findings) ||
        !Array.isArray(parsed.missing) ||
        !Array.isArray(parsed.placeholders) ||
        !Array.isArray(parsed.filePlaceholders)
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async runnerReadiness(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    includePipelineRefs?: boolean;
  }): Promise<PortalSecretReadinessReport> {
    const repository = this.readinessRepository();
    const workflowId = this.readinessWorkflowId();
    const ref = this.readinessWorkflowRef();
    const dispatch = await this.deps.actions.dispatch({
      serviceId: input.application,
      repository,
      workflowId,
      ref,
      inputs: {
        application: input.application,
        instanceName: input.instanceName,
        customer: input.customer,
        ...(input.vault?.trim() ? { vault: input.vault.trim() } : {}),
        opServiceAccountTokenSecretName:
          process.env.CLOUDHUB_1PASSWORD_READ_SECRET_NAME?.trim() ||
          'CLOUDHUB_1PASSWORD_READ',
      },
    });
    if (!dispatch?.runId) {
      throw new PortalDeploymentError(
        `1Password readiness runner was dispatched but no workflow run was returned. Verify ${workflowId} exists on branch '${ref}' in ${repository} and the configured GitHub token can list workflow runs.`,
        503,
      );
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await this.deps.actions.runStatus(
        dispatch.runId,
        repository,
      );
      if (!status || typeof status.status !== 'string') {
        throw new PortalDeploymentError(
          '1Password readiness runner status is unavailable.',
          503,
        );
      }
      if (status.status === 'completed') {
        const logs = await this.deps.actions.runLogs(
          dispatch.runId,
          repository,
        );
        const report = this.parseRunnerReadiness(logs.lines);
        if (report) return report;
        throw new PortalDeploymentError(
          status.conclusion === 'success'
            ? '1Password readiness runner completed without returning a valid readiness report.'
            : `1Password readiness runner failed with conclusion '${
                status.conclusion ?? 'unknown'
              }'.`,
          503,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new PortalDeploymentError(
      '1Password readiness runner did not complete within the polling window.',
      504,
    );
  }

  async getSecretReadiness(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    includePipelineRefs?: boolean;
    forceRefresh?: boolean;
  }): Promise<PortalSecretReadinessReport> {
    if (this.deps.secretReadiness) {
      return this.deps.secretReadiness.check(input);
    }
    if (
      typeof this.deps.actions.dispatch !== 'function' ||
      typeof this.deps.actions.runStatus !== 'function' ||
      typeof this.deps.actions.runLogs !== 'function'
    ) {
      throw new PortalDeploymentError(
        '1Password readiness runner is not configured in this environment.',
        503,
      );
    }
    return this.runnerReadiness(input);
  }

  private async assertSecretsReady(
    record: PortalDeploymentRecord,
  ): Promise<void> {
    const selectedVault = record.workflowInputs?.onePasswordVault?.trim() || '';
    if (!selectedVault) {
      throw new PortalDeploymentError(
        `Deployment ${record.id} is missing a 1Password vault selection required for secret readiness checks.`,
        503,
      );
    }

    let report: PortalSecretReadinessReport;
    try {
      report = await this.getSecretReadiness({
        application: record.application,
        instanceName: record.instanceName,
        customer: record.customer,
        vault: selectedVault,
        clusterName: record.cluster,
        includePipelineRefs: true,
        forceRefresh: true,
      });
    } catch (error) {
      const devModeBypass =
        process.env.NODE_ENV === 'development' ||
        process.env.ENABLE_MOCK_CATALOG === 'true';
      if (
        this.deps.secretReadiness &&
        typeof this.deps.secretReadiness.isConfigured === 'function' &&
        !this.deps.secretReadiness.isConfigured() &&
        devModeBypass
      ) {
        this.deps.logger.warn(
          `[control-plane] 1Password service account is not configured; skipping secret readiness check for deployment ${record.id} because development/mock mode is enabled: ${toMessage(error)}`,
        );
        return;
      }
      throw error;
    }

    if (report.ready) {
      return;
    }

    const failures = [
      ...report.missing.map(
        finding =>
          `${finding.vault}/${finding.item}/${finding.section ?? '-'}:${
            finding.field
          }`,
      ),
      ...report.placeholders.map(
        finding =>
          `${finding.vault}/${finding.item}/${finding.section ?? '-'}:${
            finding.field
          }`,
      ),
      ...report.filePlaceholders.map(
        finding => `${finding.path}:${finding.line} (${finding.token})`,
      ),
    ];

    const detail =
      failures.length > 0 ? ` Failing entries: ${failures.join(', ')}` : '';
    throw new PortalDeploymentError(
      `Deployment blocked by 1Password readiness check for ${record.application}/${record.instanceName}. ${report.summary}${detail}`,
      400,
    );
  }
}

function normalizeDbValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function renderHelmfile(input: {
  application: string;
  instanceName: string;
  customer: string;
  environment: string;
  clusterName: string;
  chartVersion: string;
  aiStoreIntegration: boolean;
  namespace: string;
  instanceStatus: 'EXISTING' | 'NEW';
}): string {
  const chart = `symphonyfs/${input.application}`;
  const versionLine = input.chartVersion
    ? `    version: "${input.chartVersion}"\n`
    : '';
  const ingressHost =
    calculateIngressTarget({
      application: input.application,
      customer: input.customer,
      instanceName: input.instanceName,
      environment: input.environment,
    })?.fqdn ?? '';
  return `# Generated by CloudHub Deployment Portal.\n# Execution: SymphonyFS pipeline-internal\n# Application:  ${input.application}\n# Instance:     ${input.instanceName}\n# Customer:     ${input.customer}\n# Environment:  ${input.environment}\n# Cluster:      ${input.clusterName}\n# Instance status: ${input.instanceStatus}\n\nnamespace: ${input.namespace}\nappName: ${input.application}\nclientSubDomain: ${input.customer}\nenvType: ${input.environment}\n\ncluster:\n  context: ${input.clusterName}\n\nrepositories:\n  - name: symphonyfs\n    url: https://helm.symphonyfs.net\n\nreleases:\n  - name: ${input.application}-${input.instanceName}\n    namespace: ${input.namespace}\n    chart: ${chart}\n${versionLine}    values:\n      - values.generated.yaml\n    set:\n      - name: global.environment\n        value: ${input.environment}\n      - name: global.customer\n        value: ${input.customer}\n      - name: global.clientSubDomain\n        value: ${input.customer}\n      - name: ingress.enabled\n        value: true\n      - name: ingress.host\n        value: ${ingressHost}\n      - name: integrations.aiStore.enabled\n        value: ${input.aiStoreIntegration}\n      - name: monitoring.enabled\n        value: true\n\n# Secrets are sourced at deploy time from the platform external-secrets store.\n`;
}

function portalInsertParams(record: PortalDeploymentRecord): unknown[] {
  return [
    normalizeDbValue(record.id),
    normalizeDbValue(record.deploymentName),
    normalizeDbValue(record.application),
    normalizeDbValue(record.instanceName),
    normalizeDbValue(record.customer),
    normalizeDbValue(record.environment),
    normalizeDbValue(record.cluster),
    normalizeDbValue(record.subscriptionId),
    normalizeDbValue(record.resourceGroup),
    normalizeDbValue(record.chartVersion),
    normalizeDbValue(record.aiStoreIntegration),
    normalizeDbValue(record.namespace),
    normalizeDbValue(record.helmfilePath),
    normalizeDbValue(record.helmfileContent),
    normalizeDbValue(record.branch),
    normalizeDbValue(record.commitSha),
    normalizeDbValue(record.prUrl),
    normalizeDbValue(record.workflowRunId),
    normalizeDbValue(record.workflowRunUrl),
    normalizeDbValue(record.status),
    normalizeDbValue(record.currentStep),
    normalizeDbValue(record.statusMessage),
    normalizeDbValue(record.failureReason),
    normalizeDbValue(record.approvedBy),
    normalizeDbValue(record.approvedAt),
    normalizeDbValue(record.mode),
    normalizeDbValue(record.requestedBy),
    normalizeDbValue(record.requestedAt),
    normalizeDbValue(record.createdBy),
    normalizeDbValue(record.createdAt),
    normalizeDbValue(record.updatedAt),
    normalizeDbValue(record.startedAt),
    normalizeDbValue(record.completedAt),
    null,
    null,
    normalizeDbValue(record.workflowRepository),
    normalizeDbValue(record.workflowId),
    normalizeDbValue(record.workflowRef),
    normalizeDbValue(JSON.stringify(record.workflowInputs)),
    normalizeDbValue(record.dispatchInitiatedAt),
    normalizeDbValue(record.workflowRunAttempt),
    normalizeDbValue(record.workflowStatus),
    normalizeDbValue(record.workflowConclusion),
    normalizeDbValue(record.correlationStatus),
    normalizeDbValue(record.correlationMessage),
    normalizeDbValue(record.correlationAttempts),
    normalizeDbValue(record.correlationDeadline),
    normalizeDbValue(record.lastLogLine),
    normalizeDbValue(record.instanceStatus),
    normalizeDbValue(record.instanceMode),
  ];
}

function portalInsertParamsLegacy(record: PortalDeploymentRecord): unknown[] {
  return [
    normalizeDbValue(record.id),
    normalizeDbValue(record.deploymentName),
    normalizeDbValue(record.application),
    normalizeDbValue(record.instanceName),
    normalizeDbValue(record.customer),
    normalizeDbValue(record.environment),
    normalizeDbValue(record.cluster),
    normalizeDbValue(record.subscriptionId),
    normalizeDbValue(record.resourceGroup),
    normalizeDbValue(record.chartVersion),
    normalizeDbValue(record.aiStoreIntegration),
    normalizeDbValue(record.namespace),
    normalizeDbValue(record.helmfilePath),
    normalizeDbValue(record.helmfileContent),
    normalizeDbValue(record.branch),
    normalizeDbValue(record.commitSha),
    normalizeDbValue(record.prUrl),
    normalizeDbValue(record.workflowRunId),
    normalizeDbValue(record.workflowRunUrl),
    normalizeDbValue(record.status),
    normalizeDbValue(record.currentStep),
    normalizeDbValue(record.statusMessage),
    normalizeDbValue(record.failureReason),
    normalizeDbValue(record.approvedBy),
    normalizeDbValue(record.approvedAt),
    normalizeDbValue(record.mode),
    normalizeDbValue(record.createdBy),
    normalizeDbValue(record.createdAt),
    normalizeDbValue(record.updatedAt),
    normalizeDbValue(record.startedAt),
    normalizeDbValue(record.completedAt),
    null,
    null,
    normalizeDbValue(record.workflowRepository),
    normalizeDbValue(record.workflowId),
    normalizeDbValue(record.workflowRef),
    normalizeDbValue(JSON.stringify(record.workflowInputs)),
    normalizeDbValue(record.dispatchInitiatedAt),
    normalizeDbValue(record.workflowRunAttempt),
    normalizeDbValue(record.workflowStatus),
    normalizeDbValue(record.workflowConclusion),
    normalizeDbValue(record.correlationStatus),
    normalizeDbValue(record.correlationMessage),
    normalizeDbValue(record.correlationAttempts),
    normalizeDbValue(record.correlationDeadline),
    normalizeDbValue(record.lastLogLine),
    normalizeDbValue(record.instanceStatus),
    normalizeDbValue(record.instanceMode),
  ];
}

function portalUpdateParams(record: PortalDeploymentRecord): unknown[] {
  return [
    normalizeDbValue(record.id),
    normalizeDbValue(record.commitSha),
    normalizeDbValue(record.prUrl),
    normalizeDbValue(record.workflowRunId),
    normalizeDbValue(record.workflowRunUrl),
    normalizeDbValue(record.status),
    normalizeDbValue(record.currentStep),
    normalizeDbValue(record.statusMessage),
    normalizeDbValue(record.failureReason),
    normalizeDbValue(record.approvedBy),
    normalizeDbValue(record.approvedAt),
    normalizeDbValue(record.mode),
    normalizeDbValue(record.updatedAt),
    normalizeDbValue(record.startedAt),
    normalizeDbValue(record.completedAt),
    normalizeDbValue(record.workflowRepository),
    normalizeDbValue(record.workflowId),
    normalizeDbValue(record.workflowRef),
    normalizeDbValue(JSON.stringify(record.workflowInputs)),
    normalizeDbValue(record.dispatchInitiatedAt),
    normalizeDbValue(record.workflowRunAttempt),
    normalizeDbValue(record.workflowStatus),
    normalizeDbValue(record.workflowConclusion),
    normalizeDbValue(record.correlationStatus),
    normalizeDbValue(record.correlationMessage),
    normalizeDbValue(record.correlationAttempts),
    normalizeDbValue(record.correlationDeadline),
    normalizeDbValue(record.lastLogLine),
    normalizeDbValue(record.instanceStatus),
    normalizeDbValue(record.instanceMode),
  ];
}

function mapRow(row: Record<string, unknown>): PortalDeploymentRecord {
  return {
    id: String(row.id),
    deploymentName: String(row.deploymentName),
    application: String(row.application),
    instanceName: String(row.instanceName),
    customer: String(row.customer),
    environment: String(row.environment),
    cluster: String(row.cluster),
    subscriptionId: String(row.subscriptionId),
    resourceGroup: String(row.resourceGroup),
    chartVersion: String(row.chartVersion),
    aiStoreIntegration: Boolean(row.aiStoreIntegration),
    namespace: String(row.namespace),
    helmfilePath: String(row.helmfilePath),
    helmfileContent:
      row.helmfileContent === null || row.helmfileContent === undefined
        ? null
        : String(row.helmfileContent),
    branch: String(row.branch),
    commitSha: row.commitSha ? String(row.commitSha) : null,
    prUrl: row.prUrl ? String(row.prUrl) : null,
    workflowRunId: row.workflowRunId ? String(row.workflowRunId) : null,
    workflowRunUrl: row.workflowRunUrl ? String(row.workflowRunUrl) : null,
    status: row.status as PortalDeploymentStatus,
    currentStep: String(row.currentStep ?? ''),
    statusMessage: row.statusMessage ? String(row.statusMessage) : null,
    failureReason: row.failureReason ? String(row.failureReason) : null,
    approvedBy: row.approvedBy ? String(row.approvedBy) : null,
    approvedAt: row.approvedAt ? toIso(row.approvedAt) : null,
    decidedBy: row.approvedBy ? String(row.approvedBy) : null,
    decidedAt: row.approvedAt ? toIso(row.approvedAt) : null,
    mode: (row.mode as 'simulated' | 'github-api') ?? 'simulated',
    requestedBy: String(row.requestedBy ?? row.createdBy),
    requestedAt: toIso(row.requestedAt ?? row.createdAt),
    createdBy: String(row.createdBy),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    startedAt: toIso(row.startedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    workflowRepository: row.workflowRepository
      ? String(row.workflowRepository)
      : null,
    workflowId: row.workflowId ? String(row.workflowId) : null,
    workflowRef: row.workflowRef ? String(row.workflowRef) : null,
    workflowInputs:
      typeof row.workflowInputs === 'string'
        ? JSON.parse(row.workflowInputs)
        : ((row.workflowInputs ?? {}) as Record<string, string>),
    dispatchInitiatedAt: row.dispatchInitiatedAt
      ? toIso(row.dispatchInitiatedAt)
      : null,
    workflowRunAttempt:
      row.workflowRunAttempt === null || row.workflowRunAttempt === undefined
        ? null
        : Number(row.workflowRunAttempt),
    workflowStatus: row.workflowStatus ? String(row.workflowStatus) : null,
    workflowConclusion: row.workflowConclusion
      ? String(row.workflowConclusion)
      : null,
    correlationStatus:
      (row.correlationStatus as PortalDeploymentRecord['correlationStatus']) ??
      null,
    correlationMessage: row.correlationMessage
      ? String(row.correlationMessage)
      : null,
    correlationAttempts: Number(row.correlationAttempts ?? 0),
    correlationDeadline: row.correlationDeadline
      ? toIso(row.correlationDeadline)
      : null,
    lastLogLine: Number(row.lastLogLine ?? 0),
    instanceStatus: (row.instanceStatus as 'EXISTING' | 'NEW') ?? 'EXISTING',
    instanceMode: (row.instanceMode as 'auto' | 'existing' | 'new') ?? 'auto',
  };
}

function toDiffStatusView(
  state: PortalDiffRunState,
): PortalDeploymentDiffStatusView {
  return {
    deploymentId: state.deploymentId,
    workflowRunId: state.workflowRunId,
    workflowRunUrl: state.workflowRunUrl,
    status: state.status,
    conclusion: state.conclusion,
    currentStep: state.currentStep,
    statusMessage: state.statusMessage,
    failureReason: state.failureReason,
    correlationStatus: state.correlationStatus,
    correlationMessage: state.correlationMessage,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  };
}

function applyDiffRunStatus(
  state: PortalDiffRunState,
  status: 'queued' | 'in_progress' | 'completed',
  conclusion: string | null,
): void {
  state.status = status;
  state.conclusion = conclusion;

  if (status === 'queued') {
    state.currentStep = 'Diff workflow queued';
    state.statusMessage = 'Waiting for GitHub Actions runner capacity.';
    state.failureReason = null;
    state.completedAt = null;
    return;
  }

  if (status === 'in_progress') {
    state.currentStep = 'Running deployment diff';
    state.statusMessage =
      'Runner is executing actionValidation checks and producing diff logs.';
    state.failureReason = null;
    state.completedAt = null;
    return;
  }

  state.completedAt = new Date().toISOString();
  if (conclusion === 'success' || conclusion === null) {
    state.currentStep = 'Diff completed successfully';
    state.statusMessage =
      'Diff run completed successfully; deployment can now be submitted for approval.';
    state.failureReason = null;
    return;
  }

  state.currentStep = 'Diff failed';
  state.failureReason = `Diff workflow concluded with '${conclusion}'.`;
  state.statusMessage = state.failureReason;
}

function applyRunStatus(
  record: PortalDeploymentRecord,
  status: 'queued' | 'in_progress' | 'completed',
  conclusion: string | null,
): void {
  if (status === 'queued') {
    record.status = 'QUEUED';
    record.currentStep = 'Workflow queued';
    return;
  }
  if (status === 'in_progress') {
    record.status = 'DEPLOYING';
    record.currentStep = 'Creating Kubernetes resources';
    return;
  }
  // completed
  if (conclusion === 'success' || conclusion === null) {
    record.status = 'SUCCEEDED';
    record.currentStep = 'Deployment completed';
    record.statusMessage = 'Workflow completed successfully.';
  } else {
    record.status = 'FAILED';
    record.currentStep = 'Failed';
    record.failureReason = `Workflow concluded with '${conclusion}'.`;
    record.statusMessage = record.failureReason;
  }
  record.completedAt = new Date().toISOString();
}

function toStatusView(
  record: PortalDeploymentRecord,
): PortalDeploymentStatusView {
  return {
    deploymentId: record.id,
    workflowRunId: record.workflowRunId,
    status: record.status,
    currentStep: record.currentStep,
    workflowRunUrl: record.workflowRunUrl,
    statusMessage: record.statusMessage,
    failureReason: record.failureReason,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    commitSha: record.commitSha,
    mode: record.mode,
    applicationUrl: ingressTargetFor(record)?.url ?? null,
  };
}

function ingressTargetFor(record: PortalDeploymentRecord) {
  return calculateIngressTarget({
    application: record.application,
    customer: record.customer,
    instanceName: record.instanceName,
    environment: record.environment,
  });
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
