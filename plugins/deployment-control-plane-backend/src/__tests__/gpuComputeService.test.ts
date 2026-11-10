import {
  GpuComputeError,
  GpuComputeService,
  type GpuComputeDeps,
} from '../services/gpuComputeService';
import { GpuTerraformCloudService } from '../services/gpuTerraformCloudService';
import type { GpuQuotaService } from '../services/gpuQuotaService';
import type { GpuVmPowerService } from '../services/gpuVmPowerService';
import type { CreateGpuInstanceInput } from '../types';

const SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';

function baseInput(
  overrides: Partial<CreateGpuInstanceInput> = {},
): CreateGpuInstanceInput {
  return {
    name: 'gpu-team-a-001',
    gpuSku: 'a100',
    region: 'eastus2',
    subscriptionId: SUBSCRIPTION_ID,
    vnetName: 'vnet-a',
    subnetName: 'ml-subnet',
    owner: 'user@symphonysensa.com',
    businessJustification: 'Training workload for research team',
    leaseDuration: '30d',
    actorRef: 'user:default/test',
    role: 'platform-admin',
    ...overrides,
  };
}

function buildService(
  opts: {
    sufficientQuota?: boolean;
    profileResolver?: (prefix: string) => Array<{
      name: string;
      network: {
        subscriptionId: string;
        resourceGroup: string;
        vnetName: string;
        subnetName: string;
        region: string;
      };
    }>;
    allProfiles?: Record<
      string,
      {
        subscriptionId: string;
        resourceGroup: string;
        vnetName: string;
        subnetName: string;
        region: string;
      }
    >;
  } = {},
) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;

  const dispatch = jest.fn().mockResolvedValue({
    mode: 'terraform-cloud',
    repository: 'SymphonySensa/scp-azure-terraform-modules',
    branch: 'feature/juber-ai-vm',
    workflowId: 'gpu-gpu-team-a-001',
    runId: '99',
    status: 'queued',
    conclusion: null,
    htmlUrl:
      'https://app.terraform.io/app/sensa-cloud-platform/workspaces/gpu-gpu-team-a-001/runs/99',
  });
  const runStatus = jest.fn();
  const runLogs = jest.fn().mockResolvedValue({
    mode: 'terraform-cloud',
    runId: '99',
    lines: ['[plan] Planning complete', '[apply] Apply complete'],
  });

  const checkQuota = jest.fn().mockResolvedValue({
    gpuSku: 'a100',
    region: 'eastus2',
    vmSize: 'Standard_NC24ads_A100_v4',
    gpuFamily: 'standardNCADSA100v4Family',
    currentUsage: 0,
    limit: opts.sufficientQuota === false ? 0 : 24,
    available: opts.sufficientQuota === false ? 0 : 24,
    requested: 24,
    sufficient: opts.sufficientQuota !== false,
    message: opts.sufficientQuota === false ? 'Insufficient quota' : 'OK',
  });

  const audit = jest.fn().mockResolvedValue(undefined);

  const powerStart = jest.fn().mockResolvedValue(undefined);
  const powerStop = jest.fn().mockResolvedValue(undefined);
  const getPowerState = jest.fn().mockResolvedValue('running');

  const deps: GpuComputeDeps = {
    logger,
    getPool: () => null,
    terraform: {
      repository: () => 'SymphonySensa/scp-azure-terraform-modules',
      branch: () => 'feature/juber-ai-vm',
      dispatch,
      runStatus,
      runLogs,
    } as unknown as GpuTerraformCloudService,
    quota: { checkQuota } as unknown as GpuQuotaService,
    power: {
      start: powerStart,
      stop: powerStop,
      getPowerState,
    } as unknown as GpuVmPowerService,
    azure: {
      discoverSubscriptions: jest
        .fn()
        .mockResolvedValue([
          { id: SUBSCRIPTION_ID, name: 'Test Subscription' },
        ]),
      discoverGpuVnets: jest
        .fn()
        .mockResolvedValue([
          { name: 'vnet-a', resourceGroup: 'rg-network', location: 'eastus2' },
        ]),
      discoverGpuSubnets: jest.fn().mockResolvedValue([
        {
          id: '/subscriptions/xxx/resourceGroups/rg-team-a/providers/Microsoft.Network/virtualNetworks/vnet-a/subnets/ml-subnet',
          name: 'ml-subnet',
          addressRange: '10.1.20.0/24',
          availableIpAddresses: 124,
          location: 'eastus2',
        },
      ]),
    } as any,
    networks: {
      listByPrefix: jest.fn(
        opts.profileResolver ??
          ((prefix: string) => {
            if (prefix === 'gpu-a100') {
              return [
                {
                  name: 'gpu-a100',
                  network: {
                    subscriptionId: SUBSCRIPTION_ID,
                    resourceGroup: 'rg-network',
                    vnetName: 'vnet-a',
                    subnetName: 'ml-subnet',
                    region: 'eastus2',
                  },
                },
              ];
            }
            if (prefix === 'gpu-h100') {
              return [
                {
                  name: 'gpu-h100',
                  network: {
                    subscriptionId: SUBSCRIPTION_ID,
                    resourceGroup: 'rg-network',
                    vnetName: 'vnet-h',
                    subnetName: 'ml-subnet-h100',
                    region: 'eastus2',
                  },
                },
              ];
            }
            return [];
          }),
      ),
      getAll: jest.fn(
        () =>
          opts.allProfiles ?? {
            'gpu-a100': {
              subscriptionId: SUBSCRIPTION_ID,
              resourceGroup: 'rg-network',
              vnetName: 'vnet-a',
              subnetName: 'ml-subnet',
              region: 'eastus2',
            },
            'gpu-h100': {
              subscriptionId: SUBSCRIPTION_ID,
              resourceGroup: 'rg-network',
              vnetName: 'vnet-h',
              subnetName: 'ml-subnet-h100',
              region: 'eastus2',
            },
          },
      ),
    } as any,
    audit,
  };

  return {
    service: new GpuComputeService(deps),
    dispatch,
    runStatus,
    runLogs,
    checkQuota,
    audit,
    powerStart,
    powerStop,
    getPowerState,
  };
}

describe('GpuTerraformCloudService fixed workspace behavior', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('uses a fixed Terraform Cloud workspace when CLOUDHUB_TFC_WORKSPACE_NAME is set', async () => {
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-id';
    process.env.GITHUB_ACTIONS_TOKEN = 'actions-token';
    process.env.CLOUDHUB_TFC_REPOSITORY = 'jubermohamad/platform_cloudhub';
    process.env.CLOUDHUB_TFC_BRANCH = 'main';
    process.env.CLOUDHUB_TFC_WORKING_DIRECTORY = 'infra/gpu-self-service';
    process.env.CLOUDHUB_TFC_WORKSPACE_NAME = 'platform_cloudhub';

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const workspaceLookupCalls: string[] = [];
    const createWorkspaceCalls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/organizations/sensa-cloud-platform/workspaces/platform_cloudhub')) {
        workspaceLookupCalls.push(url);
        return new Response(JSON.stringify({ data: { id: 'workspace-fixed' } }), {
          status: 200,
        });
      }

      if (url.includes('/organizations/sensa-cloud-platform/workspaces')) {
        createWorkspaceCalls.push(url);
        return new Response(JSON.stringify({ data: { id: 'workspace-created' } }), {
          status: 201,
        });
      }

      if (url.includes('/workspaces/workspace-fixed?include=current_run')) {
        return new Response(
          JSON.stringify({
            included: [{ type: 'runs', id: 'run-fixed', attributes: { status: 'planned' } }],
          }),
          { status: 200 },
        );
      }

      if (url.includes('/repos/jubermohamad/platform_cloudhub/contents/infra/gpu-self-service/values/gpu-team-a-001.tfvars.json')) {
        return new Response(JSON.stringify({ commit: { sha: 'new-sha' } }), {
          status: 201,
        });
      }

      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const service = new GpuTerraformCloudService(logger);
      const result = await service.dispatch({
        requestId: 'req-fixed',
        action: 'apply',
        vmName: 'gpu-team-a-001',
        vmSize: 'Standard_NC24ads_A100_v4',
        subnetId: '/subscriptions/test/subnets/ml',
        location: 'eastus2',
        resourceGroupName: 'rg-gpu-sdc',
        tfvarsJson: '{"name":"gpu-team-a-001"}',
      });

      expect(result.mode).toBe('terraform-cloud');
      expect(result.workflowId).toBe('platform_cloudhub');
      expect(result.runId).toBe('run-fixed');
      expect(createWorkspaceCalls).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('fails clearly when a configured fixed workspace does not exist', async () => {
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-id';
    process.env.GITHUB_ACTIONS_TOKEN = 'actions-token';
    process.env.CLOUDHUB_TFC_REPOSITORY = 'jubermohamad/platform_cloudhub';
    process.env.CLOUDHUB_TFC_BRANCH = 'main';
    process.env.CLOUDHUB_TFC_WORKING_DIRECTORY = 'infra/gpu-self-service';
    process.env.CLOUDHUB_TFC_WORKSPACE_NAME = 'platform_cloudhub';

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/organizations/sensa-cloud-platform/workspaces/platform_cloudhub')) {
        return new Response(JSON.stringify({}), { status: 404, statusText: 'Not Found' });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const service = new GpuTerraformCloudService(logger);
      await expect(
        service.dispatch({
          requestId: 'req-fixed-missing',
          action: 'apply',
          vmName: 'gpu-team-a-001',
          vmSize: 'Standard_NC24ads_A100_v4',
          subnetId: '/subscriptions/test/subnets/ml',
          location: 'eastus2',
          resourceGroupName: 'rg-gpu-sdc',
          tfvarsJson: '{"name":"gpu-team-a-001"}',
        }),
      ).rejects.toThrow(
        'Terraform Cloud workspace "platform_cloudhub" was configured via CLOUDHUB_TFC_WORKSPACE_NAME but does not exist',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('creates the workspace in the CloudHub project using the configured repo and VCS OAuth token', async () => {
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-id';
    process.env.GITHUB_ACTIONS_TOKEN = 'actions-token';
    process.env.CLOUDHUB_TFC_REPOSITORY = 'jubermohamad/platform_cloudhub';
    process.env.CLOUDHUB_TFC_BRANCH = 'main';
    process.env.CLOUDHUB_TFC_WORKING_DIRECTORY = 'infra/gpu-self-service';

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const originalFetch = global.fetch;
    const projectId = 'project-cloudhub';
    const workspaceId = 'workspace-created';
    let createWorkspacePayload: any = null;

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/organizations/sensa-cloud-platform/projects')) {
        return new Response(
          JSON.stringify({ data: [{ id: projectId, attributes: { name: 'CloudHub' } }] }),
          { status: 200 },
        );
      }

      if (url.includes('/organizations/sensa-cloud-platform/workspaces/platform_cloudhub-gpu-gpu-team-a-001')) {
        return new Response(JSON.stringify({}), { status: 404, statusText: 'Not Found' });
      }

      if (url.includes('/organizations/sensa-cloud-platform/workspaces') && init?.method === 'POST') {
        createWorkspacePayload = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ data: { id: workspaceId } }), { status: 201 });
      }

      if (url.includes(`/workspaces/${workspaceId}/vars`)) {
        return new Response(JSON.stringify({ data: { id: 'var-1' } }), { status: 201 });
      }

      if (url.includes(`/workspaces/${workspaceId}?include=current_run`)) {
        return new Response(
          JSON.stringify({
            included: [{ type: 'runs', id: 'run-created', attributes: { status: 'planned' } }],
          }),
          { status: 200 },
        );
      }

      if (url.includes('/repos/jubermohamad/platform_cloudhub/contents/infra/gpu-self-service/values/gpu-team-a-001.tfvars.json')) {
        return new Response(JSON.stringify({ commit: { sha: 'new-sha' } }), { status: 201 });
      }

      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const service = new GpuTerraformCloudService(logger);
      const result = await service.dispatch({
        requestId: 'req-create-project',
        action: 'apply',
        vmName: 'gpu-team-a-001',
        vmSize: 'Standard_NC24ads_A100_v4',
        subnetId: '/subscriptions/test/subnets/ml',
        location: 'eastus2',
        resourceGroupName: 'rg-gpu-sdc',
        tfvarsJson: '{"name":"gpu-team-a-001"}',
      });

      expect(result.mode).toBe('terraform-cloud');
      expect(result.workflowId).toBe('platform_cloudhub-gpu-gpu-team-a-001');
      expect(result.runId).toBe('run-created');
      expect(createWorkspacePayload).not.toBeNull();
      expect(createWorkspacePayload.data.attributes.name).toBe('platform_cloudhub-gpu-gpu-team-a-001');
      expect(createWorkspacePayload.data.attributes['working-directory']).toBe('infra/gpu-self-service');
      expect(createWorkspacePayload.data.attributes['vcs-repo'].identifier).toBe('jubermohamad/platform_cloudhub');
      expect(createWorkspacePayload.data.attributes['vcs-repo'].branch).toBe('main');
      expect(createWorkspacePayload.data.attributes['vcs-repo']['oauth-token-id']).toBe('oauth-id');
      expect(createWorkspacePayload.data.relationships.project.data.id).toBe(projectId);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Terraform Cloud workspace bootstrap'),
        expect.objectContaining({
          workspaceName: 'platform_cloudhub-gpu-gpu-team-a-001',
          repositoryIdentifier: 'jubermohamad/platform_cloudhub',
          projectId,
          workingDirectory: 'infra/gpu-self-service',
        }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('reuses an existing dynamic workspace when one already exists', async () => {
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-id';
    process.env.GITHUB_ACTIONS_TOKEN = 'actions-token';
    process.env.CLOUDHUB_TFC_REPOSITORY = 'jubermohamad/platform_cloudhub';
    process.env.CLOUDHUB_TFC_BRANCH = 'main';
    process.env.CLOUDHUB_TFC_WORKING_DIRECTORY = 'infra/gpu-self-service';

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const createWorkspaceCalls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/organizations/sensa-cloud-platform/workspaces/platform_cloudhub-gpu-gpu-team-a-001')) {
        return new Response(JSON.stringify({ data: { id: 'workspace-existing' } }), {
          status: 200,
        });
      }

      if (url.includes('/organizations/sensa-cloud-platform/workspaces') && init?.method === 'POST') {
        createWorkspaceCalls.push(url);
        return new Response(JSON.stringify({ data: { id: 'workspace-created' } }), {
          status: 201,
        });
      }

      if (url.includes('/workspaces/workspace-existing?include=current_run')) {
        return new Response(
          JSON.stringify({
            included: [{ type: 'runs', id: 'run-existing', attributes: { status: 'planned' } }],
          }),
          { status: 200 },
        );
      }

      if (url.includes('/repos/jubermohamad/platform_cloudhub/contents/infra/gpu-self-service/values/gpu-team-a-001.tfvars.json')) {
        return new Response(JSON.stringify({ commit: { sha: 'new-sha' } }), {
          status: 201,
        });
      }

      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const service = new GpuTerraformCloudService(logger);
      const result = await service.dispatch({
        requestId: 'req-existing',
        action: 'apply',
        vmName: 'gpu-team-a-001',
        vmSize: 'Standard_NC24ads_A100_v4',
        subnetId: '/subscriptions/test/subnets/ml',
        location: 'eastus2',
        resourceGroupName: 'rg-gpu-sdc',
        tfvarsJson: '{"name":"gpu-team-a-001"}',
      });

      expect(result.mode).toBe('terraform-cloud');
      expect(result.workflowId).toBe('platform_cloudhub-gpu-gpu-team-a-001');
      expect(result.runId).toBe('run-existing');
      expect(createWorkspaceCalls).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('falls back to simulated mode when the tfvars repository is not configured', async () => {
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-id';
    process.env.CLOUDHUB_GITHUB_TOKEN = 'github-token';
    process.env.CLOUDHUB_TFC_REPOSITORY = 'does-not-exist/example';
    process.env.CLOUDHUB_TFC_BRANCH = 'main';

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '{"message":"Not Found"}',
      json: async () => ({ message: 'Not Found' }),
    } as unknown as Response)) as typeof fetch;

    try {
      const service = new GpuTerraformCloudService(logger);
      const result = await service.dispatch({
        requestId: 'req-1',
        action: 'apply',
        vmName: 'gpu-team-a-001',
        vmSize: 'Standard_NC24ads_A100_v4',
        subnetId: '/subscriptions/test/subnets/ml',
        location: 'eastus2',
        resourceGroupName: 'rg-gpu-sdc',
        tfvarsJson: '{"name":"gpu-team-a-001"}',
      });

      expect(result.mode).toBe('simulated');
      expect(result.runId).toMatch(/^sim-/);
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('GpuTerraformCloudService GitHub token usage', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('uses GITHUB_ACTIONS_TOKEN for the GPU tfvars commit to platform_cloudhub', async () => {
    process.env.CLOUDHUB_TFC_TOKEN = 'tfc-token';
    process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID = 'oauth-id';
    process.env.CLOUDHUB_GITHUB_TOKEN = 'wrong-cloudhub-token';
    process.env.GITHUB_ACTIONS_TOKEN = 'actions-token';
    process.env.GITHUB_TOKEN = 'generic-token';
    process.env.CLOUDHUB_TFC_BRANCH = 'main';

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as any;

    const commitAuthHeaders: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? '',
      );

      if (url.includes('/repos/jubermohamad/platform_cloudhub/contents/infra/gpu-self-service/values/gpu-team-a-001.tfvars.json')) {
        commitAuthHeaders.push(auth);

        if (url.includes('values/gpu-team-a-001.tfvars.json?ref=')) {
          return new Response(JSON.stringify({ sha: 'existing-sha' }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ commit: { sha: 'new-sha' } }), {
          status: 201,
        });
      }

      if (url.includes('/organizations/sensa-cloud-platform/workspaces/platform_cloudhub-gpu-gpu-team-a-001')) {
        return new Response(JSON.stringify({ data: { id: 'workspace-123' } }), {
          status: 200,
        });
      }

      if (url.includes('/workspaces/workspace-123?include=current_run')) {
        return new Response(
          JSON.stringify({
            included: [{ type: 'runs', id: 'run-99', attributes: { status: 'planned' } }],
          }),
          { status: 200 },
        );
      }

      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const service = new GpuTerraformCloudService(logger);
      const result = await service.dispatch({
        requestId: 'req-1',
        action: 'apply',
        vmName: 'gpu-team-a-001',
        vmSize: 'Standard_NC24ads_A100_v4',
        subnetId: '/subscriptions/test/subnets/ml',
        location: 'eastus2',
        resourceGroupName: 'rg-gpu-sdc',
        tfvarsJson: '{"name":"gpu-team-a-001"}',
      });

      expect(result.mode).toBe('terraform-cloud');
      expect(result.runId).toBe('run-99');
      expect(commitAuthHeaders).toEqual(['Bearer actions-token', 'Bearer actions-token']);
      expect(commitAuthHeaders).not.toContain('Bearer wrong-cloudhub-token');
      expect(commitAuthHeaders).not.toContain('Bearer generic-token');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('GpuComputeService', () => {
  it('exposes the supported GPU SKUs and registry applications', async () => {
    const { service } = buildService();
    const options = await service.getOptions();
    expect(options.skus.map(s => s.id)).toEqual(['a100', 'h100']);
    expect(options.resourceGroup).toBe('rg-gpu-sdc');
    expect(options.terraformBranch).toBe('feature/juber-ai-vm');
    expect(options.terraformRepository).toBe(
      'SymphonySensa/scp-azure-terraform-modules',
    );
  });

  it('falls back to generic gpu profiles when sku-specific profiles are absent', async () => {
    const { service } = buildService({
      profileResolver: () => [],
      allProfiles: {
        'gpu-eiffel-shared': {
          subscriptionId: SUBSCRIPTION_ID,
          resourceGroup: 'eiffel-eurekaai-rg',
          vnetName: 'eiffeleurekaaivpc',
          subnetName: 'snet-gpu',
          region: 'eastus2',
        },
      },
    });

    const vnets = await service.getVnets({ gpuSku: 'h100' });
    expect(vnets).toEqual([
      {
        subscriptionId: SUBSCRIPTION_ID,
        resourceGroup: 'eiffel-eurekaai-rg',
        vnetName: 'eiffeleurekaaivpc',
        region: 'eastus2',
      },
    ]);
  });

  it('returns network profile diagnostics with source attribution', async () => {
    const { service } = buildService({
      profileResolver: (prefix: string) => {
        if (prefix === 'gpu-a100') {
          return [
            {
              name: 'gpu-a100-primary',
              network: {
                subscriptionId: SUBSCRIPTION_ID,
                resourceGroup: 'rg-a100',
                vnetName: 'vnet-a100',
                subnetName: 'snet-a100',
                region: 'eastus2',
              },
            },
          ];
        }
        return [];
      },
      allProfiles: {
        'gpu-a100-primary': {
          subscriptionId: SUBSCRIPTION_ID,
          resourceGroup: 'rg-a100',
          vnetName: 'vnet-a100',
          subnetName: 'snet-a100',
          region: 'eastus2',
        },
        'gpu-shared': {
          subscriptionId: SUBSCRIPTION_ID,
          resourceGroup: 'rg-shared',
          vnetName: 'vnet-shared',
          subnetName: 'snet-shared',
          region: 'eastus2',
        },
      },
    });

    const diagnostics = service.getNetworkProfileDiagnostics();
    expect(diagnostics.allProfileNames).toEqual([
      'gpu-a100-primary',
      'gpu-shared',
    ]);
    expect(diagnostics.bySku.a100[0].source).toBe('sku');
    expect(diagnostics.bySku.a100[0].name).toBe('gpu-a100-primary');
    expect(diagnostics.bySku.h100[0].source).toBe('generic-fallback');
    expect(diagnostics.bySku.h100[0].name).toBe('gpu-shared');
  });

  it('rejects invalid VM names', async () => {
    const { service } = buildService();
    await expect(
      service.create(baseInput({ name: 'GPU_Test' })),
    ).rejects.toThrow(GpuComputeError);
  });

  it('rejects unsupported GPU SKUs', async () => {
    const { service } = buildService();
    await expect(
      service.create(baseInput({ gpuSku: 'v100' as any })),
    ).rejects.toThrow(/Unsupported GPU SKU/);
  });

  it('rejects creation when quota is insufficient', async () => {
    const { service, dispatch } = buildService({ sufficientQuota: false });
    await expect(service.create(baseInput())).rejects.toThrow(GpuComputeError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches the fixed terraform repo/branch and persists the instance', async () => {
    const { service, dispatch, audit } = buildService();
    const record = await service.create(baseInput());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'apply',
        vmName: 'gpu-team-a-001',
        vmSize: 'Standard_NC24ads_A100_v4',
        resourceGroupName: 'rg-gpu-sdc',
      }),
    );
    expect(record.status).toBe('PROVISIONING');
    expect(record.resourceGroup).toBe('rg-gpu-sdc');
    expect(record.terraformBranch).toBe('feature/juber-ai-vm');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gpu-instance.create' }),
    );

    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(record.id);

    const fetched = await service.get(record.id);
    expect(fetched?.name).toBe('gpu-team-a-001');
  });

  it('dispatches a destroy workflow and marks the instance DELETING', async () => {
    const { service, dispatch } = buildService();
    const record = await service.create(baseInput());
    dispatch.mockClear();

    const deleted = await service.remove({
      id: record.id,
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'destroy', vmName: record.name }),
    );
    expect(deleted.status).toBe('DELETING');
  });

  it('rejects deleting an instance that is already deleting', async () => {
    const { service } = buildService();
    const record = await service.create(baseInput());
    await service.remove({
      id: record.id,
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });

    await expect(
      service.remove({
        id: record.id,
        actorRef: 'user:default/test',
        role: 'platform-admin',
      }),
    ).rejects.toThrow(/already deleting/);
  });

  it('refreshes status to READY on successful workflow completion', async () => {
    const { service, runStatus } = buildService();
    const record = await service.create(baseInput());
    runStatus.mockResolvedValue({
      mode: 'github-api',
      runId: record.workflowRunId,
      status: 'completed',
      conclusion: 'success',
    });

    const updated = await service.refreshStatus(record.id);
    expect(updated?.status).toBe('READY');
  });

  it('stops a running instance and refreshes to STOPPED once deallocated', async () => {
    const { service, runStatus, powerStop, getPowerState } = buildService();
    const record = await service.create(baseInput());
    runStatus.mockResolvedValue({
      mode: 'github-api',
      runId: record.workflowRunId,
      status: 'completed',
      conclusion: 'success',
    });
    await service.refreshStatus(record.id);

    const stopped = await service.stop({
      id: record.id,
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });
    expect(powerStop).toHaveBeenCalledWith(record.resourceGroup, record.name);
    expect(stopped.status).toBe('STOPPING');

    getPowerState.mockResolvedValue('deallocated');
    const refreshed = await service.refreshStatus(record.id);
    expect(refreshed?.status).toBe('STOPPED');
  });

  it('starts a stopped instance and refreshes to READY once running again', async () => {
    const { service, runStatus, powerStart, getPowerState } = buildService();
    const record = await service.create(baseInput());
    runStatus.mockResolvedValue({
      mode: 'github-api',
      runId: record.workflowRunId,
      status: 'completed',
      conclusion: 'success',
    });
    await service.refreshStatus(record.id);
    getPowerState.mockResolvedValue('deallocated');
    await service.stop({
      id: record.id,
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });
    await service.refreshStatus(record.id);

    const started = await service.start({
      id: record.id,
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });
    expect(powerStart).toHaveBeenCalledWith(record.resourceGroup, record.name);
    expect(started.status).toBe('STARTING');

    getPowerState.mockResolvedValue('running');
    const refreshed = await service.refreshStatus(record.id);
    expect(refreshed?.status).toBe('READY');
  });

  it('rejects starting an instance that is not stopped', async () => {
    const { service } = buildService();
    const record = await service.create(baseInput());
    await expect(
      service.start({
        id: record.id,
        actorRef: 'user:default/test',
        role: 'platform-admin',
      }),
    ).rejects.toThrow(/cannot be started/);
  });

  it('rejects stopping an instance that is not ready', async () => {
    const { service } = buildService();
    const record = await service.create(baseInput());
    await expect(
      service.stop({
        id: record.id,
        actorRef: 'user:default/test',
        role: 'platform-admin',
      }),
    ).rejects.toThrow(/cannot be stopped/);
  });

  it('emits and lists events during provisioning', async () => {
    const { service } = buildService();
    const record = await service.create(baseInput());

    const events = await service.listEvents(record.id);
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.some(e => e.message.includes('requested'))).toBe(true);
    expect(
      events.some(e => e.message.includes('Terraform Cloud run dispatched')),
    ).toBe(true);
  });

  it('streams live events over the instance event bus', async () => {
    const { service } = buildService();
    const record = await service.create(baseInput());

    const received: import('../types').GpuInstanceEvent[] = [];
    const unsubscribe = service.onInstanceEvent(record.id, event => {
      received.push(event);
    });

    await service.remove({
      id: record.id,
      actorRef: 'user:default/test',
      role: 'platform-admin',
    });
    unsubscribe();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received.some(e => e.message.includes('destroy requested'))).toBe(
      true,
    );
  });

  it('returns Terraform Cloud run logs for an instance', async () => {
    const { service, runLogs } = buildService();
    const record = await service.create(baseInput());

    const logs = await service.runLogs(record.id);
    expect(logs.mode).toBe('terraform-cloud');
    expect(logs.runId).toBe('99');
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(runLogs).toHaveBeenCalledWith(record.workflowRunId);
  });
});
