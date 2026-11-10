import type { LoggerService } from '@backstage/backend-plugin-api';
import { Pool } from 'pg';
import {
  ConcurrentModificationError,
  InfrastructureRequestStore,
  type InfrastructureRequest,
} from '../services/InfrastructureRequestStore';
import {
  AKS_FLAVOR_POOLS,
  normalizeAksClusterRequest,
  type AksClusterRequest,
} from '@internal/plugin-platform-common/backend';

function makeLogger(): LoggerService {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as unknown as LoggerService;
  (logger.child as jest.Mock).mockReturnValue(logger);
  return logger;
}

function samplePayload(
  overrides: Record<string, unknown> = {},
): AksClusterRequest {
  return normalizeAksClusterRequest({
    customer: 'Contoso',
    businessUnit: 'Retail',
    owner: 'owner@contoso.com',
    costCentre: 'P64358',
    changeTicket: 'SCP-1234',
    clusterProfile: 'single-region',
    env: 'prd',
    location: 'eastus',
    tenancy: 'st',
    tenantId: 'contoso',
    kubernetesVersion: '1.36.2',
    addressSpace: '10.230.0.0/16',
    ...AKS_FLAVOR_POOLS.medium,
    ...overrides,
  });
}

function sampleRecord(
  overrides: Partial<InfrastructureRequest> = {},
): InfrastructureRequest {
  const now = new Date('2024-01-01T00:00:00.000Z');
  return {
    requestId: 'INFRA-TEST-0001',
    requestor: 'platform-engineer',
    customer: 'Contoso',
    environment: 'prod',
    subscription: 'sub-123',
    clusterName: 'aks-contoso-prod-eus',
    clusterProfile: 'single-region',
    regions: 'eus',
    nodeSize: 'Standard_D8ds_v4',
    kubernetesVersion: '1.30',
    estimatedMonthlyCost: 600,
    planSummary: {
      resourcesToCreate: 28,
      resourcesToModify: 0,
      resourcesToDestroy: 0,
      monthlyCost: 600,
      errors: [],
      warnings: [],
    },
    status: 'pending_approval',
    approvalChain: [{ role: 'Platform Team', status: 'pending' }],
    createdAt: now,
    updatedAt: now,
    logs: ['created'],
    payload: samplePayload(),
    clusterAdministrators: ['octocat'],
    ...overrides,
  };
}

describe('InfrastructureRequestStore (in-memory fallback)', () => {
  let store: InfrastructureRequestStore;

  beforeEach(async () => {
    store = new InfrastructureRequestStore(makeLogger(), null);
    await store.init();
  });

  it('reports the memory backend when no pool is configured', () => {
    expect(store.backend).toBe('memory');
  });

  it('round-trips a record through create and get', async () => {
    const record = sampleRecord();
    await store.create(record);

    const fetched = await store.get('INFRA-TEST-0001');
    expect(fetched).not.toBeNull();
    expect(fetched!.requestId).toBe('INFRA-TEST-0001');
    expect(fetched!.clusterName).toBe('aks-contoso-prod-eus');
    expect(fetched!.approvalChain).toEqual([
      { role: 'Platform Team', status: 'pending' },
    ]);
    expect(fetched!.planSummary.resourcesToCreate).toBe(28);
    expect(fetched!.payload.customer).toBe('Contoso');
    expect(fetched!.createdAt.getTime()).toBe(
      new Date('2024-01-01T00:00:00.000Z').getTime(),
    );
  });

  it('returns null for an unknown request', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('rejects a save based on a stale copy of the record', async () => {
    await store.create(sampleRecord());
    const first = (await store.get('INFRA-TEST-0001'))!;
    const second = (await store.get('INFRA-TEST-0001'))!;

    first.status = 'approved';
    await store.save(first);
    second.status = 'rejected';

    await expect(store.save(second)).rejects.toBeInstanceOf(
      ConcurrentModificationError,
    );
    expect((await store.get('INFRA-TEST-0001'))!.status).toBe('approved');
  });

  it('persists Tailscale jumpbox access fields through create and save', async () => {
    await store.create(
      sampleRecord({ clusterAdministrators: ['octocat', 'hubot'] }),
    );

    const created = await store.get('INFRA-TEST-0001');
    expect(created!.clusterAdministrators).toEqual(['octocat', 'hubot']);
    expect(created!.accessStatus).toBeUndefined();

    created!.jumpboxName = 'jumpbox-contoso-prod-eus';
    created!.tailscalePrUrl =
      'https://github.com/SymphonySensa/tailscale/pull/7';
    created!.tailscalePrNumber = 7;
    created!.tailscalePrStatus = 'open';
    created!.accessStatus = 'Waiting Approval';
    created!.registryStatus = 'Pending Access';
    created!.status = 'awaiting_tailscale_merge';
    await store.save(created!);

    const fetched = await store.get('INFRA-TEST-0001');
    expect(fetched!.jumpboxName).toBe('jumpbox-contoso-prod-eus');
    expect(fetched!.tailscalePrNumber).toBe(7);
    expect(fetched!.tailscalePrStatus).toBe('open');
    expect(fetched!.accessStatus).toBe('Waiting Approval');
    expect(fetched!.registryStatus).toBe('Pending Access');
    expect(fetched!.status).toBe('awaiting_tailscale_merge');
  });

  it('returns cloned records so callers cannot mutate stored state', async () => {
    await store.create(sampleRecord());

    const first = await store.get('INFRA-TEST-0001');
    first!.status = 'rejected';
    first!.approvalChain[0].status = 'rejected';

    const second = await store.get('INFRA-TEST-0001');
    expect(second!.status).toBe('pending_approval');
    expect(second!.approvalChain[0].status).toBe('pending');
  });

  it('persists mutations via save and bumps updatedAt', async () => {
    await store.create(sampleRecord());

    const record = await store.get('INFRA-TEST-0001');
    record!.status = 'awaiting_pr_merge';
    record!.prNumber = 42;
    record!.prUrl = 'https://github.com/x/pr/42';
    await store.save(record!);

    const fetched = await store.get('INFRA-TEST-0001');
    expect(fetched!.status).toBe('awaiting_pr_merge');
    expect(fetched!.prNumber).toBe(42);
    expect(fetched!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      fetched!.createdAt.getTime(),
    );
  });

  it('lists records newest first', async () => {
    await store.create(
      sampleRecord({
        requestId: 'A',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    );
    await store.create(
      sampleRecord({
        requestId: 'B',
        createdAt: new Date('2024-02-01T00:00:00Z'),
      }),
    );
    await store.create(
      sampleRecord({
        requestId: 'C',
        createdAt: new Date('2024-01-15T00:00:00Z'),
      }),
    );

    const list = await store.list();
    expect(list.map(r => r.requestId)).toEqual(['B', 'C', 'A']);
  });
});

describe('InfrastructureRequestStore (postgres)', () => {
  function makeFakePool() {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    return { pool, query };
  }

  it('reports the postgres backend and runs the schema on init', async () => {
    const { pool, query } = makeFakePool();
    const store = new InfrastructureRequestStore(makeLogger(), pool);

    await store.init();

    expect(store.backend).toBe('postgres');
    expect(String(query.mock.calls[0][0])).toContain(
      'CREATE TABLE IF NOT EXISTS provisioning_infrastructure_requests',
    );
  });

  it('inserts with JSON-encoded JSONB parameters', async () => {
    const { pool, query } = makeFakePool();
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    query.mockClear();

    const record = sampleRecord();
    await store.create(record);

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain(
      'INSERT INTO provisioning_infrastructure_requests',
    );
    expect(params[0]).toBe('INFRA-TEST-0001');
    // approval_chain / logs / plan_summary / payload must be JSON strings for JSONB.
    expect(typeof params[11]).toBe('string');
    expect(JSON.parse(params[11] as string).resourcesToCreate).toBe(28);
    expect(typeof params[13]).toBe('string');
    expect(JSON.parse(params[13] as string)).toEqual([
      { role: 'Platform Team', status: 'pending' },
    ]);
    expect(JSON.parse(params[15] as string).customer).toBe('Contoso');
  });

  it('updates mutable fields via save', async () => {
    const { pool, query } = makeFakePool();
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    query.mockClear();

    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const record = sampleRecord({
      status: 'awaiting_pr_merge',
      prNumber: 7,
      version: 3,
    });
    await store.save(record);

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain(
      'UPDATE provisioning_infrastructure_requests',
    );
    expect(String(sql)).toContain('WHERE request_id = $1 AND version = $20');
    expect(params[0]).toBe('INFRA-TEST-0001');
    expect(params[1]).toBe('awaiting_pr_merge');
    expect(params[6]).toBe(7);
    expect(params[19]).toBe(3);
    expect(record.version).toBe(4);
  });

  it('throws ConcurrentModificationError when the row version has moved on', async () => {
    const { pool, query } = makeFakePool();
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const record = sampleRecord({ version: 1 });
    await expect(store.save(record)).rejects.toBeInstanceOf(
      ConcurrentModificationError,
    );
    expect(record.version).toBe(1);
  });

  it('refuses to start in production without POSTGRES_HOST', () => {
    const previous = {
      env: process.env.NODE_ENV,
      host: process.env.POSTGRES_HOST,
    };
    process.env.NODE_ENV = 'production';
    delete process.env.POSTGRES_HOST;
    try {
      expect(() => InfrastructureRequestStore.fromEnv(makeLogger())).toThrow(
        /POSTGRES_HOST is required in production/,
      );
    } finally {
      process.env.NODE_ENV = previous.env;
      if (previous.host !== undefined)
        process.env.POSTGRES_HOST = previous.host;
    }
  });

  it('refuses to fall back to memory in production when postgres init fails', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { pool, query } = makeFakePool();
      query.mockRejectedValueOnce(new Error('connection refused'));
      const store = new InfrastructureRequestStore(makeLogger(), pool);
      await expect(store.init()).rejects.toThrow(/connection refused/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('maps a database row back into a record on get', async () => {
    const { pool, query } = makeFakePool();
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();

    query.mockResolvedValueOnce({
      rows: [
        {
          request_id: 'INFRA-DB-1',
          requestor: 'eng',
          customer: 'Globex',
          environment: 'dev',
          subscription: 'sub-9',
          cluster_name: 'aks-globex-dev-weu',
          cluster_profile: 'active-passive',
          regions: 'weu + ne',
          node_size: 'Standard_E8ds_v4',
          kubernetes_version: '1.29',
          estimated_monthly_cost: 2750,
          plan_summary: {
            resourcesToCreate: 42,
            resourcesToModify: 0,
            resourcesToDestroy: 0,
            monthlyCost: 2750,
            errors: [],
            warnings: [],
          },
          status: 'awaiting_pr_merge',
          approval_chain: [
            { role: 'Platform Team', status: 'approved' },
            { role: 'Cloud Architect', status: 'approved' },
          ],
          logs: ['a', 'b'],
          payload: samplePayload({ customer: 'Globex' }),
          task_id: 'task-1',
          pr_url: 'https://github.com/x/pr/9',
          pr_number: 9,
          branch_name: 'feat/aks-globex',
          tfvars_path: 'values/aks-globex-dev-weu.tfvars',
          error: null,
          created_at: new Date('2024-03-01T00:00:00Z'),
          updated_at: new Date('2024-03-02T00:00:00Z'),
        },
      ],
    });

    const record = await store.get('INFRA-DB-1');
    expect(record).not.toBeNull();
    expect(record!.clusterProfile).toBe('active-passive');
    expect(record!.estimatedMonthlyCost).toBe(2750);
    expect(record!.approvalChain).toHaveLength(2);
    expect(record!.prNumber).toBe(9);
    expect(record!.createdAt.getTime()).toBe(
      new Date('2024-03-01T00:00:00Z').getTime(),
    );
    expect(record!.payload.customer).toBe('Globex');

    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    expect(String(sql)).toContain('WHERE request_id = $1');
    expect(params).toEqual(['INFRA-DB-1']);
  });

  it('orders list results by created_at descending', async () => {
    const { pool, query } = makeFakePool();
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    query.mockResolvedValueOnce({ rows: [] });

    await store.list();

    const sql = String(query.mock.calls[query.mock.calls.length - 1][0]);
    expect(sql).toContain('ORDER BY created_at DESC');
  });

  it('falls back to the in-memory store when schema initialization fails', async () => {
    const { pool, query } = makeFakePool();
    query.mockRejectedValueOnce(new Error('connection refused'));
    const store = new InfrastructureRequestStore(makeLogger(), pool);

    await store.init();

    expect(store.backend).toBe('memory');

    // Subsequent operations use memory and do not touch the pool again.
    query.mockClear();
    await store.create(sampleRecord());
    const fetched = await store.get('INFRA-TEST-0001');
    expect(fetched!.requestId).toBe('INFRA-TEST-0001');
    expect(query).not.toHaveBeenCalled();
  });
});
