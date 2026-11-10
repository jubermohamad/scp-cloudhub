import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DeveloperEnvironmentPage } from './DeveloperEnvironmentPage';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const renderWithTheme = (ui: React.ReactElement) => render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);
import { CreateDeveloperEnvironmentPage } from './CreateDeveloperEnvironmentPage';
import { DeveloperEnvironmentDetailsPage } from './DeveloperEnvironmentDetailsPage';
import { DeploymentDetailsPage } from './DeploymentDetailsPage';
import { DeveloperEnvironmentStatusBadge } from './DeveloperEnvironmentStatusBadge';

const mockBackendFetch = jest.fn();
const mockNavigate = jest.fn();
type MockRouteParams = { environmentId?: string; deploymentId?: string };
const mockUseParams = jest.fn(
  (): MockRouteParams => ({ environmentId: 'env-1', deploymentId: 'dep-1' }),
);

beforeEach(() => {
  mockBackendFetch.mockReset();
  mockNavigate.mockReset();
  mockUseParams.mockReset();
  mockUseParams.mockReturnValue({
    environmentId: 'env-1',
    deploymentId: 'dep-1',
  });
  mockBackendFetch.mockImplementation(
    async (_pluginId: string, path: string) => {
      if (path.includes('/ci-workflow')) {
        return response(false, {
          error: 'CI workflow endpoint not configured in this test',
        });
      }
      if (path.includes('/deployments')) {
        return response(true, { items: [] });
      }
      return response(false, { error: `Unexpected backend call: ${path}` });
    },
  );
});

jest.mock('@internal/plugin-platform-common', () => ({
  useBackendFetch: () => mockBackendFetch,
}));

jest.mock('@backstage/core-plugin-api', () => {
  const actual = jest.requireActual('@backstage/core-plugin-api');
  return {
    ...actual,
    useApi: (apiRef: { id?: string }) => {
      if (apiRef?.id === 'core.discovery') {
        return {
          getBaseUrl: async () =>
            'http://localhost:7007/api/deployment-control-plane',
        };
      }
      return {};
    },
  };
});

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}));

function response(ok: boolean, body: unknown) {
  return {
    ok,
    json: async () => body,
  };
}

function sampleEnvironment() {
  return {
    id: 'env-1',
    name: 'sri-investigation-api-shared-team',
    displayName: 'SRI Investigation API Workspace',
    description: null,
    productId: 'SRI',
    componentId: 'sri-investigation-api',
    componentDisplayName: 'SRI Investigation API',
    ownerTeam: 'sri-platform',
    developmentProfileId: 'node-api',
    developmentProfileVersion: '1.0.0',
    sourceRepositoryProvider: 'github',
    sourceRepositoryOrganization: 'example-org',
    sourceRepositoryName: 'investigation-api',
    sourceRepositoryUrl: 'https://github.com/example-org/investigation-api',
    sourceBranch: 'main',
    cloudProvider: 'AZURE',
    runtimePlatform: 'KUBERNETES',
    clusterId: 'cluster-1',
    clusterName: 'aks-sri-dev-01',
    namespace: 'cloudhub-workspaces',
    namespaceStatus: 'PENDING',
    environmentType: 'SHARED_TEAM',
    resourceProfile: 'MEDIUM',
    platformServices: {
      containerRegistry: { enabled: true, status: 'READY' },
      secrets: { enabled: true, provider: '1Password', status: 'READY' },
      ingress: { enabled: true, status: 'READY' },
      observability: {
        logs: true,
        metrics: true,
        traces: true,
        status: 'READY',
      },
      dependencies: {
        postgresql: false,
        kafka: false,
        redis: false,
        objectStorage: false,
      },
    },
    securityBaseline: {
      rbac: 'ENFORCED',
      resourceQuota: 'ENFORCED',
      networkPolicy: 'ENFORCED',
      podSecurity: 'ENFORCED',
      workloadIdentity: 'ENFORCED',
      keyVaultIntegration: 'ENFORCED',
      acrAccess: 'ENFORCED',
      ingressDns: 'ENFORCED',
      observability: 'ENFORCED',
      labels: {},
    },
    status: 'REQUESTED',
    statusMessage: 'Queued for provisioning',
    failureReason: null,
    workspaceType: 'devcontainer',
    workspaceStatus: 'NOT_CONFIGURED',
    workspaceStatusMessage:
      'Dev Container has not been validated yet for this repository.',
    workspaceProfileVersion: 'v1',
    workspaceImageRegistry: 'companyacr.azurecr.io',
    workspaceImageRepository: 'cloudhub/dev/node',
    workspaceImageTag: '1.0.0',
    workspaceDevContainerStatus: 'NOT_CONFIGURED',
    workspaceLastValidatedAt: null,
    requestedBy: 'user:default/test',
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z',
    lastTransitionAt: '2026-08-03T12:00:00.000Z',
  };
}

function sampleWorkspace(
  status: 'READY' | 'NOT_CONFIGURED' | 'OUTDATED' | 'FAILED',
) {
  let workspaceStatusMessage = 'Repository validation failed.';
  if (status === 'READY') {
    workspaceStatusMessage =
      'Repository Dev Container is aligned with the selected Development Profile.';
  } else if (status === 'NOT_CONFIGURED') {
    workspaceStatusMessage =
      '.devcontainer/devcontainer.json was not found in the repository branch.';
  } else if (status === 'OUTDATED') {
    workspaceStatusMessage =
      'Repository Dev Container image differs from profile image.';
  }

  let devContainerStatus:
    | 'PLATFORM_MANAGED'
    | 'NOT_CONFIGURED'
    | 'OUTDATED'
    | 'INVALID' = 'INVALID';
  if (status === 'READY') {
    devContainerStatus = 'PLATFORM_MANAGED';
  } else if (status === 'NOT_CONFIGURED') {
    devContainerStatus = 'NOT_CONFIGURED';
  } else if (status === 'OUTDATED') {
    devContainerStatus = 'OUTDATED';
  }

  return {
    environmentId: 'env-1',
    componentId: 'sri-investigation-api',
    componentDisplayName: 'SRI Investigation API',
    developmentProfileId: 'node-api',
    developmentProfileVersion: 'v1',
    repository: {
      provider: 'github',
      organization: 'example-org',
      name: 'investigation-api',
      url: 'https://github.com/example-org/investigation-api',
    },
    branch: 'main',
    workspaceType: 'devcontainer',
    workspaceStatus: status,
    workspaceStatusMessage,
    workspaceProfileVersion: 'v1',
    devContainerStatus,
    devContainerPath: '.devcontainer/devcontainer.json',
    devContainerImage: 'companyacr.azurecr.io/cloudhub/dev/node:1.0.0',
    devContainer: {
      name: 'SRI Investigation API Developer Workspace',
      image: 'companyacr.azurecr.io/cloudhub/dev/node:1.0.0',
      remoteUser: 'developer',
      workspaceFolder: '/workspaces/${localWorkspaceFolderBasename}',
      customizations: {
        vscode: {
          extensions: ['dbaeumer.vscode-eslint'],
          settings: {},
        },
      },
      containerEnv: {},
      features: {},
    },
    recommendedExtensions: ['dbaeumer.vscode-eslint'],
    workspaceFolder: '/workspaces/${localWorkspaceFolderBasename}',
    platformCapabilities: [
      'node',
      'npm',
      'git',
      'kubectl',
      'helm',
      'azure-cli',
      'github-cli',
    ],
    setupInstructions: [
      'Open repository example-org/investigation-api in VS Code.',
      'Install the Dev Containers extension if it is not already installed.',
    ],
    repositoryIntegration: {
      mode: 'read-only',
      canReadRepository: true,
      canCreatePullRequest: false,
      reason:
        'PR creation is not implemented in Phase 2 backend integration yet.',
    },
    workspaceLastValidatedAt: null,
  };
}

function sampleOptions() {
  return {
    product: 'SRI',
    environmentTypes: [{ id: 'SHARED_TEAM', displayName: 'Shared Team' }],
    resourceProfiles: [
      {
        id: 'MEDIUM',
        displayName: 'Medium',
        description: 'Standard profile',
        cpuRequest: '500m',
        cpuLimit: '1',
        memoryRequest: '512Mi',
        memoryLimit: '1Gi',
      },
    ],
    components: [
      {
        id: 'sri-investigation-api',
        product: 'SRI',
        domain: 'Investigation',
        displayName: 'SRI Investigation API',
        componentType: 'service',
        language: { name: 'TypeScript' },
        runtime: { name: 'Node.js', version: '20' },
        developmentProfile: { id: 'node-api', version: '1.0.0' },
        repository: {
          provider: 'github',
          organization: 'example-org',
          name: 'investigation-api',
          url: 'https://github.com/example-org/investigation-api',
          defaultBranch: 'main',
        },
        deployment: { type: 'kubernetes' },
        dependencies: [],
        owner: { team: 'sri-platform' },
        status: 'active',
      },
    ],
    developmentProfiles: [
      {
        id: 'node-api',
        name: 'node-api',
        displayName: 'Node API',
        version: '1.0.0',
        description: 'Node API baseline',
        runtime: 'nodejs',
        runtimeVersion: '20',
        languages: ['typescript'],
        buildTools: ['yarn'],
        platformTools: ['kubectl'],
        ideConfiguration: {},
        deploymentType: 'kubernetes',
        packaging: 'container',
        observabilityConfiguration: {},
        securityConfiguration: {},
        status: 'ACTIVE',
        createdAt: '2026-08-03T12:00:00.000Z',
        updatedAt: '2026-08-03T12:00:00.000Z',
      },
    ],
    clusters: [],
  };
}

function sampleDeployment(
  status: 'BUILDING' | 'READY' | 'FAILED' = 'BUILDING',
) {
  const pipelineStages = [
    { id: 'SOURCE', status: 'SUCCESS' },
    { id: 'BUILD', status: status === 'READY' ? 'SUCCESS' : 'RUNNING' },
    { id: 'TEST', status: status === 'READY' ? 'SUCCESS' : 'PENDING' },
    { id: 'SECURITY', status: status === 'READY' ? 'SUCCESS' : 'PENDING' },
    { id: 'IMAGE', status: status === 'READY' ? 'SUCCESS' : 'PENDING' },
    { id: 'DEPLOY', status: status === 'READY' ? 'SUCCESS' : 'PENDING' },
    { id: 'VERIFY', status: status === 'READY' ? 'SUCCESS' : 'PENDING' },
  ];

  return {
    id: 'dep-1',
    developerEnvironmentId: 'env-1',
    componentId: 'sri-investigation-api',
    repository: 'example-org/investigation-api',
    branch: 'main',
    commitSha: 'abc1234',
    imageRepository: 'companyacr.azurecr.io/sri/investigation-api',
    imageTag: 'abc1234',
    imageDigest: status === 'READY' ? 'sha256:12345' : null,
    clusterId: 'cluster-1',
    clusterName: 'aks-sri-dev-01',
    namespace: 'cloudhub-workspaces',
    releaseName: 'sri-investigation-api',
    deploymentStrategy: 'rolling',
    executorType: 'aks-helm',
    status,
    statusMessage:
      status === 'READY'
        ? 'Deployment is healthy'
        : 'Deployment is in progress',
    failureReason: status === 'FAILED' ? 'Rollout exceeded timeout' : null,
    endpointUrl:
      status === 'READY'
        ? 'https://investigation.dev.example.com/healthz'
        : null,
    workflowRunId: '123456789',
    workflowRunUrl:
      'https://github.com/example-org/investigation-api/actions/runs/123456789',
    pipelineStages,
    requestedBy: 'user:default/test',
    startedAt: '2026-08-03T12:01:00.000Z',
    completedAt: status === 'READY' ? '2026-08-03T12:04:00.000Z' : null,
    createdAt: '2026-08-03T12:01:00.000Z',
    updatedAt: '2026-08-03T12:01:00.000Z',
  };
}

describe('DeveloperEnvironmentStatusBadge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders status label', () => {
    renderWithTheme(<DeveloperEnvironmentStatusBadge status="READY" />);
    expect(screen.getByText('READY')).toBeInTheDocument();
  });
});

describe('DeveloperEnvironmentPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads and displays environment rows', async () => {
    mockBackendFetch.mockResolvedValueOnce(
      response(true, { items: [sampleEnvironment()] }),
    );

    renderWithTheme(<DeveloperEnvironmentPage />);

    await screen.findByText('SRI Investigation API Workspace');
    expect(screen.getByText('SRI Investigation API')).toBeInTheDocument();
    expect(screen.getByText('REQUESTED')).toBeInTheDocument();
  });

  it('shows backend error when load fails', async () => {
    mockBackendFetch.mockResolvedValueOnce(
      response(false, { error: 'Read access denied' }),
    );

    renderWithTheme(<DeveloperEnvironmentPage />);

    expect(await screen.findByText('Read access denied')).toBeInTheDocument();
  });

  it('navigates to create page from create button', async () => {
    mockBackendFetch.mockResolvedValueOnce(response(true, { items: [] }));

    renderWithTheme(<DeveloperEnvironmentPage />);

    await screen.findByText('No workspaces yet');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'New Workspace' })[0],
    );
    expect(mockNavigate).toHaveBeenCalledWith('/workspaces/create');
  });

  it('shows latest deployment action and navigates to deployment details', async () => {
    const environmentWithDeployment = {
      ...sampleEnvironment(),
      latestDeploymentId: 'dep-1',
      latestDeploymentStatus: 'BUILDING',
      latestDeploymentCreatedAt: '2026-08-03T12:01:00.000Z',
    };
    mockBackendFetch.mockResolvedValueOnce(
      response(true, { items: [environmentWithDeployment] }),
    );

    renderWithTheme(<DeveloperEnvironmentPage />);

    await screen.findByText('SRI Investigation API Workspace');
    fireEvent.click(screen.getByRole('button', { name: 'Latest Deployment' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      '/workspaces/env-1/deployments/dep-1',
    );
  });
});

describe('CreateDeveloperEnvironmentPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders wizard after loading options', async () => {
    mockBackendFetch.mockResolvedValueOnce(response(true, sampleOptions()));

    renderWithTheme(<CreateDeveloperEnvironmentPage />);

    await screen.findByText('Create Development');
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('shows options loading error', async () => {
    mockBackendFetch.mockResolvedValueOnce(
      response(false, { error: 'Failed to load wizard options' }),
    );

    renderWithTheme(<CreateDeveloperEnvironmentPage />);

    expect(
      await screen.findByText('Failed to load wizard options'),
    ).toBeInTheDocument();
  });
});

describe('DeveloperEnvironmentDetailsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseParams.mockReturnValue({
      environmentId: 'env-1',
      deploymentId: 'dep-1',
    });
  });

  it('renders environment details from API', async () => {
    mockBackendFetch
      .mockResolvedValueOnce(response(true, sampleEnvironment()))
      .mockResolvedValueOnce(response(true, sampleWorkspace('READY')));

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    await screen.findByText('SRI Investigation API Workspace');
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Developer Workspace')).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Validate Workspace' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Generate Dev Container' }),
    ).toBeInTheDocument();
  });

  it('shows authorization error from backend', async () => {
    mockBackendFetch.mockResolvedValueOnce(
      response(false, {
        error:
          'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      }),
    );

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    expect(
      await screen.findByText(
        'UNAUTHORIZED_COMPONENT_ACCESS: Access denied for this environment',
      ),
    ).toBeInTheDocument();
  });

  it('renders NOT_CONFIGURED workspace state', async () => {
    mockBackendFetch
      .mockResolvedValueOnce(response(true, sampleEnvironment()))
      .mockResolvedValueOnce(response(true, sampleWorkspace('NOT_CONFIGURED')));

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    const statuses = await screen.findAllByText('NOT_CONFIGURED');
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('renders OUTDATED workspace state', async () => {
    mockBackendFetch
      .mockResolvedValueOnce(response(true, sampleEnvironment()))
      .mockResolvedValueOnce(response(true, sampleWorkspace('OUTDATED')));

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    const statuses = await screen.findAllByText('OUTDATED');
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('renders FAILED workspace state', async () => {
    mockBackendFetch
      .mockResolvedValueOnce(response(true, sampleEnvironment()))
      .mockResolvedValueOnce(response(true, sampleWorkspace('FAILED')));

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    const statuses = await screen.findAllByText('FAILED');
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('triggers validate workspace action', async () => {
    mockBackendFetch.mockImplementation(
      async (_pluginId: string, path: string) => {
        if (path === '/workspaces/env-1') {
          return response(true, sampleEnvironment());
        }
        if (path === '/workspaces/env-1/workspace') {
          return response(true, sampleWorkspace('NOT_CONFIGURED'));
        }
        if (path === '/workspaces/env-1/workspace/validate') {
          return response(true, sampleWorkspace('READY'));
        }
        if (path.includes('/ci-workflow')) {
          return response(false, {
            error: 'CI workflow endpoint not configured in this test',
          });
        }
        if (path.includes('/deployments')) {
          return response(true, { items: [] });
        }
        return response(false, { error: `Unexpected backend call: ${path}` });
      },
    );

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    const statuses = await screen.findAllByText('NOT_CONFIGURED');
    expect(statuses.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Validate Workspace' }));

    await screen.findByText(
      'Repository Dev Container is aligned with the selected Development Profile.',
    );
    expect(mockBackendFetch).toHaveBeenCalledWith(
      'deployment-control-plane',
      '/workspaces/env-1/workspace/validate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('triggers generate devcontainer action', async () => {
    const generated = {
      workspace: sampleWorkspace('NOT_CONFIGURED'),
      generatedFiles: [
        {
          path: '.devcontainer/devcontainer.json',
          content:
            '{\n  "name": "SRI Investigation API Developer Workspace"\n}',
          mediaType: 'application/json',
        },
      ],
      repositoryUpdate: {
        mode: 'manual',
        instructions: ['Create branch', 'Open PR'],
      },
    };

    mockBackendFetch.mockImplementation(
      async (_pluginId: string, path: string) => {
        if (path === '/workspaces/env-1') {
          return response(true, sampleEnvironment());
        }
        if (path === '/workspaces/env-1/workspace') {
          return response(true, sampleWorkspace('NOT_CONFIGURED'));
        }
        if (path === '/workspaces/env-1/workspace/generate') {
          return response(true, generated);
        }
        if (path.includes('/ci-workflow')) {
          return response(false, {
            error: 'CI workflow endpoint not configured in this test',
          });
        }
        if (path.includes('/deployments')) {
          return response(true, { items: [] });
        }
        return response(false, { error: `Unexpected backend call: ${path}` });
      },
    );

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    const statuses = await screen.findAllByText('NOT_CONFIGURED');
    expect(statuses.length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate Dev Container' }),
    );

    await screen.findByText('Generated .devcontainer/devcontainer.json');
    expect(mockBackendFetch).toHaveBeenCalledWith(
      'deployment-control-plane',
      '/workspaces/env-1/workspace/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows missing id message when route param is absent', async () => {
    mockUseParams.mockReturnValue({ environmentId: undefined });

    renderWithTheme(<DeveloperEnvironmentDetailsPage />);

    await waitFor(() => {
      expect(screen.getByText('Environment ID is missing')).toBeInTheDocument();
    });
  });
});

describe('DeploymentDetailsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseParams.mockReturnValue({
      environmentId: 'env-1',
      deploymentId: 'dep-1',
    });
  });

  it('renders deployment details from API', async () => {
    mockBackendFetch.mockImplementation(
      async (_pluginId: string, path: string) => {
        if (path === '/workspaces/env-1/deployments/dep-1') {
          return response(true, sampleDeployment('BUILDING'));
        }
        return response(false, { error: `Unexpected backend call: ${path}` });
      },
    );

    renderWithTheme(<DeploymentDetailsPage />);

    await screen.findByText('Deployment Details');
    expect(screen.getByText('Artifact')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getAllByText('BUILDING').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Sync Status' }),
    ).toBeInTheDocument();
  });

  it('syncs deployment status via API', async () => {
    let syncMethod: string | undefined;
    mockBackendFetch.mockImplementation(
      async (_pluginId: string, path: string, init?: RequestInit) => {
        if (path === '/workspaces/env-1/deployments/dep-1') {
          return response(true, sampleDeployment('BUILDING'));
        }
        if (path === '/workspaces/env-1/deployments/dep-1/sync') {
          syncMethod = init?.method;
          return response(true, sampleDeployment('READY'));
        }
        return response(false, { error: `Unexpected backend call: ${path}` });
      },
    );

    renderWithTheme(<DeploymentDetailsPage />);

    await screen.findByText('Deployment Details');
    fireEvent.click(screen.getByRole('button', { name: 'Sync Status' }));

    await waitFor(() => {
      expect(mockBackendFetch).toHaveBeenCalledWith(
        'deployment-control-plane',
        '/workspaces/env-1/deployments/dep-1/sync',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByText('READY').length).toBeGreaterThan(0);
    });
    expect(syncMethod).toBe('POST');
  });

  it('shows missing param message when route params are absent', async () => {
    mockUseParams.mockReturnValue({
      environmentId: undefined,
      deploymentId: undefined,
    });

    renderWithTheme(<DeploymentDetailsPage />);

    expect(
      await screen.findByText('Environment ID or deployment ID is missing'),
    ).toBeInTheDocument();
  });
});
