/**
 * Upgrade test against a real Postgres: a database created by migrations
 * 001 + 002 (pre-version schema) holding live requests must come up under the
 * current store schema with every request intact and optimistic concurrency
 * enforced.
 *
 * Opt-in only, and isolated in a throwaway schema so it can never touch real
 * tables:
 *   PROVISIONING_PG_TEST_URL=postgres://user:pass@localhost:55432/postgres
 */

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  ConcurrentModificationError,
  InFlightClaimConflictError,
  InfrastructureRequestStore,
  type InfrastructureRequest,
} from '../services/InfrastructureRequestStore';

const url = process.env.PROVISIONING_PG_TEST_URL;
const suite = url ? describe : describe.skip;

const migration = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, '../../migrations', name), 'utf8');

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

suite('InfrastructureRequestStore migration (real postgres)', () => {
  const schema = `prov_migration_${Date.now()}`;
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url, ssl: false });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: url,
      ssl: false,
      options: `-c search_path=${schema}`,
    });

    // Pre-change installation: 001 + 002 only, with existing requests.
    await pool.query(migration('001_provisioning.sql'));
    await pool.query(migration('002_provisioning_jumpbox.sql'));
    await pool.query(
      `INSERT INTO provisioning_infrastructure_requests
         (request_id, requestor, customer, environment, cluster_name,
          cluster_profile, status, approval_chain, logs, payload,
          tailscale_pr_number, tailscale_pr_status)
       VALUES
         ('INFRA-LEGACY-1', 'Jane Doe', 'Contoso', 'prod', 'aks-contoso-prod-eus',
          'single-region', 'pending_approval',
          '[{"role":"Platform Team","status":"pending"}]', '["created"]',
          '{"customer":"Contoso"}', NULL, NULL),
         ('INFRA-LEGACY-2', 'eng', 'Globex', 'dev', 'aks-globex-dev-weu',
          'dev-tier', 'awaiting_tailscale_merge',
          '[{"role":"Platform Team","status":"approved","approver":"bob"}]',
          '["a","b"]', '{"customer":"Globex"}', 7, 'open'),
         -- Legacy duplicate cluster name: the new unique claim indexes must
         -- still build on an installation that already contains duplicates.
         ('INFRA-LEGACY-3', 'Jane Doe', 'Contoso', 'prod', 'aks-contoso-prod-eus',
          'single-region', 'rejected', '[]', '[]', '{}', NULL, NULL)`,
    );
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('upgrades in place and preserves existing requests', async () => {
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    expect(store.backend).toBe('postgres');

    const legacy1 = await store.get('INFRA-LEGACY-1');
    const legacy2 = await store.get('INFRA-LEGACY-2');
    expect(legacy1).toMatchObject({
      requestor: 'Jane Doe',
      status: 'pending_approval',
      version: 0,
    });
    expect(legacy1!.payload.customer).toBe('Contoso');
    expect(legacy2).toMatchObject({
      status: 'awaiting_tailscale_merge',
      tailscalePrNumber: 7,
      version: 0,
    });
    expect(legacy2!.approvalChain[0].approver).toBe('bob');
    expect(legacy2!.logs).toEqual(['a', 'b']);
    // Legacy rows carry no fingerprint or claims.
    expect(legacy1!.configFingerprint).toBeUndefined();
    expect(legacy1!.claimClusterName).toBeNull();
  });

  it('is idempotent: re-running the schema and 003 changes nothing', async () => {
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    await pool.query(migration('003_provisioning_integrity.sql'));
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM provisioning_infrastructure_requests',
    );
    expect(rows[0].n).toBe(3);
  });

  it('applies 004 idempotently and keeps legacy rows untracked', async () => {
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    await pool.query(migration('004_provisioning_execution_tracking.sql'));
    await pool.query(migration('004_provisioning_execution_tracking.sql'));
    const legacy = (await store.get('INFRA-LEGACY-2'))!;
    expect(legacy.prRepository).toBeNull();
    expect(legacy.execution).toBeNull();
  });

  it('persists execution tracking across store instances (backend restart)', async () => {
    const first = new InfrastructureRequestStore(makeLogger(), pool);
    await first.init();
    const base = (await first.get('INFRA-LEGACY-1'))!;
    await first.create({
      ...structuredClone(base),
      requestId: 'TRACK-1',
      clusterName: 'aks-scp-dev-ae-st-track',
      status: 'awaiting_pr_merge',
      configFingerprint: 'sha256:t',
      prNumber: 42,
      prRepository: 'SymphonySensa/scp-infra-as-code',
      infraPrOperation: {
        state: 'completed',
        attempt: 2,
        startedAt: '2026-10-13T09:00:00.000Z',
        startedBy: 'user:default/requester',
        updatedAt: '2026-10-13T09:01:00.000Z',
        repository: 'SymphonySensa/scp-infra-as-code',
        branchName: 'feature/SCP-1-create-aks-aks-scp-dev-ae-st-track',
        prNumber: 42,
        prReused: false,
      },
      execution: {
        schemaVersion: 1,
        phase: 'awaiting_review',
        detail: 'PR #42 needs an approving CODEOWNERS review',
        phaseSince: '2026-10-13T10:00:00.000Z',
        pullRequest: null,
        mapping: null,
        workspaceManagerRun: null,
        workspace: null,
        run: null,
        outputs: null,
        refresh: {
          lastAttemptAt: '2026-10-13T10:00:00.000Z',
          lastSuccessAt: '2026-10-13T10:00:00.000Z',
          error: null,
        },
        history: [],
      },
    } as InfrastructureRequest);
    const tracked = (await first.get('TRACK-1'))!;
    tracked.execution!.phase = 'awaiting_merge';
    await first.save(tracked);

    // A new process: fresh pool + store, same database.
    const restartedPool = new Pool({
      connectionString: url,
      ssl: false,
      options: `-c search_path=${schema}`,
    });
    try {
      const second = new InfrastructureRequestStore(
        makeLogger(),
        restartedPool,
      );
      await second.init();
      const resumed = (await second.get('TRACK-1'))!;
      expect(resumed.prRepository).toBe('SymphonySensa/scp-infra-as-code');
      expect(resumed.execution!.phase).toBe('awaiting_merge');
      expect(resumed.infraPrOperation).toMatchObject({
        state: 'completed',
        attempt: 2,
        prNumber: 42,
      });
      expect(resumed.version).toBe(1);
      const active = await second.listByStatus([
        'awaiting_pr_merge',
        'provisioning',
      ]);
      expect(active.map(r => r.requestId)).toContain('TRACK-1');
      expect(active.map(r => r.requestId)).not.toContain('INFRA-LEGACY-1');
    } finally {
      await restartedPool.end();
    }
  });

  it('enforces optimistic concurrency on upgraded rows', async () => {
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    const a = (await store.get('INFRA-LEGACY-1'))!;
    const b = (await store.get('INFRA-LEGACY-1'))!;

    a.logs.push('writer a');
    await store.save(a);
    expect(a.version).toBe(1);

    b.logs.push('writer b');
    await expect(store.save(b)).rejects.toBeInstanceOf(
      ConcurrentModificationError,
    );
    const stored = (await store.get('INFRA-LEGACY-1'))!;
    expect(stored.logs).toEqual(['created', 'writer a']);
    expect(stored.version).toBe(1);
  });

  it('enforces in-flight claims atomically and frees them when cleared', async () => {
    const store = new InfrastructureRequestStore(makeLogger(), pool);
    await store.init();
    const base = (await store.get('INFRA-LEGACY-1'))!;
    const fresh = (id: string, cluster: string, cidr: string) =>
      ({
        ...structuredClone(base),
        requestId: id,
        clusterName: cluster,
        claimClusterName: cluster,
        claimAddressSpace: cidr,
        configFingerprint: 'sha256:test',
      } as InfrastructureRequest);

    await store.create(fresh('NEW-1', 'aks-scp-dev-ae-st-a', '10.240.0.0/16'));
    await expect(
      store.create(fresh('NEW-2', 'aks-scp-dev-ae-st-a', '10.241.0.0/16')),
    ).rejects.toThrow(/cluster name/);
    await expect(
      store.create(fresh('NEW-3', 'aks-scp-dev-ae-st-b', '10.240.0.0/16')),
    ).rejects.toBeInstanceOf(InFlightClaimConflictError);

    const first = (await store.get('NEW-1'))!;
    expect(first.configFingerprint).toBe('sha256:test');
    first.claimClusterName = null;
    first.claimAddressSpace = null;
    await store.save(first);
    await store.create(fresh('NEW-4', 'aks-scp-dev-ae-st-a', '10.240.0.0/16'));
    expect((await store.get('NEW-4'))!.claimClusterName).toBe(
      'aks-scp-dev-ae-st-a',
    );
  });
});
