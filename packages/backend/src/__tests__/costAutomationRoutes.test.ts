/**
 * costAutomationRoutes.test.ts
 *
 * Integration tests for the Express router returned by createCostAutomationRouter.
 * All Azure / Kubernetes dependencies are injected as mocks — no real network calls.
 *
 * Coverage:
 *   GET  /azure/aks/validate   — heuristic, incomplete (creds but no RG), live (success + failure)
 *   POST /azure/aks/onboard    — happy path, env block, prod-name block, duplicate
 *   GET  /azure/aks/managed    — list onboarded clusters
 *   GET  /azure/aks/discover   — success, missing subscriptionId, Azure error
 *   GET  /azure/aks/:name/nodepools — success, missing params, Azure error
 *   POST /azure/aks/:name/lifecycle — dry-run, live, not-onboarded, bad action
 */

import express from 'express';
import request from 'supertest';
import {
  createCostAutomationRouter,
  onboardedClusters,
} from '../createCostAutomationRouter';
import type { AksClusterDetail, AksNodePool } from '../costAutomationTypes';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

const systemPool: AksNodePool = {
  name: 'system',
  mode: 'System',
  vmSize: 'Standard_D2s_v3',
  count: 2,
  minCount: 1,
  maxCount: 5,
  autoscalingEnabled: false,
  osDiskSizeGB: 128,
  provisioningState: 'Succeeded',
  powerState: 'Running',
  nodeLabels: {},
  nodeTaints: [],
};

const userPool: AksNodePool = {
  name: 'user1',
  mode: 'User',
  vmSize: 'Standard_D4s_v3',
  count: 3,
  minCount: 1,
  maxCount: 10,
  autoscalingEnabled: false,
  osDiskSizeGB: 128,
  provisioningState: 'Succeeded',
  powerState: 'Running',
  nodeLabels: {},
  nodeTaints: [],
};

const mockClusterDetail: AksClusterDetail = {
  clusterName: 'aks-dev-01',
  resourceGroup: 'rg-dev',
  subscriptionId: 'sub-123',
  location: 'westeurope',
  kubernetesVersion: '1.29.0',
  provisioningState: 'Succeeded',
  powerState: 'Running',
  authMode: 'local',
  fqdn: 'aks-dev-01.hcp.westeurope.azmk8s.io',
  tags: {
    'cloudhub-enabled': 'true',
    'cloudhub-onboarded': 'true',
  },
  nodePools: [systemPool, userPool],
};

function taggedClusterSummary(clusterName: string, resourceGroup: string) {
  return {
    clusterName,
    resourceGroup,
    subscriptionId: 'sub-123',
    location: 'westeurope',
    kubernetesVersion: '1.29.0',
    provisioningState: 'Succeeded',
    powerState: 'Running',
    authMode: 'local',
    fqdn: null,
    tags: {
      'cloudhub-enabled': 'true',
      'cloudhub-onboarded': 'true',
    },
  };
}

const mockFetchClusterDetail = jest.fn<Promise<AksClusterDetail>, any[]>();
const mockFetchNodePools = jest.fn<Promise<AksNodePool[]>, any[]>();
const mockDiscoverClusters = jest.fn();
const mockBuildNodePodMap = jest.fn();
const mockTriggerClusterLifecycle = jest.fn<Promise<void>, any[]>();
const mockPatchNodePoolCount = jest.fn<Promise<void>, any[]>();
const mockAzureVmService = {
  listVms: jest.fn(),
  startVm: jest.fn(),
  stopVm: jest.fn(),
};
const mockVmAuthorizationService = {
  isVmOperator: jest.fn(),
};
const mockHttpAuth = {
  credentials: jest.fn().mockResolvedValue({ principal: 'user' }),
};
const mockUserInfo = {
  getUserInfo: jest.fn().mockResolvedValue({
    userEntityRef: 'user:default/jane',
    ownershipEntityRefs: [],
  }),
};

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = createCostAutomationRouter({
    logger: mockLogger as any,
    _fetchClusterDetail: mockFetchClusterDetail as any,
    _fetchNodePools: mockFetchNodePools as any,
    _discoverClusters: mockDiscoverClusters as any,
    _buildNodePodMap: mockBuildNodePodMap as any,
    _triggerClusterLifecycle: mockTriggerClusterLifecycle as any,
    _patchNodePoolCount: mockPatchNodePoolCount as any,
    _azureVmService: mockAzureVmService as any,
    _vmAuthorizationService: mockVmAuthorizationService as any,
    httpAuth: mockHttpAuth as any,
    userInfo: mockUserInfo as any,
  });
  app.use(router);
  return app;
}

beforeEach(() => {
  onboardedClusters.clear();
  // resetAllMocks also flushes mockResolvedValueOnce / mockRejectedValueOnce queues,
  // preventing stale mocks from leaking into the next test when a route exits early
  // (e.g. 400/404) before the mock is consumed.
  jest.resetAllMocks();
  mockLogger.info.mockImplementation(jest.fn());
  mockLogger.warn.mockImplementation(jest.fn());
  mockLogger.error.mockImplementation(jest.fn());
  // Clear ambient Azure env vars so tests do not trigger live RBAC assignment or
  // Azure discovery calls from the developer machine / CI host.
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_OBJECT_ID;
  process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';

  mockDiscoverClusters.mockResolvedValue([
    taggedClusterSummary('aks-dev-01', 'rg-dev'),
    taggedClusterSummary('aks-qa-01', 'rg-qa'),
  ]);
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/validate
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/validate', () => {
  describe('heuristic mode (no Azure creds)', () => {
    it('returns 400 when clusterName is missing', async () => {
      const res = await request(buildApp()).get(
        '/azure/aks/validate?environment=dev',
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when environment is missing', async () => {
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=myapp-dev',
      );
      expect(res.status).toBe(400);
    });

    it('returns all checks passing for valid dev cluster', async () => {
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev',
      );
      expect(res.status).toBe(200);
      expect(res.body.checks).toHaveLength(6);
      expect(res.body.checks.every((c: any) => c.passed)).toBe(true);
    });

    it('fails env check for unsupported environment', async () => {
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-staging-01&environment=staging',
      );
      expect(res.status).toBe(200);
      const envCheck = res.body.checks.find(
        (c: any) => c.label === 'Environment allowed (Dev / QA only)',
      );
      expect(envCheck.passed).toBe(false);
    });

    it('fails cluster checks for production-named cluster', async () => {
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-prod-01&environment=dev',
      );
      expect(res.status).toBe(200);
      const existsCheck = res.body.checks.find(
        (c: any) => c.label === 'Cluster exists',
      );
      expect(existsCheck.passed).toBe(false);
    });
  });

  describe('auto-discover mode (creds set, no resourceGroup)', () => {
    beforeEach(() => {
      process.env.AZURE_CLIENT_ID = 'test-client-id';
      process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';
    });

    it('discovers cluster RG and returns full validation results', async () => {
      mockDiscoverClusters.mockResolvedValueOnce([
        { ...mockClusterDetail, resourceGroup: 'rg-dev' },
      ]);
      mockFetchClusterDetail.mockResolvedValueOnce(mockClusterDetail);
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev',
      );
      expect(res.status).toBe(200);
      const checks = res.body.checks;
      expect(checks.find((c: any) => c.label === 'Cluster exists').passed).toBe(
        true,
      );
      expect(mockFetchClusterDetail).toHaveBeenCalled();
    });

    it('returns cluster-exists=false with reason when cluster not found in subscription', async () => {
      mockDiscoverClusters.mockResolvedValueOnce([]); // empty — cluster not found
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev',
      );
      expect(res.status).toBe(200);
      const existsCheck = res.body.checks.find(
        (c: any) => c.label === 'Cluster exists',
      );
      expect(existsCheck.passed).toBe(false);
      expect(existsCheck.reason).toMatch(/not found/i);
    });

    it('returns Azure error as reason when discovery call fails', async () => {
      mockDiscoverClusters.mockRejectedValueOnce(
        new Error('AADSTS90002: Tenant not found.'),
      );
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev',
      );
      expect(res.status).toBe(200);
      const existsCheck = res.body.checks.find(
        (c: any) => c.label === 'Cluster exists',
      );
      expect(existsCheck.passed).toBe(false);
      expect(existsCheck.reason).toMatch(/Azure error/i);
    });

    it('still passes environment check even when discovery fails', async () => {
      mockDiscoverClusters.mockRejectedValueOnce(new Error('Auth failed'));
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev',
      );
      const envCheck = res.body.checks.find(
        (c: any) => c.label === 'Environment allowed (Dev / QA only)',
      );
      expect(envCheck.passed).toBe(true);
    });
  });

  describe('live mode (creds + resourceGroup provided)', () => {
    beforeEach(() => {
      process.env.AZURE_CLIENT_ID = 'test-client-id';
      process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';
    });

    it('returns live check results on success', async () => {
      mockFetchClusterDetail.mockResolvedValueOnce(mockClusterDetail);
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
      );
      expect(res.status).toBe(200);
      const checks = res.body.checks;
      expect(checks.find((c: any) => c.label === 'Cluster exists').passed).toBe(
        true,
      );
      expect(
        checks.find((c: any) => c.label === 'System node pool found').passed,
      ).toBe(true);
      expect(
        checks.find((c: any) => c.label === 'User node pool found').passed,
      ).toBe(true);
      expect(
        checks.find(
          (c: any) => c.label === 'System node pool lifecycle eligible',
        ).passed,
      ).toBe(true);
    });

    it('marks cluster-exists as failed when Azure returns an error', async () => {
      mockFetchClusterDetail.mockRejectedValueOnce(
        new Error('ResourceNotFound'),
      );
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
      );
      expect(res.status).toBe(200);
      const existsCheck = res.body.checks.find(
        (c: any) => c.label === 'Cluster exists',
      );
      expect(existsCheck.passed).toBe(false);
    });

    it('passes auth-mode check for local auth cluster', async () => {
      mockFetchClusterDetail.mockResolvedValueOnce({
        ...mockClusterDetail,
        authMode: 'local',
      });
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
      );
      const authCheck = res.body.checks.find(
        (c: any) => c.label === 'AKS auth mode supported',
      );
      expect(authCheck.passed).toBe(true);
    });

    it('passes auth-mode check for azureRBAC cluster (modern AKS)', async () => {
      mockFetchClusterDetail.mockResolvedValueOnce({
        ...mockClusterDetail,
        authMode: 'azureRBAC',
      });
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
      );
      const authCheck = res.body.checks.find(
        (c: any) => c.label === 'AKS auth mode supported',
      );
      expect(authCheck.passed).toBe(true);
    });

    it('fails auth-mode check for unknown auth mode', async () => {
      mockFetchClusterDetail.mockResolvedValueOnce({
        ...mockClusterDetail,
        authMode: 'unknown',
      });
      const res = await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
      );
      const authCheck = res.body.checks.find(
        (c: any) => c.label === 'AKS auth mode supported',
      );
      expect(authCheck.passed).toBe(false);
    });

    it('logs the detected auth mode', async () => {
      process.env.AZURE_CLIENT_ID = 'test-client-id';
      mockFetchClusterDetail.mockResolvedValueOnce({
        ...mockClusterDetail,
        authMode: 'azureRBAC',
      });
      await request(buildApp()).get(
        '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('azureRBAC'),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /azure/aks/onboard
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /azure/aks/onboard', () => {
  it('returns 400 when clusterName is missing', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/onboard')
      .send({ environment: 'dev' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when environment is missing', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/onboard')
      .send({ clusterName: 'aks-dev-01' });
    expect(res.status).toBe(400);
  });

  it('returns 403 for unsupported environment', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/onboard')
      .send({ clusterName: 'aks-dev-01', environment: 'staging' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not allowed/i);
  });

  it('returns 403 for production-named cluster', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/onboard')
      .send({ clusterName: 'aks-prod-01', environment: 'dev' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/production/i);
  });

  it('onboards a valid dev cluster and returns 201', async () => {
    const res = await request(buildApp()).post('/azure/aks/onboard').send({
      clusterName: 'aks-dev-01',
      environment: 'dev',
      subscriptionId: 'sub-123',
      resourceGroup: 'rg-dev',
    });
    expect(res.status).toBe(201);
    expect(res.body.cluster.clusterName).toBe('aks-dev-01');
    expect(res.body.cluster.environment).toBe('dev');
    expect(res.body.cluster.status).toBe('ONBOARDED');
    expect(res.body.cluster.capabilities).toContain('start');
  });

  it('onboards a valid qa cluster', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-qa-01',
        environment: 'qa',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-qa',
      });
    expect(res.status).toBe(201);
    expect(res.body.cluster.environment).toBe('qa');
  });

  it('defaults authMode to local when no resourceGroup provided', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
      });
    expect(res.status).toBe(201);
    expect(res.body.cluster.authMode).toBe('local');
    expect(res.body.cluster.powerState).toBe('Unknown');
  });

  it('stores authMode=local for cluster with local RBAC', async () => {
    process.env.AZURE_CLIENT_ID = 'test-client-id';
    mockFetchClusterDetail.mockResolvedValueOnce({
      ...mockClusterDetail,
      authMode: 'local',
    });
    const res = await request(buildApp()).post('/azure/aks/onboard').send({
      clusterName: 'aks-dev-01',
      environment: 'dev',
      resourceGroup: 'rg-dev',
      subscriptionId: 'sub-123',
    });
    expect(res.status).toBe(201);
    expect(res.body.cluster.authMode).toBe('local');
    expect(res.body.cluster.powerState).toBe('Running');
  });

  it('stores authMode=azureRBAC for modern AKS cluster', async () => {
    process.env.AZURE_CLIENT_ID = 'test-client-id';
    mockFetchClusterDetail.mockResolvedValueOnce({
      ...mockClusterDetail,
      authMode: 'azureRBAC',
    });
    const res = await request(buildApp()).post('/azure/aks/onboard').send({
      clusterName: 'aks-dev-01',
      environment: 'dev',
      resourceGroup: 'rg-dev',
      subscriptionId: 'sub-123',
    });
    expect(res.status).toBe(201);
    expect(res.body.cluster.authMode).toBe('azureRBAC');
    expect(res.body.cluster.powerState).toBe('Running');
  });

  it('falls back to authMode=local when auth mode detection fails', async () => {
    process.env.AZURE_CLIENT_ID = 'test-client-id';
    mockFetchClusterDetail.mockRejectedValueOnce(
      new Error('Azure unavailable'),
    );
    const res = await request(buildApp()).post('/azure/aks/onboard').send({
      clusterName: 'aks-dev-01',
      environment: 'dev',
      resourceGroup: 'rg-dev',
      subscriptionId: 'sub-123',
    });
    expect(res.status).toBe(201);
    expect(res.body.cluster.authMode).toBe('local');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auth mode detection failed'),
    );
  });

  it('returns 409 when cluster is already onboarded', async () => {
    const app = buildApp();
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
    const res = await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already onboarded/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/managed
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/managed', () => {
  it('returns empty list when no clusters onboarded', async () => {
    const res = await request(buildApp()).get('/azure/aks/managed');
    expect(res.status).toBe(200);
    expect(res.body.clusters).toEqual([]);
  });

  it('lists all onboarded clusters', async () => {
    const app = buildApp();
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-qa-01',
        environment: 'qa',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-qa',
      });
    const res = await request(app).get('/azure/aks/managed');
    expect(res.status).toBe(200);
    expect(res.body.clusters).toHaveLength(2);
    expect(res.body.clusters.map((c: any) => c.clusterName)).toContain(
      'aks-dev-01',
    );
    expect(res.body.clusters.map((c: any) => c.clusterName)).toContain(
      'aks-qa-01',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/discover
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/discover', () => {
  it('returns 400 when subscriptionId is missing', async () => {
    const res = await request(buildApp()).get('/azure/aks/discover');
    expect(res.status).toBe(400);
  });

  it('returns discovered clusters', async () => {
    mockDiscoverClusters.mockResolvedValueOnce([mockClusterDetail]);
    const res = await request(buildApp()).get(
      '/azure/aks/discover?subscriptionId=sub-123',
    );
    expect(res.status).toBe(200);
    expect(res.body.clusters).toHaveLength(1);
    expect(res.body.subscriptionId).toBe('sub-123');
  });

  it('returns 502 when Azure call fails', async () => {
    mockDiscoverClusters.mockRejectedValueOnce(new Error('Auth failed'));
    const res = await request(buildApp()).get(
      '/azure/aks/discover?subscriptionId=sub-123',
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Azure discovery failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/:clusterName/nodepools
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/:clusterName/nodepools', () => {
  it('returns 400 when subscriptionId or resourceGroup is missing', async () => {
    const res = await request(buildApp()).get(
      '/azure/aks/aks-dev-01/nodepools?subscriptionId=sub-123',
    );
    expect(res.status).toBe(400);
  });

  it('returns node pools on success', async () => {
    mockFetchNodePools.mockResolvedValueOnce([systemPool, userPool]);
    const res = await request(buildApp()).get(
      '/azure/aks/aks-dev-01/nodepools?subscriptionId=sub-123&resourceGroup=rg-dev',
    );
    expect(res.status).toBe(200);
    expect(res.body.clusterName).toBe('aks-dev-01');
    expect(res.body.nodePools).toHaveLength(2);
  });

  it('returns 502 when Azure call fails', async () => {
    mockFetchNodePools.mockRejectedValueOnce(new Error('Timeout'));
    const res = await request(buildApp()).get(
      '/azure/aks/aks-dev-01/nodepools?subscriptionId=sub-123&resourceGroup=rg-dev',
    );
    expect(res.status).toBe(502);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/:clusterName/pods
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/:clusterName/pods', () => {
  it('passes subscriptionId and resourceGroup to the node map builder', async () => {
    mockBuildNodePodMap.mockResolvedValueOnce({
      clusterName: 'aks-dev-01',
      fetchedAt: '2026-05-14T00:00:00.000Z',
      nodes: [],
      unmappedPods: [],
    });

    const res = await request(buildApp()).get(
      '/azure/aks/aks-dev-01/pods?subscriptionId=sub-123&resourceGroup=rg-dev',
    );

    expect(res.status).toBe(200);
    expect(mockBuildNodePodMap).toHaveBeenCalledWith(
      'aks-dev-01',
      expect.anything(),
      undefined,
      'sub-123',
      'rg-dev',
    );
    expect(res.body.nodes).toEqual([]);
  });

  it('falls back to onboarded subscriptionId/resourceGroup when query params are omitted', async () => {
    const app = buildApp();
    await request(app).post('/azure/aks/onboard').send({
      clusterName: 'aks-dev-01',
      environment: 'dev',
      subscriptionId: 'sub-123',
      resourceGroup: 'rg-dev',
    });

    mockBuildNodePodMap.mockResolvedValueOnce({
      clusterName: 'aks-dev-01',
      fetchedAt: '2026-05-14T00:00:00.000Z',
      nodes: [],
      unmappedPods: [],
    });

    const res = await request(app).get('/azure/aks/aks-dev-01/pods');

    expect(res.status).toBe(200);
    expect(mockBuildNodePodMap).toHaveBeenCalledWith(
      'aks-dev-01',
      expect.anything(),
      undefined,
      'sub-123',
      'rg-dev',
    );
  });

  it('returns 400 when kubeConfig and target metadata are missing', async () => {
    const res = await request(buildApp()).get('/azure/aks/aks-dev-01/pods');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(
      /resourceGroup and subscriptionId are required/i,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /azure/aks/:clusterName/lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /azure/aks/:clusterName/lifecycle', () => {
  const target = { subscriptionId: 'sub-123', resourceGroup: 'rg-dev' };

  beforeEach(async () => {
    // Ensure the cluster is onboarded before lifecycle tests
    const app = buildApp();
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
  });

  it('returns 400 when action is missing', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ target });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid action', async () => {
    // No mock needed — route rejects on invalid action before calling fetchNodePools
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'restart', target });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be one of/i);
  });

  it('returns 404 for a cluster that is not onboarded', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/not-onboarded/lifecycle')
      .send({ action: 'stop', target });
    expect(res.status).toBe(404);
  });

  it('dry-run stop returns plan with applied=false and dryRun=true', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'stop', dryRun: true, target });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.applied).toBe(false);
    expect(res.body.nodePools).toEqual([]);
    expect(res.body.summary).toMatch(/dry run/i);
  });

  it('live stop calls triggerClusterLifecycle and returns applied=true', async () => {
    mockTriggerClusterLifecycle.mockResolvedValueOnce(undefined);
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'stop', dryRun: false, target });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.applied).toBe(true);
    expect(res.body.nodePools).toEqual([]);
    expect(mockTriggerClusterLifecycle).toHaveBeenCalledWith(
      target.subscriptionId,
      target.resourceGroup,
      'aks-dev-01',
      'stop',
      expect.anything(),
    );
  });

  it('dry-run start returns applied=false', async () => {
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'start', dryRun: true, target });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.nodePools).toEqual([]);
  });

  it('live start calls triggerClusterLifecycle with action=start', async () => {
    mockTriggerClusterLifecycle.mockResolvedValueOnce(undefined);
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'start', dryRun: false, target });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(mockTriggerClusterLifecycle).toHaveBeenCalledWith(
      target.subscriptionId,
      target.resourceGroup,
      'aks-dev-01',
      'start',
      expect.anything(),
    );
  });

  it('returns 502 when ARM cluster action fails', async () => {
    mockTriggerClusterLifecycle.mockRejectedValueOnce(new Error('ARM error'));
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'stop', dryRun: false, target });
    expect(res.status).toBe(502);
  });

  it('dry-run downsize respects minCount', async () => {
    const poolWithMin = { ...userPool, count: 5, minCount: 2 };
    mockFetchNodePools.mockResolvedValueOnce([poolWithMin]);
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'downsize', dryRun: true, target });
    expect(res.status).toBe(200);
    expect(res.body.nodePools[0].targetCount).toBe(2);
  });

  it('live downsize calls patchNodePoolCount for each user pool', async () => {
    const poolWithMin = { ...userPool, count: 5, minCount: 2 };
    mockFetchNodePools.mockResolvedValueOnce([systemPool, poolWithMin]);
    mockPatchNodePoolCount.mockResolvedValue(undefined);
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'downsize', dryRun: false, target });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    // systemPool (mode=System) is skipped; only user pools are patched
    expect(mockPatchNodePoolCount).toHaveBeenCalledTimes(1);
    expect(mockPatchNodePoolCount).toHaveBeenCalledWith(
      target.subscriptionId,
      target.resourceGroup,
      'aks-dev-01',
      poolWithMin.name,
      2,
      expect.anything(),
    );
  });

  it('live downsize includes system pool when includeSystemNodePools=true', async () => {
    const systemWithMin = { ...systemPool, count: 3, minCount: 1 };
    const poolWithMin = { ...userPool, count: 5, minCount: 2 };
    mockFetchNodePools.mockResolvedValueOnce([systemWithMin, poolWithMin]);
    mockPatchNodePoolCount.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({
        action: 'downsize',
        dryRun: false,
        includeSystemNodePools: true,
        target,
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(mockPatchNodePoolCount).toHaveBeenCalledTimes(2);
    expect(mockPatchNodePoolCount).toHaveBeenCalledWith(
      target.subscriptionId,
      target.resourceGroup,
      'aks-dev-01',
      systemWithMin.name,
      1,
      expect.anything(),
    );
    expect(mockPatchNodePoolCount).toHaveBeenCalledWith(
      target.subscriptionId,
      target.resourceGroup,
      'aks-dev-01',
      poolWithMin.name,
      2,
      expect.anything(),
    );
    expect(res.body.summary).toMatch(/user \+ system node pool/i);
  });

  it('returns 502 when Azure node pool fetch fails during downsize', async () => {
    mockFetchNodePools.mockRejectedValueOnce(new Error('Azure error'));
    const res = await request(buildApp())
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({ action: 'downsize', target });
    expect(res.status).toBe(502);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/:clusterName/powerstate
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/:clusterName/powerstate', () => {
  const target = { subscriptionId: 'sub-123', resourceGroup: 'rg-dev' };

  beforeEach(async () => {
    // Onboard first so the cluster exists in the in-memory store
    await request(buildApp())
      .post('/azure/aks/onboard')
      .send({ clusterName: 'aks-dev-01', environment: 'dev', ...target });
  });

  it('returns 404 for a cluster that is not managed', async () => {
    const res = await request(buildApp()).get(
      '/azure/aks/not-managed/powerstate',
    );
    expect(res.status).toBe(404);
  });

  it('returns live power state for a managed cluster', async () => {
    mockFetchClusterDetail.mockResolvedValueOnce({
      ...mockClusterDetail,
      powerState: 'Stopped',
    });
    const res = await request(buildApp()).get(
      '/azure/aks/aks-dev-01/powerstate',
    );
    expect(res.status).toBe(200);
    expect(res.body.clusterName).toBe('aks-dev-01');
    expect(res.body.powerState).toBe('Stopped');
    expect(res.body.refreshedAt).toBeDefined();
  });

  it('returns 502 when Azure call fails', async () => {
    mockFetchClusterDetail.mockRejectedValueOnce(new Error('Network error'));
    const res = await request(buildApp()).get(
      '/azure/aks/aks-dev-01/powerstate',
    );
    expect(res.status).toBe(502);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/validate — powerState in response
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/validate — powerState field', () => {
  beforeEach(() => {
    process.env.AZURE_CLIENT_ID = 'test-client-id';
    process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';
  });

  it('includes powerState in live validation response', async () => {
    mockFetchClusterDetail.mockResolvedValueOnce({
      ...mockClusterDetail,
      powerState: 'Running',
    });
    const res = await request(buildApp()).get(
      '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
    );
    expect(res.status).toBe(200);
    expect(res.body.powerState).toBe('Running');
  });

  it('returns powerState=Unknown when live check fails', async () => {
    mockFetchClusterDetail.mockRejectedValueOnce(new Error('Not found'));
    const res = await request(buildApp()).get(
      '/azure/aks/validate?clusterName=aks-dev-01&environment=dev&resourceGroup=rg-dev',
    );
    expect(res.status).toBe(200);
    expect(res.body.powerState).toBe('Unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /azure/aks/:clusterName/offboard
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /azure/aks/:clusterName/offboard', () => {
  it('returns 404 when cluster is not onboarded', async () => {
    const res = await request(buildApp()).delete(
      '/azure/aks/not-onboarded/offboard',
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not onboarded/i);
  });

  it('returns 200 and removes the cluster from the managed list', async () => {
    const app = buildApp();
    // Onboard first
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });

    // Offboard
    const res = await request(app).delete('/azure/aks/aks-dev-01/offboard');
    expect(res.status).toBe(200);
    expect(res.body.clusterName).toBe('aks-dev-01');
    expect(res.body.message).toMatch(/offboarded/i);
    expect(res.body.offboardedAt).toBeTruthy();
  });

  it('cluster is no longer listed in GET /managed after offboard', async () => {
    const app = buildApp();
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-qa-01',
        environment: 'qa',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-qa',
      });

    await request(app).delete('/azure/aks/aks-dev-01/offboard');

    const listRes = await request(app).get('/azure/aks/managed');
    expect(listRes.status).toBe(200);
    const names = listRes.body.clusters.map((c: any) => c.clusterName);
    expect(names).not.toContain('aks-dev-01');
    expect(names).toContain('aks-qa-01');
  });

  it('can re-onboard a cluster after it has been offboarded', async () => {
    const app = buildApp();
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });

    await request(app).delete('/azure/aks/aks-dev-01/offboard');

    const re = await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
    expect(re.status).toBe(201);
    expect(re.body.cluster.status).toBe('ONBOARDED');
  });

  it('lifecycle actions return 404 for an offboarded cluster', async () => {
    const app = buildApp();
    await request(app)
      .post('/azure/aks/onboard')
      .send({
        clusterName: 'aks-dev-01',
        environment: 'dev',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-dev',
      });
    await request(app).delete('/azure/aks/aks-dev-01/offboard');

    const res = await request(app)
      .post('/azure/aks/aks-dev-01/lifecycle')
      .send({
        action: 'stop',
        target: { subscriptionId: 'sub-123', resourceGroup: 'rg-dev' },
      });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /azure/aks/cost
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /azure/aks/cost', () => {
  it('returns 400 when subscriptionId is not provided and env var is absent', async () => {
    delete process.env.AZURE_SUBSCRIPTION_ID;
    const res = await request(buildApp()).get('/azure/aks/cost');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subscriptionId is required/i);
  });

  it('returns estimated monthly AKS cost for discovered clusters', async () => {
    process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';
    mockDiscoverClusters.mockResolvedValueOnce([
      {
        clusterName: 'aks-dev-01',
        resourceGroup: 'rg-dev',
        subscriptionId: 'sub-123',
        location: 'eastus',
        kubernetesVersion: '1.29.0',
        provisioningState: 'Succeeded',
        powerState: 'Running',
        authMode: 'azureRBAC',
        fqdn: null,
        tags: {
          'cloudhub-enabled': 'true',
          'cloudhub-onboarded': 'true',
        },
      },
    ]);
    mockFetchNodePools.mockResolvedValueOnce([
      {
        ...systemPool,
        vmSize: 'Standard_D4s_v5',
        count: 2,
        powerState: 'Running',
      },
      {
        ...userPool,
        vmSize: 'Standard_D2s_v5',
        count: 3,
        powerState: 'Running',
      },
    ]);

    const res = await request(buildApp()).get('/azure/aks/cost');

    expect(res.status).toBe(200);
    expect(res.body.clusterCount).toBe(1);
    expect(res.body.currency).toBe('USD');
    expect(res.body.totalMonthlyCostUsd).toBe(439.46);
    expect(res.body.clusters[0].clusterName).toBe('aks-dev-01');
    expect(res.body.clusters[0].monthlyCostUsd).toBe(439.46);
    expect(res.body.clusters[0].nodePools).toHaveLength(2);
  });

  it('returns 404 when clusterName filter does not match discovered clusters', async () => {
    process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';
    mockDiscoverClusters.mockResolvedValueOnce([
      {
        clusterName: 'aks-dev-01',
        resourceGroup: 'rg-dev',
        subscriptionId: 'sub-123',
        location: 'eastus',
        kubernetesVersion: '1.29.0',
        provisioningState: 'Succeeded',
        powerState: 'Running',
        authMode: 'local',
        fqdn: null,
        tags: {
          'cloudhub-enabled': 'true',
          'cloudhub-onboarded': 'true',
        },
      },
    ]);

    const res = await request(buildApp()).get(
      '/azure/aks/cost?clusterName=aks-qa-01',
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 502 when discovery fails', async () => {
    process.env.AZURE_SUBSCRIPTION_ID = 'sub-123';
    mockDiscoverClusters.mockRejectedValueOnce(new Error('Azure auth failed'));

    const res = await request(buildApp()).get('/azure/aks/cost');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/cost calculation failed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VM Stop/Start APIs
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /cloud/vms', () => {
  const SUB = '?subscriptionId=sub-1';

  it('returns 400 when provider is missing', async () => {
    const res = await request(buildApp()).get('/cloud/vms');
    expect(res.status).toBe(400);
  });

  it('returns live Azure VM inventory', async () => {
    mockAzureVmService.listVms.mockResolvedValue([
      {
        vmName: 'vm-test-01',
        resourceGroupName: 'rg-cloudhub',
        instanceType: 'Standard_B1s',
        location: 'swedencentral',
        currentState: 'Running',
        costPerMonth: 7.88,
      },
    ]);

    const res = await request(buildApp()).get(`/cloud/vms${SUB}&provider=azure`);

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('azure');
    expect(res.body.supported).toBe(true);
    expect(res.body.vms[0].vmName).toBe('vm-test-01');
    expect(res.body.vms[0].costPerMonth).toBe(7.88);
    expect(res.body.rbac.azureRequiredRole).toBe('VM-Operators');
  });

  it('supports resource-group scoped inventory and reports scoped mode metadata', async () => {
    mockAzureVmService.listVms.mockResolvedValue([
      {
        vmName: 'abanca-gpu01',
        resourceGroupName: 'rg-gpu-sdc',
        instanceType: 'Standard_NC4as_T4_v3',
        location: 'swedencentral',
        currentState: 'Stopped',
        costPerMonth: 312.45,
      },
    ]);

    const res = await request(buildApp()).get(
      `/cloud/vms${SUB}&provider=azure&resourceGroup=rg-gpu-sdc`,
    );

    expect(res.status).toBe(200);
    expect(mockAzureVmService.listVms).toHaveBeenCalledWith('sub-1', {
      resourceGroupName: 'rg-gpu-sdc',
      includeAllInResourceGroup: true,
    });
    expect(res.body.inventoryMode).toBe('resource-group');
    expect(res.body.resourceGroupScope).toBe('rg-gpu-sdc');
    expect(res.body.environmentFilter).toBeNull();
  });

  it('reports aws and gcp as unsupported placeholders', async () => {
    for (const provider of ['aws', 'gcp']) {
      const res = await request(buildApp()).get(
        `/cloud/vms?provider=${provider}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.supported).toBe(false);
      expect(res.body.vms).toEqual([]);
    }
  });

  it('returns 502 when Azure listing fails', async () => {
    mockAzureVmService.listVms.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get(`/cloud/vms${SUB}&provider=azure`);
    expect(res.status).toBe(502);
  });
});

describe('POST /cloud/vms/:provider/:vmName/action', () => {
  const SUB = '?subscriptionId=sub-1';

  const authorize = (authorized: boolean) => {
    mockHttpAuth.credentials.mockResolvedValue({ principal: 'user' });
    mockUserInfo.getUserInfo.mockResolvedValue({
      userEntityRef: 'user:default/jane',
      ownershipEntityRefs: [],
    });
    mockVmAuthorizationService.isVmOperator.mockResolvedValue({
      authorized,
      groupId: 'group-1',
      source: 'graph',
    });
  };

  const seedVm = (currentState: 'Running' | 'Stopped') =>
    mockAzureVmService.listVms.mockResolvedValue([
      {
        vmName: 'vm-test-01',
        resourceGroupName: 'rg-cloudhub',
        instanceType: 'Standard_B1s',
        location: 'swedencentral',
        currentState,
        costPerMonth: 7.88,
      },
    ]);

  it('denies the action when the caller is not in the VM operators group', async () => {
    authorize(false);
    seedVm('Stopped');
    const res = await request(buildApp())
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}`)
      .send({ action: 'start' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('VM_ACCESS_DENIED');
    expect(mockAzureVmService.startVm).not.toHaveBeenCalled();
  });

  it('ignores spoofed role headers', async () => {
    authorize(false);
    seedVm('Stopped');
    const res = await request(buildApp())
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}`)
      .set('x-cloudhub-rbac-role', 'VM-Operators')
      .set('x-cloudhub-roles', 'VM-Operators')
      .send({ action: 'start' });

    expect(res.status).toBe(403);
    expect(mockAzureVmService.startVm).not.toHaveBeenCalled();
  });

  it('denies when identity services are unavailable', async () => {
    const app = express();
    app.use(express.json());
    app.use(
      createCostAutomationRouter({
        logger: mockLogger as any,
        _azureVmService: mockAzureVmService as any,
        _vmAuthorizationService: mockVmAuthorizationService as any,
      }),
    );
    seedVm('Stopped');

    const res = await request(app)
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}`)
      .send({ action: 'start' });

    expect(res.status).toBe(403);
    expect(mockAzureVmService.startVm).not.toHaveBeenCalled();
  });

  it('starts a stopped azure VM for an authorized operator', async () => {
    authorize(true);
    seedVm('Stopped');
    const res = await request(buildApp())
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}`)
      .send({ action: 'start' });

    expect(res.status).toBe(200);
    expect(mockAzureVmService.startVm).toHaveBeenCalledWith(
      'sub-1',
      'rg-cloudhub',
      'vm-test-01',
    );
  });

  it('applies resource-group scope while resolving VM actions', async () => {
    authorize(true);
    seedVm('Stopped');

    const res = await request(buildApp())
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}&resourceGroup=rg-gpu-sdc`)
      .send({ action: 'start' });

    expect(res.status).toBe(200);
    expect(mockAzureVmService.listVms).toHaveBeenCalledWith('sub-1', {
      resourceGroupName: 'rg-gpu-sdc',
      includeAllInResourceGroup: true,
    });
    expect(mockAzureVmService.startVm).toHaveBeenCalledWith(
      'sub-1',
      'rg-cloudhub',
      'vm-test-01',
    );
  });

  it('deallocates a running azure VM for an authorized operator', async () => {
    authorize(true);
    seedVm('Running');
    const res = await request(buildApp())
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}`)
      .send({ action: 'stop' });

    expect(res.status).toBe(200);
    expect(mockAzureVmService.stopVm).toHaveBeenCalledWith(
      'sub-1',
      'rg-cloudhub',
      'vm-test-01',
    );
  });

  it('returns 409 when the VM is already in the requested state', async () => {
    authorize(true);
    seedVm('Running');
    const res = await request(buildApp())
      .post(`/cloud/vms/azure/vm-test-01/action${SUB}`)
      .send({ action: 'start' });

    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown VM', async () => {
    authorize(true);
    seedVm('Running');
    const res = await request(buildApp())
      .post(`/cloud/vms/azure/does-not-exist/action${SUB}`)
      .send({ action: 'stop' });

    expect(res.status).toBe(404);
  });

  it('returns 501 for aws actions', async () => {
    authorize(true);
    const res = await request(buildApp())
      .post('/cloud/vms/aws/aws-vm-01/action')
      .send({ action: 'stop' });

    expect(res.status).toBe(501);
  });
});

describe('GET /cloud/vms/permissions', () => {
  it('mirrors the backend authorization decision', async () => {
    mockHttpAuth.credentials.mockResolvedValue({ principal: 'user' });
    mockUserInfo.getUserInfo.mockResolvedValue({
      userEntityRef: 'user:default/jane',
      ownershipEntityRefs: [],
    });
    mockVmAuthorizationService.isVmOperator.mockResolvedValue({
      authorized: true,
      groupId: 'group-1',
      source: 'graph',
    });
    const res = await request(buildApp()).get('/cloud/vms/permissions');
    expect(res.status).toBe(200);
    expect(res.body.authorized).toBe(true);

    mockVmAuthorizationService.isVmOperator.mockResolvedValue({
      authorized: false,
      groupId: 'group-1',
      source: 'token',
    });
    const denied = await request(buildApp()).get('/cloud/vms/permissions');
    expect(denied.body.authorized).toBe(false);
  });
});
