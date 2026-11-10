import { Router, json as expressJson } from 'express';
import type { Request, Response } from 'express';
import type {
  HttpAuthService,
  LoggerService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { PlatformRegistryDatabase } from './db';
import { PlatformRegistryService } from './service';

const PLATFORM_ADMIN_GROUPS = [
  'group:default/cloudhubplatformowners',
  'cloudhubplatformowners',
  'cloudhub.platformadmin',
  'role:cloudhub.platformadmin',
  'group:default/grp-platform-super-admins',
  'group:default/grp-cloudhub-platformadmin',
  'grp-cloudhub-platformadmin',
  '778023ed-fa96-43b3-8c35-4679943c01ee',
  'group:default/platform-admin',
  'group:default/platform-team',
  'group:default/cloudhub-platform',
];

const PROFESSIONAL_SERVICES_GROUPS = [
  'group:default/cloudhubps',
  'cloudhubps',
  'cloudhub.professionalservices',
  'role:cloudhub.professionalservices',
  'group:default/grp-platform-prof-services',
  'group:default/ps-team',
  'group:default/professional-services',
];

const READ_ONLY_GROUPS = [
  'group:default/cloudhub-login-allow',
  'cloudhubloginallow',
  'group:default/cloudhubappeng',
  'group:default/cloudhubsre',
  'cloudhubsre',
  'cloudhub.sre',
  'role:cloudhub.sre',
  'group:default/grp-platform-readonly',
  'group:default/readonly',
];

function normalizeGroupToken(token: string): string {
  return token.trim().toLowerCase();
}

function matchesGroup(groups: string[], candidates: string[]): boolean {
  const lowered = groups.map(normalizeGroupToken);
  return candidates.some(candidate => {
    const needle = normalizeGroupToken(candidate);
    return lowered.some(group => {
      return (
        group === needle ||
        group === `group:default/${needle}` ||
        group.endsWith(`/${needle}`) ||
        group.endsWith(`:${needle}`)
      );
    });
  });
}

interface RouterDeps {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  db: PlatformRegistryDatabase;
}

export function createPlatformRegistryRouter(deps: RouterDeps): Router {
  const { logger, httpAuth, userInfo, db } = deps;

  const router = Router();
  router.use(expressJson());
  router.use((req, res, next) => {
    // Registry lists are live inventory (including cloud discovery), not a
    // browser-cacheable snapshot. Avoid conditional GETs yielding 304 to clients
    // that expect a JSON response body.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    next();
  });

  const service = new PlatformRegistryService(db, logger);

  service.syncLiveOnboardedClusters().catch(err => {
    logger.warn(`[platform-registry] Initial live cluster sync: ${err.message}`);
  });

  async function requireAccess(
    req: Request,
    res: Response,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    try {
      const credentials = await httpAuth.credentials(
        req as unknown as Parameters<typeof httpAuth.credentials>[0],
        { allow: ['user'] },
      );
      const info = await userInfo.getUserInfo(credentials);
      const groups = info.ownershipEntityRefs ?? [];
      const isPlatformAdmin =
        matchesGroup(groups, PLATFORM_ADMIN_GROUPS);
      const isProfessionalServices = matchesGroup(
        groups,
        PROFESSIONAL_SERVICES_GROUPS,
      );
      const isReadOnlyUser = matchesGroup(groups, READ_ONLY_GROUPS);

      // Do not fall back to `x-cloudhub-persona`. Require real group claims
      // returned by the identity provider to determine access roles.
      const allowed =
        mode === 'write'
          ? isPlatformAdmin
          : isPlatformAdmin || isProfessionalServices || isReadOnlyUser;

      if (!allowed) {
        res.status(403).json({
          error:
            mode === 'write'
              ? 'Forbidden: write access requires platform-admin'
              : 'Forbidden: read access requires platform-admin, professional-services, or read-only',
        });
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(401).json({ error: message });
      return false;
    }
  }

  function parseListQuery(req: Request): {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    provider?: string;
  } {
    const page = Math.max(
      0,
      parseInt((req.query.page as string | undefined) ?? '0', 10) || 0,
    );
    const pageSize = Math.min(
      200,
      Math.max(
        1,
        parseInt((req.query.pageSize as string | undefined) ?? '25', 10) || 25,
      ),
    );
    const sortOrder =
      (req.query.sortOrder as string | undefined)?.toLowerCase() === 'asc'
        ? 'asc'
        : 'desc';

    return {
      page,
      pageSize,
      search: (req.query.search as string | undefined)?.trim() || undefined,
      sortBy: (req.query.sortBy as string | undefined)?.trim() || undefined,
      sortOrder,
      provider: (req.query.provider as string | undefined)?.trim() || undefined,
    };
  }

  function handleError(res: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: number }).status) || 500
        : 500;
    logger.error(`[platform-registry] request failed: ${message}`);
    res.status(status).json({ error: message });
  }

  // ------------------------------------------------------------------ Health
  router.get('/health', (_req, res) => {
    res.json({ status: db.isReady() ? 'ok' : 'degraded' });
  });

  router.get('/summary', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.getSummary());
    } catch (error) {
      handleError(res, error);
    }
  });

  // ----------------------------------------------------------------- Tenants
  router.get('/platforms', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listPlatforms(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/platforms/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      const platform = await service.getPlatform(req.params.id);
      if (!platform) {
        res.status(404).json({ error: 'Platform not found' });
        return;
      }
      res.json(platform);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/platforms/:id/detail', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      const detail = await service.getPlatformDetail(req.params.id);
      if (!detail) {
        res.status(404).json({ error: 'Platform not found' });
        return;
      }
      res.json(detail);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/platforms', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createPlatform(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/platforms/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deletePlatform(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // ---------------------------------------------------------------- Customers
  router.get('/customers', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listCustomers());
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/customers/:customer/clusters', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      const environment = req.query.environment as string | undefined;
      res.json(
        await service.listCustomerClusters(req.params.customer, environment),
      );
    } catch (error) {
      handleError(res, error);
    }
  });

  // ------------------------------------------------------------ Cloud accounts
  router.get('/cloud-accounts', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listCloudAccounts(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/cloud-accounts', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createCloudAccount(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/cloud-accounts/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deleteCloudAccount(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // ------------------------------------------------------------- Environments
  router.get('/environments', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listEnvironments(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/environments', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createEnvironment(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/environments/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deleteEnvironment(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // ---------------------------------------------------------------- Clusters
  router.get('/clusters', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listClusters(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/clusters/onboarded', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listOnboardedClusters(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/clusters/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      const cluster = await service.getCluster(req.params.id);
      if (!cluster) {
        res.status(404).json({ error: 'Cluster not found' });
        return;
      }
      res.json(cluster);
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/clusters', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createCluster(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/clusters/sync', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.json(await service.syncLiveOnboardedClusters());
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/clusters/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deleteCluster(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // -------------------------------------------------------------- Namespaces
  router.get('/namespaces', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listNamespaces(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/namespaces', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createNamespace(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/namespaces/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deleteNamespace(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // ------------------------------------------------------- Deployment targets
  router.get('/deployment-targets', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listDeploymentTargets(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/deployment-targets', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createDeploymentTarget(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/deployment-targets/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deleteDeploymentTarget(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // ------------------------------------------------------------ Applications
  router.get('/applications', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listApplications(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/applications', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createApplication(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete('/applications/:id', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      await service.deleteApplication(req.params.id);
      res.status(204).end();
    } catch (error) {
      handleError(res, error);
    }
  });

  // ------------------------------------------------------------- Deployments
  router.get('/deployments', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json(await service.listDeployments(parseListQuery(req)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/deployments', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.createDeployment(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get('/deployments/:id/events', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      res.json({ items: await service.listDeploymentEvents(req.params.id) });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/deployments/:id/transition', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      const { status } = req.body ?? {};
      if (!status) {
        res.status(400).json({ error: 'status is required' });
        return;
      }
      res.json(await service.transitionDeployment(req.params.id, req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/deployments/:id/rollback', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.json(await service.rollbackDeployment(req.params.id, req.body ?? {}));
    } catch (error) {
      handleError(res, error);
    }
  });

  // -------------------------------------------------------------- Onboarding
  router.post('/onboarding/platform', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      res.status(201).json(await service.onboardPlatform(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  // --------------------------------------------------------------- Discovery
  router.post('/discovery/clusters', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      const { cloudAccountId, provider } = req.body ?? {};
      if (!cloudAccountId) {
        res.status(400).json({ error: 'cloudAccountId is required' });
        return;
      }
      res.json({
        items: await service.discoverClusters(cloudAccountId, provider),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/discovery/preflight', async (req, res) => {
    if (!(await requireAccess(req, res, 'read'))) return;
    try {
      const { cloudAccountId, provider } = req.body ?? {};
      if (!cloudAccountId) {
        res.status(400).json({ error: 'cloudAccountId is required' });
        return;
      }
      res.json(await service.runDiscoveryPreflight(cloudAccountId, provider));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/discovery/import', async (req, res) => {
    if (!(await requireAccess(req, res, 'write'))) return;
    try {
      const { platformId, clusters } = req.body ?? {};
      if (!platformId || !Array.isArray(clusters)) {
        res
          .status(400)
          .json({ error: 'platformId and clusters[] are required' });
        return;
      }
      res.status(201).json(await service.importClusters(req.body));
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
