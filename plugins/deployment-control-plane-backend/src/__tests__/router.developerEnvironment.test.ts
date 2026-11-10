import express from 'express';
import request from 'supertest';
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { patchSupertestIpv4 } from 'backend/src/test-utils/patchSupertestIpv4';
import { createControlPlaneRouter } from '../router';

patchSupertestIpv4();

type MockService = {
  getRuntimeHealth: jest.Mock;
  listDevelopmentProfiles: jest.Mock;
  getDevelopmentProfile: jest.Mock;
  getDeveloperEnvironmentOptions: jest.Mock;
  getDeveloperWorkspaceOptions: jest.Mock;
  getWorkspaceProvisioningPreflight: jest.Mock;
  listWorkspaceTemplates: jest.Mock;
  listWorkspaces: jest.Mock;
  getWorkspace: jest.Mock;
  getWorkspaceConnection: jest.Mock;
  createWorkspaceConnectionSession: jest.Mock;
  resumeWorkspace: jest.Mock;
  createWorkspace: jest.Mock;
  deleteWorkspace: jest.Mock;
  startWorkspace: jest.Mock;
  stopWorkspace: jest.Mock;
  listDeveloperEnvironments: jest.Mock;
  getDeveloperEnvironment: jest.Mock;
  createDeveloperEnvironment: jest.Mock;
  deleteDeveloperEnvironment: jest.Mock;
  startDeveloperWorkspace: jest.Mock;
  stopDeveloperWorkspace: jest.Mock;
  getDeveloperEnvironmentWorkspace: jest.Mock;
  validateDeveloperEnvironmentWorkspace: jest.Mock;
  generateDeveloperEnvironmentWorkspace: jest.Mock;
  getDeveloperEnvironmentCiWorkflow: jest.Mock;
  validateDeveloperEnvironmentCiWorkflow: jest.Mock;
  generateDeveloperEnvironmentCiWorkflow: jest.Mock;
  listApplicationDeployments: jest.Mock;
  getCommonResPreflight: jest.Mock;
  createApplicationDeployment: jest.Mock;
  getApplicationDeployment: jest.Mock;
  syncApplicationDeploymentStatus: jest.Mock;
};

function buildApp() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;

  const service: MockService = {
    getRuntimeHealth: jest.fn().mockReturnValue({
      ready: true,
      initialized: true,
      storageMode: 'in-memory',
      timestamp: '2026-08-03T00:00:00.000Z',
    }),
    listDevelopmentProfiles: jest.fn().mockResolvedValue([]),
    getDevelopmentProfile: jest.fn().mockResolvedValue(null),
    getDeveloperEnvironmentOptions: jest.fn().mockResolvedValue({
      products: [],
      components: [],
      clusters: [],
      resourceProfiles: [],
      environmentTypes: ['SHARED_TEAM'],
      platformServicesDefaults: {},
      securityBaselineDefaults: {},
    }),
    getDeveloperWorkspaceOptions: jest.fn().mockResolvedValue({
      products: [],
      components: [],
      clusters: [],
      resourceProfiles: [],
      environmentTypes: ['SHARED_TEAM'],
      platformServicesDefaults: {},
      securityBaselineDefaults: {},
    }),
    getWorkspaceProvisioningPreflight: jest.fn().mockResolvedValue({
      ready: true,
      checks: [],
      checkedAt: '2026-08-06T00:00:00.000Z',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      namespace: 'cloudhub-workspaces',
      platformId: 'sri-dev-workspaces',
    }),
    listWorkspaceTemplates: jest.fn().mockResolvedValue([]),
    listWorkspaces: jest.fn().mockResolvedValue([]),
    getWorkspace: jest.fn().mockResolvedValue(null),
    getWorkspaceConnection: jest
      .fn()
      .mockResolvedValue({ connectionStatus: 'UNAVAILABLE' }),
    createWorkspaceConnectionSession: jest
      .fn()
      .mockResolvedValue({ sessionStatus: 'NOT_CONFIGURED' }),
    resumeWorkspace: jest.fn(),
    createWorkspace: jest.fn(),
    deleteWorkspace: jest.fn(),
    startWorkspace: jest.fn(),
    stopWorkspace: jest.fn(),
    listDeveloperEnvironments: jest.fn().mockResolvedValue([]),
    getDeveloperEnvironment: jest.fn().mockResolvedValue(null),
    createDeveloperEnvironment: jest.fn(),
    deleteDeveloperEnvironment: jest.fn(),
    startDeveloperWorkspace: jest.fn(),
    stopDeveloperWorkspace: jest.fn(),
    getDeveloperEnvironmentWorkspace: jest
      .fn()
      .mockResolvedValue({ workspaceStatus: 'NOT_CONFIGURED' }),
    validateDeveloperEnvironmentWorkspace: jest
      .fn()
      .mockResolvedValue({ workspaceStatus: 'READY' }),
    generateDeveloperEnvironmentWorkspace: jest
      .fn()
      .mockResolvedValue({ generatedFiles: [] }),
    getDeveloperEnvironmentCiWorkflow: jest
      .fn()
      .mockResolvedValue({ workflowStatus: 'NOT_CONFIGURED' }),
    validateDeveloperEnvironmentCiWorkflow: jest
      .fn()
      .mockResolvedValue({ workflowStatus: 'PLATFORM_MANAGED' }),
    generateDeveloperEnvironmentCiWorkflow: jest.fn().mockResolvedValue({
      workflow: {},
      repositoryUpdate: { mode: 'manual', instructions: [] },
    }),
    listApplicationDeployments: jest.fn().mockResolvedValue([]),
    getCommonResPreflight: jest.fn().mockResolvedValue({
      ready: true,
      checkedAt: '2026-09-16T00:00:00.000Z',
      subscriptionId: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
      resourceGroup: 'rg-sri-dev',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      namespace: null,
      namespaceExists: true,
      registrySecretName: 'regcred',
      registrySecretType: 'kubernetes.io/dockerconfigjson',
      message: 'common-res bootstrap looks ready on aks-scp-dev-sdc-st-cms (common-res); found regcred.',
    }),
    createApplicationDeployment: jest
      .fn()
      .mockResolvedValue({ id: 'dep-1', developerEnvironmentId: 'env-1' }),
    getApplicationDeployment: jest
      .fn()
      .mockResolvedValue({ id: 'dep-1', developerEnvironmentId: 'env-1' }),
    syncApplicationDeploymentStatus: jest.fn().mockResolvedValue({
      id: 'dep-1',
      developerEnvironmentId: 'env-1',
      status: 'READY',
    }),
  };

  const httpAuth = {
    credentials: jest.fn(async () => ({
      principal: { type: 'user' },
    })),
  } as any;

  const userInfo = {
    getUserInfo: jest.fn(async (credentials: any) => ({
      userEntityRef: 'user:default/test',
      ownershipEntityRefs: credentials.groups ?? [],
    })),
  } as any;

  httpAuth.credentials.mockImplementation(async (req: express.Request) => {
    const groups =
      (req.headers['x-groups'] as string | undefined)
        ?.split(',')
        .map(s => s.trim())
        .filter(Boolean) ?? [];
    return { principal: { type: 'user' }, groups };
  });

  const gitHubAuthorizationService = {
    isEnabled: jest.fn().mockReturnValue(false),
    authorize: jest.fn().mockResolvedValue({ authorized: false, enabled: false }),
  } as any;
  const gitHubRepositoryService = {} as any;

  const router = createControlPlaneRouter({
    logger,
    httpAuth,
    userInfo,
    service: service as any,
    gitHubAuthorizationService,
    gitHubRepositoryService,
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, service };
}

describe('Control Plane Router developer environment endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes list to requester for non-platform roles', async () => {
    const { app, service } = buildApp();

    const res = await request(app)
      .get('/developer-environments')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(service.listDeveloperEnvironments).toHaveBeenCalledWith({
      ownerTeam: undefined,
      requestedBy: 'user:default/test',
      includeDeleted: false,
    });
  });

  it('scopes workspace list to requester for non-platform roles', async () => {
    const { app, service } = buildApp();

    const res = await request(app)
      .get('/workspaces')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(service.listWorkspaces).toHaveBeenCalledWith({
      ownerTeam: undefined,
      requestedBy: 'user:default/test',
      includeDeleted: false,
    });
  });

  it('returns workspace templates for readers', async () => {
    const { app, service } = buildApp();
    service.listWorkspaceTemplates.mockResolvedValue([
      { id: 'node-api', displayName: 'Node.js API' },
    ]);

    const res = await request(app)
      .get('/workspace-templates')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { id: 'node-api', displayName: 'Node.js API' },
    ]);
    expect(service.listWorkspaceTemplates).toHaveBeenCalledTimes(1);
  });

  it('returns workspace preflight report for readers', async () => {
    const { app, service } = buildApp();

    const res = await request(app)
      .get(
        '/workspaces/preflight?postgresql=true&kafka=true&componentId=sri-data-pipeline&developmentProfileId=python-data',
      )
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(service.getWorkspaceProvisioningPreflight).toHaveBeenCalledWith({
      componentId: 'sri-data-pipeline',
      developmentProfileId: 'python-data',
      dependencies: {
        postgresql: true,
        kafka: true,
        temporal: false,
      },
    });
  });

  it('returns common-res preflight report for readers', async () => {
    const { app, service } = buildApp();

    const res = await request(app)
      .post('/deployments/common-res-preflight')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({
        subscriptionId: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
        resourceGroup: 'rg-sri-dev',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'common-res',
      });

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(service.getCommonResPreflight).toHaveBeenCalledWith({
      subscriptionId: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
      resourceGroup: 'rg-sri-dev',
      clusterName: 'aks-scp-dev-sdc-st-cms',
      namespace: 'common-res',
    });
  });

  it('returns workspace connection details for owner', async () => {
    const { app, service } = buildApp();
    service.getWorkspace.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.getWorkspaceConnection.mockResolvedValue({
      environmentId: 'env-1',
      workspaceStatus: 'READY',
      connectionStatus: 'READY',
      connectionMode: 'manual-vscode-kubernetes',
      namespace: 'cloudhub-workspaces',
      targetCluster: 'aks-scp-dev-sdc-st-cms',
      podName: 'ws-env-1',
      containerName: 'workspace',
      portForwardCommand:
        'kubectl port-forward pod/ws-env-1 8000:8000 -n cloudhub-workspaces',
      vscodeAttachHint:
        'VS Code Command Palette -> Remote: Attach to Kubernetes Pod',
      instructions: ['Open VS Code.'],
      updatedAt: '2026-08-06T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/workspaces/env-1/connection')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(res.body.connectionStatus).toBe('READY');
    expect(service.getWorkspaceConnection).toHaveBeenCalledWith({
      id: 'env-1',
    });
  });

  it('creates managed workspace session for owner', async () => {
    const { app, service } = buildApp();
    service.getWorkspace.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.createWorkspaceConnectionSession.mockResolvedValue({
      environmentId: 'env-1',
      sessionStatus: 'READY',
      sessionMode: 'cloudhub-session-url',
      launchUrl: 'https://example.local/connect?token=abc',
      expiresAt: '2026-08-06T00:15:00.000Z',
      instructions: ['Open launch URL.'],
      updatedAt: '2026-08-06T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/workspaces/env-1/connection/session')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.sessionStatus).toBe('READY');
    expect(service.createWorkspaceConnectionSession).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('maps workspace precheck failure to 400', async () => {
    const { app, service } = buildApp();
    service.createWorkspace.mockRejectedValue(
      new Error(
        'WORKSPACE_PRECHECK_FAILED: Namespace cloudhub-workspaces does not exist',
      ),
    );

    const res = await request(app)
      .post('/workspaces')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({
        componentId: 'sri-investigation-api',
        source: {
          branch: 'main',
          repository: {
            provider: 'github',
            organization: 'example',
            name: 'repo',
          },
        },
        runtime: { cloudProvider: 'AZURE', platform: 'KUBERNETES' },
        environmentType: 'SHARED_TEAM',
        resourceProfile: 'MEDIUM',
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('WORKSPACE_PRECHECK_FAILED');
  });

  it('starts workspace for owner', async () => {
    const { app, service } = buildApp();
    service.getWorkspace.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.resumeWorkspace.mockResolvedValue({
      id: 'env-1',
      status: 'READY',
    });

    const res = await request(app)
      .post('/workspaces/env-1/start')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(service.resumeWorkspace).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('maps invalid workspace start transition to 400', async () => {
    const { app, service } = buildApp();
    service.getWorkspace.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.resumeWorkspace.mockRejectedValue(
      new Error(
        'WORKSPACE_STATE_INVALID: Transition DELETED -> READY is not allowed',
      ),
    );

    const res = await request(app)
      .post('/workspaces/env-1/start')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('WORKSPACE_STATE_INVALID');
  });

  it('resumes workspace via dedicated resume endpoint', async () => {
    const { app, service } = buildApp();
    service.getWorkspace.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.resumeWorkspace.mockResolvedValue({
      id: 'env-1',
      status: 'READY',
    });

    const res = await request(app)
      .post('/workspaces/env-1/resume')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(service.resumeWorkspace).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('stops workspace for owner', async () => {
    const { app, service } = buildApp();
    service.getWorkspace.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.stopWorkspace.mockResolvedValue({
      id: 'env-1',
      status: 'STOPPED',
    });

    const res = await request(app)
      .post('/workspaces/env-1/stop')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(service.stopWorkspace).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('returns control-plane health for authorized readers', async () => {
    const { app, service } = buildApp();

    const res = await request(app)
      .get('/health')
      .set('x-groups', 'group:default/cloudhubplatformowners');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ready: true,
      initialized: true,
      storageMode: 'in-memory',
    });
    expect(service.getRuntimeHealth).toHaveBeenCalledTimes(1);
  });

  it('does not scope list to requester for platform role', async () => {
    const { app, service } = buildApp();

    const res = await request(app)
      .get('/developer-environments?ownerTeam=sri&includeDeleted=true')
      .set('x-groups', 'group:default/cloudhubplatformowners');

    expect(res.status).toBe(200);
    expect(service.listDeveloperEnvironments).toHaveBeenCalledWith({
      ownerTeam: 'sri',
      requestedBy: undefined,
      includeDeleted: true,
    });
  });

  it('denies create for readonly role', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post('/developer-environments')
      .set('x-groups', 'group:default/cloudhub-login-allow')
      .send({});

    expect(res.status).toBe(403);
    expect(String(res.body.error)).toContain(
      'Only platform, app-engineering, or professional-services',
    );
  });

  it('maps create NOT_FOUND errors to 404', async () => {
    const { app, service } = buildApp();
    service.createDeveloperEnvironment.mockRejectedValue(
      new Error('COMPONENT_NOT_FOUND: missing component'),
    );

    const res = await request(app)
      .post('/developer-environments')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({ componentId: 'missing' });

    expect(res.status).toBe(404);
    expect(String(res.body.error)).toContain('COMPONENT_NOT_FOUND');
  });

  it('forbids non-owner access to a developer environment record', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/someone-else',
    });

    const res = await request(app)
      .get('/developer-environments/env-1')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(403);
    expect(String(res.body.error)).toContain('UNAUTHORIZED_COMPONENT_ACCESS');
  });

  it('allows app-engineering to delete own environment', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.deleteDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      status: 'DELETED',
    });

    const res = await request(app)
      .delete('/developer-environments/env-1')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(service.deleteDeveloperEnvironment).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('returns workspace details for authorized owner', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.getDeveloperEnvironmentWorkspace.mockResolvedValue({
      environmentId: 'env-1',
      workspaceStatus: 'NOT_CONFIGURED',
    });

    const res = await request(app)
      .get('/developer-environments/env-1/workspace')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(service.getDeveloperEnvironmentWorkspace).toHaveBeenCalledWith({
      id: 'env-1',
    });
  });

  it('denies workspace details for non-owner non-platform user', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/other-user',
    });

    const res = await request(app)
      .get('/developer-environments/env-1/workspace')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(403);
  });

  it('validates workspace for owner', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.validateDeveloperEnvironmentWorkspace.mockResolvedValue({
      environmentId: 'env-1',
      workspaceStatus: 'READY',
    });

    const res = await request(app)
      .post('/developer-environments/env-1/workspace/validate')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(service.validateDeveloperEnvironmentWorkspace).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('generates workspace configuration for owner', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
    });
    service.generateDeveloperEnvironmentWorkspace.mockResolvedValue({
      workspace: { environmentId: 'env-1' },
      generatedFiles: [{ path: '.devcontainer/devcontainer.json' }],
    });

    const res = await request(app)
      .post('/developer-environments/env-1/workspace/generate')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(service.generateDeveloperEnvironmentWorkspace).toHaveBeenCalledWith({
      id: 'env-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('returns ci-workflow details for authorized owner', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
      sourceBranch: 'main',
    });

    const res = await request(app)
      .get('/developer-environments/env-1/ci-workflow')
      .set('x-groups', 'group:default/cloudhubappeng');

    expect(res.status).toBe(200);
    expect(service.getDeveloperEnvironmentCiWorkflow).toHaveBeenCalledWith({
      id: 'env-1',
    });
  });

  it('creates an application deployment for owner', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
      sourceBranch: 'main',
    });
    service.createApplicationDeployment.mockResolvedValue({
      id: 'dep-1',
      developerEnvironmentId: 'env-1',
      status: 'QUEUED',
    });

    const res = await request(app)
      .post('/developer-environments/env-1/deployments')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({ source: { branch: 'main', commitSha: 'abc123' } });

    expect(res.status).toBe(202);
    expect(service.createApplicationDeployment).toHaveBeenCalledWith({
      developerEnvironmentId: 'env-1',
      source: {
        branch: 'main',
        commitSha: 'abc123',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });

  it('syncs deployment status for owner', async () => {
    const { app, service } = buildApp();
    service.getDeveloperEnvironment.mockResolvedValue({
      id: 'env-1',
      requestedBy: 'user:default/test',
      sourceBranch: 'main',
    });
    service.syncApplicationDeploymentStatus.mockResolvedValue({
      id: 'dep-1',
      developerEnvironmentId: 'env-1',
      status: 'READY',
    });

    const res = await request(app)
      .post('/developer-environments/env-1/deployments/dep-1/sync')
      .set('x-groups', 'group:default/cloudhubappeng')
      .send({});

    expect(res.status).toBe(200);
    expect(service.syncApplicationDeploymentStatus).toHaveBeenCalledWith({
      deploymentId: 'dep-1',
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
  });
});
