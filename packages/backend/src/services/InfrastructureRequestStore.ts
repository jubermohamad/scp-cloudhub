/**
 * InfrastructureRequestStore.ts
 *
 * Persistence layer for CloudHub AKS Infrastructure Requests.
 *
 * Follows the repo's established pattern (see TenantRegistryDatabase and
 * ControlPlaneService): a direct `pg` Pool connected from POSTGRES_* env vars,
 * an embedded schema executed in init(), and an in-memory fallback used when
 * POSTGRES_HOST is not configured (local/dev without Postgres). The parallel
 * migration lives at packages/backend/migrations/001_provisioning.sql — keep
 * SCHEMA_SQL below in sync with it.
 */

import { EventEmitter } from 'events';
import { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  normalizeWorkflowState,
  type AksReadinessStatus,
  type AksWorkflowState,
  type ExecutionEvent,
} from '@internal/plugin-platform-common/backend';
import type { ExecutionTracking } from './aksExecutionStatus';
import type {
  AksClusterRequest,
  PlanSummary,
} from './InfrastructureProvisioningService';

export type InfrastructureRequestStatus =
  | AksWorkflowState
  | 'pending_approval'
  | 'approved'
  | 'provisioning'
  | 'branch_ready'
  | 'awaiting_pr_merge'
  | 'awaiting_tailscale_merge'
  /** Claim held while the explicit infrastructure-PR action runs. */
  | 'preparing_infra_pr'
  /** The infrastructure-PR action failed; it can be retried explicitly. */
  | 'infra_pr_failed'
  /** Terraform Cloud applied and the cluster's state outputs were read back. */
  | 'infrastructure_ready'
  | 'bootstrapping'
  | 'validating'
  | 'completed'
  | 'rejected'
  | 'failed';

/**
 * Lifecycle of the Tailscale jumpbox access request that follows infrastructure
 * provisioning. Tracked independently of the high-level request status so the
 * wizard can surface where the access PR is in its own approval flow.
 */
export type AccessStatus =
  | 'Pending'
  | 'PR Created'
  | 'Waiting Approval'
  | 'Merged'
  | 'Applied'
  | 'Failed';

export interface ApprovalStage {
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  approver?: string;
  decidedAt?: string;
  /** config_fingerprint the decision was made for. */
  fingerprint?: string;
}

export interface InfrastructureRequest {
  requestId: string;
  requestor: string;
  customer: string;
  environment: string;
  subscription: string;
  clusterName: string;
  clusterProfile: string;
  regions: string;
  nodeSize: string;
  kubernetesVersion: string;
  estimatedMonthlyCost: number;
  planSummary: PlanSummary;
  status: InfrastructureRequestStatus;
  approvalChain: ApprovalStage[];
  createdAt: Date;
  updatedAt: Date;
  logs: string[];
  /**
   * Canonical cluster request (approval-bound). Rows created before the
   * canonical model hold the old wizard shape and have no configFingerprint.
   */
  payload: AksClusterRequest;
  taskId?: string;
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  commitSha?: string;
  tfvarsPath?: string;
  error?: string;
  /**
   * GitHub usernames granted SSH access to the cluster jumpbox. Collected in the
   * wizard, validated, and materialised into the Tailscale policy on approval.
   */
  clusterAdministrators: string[];
  /** Derived Tailscale tag/group name for the jumpbox, e.g. jumpbox-visa-qa-aue. */
  jumpboxName?: string;
  tailscalePrUrl?: string;
  tailscalePrNumber?: number;
  /** open | merged | closed — mirrors the Tailscale PR state. */
  tailscalePrStatus?: string;
  accessStatus?: AccessStatus;
  /** Platform Registry lifecycle label, e.g. 'Pending Access' | 'Ready'. */
  registryStatus?: string;
  /**
   * Optimistic-concurrency version. Incremented by every save(); a save whose
   * version no longer matches the stored row fails with
   * ConcurrentModificationError instead of silently overwriting it.
   */
  version?: number;
  /** sha256 of the canonical configuration approvals are bound to. */
  configFingerprint?: string;
  /** In-flight uniqueness claims (cleared on rejection). */
  claimClusterName?: string | null;
  claimAddressSpace?: string | null;
  /**
   * owner/name of the repository prNumber belongs to. Unset on requests whose
   * PR predates the scp-infra-as-code target; those are never tracked, since
   * their PR number refers to a different repository.
   */
  prRepository?: string | null;
  /** Read-only infrastructure execution tracking (GitHub + Terraform Cloud). */
  execution?: ExecutionTracking | null;
  /** The explicit "create infrastructure PR" action, persisted step by step. */
  infraPrOperation?: InfraPrOperation | null;
  /** High-level normalized workflow state machine status. */
  workflowState?: AksWorkflowState;
  /** Four-tier readiness evaluation. */
  readinessStatus?: AksReadinessStatus | null;
}

/**
 * State of the explicit infrastructure-PR action. External identifiers are
 * recorded as soon as each step succeeds, so a retry resumes rather than
 * repeating, and the UI can show progress without starting anything.
 */
export interface InfraPrOperation {
  state: 'in_progress' | 'branch_ready' | 'completed' | 'failed';
  attempt: number;
  startedAt: string;
  startedBy: string;
  updatedAt: string;
  repository: string;
  branchName?: string;
  commitSha?: string;
  branchReused?: boolean;
  prNumber?: number;
  prUrl?: string;
  prReused?: boolean;
  error?: string;
}

/** Raised when a create/save would duplicate an in-flight cluster or VNet. */
export class InFlightClaimConflictError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'InFlightClaimConflictError';
  }
}

/** Raised when save() loses an optimistic-concurrency race. */
export class ConcurrentModificationError extends Error {
  constructor(requestId: string) {
    super(`Request ${requestId} was modified concurrently; reload and retry`);
    this.name = 'ConcurrentModificationError';
  }
}

/** Shape of a persisted row (snake_case columns as returned by pg). */
interface RequestRow {
  request_id: string;
  requestor: string;
  customer: string;
  environment: string;
  subscription: string | null;
  cluster_name: string;
  cluster_profile: string;
  regions: string | null;
  node_size: string | null;
  kubernetes_version: string | null;
  estimated_monthly_cost: number | string | null;
  plan_summary: PlanSummary | null;
  status: InfrastructureRequestStatus;
  approval_chain: ApprovalStage[] | null;
  logs: string[] | null;
  payload: AksClusterRequest | null;
  task_id: string | null;
  pr_url: string | null;
  pr_number: number | null;
  branch_name: string | null;
  commit_sha: string | null;
  tfvars_path: string | null;
  error: string | null;
  cluster_administrators: string[] | null;
  jumpbox_name: string | null;
  tailscale_pr_url: string | null;
  tailscale_pr_number: number | null;
  tailscale_pr_status: string | null;
  access_status: string | null;
  registry_status: string | null;
  version?: number | null;
  config_fingerprint?: string | null;
  claim_cluster_name?: string | null;
  claim_address_space?: string | null;
  pr_repository?: string | null;
  execution_tracking?: ExecutionTracking | null;
  infra_pr_operation?: InfraPrOperation | null;
  readiness_status?: AksReadinessStatus | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provisioning_infrastructure_requests (
  request_id             VARCHAR(64) PRIMARY KEY,
  requestor              VARCHAR(255) NOT NULL,
  customer               VARCHAR(255) NOT NULL,
  environment            VARCHAR(100) NOT NULL,
  subscription           VARCHAR(255),
  cluster_name           VARCHAR(255) NOT NULL,
  cluster_profile        VARCHAR(50)  NOT NULL,
  regions                VARCHAR(255),
  node_size              VARCHAR(100),
  kubernetes_version     VARCHAR(50),
  estimated_monthly_cost INTEGER      NOT NULL DEFAULT 0,
  plan_summary           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status                 VARCHAR(50)  NOT NULL DEFAULT 'pending_approval',
  approval_chain         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  logs                   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  payload                JSONB        NOT NULL DEFAULT '{}'::jsonb,
  task_id                VARCHAR(128),
  pr_url                 TEXT,
  pr_number              INTEGER,
  branch_name            VARCHAR(255),
  commit_sha             VARCHAR(64),
  tfvars_path            VARCHAR(512),
  error                  TEXT,
  cluster_administrators JSONB        NOT NULL DEFAULT '[]'::jsonb,
  jumpbox_name           VARCHAR(255),
  tailscale_pr_url       TEXT,
  tailscale_pr_number    INTEGER,
  tailscale_pr_status    VARCHAR(50),
  access_status          VARCHAR(50),
  registry_status        VARCHAR(50),
  created_at             TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Idempotent column additions so existing deployments pick up the Tailscale
-- jumpbox access fields without a manual migration (mirrors
-- migrations/002_provisioning_jumpbox.sql).
ALTER TABLE provisioning_infrastructure_requests
  ADD COLUMN IF NOT EXISTS commit_sha             VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cluster_administrators JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS jumpbox_name           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tailscale_pr_url       TEXT,
  ADD COLUMN IF NOT EXISTS tailscale_pr_number    INTEGER,
  ADD COLUMN IF NOT EXISTS tailscale_pr_status    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS access_status          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS registry_status        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS version                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS config_fingerprint     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS claim_cluster_name     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS claim_address_space    VARCHAR(64);

-- In-flight uniqueness (migrations/003_provisioning_integrity.sql).
-- Execution tracking (migrations/004_provisioning_execution_tracking.sql).
-- Workflow events and readiness (migrations/005_provisioning_workflow_events.sql).
ALTER TABLE provisioning_infrastructure_requests
  ADD COLUMN IF NOT EXISTS pr_repository      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS execution_tracking JSONB,
  ADD COLUMN IF NOT EXISTS infra_pr_operation JSONB,
  ADD COLUMN IF NOT EXISTS readiness_status   JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_requests_claim_cluster
  ON provisioning_infrastructure_requests (claim_cluster_name)
  WHERE claim_cluster_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_requests_claim_cidr
  ON provisioning_infrastructure_requests (claim_address_space)
  WHERE claim_address_space IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_status
  ON provisioning_infrastructure_requests (status);

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_cluster_name
  ON provisioning_infrastructure_requests (cluster_name);

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_created_at
  ON provisioning_infrastructure_requests (created_at DESC);

CREATE TABLE IF NOT EXISTS provisioning_execution_events (
  id                     BIGSERIAL PRIMARY KEY,
  request_id             VARCHAR(64) NOT NULL,
  config_fingerprint     VARCHAR(80),
  event_id               VARCHAR(128) NOT NULL,
  source_system          VARCHAR(64) NOT NULL,
  external_ref           TEXT,
  event_type             VARCHAR(64) NOT NULL,
  normalized_status      VARCHAR(64) NOT NULL,
  message                TEXT NOT NULL,
  source_timestamp       TIMESTAMP,
  ingestion_timestamp    TIMESTAMP NOT NULL DEFAULT NOW(),
  step                   VARCHAR(64),
  severity               VARCHAR(20) NOT NULL DEFAULT 'info',
  details                JSONB,
  source_url             TEXT,
  metadata               JSONB
);

CREATE INDEX IF NOT EXISTS idx_provisioning_events_request_id_id
  ON provisioning_execution_events (request_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_events_request_event_id
  ON provisioning_execution_events (request_id, event_id);
`;

const SELECT_COLUMNS = `
  SELECT request_id, requestor, customer, environment, subscription,
         cluster_name, cluster_profile, regions, node_size, kubernetes_version,
         estimated_monthly_cost, plan_summary, status, approval_chain, logs,
         payload, task_id, pr_url, pr_number, branch_name, commit_sha, tfvars_path, error,
         cluster_administrators, jumpbox_name, tailscale_pr_url,
         tailscale_pr_number, tailscale_pr_status, access_status, registry_status,
         version, config_fingerprint, claim_cluster_name, claim_address_space,
         pr_repository, execution_tracking, infra_pr_operation, readiness_status,
         created_at, updated_at
    FROM provisioning_infrastructure_requests`;

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

export class InfrastructureRequestStore {
  private readonly logger: LoggerService;
  private pool: Pool | null;
  private readonly memory = new Map<string, InfrastructureRequest>();
  private readonly eventEmitter = new EventEmitter();
  private readonly memoryEvents = new Map<string, ExecutionEvent[]>();
  private nextEventId = 1;
  private initialized = false;

  constructor(logger: LoggerService, pool: Pool | null) {
    this.logger = logger;
    this.pool = pool;
  }

  /**
   * Build a store from POSTGRES_* environment variables. When POSTGRES_HOST is
   * not set the store operates purely in-memory (behaviour preserved for local
   * development without a database).
   */
  static fromEnv(logger: LoggerService): InfrastructureRequestStore {
    const host = process.env.POSTGRES_HOST;
    if (!host) {
      // Same rule as the deployment control plane: requests and approvals must
      // never live only in process memory in production.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[provisioning] POSTGRES_HOST is required in production; in-memory fallback is not permitted',
        );
      }
      logger.warn(
        '[provisioning] POSTGRES_HOST is not set; infrastructure requests will be stored in-memory only',
      );
      return new InfrastructureRequestStore(logger, null);
    }

    const pool = new Pool({
      host,
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      user: process.env.POSTGRES_USER ?? 'backstage',
      password: process.env.POSTGRES_PASSWORD ?? 'backstage',
      database: process.env.POSTGRES_DB ?? 'backstage',
      ssl: pgSslConfig(),
    });

    return new InfrastructureRequestStore(logger, pool);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.pool) {
      try {
        await this.pool.query(SCHEMA_SQL);
        this.logger.info(
          '[provisioning] infrastructure request schema initialized (postgres)',
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Postgres was explicitly configured: in production, silently dropping
        // to memory would lose every request (and its approvals) on restart.
        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            `[provisioning] failed to initialize postgres schema: ${msg}`,
          );
        }
        this.logger.error(
          `[provisioning] failed to initialize postgres schema; falling back to in-memory store (non-production only): ${msg}`,
        );
        this.pool = null;
      }
    } else {
      this.logger.info(
        '[provisioning] infrastructure request store running in-memory (no POSTGRES_HOST)',
      );
    }

    this.initialized = true;
  }

  /** Whether requests are persisted to postgres or held in-memory. */
  get backend(): 'postgres' | 'memory' {
    return this.pool ? 'postgres' : 'memory';
  }

  /** Postgres unique-violation on a claim index → InFlightClaimConflictError. */
  private claimConflict(error: unknown): Error {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError?.code === '23505') {
      return new InFlightClaimConflictError(
        pgError.constraint === 'uq_provisioning_requests_claim_cidr'
          ? 'Another in-flight request already claims this address space'
          : 'Another in-flight request already claims this cluster name',
      );
    }
    return error as Error;
  }

  /** In-memory equivalent of the partial unique claim indexes. */
  private assertMemoryClaims(record: InfrastructureRequest): void {
    for (const other of this.memory.values()) {
      if (other.requestId === record.requestId) continue;
      if (
        record.claimClusterName &&
        other.claimClusterName === record.claimClusterName
      ) {
        throw new InFlightClaimConflictError(
          'Another in-flight request already claims this cluster name',
        );
      }
      if (
        record.claimAddressSpace &&
        other.claimAddressSpace === record.claimAddressSpace
      ) {
        throw new InFlightClaimConflictError(
          'Another in-flight request already claims this address space',
        );
      }
    }
  }

  async create(record: InfrastructureRequest): Promise<void> {
    // New rows start at version 0 (column default for postgres).
    record.version = 0;
    if (!this.pool) {
      this.assertMemoryClaims(record);
      this.memory.set(record.requestId, this.clone(record));
      return;
    }

    try {
      await this.pool.query(
        `INSERT INTO provisioning_infrastructure_requests (
          request_id, requestor, customer, environment, subscription,
          cluster_name, cluster_profile, regions, node_size, kubernetes_version,
          estimated_monthly_cost, plan_summary, status, approval_chain, logs,
          payload, task_id, pr_url, pr_number, branch_name, commit_sha, tfvars_path, error,
          cluster_administrators, jumpbox_name, tailscale_pr_url,
          tailscale_pr_number, tailscale_pr_status, access_status, registry_status,
          created_at, updated_at,
          config_fingerprint, claim_cluster_name, claim_address_space,
          pr_repository, execution_tracking, infra_pr_operation, readiness_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
          $33, $34, $35, $36, $37, $38, $39
        )`,
        [
          record.requestId,
          record.requestor,
          record.customer,
          record.environment,
          record.subscription,
          record.clusterName,
          record.clusterProfile,
          record.regions,
          record.nodeSize,
          record.kubernetesVersion,
          record.estimatedMonthlyCost,
          JSON.stringify(record.planSummary),
          record.status,
          JSON.stringify(record.approvalChain),
          JSON.stringify(record.logs),
          JSON.stringify(record.payload),
          record.taskId ?? null,
          record.prUrl ?? null,
          record.prNumber ?? null,
          record.branchName ?? null,
          record.commitSha ?? null,
          record.tfvarsPath ?? null,
          record.error ?? null,
          JSON.stringify(record.clusterAdministrators ?? []),
          record.jumpboxName ?? null,
          record.tailscalePrUrl ?? null,
          record.tailscalePrNumber ?? null,
          record.tailscalePrStatus ?? null,
          record.accessStatus ?? null,
          record.registryStatus ?? null,
          record.createdAt,
          record.updatedAt,
          record.configFingerprint ?? null,
          record.claimClusterName ?? null,
          record.claimAddressSpace ?? null,
          record.prRepository ?? null,
          record.execution ? JSON.stringify(record.execution) : null,
          record.infraPrOperation
            ? JSON.stringify(record.infraPrOperation)
            : null,
          record.readinessStatus
            ? JSON.stringify(record.readinessStatus)
            : null,
        ],
      );
    } catch (error) {
      throw this.claimConflict(error);
    }
  }

  /**
   * Persist an existing request (configuration and workflow state), bump
   * updated_at and the optimistic-concurrency version. Throws
   * ConcurrentModificationError when the stored row has moved on since
   * `record` was read, and InFlightClaimConflictError on a claim collision.
   */
  async save(record: InfrastructureRequest): Promise<void> {
    const expectedVersion = record.version ?? 0;

    if (!this.pool) {
      const current = this.memory.get(record.requestId);
      if (!current || (current.version ?? 0) !== expectedVersion) {
        throw new ConcurrentModificationError(record.requestId);
      }
      this.assertMemoryClaims(record);
      record.updatedAt = new Date();
      record.version = expectedVersion + 1;
      this.memory.set(record.requestId, this.clone(record));
      return;
    }

    const updatedAt = new Date();
    let result;
    try {
      result = await this.pool.query(
        `UPDATE provisioning_infrastructure_requests SET
           status = $2,
           approval_chain = $3,
           logs = $4,
           task_id = $5,
           pr_url = $6,
           pr_number = $7,
           branch_name = $8,
           commit_sha = $9,
           tfvars_path = $10,
           error = $11,
           cluster_administrators = $12,
           jumpbox_name = $13,
           tailscale_pr_url = $14,
           tailscale_pr_number = $15,
           tailscale_pr_status = $16,
           access_status = $17,
           registry_status = $18,
           updated_at = $19,
           version = version + 1,
           payload = $21,
           cluster_name = $22,
           customer = $23,
           environment = $24,
           regions = $25,
           node_size = $26,
           kubernetes_version = $27,
           estimated_monthly_cost = $28,
           plan_summary = $29,
           config_fingerprint = $30,
           claim_cluster_name = $31,
           claim_address_space = $32,
           pr_repository = $33,
           execution_tracking = $34,
           infra_pr_operation = $35,
           readiness_status = $36
         WHERE request_id = $1 AND version = $20`,
        [
          record.requestId,
          record.status,
          JSON.stringify(record.approvalChain),
          JSON.stringify(record.logs),
          record.taskId ?? null,
          record.prUrl ?? null,
          record.prNumber ?? null,
          record.branchName ?? null,
          record.commitSha ?? null,
          record.tfvarsPath ?? null,
          record.error ?? null,
          JSON.stringify(record.clusterAdministrators ?? []),
          record.jumpboxName ?? null,
          record.tailscalePrUrl ?? null,
          record.tailscalePrNumber ?? null,
          record.tailscalePrStatus ?? null,
          record.accessStatus ?? null,
          record.registryStatus ?? null,
          updatedAt,
          expectedVersion,
          JSON.stringify(record.payload),
          record.clusterName,
          record.customer,
          record.environment,
          record.regions,
          record.nodeSize,
          record.kubernetesVersion,
          record.estimatedMonthlyCost,
          JSON.stringify(record.planSummary),
          record.configFingerprint ?? null,
          record.claimClusterName ?? null,
          record.claimAddressSpace ?? null,
          record.prRepository ?? null,
          record.execution ? JSON.stringify(record.execution) : null,
          record.infraPrOperation
            ? JSON.stringify(record.infraPrOperation)
            : null,
          record.readinessStatus
            ? JSON.stringify(record.readinessStatus)
            : null,
        ],
      );
    } catch (error) {
      throw this.claimConflict(error);
    }
    if ((result.rowCount ?? 0) === 0) {
      throw new ConcurrentModificationError(record.requestId);
    }
    record.updatedAt = updatedAt;
    record.version = expectedVersion + 1;
  }

  async get(requestId: string): Promise<InfrastructureRequest | null> {
    if (!this.pool) {
      const record = this.memory.get(requestId);
      return record ? this.clone(record) : null;
    }

    const result = await this.pool.query<RequestRow>(
      `${SELECT_COLUMNS} WHERE request_id = $1`,
      [requestId],
    );
    if (result.rows.length === 0) return null;
    return this.rowToRecord(result.rows[0]);
  }

  /** All requests, newest first. */
  async list(): Promise<InfrastructureRequest[]> {
    if (!this.pool) {
      return Array.from(this.memory.values())
        .map(record => this.clone(record))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const result = await this.pool.query<RequestRow>(
      `${SELECT_COLUMNS} ORDER BY created_at DESC`,
    );
    return result.rows.map(row => this.rowToRecord(row));
  }

  /** Requests in any of the given statuses, oldest first. */
  async listByStatus(
    statuses: InfrastructureRequestStatus[],
  ): Promise<InfrastructureRequest[]> {
    if (!this.pool) {
      return Array.from(this.memory.values())
        .filter(record => statuses.includes(record.status))
        .map(record => this.clone(record))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    const result = await this.pool.query<RequestRow>(
      `${SELECT_COLUMNS} WHERE status = ANY($1) ORDER BY created_at ASC`,
      [statuses],
    );
    return result.rows.map(row => this.rowToRecord(row));
  }

  private rowToRecord(row: RequestRow): InfrastructureRequest {
    return {
      requestId: row.request_id,
      requestor: row.requestor,
      customer: row.customer,
      environment: row.environment,
      subscription: row.subscription ?? '',
      clusterName: row.cluster_name,
      clusterProfile: row.cluster_profile,
      regions: row.regions ?? '',
      nodeSize: row.node_size ?? '',
      kubernetesVersion: row.kubernetes_version ?? '',
      estimatedMonthlyCost: Number(row.estimated_monthly_cost ?? 0),
      planSummary: (row.plan_summary ?? {
        resourcesToCreate: 0,
        resourcesToModify: 0,
        resourcesToDestroy: 0,
        monthlyCost: 0,
        errors: [],
        warnings: [],
      }) as PlanSummary,
      status: row.status,
      approvalChain: (row.approval_chain ?? []) as ApprovalStage[],
      createdAt:
        row.created_at instanceof Date
          ? row.created_at
          : new Date(row.created_at),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at
          : new Date(row.updated_at),
      logs: (row.logs ?? []) as string[],
      payload: (row.payload ?? {}) as AksClusterRequest,
      taskId: row.task_id ?? undefined,
      prUrl: row.pr_url ?? undefined,
      prNumber: row.pr_number ?? undefined,
      branchName: row.branch_name ?? undefined,
      commitSha: row.commit_sha ?? undefined,
      tfvarsPath: row.tfvars_path ?? undefined,
      error: row.error ?? undefined,
      clusterAdministrators: (row.cluster_administrators ?? []) as string[],
      jumpboxName: row.jumpbox_name ?? undefined,
      tailscalePrUrl: row.tailscale_pr_url ?? undefined,
      tailscalePrNumber: row.tailscale_pr_number ?? undefined,
      tailscalePrStatus: row.tailscale_pr_status ?? undefined,
      accessStatus: (row.access_status ??
        undefined) as InfrastructureRequest['accessStatus'],
      registryStatus: row.registry_status ?? undefined,
      version: Number(row.version ?? 0),
      configFingerprint: row.config_fingerprint ?? undefined,
      claimClusterName: row.claim_cluster_name ?? null,
      claimAddressSpace: row.claim_address_space ?? null,
      prRepository: row.pr_repository ?? null,
      execution: row.execution_tracking ?? null,
      infraPrOperation: row.infra_pr_operation ?? null,
      readinessStatus: (row.readiness_status ?? null) as AksReadinessStatus | null,
      workflowState: normalizeWorkflowState(row.status),
    };
  }

  /**
   * Append a normalized execution event to the durable timeline.
   * Emits to local in-process subscribers for SSE live streaming.
   * Safe to call repeatedly with the same eventId (idempotent).
   */
  async appendEvent(
    event: Omit<ExecutionEvent, 'id' | 'ingestionTimestamp'>,
  ): Promise<ExecutionEvent> {
    const now = new Date();
    const eventWithTimestamp: ExecutionEvent = {
      ...event,
      ingestionTimestamp: now.toISOString(),
      sourceTimestamp: event.sourceTimestamp ?? now.toISOString(),
    };

    if (!this.pool) {
      const list = this.memoryEvents.get(event.requestId) ?? [];
      const existing = list.find(e => e.eventId === event.eventId);
      if (existing) {
        return existing;
      }
      const recordWithId: ExecutionEvent = {
        ...eventWithTimestamp,
        id: this.nextEventId++,
      };
      list.push(recordWithId);
      this.memoryEvents.set(event.requestId, list);
      this.eventEmitter.emit(`event:${event.requestId}`, recordWithId);
      return recordWithId;
    }

    try {
      const result = await this.pool.query<{
        id: string | number;
        request_id: string;
        config_fingerprint: string | null;
        event_id: string;
        source_system: string;
        external_ref: string | null;
        event_type: string;
        normalized_status: string;
        message: string;
        source_timestamp: Date | string | null;
        ingestion_timestamp: Date | string;
        step: string | null;
        severity: string;
        details: Record<string, unknown> | null;
        source_url: string | null;
        metadata: Record<string, unknown> | null;
      }>(
        `INSERT INTO provisioning_execution_events (
           request_id, config_fingerprint, event_id, source_system, external_ref,
           event_type, normalized_status, message, source_timestamp, ingestion_timestamp,
           step, severity, details, source_url, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (request_id, event_id)
         DO UPDATE SET message = EXCLUDED.message
         RETURNING *`,
        [
          event.requestId,
          event.configFingerprint ?? null,
          event.eventId,
          event.sourceSystem,
          event.externalRef ?? null,
          event.eventType,
          event.normalizedStatus,
          event.message,
          eventWithTimestamp.sourceTimestamp,
          now,
          event.step ?? null,
          event.severity ?? 'info',
          event.details ? JSON.stringify(event.details) : null,
          event.sourceUrl ?? null,
          event.metadata ? JSON.stringify(event.metadata) : null,
        ],
      );

      const row = result.rows[0];
      const inserted: ExecutionEvent = {
        id: Number(row.id),
        requestId: row.request_id,
        configFingerprint: row.config_fingerprint ?? undefined,
        eventId: row.event_id,
        sourceSystem: row.source_system as ExecutionEvent['sourceSystem'],
        externalRef: row.external_ref ?? undefined,
        eventType: row.event_type,
        normalizedStatus:
          row.normalized_status as ExecutionEvent['normalizedStatus'],
        message: row.message,
        sourceTimestamp: row.source_timestamp
          ? new Date(row.source_timestamp).toISOString()
          : undefined,
        ingestionTimestamp: new Date(row.ingestion_timestamp).toISOString(),
        step: (row.step as ExecutionEvent['step']) ?? undefined,
        severity: row.severity as ExecutionEvent['severity'],
        details: (row.details as Record<string, unknown>) ?? undefined,
        sourceUrl: row.source_url ?? undefined,
        metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      };

      this.eventEmitter.emit(`event:${event.requestId}`, inserted);
      return inserted;
    } catch (err) {
      this.logger.warn(
        `Failed to persist execution event for request ${event.requestId}: ${err}`,
      );
      return eventWithTimestamp;
    }
  }

  /**
   * Retrieve events for a request, in chronological order, optionally
   * starting after a monotonic cursor ID (for SSE resume).
   */
  async getEvents(
    requestId: string,
    options?: { afterId?: number; limit?: number },
  ): Promise<ExecutionEvent[]> {
    const limit = options?.limit ?? 100;
    const afterId = options?.afterId ?? 0;

    if (!this.pool) {
      const list = this.memoryEvents.get(requestId) ?? [];
      return list.filter(e => (e.id ?? 0) > afterId).slice(0, limit);
    }

    const result = await this.pool.query(
      `SELECT id, request_id, config_fingerprint, event_id, source_system, external_ref,
              event_type, normalized_status, message, source_timestamp, ingestion_timestamp,
              step, severity, details, source_url, metadata
         FROM provisioning_execution_events
        WHERE request_id = $1 AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [requestId, afterId, limit],
    );

    return result.rows.map(row => ({
      id: Number(row.id),
      requestId: row.request_id,
      configFingerprint: row.config_fingerprint ?? undefined,
      eventId: row.event_id,
      sourceSystem: row.source_system,
      externalRef: row.external_ref ?? undefined,
      eventType: row.event_type,
      normalizedStatus: row.normalized_status,
      message: row.message,
      sourceTimestamp: row.source_timestamp
        ? new Date(row.source_timestamp).toISOString()
        : undefined,
      ingestionTimestamp: new Date(row.ingestion_timestamp).toISOString(),
      step: row.step ?? undefined,
      severity: row.severity,
      details: row.details ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      metadata: row.metadata ?? undefined,
    }));
  }

  /**
   * Subscribe to live events for a request ID (for Server-Sent Events).
   */
  subscribeEvents(
    requestId: string,
    listener: (event: ExecutionEvent) => void,
  ): () => void {
    const eventName = `event:${requestId}`;
    this.eventEmitter.on(eventName, listener);
    return () => {
      this.eventEmitter.off(eventName, listener);
    };
  }

  private clone(record: InfrastructureRequest): InfrastructureRequest {
    return structuredClone(record);
  }
}
