/**
 * aksDiscoveryService.test.ts
 *
 * Unit tests for aksDiscoveryService.ts.
 * Mocks @azure/identity and global fetch to avoid real network calls.
 */

import type { LoggerService } from '@backstage/backend-plugin-api';

// ─── Mock @azure/identity before any imports that use it ─────────────────────

const mockGetToken = jest.fn();
jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest
    .fn()
    .mockImplementation(() => ({ getToken: mockGetToken })),
}));

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import {
  discoverClusters,
  fetchNodePools,
  fetchClusterDetail,
} from '../aksDiscoveryService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis() as any,
};

function mockOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function mockErrorResponse(status: number, body = 'Error') {
  return {
    ok: false,
    status,
    json: jest.fn().mockResolvedValue({ message: body }),
    text: jest.fn().mockResolvedValue(body),
  };
}

const ARM_CLUSTER = {
  name: 'aks-dev-01',
  id: '/subscriptions/sub-123/resourceGroups/rg-dev/providers/Microsoft.ContainerService/managedClusters/aks-dev-01',
  location: 'westeurope',
  tags: { env: 'dev' },
  properties: {
    kubernetesVersion: '1.29.0',
    provisioningState: 'Succeeded',
    powerState: { code: 'Running' },
    fqdn: 'aks-dev-01.hcp.westeurope.azmk8s.io',
    aadProfile: { enableAzureRBAC: false },
    disableLocalAccounts: false,
    agentPoolProfiles: [],
  },
};

const ARM_POOL_SYSTEM = {
  name: 'system',
  properties: {
    mode: 'System',
    vmSize: 'Standard_D2s_v3',
    count: 2,
    minCount: 1,
    maxCount: 5,
    enableAutoScaling: false,
    osDiskSizeGB: 128,
    provisioningState: 'Succeeded',
    powerState: { code: 'Running' },
  },
};

const ARM_POOL_USER = {
  name: 'user1',
  properties: {
    mode: 'User',
    vmSize: 'Standard_D4s_v3',
    count: 3,
    minCount: 1,
    maxCount: 10,
    enableAutoScaling: false,
    osDiskSizeGB: 128,
    provisioningState: 'Succeeded',
    powerState: { code: 'Running' },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetToken.mockResolvedValue({ token: 'mock-bearer-token' });

  // Set minimal env vars for ClientSecretCredential branch
  process.env.AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
  process.env.AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
  process.env.AZURE_CLIENT_SECRET = 'secret-123';
});

afterEach(() => {
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_CLIENT_SECRET;
});

// ═══════════════════════════════════════════════════════════════════════════
// discoverClusters
// ═══════════════════════════════════════════════════════════════════════════

describe('discoverClusters', () => {
  it('returns mapped clusters for a single page', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ value: [ARM_CLUSTER], nextLink: undefined }),
    );

    const result = await discoverClusters('sub-123', null, mockLogger);

    expect(result).toHaveLength(1);
    expect(result[0].clusterName).toBe('aks-dev-01');
    expect(result[0].location).toBe('westeurope');
    expect(result[0].authMode).toBe('local');
    expect(result[0].powerState).toBe('Running');
  });

  it('handles pagination via nextLink', async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockOkResponse({
          value: [ARM_CLUSTER],
          nextLink: 'https://management.azure.com/next',
        }),
      )
      .mockResolvedValueOnce(
        mockOkResponse({
          value: [{ ...ARM_CLUSTER, name: 'aks-dev-02' }],
          nextLink: undefined,
        }),
      );

    const result = await discoverClusters('sub-123', null, mockLogger);

    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('scopes request to resource group when provided', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ value: [] }));

    await discoverClusters('sub-123', 'rg-dev', mockLogger);

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/resourceGroups/rg-dev/');
  });

  it('uses subscription-level path when no resource group given', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ value: [] }));

    await discoverClusters('sub-123', null, mockLogger);

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).not.toContain('/resourceGroups/');
  });

  it('detects azureRBAC auth mode (disableLocalAccounts=true)', async () => {
    const cluster = {
      ...ARM_CLUSTER,
      properties: { ...ARM_CLUSTER.properties, disableLocalAccounts: true },
    };
    mockFetch.mockResolvedValueOnce(mockOkResponse({ value: [cluster] }));

    const result = await discoverClusters('sub-123', null, mockLogger);

    expect(result[0].authMode).toBe('azureRBAC');
  });

  it('detects azureRBAC auth mode (aadProfile.enableAzureRBAC=true)', async () => {
    const cluster = {
      ...ARM_CLUSTER,
      properties: {
        ...ARM_CLUSTER.properties,
        aadProfile: { enableAzureRBAC: true },
      },
    };
    mockFetch.mockResolvedValueOnce(mockOkResponse({ value: [cluster] }));

    const result = await discoverClusters('sub-123', null, mockLogger);

    expect(result[0].authMode).toBe('azureRBAC');
  });

  it('throws when Azure returns a non-OK status', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(403, 'Forbidden'));

    await expect(discoverClusters('sub-123', null, mockLogger)).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it('includes Authorization header with bearer token', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ value: [] }));

    await discoverClusters('sub-123', null, mockLogger);

    const headers: Record<string, string> = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer mock-bearer-token');
  });

  it('throws when token acquisition fails', async () => {
    mockGetToken.mockResolvedValueOnce(null);

    await expect(discoverClusters('sub-123', null, mockLogger)).rejects.toThrow(
      /token/i,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchNodePools
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchNodePools', () => {
  it('maps ARM agent pools to AksNodePool shape', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ value: [ARM_POOL_SYSTEM, ARM_POOL_USER] }),
    );

    const pools = await fetchNodePools(
      'sub-123',
      'rg-dev',
      'aks-dev-01',
      mockLogger,
    );

    expect(pools).toHaveLength(2);
    const sys = pools.find(p => p.name === 'system')!;
    const usr = pools.find(p => p.name === 'user1')!;

    expect(sys.mode).toBe('System');
    expect(sys.count).toBe(2);
    expect(usr.mode).toBe('User');
    expect(usr.count).toBe(3);
    expect(usr.minCount).toBe(1);
  });

  it('requests the correct ARM URL', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ value: [] }));

    await fetchNodePools('sub-123', 'rg-dev', 'aks-dev-01', mockLogger);

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/subscriptions/sub-123/');
    expect(url).toContain('/resourceGroups/rg-dev/');
    expect(url).toContain('/managedClusters/aks-dev-01/agentPools');
  });

  it('throws on non-OK Azure response', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(404, 'NotFound'));

    await expect(
      fetchNodePools('sub-123', 'rg-dev', 'missing-cluster', mockLogger),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('returns empty array when value is missing from response', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({}));

    const pools = await fetchNodePools(
      'sub-123',
      'rg-dev',
      'aks-dev-01',
      mockLogger,
    );
    expect(pools).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchClusterDetail
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchClusterDetail', () => {
  it('merges cluster summary with node pools', async () => {
    // fetchClusterDetail makes 2 parallel fetches: cluster + agentPools
    mockFetch
      .mockResolvedValueOnce(mockOkResponse(ARM_CLUSTER)) // cluster
      .mockResolvedValueOnce(mockOkResponse({ value: [ARM_POOL_USER] })); // agentPools

    const detail = await fetchClusterDetail(
      'sub-123',
      'rg-dev',
      'aks-dev-01',
      mockLogger,
    );

    expect(detail.clusterName).toBe('aks-dev-01');
    expect(detail.nodePools).toHaveLength(1);
    expect(detail.nodePools[0].name).toBe('user1');
  });

  it('propagates Azure errors', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Unauthorized'));

    await expect(
      fetchClusterDetail('sub-123', 'rg-dev', 'aks-dev-01', mockLogger),
    ).rejects.toThrow(/HTTP 401/);
  });
});
