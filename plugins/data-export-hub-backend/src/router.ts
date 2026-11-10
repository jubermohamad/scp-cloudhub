import { Router, json as expressJson } from 'express';
import type { Request, Response } from 'express';
import type { HttpAuthService, LoggerService, UserInfoService } from '@backstage/backend-plugin-api';
import { Caller, requirePlatformAdmin, resolveCaller } from './access';
import { SCHEDULER_SUBJECT } from './constants';
import type { DataExportDatabase } from './db';
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from './errors';
import { AgentGateway, AuthenticatedAgent } from './services/agentGateway';
import { CatalogService } from './services/catalogService';
import { ClusterSyncService } from './services/clusterSync';
import { DashboardService } from './services/dashboardService';
import { DestinationService } from './services/destinationService';
import { ExportService } from './services/exportService';
import { FleetService } from './services/fleetService';
import { JobService } from './services/jobService';
import { PackagesService } from './packages';
import { resolveRuntimeConfig } from './runtimeConfig';
import { ValidationError, bodyOf } from './validation';

interface RouterDeps {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  db: DataExportDatabase;
}

type Method = 'get' | 'post' | 'put' | 'delete';
type Handler<P> = (req: Request, res: Response, principal: P) => Promise<unknown> | unknown;

/** Route parameters are single segments; Express types them as string | string[]. */
function paramId(req: Request): string {
  return String(req.params.id);
}

function query(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

/**
 * Three kinds of caller reach this router:
 * - users, authenticated by Backstage sign-in (`/…`);
 * - cluster agents, authenticated by an Entra workload identity token that
 *   Backstage verifies via `backend.auth.externalAccess` (`/agent/…`);
 * - the scheduler plugin, with a Backstage service token (`/internal/…`).
 */
export function createDataExportRouter(deps: RouterDeps): Router {
  const { logger, httpAuth, userInfo, db } = deps;
  const catalog = new CatalogService(db, logger);
  const destinations = new DestinationService(db);
  const exportsService = new ExportService(db, logger);
  const fleet = new FleetService(db);
  const jobs = new JobService(db);
  const packages = new PackagesService(db);
  const dashboard = new DashboardService(db, catalog, destinations, exportsService, fleet);
  const gateway = new AgentGateway(db, logger);
  const clusterSync = new ClusterSyncService(db, logger);

  const router = Router();
  router.use(expressJson({ limit: '1mb' }));

  function send(res: Response, status: number, result: unknown) {
    if (res.headersSent) return;
    if (status === 204) res.status(204).end();
    else res.status(status).json(result ?? {});
  }

  function user(method: Method, path: string, handler: Handler<Caller>, options: { status?: number } = {}) {
    const status = options.status ?? (method === 'post' ? 201 : method === 'delete' ? 204 : 200);
    router[method](path, async (req: Request, res: Response) => {
      try {
        const caller = await resolveCaller(httpAuth, userInfo, req);
        send(res, status, await handler(req, res, caller));
      } catch (error) {
        sendError(res, error, logger);
      }
    });
  }

  async function servicePrincipal(req: Request): Promise<string> {
    const credentials = await httpAuth.credentials(req as unknown as Parameters<typeof httpAuth.credentials>[0], {
      allow: ['service'],
    });
    return credentials.principal.subject;
  }

  function agent(path: string, handler: Handler<AuthenticatedAgent>) {
    router.post(path, async (req: Request, res: Response) => {
      try {
        const authenticated = await gateway.authenticate(await servicePrincipal(req));
        send(res, 200, await handler(req, res, authenticated));
      } catch (error) {
        sendError(res, error, logger);
      }
    });
  }

  /* ----- identity, dashboard, filters, audit ----- */

  user('get', '/me', (_req, _res, caller) => caller);
  user('get', '/runtime-config', () => resolveRuntimeConfig());
  user('get', '/dashboard', (_req, _res, caller) => dashboard.get(caller));
  user('get', '/filters', (_req, _res, caller) => dashboard.filterOptions(caller));
  user('get', '/audit', (req, _res, caller) => dashboard.listAudit(query(req), caller));

  /* ----- data catalog ----- */

  user('get', '/datasets', req => catalog.list(query(req)));
  user('get', '/datasets/:id', req => catalog.get(paramId(req)));
  user('get', '/datasets/:id/lineage', req => catalog.lineage(paramId(req)));
  user('post', '/datasets', (req, _res, caller) => catalog.register(req.body, caller));
  user('put', '/datasets/:id', (req, _res, caller) => catalog.update(paramId(req), req.body, caller));

  /* ----- destinations ----- */

  user('get', '/destinations', (req, _res, caller) => destinations.list(query(req), caller));
  user('post', '/destinations/test', (req, _res, caller) => destinations.test(req.body, caller), { status: 200 });
  user('post', '/destinations', (req, _res, caller) => destinations.create(req.body, caller));
  user('get', '/destinations/:id', (req, _res, caller) => destinations.get(paramId(req), caller));
  user('put', '/destinations/:id', (req, _res, caller) => destinations.update(paramId(req), req.body, caller));

  /* ----- clusters and agents ----- */

  user(
    'post',
    '/clusters/sync',
    (_req, _res, caller) => {
      requirePlatformAdmin(caller);
      return clusterSync.run(caller.actor);
    },
    { status: 200 },
  );
  user('get', '/clusters', (req, _res, caller) => fleet.listClusters(query(req), caller));
  user('post', '/clusters', (req, _res, caller) => fleet.createCluster(req.body, caller));
  user('get', '/clusters/:id', (req, _res, caller) => fleet.getCluster(paramId(req), caller));
  user('put', '/clusters/:id', (req, _res, caller) => fleet.updateCluster(paramId(req), req.body, caller));
  user('post', '/clusters/:id/retire', (req, _res, caller) => fleet.setRetired(paramId(req), true, caller), {
    status: 200,
  });
  user('post', '/clusters/:id/restore', (req, _res, caller) => fleet.setRetired(paramId(req), false, caller), {
    status: 200,
  });
  user('post', '/clusters/:id/agents', (req, _res, caller) => fleet.registerAgent(paramId(req), req.body, caller));
  user('get', '/agents', (req, _res, caller) => fleet.listAgents(query(req), caller));
  user('get', '/agents/:id', (req, _res, caller) => fleet.getAgent(paramId(req), caller));
  user('put', '/agents/:id', (req, _res, caller) => fleet.updateAgent(paramId(req), req.body, caller));
  user('delete', '/agents/:id', (req, _res, caller) => fleet.deleteAgent(paramId(req), caller));

  /* ----- export packages ----- */

  user('get', '/packages', () => packages.list());
  user('get', '/packages/:id', req => packages.get(paramId(req)));

  /* ----- export profiles ----- */

  user('get', '/exports', (req, _res, caller) => exportsService.list(query(req), caller));
  user('post', '/exports', (req, _res, caller) => exportsService.create(req.body, caller));
  user('get', '/exports/:id', (req, _res, caller) => exportsService.get(paramId(req), caller));
  user('put', '/exports/:id', (req, _res, caller) => exportsService.update(paramId(req), req.body, caller));
  user('delete', '/exports/:id', (req, _res, caller) => exportsService.remove(paramId(req), caller));
  user('put', '/exports/:id/enabled', (req, _res, caller) => {
    const body = bodyOf(req.body);
    if (typeof body.enabled !== 'boolean') throw new ValidationError(['enabled must be a boolean']);
    return exportsService.setEnabled(paramId(req), body.enabled, caller);
  });
  user('post', '/exports/:id/run', (req, _res, caller) => exportsService.runNow(paramId(req), caller), {
    status: 202,
  });

  /* ----- jobs (executions) ----- */

  user('get', '/jobs', (req, _res, caller) => jobs.list(query(req), caller));
  user('get', '/jobs/:id', (req, _res, caller) => jobs.get(paramId(req), caller));
  user('post', '/jobs/:id/retry', (req, _res, caller) => jobs.retry(paramId(req), caller), { status: 200 });
  user('post', '/jobs/:id/cancel', (req, _res, caller) => jobs.cancel(paramId(req), caller), { status: 200 });
  user('get', '/jobs/:id/manifest', async (req, res, caller) => {
    const { job, manifest } = await jobs.manifest(paramId(req), caller);
    res.setHeader('Content-Disposition', `attachment; filename="manifest-${job.id}.json"`);
    res.status(200).json(manifest);
  });
  user('get', '/jobs/:id/logs', async (req, res, caller) => {
    const { job, logs } = await jobs.logs(paramId(req), caller);
    res.setHeader('Content-Disposition', `attachment; filename="job-${job.id}.log"`);
    res.status(200).type('text/plain').send(logs);
  });

  /* ----- agent protocol (workload identity) ----- */

  agent('/agent/heartbeat', (req, _res, a) => gateway.heartbeat(a, req.body));
  agent('/agent/jobs/claim', async (_req, res, a) => {
    const claimed = await gateway.claim(a);
    if (!claimed) res.status(204).end();
    return claimed;
  });
  agent('/agent/jobs/:id/progress', (req, _res, a) => gateway.progress(a, paramId(req), req.body));
  agent('/agent/jobs/:id/complete', async (req, _res, a) => {
    await gateway.complete(a, paramId(req), req.body);
    return {};
  });
  agent('/agent/jobs/:id/fail', (req, _res, a) => gateway.fail(a, paramId(req), req.body));

  /* ----- internal (scheduler plugin) ----- */

  router.post('/internal/clusters/sync', async (req: Request, res: Response) => {
    try {
      if ((await servicePrincipal(req)) !== SCHEDULER_SUBJECT) {
        throw new ForbiddenError('Only the data-export-scheduler plugin may call this endpoint');
      }
      send(res, 200, await clusterSync.run('system:data-export-scheduler'));
    } catch (error) {
      sendError(res, error, logger);
    }
  });

  return router;
}

function sendError(res: Response, error: unknown, logger: LoggerService) {
  if (res.headersSent) return;
  if (error instanceof ValidationError) {
    res.status(400).json({ error: 'Validation failed', details: error.details });
    return;
  }
  if (error instanceof ForbiddenError) {
    res.status(403).json({ error: `Forbidden: ${error.message}` });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof ConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof ServiceUnavailableError) {
    res.status(503).json({ error: error.message });
    return;
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  // Check NotAllowedError first: its message ("does not allow 'user' credentials")
  // would otherwise match the authentication heuristic below.
  if (name === 'NotAllowedError') {
    res.status(403).json({ error: message });
    return;
  }
  if (name === 'AuthenticationError' || /missing credentials|unauthori[sz]ed/i.test(message)) {
    res.status(401).json({ error: message });
    return;
  }
  logger.error(`[data-export-hub] Unhandled error: ${message}`);
  res.status(500).json({ error: 'Internal error' });
}
