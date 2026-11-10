import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createControlPlaneRouter } from '../router';

patchSupertestIpv4();

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as any;

function setupRouter(options: {
  authorized?: boolean;
  enabled?: boolean;
  appConfigured?: boolean;
  createResult?: { success: boolean; repositoryUrl?: string; message?: string };
} = {}) {
  const service = {
    init: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn().mockReturnValue(null),
  } as any;

  const httpAuth = {
    credentials: jest.fn(async (req: express.Request) => {
      const groups =
        (req.headers['x-groups'] as string | undefined)
          ?.split(',')
          .map(s => s.trim())
          .filter(Boolean) ?? [];
      return { principal: { type: 'user' }, groups };
    }),
  } as any;

  const userInfo = {
    getUserInfo: jest.fn(async (credentials: any) => ({
      userEntityRef: 'user:default/test',
      ownershipEntityRefs: credentials.groups ?? [],
    })),
  } as any;

  const gitHubAuthorizationService = {
    isEnabled: jest.fn().mockReturnValue(options.enabled ?? true),
    authorize: jest.fn().mockResolvedValue({
      authorized: options.authorized ?? true,
      enabled: options.enabled ?? true,
    }),
  } as any;

  const gitHubRepositoryService = {
    listTemplates: jest.fn().mockResolvedValue(['Empty', 'node-api-template']),
    listTeams: jest.fn().mockResolvedValue([{ slug: 'cloud-engineering', name: 'Cloud Engineering' }]),
    createRepository: jest.fn().mockResolvedValue(
      options.createResult ?? {
        success: true,
        repositoryName: 'platform-orders-api',
        repositoryUrl: 'https://github.com/SymphonySensa/platform-orders-api',
        ownerTeam: 'cloud-engineering',
      },
    ),
  } as any;

  const router = createControlPlaneRouter({
    logger,
    httpAuth,
    userInfo,
    service,
    gitHubAuthorizationService,
    gitHubRepositoryService,
  });

  const app = express();
  app.use(express.json());
  app.use(router);

  return {
    app,
    gitHubAuthorizationService,
    gitHubRepositoryService,
  };
}

describe('GitHub repository provisioning routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const groupsHeader = 'group:default/CloudHub-GitHub-RepoCreators';

  it('GET /github/authorization returns authorization status', async () => {
    const { app } = setupRouter({ authorized: true, enabled: true });
    const response = await request(app)
      .get('/github/authorization')
      .set('x-groups', groupsHeader);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authorized: true, enabled: true });
  });

  it('GET /github/templates returns template list', async () => {
    const { app } = setupRouter();
    const response = await request(app)
      .get('/github/templates')
      .set('x-groups', groupsHeader);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(['Empty', 'node-api-template']);
  });

  it('GET /github/teams returns team list', async () => {
    const { app } = setupRouter();
    const response = await request(app)
      .get('/github/teams')
      .set('x-groups', groupsHeader);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      { slug: 'cloud-engineering', name: 'Cloud Engineering' },
    ]);
  });

  it('POST /github/repositories creates a repository', async () => {
    const { app, gitHubRepositoryService } = setupRouter({ authorized: true });
    const response = await request(app)
      .post('/github/repositories')
      .set('x-groups', groupsHeader)
      .send({
        repositoryName: 'platform-orders-api',
        description: 'Orders Domain API',
        visibility: 'private',
        ownerTeam: 'cloud-engineering',
        templateName: 'Empty',
        enableBranchProtection: true,
        enableCodeOwners: true,
        enableDependabot: true,
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.repositoryUrl).toBe(
      'https://github.com/SymphonySensa/platform-orders-api',
    );
    expect(gitHubRepositoryService.createRepository).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryName: 'platform-orders-api' }),
      'user:default/test',
    );
  });

  it('POST /github/repositories rejects unauthorized users', async () => {
    const { app } = setupRouter({ authorized: false, enabled: true });
    const response = await request(app)
      .post('/github/repositories')
      .set('x-groups', groupsHeader)
      .send({
        repositoryName: 'platform-orders-api',
        visibility: 'private',
        ownerTeam: 'cloud-engineering',
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('not authorized');
  });

  it('POST /github/repositories rejects missing fields', async () => {
    const { app, gitHubRepositoryService } = setupRouter({ authorized: true });
    const response = await request(app)
      .post('/github/repositories')
      .set('x-groups', groupsHeader)
      .send({ repositoryName: 'platform-orders-api' });

    expect(response.status).toBe(400);
    expect(gitHubRepositoryService.createRepository).not.toHaveBeenCalled();
  });

  it('POST /github/repositories returns failure from service', async () => {
    const { app } = setupRouter({
      authorized: true,
      createResult: { success: false, message: 'Repository already exists' },
    });
    const response = await request(app)
      .post('/github/repositories')
      .set('x-groups', groupsHeader)
      .send({
        repositoryName: 'platform-orders-api',
        visibility: 'private',
        ownerTeam: 'cloud-engineering',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Repository already exists');
  });
});
