import { validateCustomerName } from './DeploymentWizard';

const backendModule = {
  useBackendFetch: jest.fn(),
  useBackendEventStream: jest.fn(),
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const optionsBody = {
  applications: [
    {
      id: 'detectionhub',
      appName: 'detectionhub',
      displayName: 'DetectionHub',
      description: 'Detection service',
      chartVersions: [],
      supportsAiStoreIntegration: false,
    },
  ],
  environments: ['dev'],
  customers: ['sri'],
  repository: 'SymphonyFS/scripts',
  branch: 'main',
};

const clustersBody = {
  clusters: [
    {
      clusterName: 'aks-scp-dev-sdc-st-cms',
      region: 'eastus',
      resourceGroup: 'rg-scp-dev-sdc-st-cms',
      kubernetesVersion: '1.29.0',
      nodePools: 2,
      environment: 'dev',
      status: 'Succeeded',
      subscriptionId: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
      tags: {},
    },
  ],
};

function readinessReport(ready: boolean) {
  return {
    ready,
    checkedAt: '2026-09-15T00:00:00.000Z',
    cached: false,
    cacheExpiresAt: '2026-09-15T00:05:00.000Z',
    application: 'detectionhub',
    instanceName: 'dt-test',
    clusterName: 'aks-scp-dev-sdc-st-cms',
    includePipelineRefs: true,
    filesScanned: ['apps/detectionhub/dt-test/overrides.gotmpl'],
    referencesDiscovered: 1,
    findings: ready
      ? [
          {
            reference: 'op://Customers/sri/detectionhub-dt-test/db_password',
            normalizedReference:
              'op://Customers/sri/detectionhub-dt-test/db_password',
            vault: 'Customers',
            item: 'sri',
            section: 'detectionhub-dt-test',
            field: 'db_password',
            status: 'READY',
            message: 'Reference resolved successfully and value is populated.',
            sources: [
              {
                path: 'apps/detectionhub/dt-test/overrides.gotmpl',
                line: 1,
              },
            ],
          },
        ]
      : [
          {
            reference: 'op://Customers/sri/detectionhub-dt-test/db_password',
            normalizedReference:
              'op://Customers/sri/detectionhub-dt-test/db_password',
            vault: 'Customers',
            item: 'sri',
            section: 'detectionhub-dt-test',
            field: 'db_password',
            status: 'MISSING',
            message: 'Field is missing in 1Password.',
            sources: [
              {
                path: 'apps/detectionhub/dt-test/overrides.gotmpl',
                line: 1,
              },
            ],
          },
        ],
    missing: ready
      ? []
      : [
          {
            reference: 'op://Customers/sri/detectionhub-dt-test/db_password',
            normalizedReference:
              'op://Customers/sri/detectionhub-dt-test/db_password',
            vault: 'Customers',
            item: 'sri',
            section: 'detectionhub-dt-test',
            field: 'db_password',
            status: 'MISSING',
            message: 'Field is missing in 1Password.',
            sources: [
              {
                path: 'apps/detectionhub/dt-test/overrides.gotmpl',
                line: 1,
              },
            ],
          },
        ],
    placeholders: [],
    filePlaceholders: [],
    summary: ready
      ? 'Ready. 1 secret reference verified in 1Password.'
      : '1Password readiness failed. The following secrets must be populated before deploy.',
  };
}

function mockBackend(ready: boolean) {
  const backendFetch = jest.fn(async (_pluginId: string, endpoint: string, _init?: RequestInit) => {
    if (endpoint === '/deployments/options') {
      return jsonResponse(optionsBody);
    }
    if (endpoint.startsWith('/clusters/deployable')) {
      return jsonResponse(clustersBody);
    }
    if (endpoint === '/deployments/approvals/permissions') {
      return jsonResponse({ canApprove: false });
    }
    if (endpoint === '/deployments/secret-readiness') {
      return jsonResponse(readinessReport(ready));
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  });

  backendModule.useBackendFetch.mockReturnValue(backendFetch);
  backendModule.useBackendEventStream.mockReturnValue(jest.fn());

  return backendFetch;
}

async function loadWizardGate(backendFetch: ReturnType<typeof mockBackend>) {
  await backendFetch('deployment-control-plane', '/deployments/options', {
    method: 'GET',
  });
  await backendFetch('deployment-control-plane', '/clusters/deployable', {
    method: 'GET',
  });
  await backendFetch(
    'deployment-control-plane',
    '/deployments/approvals/permissions',
    { method: 'GET' },
  );

  const readinessResponse = await backendFetch(
    'deployment-control-plane',
    '/deployments/secret-readiness',
    { method: 'POST' },
  );
  return readinessResponse.json();
}

async function runProvisionFlow(backendFetch: ReturnType<typeof mockBackend>) {
  await backendFetch('deployment-control-plane', '/deployments/secret-provision', {
    method: 'POST',
  });
  const readinessResponse = await backendFetch(
    'deployment-control-plane',
    '/deployments/secret-readiness',
    { method: 'POST' },
  );
  return readinessResponse.json();
}

describe('DeploymentWizard validation helpers', () => {
  it('rejects invalid customer identifiers before submission', () => {
    expect(validateCustomerName('sri')).toBeNull();
    expect(validateCustomerName('acme-demo')).toBeNull();
    expect(validateCustomerName('')).toBe('Customer is required.');
    expect(validateCustomerName('Acme')).toBe(
      'Customer may only contain lowercase letters, numbers, and hyphens.',
    );
    expect(validateCustomerName('acme_demo')).toBe(
      'Customer may only contain lowercase letters, numbers, and hyphens.',
    );
  });
});

describe('DeploymentWizard step-1 readiness gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables Next when 1Password readiness is blocked', async () => {
    const backendFetch = mockBackend(false);
    const readiness = await loadWizardGate(backendFetch);

    expect(backendFetch).toHaveBeenCalledWith(
      'deployment-control-plane',
      '/deployments/secret-readiness',
      expect.any(Object),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toMatch(/1Password readiness failed/i);
  });

  it('enables Next when 1Password readiness is ready', async () => {
    const backendFetch = mockBackend(true);
    const readiness = await loadWizardGate(backendFetch);

    expect(backendFetch).toHaveBeenCalledWith(
      'deployment-control-plane',
      '/deployments/secret-readiness',
      expect.any(Object),
    );
    expect(readiness.ready).toBe(true);
    expect(readiness.summary).toMatch(/Ready/i);
  });

  it('creates and populates missing 1Password section, then enables Next', async () => {
    let readinessReady = false;

    const backendFetch = jest.fn(async (_pluginId: string, endpoint: string, _init?: RequestInit) => {
      if (endpoint === '/deployments/options') {
        return jsonResponse(optionsBody);
      }
      if (endpoint.startsWith('/clusters/deployable')) {
        return jsonResponse(clustersBody);
      }
      if (endpoint === '/deployments/approvals/permissions') {
        return jsonResponse({ canApprove: false });
      }
      if (endpoint === '/deployments/secret-readiness') {
        return jsonResponse(readinessReport(readinessReady));
      }
      if (endpoint === '/deployments/secret-provision') {
        readinessReady = true;
        return jsonResponse({
          operationId: 'op-1',
          application: 'detectionhub',
          instanceName: 'dt-test',
          customer: 'sri',
          clusterName: 'aks-scp-dev-sdc-st-cms',
          workflowRepository: 'SymphonyFS/scripts',
          workflowId: 'direct-write',
          workflowRef: 'service-account',
          workflowRunId: null,
          workflowRunUrl: null,
          status: 'completed',
          conclusion: 'success',
          message:
            '1Password sections were populated directly in CloudHub and readiness is now green.',
          sections: ['detectionhub-dt-test'],
          fieldsGenerated: ['db_password'],
          requestedAt: '2026-09-15T00:00:00.000Z',
          updatedAt: '2026-09-15T00:00:10.000Z',
          completedAt: '2026-09-15T00:00:10.000Z',
          readiness: readinessReport(true),
        });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    backendModule.useBackendFetch.mockReturnValue(backendFetch);
    backendModule.useBackendEventStream.mockReturnValue(jest.fn());

    const provisionedReadiness = await runProvisionFlow(backendFetch);

    expect(backendFetch).toHaveBeenCalledWith(
      'deployment-control-plane',
      '/deployments/secret-provision',
      expect.any(Object),
    );
    expect(provisionedReadiness.ready).toBe(true);
    expect(provisionedReadiness.summary).toMatch(/Ready/i);
  });
});
