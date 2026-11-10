import { Router, json as expressJson } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type {
  BackstageCredentials,
  HttpAuthService,
  LoggerService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import {
  canCreateDeveloperEnvironment,
  canDeleteDeveloperEnvironment,
  canDeployOverlay,
  canDeployApplication,
  canDeployPlatform,
  canProvisionInfrastructure,
  canRead,
  canApproveDeployment,
  resolvePersonaRole,
  personaFromRole,
} from './rbac';
import type {
  CreateDeveloperEnvironmentRequest,
  CreateWorkspaceRequest,
  PersonaRole,
  ProvisionRequest,
} from './types';
import { ControlPlaneService } from './services/controlPlaneService';
import type { GitHubAuthorizationService } from './services/githubAuthorizationService';
import type {
  GitHubRepositoryService,
  RepositoryVisibility,
} from './services/githubRepositoryService';

interface RouterDeps {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  service: ControlPlaneService;
  gitHubAuthorizationService: GitHubAuthorizationService;
  gitHubRepositoryService: GitHubRepositoryService;
}

export function createControlPlaneRouter(deps: RouterDeps): Router {
  const {
    httpAuth,
    userInfo,
    service,
    gitHubAuthorizationService,
    gitHubRepositoryService,
  } = deps;
  const router = Router();
  router.use(expressJson());

  // Express 4 does not catch rejections from async handlers: the request hangs
  // until the ingress times out and replies with an HTML error page, which the
  // frontend then fails to parse as JSON. Wrap every handler registered below
  // so a failure always ends in a JSON response.
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const register = router[method].bind(router) as (
      path: string,
      ...handlers: RequestHandler[]
    ) => Router;
    (router as unknown as Record<string, unknown>)[method] = (
      path: string,
      ...handlers: RequestHandler[]
    ) =>
      register(
        path,
        ...handlers.map(
          (handler): RequestHandler =>
            (req, res, next) => {
              try {
                Promise.resolve(handler(req, res, next)).catch(next);
              } catch (error) {
                next(error);
              }
            },
        ),
      );
  }

  const subscriptionIdRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  function portalErrorStatus(error: unknown): number {
    const status = (error as { status?: unknown })?.status;
    return typeof status === 'number' && status >= 400 && status < 600
      ? status
      : 500;
  }

  async function access(
    req: Request,
    res: Response,
  ): Promise<{
    credentials: BackstageCredentials;
    actorRef: string;
    role: PersonaRole;
    groups: string[];
  } | null> {
    try {
      const credentials = await httpAuth.credentials(
        req as unknown as Parameters<typeof httpAuth.credentials>[0],
        { allow: ['user'] },
      );
      const info = await userInfo.getUserInfo(credentials);
      const rawGroups: unknown = info.ownershipEntityRefs;
      const groups: string[] = Array.isArray(rawGroups)
        ? rawGroups.filter((ref): ref is string => typeof ref === 'string')
        : typeof rawGroups === 'string'
        ? rawGroups
            .split(',')
            .map((group: string) => group.trim())
            .filter((group: string) => Boolean(group))
        : [];
      const actorRef = info.userEntityRef ?? 'unknown';
      const role = resolvePersonaRole(groups, actorRef);

      deps.logger.info(
        `[deployment-control-plane] access ctx: actorRef=${actorRef}, groups=${JSON.stringify(
          groups,
        )}`,
      );

      // Do not fall back to header/query persona. Require real directory group
      // memberships to determine role; otherwise leave the resolved role as-is
      // which will be determined from `ownershipEntityRefs` returned by the
      // identity provider.

      return { credentials, actorRef, role, groups };
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  router.get('/health', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    res.json(service.getRuntimeHealth());
  });

  router.get('/clusters/discover', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const subscriptionId = String(req.query.subscriptionId ?? '');
      if (!subscriptionId) {
        res.status(400).json({ error: 'subscriptionId is required' });
        return;
      }
      if (!subscriptionIdRe.test(subscriptionId)) {
        res.status(400).json({ error: 'subscriptionId must be a valid UUID' });
        return;
      }

      const items = await service.discoverAks({
        subscriptionId,
        region: req.query.region as string | undefined,
        environment: req.query.environment as string | undefined,
        resourceGroup: req.query.resourceGroup as string | undefined,
      });

      res.json({ items });
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  router.get('/resource-groups', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const subscriptionId = String(req.query.subscriptionId ?? '');
      if (!subscriptionId) {
        res.status(400).json({ error: 'subscriptionId is required' });
        return;
      }
      if (!subscriptionIdRe.test(subscriptionId)) {
        res.status(400).json({ error: 'subscriptionId must be a valid UUID' });
        return;
      }

      const items = await service.discoverResourceGroups({
        subscriptionId,
        search: req.query.search as string | undefined,
      });

      res.json({ items });
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  router.get('/subnets', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const subscriptionId = String(req.query.subscriptionId ?? '');
      if (!subscriptionId) {
        res.status(400).json({ error: 'subscriptionId is required' });
        return;
      }
      if (!subscriptionIdRe.test(subscriptionId)) {
        res.status(400).json({ error: 'subscriptionId must be a valid UUID' });
        return;
      }

      const items = await service.discoverSubnets({
        subscriptionId,
        search: req.query.search as string | undefined,
      });

      res.json({ items });
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  router.post('/clusters/register', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canProvisionInfrastructure(ctx.role)) {
      res
        .status(403)
        .json({ error: 'Only platform-admin can register clusters' });
      return;
    }

    const body = req.body as {
      cluster?: any;
      tenantId?: string;
      nodePools?: Array<{
        name: string;
        vmSize: string;
        nodeCount: number;
        mode: string;
      }>;
    };

    if (!body.cluster?.clusterName || !body.cluster?.subscriptionId) {
      res.status(400).json({ error: 'cluster metadata is required' });
      return;
    }

    if (!body.cluster?.resourceGroup) {
      res.status(400).json({
        error:
          'cluster.resourceGroup is required to verify CloudHub onboarding tags',
      });
      return;
    }

    try {
      await service.assertClusterOnboarded({
        subscriptionId: String(body.cluster.subscriptionId),
        resourceGroup: String(body.cluster.resourceGroup),
        clusterName: String(body.cluster.clusterName),
      });
    } catch (error) {
      res.status(403).json({ error: toErrorMessage(error) });
      return;
    }

    const item = await service.registerCluster({
      cluster: body.cluster,
      tenantId: body.tenantId,
      nodePools: body.nodePools,
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.status(201).json(item);
  });

  router.get('/clusters', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const items = await service.listClusters();
    res.json({ items });
  });

  router.get('/development-profiles', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const items = await service.listDevelopmentProfiles();
    res.json({ items });
  });

  router.get('/development-profiles/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const item = await service.getDevelopmentProfile(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Development profile not found' });
      return;
    }
    res.json(item);
  });

  router.get('/developer-environments/options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const options = await service.getDeveloperEnvironmentOptions();
    res.json(options);
  });

  router.get('/workspace-templates', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const items = await service.listWorkspaceTemplates();
    res.json({ items });
  });

  router.get('/workspaces/options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const options = await service.getDeveloperWorkspaceOptions();
    res.json(options);
  });

  router.get('/workspaces/preflight', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    try {
      const componentId =
        typeof req.query.componentId === 'string' &&
        req.query.componentId.trim().length > 0
          ? req.query.componentId.trim()
          : undefined;
      const developmentProfileId =
        typeof req.query.developmentProfileId === 'string' &&
        req.query.developmentProfileId.trim().length > 0
          ? req.query.developmentProfileId.trim()
          : undefined;
      const report = await service.getWorkspaceProvisioningPreflight({
        ...(componentId ? { componentId } : {}),
        ...(developmentProfileId ? { developmentProfileId } : {}),
        dependencies: {
          postgresql:
            String(req.query.postgresql ?? '').toLowerCase() === 'true',
          kafka: String(req.query.kafka ?? '').toLowerCase() === 'true',
          temporal: String(req.query.temporal ?? '').toLowerCase() === 'true',
        },
      });
      res.json(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get('/workspaces', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const ownerTeam = String(req.query.ownerTeam ?? '').trim() || undefined;
    const requestedBy =
      ctx.role === 'platform-admin' ? undefined : ctx.actorRef;
    const includeDeleted =
      String(req.query.includeDeleted ?? '').toLowerCase() === 'true';

    const items = await service.listWorkspaces({
      ownerTeam,
      requestedBy,
      includeDeleted,
    });
    res.json({ items });
  });

  router.get('/workspaces/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const item = await service.getWorkspace(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (ctx.role !== 'platform-admin' && item.requestedBy !== ctx.actorRef) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    res.json(item);
  });

  router.get('/workspaces/:id/connection', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const item = await service.getWorkspace(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (ctx.role !== 'platform-admin' && item.requestedBy !== ctx.actorRef) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const connection = await service.getWorkspaceConnection({
        id: req.params.id,
      });
      res.json(connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/connection/session', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const item = await service.getWorkspace(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (ctx.role !== 'platform-admin' && item.requestedBy !== ctx.actorRef) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const session = await service.createWorkspaceConnectionSession({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('INVALID')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.get('/workspaces/:id/audit-logs', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const item = await service.getWorkspace(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (ctx.role !== 'platform-admin' && item.requestedBy !== ctx.actorRef) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    const sinceRaw = String(req.query.since ?? '').trim();
    const since = sinceRaw.length > 0 ? sinceRaw : undefined;
    if (since && Number.isNaN(Date.parse(since))) {
      res.status(400).json({ error: 'since must be a valid ISO timestamp' });
      return;
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

    const items = await service.listWorkspaceAuditLogs({
      workspaceId: req.params.id,
      since,
      limit,
    });

    res.json({ items });
  });

  router.get('/workspaces/:id/logs/stream', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const workspaceId = req.params.id;
    const item = await service.getWorkspace(workspaceId);
    if (!item) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (ctx.role !== 'platform-admin' && item.requestedBy !== ctx.actorRef) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    const sinceRaw = String(req.query.since ?? '').trim();
    let lastAuditSince: string | undefined;
    if (sinceRaw.length > 0) {
      if (Number.isNaN(Date.parse(sinceRaw))) {
        res.status(400).json({ error: 'since must be a valid ISO timestamp' });
        return;
      }
      lastAuditSince = sinceRaw;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let running = false;
    let lastStatusSnapshot = '';

    const send = (event: string, data: Record<string, unknown>) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const terminalStatuses = new Set(['READY', 'FAILED', 'STOPPED', 'DELETED']);

    const tick = async () => {
      if (closed || running) return;
      running = true;
      try {
        const [workspace, logs] = await Promise.all([
          service.getWorkspace(workspaceId),
          service.listWorkspaceAuditLogs({
            workspaceId,
            since: lastAuditSince,
            limit: 200,
          }),
        ]);

        if (!workspace) {
          send('error', { message: 'Workspace not found' });
          closed = true;
          res.end();
          return;
        }

        for (const log of logs) {
          send('audit', log as unknown as Record<string, unknown>);
        }
        const newest = logs[logs.length - 1];
        if (newest?.createdAt) {
          lastAuditSince = newest.createdAt;
        }

        const statusSnapshot = `${workspace.status}|${
          workspace.statusMessage ?? ''
        }|${workspace.failureReason ?? ''}`;
        if (statusSnapshot !== lastStatusSnapshot) {
          lastStatusSnapshot = statusSnapshot;
          send('status', {
            status: workspace.status,
            statusMessage: workspace.statusMessage,
            failureReason: workspace.failureReason,
            updatedAt: workspace.updatedAt,
          });
        } else {
          send('heartbeat', { at: new Date().toISOString() });
        }

        if (terminalStatuses.has(workspace.status)) {
          send('done', {
            status: workspace.status,
            statusMessage: workspace.statusMessage,
            failureReason: workspace.failureReason,
            updatedAt: workspace.updatedAt,
          });
          closed = true;
          res.end();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send('error', { message });
      } finally {
        running = false;
      }
    };

    send('connected', {
      workspaceId,
      at: new Date().toISOString(),
    });

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1500);

    req.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
  });

  router.get('/workspaces/:id/workspace', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const workspace = await service.getWorkspaceWorkspace({
        id: req.params.id,
      });
      res.json(workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/workspace/validate', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const workspace = await service.validateWorkspaceWorkspace({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/workspace/generate', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const generated = await service.generateWorkspaceWorkspace({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(generated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.get('/workspaces/:id/ci-workflow', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const workflow = await service.getWorkspaceCiWorkflow({
        id: req.params.id,
      });
      res.json(workflow);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/ci-workflow/validate', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const workflow = await service.validateWorkspaceCiWorkflow({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(workflow);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/ci-workflow/generate', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const generated = await service.generateWorkspaceCiWorkflow({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(generated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.get('/workspaces/:id/deployments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    const items = await service.listApplicationDeployments({
      developerEnvironmentId: req.params.id,
    });
    res.json({ items });
  });

  router.post('/workspaces/:id/deployments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getWorkspace(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    const body = req.body as {
      source?: {
        branch?: string;
        commitSha?: string;
      };
    };

    try {
      const item = await service.createApplicationDeployment({
        developerEnvironmentId: req.params.id,
        source: {
          branch: body.source?.branch ?? environment.sourceBranch,
          commitSha: body.source?.commitSha,
        },
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('NOT_ALLOWED') || message.includes('UNAUTHORIZED')) {
        res.status(403).json({ error: message });
        return;
      }
      if (message.includes('REQUIRED') || message.includes('INVALID')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.get('/workspaces/:id/deployments/:deploymentId', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getDeveloperEnvironment(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    const item = await service.getApplicationDeployment({
      deploymentId: req.params.deploymentId,
    });

    if (!item || item.developerEnvironmentId !== req.params.id) {
      res.status(404).json({ error: 'Application deployment not found' });
      return;
    }

    res.json(item);
  });

  router.post(
    '/workspaces/:id/deployments/:deploymentId/sync',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
        });
        return;
      }

      try {
        const item = await service.syncApplicationDeploymentStatus({
          deploymentId: req.params.deploymentId,
          actorRef: ctx.actorRef,
          role: ctx.role,
        });
        if (item.developerEnvironmentId !== req.params.id) {
          res.status(404).json({ error: 'Application deployment not found' });
          return;
        }
        res.json(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NOT_FOUND')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  router.post('/workspaces', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canCreateDeveloperEnvironment(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform, app-engineering, or professional-services can create workspaces',
      });
      return;
    }

    try {
      const request = req.body as CreateWorkspaceRequest;
      const record = await service.createWorkspace({
        request,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(201).json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (
        message.includes('UNAUTHORIZED') ||
        message.includes('DISABLED') ||
        message.includes('UNSUPPORTED')
      ) {
        res.status(403).json({ error: message });
        return;
      }
      if (
        message.includes('INVALID') ||
        message.includes('REQUIRED') ||
        message.includes('NOT_CONFIGURED') ||
        message.includes('PRECHECK_FAILED')
      ) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/start', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const existing = await service.getWorkspace(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (
      ctx.role !== 'platform-admin' &&
      existing.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const item = await service.resumeWorkspace({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('INVALID')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/resume', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const existing = await service.getWorkspace(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (
      ctx.role !== 'platform-admin' &&
      existing.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const item = await service.resumeWorkspace({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('INVALID')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/workspaces/:id/stop', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const existing = await service.getWorkspace(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (
      ctx.role !== 'platform-admin' &&
      existing.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    try {
      const item = await service.stopWorkspace({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.json(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('INVALID')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.delete('/workspaces/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeleteDeveloperEnvironment(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin and app-engineering can delete workspaces',
      });
      return;
    }

    const existing = await service.getWorkspace(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      existing.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this workspace',
      });
      return;
    }

    const deleted = await service.deleteWorkspace({
      id: req.params.id,
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.json({ item: deleted });
  });

  router.get('/developer-environments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const ownerTeam = String(req.query.ownerTeam ?? '').trim() || undefined;
    const requestedBy =
      ctx.role === 'platform-admin' ? undefined : ctx.actorRef;
    const includeDeleted =
      String(req.query.includeDeleted ?? '').toLowerCase() === 'true';

    const items = await service.listDeveloperEnvironments({
      ownerTeam,
      requestedBy,
      includeDeleted,
    });
    res.json({ items });
  });

  router.get('/developer-environments/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const item = await service.getDeveloperEnvironment(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Developer environment not found' });
      return;
    }

    if (ctx.role !== 'platform-admin' && item.requestedBy !== ctx.actorRef) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      });
      return;
    }

    res.json(item);
  });

  router.get('/developer-environments/:id/workspace', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getDeveloperEnvironment(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Developer environment not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      });
      return;
    }

    try {
      const workspace = await service.getDeveloperEnvironmentWorkspace({
        id: req.params.id,
      });
      res.json(workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/developer-environments/:id/workspace/validate',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Developer environment not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
        });
        return;
      }

      try {
        const workspace = await service.validateDeveloperEnvironmentWorkspace({
          id: req.params.id,
          actorRef: ctx.actorRef,
          role: ctx.role,
        });
        res.json(workspace);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NOT_FOUND')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  router.post(
    '/developer-environments/:id/workspace/generate',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Developer environment not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
        });
        return;
      }

      try {
        const generated = await service.generateDeveloperEnvironmentWorkspace({
          id: req.params.id,
          actorRef: ctx.actorRef,
          role: ctx.role,
        });
        res.json(generated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NOT_FOUND')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  router.get('/developer-environments/:id/ci-workflow', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getDeveloperEnvironment(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Developer environment not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      });
      return;
    }

    try {
      const workflow = await service.getDeveloperEnvironmentCiWorkflow({
        id: req.params.id,
      });
      res.json(workflow);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/developer-environments/:id/ci-workflow/validate',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Developer environment not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
        });
        return;
      }

      try {
        const workflow = await service.validateDeveloperEnvironmentCiWorkflow({
          id: req.params.id,
          actorRef: ctx.actorRef,
          role: ctx.role,
        });
        res.json(workflow);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NOT_FOUND')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  router.post(
    '/developer-environments/:id/ci-workflow/generate',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Developer environment not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
        });
        return;
      }

      try {
        const generated = await service.generateDeveloperEnvironmentCiWorkflow({
          id: req.params.id,
          actorRef: ctx.actorRef,
          role: ctx.role,
        });
        res.json(generated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NOT_FOUND')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  router.get('/developer-environments/:id/deployments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getDeveloperEnvironment(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Developer environment not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      });
      return;
    }

    const items = await service.listApplicationDeployments({
      developerEnvironmentId: req.params.id,
    });
    res.json({ items });
  });

  router.post('/developer-environments/:id/deployments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const environment = await service.getDeveloperEnvironment(req.params.id);
    if (!environment) {
      res.status(404).json({ error: 'Developer environment not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      environment.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      });
      return;
    }

    const body = req.body as {
      source?: {
        branch?: string;
        commitSha?: string;
      };
    };

    try {
      const item = await service.createApplicationDeployment({
        developerEnvironmentId: req.params.id,
        source: {
          branch: body.source?.branch ?? environment.sourceBranch,
          commitSha: body.source?.commitSha,
        },
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (message.includes('NOT_ALLOWED') || message.includes('UNAUTHORIZED')) {
        res.status(403).json({ error: message });
        return;
      }
      if (message.includes('REQUIRED') || message.includes('INVALID')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.get(
    '/developer-environments/:id/deployments/:deploymentId',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Developer environment not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
        });
        return;
      }

      const item = await service.getApplicationDeployment({
        deploymentId: req.params.deploymentId,
      });

      if (!item || item.developerEnvironmentId !== req.params.id) {
        res.status(404).json({ error: 'Application deployment not found' });
        return;
      }

      res.json(item);
    },
  );

  router.post(
    '/developer-environments/:id/deployments/:deploymentId/sync',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const environment = await service.getDeveloperEnvironment(req.params.id);
      if (!environment) {
        res.status(404).json({ error: 'Developer environment not found' });
        return;
      }

      if (
        ctx.role !== 'platform-admin' &&
        environment.requestedBy !== ctx.actorRef
      ) {
        res.status(403).json({
          error:
            'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
        });
        return;
      }

      try {
        const item = await service.syncApplicationDeploymentStatus({
          deploymentId: req.params.deploymentId,
          actorRef: ctx.actorRef,
          role: ctx.role,
        });
        if (item.developerEnvironmentId !== req.params.id) {
          res.status(404).json({ error: 'Application deployment not found' });
          return;
        }
        res.json(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NOT_FOUND')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  router.post('/developer-environments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canCreateDeveloperEnvironment(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform, app-engineering, or professional-services can create developer environments',
      });
      return;
    }

    try {
      const request = req.body as CreateDeveloperEnvironmentRequest;
      const record = await service.createDeveloperEnvironment({
        request,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(201).json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOT_FOUND')) {
        res.status(404).json({ error: message });
        return;
      }
      if (
        message.includes('UNAUTHORIZED') ||
        message.includes('DISABLED') ||
        message.includes('UNSUPPORTED')
      ) {
        res.status(403).json({ error: message });
        return;
      }
      if (
        message.includes('INVALID') ||
        message.includes('REQUIRED') ||
        message.includes('NOT_CONFIGURED')
      ) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.delete('/developer-environments/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeleteDeveloperEnvironment(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform-admin and app-engineering can delete developer environments',
      });
      return;
    }

    const existing = await service.getDeveloperEnvironment(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Developer environment not found' });
      return;
    }

    if (
      ctx.role !== 'platform-admin' &&
      existing.requestedBy !== ctx.actorRef
    ) {
      res.status(403).json({
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      });
      return;
    }

    const deleted = await service.deleteDeveloperEnvironment({
      id: req.params.id,
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.json({ item: deleted });
  });

  router.post('/infrastructure/provision', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canProvisionInfrastructure(ctx.role)) {
      res
        .status(403)
        .json({ error: 'Only platform-admin can provision infrastructure' });
      return;
    }

    const requestPayload = req.body as ProvisionRequest;
    const result = await service.provisionInfrastructure({
      request: requestPayload,
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.status(202).json(result);
  });

  router.post('/platform/deploy', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res
        .status(403)
        .json({ error: 'Only platform-admin can deploy platform stack' });
      return;
    }

    const body = req.body as { clusterId?: string; platformVersion?: string };
    if (!body.clusterId || !body.platformVersion) {
      res
        .status(400)
        .json({ error: 'clusterId and platformVersion are required' });
      return;
    }

    const result = await service.deployPlatform({
      clusterId: body.clusterId,
      platformVersion: body.platformVersion,
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.status(202).json(result);
  });

  // ─── Deployment Portal (self-service Helmfile deploy wizard) ───────────────
  //
  // These endpoints back the unified scripts-pipeline deployment wizard. The
  // backend validates metadata and targets; SymphonyFS/scripts owns execution.

  router.get('/deployments/options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    res.json(await service.getPortalDeploymentOptions());
  });

  router.post('/deployments/preview', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const required = ['application', 'instanceName', 'clusterName', 'customer'];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }
    res.json(
      await service.previewPortalHelmfile({
        application: String(body.application),
        instanceName: String(body.instanceName),
        clusterName: body.clusterName ? String(body.clusterName) : undefined,
        customer: String(body.customer),
        chartVersion: body.chartVersion ? String(body.chartVersion) : '',
        aiStoreIntegration: Boolean(body.aiStoreIntegration),
      }),
    );
  });

  router.post('/deployments/secret-readiness', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const required = ['application', 'instanceName'];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    try {
      const report = await service.getPortalDeploymentSecretReadiness({
        application: String(body.application),
        instanceName: String(body.instanceName),
        customer: typeof body.customer === 'string' ? body.customer : '',
        vault: typeof body.vault === 'string' ? body.vault : undefined,
        clusterName: body.clusterName ? String(body.clusterName) : undefined,
        includePipelineRefs:
          body.includePipelineRefs === undefined
            ? true
            : Boolean(body.includePipelineRefs),
        forceRefresh: Boolean(body.forceRefresh),
      });
      res.json(report);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/common-res-preflight', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const clusterName =
      typeof body.clusterName === 'string' ? body.clusterName.trim() : '';
    const subscriptionId =
      typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    const resourceGroup =
      typeof body.resourceGroup === 'string' ? body.resourceGroup.trim() : '';
    if (!clusterName || !subscriptionId || !resourceGroup) {
      res.status(400).json({
        error: 'clusterName, subscriptionId, and resourceGroup are required',
      });
      return;
    }

    try {
      res.json(
        await service.getCommonResPreflight({
          subscriptionId,
          resourceGroup,
          clusterName,
          namespace:
            typeof body.namespace === 'string' ? body.namespace : undefined,
        }),
      );
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/detect-mode', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const application =
      typeof body.application === 'string' ? body.application.trim() : '';
    const instanceName =
      typeof body.instanceName === 'string' ? body.instanceName.trim() : '';
    const customer =
      typeof body.customer === 'string' ? body.customer.trim() : '';
    if (!application || !instanceName || !customer) {
      res.status(400).json({
        error: 'application, instanceName, and customer are required',
      });
      return;
    }

    try {
      res.json(
        await service.detectDeploymentMode({
          application,
          instanceName,
          customer,
          vault: typeof body.vault === 'string' ? body.vault : undefined,
          targetChartVersion:
            typeof body.targetChartVersion === 'string'
              ? body.targetChartVersion
              : undefined,
          clusterName:
            typeof body.clusterName === 'string' ? body.clusterName : undefined,
          subscriptionId:
            typeof body.subscriptionId === 'string'
              ? body.subscriptionId
              : undefined,
          resourceGroup:
            typeof body.resourceGroup === 'string'
              ? body.resourceGroup
              : undefined,
        }),
      );
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/deployments/:id/secret-readiness', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const record = await service.getPortalDeployment(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }

    try {
      const report = await service.getPortalDeploymentSecretReadiness({
        application: record.application,
        instanceName: record.instanceName,
        customer: record.customer,
        vault:
          typeof record.workflowInputs?.onePasswordVault === 'string'
            ? record.workflowInputs.onePasswordVault
            : undefined,
        clusterName: record.cluster,
        includePipelineRefs: true,
      });
      res.json(report);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/secret-provision', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const required = ['application', 'instanceName', 'customer'];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    try {
      const result = await service.provisionPortalDeploymentSecrets({
        application: String(body.application),
        instanceName: String(body.instanceName),
        customer: String(body.customer),
        vault: body.vault ? String(body.vault) : undefined,
        clusterName: body.clusterName ? String(body.clusterName) : undefined,
        applicationReleaseVersion: body.applicationReleaseVersion
          ? String(body.applicationReleaseVersion)
          : undefined,
        actorRef: ctx.actorRef,
        role: ctx.role,
        bootstrapCustomerStructure: body.bootstrapCustomerStructure === true,
        entityResolutionChartVersion: body.entityResolutionChartVersion
          ? String(body.entityResolutionChartVersion)
          : undefined,
      });
      res.status(202).json(result);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/seed-pipeline-refs', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const required = [
      'application',
      'instanceName',
      'customer',
      'chartVersion',
    ];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    try {
      await service.seedPortalPipelineRefs({
        application: String(body.application),
        instanceName: String(body.instanceName),
        customer: String(body.customer),
        vault: body.vault ? String(body.vault) : undefined,
        chartVersion: String(body.chartVersion),
        overlayRef: body.overlayRef ? String(body.overlayRef) : undefined,
      });
      res.status(202).json({ success: true });
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  // Streams the *real* 1Password provisioning run: every generated field is
  // actually written to 1Password as the loop below executes, and each
  // step (connect, scan, generate, write, verify) is pushed to the client
  // the instant it happens via SSE — this is not a simulated/precomputed log.
  router.get('/deployments/secret-provision-stream', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const application = req.query.application
      ? String(req.query.application)
      : '';
    const instanceName = req.query.instanceName
      ? String(req.query.instanceName)
      : '';
    const customer = req.query.customer ? String(req.query.customer) : '';
    const vault = req.query.vault ? String(req.query.vault) : undefined;
    const clusterName = req.query.clusterName
      ? String(req.query.clusterName)
      : undefined;
    const applicationReleaseVersion = req.query.applicationReleaseVersion
      ? String(req.query.applicationReleaseVersion)
      : undefined;
    const bootstrapCustomerStructure =
      req.query.bootstrapCustomerStructure === 'true';
    const entityResolutionChartVersion = req.query.entityResolutionChartVersion
      ? String(req.query.entityResolutionChartVersion)
      : undefined;

    const required: Array<[string, string]> = [
      ['application', application],
      ['instanceName', instanceName],
      ['customer', customer],
    ];
    const missing = required.filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const send = (event: string, data: Record<string, unknown>) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const shutdown = () => {
      closed = true;
    };
    req.on('close', shutdown);
    res.on('close', shutdown);

    // Comment frames keep proxies (nginx, Azure Front Door) from dropping an
    // otherwise idle stream while 1Password calls are in flight.
    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);

    try {
      const result = await service.provisionPortalDeploymentSecrets({
        application,
        instanceName,
        customer,
        vault,
        clusterName,
        applicationReleaseVersion,
        actorRef: ctx.actorRef,
        role: ctx.role,
        bootstrapCustomerStructure,
        entityResolutionChartVersion,
        onProgress: event =>
          send('log', event as unknown as Record<string, unknown>),
      });
      clearInterval(heartbeat);
      send('done', result as unknown as Record<string, unknown>);
    } catch (error) {
      clearInterval(heartbeat);
      send('error', {
        message: toErrorMessage(error),
        status: portalErrorStatus(error),
      });
    } finally {
      clearInterval(heartbeat);
      if (!closed) {
        res.end();
      }
    }
  });

  router.get('/deployments/secret-provision/:operationId', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    try {
      const status = await service.getPortalSecretProvisionStatus(
        req.params.operationId,
      );
      if (!status) {
        res
          .status(404)
          .json({ error: 'Secret provisioning operation not found' });
        return;
      }
      res.json(status);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get(
    '/deployments/secret-fields/:application/:instanceName/:customer',
    async (req, res) => {
      const ctx = await access(req, res);
      if (!ctx) return;
      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      try {
        const fields = await service.getPortalSecretFieldsNeedingValues({
          application: decodeURIComponent(req.params.application),
          instanceName: decodeURIComponent(req.params.instanceName),
          customer: decodeURIComponent(req.params.customer),
          vault: req.query.vault ? String(req.query.vault) : undefined,
          clusterName: req.query.clusterName
            ? String(req.query.clusterName)
            : undefined,
          forceRefresh: req.query.forceRefresh === 'true',
        });
        res.json(fields);
      } catch (error) {
        res
          .status(portalErrorStatus(error))
          .json({ error: toErrorMessage(error) });
      }
    },
  );

  router.post('/deployments/secret-fields/update', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Update access denied' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const required = [
      'application',
      'instanceName',
      'customer',
      'vault',
      'item',
      'field',
      'value',
    ];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    try {
      const result = await service.updatePortalSecretFieldValue({
        application: String(body.application),
        instanceName: String(body.instanceName),
        customer: String(body.customer),
        vault: String(body.vault),
        item: String(body.item),
        section: body.section ? String(body.section) : null,
        field: String(body.field),
        value: String(body.value),
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(result);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployApplication(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform-admin or app-engineering can create application deployments',
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const required = ['application', 'instanceName', 'clusterName', 'customer'];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }
    if (
      body.deploymentId &&
      !subscriptionIdRe.test(String(body.deploymentId))
    ) {
      res.status(400).json({ error: 'deploymentId must be a valid UUID' });
      return;
    }
    if (
      body.subscriptionId &&
      !subscriptionIdRe.test(String(body.subscriptionId))
    ) {
      res.status(400).json({ error: 'subscriptionId must be a valid UUID' });
      return;
    }

    try {
      const record = await service.createPortalDeployment({
        id: body.deploymentId ? String(body.deploymentId) : undefined,
        application: String(body.application),
        instanceName: String(body.instanceName),
        clusterName: body.clusterName ? String(body.clusterName) : undefined,
        customer: String(body.customer),
        onePasswordVault: body.vault ? String(body.vault) : undefined,
        chartVersion: body.chartVersion ? String(body.chartVersion) : '',
        aiStoreIntegration: Boolean(body.aiStoreIntegration),
        configureSkupper: Boolean(body.configureSkupper),
        triggerFailover: Boolean(body.triggerFailover),
        actionValidation: Boolean(body.actionValidation),
        acceptance: Boolean(body.acceptance),
        instanceMode:
          body.instanceMode === 'existing' || body.instanceMode === 'new'
            ? body.instanceMode
            : 'auto',
        helmfilePath: body.helmfilePath ? String(body.helmfilePath) : undefined,
        helmfileContent: body.helmfileContent
          ? String(body.helmfileContent)
          : undefined,
        start: Boolean(body.start),
        actorRef: ctx.actorRef,
        role: ctx.role,
        subscriptionId: body.subscriptionId
          ? String(body.subscriptionId)
          : undefined,
        resourceGroup: body.resourceGroup
          ? String(body.resourceGroup)
          : undefined,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/deployments', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    res.json({ deployments: await service.listPortalDeployments() });
  });

  router.get('/deployments/instances', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    res.json({
      instances: await service.listPortalDeploymentInstances(
        typeof req.query.application === 'string'
          ? req.query.application
          : undefined,
      ),
    });
  });

  router.get('/deployments/pending-approvals', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const deployments = await service.listPortalDeployments();
    const pending = deployments.filter(
      (d: any) => d.status === 'PENDING' || d.status === 'PENDING_APPROVAL',
    );
    res.json({ deployments: pending });
  });

  router.get('/deployments/pending-approvals/count', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const deployments = await service.listPortalDeployments();
    const pendingCount = deployments.filter(
      (d: any) => d.status === 'PENDING' || d.status === 'PENDING_APPROVAL',
    ).length;
    res.json({ pending: pendingCount });
  });

  router.post('/deployments/:id/send-for-approval', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployApplication(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform-admin or app-engineering can submit deployments for approval',
      });
      return;
    }
    try {
      const note = (req.body as { note?: unknown })?.note;
      const record = await service.submitPortalDeploymentForApproval({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
        note: typeof note === 'string' ? note : undefined,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/app-instance-check', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    try {
      const body = req.body as {
        application?: string;
        instanceName?: string;
        branch?: string;
      };
      const result = await service.verifyPortalAppInstanceExists({
        application: String(body.application ?? ''),
        instanceName: String(body.instanceName ?? ''),
        branch: typeof body.branch === 'string' ? body.branch : undefined,
      });
      res.json(result);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/:id/approve', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canApproveDeployment(ctx.groups, ctx.actorRef)) {
      deps.logger.warn(
        `[deployment-control-plane] rejected approval for actorRef=${
          ctx.actorRef
        }, groups=${JSON.stringify(ctx.groups)}`,
      );
      res.status(403).json({
        error:
          'Only members of Entra group GRP-CloudHub-PlatformAdmin can approve deployments',
      });
      return;
    }
    try {
      const note = (req.body as { note?: unknown })?.note;
      const record = await service.approvePortalDeployment({
        id: req.params.id,
        approverRef: ctx.actorRef,
        role: ctx.role,
        note: typeof note === 'string' ? note : undefined,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/:id/reject', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canApproveDeployment(ctx.groups, ctx.actorRef)) {
      res.status(403).json({
        error:
          'Only members of Entra group GRP-CloudHub-PlatformAdmin can reject deployments',
      });
      return;
    }
    try {
      const note = (req.body as { note?: unknown })?.note;
      const record = await service.rejectPortalDeployment({
        id: req.params.id,
        approverRef: ctx.actorRef,
        role: ctx.role,
        note: typeof note === 'string' ? note : undefined,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/:id/diff', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployApplication(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin or app-engineering can run deployment diff',
      });
      return;
    }

    try {
      const note = (req.body as { note?: unknown })?.note;
      const status = await service.runPortalDeploymentDiff({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
        note: typeof note === 'string' ? note : undefined,
      });
      res.status(202).json(status);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/deployments/:id/diff/status', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    try {
      const status = await service.getPortalDeploymentDiffStatus(req.params.id);
      if (!status) {
        res.status(404).json({ error: 'Deployment diff not found' });
        return;
      }
      res.json(status);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/webhooks/github/workflow-runs', async (req, res) => {
    const payload = req.body as Record<string, unknown>;
    const workflowRun =
      (payload.workflow_run as Record<string, unknown> | undefined) ??
      (payload.workflowRun as Record<string, unknown> | undefined) ??
      payload;
    const runId = String(
      workflowRun.id ??
        workflowRun.workflow_run_id ??
        payload.workflowRunId ??
        '',
    );
    if (!runId) {
      res.status(400).json({ error: 'workflow run id is required' });
      return;
    }

    const status = String(workflowRun.status ?? payload.status ?? 'queued') as
      | 'queued'
      | 'in_progress'
      | 'completed';
    const conclusion =
      (workflowRun.conclusion as string | null | undefined) ??
      (payload.conclusion as string | null | undefined) ??
      null;
    const htmlUrl =
      (workflowRun.html_url as string | null | undefined) ??
      (payload.htmlUrl as string | null | undefined) ??
      null;

    try {
      const record = await service.syncPortalDeploymentWorkflowRun({
        workflowRunId: runId,
        status,
        conclusion,
        htmlUrl,
      });
      if (!record) {
        res
          .status(404)
          .json({ error: 'Deployment not found for workflow run' });
        return;
      }
      res.json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  // ─── Deployment approvals (GRP-CloudHub-PlatformAdmin gate) ────────────────
  // Registered before /deployments/:id so 'approvals' is not matched as an id.

  router.get('/deployments/approvals/permissions', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    res.json({ canApprove: canApproveDeployment(ctx.groups, ctx.actorRef) });
  });

  router.post('/deployments/approvals', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res.status(403).json({ error: 'Deployment creation denied' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const required = ['application', 'instanceName', 'clusterName', 'customer'];
    const missing = required.filter(key => !body[key]);
    if (missing.length > 0) {
      res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }
    try {
      const record = await service.createPortalDeployment({
        application: String(body.application),
        instanceName: String(body.instanceName),
        customer: String(body.customer),
        onePasswordVault: body.vault ? String(body.vault) : undefined,
        chartVersion: String(body.chartVersion),
        clusterName: body.clusterName ? String(body.clusterName) : undefined,
        subscriptionId: body.subscriptionId
          ? String(body.subscriptionId)
          : undefined,
        resourceGroup: body.resourceGroup
          ? String(body.resourceGroup)
          : undefined,
        aiStoreIntegration: Boolean(body.aiStoreIntegration),
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(201).json({ ...record, status: 'PENDING' });
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/deployments/approvals', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const status = req.query.status as string | undefined;
    const allowed = ['PENDING', 'APPROVED', 'REJECTED'];
    const filter =
      status && allowed.includes(status)
        ? (status as 'PENDING' | 'APPROVED' | 'REJECTED')
        : undefined;
    res.json({
      approvals: (await service.listPortalDeployments())
        .filter(
          deployment =>
            !filter ||
            (filter === 'PENDING'
              ? deployment.status === 'PENDING' ||
                deployment.status === 'PENDING_APPROVAL'
              : deployment.status === filter),
        )
        .map(deployment => ({
          ...deployment,
          status:
            deployment.status === 'PENDING_APPROVAL'
              ? 'PENDING'
              : deployment.status,
        })),
      canApprove: canApproveDeployment(ctx.groups, ctx.actorRef),
    });
  });

  router.get('/deployments/approvals/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const record = await service.getPortalDeployment(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    res.json({
      ...record,
      status: record.status === 'PENDING_APPROVAL' ? 'PENDING' : record.status,
      canApprove: canApproveDeployment(ctx.groups, ctx.actorRef),
    });
  });

  router.post('/deployments/approvals/:id/approve', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canApproveDeployment(ctx.groups, ctx.actorRef)) {
      res.status(403).json({
        error:
          'Only members of Entra group GRP-CloudHub-PlatformAdmin can approve deployments',
      });
      return;
    }
    try {
      const note = (req.body as { note?: unknown })?.note;
      const record = await service.approvePortalDeployment({
        id: req.params.id,
        approverRef: ctx.actorRef,
        role: ctx.role,
        note: typeof note === 'string' ? note : undefined,
      });
      res.json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/deployments/approvals/:id/reject', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canApproveDeployment(ctx.groups, ctx.actorRef)) {
      res.status(403).json({
        error:
          'Only members of Entra group GRP-CloudHub-PlatformAdmin can reject deployments',
      });
      return;
    }
    try {
      const note = (req.body as { note?: unknown })?.note;
      const record = await service.rejectPortalDeployment({
        id: req.params.id,
        approverRef: ctx.actorRef,
        role: ctx.role,
        note: typeof note === 'string' ? note : undefined,
      });
      res.json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/deployments/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const record = await service.getPortalDeployment(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }
    res.json(record);
  });

  router.get('/deployments/:id/status', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const status = await service.getPortalDeploymentStatus(req.params.id);
    if (!status) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }
    res.json(status);
  });

  router.get('/deployments/:id/health-check', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    try {
      res.json(await service.checkPortalDeploymentHealth(req.params.id));
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/deployments/:id/logs/stream', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let lastStatusSnapshot = '';
    let unsubscribe: (() => void) | null = null;
    let poll: NodeJS.Timeout | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const send = (event: string, data: Record<string, unknown>) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const shutdown = () => {
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'REJECTED']);

    // Resolve the status through getPortalDeploymentStatus (not the raw
    // record): that call reconciles the record against the live GitHub Actions
    // run, which is the only thing that ever moves a dispatched deployment from
    // QUEUED to DEPLOYING/SUCCEEDED/FAILED. Reading the record alone leaves the
    // stream reporting "queued" for the whole run.
    const sendStatus = async () => {
      if (closed) return;
      const status = await service.getPortalDeploymentStatus(req.params.id);
      if (!status) {
        send('error', { message: 'Deployment not found' });
        shutdown();
        res.end();
        return;
      }

      const statusSnapshot = `${status.status}|${status.currentStep}|${
        status.statusMessage ?? ''
      }|${status.failureReason ?? ''}|${status.workflowRunId ?? ''}|${
        status.commitSha ?? ''
      }|${status.updatedAt}`;
      if (statusSnapshot !== lastStatusSnapshot) {
        lastStatusSnapshot = statusSnapshot;
        send('status', status as unknown as Record<string, unknown>);
      }

      if (terminalStatuses.has(status.status)) {
        send('done', status as unknown as Record<string, unknown>);
        shutdown();
        res.end();
      }
    };

    const safeSendStatus = () =>
      sendStatus().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        send('error', { message });
      });

    const bootstrap = await Promise.all([
      service.getPortalDeployment(req.params.id),
      service.getPortalDeploymentEvents(req.params.id),
    ]);
    const record = bootstrap[0];
    const events = bootstrap[1];

    if (!record) {
      send('error', { message: 'Deployment not found' });
      res.end();
      return;
    }

    for (const event of events) {
      send('log', event as unknown as Record<string, unknown>);
    }
    await safeSendStatus();

    if (!closed) {
      unsubscribe = service.onDeploymentEvent(req.params.id, event => {
        if (closed) return;
        send('log', event as unknown as Record<string, unknown>);
        void safeSendStatus();
      });

      // The event bus only fires while the backend itself drives the
      // deployment (render → commit → dispatch). Once the GitHub workflow owns
      // the run there are no more local events, so poll for the run outcome.
      poll = setInterval(() => void safeSendStatus(), 5000);

      // Comment frames keep proxies (nginx, Azure Front Door) from dropping an
      // otherwise idle stream.
      heartbeat = setInterval(() => {
        if (closed) return;
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 15000);
    }

    req.on('close', shutdown);
    res.on('close', shutdown);
  });

  router.get('/deployments/:id/events', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }
    const events = await service.getPortalDeploymentEvents(req.params.id);
    res.json({ events });
  });

  router.post('/deployments/:id/retry', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res
        .status(403)
        .json({ error: 'Only platform-admin can retry deployments' });
      return;
    }
    try {
      const record = await service.retryPortalDeployment({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  // ─── Provisioner Webhooks ───────────────────────────────────────────────────
  //
  // Webhook endpoints for external provisioners (SRI-Provisional) to post
  // status updates. These are unauthenticated since they're called by backend
  // services with secure tokens.

  router.post('/webhooks/provisioner/status', async (req, res) => {
    try {
      const { deploymentId, status, message } = req.body;

      if (!deploymentId || !status) {
        res.status(400).json({
          error: 'Missing required fields: deploymentId, status',
        });
        return;
      }

      await service.updateSriProvisionalDeploymentStatus({
        deploymentId,
        status,
        message: message || null,
      });

      res.status(200).json({ success: true });
    } catch (error) {
      deps.logger.warn(`Provisioner webhook error: ${toErrorMessage(error)}`);
      res.status(500).json({ error: toErrorMessage(error) });
    }
  });

  // ─── GPU Compute (self-service GPU VM provisioning) ────────────────────────
  //
  // Single GPU_COMPUTE_ACCESS gate for every GPU route (view/create/delete).
  // Primary source is Entra ID group membership, with one explicit super-user
  // override: platform-admin (platform admin) always has GPU admin access.

  async function requireGpuAccess(
    ctx: { actorRef: string; groups: string[]; role: PersonaRole },
    res: Response,
    action: string,
  ): Promise<boolean> {
    if (ctx.role === 'platform-admin') {
      return true;
    }

    const authz = await service.getGpuAuthorization({
      groups: ctx.groups,
      actorRef: ctx.actorRef,
    });
    if (!authz.authorized) {
      await service.audit({
        actorRef: ctx.actorRef,
        role: 'readonly',
        action: 'gpu-authorization.deny',
        targetType: 'gpu-compute',
        payload: { requestedAction: action },
      });
      res.status(403).json({
        error: 'GPU_ACCESS_DENIED',
        message:
          'You are not authorized to access GPU Compute. Please contact the Cloud Platform team for access.',
      });
      return false;
    }
    return true;
  }

  router.get('/gpu-instances/permissions', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (ctx.role === 'platform-admin') {
      res.json({
        authorized: true,
        role: 'GPU_ADMIN',
        groupId: process.env.GPU_ENTRA_GROUP_ID?.trim() || null,
        source: 'persona',
      });
      return;
    }

    const authz = await service.getGpuAuthorization({
      groups: ctx.groups,
      actorRef: ctx.actorRef,
    });
    res.json(authz);
  });

  router.get('/persona/permissions', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    res.json({
      actorRef: ctx.actorRef,
      groups: ctx.groups,
      role: ctx.role,
      persona: personaFromRole(ctx.role),
      authorized: true,
    });
  });

  // ─── Low-cost self-service test VMs ──────────────────────────────────────
  // Available to all authenticated personas. Test VM endpoints are not
  // restricted by the GPU Compute entitlement gate.

  router.get('/test-vms/options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    res.json(service.getTestVmOptions());
  });

  router.get('/test-vms', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    try {
      res.json({ instances: await service.listTestVms() });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/test-vms', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const body = req.body as { name?: string; vmSize?: string; owner?: string };
    try {
      const record = await service.createTestVm({
        name: String(body.name ?? '').trim(),
        vmSize: body.vmSize,
        owner: body.owner,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(201).json(record);
    } catch (error) {
      const status =
        error instanceof Error && 'status' in error
          ? Number((error as { status?: number }).status) || 400
          : 400;
      res.status(status).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get('/test-vms/:id/status', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const record = await service.refreshTestVmStatus(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Test VM not found' });
      return;
    }
    res.json(record);
  });

  router.delete('/test-vms/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    try {
      res.json(
        await service.deleteTestVm({
          id: req.params.id,
          actorRef: ctx.actorRef,
          role: ctx.role,
        }),
      );
    } catch (error) {
      const status =
        error instanceof Error && 'status' in error
          ? Number((error as { status?: number }).status) || 400
          : 400;
      res.status(status).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── Azure foundation resources (Terraform module backed) ───────────────

  router.get('/azure-foundation/options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    res.json(service.getAzureFoundationOptions());
  });

  router.get('/azure-foundation/requests', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    try {
      res.json({ instances: await service.listAzureFoundationResources() });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/azure-foundation/requests', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const body = req.body as {
      resourceType?: string;
      name?: string;
      properties?: Record<string, unknown>;
    };

    try {
      const record = await service.createAzureFoundationResource({
        resourceType: String(body.resourceType ?? '') as
          | 'resource-group'
          | 'vnet-subnet'
          | 'key-vault'
          | 'storage-account',
        name: String(body.name ?? '').trim(),
        properties: body.properties ?? {},
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(201).json(record);
    } catch (error) {
      const status =
        error instanceof Error && 'status' in error
          ? Number((error as { status?: number }).status) || 400
          : 400;
      res.status(status).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get('/azure-foundation/requests/:id/status', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    const record = await service.refreshAzureFoundationResourceStatus(
      req.params.id,
    );
    if (!record) {
      res.status(404).json({ error: 'Azure foundation request not found' });
      return;
    }
    res.json(record);
  });

  router.get('/gpu-instances/options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Compute Options'))) return;
    res.json(await service.getGpuComputeOptions());
  });

  router.get('/gpu-instances/vnets', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU VNets'))) return;
    const gpuSkuRaw = String(req.query.gpuSku ?? '').trim();
    const gpuSku =
      gpuSkuRaw === 'a100' || gpuSkuRaw === 'h100' ? gpuSkuRaw : undefined;
    try {
      res.json({ items: await service.getGpuVnets({ gpuSku }) });
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/gpu-instances/network-profiles', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Network Profiles')))
      return;
    try {
      res.json(service.getGpuNetworkProfileDiagnostics());
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/gpu-instances/network-options', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Network Options'))) return;
    const gpuSku = String(req.query.gpuSku ?? '');
    const vnetName = String(req.query.vnetName ?? '');
    const subscriptionId = String(req.query.subscriptionId ?? '');
    const region = String(req.query.region ?? '');
    if (
      (gpuSku !== 'a100' && gpuSku !== 'h100') ||
      !subscriptionId ||
      !vnetName ||
      !region
    ) {
      res.status(400).json({
        error:
          'gpuSku (a100|h100), subscriptionId, vnetName, and region are required',
      });
      return;
    }
    try {
      res.json({
        items: await service.getGpuNetworkOptions({
          gpuSku,
          subscriptionId,
          vnetName,
          region,
        }),
      });
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/gpu-instances/quota-check', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'Check GPU Quota'))) return;
    const body = req.body as { gpuSku?: 'a100' | 'h100'; region?: string };
    if (!body.gpuSku || !body.region) {
      res.status(400).json({ error: 'gpuSku and region are required' });
      return;
    }
    try {
      const result = await service.checkGpuQuota({
        gpuSku: body.gpuSku,
        region: body.region,
      });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  router.get('/gpu-instances', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Instances'))) return;
    const items = await service.listGpuInstances();
    res.json({ items });
  });

  router.get('/gpu-instances/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Instance'))) return;
    const item = await service.getGpuInstance(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'GPU instance not found' });
      return;
    }
    res.json(item);
  });

  router.get('/gpu-instances/:id/status', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Instance Status'))) return;
    const item = await service.refreshGpuInstanceStatus(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'GPU instance not found' });
      return;
    }
    res.json(item);
  });

  router.post('/gpu-instances', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'Create GPU Instance'))) return;

    const body = req.body as {
      name?: string;
      gpuSku?: 'a100' | 'h100';
      region?: string;
      subscriptionId?: string;
      vnetName?: string;
      subnetName?: string;
      owner?: string;
      businessJustification?: string;
      leaseDuration?: string;
    };

    if (
      !body.name ||
      !body.gpuSku ||
      !body.region ||
      !body.subscriptionId ||
      !body.vnetName ||
      !body.subnetName ||
      !body.owner ||
      !body.businessJustification ||
      !body.leaseDuration
    ) {
      res.status(400).json({
        error:
          'name, gpuSku, region, subscriptionId, vnetName, subnetName, owner, businessJustification, and leaseDuration are required',
      });
      return;
    }

    try {
      const record = await service.createGpuInstance({
        name: body.name,
        gpuSku: body.gpuSku,
        region: body.region,
        subscriptionId: body.subscriptionId,
        vnetName: body.vnetName,
        subnetName: body.subnetName,
        owner: body.owner,
        businessJustification: body.businessJustification,
        leaseDuration: body.leaseDuration,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/gpu-instances/:id/delete', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'Delete GPU Instance'))) return;
    try {
      const record = await service.deleteGpuInstance({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/gpu-instances/:id/start', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'Start GPU Instance'))) return;
    try {
      const record = await service.startGpuInstance({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/gpu-instances/:id/stop', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'Stop GPU Instance'))) return;
    try {
      const record = await service.stopGpuInstance({
        id: req.params.id,
        actorRef: ctx.actorRef,
        role: ctx.role,
      });
      res.status(202).json(record);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/gpu-instances/:id/logs/stream', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'Stream GPU Instance Logs'))) return;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let poll: NodeJS.Timeout | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const send = (event: string, data: Record<string, unknown>) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const shutdown = () => {
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    const terminalStatuses = new Set([
      'READY',
      'FAILED',
      'DELETED',
      'DELETE_FAILED',
    ]);

    // refreshGpuInstanceStatus reconciles the record against the live
    // Terraform Cloud run; reading the stored record alone would leave the
    // stream reporting the status it had when provisioning started.
    const sendStatus = async () => {
      if (closed) return;
      const record = await service.refreshGpuInstanceStatus(req.params.id);
      if (!record) {
        send('error', { message: 'GPU instance not found' });
        shutdown();
        res.end();
        return;
      }
      send('status', {
        instanceId: record.id,
        status: record.status,
        statusMessage: record.statusMessage,
        failureReason: record.failureReason,
        workflowRunId: record.workflowRunId,
        workflowRunUrl: record.workflowRunUrl,
        updatedAt: record.updatedAt,
      });
      if (terminalStatuses.has(record.status)) {
        send('done', {
          instanceId: record.id,
          status: record.status,
          statusMessage: record.statusMessage,
          failureReason: record.failureReason,
          updatedAt: record.updatedAt,
        });
        shutdown();
        res.end();
      }
    };

    const safeSendStatus = () =>
      sendStatus().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        send('error', { message });
      });

    const bootstrap = await Promise.all([
      service.getGpuInstance(req.params.id),
      service.listGpuInstanceEvents(req.params.id),
    ]);
    const record = bootstrap[0];
    const events = bootstrap[1];

    if (!record) {
      send('error', { message: 'GPU instance not found' });
      res.end();
      return;
    }

    for (const event of events.reverse()) {
      send('log', event as unknown as Record<string, unknown>);
    }
    await safeSendStatus();

    if (!closed) {
      unsubscribe = service.onGpuInstanceEvent(req.params.id, event => {
        if (closed) return;
        send('log', event as unknown as Record<string, unknown>);
        void safeSendStatus();
      });

      poll = setInterval(() => void safeSendStatus(), 5000);
      heartbeat = setInterval(() => {
        if (closed) return;
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 15000);
    }

    req.on('close', shutdown);
    res.on('close', shutdown);
  });

  router.get('/gpu-instances/:id/events', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Instance Events'))) return;
    const events = await service.listGpuInstanceEvents(req.params.id);
    res.json({ events });
  });

  router.get('/gpu-instances/:id/logs', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!(await requireGpuAccess(ctx, res, 'View GPU Instance Logs'))) return;
    try {
      const result = await service.getGpuInstanceRunLogs(req.params.id);
      res.json(result);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // GPU VNet Management (Admin Only)
  // ────────────────────────────────────────────────────────────────────────

  router.get('/admin/gpu-vnets', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin can manage GPU VNets',
      });
      return;
    }
    try {
      const gpuSkuRaw = String(req.query.gpuSku ?? '').trim();
      const gpuSku =
        gpuSkuRaw === 'a100' || gpuSkuRaw === 'h100' ? gpuSkuRaw : undefined;
      const vnets = await service.listGpuVnets(gpuSku);
      res.json({ items: vnets });
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/admin/gpu-vnets', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin can manage GPU VNets',
      });
      return;
    }

    const body = req.body as {
      subscriptionId?: string;
      resourceGroup?: string;
      vnetName?: string;
      region?: string;
      gpuSkus?: string[];
    };

    if (
      !body.subscriptionId ||
      !body.resourceGroup ||
      !body.vnetName ||
      !body.region
    ) {
      res.status(400).json({
        error:
          'subscriptionId, resourceGroup, vnetName, and region are required',
      });
      return;
    }

    try {
      const vnet = await service.createGpuVnet({
        subscriptionId: body.subscriptionId,
        resourceGroup: body.resourceGroup,
        vnetName: body.vnetName,
        region: body.region.toLowerCase(),
        gpuSkus: (body.gpuSkus || ['a100', 'h100']).filter(
          (s): s is 'a100' | 'h100' => s === 'a100' || s === 'h100',
        ),
      });
      res.status(201).json(vnet);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.get('/admin/gpu-vnets/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin can manage GPU VNets',
      });
      return;
    }

    try {
      const vnet = await service.getGpuVnetById(req.params.id);
      if (!vnet) {
        res.status(404).json({ error: 'VNet not found' });
        return;
      }
      res.json(vnet);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.put('/admin/gpu-vnets/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin can manage GPU VNets',
      });
      return;
    }

    const body = req.body as {
      gpuSkus?: string[];
    };

    try {
      const vnet = await service.updateGpuVnetSkus(
        req.params.id,
        (body.gpuSkus || ['a100', 'h100']).filter(
          (s): s is 'a100' | 'h100' => s === 'a100' || s === 'h100',
        ),
      );
      res.json(vnet);
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.delete('/admin/gpu-vnets/:id', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployPlatform(ctx.role)) {
      res.status(403).json({
        error: 'Only platform-admin can manage GPU VNets',
      });
      return;
    }

    try {
      await service.deleteGpuVnet(req.params.id);
      res.status(204).send();
    } catch (error) {
      res
        .status(portalErrorStatus(error))
        .json({ error: toErrorMessage(error) });
    }
  });

  router.post('/overlays/deploy', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployOverlay(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform-admin and professional-services can deploy overlays',
      });
      return;
    }

    const body = req.body as {
      tenantId?: string;
      clusterId?: string;
      overlayVersion?: string;
      environment?: string;
    };

    if (
      !body.tenantId ||
      !body.clusterId ||
      !body.overlayVersion ||
      !body.environment
    ) {
      res.status(400).json({
        error: 'tenantId, clusterId, overlayVersion, environment are required',
      });
      return;
    }

    const result = await service.deployOverlay({
      tenantId: body.tenantId,
      clusterId: body.clusterId,
      overlayVersion: body.overlayVersion,
      environment: body.environment,
      action: 'deploy',
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.status(202).json(result);
  });

  router.post('/overlays/promote', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployOverlay(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform-admin and professional-services can promote overlays',
      });
      return;
    }

    const body = req.body as {
      tenantId?: string;
      clusterId?: string;
      overlayVersion?: string;
      environment?: string;
    };

    if (
      !body.tenantId ||
      !body.clusterId ||
      !body.overlayVersion ||
      !body.environment
    ) {
      res.status(400).json({
        error: 'tenantId, clusterId, overlayVersion, environment are required',
      });
      return;
    }

    const result = await service.deployOverlay({
      tenantId: body.tenantId,
      clusterId: body.clusterId,
      overlayVersion: body.overlayVersion,
      environment: body.environment,
      action: 'promote',
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.status(202).json(result);
  });

  router.post('/overlays/rollback', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canDeployOverlay(ctx.role)) {
      res.status(403).json({
        error:
          'Only platform-admin and professional-services can rollback overlays',
      });
      return;
    }

    const body = req.body as {
      tenantId?: string;
      clusterId?: string;
      overlayVersion?: string;
      environment?: string;
    };

    if (
      !body.tenantId ||
      !body.clusterId ||
      !body.overlayVersion ||
      !body.environment
    ) {
      res.status(400).json({
        error: 'tenantId, clusterId, overlayVersion, environment are required',
      });
      return;
    }

    const result = await service.deployOverlay({
      tenantId: body.tenantId,
      clusterId: body.clusterId,
      overlayVersion: body.overlayVersion,
      environment: body.environment,
      action: 'rollback',
      actorRef: ctx.actorRef,
      role: ctx.role,
    });

    res.status(202).json(result);
  });

  router.get('/history', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const scope = (req.query.scope as string | undefined) ?? 'all';
    const normalized =
      scope === 'platform' || scope === 'overlay' ? scope : 'all';
    const history = await service.deploymentHistory(normalized);
    res.json(history);
  });

  router.get('/argocd/status', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (!canRead(ctx.role)) {
      res.status(403).json({ error: 'Read access denied' });
      return;
    }

    const appName = String(req.query.appName ?? 'platform-control-plane');
    const status = await service.argocdStatus(appName);
    res.json(status);
  });

  router.post('/argocd/sync', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;
    if (ctx.role === 'readonly') {
      res.status(403).json({ error: 'Read-only role cannot trigger sync' });
      return;
    }

    const appName = String(req.body?.appName ?? 'platform-control-plane');
    const status = await service.argocdSync(appName);
    res.status(202).json(status);
  });

  // ============================================================================
  // Cluster Discovery & Management Endpoints
  // ============================================================================

  /**
   * GET /api/clusters/deployable
   * List deployable (CloudHub-eligible) clusters by subscription
   */
  router.get('/clusters/deployable', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;

      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const subscriptionId = String(req.query.subscriptionId ?? '');
      if (!subscriptionId) {
        res.status(400).json({ error: 'subscriptionId is required' });
        return;
      }
      if (!subscriptionIdRe.test(subscriptionId)) {
        res.status(400).json({ error: 'subscriptionId must be a valid UUID' });
        return;
      }

      const clusters = await service.discoverDeployableClusters({
        subscriptionId,
        resourceGroup: req.query.resourceGroup as string | undefined,
        region: req.query.region as string | undefined,
        environment: req.query.environment as string | undefined,
      });

      res.json({ clusters });
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  /**
   * GET /api/clusters/namespaces
   * List live Kubernetes namespaces on a discovered AKS cluster
   */
  router.get('/clusters/namespaces', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;

      if (!canRead(ctx.role)) {
        res.status(403).json({ error: 'Read access denied' });
        return;
      }

      const subscriptionId = String(req.query.subscriptionId ?? '');
      const resourceGroup = String(req.query.resourceGroup ?? '');
      const clusterName = String(req.query.clusterName ?? '');

      if (!subscriptionId || !resourceGroup || !clusterName) {
        res.status(400).json({
          error: 'subscriptionId, resourceGroup, and clusterName are required',
        });
        return;
      }
      if (!subscriptionIdRe.test(subscriptionId)) {
        res.status(400).json({ error: 'subscriptionId must be a valid UUID' });
        return;
      }

      await service.assertClusterOnboarded({
        subscriptionId,
        resourceGroup,
        clusterName,
      });

      const namespaces = await service.listClusterNamespaces({
        subscriptionId,
        resourceGroup,
        clusterName,
      });

      res.json({ namespaces });
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  /**
   * POST /api/clusters/onboard
   * Onboard a cluster for CloudHub deployments
   *
   * Request body:
   * {
   *   "subscriptionId": "...",
   *   "resourceGroup": "...",
   *   "clusterName": "..."
   * }
   */
  router.post('/clusters/onboard', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;

      // Only platform admins can onboard clusters
      if (!canProvisionInfrastructure(ctx.role)) {
        res.status(403).json({
          error: 'Only platform admins can onboard clusters',
        });
        return;
      }

      const body = req.body as {
        subscriptionId?: string;
        resourceGroup?: string;
        clusterName?: string;
      };

      if (!body.subscriptionId || !body.resourceGroup || !body.clusterName) {
        res.status(400).json({
          error: 'subscriptionId, resourceGroup, and clusterName are required',
        });
        return;
      }

      const result = await service.onboardCluster(
        {
          subscriptionId: body.subscriptionId,
          resourceGroup: body.resourceGroup,
          clusterName: body.clusterName,
        },
        ctx.actorRef,
      );

      res.status(200).json(result);
    } catch (error) {
      const msg = toErrorMessage(error);
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else {
        res.status(502).json({ error: msg });
      }
    }
  });

  /**
   * POST /api/clusters/offboard
   * Offboard a cluster from CloudHub deployments
   *
   * Request body:
   * {
   *   "subscriptionId": "...",
   *   "resourceGroup": "...",
   *   "clusterName": "..."
   * }
   */
  router.post('/clusters/offboard', async (req, res) => {
    try {
      const ctx = await access(req, res);
      if (!ctx) return;

      // Only platform admins can offboard clusters
      if (!canProvisionInfrastructure(ctx.role)) {
        res.status(403).json({
          error: 'Only platform admins can offboard clusters',
        });
        return;
      }

      const body = req.body as {
        subscriptionId?: string;
        resourceGroup?: string;
        clusterName?: string;
      };

      if (!body.subscriptionId || !body.resourceGroup || !body.clusterName) {
        res.status(400).json({
          error: 'subscriptionId, resourceGroup, and clusterName are required',
        });
        return;
      }

      const result = await service.offboardCluster(
        {
          subscriptionId: body.subscriptionId,
          resourceGroup: body.resourceGroup,
          clusterName: body.clusterName,
        },
        ctx.actorRef,
      );

      res.status(200).json(result);
    } catch (error) {
      const msg = toErrorMessage(error);
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else {
        res.status(502).json({ error: msg });
      }
    }
  });

  // ── GitHub repository provisioning routes ────────────────────────────────

  router.get('/github/authorization', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const result = await gitHubAuthorizationService.authorize({
      groups: ctx.groups,
      actorRef: ctx.actorRef,
    });

    res.json(result);
  });

  router.get('/github/templates', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const templates = await gitHubRepositoryService.listTemplates();
    res.json({ items: templates });
  });

  router.get('/github/teams', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    try {
      const teams = await gitHubRepositoryService.listTeams();
      res.json({ items: teams });
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error) });
    }
  });

  router.post('/github/repositories', async (req, res) => {
    const ctx = await access(req, res);
    if (!ctx) return;

    const authResult = await gitHubAuthorizationService.authorize({
      groups: ctx.groups,
      actorRef: ctx.actorRef,
    });
    if (!authResult.authorized) {
      res.status(403).json({
        success: false,
        message: 'You are not authorized to create GitHub repositories.',
      });
      return;
    }

    const body = req.body as {
      repositoryName?: string;
      description?: string;
      visibility?: string;
      ownerTeam?: string;
      templateName?: string;
      enableBranchProtection?: boolean;
      enableCodeOwners?: boolean;
      enableDependabot?: boolean;
    };

    const repositoryName = String(body.repositoryName ?? '').trim();
    const description = body.description
      ? String(body.description).trim()
      : undefined;
    const visibility = String(body.visibility ?? 'private').toLowerCase();
    const ownerTeam = String(body.ownerTeam ?? '').trim();
    const templateName = body.templateName
      ? String(body.templateName).trim()
      : undefined;

    if (!repositoryName) {
      res.status(400).json({
        success: false,
        message: 'Repository name is required.',
      });
      return;
    }

    if (!ownerTeam) {
      res.status(400).json({
        success: false,
        message: 'Owner team is required.',
      });
      return;
    }

    if (!['private', 'internal', 'public'].includes(visibility)) {
      res.status(400).json({
        success: false,
        message: 'Visibility must be private, internal, or public.',
      });
      return;
    }

    try {
      const result = await gitHubRepositoryService.createRepository(
        {
          repositoryName,
          description,
          visibility: visibility as RepositoryVisibility,
          ownerTeam,
          templateName,
          enableBranchProtection: Boolean(body.enableBranchProtection),
          enableCodeOwners: Boolean(body.enableCodeOwners),
          enableDependabot: Boolean(body.enableDependabot),
        },
        ctx.actorRef,
      );

      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: toErrorMessage(error),
      });
    }
  });

  // Terminal handler: anything that escapes a route still answers JSON so the
  // frontend never has to parse an ingress-generated HTML error page.
  router.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      const message = toErrorMessage(error);
      deps.logger.error(
        `[control-plane] unhandled error on ${req.method} ${req.originalUrl}: ${message}`,
      );
      if (res.headersSent) return;
      res.status(portalErrorStatus(error)).json({ error: message });
    },
  );

  return router;
}
