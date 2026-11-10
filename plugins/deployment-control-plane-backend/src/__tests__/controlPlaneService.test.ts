import type { LoggerService } from '@backstage/backend-plugin-api';
import { ControlPlaneService } from '../services/controlPlaneService';
import { GitHubActionsService } from '../services/githubActionsService';
import { KubernetesWorkspaceProvisioner } from '../services/workspaceKubernetesProvisioner';

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis() as any,
};

describe('ControlPlaneService.discoverResourceGroups', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.POSTGRES_HOST;
    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: true,
        checks: [],
        checkedAt: new Date().toISOString(),
      });
  });

  it('falls back to registered clusters when Azure discovery fails', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest
      .spyOn((service as any).azure, 'discoverResourceGroups')
      .mockRejectedValue(new Error('local credential unavailable'));

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: '1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        tenantId: null,
        clusterName: 'aks-sri-prod-01',
        environment: 'prod',
        region: 'eastus2',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-prod',
        createdAt: new Date().toISOString(),
      },
      {
        id: '3',
        tenantId: null,
        clusterName: 'aks-other',
        environment: 'dev',
        region: 'westus',
        subscriptionId: 'sub-2',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-other-sub',
        createdAt: new Date().toISOString(),
      },
    ]);

    await expect(
      service.discoverResourceGroups({ subscriptionId: 'sub-1' }),
    ).resolves.toEqual(['rg-sri-dev', 'rg-sri-prod']);

    await expect(
      service.discoverResourceGroups({
        subscriptionId: 'sub-1',
        search: 'prod',
      }),
    ).resolves.toEqual(['rg-sri-prod']);
  });
});

describe('ControlPlaneService developer environment lifecycle', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.POSTGRES_HOST;
    jest
      .spyOn(KubernetesWorkspaceProvisioner.prototype, 'createWorkspace')
      .mockResolvedValue();
    jest
      .spyOn(KubernetesWorkspaceProvisioner.prototype, 'startWorkspace')
      .mockResolvedValue();
    jest
      .spyOn(KubernetesWorkspaceProvisioner.prototype, 'resumeWorkspace')
      .mockResolvedValue();
    jest
      .spyOn(KubernetesWorkspaceProvisioner.prototype, 'stopWorkspace')
      .mockResolvedValue();
    jest
      .spyOn(KubernetesWorkspaceProvisioner.prototype, 'deleteWorkspace')
      .mockResolvedValue();
    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: true,
        checks: [],
        checkedAt: new Date().toISOString(),
      });
  });

  it('seeds development profiles in local runtime', async () => {
    const service = new ControlPlaneService(mockLogger);
    const profiles = await service.listDevelopmentProfiles();

    const ids = profiles.map(profile => profile.id);
    expect(ids).toContain('node-api');
    expect(ids).toContain('react-ui');
    expect(ids).toContain('python-agent');
  });

  it('creates shared-team developer environment and is idempotent by name', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const request = {
      componentId: 'sri-investigation-api',
      source: {
        branch: 'main',
        repository: {
          provider: 'github',
          organization: 'example-org',
          name: 'investigation-api',
          url: 'https://github.com/example-org/investigation-api',
        },
      },
      runtime: {
        cloudProvider: 'AZURE',
        platform: 'KUBERNETES',
        clusterId: 'cluster-1',
      },
      environmentType: 'SHARED_TEAM' as const,
      resourceProfile: 'MEDIUM' as const,
      platformServices: {
        dependencies: {
          postgresql: false,
          kafka: false,
          redis: false,
          objectStorage: false,
        },
      },
    };

    const created = await service.createDeveloperEnvironment({
      request,
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    expect(created.status).toBe('READY');
    expect(created.workspacePodName).toMatch(/^ws-/);
    expect(created.workspacePvcName).toMatch(/-home$/);
    expect(created.developmentProfileId).toBe('node-api');
    expect(created.workspaceImageRepository).toBe('sri-dev-python');
    expect(created.workspaceImageTag).toBe('latest');
    expect(created.environmentType).toBe('SHARED_TEAM');
    expect(created.resourceProfile).toBe('MEDIUM');
    expect(created.sourceRepositoryName).toBe('investigation-api');

    const repeated = await service.createDeveloperEnvironment({
      request,
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    expect(repeated.id).toBe(created.id);
  });

  it('maps detection domain workspace image to java template', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const created = await service.createDeveloperEnvironment({
      request: {
        componentId: 'sri-detection-api',
        source: {
          branch: 'main',
          repository: {
            provider: 'github',
            organization: 'example-org',
            name: 'detection-api',
          },
        },
        runtime: {
          cloudProvider: 'AZURE',
          platform: 'KUBERNETES',
          clusterId: 'cluster-1',
        },
        environmentType: 'SHARED_TEAM',
        resourceProfile: 'MEDIUM',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    expect(created.workspaceImageRepository).toBe('sri-dev-java');
    expect(created.workspaceImageTag).toBe('latest');
  });

  it('rejects unsupported resource profile', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    await expect(
      service.createDeveloperEnvironment({
        request: {
          componentId: 'sri-investigation-api',
          source: {
            branch: 'main',
            repository: {
              provider: 'github',
              organization: 'example-org',
              name: 'investigation-api',
            },
          },
          runtime: {
            cloudProvider: 'AZURE',
            platform: 'KUBERNETES',
            clusterId: 'cluster-1',
          },
          environmentType: 'SHARED_TEAM',
          resourceProfile: 'XL' as any,
        },
        actorRef: 'user:default/test',
        role: 'app-engineering',
      }),
    ).rejects.toThrow('RESOURCE_PROFILE_INVALID: XL');
  });

  it('fails fast when workspace preflight is not ready', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: false,
        checks: [
          {
            key: 'namespace',
            status: 'FAILED',
            message:
              'Namespace cloudhub-workspaces does not exist on aks-scp-dev-sdc-st-cms.',
          },
        ],
        checkedAt: new Date().toISOString(),
      });

    await expect(
      service.createDeveloperEnvironment({
        request: {
          componentId: 'sri-investigation-api',
          source: {
            branch: 'main',
            repository: {
              provider: 'github',
              organization: 'example-org',
              name: 'investigation-api',
            },
          },
          runtime: {
            cloudProvider: 'AZURE',
            platform: 'KUBERNETES',
            clusterId: 'cluster-1',
          },
          environmentType: 'SHARED_TEAM',
          resourceProfile: 'MEDIUM',
        },
        actorRef: 'user:default/test',
        role: 'app-engineering',
      }),
    ).rejects.toThrow('WORKSPACE_PRECHECK_FAILED');
  });

  it('fails fast when postgres dependency precheck secret is missing', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: false,
        checks: [
          {
            key: 'postgresSidecarSecret',
            status: 'FAILED',
            message:
              'Postgres secret postgres-credentials is missing key password.',
          },
        ],
        checkedAt: new Date().toISOString(),
      });

    await expect(
      service.createDeveloperEnvironment({
        request: {
          componentId: 'sri-investigation-api',
          source: {
            branch: 'main',
            repository: {
              provider: 'github',
              organization: 'example-org',
              name: 'investigation-api',
            },
          },
          runtime: {
            cloudProvider: 'AZURE',
            platform: 'KUBERNETES',
            clusterId: 'cluster-1',
          },
          environmentType: 'SHARED_TEAM',
          resourceProfile: 'MEDIUM',
          platformServices: {
            dependencies: {
              postgresql: true,
              kafka: false,
              redis: false,
              objectStorage: false,
            },
          },
        },
        actorRef: 'user:default/test',
        role: 'app-engineering',
      }),
    ).rejects.toThrow('WORKSPACE_PRECHECK_FAILED');
  });

  it('fails fast when kafka dependency precheck secret is missing', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: false,
        checks: [
          {
            key: 'kafkaSidecarSecret',
            status: 'FAILED',
            message: 'Kafka secret kafka-credentials is missing key password.',
          },
        ],
        checkedAt: new Date().toISOString(),
      });

    await expect(
      service.createDeveloperEnvironment({
        request: {
          componentId: 'sri-investigation-api',
          source: {
            branch: 'main',
            repository: {
              provider: 'github',
              organization: 'example-org',
              name: 'investigation-api',
            },
          },
          runtime: {
            cloudProvider: 'AZURE',
            platform: 'KUBERNETES',
            clusterId: 'cluster-1',
          },
          environmentType: 'SHARED_TEAM',
          resourceProfile: 'MEDIUM',
          platformServices: {
            dependencies: {
              postgresql: false,
              kafka: true,
              redis: false,
              objectStorage: false,
            },
          },
        },
        actorRef: 'user:default/test',
        role: 'app-engineering',
      }),
    ).rejects.toThrow('WORKSPACE_PRECHECK_FAILED');
  });

  it('supports STOPPED -> READY transition via workspace lifecycle actions', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const env = await service.createDeveloperEnvironment({
      request: {
        componentId: 'sri-investigation-api',
        source: {
          branch: 'main',
          repository: {
            provider: 'github',
            organization: 'example-org',
            name: 'investigation-api',
          },
        },
        runtime: {
          cloudProvider: 'AZURE',
          platform: 'KUBERNETES',
          clusterId: 'cluster-1',
        },
        environmentType: 'SHARED_TEAM',
        resourceProfile: 'MEDIUM',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    const stopped = await service.stopDeveloperWorkspace({
      id: env.id,
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
    expect(stopped.status).toBe('STOPPED');

    const started = await service.startDeveloperWorkspace({
      id: env.id,
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });
    expect(started.status).toBe('READY');
  });

  it('rejects workspace start from terminal DELETED state', async () => {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const env = await service.createDeveloperEnvironment({
      request: {
        componentId: 'sri-investigation-api',
        source: {
          branch: 'main',
          repository: {
            provider: 'github',
            organization: 'example-org',
            name: 'investigation-api',
          },
        },
        runtime: {
          cloudProvider: 'AZURE',
          platform: 'KUBERNETES',
          clusterId: 'cluster-1',
        },
        environmentType: 'SHARED_TEAM',
        resourceProfile: 'MEDIUM',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    await service.deleteDeveloperEnvironment({
      id: env.id,
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    await expect(
      service.startDeveloperWorkspace({
        id: env.id,
        actorRef: 'user:default/test',
        role: 'app-engineering',
      }),
    ).rejects.toThrow('WORKSPACE_STATE_INVALID');
  });
});

describe('ControlPlaneService developer workspace', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.POSTGRES_HOST;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_ACTIONS_TOKEN;
    global.fetch = originalFetch;
    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: true,
        checks: [],
        checkedAt: new Date().toISOString(),
      });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function createEnvironmentWithRepository() {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const env = await service.createDeveloperEnvironment({
      request: {
        componentId: 'sri-investigation-api',
        source: {
          branch: 'main',
          repository: {
            provider: 'github',
            organization: 'example-org',
            name: 'investigation-api',
            url: 'https://github.com/example-org/investigation-api',
          },
        },
        runtime: {
          cloudProvider: 'AZURE',
          platform: 'KUBERNETES',
          clusterId: 'cluster-1',
        },
        environmentType: 'SHARED_TEAM',
        resourceProfile: 'MEDIUM',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    return { service, env };
  }

  it('returns NOT_CONFIGURED when repository validation token is unavailable', async () => {
    const { service, env } = await createEnvironmentWithRepository();
    const workspace = await service.getDeveloperEnvironmentWorkspace({
      id: env.id,
    });

    expect(workspace.workspaceStatus).toBe('NOT_CONFIGURED');
    expect(workspace.devContainerStatus).toBe('NOT_CONFIGURED');
    expect(workspace.devContainerImage).toContain('/sri-dev-python:latest');
  });

  it('returns NOT_CONFIGURED when devcontainer file is missing', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const { service, env } = await createEnvironmentWithRepository();

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not Found',
      statusText: 'Not Found',
    } as any);

    const workspace = await service.getDeveloperEnvironmentWorkspace({
      id: env.id,
    });

    expect(workspace.workspaceStatus).toBe('NOT_CONFIGURED');
    expect(workspace.devContainerStatus).toBe('NOT_CONFIGURED');
  });

  it('returns READY for platform-managed devcontainer', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const { service, env } = await createEnvironmentWithRepository();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from(
          JSON.stringify({
            name: 'SRI Investigation - APIs Developer Workspace',
            image: 'companyacr.azurecr.io/sri-dev-python:latest',
            remoteUser: 'developer',
            workspaceFolder: '/workspaces/${localWorkspaceFolderBasename}',
            customizations: {
              vscode: {
                extensions: ['dbaeumer.vscode-eslint'],
                settings: {
                  'terminal.integrated.defaultProfile.linux': 'bash',
                },
              },
            },
            containerEnv: {},
            features: {},
            postCreateCommand:
              'if [ -f package-lock.json ]; then npm ci; elif [ -f package.json ]; then npm install; fi',
          }),
          'utf8',
        ).toString('base64'),
      }),
    } as any);

    const workspace = await service.getDeveloperEnvironmentWorkspace({
      id: env.id,
    });

    expect(workspace.workspaceStatus).toBe('READY');
    expect(workspace.devContainerStatus).toBe('PLATFORM_MANAGED');
  });

  it('returns OUTDATED when image differs', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const { service, env } = await createEnvironmentWithRepository();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from(
          JSON.stringify({
            image: 'companyacr.azurecr.io/sri-dev-python:0.9.0',
            remoteUser: 'developer',
          }),
          'utf8',
        ).toString('base64'),
      }),
    } as any);

    const workspace = await service.getDeveloperEnvironmentWorkspace({
      id: env.id,
    });

    expect(workspace.workspaceStatus).toBe('OUTDATED');
    expect(workspace.devContainerStatus).toBe('OUTDATED');
  });

  it('returns INVALID when devcontainer json is malformed', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const { service, env } = await createEnvironmentWithRepository();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from('{not valid json', 'utf8').toString('base64'),
      }),
    } as any);

    const workspace = await service.getDeveloperEnvironmentWorkspace({
      id: env.id,
    });

    expect(workspace.workspaceStatus).toBe('INVALID');
    expect(workspace.devContainerStatus).toBe('INVALID');
  });

  it('returns CUSTOM when configuration intentionally differs', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const { service, env } = await createEnvironmentWithRepository();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from(
          JSON.stringify({
            remoteUser: 'devuser',
            customizations: { vscode: { extensions: ['ms-python.python'] } },
          }),
          'utf8',
        ).toString('base64'),
      }),
    } as any);

    const workspace = await service.getDeveloperEnvironmentWorkspace({
      id: env.id,
    });

    expect(workspace.workspaceStatus).toBe('CUSTOM');
    expect(workspace.devContainerStatus).toBe('CUSTOM');
  });
});

describe('ControlPlaneService phase 3 deployment and CI workflow', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.POSTGRES_HOST;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_ACTIONS_TOKEN;
    delete process.env.SRI_PIPELINE_REPO;
    jest
      .spyOn(
        KubernetesWorkspaceProvisioner.prototype,
        'validateWorkspacePrerequisites',
      )
      .mockResolvedValue({
        platformId: 'sri-dev-workspaces',
        clusterName: 'aks-scp-dev-sdc-st-cms',
        namespace: 'cloudhub-workspaces',
        ready: true,
        checks: [],
        checkedAt: new Date().toISOString(),
      });
  });

  async function createPhase3Environment() {
    const service = new ControlPlaneService(mockLogger);

    jest.spyOn(service, 'listClusters').mockResolvedValue([
      {
        id: 'cluster-1',
        tenantId: null,
        clusterName: 'aks-sri-dev-01',
        environment: 'dev',
        region: 'eastus',
        subscriptionId: 'sub-1',
        cloudProvider: 'Azure',
        kubernetesVersion: '1.30.3',
        status: 'Succeeded',
        resourceGroup: 'rg-sri-dev',
        tags: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const env = await service.createDeveloperEnvironment({
      request: {
        componentId: 'sri-investigation-api',
        source: {
          branch: 'main',
          repository: {
            provider: 'github',
            organization: 'example-org',
            name: 'investigation-api',
            url: 'https://github.com/example-org/investigation-api',
          },
        },
        runtime: {
          cloudProvider: 'AZURE',
          platform: 'KUBERNETES',
          clusterId: 'cluster-1',
        },
        environmentType: 'SHARED_TEAM',
        resourceProfile: 'MEDIUM',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    return { service, env };
  }

  it('returns NOT_CONFIGURED CI workflow status when token is unavailable', async () => {
    const { service, env } = await createPhase3Environment();
    const workflow = await service.getDeveloperEnvironmentCiWorkflow({
      id: env.id,
    });

    expect(workflow.workflowStatus).toBe('NOT_CONFIGURED');
    expect(workflow.generatedFiles.map(file => file.path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/deploy-dev.yml',
    ]);
  });

  it('creates and lists deployment records when executor dispatch succeeds', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.SRI_PIPELINE_REPO = 'example-org/investigation-api';

    jest.spyOn(GitHubActionsService.prototype, 'dispatch').mockResolvedValue({
      mode: 'github-api',
      repository: 'example-org/investigation-api',
      workflowId: 'deploy-dev.yml',
      ref: 'main',
      runId: '12345',
      status: 'queued',
      conclusion: null,
      htmlUrl:
        'https://github.com/example-org/investigation-api/actions/runs/12345',
    });

    const { service, env } = await createPhase3Environment();

    const deployment = await service.createApplicationDeployment({
      developerEnvironmentId: env.id,
      source: {
        branch: 'main',
        commitSha: 'a7bc93211aa0bb11cc22dd33ee44ff55aa66bb77',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    expect(deployment.status).toBe('QUEUED');
    expect(deployment.imageTag).toBe('a7bc93211aa0');
    expect(deployment.workflowRunId).toBe('12345');

    const history = await service.listApplicationDeployments({
      developerEnvironmentId: env.id,
    });

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(deployment.id);
  });

  it('reports common-res as already deployed on the target cluster', async () => {
    const { service } = await createPhase3Environment();

    const coreApi = {
      readNamespace: jest.fn().mockResolvedValue({}),
      readNamespacedSecret: jest.fn().mockResolvedValue({
        body: {
          type: 'kubernetes.io/dockerconfigjson',
          data: { '.dockerconfigjson': 'dGVzdA==' },
        },
      }),
    } as any;

    jest.spyOn(service as any, 'getClusterCoreApi').mockResolvedValue(coreApi);

    const report = await service.getCommonResPreflight({
      subscriptionId: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
      resourceGroup: 'rg-sri-dev',
      clusterName: 'aks-sri-dev-01',
      namespace: 'common-res',
    });

    expect(report.ready).toBe(true);
    expect(report.namespaceExists).toBe(true);
    expect(report.registrySecretName).toBe('regcred');
    expect(report.message).toContain('bootstrap looks ready');
    expect(service as any).toHaveProperty('getClusterCoreApi');
    expect(coreApi.readNamespace).toHaveBeenCalledWith({ name: 'common-res' });
    expect(coreApi.readNamespacedSecret).toHaveBeenCalledWith({
      name: 'regcred',
      namespace: 'common-res',
    });
  });

  it('syncs deployment status from workflow run state', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.SRI_PIPELINE_REPO = 'example-org/investigation-api';

    jest.spyOn(GitHubActionsService.prototype, 'dispatch').mockResolvedValue({
      mode: 'github-api',
      repository: 'example-org/investigation-api',
      workflowId: 'deploy-dev.yml',
      ref: 'main',
      runId: '12345',
      status: 'queued',
      conclusion: null,
      htmlUrl:
        'https://github.com/example-org/investigation-api/actions/runs/12345',
    });

    jest.spyOn(GitHubActionsService.prototype, 'runStatus').mockResolvedValue({
      mode: 'github-api',
      runId: '12345',
      workflowId: 'deploy-dev.yml',
      status: 'completed',
      conclusion: 'success',
      htmlUrl:
        'https://github.com/example-org/investigation-api/actions/runs/12345',
      jobs: [
        { id: 1, name: 'build', status: 'completed', conclusion: 'success', steps: [] },
        { id: 2, name: 'deploy', status: 'completed', conclusion: 'success', steps: [] },
      ],
    });

    const { service, env } = await createPhase3Environment();

    const deployment = await service.createApplicationDeployment({
      developerEnvironmentId: env.id,
      source: {
        branch: 'main',
        commitSha: 'a7bc93211aa0bb11cc22dd33ee44ff55aa66bb77',
      },
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    const synced = await service.syncApplicationDeploymentStatus({
      deploymentId: deployment.id,
      actorRef: 'user:default/test',
      role: 'app-engineering',
    });

    expect(synced.status).toBe('READY');
    expect(synced.completedAt).toBeTruthy();
    expect(
      synced.pipelineStages.every(stage => stage.status === 'SUCCESS'),
    ).toBe(true);
  });
});
