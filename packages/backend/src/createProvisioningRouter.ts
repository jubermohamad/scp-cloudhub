import { Router, json as expressJson } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RouteParameters } from 'express-serve-static-core';
import type { BasicPermission } from '@backstage/plugin-permission-common';
import type {
  LoggerService,
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import {
  InfrastructureProvisioningService,
  INFRA_REPOSITORY,
  WORKSPACES_FILE,
  AKS_VALUES_DIR,
  type AksClusterRequest,
} from './services/InfrastructureProvisioningService';
import {
  AKS_STANDARD_SUBSCRIPTION_ID,
  deriveAksNames,
  deriveAksSubnets,
  normalizeWorkflowState,
} from '@internal/plugin-platform-common/backend';
import {
  AksAddonOperationalService,
  type SupportedClusterAddon,
} from './services/AksAddonOperationalService';
import { configFingerprint } from './services/configFingerprint';
import {
  ConcurrentModificationError,
  InFlightClaimConflictError,
  InfrastructureRequestStore,
  type AccessStatus,
  type ApprovalStage,
  type InfrastructureRequest,
  type InfrastructureRequestStatus,
} from './services/InfrastructureRequestStore';
import {
  JumpboxAccessProvisioningService,
  deriveJumpboxName,
  normalizeAdministrators,
} from './services/JumpboxAccessProvisioningService';
import type { PlatformRegistryUpdater } from './services/PlatformRegistryUpdater';
import {
  aksApproveCloudArchitectPermission,
  aksApproveOperationsPermission,
  jumpboxApprovePermission,
} from './permissions';
import { stageDefinition, unconfiguredStages } from './aksApprovalStages';
import type { AksExecutionTracker } from './services/AksExecutionTracker';
import { executionFreshness } from './services/aksExecutionStatus';
import {
  evaluateSubmissionGates,
  type SubmissionGateReport,
} from './services/aksSubmissionGates';

// Re-exported for backwards compatibility with existing importers.
export type {
  AccessStatus,
  ApprovalStage,
  InfrastructureRequest,
  InfrastructureRequestStatus,
};

const BASE_BRANCH = process.env.GITHUB_BASE_BRANCH ?? 'main';

/**
 * CloudHub business approval chains, keyed by cluster profile. The approval workflow
 * runs BEFORE any Git operation — Git work only starts once every stage is
 * approved.
 */
const APPROVAL_CHAINS: Record<string, string[]> = {
  'free-tier': ['Platform Team'],
  'dev-tier': ['Platform Team'],
  'single-region': ['Platform Team'],
  'active-passive': ['Platform Team', 'Cloud Architect'],
  'active-active': ['Platform Team', 'Cloud Architect', 'Operations'],
};

export interface ProvisioningTask {
  taskId: string;
  status:
    | 'submitted'
    | 'completed'
    | 'failed'
    | 'awaiting_pr_merge'
    | 'cancelled';
  clusterName: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  logs: string[];
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  tfvarsPath?: string;
}

export interface ProvisioningRouterDeps {
  logger: LoggerService;
  httpAuth?: HttpAuthService;
  /** Persistence for CloudHub Infrastructure Requests (postgres, in-memory fallback). */
  store: InfrastructureRequestStore;
  /** Optional service override (primarily for tests); defaults to a new instance. */
  service?: InfrastructureProvisioningService;
  /** Tailscale jumpbox access service; defaults to a new instance. */
  jumpboxService?: JumpboxAccessProvisioningService;
  /** Platform Registry lifecycle updater; defaults to one built from env. */
  registry?: PlatformRegistryUpdater;
  permissions?: PermissionsService;
  /** Approval chains by cluster profile (defaults to APPROVAL_CHAINS). */
  approvalChains?: Record<string, string[]>;
  /** Read-only GitHub / Terraform Cloud execution tracker. */
  tracker?: AksExecutionTracker | null;
  /**
   * Mandatory submission gates (CIDR, quota, permissions, approvers). When
   * absent every external gate reports `unverified`, which blocks submission.
   */
  submissionGates?: (
    request: AksClusterRequest,
    approvalChain: string[],
  ) => Promise<SubmissionGateReport>;
}

export const provisioningTasks = new Map<string, ProvisioningTask>();

function generateRequestId(): string {
  return `INFRA-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function iso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Requests created before identities were taken from Backstage credentials
 * store a free-text requestor. That value cannot be trusted for separation of
 * duties, so such requests can no longer be approved (only rejected).
 */
function hasVerifiedRequestor(record: InfrastructureRequest): boolean {
  return /^user:[^/\s]+\/[^/\s]+$/.test(record.requestor);
}

/** Requesters may approve their own request only when explicitly enabled. */
function selfApprovalAllowed(): boolean {
  return process.env.ALLOW_SELF_APPROVAL === 'true';
}

/**
 * Fingerprint of everything an approval vouches for: the canonical cluster
 * request (Terraform inputs + governance fields + profile) and the jumpbox
 * administrators. Administrators are compared case-insensitively and
 * order-independently, as GitHub usernames are.
 */
function fingerprintOf(record: InfrastructureRequest): string {
  return configFingerprint({
    request: record.payload,
    clusterAdministrators: normalizeAdministrators(
      record.clusterAdministrators ?? [],
    )
      .valid.map(admin => admin.toLowerCase())
      .sort(),
  });
}

/**
 * Why the approvals on `record` cannot be relied on, or null when they can.
 * With `requireAllApproved`, also require every stage to be approved.
 */
function approvalIntegrityProblem(
  record: InfrastructureRequest,
  requireAllApproved: boolean,
): string | null {
  if (!record.configFingerprint) {
    return 'This request predates approval-integrity enforcement and has no configuration fingerprint';
  }
  if (fingerprintOf(record) !== record.configFingerprint) {
    return 'The stored configuration no longer matches the fingerprint it was submitted with';
  }
  const stale = record.approvalChain.find(
    stage =>
      stage.status === 'approved' &&
      stage.fingerprint !== record.configFingerprint,
  );
  if (stale) {
    return `The ${stale.role} approval was given for a different configuration`;
  }
  if (
    requireAllApproved &&
    record.approvalChain.some(stage => stage.status !== 'approved')
  ) {
    return 'Not every approval stage has been approved';
  }
  return null;
}

/** Derived record fields for a canonical request (submit and amend). */
function applyConfiguration(
  record: InfrastructureRequest,
  request: AksClusterRequest,
  administrators: string[],
): void {
  const names = deriveAksNames(request);
  record.payload = request;
  record.clusterAdministrators = administrators;
  record.customer = request.customer;
  record.environment = request.env;
  record.subscription = AKS_STANDARD_SUBSCRIPTION_ID;
  record.clusterName = names.clusterName;
  record.clusterProfile = request.clusterProfile;
  record.regions = request.location;
  record.nodeSize = request.userPool
    ? `${request.systemPool.vmSize} / ${request.userPool.vmSize}`
    : request.systemPool.vmSize;
  record.kubernetesVersion = request.kubernetesVersion;
  record.jumpboxName = names.jumpboxName;
  record.claimClusterName = names.clusterName;
  record.claimAddressSpace = request.addressSpace;
  record.configFingerprint = fingerprintOf(record);
}

/**
 * Express 4 does not catch rejections from async handlers, so a failing await
 * leaves the request hanging until the ingress times out and answers with an
 * HTML error page — which the browser then fails to parse as JSON.
 */
function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

/** Public projection of an infrastructure request (omits the raw payload). */
function serializeRequest(record: InfrastructureRequest) {
  const { payload: _payload, ...rest } = record;
  return {
    ...rest,
    workflowState:
      record.workflowState ?? normalizeWorkflowState(record.status),
    readinessStatus: record.readinessStatus ?? null,
    /** Created before the approval-integrity model; cannot be approved or tracked. */
    legacy: !record.configFingerprint,
    executionFreshness: record.execution
      ? executionFreshness(record.execution, new Date())
      : null,
  };
}

/** Permissions that make a user an AKS approver (and so a viewer of every request). */
const VIEW_ALL_PERMISSIONS: BasicPermission[] = [
  jumpboxApprovePermission,
  aksApproveCloudArchitectPermission,
  aksApproveOperationsPermission,
];

function gateSummary(report: SubmissionGateReport): string {
  return report.checks
    .map(check => `${check.label}: ${check.status}`)
    .join('; ');
}

export function createProvisioningRouter(deps: ProvisioningRouterDeps): Router {
  const { logger, store } = deps;
  const router = Router();
  router.use(expressJson());

  const service = deps.service ?? new InfrastructureProvisioningService(logger);
  const jumpboxService =
    deps.jumpboxService ?? new JumpboxAccessProvisioningService(logger);
  // deps.registry is accepted for compatibility; registration moves to the
  // verified-readiness stage and is intentionally not invoked from here.
  const permissions = deps.permissions;
  const httpAuth = deps.httpAuth;
  const approvalChains = deps.approvalChains ?? APPROVAL_CHAINS;
  const tracker = deps.tracker ?? null;
  const runGates =
    deps.submissionGates ??
    ((request: AksClusterRequest, chain: string[]) =>
      evaluateSubmissionGates(request, chain, {
        github: null,
        githubWriteProbes: { infra: null, tailscale: null },
        azure: null,
        repositories: { infra: INFRA_REPOSITORY, tailscale: '' },
        baseBranch: BASE_BRANCH,
        productionSubmissionsEnabled: false,
      }));

  // Register through `route` (never `router` directly) so every handler is
  // wrapped by asyncRoute and always terminates with a JSON response.
  const route = {
    get: <P extends string>(
      path: P,
      handler: RequestHandler<RouteParameters<P>>,
    ) => router.get(path, asyncRoute(handler as RequestHandler)),
    post: <P extends string>(
      path: P,
      handler: RequestHandler<RouteParameters<P>>,
    ) => router.post(path, asyncRoute(handler as RequestHandler)),
    patch: <P extends string>(
      path: P,
      handler: RequestHandler<RouteParameters<P>>,
    ) => router.patch(path, asyncRoute(handler as RequestHandler)),
    delete: <P extends string>(
      path: P,
      handler: RequestHandler<RouteParameters<P>>,
    ) => router.delete(path, asyncRoute(handler as RequestHandler)),
  };

  const addonService = new AksAddonOperationalService({ store, logger });

  /**
   * Resolve the calling Backstage user. Identities are never taken from the
   * request body. Responds 500/401 and returns null when unavailable.
   */
  const requireUser = async (
    req: Request,
    res: Response,
    context: Record<string, unknown> = {},
  ): Promise<string | null> => {
    if (!httpAuth) {
      res
        .status(500)
        .json({ ...context, error: 'HTTP auth service is not configured' });
      return null;
    }
    try {
      const credentials = await httpAuth.credentials(
        req as unknown as Parameters<HttpAuthService['credentials']>[0],
        { allow: ['user'] },
      );
      return credentials.principal.userEntityRef;
    } catch (error) {
      res.status(401).json({ ...context, error: errorMessage(error) });
      return null;
    }
  };

  /**
   * Resolve the calling user and require the jumpbox/AKS approver permission.
   * Responds 401/403/500 and returns null when the caller may not decide.
   */
  /**
   * Resolve the calling user and require that at least one of `permissionList`
   * is granted. Responds 401/403/500 and returns null otherwise.
   */
  const requireApprover = async (
    req: Request,
    res: Response,
    record: InfrastructureRequest,
    action: 'approve' | 'reject',
    permissionList: BasicPermission[],
  ): Promise<string | null> => {
    const context = serializeRequest(record);
    if (!permissions) {
      res
        .status(500)
        .json({ ...context, error: 'Permission service is not configured' });
      return null;
    }
    if (!httpAuth) {
      res
        .status(500)
        .json({ ...context, error: 'HTTP auth service is not configured' });
      return null;
    }
    let credentials;
    try {
      credentials = await httpAuth.credentials(
        req as unknown as Parameters<HttpAuthService['credentials']>[0],
        { allow: ['user'] },
      );
    } catch (error) {
      res.status(401).json({ ...context, error: errorMessage(error) });
      return null;
    }
    const decisions = await permissions.authorize(
      permissionList.map(permission => ({ permission })),
      { credentials },
    );
    if (!decisions.some(decision => decision?.result === 'ALLOW')) {
      res.status(403).json({
        ...context,
        error: `Not authorized to ${action} this stage of the AKS request`,
      });
      return null;
    }
    return credentials.principal.userEntityRef;
  };

  /**
   * Resolve the calling user for read access. Approvers (any AKS approval
   * permission) may read every request; anyone else only their own.
   */
  const resolveViewer = async (
    req: Request,
    res: Response,
  ): Promise<{ userRef: string; approver: boolean } | null> => {
    if (!httpAuth || !permissions) {
      res
        .status(500)
        .json({ error: 'Authentication services are not configured' });
      return null;
    }
    let credentials;
    try {
      credentials = await httpAuth.credentials(
        req as unknown as Parameters<HttpAuthService['credentials']>[0],
        { allow: ['user'] },
      );
    } catch (error) {
      res.status(401).json({ error: errorMessage(error) });
      return null;
    }
    const decisions = await permissions.authorize(
      VIEW_ALL_PERMISSIONS.map(permission => ({ permission })),
      { credentials },
    );
    return {
      userRef: credentials.principal.userEntityRef,
      approver: decisions.some(decision => decision?.result === 'ALLOW'),
    };
  };

  /** Load a request the caller may view; responds 401/403/404 otherwise. */
  const loadViewable = async (
    req: Request,
    res: Response,
    requestId: string,
  ): Promise<InfrastructureRequest | null> => {
    const viewer = await resolveViewer(req, res);
    if (!viewer) return null;
    const record = await store.get(requestId);
    if (!record) {
      res.status(404).json({ error: `Request ${requestId} not found` });
      return null;
    }
    if (!viewer.approver && viewer.userRef !== record.requestor) {
      res.status(403).json({ error: 'Not authorized to view this request' });
      return null;
    }
    return record;
  };

  /** Reset every approval (configuration changed or integrity failed). */
  const invalidateApprovals = async (
    record: InfrastructureRequest,
    reason: string,
  ): Promise<void> => {
    for (const stage of record.approvalChain) {
      if (stage.status === 'approved') {
        record.logs.push(
          `[${iso()}] ${stage.role} approval by ${
            stage.approver
          } invalidated: ${reason}`,
        );
      }
    }
    record.approvalChain = record.approvalChain.map(stage => ({
      role: stage.role,
      status: 'pending' as const,
    }));
    // Re-bind to the configuration as it is now; it must be approved afresh.
    record.configFingerprint = fingerprintOf(record);
    record.status = 'pending_approval';
    await store.save(record);
  };

  const pullRequestContext = (record: InfrastructureRequest) => ({
    requestId: record.requestId,
    configFingerprint: record.configFingerprint ?? '',
    approvals: record.approvalChain.map(stage => ({
      role: stage.role,
      approver: stage.approver,
      decidedAt: stage.decidedAt,
    })),
  });

  route.get('/preflight', async (_req, res) => {
    try {
      const result = await service.preflight();
      if (!result.ok) {
        res.status(403).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[provisioning] preflight failed: ${msg}`);
      res.status(500).json({ ok: false, mode: service.mode, reason: msg });
    }
  });

  // ── Review: validate and preview the exact configuration ─────────────────────
  // Pure: no external calls. The values file returned here is byte-for-byte
  // what the infrastructure PR will commit (same shared renderer), apart from
  // the `created` tag date. There is no plan before merge: for a new cluster
  // the Terraform Cloud workspace only exists once workspacemanager applies
  // the merged registration (decision D2).
  route.post('/plan', async (req, res) => {
    if (!(await requireUser(req, res))) return;
    const request = service.normalizeRequest(req.body);
    const validation = service.validateRequest(request);
    const names = deriveAksNames(request);
    // Read-only preflight; the same gates are enforced again on submit.
    const gates =
      validation.errors.length === 0
        ? await runGates(
            request,
            approvalChains[request.clusterProfile] ?? ['Platform Team'],
          )
        : undefined;
    res.json({
      valid: validation.errors.length === 0,
      gates,
      fieldErrors: validation.fieldErrors,
      errors: validation.errors,
      warnings: service.estimatePlan(request).warnings,
      request,
      names,
      subnets: validation.fieldErrors.addressSpace
        ? undefined
        : deriveAksSubnets(request.addressSpace),
      subscriptionId: AKS_STANDARD_SUBSCRIPTION_ID,
      repository: INFRA_REPOSITORY,
      valuesFile:
        validation.errors.length === 0
          ? service.generateTfvars(request)
          : undefined,
      dispatched: false,
    });
  });

  route.get('/plan/status/:runId', (_req, res) => {
    res.status(410).json({
      error:
        'Pre-merge plan runs were removed: the plan is produced by Terraform Cloud after the infrastructure PR merges.',
    });
  });

  // ── Submit: create the CloudHub Infrastructure Request + start approval ─────────
  // No Git operations happen here. Git work is deferred until the CloudHub approval
  // workflow reaches "Approved" (see POST /request/:requestId/approve).
  const submitHandler = async (req: Request, res: Response) => {
    const requestor = await requireUser(req, res);
    if (!requestor) return;
    try {
      const request = service.normalizeRequest(req.body);

      const validation = service.validateRequest(request);
      if (validation.errors.length > 0) {
        res.status(400).json({
          error: validation.errors.join('; '),
          errors: validation.errors,
          fieldErrors: validation.fieldErrors,
          mode: service.mode,
        });
        return;
      }

      // Cluster administrators are mandatory: they become the Tailscale group
      // that is granted recorded SSH access to the jumpbox after provisioning.
      const { valid: administrators, invalid: invalidAdmins } =
        normalizeAdministrators(
          (req.body?.clusterAdministrators as string[] | undefined) ?? [],
        );
      if (invalidAdmins.length > 0) {
        res.status(400).json({
          error: `Invalid GitHub usernames for cluster administrators: ${invalidAdmins.join(
            ', ',
          )}`,
          mode: service.mode,
        });
        return;
      }
      if (administrators.length === 0) {
        res.status(400).json({
          error:
            'At least one cluster administrator (GitHub username) is required',
          mode: service.mode,
        });
        return;
      }

      if (service.mode !== 'real') {
        res.status(503).json({
          error:
            'GitHub credentials are not configured; set GITHUB_ACTIONS_TOKEN or GITHUB_TOKEN for production provisioning.',
          mode: service.mode,
        });
        return;
      }

      const chainRoles = approvalChains[request.clusterProfile] ?? [
        'Platform Team',
      ];
      const missingStages = unconfiguredStages(chainRoles);
      if (missingStages.length > 0) {
        res.status(422).json({
          error: `Profile '${
            request.clusterProfile
          }' requires approval stage(s) with no authorized approver group configured: ${missingStages.join(
            ', ',
          )}`,
          mode: service.mode,
        });
        return;
      }

      const gates = await runGates(request, chainRoles);
      if (gates.blocking) {
        res.status(412).json({
          error:
            'Submission blocked: every preflight check must pass (a check that cannot be verified also blocks).',
          gates,
          mode: service.mode,
        });
        return;
      }

      const requestId = generateRequestId();
      const now = new Date();
      const record = {
        requestId,
        requestor,
        estimatedMonthlyCost: 0,
        planSummary: service.estimatePlan(request),
        status: 'pending_approval',
        approvalChain: chainRoles.map(role => ({
          role,
          status: 'pending' as const,
        })),
        createdAt: now,
        updatedAt: now,
        logs: [],
        accessStatus: 'Pending',
      } as unknown as InfrastructureRequest;
      applyConfiguration(record, request, administrators);
      record.logs.push(
        `[${iso()}] Infrastructure Request ${requestId} created by ${requestor} for ${
          record.clusterName
        } — status PENDING APPROVAL`,
        `[${iso()}] Configuration fingerprint ${record.configFingerprint}`,
        `[${iso()}] CloudHub Approval Workflow started: ${chainRoles.join(
          ' \u2192 ',
        )}`,
        `[${iso()}] Cluster administrators: ${administrators.join(', ')}`,
        `[${iso()}] Preflight passed — ${gateSummary(gates)}`,
      );

      await store.create(record);
      logger.info(
        `[provisioning] created infrastructure request ${requestId} for ${record.clusterName}`,
      );

      void store.appendEvent({
        requestId,
        configFingerprint: record.configFingerprint,
        eventId: `submit-${requestId}`,
        sourceSystem: 'cloudhub',
        eventType: 'configuration_submitted',
        normalizedStatus: 'pending',
        message: `Infrastructure request ${requestId} submitted for ${record.clusterName}`,
        step: 'configure',
        severity: 'info',
      });
      void store.appendEvent({
        requestId,
        configFingerprint: record.configFingerprint,
        eventId: `preflight-${requestId}`,
        sourceSystem: 'cloudhub',
        eventType: 'preflight_checks_completed',
        normalizedStatus: 'succeeded',
        message: `Preflight checks passed — ${gateSummary(gates)}`,
        step: 'review',
        severity: 'success',
      });

      res.json({
        requestId,
        status: record.status,
        approvalChain: record.approvalChain,
        clusterName: record.clusterName,
        clusterAdministrators: administrators,
        jumpboxName: record.jumpboxName,
        configFingerprint: record.configFingerprint,
        estimatedMonthlyCost: 0,
        planSummary: record.planSummary,
        mode: service.mode,
      });
    } catch (error) {
      if (error instanceof InFlightClaimConflictError) {
        res.status(409).json({ error: error.message, mode: service.mode });
        return;
      }
      const msg = errorMessage(error);
      logger.error(`[provisioning] submit failed: ${msg}`);
      res.status(500).json({
        error: 'Failed to create infrastructure request',
        mode: service.mode,
      });
    }
  };

  route.post('/submit', submitHandler);

  // POST /requests and POST /request: create draft or submit
  const createRequestHandler = async (req: Request, res: Response) => {
    const isDraft =
      req.body?.draft === true ||
      req.body?.status === 'DRAFT' ||
      req.body?.status === 'draft';

    if (isDraft) {
      const requestor = await requireUser(req, res);
      if (!requestor) return;
      const request = service.normalizeRequest(req.body);
      const requestId = generateRequestId();
      const now = new Date();
      const administrators = normalizeAdministrators(
        (req.body?.clusterAdministrators as string[] | undefined) ?? [],
      ).valid;

      const record = {
        requestId,
        requestor,
        customer: request.customer || 'Draft Customer',
        environment: request.env || 'dev',
        subscription: AKS_STANDARD_SUBSCRIPTION_ID,
        clusterName: request.customer
          ? deriveAksNames(request).clusterName
          : `aks-draft-${requestId}`,
        clusterProfile: request.clusterProfile || 'single-region',
        regions: request.location || 'australiaeast',
        nodeSize: request.systemPool?.vmSize || 'Standard_B2s',
        kubernetesVersion: request.kubernetesVersion || '1.36.2',
        estimatedMonthlyCost: 0,
        planSummary: service.estimatePlan(request),
        status: 'DRAFT',
        approvalChain: [],
        createdAt: now,
        updatedAt: now,
        logs: [`[${iso()}] Draft request created by ${requestor}`],
        payload: request,
        clusterAdministrators: administrators,
        accessStatus: 'Pending',
      } as unknown as InfrastructureRequest;

      try {
        applyConfiguration(record, request, administrators);
      } catch {
        // Tolerant for incomplete draft payloads
      }

      await store.create(record);
      void store.appendEvent({
        requestId,
        configFingerprint: record.configFingerprint,
        eventId: `draft-${requestId}`,
        sourceSystem: 'cloudhub',
        eventType: 'draft_created',
        normalizedStatus: 'pending',
        message: `Draft request ${requestId} created by ${requestor}`,
        step: 'configure',
        severity: 'info',
      });

      res.status(201).json(serializeRequest(record));
      return;
    }

    await submitHandler(req, res);
  };

  route.post('/requests', createRequestHandler);
  route.post('/request', createRequestHandler);

  // ── Amend: change a request before it is fully approved ───────────────────────
  // Only the requester may amend, and only while approval is still pending.
  // Any change to the approval-bound configuration resets every stage.
  const amendHandler = async (req: Request, res: Response) => {
    const actor = await requireUser(req, res);
    if (!actor) return;
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${requestId} not found` });
      return;
    }
    if (actor !== record.requestor) {
      res.status(403).json({
        ...serializeRequest(record),
        error: 'Only the requester can amend this request',
      });
      return;
    }
    if (!hasVerifiedRequestor(record) || !record.configFingerprint) {
      res.status(409).json({
        ...serializeRequest(record),
        error:
          'This request predates verified identities and approval integrity; reject it and submit a new request.',
      });
      return;
    }
    const isAmendable =
      record.status === 'pending_approval' ||
      (record.status as string) === 'DRAFT' ||
      (record.status as string) === 'draft';
    if (!isAmendable) {
      res.status(409).json({
        ...serializeRequest(record),
        error: `Cannot amend a request in status '${record.status}'; once fully approved, reject and resubmit instead.`,
      });
      return;
    }

    const request = service.normalizeRequest(req.body);
    const validation = service.validateRequest(request);
    if (validation.errors.length > 0) {
      res.status(400).json({
        error: validation.errors.join('; '),
        errors: validation.errors,
        fieldErrors: validation.fieldErrors,
      });
      return;
    }
    const { valid: administrators, invalid } = normalizeAdministrators(
      (req.body?.clusterAdministrators as string[] | undefined) ?? [],
    );
    if (invalid.length > 0 || administrators.length === 0) {
      res.status(400).json({
        error:
          invalid.length > 0
            ? `Invalid GitHub usernames for cluster administrators: ${invalid.join(
                ', ',
              )}`
            : 'At least one cluster administrator (GitHub username) is required',
      });
      return;
    }
    const chainRoles = approvalChains[request.clusterProfile] ?? [
      'Platform Team',
    ];
    const missingStages = unconfiguredStages(chainRoles);
    if (missingStages.length > 0) {
      res.status(422).json({
        error: `Profile '${
          request.clusterProfile
        }' requires approval stage(s) with no authorized approver group configured: ${missingStages.join(
          ', ',
        )}`,
      });
      return;
    }

    const gates = await runGates(request, chainRoles);
    if (gates.blocking) {
      res.status(412).json({
        ...serializeRequest(record),
        error:
          'Amendment blocked: every preflight check must pass (a check that cannot be verified also blocks).',
        gates,
      });
      return;
    }

    const previous = record.configFingerprint;
    applyConfiguration(record, request, administrators);
    if (record.configFingerprint === previous) {
      res.json(serializeRequest(record));
      return;
    }
    const invalidated = record.approvalChain.filter(
      stage => stage.status === 'approved',
    );
    record.approvalChain = chainRoles.map(role => ({
      role,
      status: 'pending' as const,
    }));
    record.planSummary = service.estimatePlan(request);
    record.logs.push(
      `[${iso()}] Amended by ${actor}: configuration ${previous} -> ${
        record.configFingerprint
      }`,
      ...invalidated.map(
        stage =>
          `[${iso()}] ${stage.role} approval by ${
            stage.approver
          } invalidated by the amendment`,
      ),
    );
    await store.save(record);
    res.json(serializeRequest(record));
  };

  route.post('/request/:requestId/amend', amendHandler);
  route.patch('/request/:requestId', amendHandler);
  route.patch('/requests/:requestId', amendHandler);

  // ── CloudHub Infrastructure Request inspection ──────────────────────────────────
  route.get('/requests', async (req, res) => {
    const viewer = await resolveViewer(req, res);
    if (!viewer) return;
    res.set('Cache-Control', 'no-store');
    const requests = (await store.list()).filter(
      record => viewer.approver || record.requestor === viewer.userRef,
    );
    res.json({
      requests: requests.map(serializeRequest),
    });
  });

  route.get('/request/:requestId', async (req, res) => {
    const record = await loadViewable(req, res, req.params.requestId);
    if (!record) return;
    res.set('Cache-Control', 'no-store');
    res.json(serializeRequest(record));
  });

  // ── Infrastructure execution tracking (read-only) ─────────────────────────────
  const executionView = (record: InfrastructureRequest) => {
    const trackability = tracker
      ? tracker.trackability(record)
      : {
          trackable: false as const,
          reason: 'Execution tracking is not configured on this backend',
        };
    return {
      requestId: record.requestId,
      requestStatus: record.status,
      clusterName: record.clusterName,
      prRepository: record.prRepository ?? null,
      prNumber: record.prNumber ?? null,
      prUrl: record.prUrl ?? null,
      trackable: trackability.trackable,
      notTrackableReason: trackability.trackable ? null : trackability.reason,
      execution: record.execution ?? null,
      ...executionFreshness(record.execution, new Date()),
    };
  };

  route.get('/request/:requestId/execution', async (req, res) => {
    const record = await loadViewable(req, res, req.params.requestId);
    if (!record) return;
    res.set('Cache-Control', 'no-store');
    res.json(executionView(record));
  });

  // Observes GitHub / Terraform Cloud and persists what it saw. Never writes
  // to either service; throttled so repeated polls reuse the stored result.
  route.post('/request/:requestId/execution/refresh', async (req, res) => {
    const record = await loadViewable(req, res, req.params.requestId);
    if (!record) return;
    res.set('Cache-Control', 'no-store');
    if (!tracker) {
      res.status(503).json(executionView(record));
      return;
    }
    const result = await tracker.refresh(record.requestId);
    res.json({
      ...executionView(result.record ?? record),
      refreshed: result.refreshed,
      refreshSkippedReason: result.refreshed ? null : result.reason ?? null,
    });
  });

  // ── Legacy requests (pre approval-integrity) ─────────────────────────────────
  route.get('/legacy-requests', async (req, res) => {
    const viewer = await resolveViewer(req, res);
    if (!viewer) return;
    if (!viewer.approver) {
      res
        .status(403)
        .json({ error: 'Only AKS approvers can list legacy requests' });
      return;
    }
    const legacy = (await store.list()).filter(
      record =>
        !record.configFingerprint &&
        !['rejected', 'completed', 'failed'].includes(record.status),
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      requests: legacy.map(record => ({
        requestId: record.requestId,
        requestor: record.requestor,
        clusterName: record.clusterName,
        status: record.status,
        createdAt: record.createdAt,
        prUrl: record.prUrl ?? null,
        tailscalePrUrl: record.tailscalePrUrl ?? null,
        action:
          'Retire in CloudHub, close any open PRs listed here manually, and resubmit through the current wizard',
      })),
    });
  });

  // Closes a legacy request inside CloudHub only. External PRs are listed in
  // the log for manual follow-up; CloudHub does not close or modify them.
  route.post('/request/:requestId/retire-legacy', async (req, res) => {
    const record = await store.get(req.params.requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${req.params.requestId} not found` });
      return;
    }
    const approver = await requireApprover(req, res, record, 'reject', [
      jumpboxApprovePermission,
    ]);
    if (!approver) return;
    if (record.configFingerprint) {
      res.status(409).json({
        ...serializeRequest(record),
        error:
          'Only legacy requests can be retired; use reject for current requests',
      });
      return;
    }
    if (['rejected', 'completed', 'failed'].includes(record.status)) {
      res.json(serializeRequest(record));
      return;
    }
    const reason =
      (req.body?.reason as string)?.trim() ||
      'Legacy request retired; resubmit through the current workflow';
    const openPrs = [record.prUrl, record.tailscalePrUrl].filter(Boolean);
    const previousStatus = record.status;
    record.status = 'rejected';
    record.error = reason;
    record.claimClusterName = null;
    record.claimAddressSpace = null;
    record.logs.push(
      `[${iso()}] Legacy request retired by ${approver} (was '${previousStatus}'): ${reason}`,
      ...(openPrs.length
        ? [
            `[${iso()}] CloudHub did not modify external PRs; close manually if still open: ${openPrs.join(
              ', ',
            )}`,
          ]
        : []),
    );
    await store.save(record);
    res.json(serializeRequest(record));
  });

  // ── CloudHub approval: advance one stage; run Git operations once fully approved ─
  const approveHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${requestId} not found` });
      return;
    }

    if (record.status === 'rejected') {
      res.status(409).json({
        ...serializeRequest(record),
        error: 'Request has been rejected',
      });
      return;
    }

    // Stages are decided strictly in chain order, each under its own
    // permission; there is no cross-stage fallback.
    const stage = record.approvalChain.find(s => s.status === 'pending');
    const definition = stage ? stageDefinition(stage.role) : undefined;
    if (stage && (!definition || unconfiguredStages([stage.role]).length)) {
      res.status(403).json({
        ...serializeRequest(record),
        error: `Approval stage '${stage.role}' has no authorized approver group configured`,
      });
      return;
    }
    const approver = await requireApprover(req, res, record, 'approve', [
      definition?.permission ?? jumpboxApprovePermission,
    ]);
    if (!approver) return;

    // Idempotent: once Git operations have started/completed, just return state.
    if (record.status !== 'pending_approval' || !stage) {
      res.json(serializeRequest(record));
      return;
    }

    const role = (req.body?.role as string | undefined)?.trim();
    if (role && role !== stage.role) {
      res.status(409).json({
        ...serializeRequest(record),
        error: `Stages are approved in order; the current stage is '${stage.role}'`,
      });
      return;
    }

    if (!hasVerifiedRequestor(record) || !record.configFingerprint) {
      res.status(409).json({
        ...serializeRequest(record),
        error:
          'This request predates verified requester identities and approval integrity and cannot be approved. Reject it and submit a new request.',
      });
      return;
    }
    const integrity = approvalIntegrityProblem(record, false);
    if (integrity) {
      await invalidateApprovals(record, integrity);
      res.status(409).json({
        ...serializeRequest(record),
        error: `${integrity}; all approvals have been reset and the request must be re-approved.`,
      });
      return;
    }

    if (approver === record.requestor) {
      if (!selfApprovalAllowed()) {
        res.status(403).json({
          ...serializeRequest(record),
          error: 'Requesters cannot approve their own infrastructure request',
        });
        return;
      }
      record.logs.push(
        `[${iso()}] WARNING: self-approval by requester ${approver} permitted by ALLOW_SELF_APPROVAL`,
      );
      logger.warn(
        `[provisioning] self-approval exception used on ${record.requestId} by ${approver}`,
      );
    }
    // Separation of duties: each stage needs a distinct approver.
    if (
      record.approvalChain.some(
        s => s.status === 'approved' && s.approver === approver,
      )
    ) {
      res.status(409).json({
        ...serializeRequest(record),
        error: `${approver} has already approved a stage of this request`,
      });
      return;
    }

    // The final approval starts external work, so re-run the mandatory
    // preflight against current state (allocations or quota may have changed
    // since submission). Nothing is recorded when it blocks.
    const isFinalStage =
      record.approvalChain.filter(s => s.status === 'pending').length === 1;
    if (isFinalStage) {
      const gates = await runGates(
        record.payload,
        record.approvalChain.map(s => s.role),
      );
      if (gates.blocking) {
        res.status(412).json({
          ...serializeRequest(record),
          error:
            'Final approval blocked: every preflight check must pass (a check that cannot be verified also blocks).',
          gates,
        });
        return;
      }
      record.logs.push(
        `[${iso()}] Preflight re-checked — ${gateSummary(gates)}`,
      );
    }

    stage.status = 'approved';
    stage.approver = approver;
    stage.decidedAt = iso();
    stage.fingerprint = record.configFingerprint;
    record.updatedAt = new Date();
    record.logs.push(
      `[${iso()}] ${stage.role} approved by ${approver} for configuration ${
        record.configFingerprint
      }`,
    );

    void store.appendEvent({
      requestId: record.requestId,
      configFingerprint: record.configFingerprint,
      eventId: `approve-${stage.role}-${stage.approver}-${record.requestId}`,
      sourceSystem: 'cloudhub',
      eventType: 'approval_granted',
      normalizedStatus: 'succeeded',
      message: `${stage.role} approved by ${approver}`,
      step: 'approval',
      severity: 'success',
    });

    const stillPending = record.approvalChain.some(s => s.status === 'pending');
    if (stillPending) {
      await store.save(record);
      res.json(serializeRequest(record));
      return;
    }

    // Persist the final decision before any external call. The versioned save
    // makes a concurrent duplicate approval fail here (409) rather than open a
    // second Tailscale PR.
    record.status = 'approved';
    await store.save(record);

    try {
      const administrators = normalizeAdministrators(
        record.clusterAdministrators ?? [],
      ).valid;
      if (administrators.length === 0) {
        throw new Error(
          'Request has no valid cluster administrators; cannot grant jumpbox access',
        );
      }

      const jumpboxName =
        record.jumpboxName ?? deriveJumpboxName(record.clusterName);
      record.jumpboxName = jumpboxName;
      record.accessStatus = 'PR Created';
      record.logs.push(
        `[${iso()}] CloudHub Approval Workflow APPROVED — starting Tailscale access step`,
      );
      // The Platform Registry is NOT touched here. The cluster does not exist
      // yet, and an UPDATE by name would rewrite the status of any existing
      // cluster that happens to share the name. Registration happens only once
      // the cluster is verified (later stage).

      if (record.tailscalePrNumber) {
        // Re-approval after an integrity reset: the access PR already exists.
        record.status = 'awaiting_tailscale_merge';
        record.accessStatus = 'Waiting Approval';
        record.logs.push(
          `[${iso()}] Re-approved; reusing Tailscale PR #${
            record.tailscalePrNumber
          }`,
        );
        await store.save(record);
        res.json(serializeRequest(record));
        return;
      }

      const result = await jumpboxService.provisionAccess({
        clusterName: record.clusterName,
        jumpboxName,
        clusterAdministrators: administrators,
      });

      record.tailscalePrUrl = result.prUrl;
      record.tailscalePrNumber = result.prNumber;
      record.tailscalePrStatus = 'open';
      record.accessStatus = 'Waiting Approval';
      record.status = 'awaiting_tailscale_merge';
      record.updatedAt = new Date();
      record.logs.push(
        `[${iso()}] Tailscale branch ${result.branch} created from ${
          jumpboxService.repo.baseBranch
        }`,
      );
      record.logs.push(
        `[${iso()}] policy.hujson updated and validated for ${jumpboxName} (${
          administrators.length
        } administrator(s))`,
      );
      record.logs.push(
        `[${iso()}] Tailscale PR #${result.prNumber} opened: ${result.prUrl}`,
      );
      record.logs.push(
        `[${iso()}] Waiting for Tailscale approval before AKS branch creation`,
      );
      await store.save(record);

      void store.appendEvent({
        requestId: record.requestId,
        configFingerprint: record.configFingerprint,
        eventId: `tailscale-pr-${result.prNumber}-${record.requestId}`,
        sourceSystem: 'github',
        eventType: 'access_pr_opened',
        normalizedStatus: 'in_progress',
        message: `Jumpbox access PR #${result.prNumber} opened in ${jumpboxService.repo.owner}/${jumpboxService.repo.repo}`,
        step: 'pull_request',
        severity: 'info',
        externalRef: result.prUrl,
        sourceUrl: result.prUrl,
      });

      res.json(serializeRequest(record));
    } catch (error) {
      const msg = errorMessage(error);
      record.status = 'failed';
      record.error = msg;
      record.updatedAt = new Date();
      record.logs.push(
        `[${iso()}] ERROR during Git branch preparation: ${msg}`,
      );
      await store.save(record);
      logger.error(
        `[provisioning] branch preparation failed for ${record.requestId}: ${msg}`,
      );
      res.status(500).json({ ...serializeRequest(record), error: msg });
    }
  };

  route.post('/request/:requestId/approve', approveHandler);
  route.post('/requests/:requestId/approve', approveHandler);

  // ── Infrastructure PR: explicit, authorized, idempotent workflow action ─────
  // The only route that creates the scp-infra-as-code branch and PR. It is
  // never reached by polling: the requester or an AKS approver must invoke it
  // after the Tailscale access PR has merged. Each step's identifiers are
  // persisted as soon as it succeeds, the service resumes an existing branch /
  // adopts an existing PR, and the versioned "preparing_infra_pr" claim stops
  // concurrent duplicates, so retries never create a second branch or PR.
  const INFRA_PR_START_STATUSES: InfrastructureRequestStatus[] = [
    'awaiting_tailscale_merge',
    'infra_pr_failed',
    'branch_ready',
  ];
  /** A claim older than this is treated as abandoned (process crash). */
  const INFRA_PR_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

  const createInfrastructurePr = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const viewer = await resolveViewer(req, res);
    if (!viewer) return;
    const record = await store.get(requestId);
    if (!record) {
      res.status(404).json({ error: `Request ${requestId} not found` });
      return;
    }
    if (!viewer.approver && viewer.userRef !== record.requestor) {
      res.status(403).json({
        error:
          'Only the requester or an AKS approver can create the infrastructure PR',
      });
      return;
    }
    // Idempotent: the PR already exists.
    if (record.prNumber && record.prRepository === INFRA_REPOSITORY) {
      res.json({ ...serializeRequest(record), alreadyCreated: true });
      return;
    }
    if (!hasVerifiedRequestor(record) || !record.configFingerprint) {
      res.status(409).json({
        ...serializeRequest(record),
        error:
          'This request predates approval integrity; retire it and submit a new request.',
      });
      return;
    }
    const previous = record.infraPrOperation ?? null;
    if (record.status === 'preparing_infra_pr') {
      const lastUpdate = Date.parse(previous?.updatedAt ?? '');
      if (
        Number.isFinite(lastUpdate) &&
        Date.now() - lastUpdate < INFRA_PR_CLAIM_TIMEOUT_MS
      ) {
        res.status(409).json({
          ...serializeRequest(record),
          error: 'The infrastructure PR is already being created',
        });
        return;
      }
    } else if (!INFRA_PR_START_STATUSES.includes(record.status)) {
      res.status(409).json({
        ...serializeRequest(record),
        error: `Cannot create the infrastructure PR while the request is '${record.status}'`,
      });
      return;
    }
    const integrity = approvalIntegrityProblem(record, true);
    if (integrity) {
      await invalidateApprovals(record, integrity);
      res.status(409).json({
        ...serializeRequest(record),
        error: `${integrity}; infrastructure PR not created, approvals reset.`,
      });
      return;
    }
    if (service.mode !== 'real') {
      res.status(503).json({
        ...serializeRequest(record),
        error:
          'GitHub credentials are not configured; set GITHUB_ACTIONS_TOKEN or GITHUB_TOKEN.',
      });
      return;
    }

    // Jumpbox access precedes infrastructure: the Tailscale PR must be merged,
    // verified live rather than trusted from stored state.
    if (record.status !== 'branch_ready') {
      if (!record.tailscalePrNumber) {
        res.status(409).json({
          ...serializeRequest(record),
          error: 'No Tailscale access PR is recorded for this request',
        });
        return;
      }
      if (jumpboxService.mode !== 'real') {
        res.status(503).json({
          ...serializeRequest(record),
          error:
            'GitHub credentials are not configured; cannot verify the Tailscale access PR.',
        });
        return;
      }
      let tailscale: { merged: boolean; state: string };
      try {
        tailscale = await jumpboxService.getPullRequestStatus(
          record.tailscalePrNumber,
        );
      } catch (error) {
        res.status(502).json({
          ...serializeRequest(record),
          error: `Could not verify Tailscale PR #${
            record.tailscalePrNumber
          }: ${errorMessage(error)}`,
        });
        return;
      }
      if (!tailscale.merged) {
        res.status(409).json({
          ...serializeRequest(record),
          error: `Tailscale access PR #${record.tailscalePrNumber} is not merged yet`,
        });
        return;
      }
      record.tailscalePrStatus = 'merged';
      if (record.accessStatus !== 'Applied') record.accessStatus = 'Merged';
    }

    const gates = await runGates(
      record.payload,
      record.approvalChain.map(stage => stage.role),
    );
    if (gates.blocking) {
      res.status(412).json({
        ...serializeRequest(record),
        error:
          'Infrastructure PR blocked: every preflight check must pass (a check that cannot be verified also blocks).',
        gates,
      });
      return;
    }

    // Claim (versioned save: a concurrent second action gets 409 here).
    const startedAt = iso();
    record.infraPrOperation = {
      state: 'in_progress',
      attempt: (previous?.attempt ?? 0) + 1,
      startedAt,
      startedBy: viewer.userRef,
      updatedAt: startedAt,
      repository: INFRA_REPOSITORY,
      branchName: previous?.branchName,
      commitSha: previous?.commitSha,
    };
    record.status = 'preparing_infra_pr';
    record.error = undefined;
    record.logs.push(
      `[${startedAt}] Infrastructure PR requested by ${
        viewer.userRef
      } (attempt ${record.infraPrOperation.attempt}); preflight — ${gateSummary(
        gates,
      )}`,
    );
    await store.save(record);

    const operation = record.infraPrOperation;
    try {
      const branch = await service.prepareFeatureBranch(record.payload);
      Object.assign(operation, {
        state: 'branch_ready',
        branchName: branch.featureBranch,
        commitSha: branch.commitSha,
        branchReused: branch.reused,
        updatedAt: iso(),
      });
      record.branchName = branch.featureBranch;
      record.commitSha = branch.commitSha;
      record.tfvarsPath = branch.tfvarsPath;
      record.logs.push(
        `[${iso()}] Branch ${branch.featureBranch} ${
          branch.reused ? 'resumed' : `created from ${BASE_BRANCH}`
        } in ${INFRA_REPOSITORY} (${branch.commitSha}): ${
          branch.tfvarsPath
        } + ${WORKSPACES_FILE}`,
      );
      await store.save(record);

      const pr = await service.createPullRequest(
        record.payload,
        branch.featureBranch,
        pullRequestContext(record),
      );
      Object.assign(operation, {
        state: 'completed',
        prNumber: pr.prNumber,
        prUrl: pr.prUrl,
        prReused: pr.reused,
        updatedAt: iso(),
      });
      record.prUrl = pr.prUrl;
      record.prNumber = pr.prNumber;
      record.prRepository = INFRA_REPOSITORY;
      record.execution = null;
      record.status = 'awaiting_pr_merge';
      record.logs.push(
        `[${iso()}] PR #${pr.prNumber} ${
          pr.reused ? 'adopted (already open)' : `opened into ${BASE_BRANCH}`
        }: ${
          pr.prUrl
        }. Merge requires the Quality Gate, CODEOWNERS review and a maintainer; CloudHub does not merge it.`,
      );
      await store.save(record);

      void store.appendEvent({
        requestId: record.requestId,
        configFingerprint: record.configFingerprint,
        eventId: `infra-pr-${pr.prNumber}-${record.requestId}`,
        sourceSystem: 'github',
        eventType: 'infra_pr_opened',
        normalizedStatus: 'in_progress',
        message: `Infrastructure PR #${pr.prNumber} opened in ${INFRA_REPOSITORY}`,
        step: 'pull_request',
        severity: 'info',
        externalRef: pr.prUrl,
        sourceUrl: pr.prUrl,
      });

      res.json(serializeRequest(record));
    } catch (error) {
      if (error instanceof ConcurrentModificationError) throw error;
      const msg = errorMessage(error);
      Object.assign(operation, {
        state: 'failed',
        error: msg,
        updatedAt: iso(),
      });
      record.status = 'infra_pr_failed';
      record.error = msg;
      record.logs.push(
        `[${iso()}] ERROR creating the infrastructure PR (retryable): ${msg}`,
      );
      await store.save(record);
      logger.error(
        `[provisioning] infrastructure PR failed for ${record.requestId}: ${msg}`,
      );
      res.status(502).json({ ...serializeRequest(record), error: msg });
    }
  };

  route.post('/request/:requestId/infrastructure-pr', createInfrastructurePr);
  route.post('/requests/:requestId/infrastructure-pr', createInfrastructurePr);
  // Kept for existing clients; same explicit action.
  route.post('/request/:requestId/create-pr', createInfrastructurePr);
  route.post('/requests/:requestId/create-pr', createInfrastructurePr);

  // ── PR status: stored tracking view (read-only, no refresh) ──────────────────
  // Refreshing is POST /request/:id/execution/refresh; a GET never changes
  // stored state or calls a write-capable service.
  const prStatusHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await loadViewable(req, res, requestId);
    if (!record) return;
    if (!record.prNumber) {
      res.status(409).json({ error: 'No PR number recorded on request' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    const view = executionView(record);
    if (!view.trackable) {
      res.status(409).json({
        ...view,
        error:
          view.notTrackableReason ??
          'Execution tracking is not configured on this backend',
      });
      return;
    }
    const pr = view.execution?.pullRequest ?? null;
    res.json({
      ...view,
      merged: pr?.merged ?? false,
      state: pr ? (pr.merged ? 'merged' : pr.state) : 'unknown',
      branchName: record.branchName,
    });
  };

  route.get('/request/:requestId/pr-status', prStatusHandler);
  route.get('/requests/:requestId/pr-status', prStatusHandler);

  const rejectHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${requestId} not found` });
      return;
    }

    // Rejection only closes the request, so either the current stage's
    // approvers or Platform Team approvers may reject.
    const pendingStage = record.approvalChain.find(s => s.status === 'pending');
    const pendingPermission = pendingStage
      ? stageDefinition(pendingStage.role)?.permission
      : undefined;
    const approver = await requireApprover(req, res, record, 'reject', [
      jumpboxApprovePermission,
      ...(pendingPermission ? [pendingPermission] : []),
    ]);
    if (!approver) return;

    // Idempotent: a second reject (double click, retry after a timeout) returns
    // the current state instead of an error.
    if (record.status === 'rejected') {
      res.json(serializeRequest(record));
      return;
    }

    if (record.status !== 'pending_approval') {
      res.status(409).json({
        ...serializeRequest(record),
        error: `Cannot reject a request in status '${record.status}'`,
      });
      return;
    }

    const reason =
      (req.body?.reason as string)?.trim() || 'Rejected by approver';
    const stage = record.approvalChain.find(s => s.status === 'pending');
    if (stage) {
      stage.status = 'rejected';
      stage.approver = approver;
      stage.decidedAt = iso();
    }
    record.status = 'rejected';
    record.error = reason;
    // Release the in-flight cluster-name / address-space claims.
    record.claimClusterName = null;
    record.claimAddressSpace = null;
    record.updatedAt = new Date();
    record.logs.push(`[${iso()}] Request REJECTED by ${approver}: ${reason}`);
    await store.save(record);
    logger.info(
      `[provisioning] request ${record.requestId} rejected by ${approver}`,
    );

    void store.appendEvent({
      requestId: record.requestId,
      configFingerprint: record.configFingerprint,
      eventId: `reject-${record.requestId}-${Date.now()}`,
      sourceSystem: 'cloudhub',
      eventType: 'approval_rejected',
      normalizedStatus: 'failed',
      message: `Request rejected by ${approver}: ${reason}`,
      step: 'approval',
      severity: 'error',
    });

    res.json(serializeRequest(record));
  };

  route.post('/request/:requestId/reject', rejectHandler);
  route.post('/requests/:requestId/reject', rejectHandler);

  // ── Unified API endpoints for self-service cluster creation ─────────────────

  // Record an authorized approval decision (approve or reject)
  const recordApprovalDecisionHandler = async (
    req: Request,
    res: Response,
  ) => {
    const decision = req.body?.decision;
    if (decision === 'reject') {
      return rejectHandler(req, res);
    }
    return approveHandler(req, res);
  };
  route.post('/request/:requestId/approvals', recordApprovalDecisionHandler);
  route.post('/requests/:requestId/approvals', recordApprovalDecisionHandler);

  // Explicitly create the access PR when eligible
  const createAccessPrHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${requestId} not found` });
      return;
    }
    if (record.tailscalePrUrl && record.tailscalePrNumber) {
      res.json({ ...serializeRequest(record), alreadyCreated: true });
      return;
    }
    const administrators = normalizeAdministrators(
      record.clusterAdministrators ?? [],
    ).valid;
    if (administrators.length === 0) {
      res
        .status(400)
        .json({ error: 'Request has no valid cluster administrators' });
      return;
    }
    const jumpboxName =
      record.jumpboxName ?? deriveJumpboxName(record.clusterName);
    const result = await jumpboxService.provisionAccess({
      clusterName: record.clusterName,
      jumpboxName,
      clusterAdministrators: administrators,
    });
    record.tailscalePrUrl = result.prUrl;
    record.tailscalePrNumber = result.prNumber;
    record.tailscalePrStatus = 'open';
    record.accessStatus = 'Waiting Approval';
    record.status = 'awaiting_tailscale_merge';
    await store.save(record);

    void store.appendEvent({
      requestId: record.requestId,
      configFingerprint: record.configFingerprint,
      eventId: `tailscale-pr-${result.prNumber}-${record.requestId}`,
      sourceSystem: 'github',
      eventType: 'access_pr_opened',
      normalizedStatus: 'in_progress',
      message: `Jumpbox access PR #${result.prNumber} opened in ${jumpboxService.repo.owner}/${jumpboxService.repo.repo}`,
      step: 'pull_request',
      severity: 'info',
      externalRef: result.prUrl,
      sourceUrl: result.prUrl,
    });

    res.json(serializeRequest(record));
  };
  route.post('/request/:requestId/access-pr', createAccessPrHandler);
  route.post('/requests/:requestId/access-pr', createAccessPrHandler);

  // POST /request/:requestId/validate: Preflight validation for a draft or existing request
  const validateRequestHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await loadViewable(req, res, requestId);
    if (!record) return;
    const request =
      req.body && Object.keys(req.body).length > 0 && req.body.customer
        ? service.normalizeRequest(req.body)
        : record.payload;
    const validation = service.validateRequest(request);
    const names = deriveAksNames(request);
    const gates =
      validation.errors.length === 0
        ? await runGates(
            request,
            approvalChains[request.clusterProfile] ?? ['Platform Team'],
          )
        : undefined;

    res.json({
      valid: validation.errors.length === 0,
      gates,
      fieldErrors: validation.fieldErrors,
      errors: validation.errors,
      warnings: service.estimatePlan(request).warnings,
      request,
      names,
      subnets: validation.fieldErrors.addressSpace
        ? undefined
        : deriveAksSubnets(request.addressSpace),
    });
  };
  route.post('/request/:requestId/validate', validateRequestHandler);
  route.post('/requests/:requestId/validate', validateRequestHandler);

  // POST /request/:requestId/submit: Submit a draft request for approval
  const submitDraftHandler = async (req: Request, res: Response) => {
    const caller = await requireUser(req, res);
    if (!caller) return;
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${requestId} not found` });
      return;
    }
    if (record.requestor !== caller) {
      const viewer = await resolveViewer(req, res);
      if (!viewer?.approver) {
        res.status(403).json({
          error: 'Only the requester or an approver can submit this request',
        });
        return;
      }
    }
    const isDraftState =
      (record.status as string) === 'DRAFT' ||
      (record.status as string) === 'draft' ||
      (record.status as string) === 'VALIDATING' ||
      (record.status as string) === 'validating';

    if (!isDraftState) {
      res.status(409).json({
        ...serializeRequest(record),
        error: `Cannot submit request in status '${record.status}'`,
      });
      return;
    }

    const payload =
      req.body && Object.keys(req.body).length > 0 && req.body.customer
        ? service.normalizeRequest(req.body)
        : record.payload;
    const validation = service.validateRequest(payload);
    if (validation.errors.length > 0) {
      res.status(400).json({
        error: validation.errors.join('; '),
        errors: validation.errors,
        fieldErrors: validation.fieldErrors,
      });
      return;
    }

    const administrators = normalizeAdministrators(
      (req.body?.clusterAdministrators as string[] | undefined) ??
        record.clusterAdministrators,
    ).valid;
    if (administrators.length === 0) {
      res.status(400).json({
        error:
          'At least one cluster administrator (GitHub username) is required',
      });
      return;
    }

    const chainRoles = approvalChains[payload.clusterProfile] ?? [
      'Platform Team',
    ];
    const missingStages = unconfiguredStages(chainRoles);
    if (missingStages.length > 0) {
      res.status(422).json({
        error: `Profile '${payload.clusterProfile}' requires approval stage(s) with no authorized approver group configured: ${missingStages.join(', ')}`,
      });
      return;
    }

    const gates = await runGates(payload, chainRoles);
    if (gates.blocking) {
      res.status(412).json({
        error: 'Submission blocked: every preflight check must pass',
        gates,
      });
      return;
    }

    applyConfiguration(record, payload, administrators);
    record.status = 'pending_approval';
    record.approvalChain = chainRoles.map(role => ({
      role,
      status: 'pending' as const,
    }));
    record.logs.push(`[${iso()}] Submitted for approval by ${caller}`);
    await store.save(record);

    void store.appendEvent({
      requestId: record.requestId,
      configFingerprint: record.configFingerprint,
      eventId: `submit-${record.requestId}`,
      sourceSystem: 'cloudhub',
      eventType: 'approval_requested',
      normalizedStatus: 'pending',
      message: `Approval requested for ${record.clusterName}`,
      step: 'approval',
      severity: 'info',
    });

    res.json(serializeRequest(record));
  };
  route.post('/request/:requestId/submit', submitDraftHandler);
  route.post('/requests/:requestId/submit', submitDraftHandler);

  // GET /request/:requestId/events: Retrieve persisted execution events
  const getEventsHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await loadViewable(req, res, requestId);
    if (!record) return;
    res.set('Cache-Control', 'no-store');
    const afterId = req.query.afterId ? Number(req.query.afterId) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const events = await store.getEvents(record.requestId, { afterId, limit });
    res.json({ requestId: record.requestId, events });
  };
  route.get('/request/:requestId/events', getEventsHandler);
  route.get('/requests/:requestId/events', getEventsHandler);

  // GET /request/:requestId/events/stream: Live SSE event stream
  const streamEventsHandler = async (req: Request, res: Response) => {
    const caller = await requireUser(req, res);
    if (!caller) return;
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res.status(404).json({ error: `Request ${requestId} not found` });
      return;
    }
    const viewer = await resolveViewer(req, res);
    if (!viewer?.approver && record.requestor !== caller) {
      res
        .status(403)
        .json({ error: 'You do not have permission to view this request' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();
    res.write(': stream opened\n\n');

    const lastEventIdHeader = req.headers['last-event-id'];
    const cursorStr =
      (Array.isArray(lastEventIdHeader)
        ? lastEventIdHeader[0]
        : lastEventIdHeader) ||
      (req.query.cursor as string) ||
      (req.query.afterId as string);
    const afterId = cursorStr ? parseInt(cursorStr, 10) : 0;

    const existingEvents = await store.getEvents(requestId, {
      afterId: isNaN(afterId) ? 0 : afterId,
      limit: 200,
    });
    for (const evt of existingEvents) {
      res.write(
        `id: ${evt.id}\nevent: execution_event\ndata: ${JSON.stringify(evt)}\n\n`,
      );
    }

    const unsubscribe = store.subscribeEvents(requestId, evt => {
      res.write(
        `id: ${evt.id}\nevent: execution_event\ndata: ${JSON.stringify(evt)}\n\n`,
      );
    });

    const heartbeatTimer = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
    });
  };
  router.get('/request/:requestId/events/stream', streamEventsHandler);
  router.get('/requests/:requestId/events/stream', streamEventsHandler);

  // POST /request/:requestId/cancel: Cancel a workflow safely
  const cancelWorkflowHandler = async (req: Request, res: Response) => {
    const caller = await requireUser(req, res);
    if (!caller) return;
    const requestId = String(req.params.requestId);
    const record = await store.get(requestId);
    if (!record) {
      res.status(404).json({ error: `Request ${requestId} not found` });
      return;
    }
    const viewer = await resolveViewer(req, res);
    if (!viewer?.approver && record.requestor !== caller) {
      res
        .status(403)
        .json({ error: 'You do not have permission to cancel this request' });
      return;
    }
    if (
      [
        'completed',
        'COMPLETED',
        'failed',
        'FAILED',
        'rejected',
        'APPROVAL_REJECTED',
      ].includes(record.status)
    ) {
      res.status(409).json({
        error: `Request ${requestId} is already in terminal status ${record.status}`,
      });
      return;
    }
    record.status = 'CANCEL_REQUESTED';
    record.claimClusterName = null;
    record.claimAddressSpace = null;
    record.logs.push(`[${iso()}] Cancellation requested by ${caller}`);
    await store.save(record);

    void store.appendEvent({
      requestId,
      configFingerprint: record.configFingerprint,
      eventId: `cancel-${requestId}-${Date.now()}`,
      sourceSystem: 'cloudhub',
      eventType: 'cancel_requested',
      normalizedStatus: 'cancelled',
      message: `Cancellation requested by ${caller}`,
      severity: 'warning',
    });

    res.json(serializeRequest(record));
  };
  route.post('/request/:requestId/cancel', cancelWorkflowHandler);
  route.post('/requests/:requestId/cancel', cancelWorkflowHandler);

  // POST /request/:requestId/addons/deploy: Deploy supported cluster add-ons
  const deployAddonHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await loadViewable(req, res, requestId);
    if (!record) return;
    const addon = req.body?.addon as SupportedClusterAddon;
    const validation = addonService.validateAddonPrerequisites(record, addon);
    if (!validation.eligible) {
      res.status(400).json({ error: validation.blocker });
      return;
    }
    const cached =
      record.readinessStatus ?? addonService.evaluateReadiness(record);
    const existingAddons = cached.details?.addons ?? {};
    existingAddons[addon] = {
      status: 'in_progress',
      message: `Addon ${addon} deployment initiated`,
    };
    cached.details = { ...cached.details, addons: existingAddons };
    record.readinessStatus = cached;
    await store.save(record);

    void store.appendEvent({
      requestId: record.requestId,
      configFingerprint: record.configFingerprint,
      eventId: `addon-${addon}-${record.requestId}-${Date.now()}`,
      sourceSystem: 'scripts',
      eventType: 'addon_deployment_started',
      normalizedStatus: 'in_progress',
      message: `Addon deployment started for ${addon}`,
      step: 'addons',
      severity: 'info',
    });

    res.json(serializeRequest(record));
  };
  route.post('/request/:requestId/addons/deploy', deployAddonHandler);
  route.post('/requests/:requestId/addons/deploy', deployAddonHandler);

  // POST /request/:requestId/verify: Evaluate and update four-tier readiness status
  const verifyOperationalHandler = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const record = await loadViewable(req, res, requestId);
    if (!record) return;
    const { readiness, events } =
      await addonService.verifyOperationalStatus(record);
    res.json({
      ...serializeRequest(record),
      readiness,
      verifiedEvents: events,
    });
  };
  route.post('/request/:requestId/verify', verifyOperationalHandler);
  route.post('/requests/:requestId/verify', verifyOperationalHandler);

  route.get('/task/:taskId', (req, res) => {
    const task = provisioningTasks.get(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: `Task ${req.params.taskId} not found` });
      return;
    }

    res.set('Cache-Control', 'no-store');

    let current: number;
    let percent: number;
    if (task.status === 'awaiting_pr_merge') {
      current = 3;
      percent = 75;
    } else if (task.status === 'completed') {
      current = 4;
      percent = 100;
    } else {
      current = 2;
      percent = 50;
    }

    res.json({
      taskId: task.taskId,
      status: task.status,
      clusterName: task.clusterName,
      progress: {
        current,
        total: 4,
        percent,
      },
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      error: task.error,
      prUrl: task.prUrl,
      prNumber: task.prNumber,
      branchName: task.branchName,
    });
  });

  route.get('/task/:taskId/logs', (req, res) => {
    const task = provisioningTasks.get(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: `Task ${req.params.taskId} not found` });
      return;
    }
    res.json({ taskId: task.taskId, logs: task.logs });
  });

  route.post('/task/:taskId/cancel', async (req, res) => {
    if (!(await requireUser(req, res))) return;
    const task = provisioningTasks.get(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: `Task ${req.params.taskId} not found` });
      return;
    }

    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      res.json({ taskId: task.taskId, status: task.status });
      return;
    }

    task.status = 'cancelled';
    task.completedAt = new Date();
    task.error = 'Cancelled by user';
    task.logs.push(`[${new Date().toISOString()}] Cancelled by user`);
    res.json({ taskId: task.taskId, status: task.status });
  });

  // ── Provision Tailscale jumpbox access ─────────────────────────────────────
  // Runs after the infrastructure PR is merged and Terraform apply has created
  // the AKS cluster and jumpbox. Updates the Platform Registry to "Pending
  // Access" and opens a PR against the Tailscale policy repository.
  route.post('/request/:requestId/provision-access', async (req, res) => {
    if (!(await requireUser(req, res))) return;
    const record = await store.get(req.params.requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${req.params.requestId} not found` });
      return;
    }
    // Opens a Tailscale PR: Platform Team approvers only.
    if (
      !(await requireApprover(req, res, record, 'approve', [
        jumpboxApprovePermission,
      ]))
    ) {
      return;
    }

    // Idempotent: if the access PR already exists, just return current state.
    if (
      record.status === 'awaiting_tailscale_merge' ||
      record.status === 'bootstrapping' ||
      record.status === 'validating' ||
      record.status === 'completed'
    ) {
      res.json(serializeRequest(record));
      return;
    }

    if (record.status !== 'awaiting_pr_merge') {
      res.status(409).json({
        ...serializeRequest(record),
        error: `Cannot provision access while request is '${record.status}'; infrastructure PR must be merged first`,
      });
      return;
    }

    // Current ordering opens the Tailscale PR at approval time; never open a
    // second one through this legacy route.
    if (record.tailscalePrNumber) {
      res.json(serializeRequest(record));
      return;
    }

    if (jumpboxService.mode !== 'real') {
      res.status(503).json({
        error:
          'GitHub credentials are not configured; set GITHUB_ACTIONS_TOKEN or GITHUB_TOKEN for Tailscale access provisioning.',
        mode: jumpboxService.mode,
      });
      return;
    }

    const administrators = normalizeAdministrators(
      record.clusterAdministrators ?? [],
    ).valid;
    if (administrators.length === 0) {
      res.status(400).json({
        ...serializeRequest(record),
        error:
          'Request has no valid cluster administrators; cannot grant jumpbox access',
      });
      return;
    }

    const jumpboxName =
      record.jumpboxName ?? deriveJumpboxName(record.clusterName);

    record.jumpboxName = jumpboxName;
    record.accessStatus = 'PR Created';
    // Claim before the external call (versioned save): a concurrent duplicate
    // fails here with 409 instead of opening a second Tailscale PR.
    await store.save(record);

    // Step 3-5: open the Tailscale policy PR (validated before commit).
    try {
      const result = await jumpboxService.provisionAccess({
        clusterName: record.clusterName,
        jumpboxName,
        clusterAdministrators: administrators,
      });

      record.tailscalePrUrl = result.prUrl;
      record.tailscalePrNumber = result.prNumber;
      record.tailscalePrStatus = 'open';
      record.accessStatus = 'Waiting Approval';
      record.status = 'awaiting_tailscale_merge';
      record.logs.push(
        `[${iso()}] Tailscale branch ${result.branch} created from ${
          jumpboxService.repo.baseBranch
        }`,
      );
      record.logs.push(
        `[${iso()}] policy.hujson updated and validated for ${jumpboxName} (${
          administrators.length
        } administrator(s))`,
      );
      record.logs.push(
        `[${iso()}] Tailscale PR #${result.prNumber} opened: ${result.prUrl}`,
      );
      record.logs.push(
        `[${iso()}] Waiting for Tailscale approval before bootstrap`,
      );
      await store.save(record);

      res.json(serializeRequest(record));
    } catch (error) {
      const msg = errorMessage(error);
      record.accessStatus = 'Failed';
      record.error = msg;
      record.logs.push(`[${iso()}] ERROR opening Tailscale PR: ${msg}`);
      await store.save(record);
      logger.error(
        `[provisioning] tailscale access failed for ${record.requestId}: ${msg}`,
      );
      res.status(500).json({ ...serializeRequest(record), error: msg });
    }
  });

  // ── Tailscale access status (strictly read-only) ────────────────────────────
  // Reads the Tailscale PR from GitHub and reports it. It never persists,
  // never creates branches or PRs, and never advances the workflow: once the
  // access PR is merged, the infrastructure PR is created only by the
  // explicit POST /request/:id/infrastructure-pr action.
  route.get('/request/:requestId/access-status', async (req, res) => {
    const record = await loadViewable(req, res, req.params.requestId);
    if (!record) return;
    res.set('Cache-Control', 'no-store');

    let observed: { merged: boolean; state: string } | null = null;
    let observeError: string | null = null;
    if (record.tailscalePrNumber && jumpboxService.mode === 'real') {
      try {
        observed = await jumpboxService.getPullRequestStatus(
          record.tailscalePrNumber,
        );
      } catch (error) {
        observeError = errorMessage(error);
        logger.warn(
          `[provisioning] tailscale PR status check failed for ${record.requestId}: ${observeError}`,
        );
      }
    }
    const merged = observed
      ? observed.merged
      : record.tailscalePrStatus === 'merged';
    const infraPrActionAvailable =
      merged &&
      !record.prNumber &&
      Boolean(record.configFingerprint) &&
      (record.status === 'awaiting_tailscale_merge' ||
        record.status === 'infra_pr_failed') &&
      approvalIntegrityProblem(record, true) === null;

    res.json({
      requestStatus: record.status,
      accessStatus:
        merged && record.accessStatus !== 'Applied'
          ? 'Merged'
          : record.accessStatus ?? 'Pending',
      tailscalePrStatus: observed
        ? observed.merged
          ? 'merged'
          : observed.state
        : record.tailscalePrStatus,
      tailscalePrUrl: record.tailscalePrUrl,
      merged,
      observedLive: Boolean(observed),
      observeError,
      infraPrActionAvailable,
      infraPrOperation: record.infraPrOperation ?? null,
      branchName: record.branchName,
      commitSha: record.commitSha,
      tfvarsPath: record.tfvarsPath,
      prUrl: record.prUrl,
      prNumber: record.prNumber,
    });
  });

  // ── Complete access ────────────────────────────────────────────────────────
  // Previously wrote bootstrap/validation log lines and marked the cluster
  // Ready without executing anything. Refuse until core-services deployment
  // and verification are driven by real, tracked operations.
  route.post('/request/:requestId/complete-access', async (req, res) => {
    if (!(await requireUser(req, res))) return;
    const record = await store.get(req.params.requestId);
    if (!record) {
      res
        .status(404)
        .json({ error: `Request ${req.params.requestId} not found` });
      return;
    }
    res.status(501).json({
      ...serializeRequest(record),
      error:
        'Cluster bootstrap and validation are not implemented; the request cannot be marked complete until core services are deployed and verified.',
    });
  });

  route.get('/mode', (_req, res) => {
    res.json({
      mode: service.mode,
      repo: INFRA_REPOSITORY,
      baseBranch: BASE_BRANCH,
      tfvarsDir: AKS_VALUES_DIR,
      workspacesFile: WORKSPACES_FILE,
      tailscale: {
        mode: jumpboxService.mode,
        repo: `${jumpboxService.repo.owner}/${jumpboxService.repo.repo}`,
        baseBranch: jumpboxService.repo.baseBranch,
        policyPath: jumpboxService.repo.policyPath,
      },
    });
  });

  // Terminal handler: any failure that escapes a route still answers JSON, so
  // the frontend never has to parse an ingress-generated HTML error page.
  router.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      const msg = errorMessage(error);
      if (
        error instanceof ConcurrentModificationError ||
        error instanceof InFlightClaimConflictError
      ) {
        if (!res.headersSent) res.status(409).json({ error: msg });
        return;
      }
      logger.error(
        `[provisioning] unhandled error on ${req.method} ${req.originalUrl}: ${msg}`,
      );
      if (res.headersSent) return;
      res.status(500).json({ error: msg });
    },
  );

  return router;
}
