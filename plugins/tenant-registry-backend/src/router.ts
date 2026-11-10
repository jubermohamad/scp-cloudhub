import { Router, json as expressJson } from 'express';
import type { Request, Response } from 'express';
import type {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
  HttpAuthService,
  LoggerService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { TenantRegistryDatabase } from './db';
import { createDiscoveryProvider } from './providers/cloudDiscoveryProviderFactory';
import { ClusterValidationService } from './services/clusterValidationService';
import { TenantRegistryService } from './services/tenantRegistryService';
import { CatalogRegistrationService } from './services/catalogRegistrationService';
import type {
  CloudProvider,
  CreateTenantInput,
  DiscoverClustersInput,
  DiscoveredClusterWithValidation,
  OnboardClustersInput,
} from './types';

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
  auth: AuthService;
  discovery: DiscoveryService;
  db: TenantRegistryDatabase;
}

export function createTenantRegistryRouter(deps: RouterDeps): Router {
  const { logger, httpAuth, userInfo, auth, discovery, db } = deps;

  const router = Router();
  router.use(expressJson());

  const tenantService = new TenantRegistryService(db, logger);
  const validationService = new ClusterValidationService(tenantService, logger);
  const catalogService = new CatalogRegistrationService({
    logger,
    auth,
    discovery,
  });

  async function requireAccess(
    req: Request,
    res: Response,
    mode: 'read' | 'write',
  ): Promise<{
    actorRef: string;
    credentials: BackstageCredentials;
    groups: string[];
  } | null> {
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

      // Do not accept x-cloudhub-persona header as a fallback. Require actual
      // group claims from the identity provider for role determination.

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
        return null;
      }

      return {
        actorRef: info.userEntityRef,
        credentials,
        groups: groups.map(group => group.toLowerCase()),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(401).json({ error: message });
      return null;
    }
  }

  function parseListQuery(req: Request): {
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
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
    };
  }

  router.get('/tenants', async (req, res) => {
    const authContext = await requireAccess(req, res, 'read');
    if (!authContext) return;

    const query = parseListQuery(req);
    const result = await tenantService.listTenants(query);
    res.json({
      ...result,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  router.post('/tenants', async (req, res) => {
    const authContext = await requireAccess(req, res, 'write');
    if (!authContext) return;

    const input = req.body as CreateTenantInput;
    if (!input?.tenantName || !input?.subscriptionId || !input?.cloudProvider) {
      res.status(400).json({
        error: 'tenantName, cloudProvider, and subscriptionId are required',
      });
      return;
    }

    const created = await tenantService.createTenant({
      tenantName: input.tenantName,
      businessUnit: input.businessUnit,
      cloudProvider: input.cloudProvider,
      subscriptionId: input.subscriptionId,
      regions: input.regions ?? [],
      environments: input.environments ?? [],
    });

    await tenantService.logAudit({
      actorRef: authContext.actorRef,
      action: 'tenant-create',
      targetType: 'tenant',
      targetId: created.id,
      payload: {
        ...created,
      },
    });

    res.status(201).json(created);
  });

  router.get('/tenants/:id', async (req, res) => {
    const authContext = await requireAccess(req, res, 'read');
    if (!authContext) return;

    const item = await tenantService.getTenant(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    res.json(item);
  });

  router.delete('/tenants/:id', async (req, res) => {
    const authContext = await requireAccess(req, res, 'write');
    if (!authContext) return;

    await tenantService.deleteTenant(req.params.id);
    await tenantService.logAudit({
      actorRef: authContext.actorRef,
      action: 'tenant-delete',
      targetType: 'tenant',
      targetId: req.params.id,
      payload: {},
    });

    res.json({ deleted: req.params.id });
  });

  router.get('/clusters/discover', async (req, res) => {
    const authContext = await requireAccess(req, res, 'read');
    if (!authContext) return;

    const cloudProvider =
      (req.query.cloudProvider as CloudProvider | undefined) ?? 'Azure';
    const subscriptionId = req.query.subscriptionId as string | undefined;

    if (!subscriptionId) {
      res.status(400).json({ error: 'subscriptionId is required' });
      return;
    }

    const provider = createDiscoveryProvider(cloudProvider, logger);
    await provider.authenticate();

    const input: DiscoverClustersInput = {
      cloudProvider,
      subscriptionId,
      resourceGroup: req.query.resourceGroup as string | undefined,
      region: req.query.region as string | undefined,
      environment: req.query.environment as string | undefined,
    };

    const discovered = await provider.discoverClusters(input);

    const withValidation: DiscoveredClusterWithValidation[] = await Promise.all(
      discovered.map(async cluster => {
        const validation = await validationService.validate(cluster, provider);
        return {
          ...cluster,
          validation,
        };
      }),
    );

    await tenantService.logAudit({
      actorRef: authContext.actorRef,
      action: 'cluster-discovery',
      targetType: 'subscription',
      targetId: subscriptionId,
      payload: {
        cloudProvider,
        count: withValidation.length,
      },
    });

    res.json({ items: withValidation });
  });

  router.post('/clusters/onboard', async (req, res) => {
    const authContext = await requireAccess(req, res, 'write');
    if (!authContext) return;

    const body = req.body as OnboardClustersInput;
    if (!body.tenantId || !body.selectedClusterNames?.length) {
      res
        .status(400)
        .json({ error: 'tenantId and selectedClusterNames are required' });
      return;
    }

    const tenant = await tenantService.getTenant(body.tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const provider = createDiscoveryProvider(body.cloudProvider, logger);
    await provider.authenticate();

    const selected = body.discoveredClusters.filter(c =>
      body.selectedClusterNames.includes(c.clusterName),
    );

    const onboarded = [];
    const failed: Array<{ clusterName: string; reason: string }> = [];

    for (const cluster of selected) {
      try {
        if (!cluster.validation.notAlreadyOnboarded) {
          failed.push({
            clusterName: cluster.clusterName,
            reason: 'already onboarded',
          });
          continue;
        }

        const nodePools = await provider.fetchNodePools(cluster);
        const catalogRegistration = await catalogService.registerClusterEntity(
          cluster,
          tenant.tenantName,
        );

        const onboardedCluster = await tenantService.onboardCluster({
          tenantId: body.tenantId,
          cluster,
          nodePools,
          catalogEntityRef: catalogRegistration.entityRef,
          validationIssues: cluster.validation.issues,
          actorRef: authContext.actorRef,
        });

        if (catalogRegistration.registrationStatus === 'failed') {
          await tenantService.logAudit({
            actorRef: authContext.actorRef,
            action: 'catalog-register-failed',
            targetType: 'cluster',
            targetId: onboardedCluster.id,
            payload: {
              cluster: cluster.clusterName,
              error: catalogRegistration.error,
            },
          });
        }

        onboarded.push(onboardedCluster);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ clusterName: cluster.clusterName, reason: message });

        await tenantService.logAudit({
          actorRef: authContext.actorRef,
          action: 'cluster-onboard-failed',
          targetType: 'cluster',
          payload: {
            clusterName: cluster.clusterName,
            error: message,
          },
        });
      }
    }

    res.status(201).json({ onboarded, failed });
  });

  router.get('/clusters', async (req, res) => {
    const authContext = await requireAccess(req, res, 'read');
    if (!authContext) return;

    const query = parseListQuery(req);
    const result = await tenantService.listClusters(query);
    res.json({
      ...result,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  router.get('/clusters/:id', async (req, res) => {
    const authContext = await requireAccess(req, res, 'read');
    if (!authContext) return;

    const cluster = await tenantService.getCluster(req.params.id);
    if (!cluster) {
      res.status(404).json({ error: 'Cluster not found' });
      return;
    }
    res.json(cluster);
  });

  router.delete('/clusters/:id', async (req, res) => {
    const authContext = await requireAccess(req, res, 'write');
    if (!authContext) return;

    await tenantService.deleteCluster(req.params.id);
    await tenantService.logAudit({
      actorRef: authContext.actorRef,
      action: 'cluster-delete',
      targetType: 'cluster',
      targetId: req.params.id,
      payload: {},
    });

    res.json({ deleted: req.params.id });
  });

  return router;
}
