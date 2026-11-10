import express from 'express';
import request from 'supertest';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { patchSupertestIpv4 } from '../test-utils/patchSupertestIpv4';
import { createProvisioningRouter } from '../createProvisioningRouter';
import {
  aksApproveCloudArchitectPermission,
  jumpboxApprovePermission,
} from '../permissions';
import { InfrastructureRequestStore } from '../services/InfrastructureRequestStore';
import { InfrastructureProvisioningService } from '../services/InfrastructureProvisioningService';
import { AKS_FLAVOR_POOLS } from '@internal/plugin-platform-common/backend';
import { AksExecutionTracker } from '../services/AksExecutionTracker';
import {
  GithubReader,
  TerraformCloudReader,
} from '../services/aksExternalReaders';
import {
  assertReadOnly,
  createFakeExternalApis,
  emptyFakeState,
} from '../test-utils/fakeAksExternalApis';

patchSupertestIpv4();

/** Multi-stage chain (no real profile needs one until multi-region exists). */
const THREE_STAGE = {
  approvalChains: {
    'single-region': ['Platform Team', 'Cloud Architect', 'Operations'],
  },
};

const REQUESTER = 'user:default/requester';
const ALICE = 'user:default/alice';
const BOB = 'user:default/bob';
const CAROL = 'user:default/carol';

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

interface FakeServiceOptions {
  mode?: 'real' | 'sim';
  validationErrors?: string[];
  prepareFeatureBranch?: jest.Mock;
  createPullRequest?: jest.Mock;
  tailscaleMerged?: boolean;
  approvalChains?: Record<string, string[]>;
  /** Submission gate evaluator; defaults to every check passing. */
  submissionGates?: jest.Mock;
  /** Use the router's built-in default (no gate evaluator configured). */
  defaultGates?: boolean;
  tracker?: any;
  makeTracker?: (store: InfrastructureRequestStore) => any;
}

const PASSING_GATES = {
  blocking: false,
  checkedAt: '2026-10-13T00:00:00.000Z',
  checks: [
    {
      id: 'cidr_repository',
      label: 'Address space vs scp-infra-as-code',
      status: 'passed',
      detail: 'ok',
    },
  ],
};

function makeFakeService(opts: FakeServiceOptions = {}) {
  const prepareFeatureBranch =
    opts.prepareFeatureBranch ??
    jest.fn(async () => ({
      clusterName: 'aks-scp-prd-eus-st-contoso',
      tfvarsPath:
        'azure-kubernetes-service-standard/values/aks-scp-prd-eus-st-contoso.tfvars',
      featureBranch: 'feature/SCP-1234-create-aks-aks-scp-prd-eus-st-contoso',
      commitSha: 'abc1234',
    }));
  const createPullRequest =
    opts.createPullRequest ??
    jest.fn(async () => ({
      prNumber: 42,
      prUrl: 'https://github.com/SymphonySensa/scp-infra-as-code/pull/42',
    }));

  // Real (pure) request model; only GitHub operations are faked.
  const service = new InfrastructureProvisioningService(makeLogger());
  Object.assign(service, {
    mode: opts.mode ?? 'real',
    prepareFeatureBranch,
    createPullRequest,
    getPRStatus: jest.fn(async () => ({
      prState: 'open',
      merged: false,
      draft: false,
    })),
  });
  if (opts.validationErrors) {
    jest.spyOn(service, 'validateRequest').mockReturnValue({
      errors: opts.validationErrors,
      warnings: [],
      fieldErrors: {},
    });
  }

  return { service, prepareFeatureBranch, createPullRequest };
}

async function buildHarness(opts: FakeServiceOptions = {}) {
  const logger = makeLogger();
  const store = new InfrastructureRequestStore(logger, null);
  await store.init();
  const { service, prepareFeatureBranch, createPullRequest } =
    makeFakeService(opts);
  const jumpboxService = {
    mode: 'real',
    repo: {
      owner: 'SymphonySensa',
      repo: 'tailscale',
      baseBranch: 'main',
      policyPath: 'policy.hujson',
    },
    deriveJumpboxName: jest.fn(() => 'jumpbox-contoso-prod-eus'),
    provisionAccess: jest.fn(async () => ({
      jumpboxName: 'jumpbox-contoso-prod-eus',
      branch: 'feature/add-jumpbox-access-aks-contoso-prod-eus',
      prNumber: 7,
      prUrl: 'https://github.com/SymphonySensa/tailscale/pull/7',
      policyPath: 'policy.hujson',
      administrators: ['octocat'],
    })),
    getPullRequestStatus: jest.fn(async () => ({
      state: opts.tailscaleMerged ? 'closed' : 'open',
      merged: Boolean(opts.tailscaleMerged),
    })),
  } as any;
  const registry = {
    updateClusterLifecycle: jest.fn(async () => ({ applied: true })),
  } as any;
  const permissions = {
    authorize: jest.fn(async () => [{ result: AuthorizeResult.ALLOW }]),
  } as any;
  const identity = { user: REQUESTER };
  const httpAuth = {
    credentials: jest.fn(async () => ({
      principal: { type: 'user', userEntityRef: identity.user },
    })),
  } as any;
  /** Switch the authenticated Backstage user for subsequent requests. */
  const actAs = (user: string) => {
    identity.user = user;
  };
  const submissionGates = opts.defaultGates
    ? undefined
    : opts.submissionGates ?? jest.fn(async () => PASSING_GATES);
  const router = createProvisioningRouter({
    logger,
    httpAuth,
    store,
    service,
    jumpboxService,
    registry,
    permissions,
    approvalChains: opts.approvalChains,
    submissionGates: submissionGates as any,
    tracker: opts.makeTracker ? opts.makeTracker(store) : opts.tracker,
  });
  const app = express();
  app.use(router);
  return {
    app,
    store,
    service,
    prepareFeatureBranch,
    createPullRequest,
    jumpboxService,
    permissions,
    httpAuth,
    registry,
    actAs,
    submissionGates,
  };
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return {
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
    requestor: 'tester',
    clusterAdministrators: ['octocat'],
    ...overrides,
  };
}

describe('provisioning router', () => {
  // Multi-stage chains need every stage's approver groups configured.
  beforeEach(() => {
    process.env.CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS =
      'group:default/cloud-architects';
    process.env.CLOUDHUB_AKS_OPERATIONS_GROUP_REFS = 'group:default/cloud-ops';
  });
  afterEach(() => {
    delete process.env.CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS;
    delete process.env.CLOUDHUB_AKS_OPERATIONS_GROUP_REFS;
  });

  describe('POST /submit', () => {
    it('rejects an invalid request with 400', async () => {
      const { app } = await buildHarness({
        validationErrors: ['Customer / Tenant is required'],
      });

      const res = await request(app)
        .post('/submit')
        .send(submitBody({ customer: '' }));

      expect(res.status).toBe(400);
      expect(res.body.errors).toContain('Customer / Tenant is required');
    });

    it('refuses to submit when GitHub credentials are missing with 503', async () => {
      const { app } = await buildHarness({ mode: 'sim' });

      const res = await request(app).post('/submit').send(submitBody());

      expect(res.status).toBe(503);
      expect(res.body.mode).toBe('sim');
    });

    it('creates a pending_approval request without any Git operations', async () => {
      const { app, store, prepareFeatureBranch } = await buildHarness();

      const res = await request(app).post('/submit').send(submitBody());

      expect(res.status).toBe(200);
      expect(res.body.requestId).toBeDefined();
      expect(res.body.status).toBe('pending_approval');
      expect(res.body.approvalChain).toEqual([
        { role: 'Platform Team', status: 'pending' },
      ]);
      expect(res.body).not.toHaveProperty('payload');
      expect(prepareFeatureBranch).not.toHaveBeenCalled();

      // Persisted in the store.
      const stored = await store.get(res.body.requestId);
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe('pending_approval');
      expect(stored!.payload.customer).toBe('Contoso');
    });

    it('rejects multi-region profiles the generator cannot express', async () => {
      const { app, store } = await buildHarness();
      const res = await request(app)
        .post('/submit')
        .send(submitBody({ clusterProfile: 'active-active' }));
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty('clusterProfile');
      expect(await store.list()).toHaveLength(0);
    });

    it('builds the configured multi-stage chain', async () => {
      const { app } = await buildHarness(THREE_STAGE);
      const res = await request(app).post('/submit').send(submitBody());
      expect(res.status).toBe(200);
      expect(
        res.body.approvalChain.map((s: { role: string }) => s.role),
      ).toEqual(['Platform Team', 'Cloud Architect', 'Operations']);
    });
  });

  describe('GET /requests and /request/:id', () => {
    it('lists requests without exposing the raw payload', async () => {
      const { app } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());

      const list = await request(app).get('/requests');
      expect(list.status).toBe(200);
      expect(list.body.requests).toHaveLength(1);
      expect(list.body.requests[0].requestId).toBe(submit.body.requestId);
      expect(list.body.requests[0]).not.toHaveProperty('payload');
    });

    it('returns 404 for an unknown request', async () => {
      const { app } = await buildHarness();
      const res = await request(app).get('/request/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /request/:id/approve', () => {
    it('opens the Tailscale PR once every stage is approved', async () => {
      const { app, jumpboxService, prepareFeatureBranch, actAs } =
        await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      actAs(ALICE);
      const first = await request(app).post(`/request/${id}/approve`).send({});
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('pending_approval');
      expect(first.body).not.toHaveProperty('prUrl');
      expect(jumpboxService.provisionAccess).not.toHaveBeenCalled();

      actAs(BOB);
      const second = await request(app).post(`/request/${id}/approve`).send({});
      expect(second.body.status).toBe('pending_approval');
      expect(jumpboxService.provisionAccess).not.toHaveBeenCalled();

      actAs(CAROL);
      const third = await request(app).post(`/request/${id}/approve`).send({});
      expect(third.status).toBe(200);
      expect(third.body.status).toBe('awaiting_tailscale_merge');
      expect(third.body.tailscalePrUrl).toBe(
        'https://github.com/SymphonySensa/tailscale/pull/7',
      );
      expect(third.body.accessStatus).toBe('Waiting Approval');
      expect(jumpboxService.provisionAccess).toHaveBeenCalledTimes(1);
      expect(prepareFeatureBranch).not.toHaveBeenCalled();
    });

    it('creates the infrastructure PR only through the explicit action once Tailscale merges', async () => {
      const { app, store, prepareFeatureBranch, createPullRequest, actAs } =
        await buildHarness({ tailscaleMerged: true });
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      actAs(ALICE);
      const approve = await request(app)
        .post(`/request/${id}/approve`)
        .send({ approver: 'spoofed' });
      expect(approve.status).toBe(200);
      expect(approve.body.status).toBe('awaiting_tailscale_merge');

      // Polling reports the merge and offers the action; it creates nothing.
      const access = await request(app).get(`/request/${id}/access-status`);
      expect(access.status).toBe(200);
      expect(access.body.merged).toBe(true);
      expect(access.body.infraPrActionAvailable).toBe(true);
      expect(prepareFeatureBranch).not.toHaveBeenCalled();
      expect(createPullRequest).not.toHaveBeenCalled();
      expect((await store.get(id))!.status).toBe('awaiting_tailscale_merge');

      const action = await request(app)
        .post(`/request/${id}/infrastructure-pr`)
        .send({});
      expect(action.status).toBe(200);
      expect(action.body.branchName).toBe(
        'feature/SCP-1234-create-aks-aks-scp-prd-eus-st-contoso',
      );
      expect(action.body.prUrl).toBe(
        'https://github.com/SymphonySensa/scp-infra-as-code/pull/42',
      );
      expect(action.body.infraPrOperation).toMatchObject({
        state: 'completed',
        attempt: 1,
        startedBy: ALICE,
        prNumber: 42,
      });
      expect(prepareFeatureBranch).toHaveBeenCalledTimes(1);
      expect(createPullRequest).toHaveBeenCalledTimes(1);

      const stored = await store.get(id);
      expect(stored!.status).toBe('awaiting_pr_merge');
      expect(stored!.branchName).toBe(
        'feature/SCP-1234-create-aks-aks-scp-prd-eus-st-contoso',
      );
      expect(stored!.prNumber).toBe(42);
      expect(stored!.approvalChain[0].status).toBe('approved');
      expect(stored!.approvalChain[0].approver).toBe(ALICE);
    });

    it('marks the request failed and persists the error when Git operations throw', async () => {
      const { app, store, jumpboxService, actAs } = await buildHarness();
      jumpboxService.provisionAccess = jest.fn(async () => {
        throw new Error('GitHub API unavailable');
      });
      const created = await request(app).post('/submit').send(submitBody());
      const id = created.body.requestId;

      actAs(ALICE);
      const approve = await request(app)
        .post(`/request/${id}/approve`)
        .send({});
      expect(approve.status).toBe(500);
      expect(approve.body.status).toBe('failed');

      const stored = await store.get(id);
      expect(stored!.status).toBe('failed');
      expect(stored!.error).toContain('GitHub API unavailable');
    });

    it('returns 404 when approving an unknown request', async () => {
      const { app } = await buildHarness();
      const res = await request(app).post('/request/nope/approve').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /request/:id/reject', () => {
    it('rejects a pending request without running Git operations', async () => {
      const { app, store, prepareFeatureBranch, actAs } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      actAs(ALICE);
      const res = await request(app)
        .post(`/request/${id}/reject`)
        .send({ approver: 'spoofed', reason: 'Budget not approved' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
      expect(prepareFeatureBranch).not.toHaveBeenCalled();

      const stored = await store.get(id);
      expect(stored!.status).toBe('rejected');
      expect(stored!.error).toBe('Budget not approved');
      expect(stored!.approvalChain[0].approver).toBe(ALICE);
    });

    it('denies rejection when the approver lacks permission', async () => {
      const { app, store, permissions } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      permissions.authorize.mockResolvedValue([
        { result: AuthorizeResult.DENY },
      ]);

      const res = await request(app).post(`/request/${id}/reject`).send({});

      expect(res.status).toBe(403);
      expect((await store.get(id))!.status).toBe('pending_approval');
    });

    it('is idempotent when the request is already rejected', async () => {
      const { app } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      await request(app).post(`/request/${id}/reject`).send({});
      const res = await request(app).post(`/request/${id}/reject`).send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });

    it('answers with JSON instead of hanging when persistence fails', async () => {
      const { app, store } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      jest
        .spyOn(store, 'save')
        .mockRejectedValue(new Error('postgres is down'));

      const res = await request(app).post(`/request/${id}/reject`).send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('postgres is down');
    });
  });

  describe('identity and authorization', () => {
    afterEach(() => {
      delete process.env.ALLOW_SELF_APPROVAL;
    });

    it('records the authenticated user as requestor, ignoring the body', async () => {
      const { app, store } = await buildHarness();
      const res = await request(app)
        .post('/submit')
        .send(submitBody({ requestor: 'someone-else' }));
      expect(res.status).toBe(200);
      expect((await store.get(res.body.requestId))!.requestor).toBe(REQUESTER);
    });

    it('returns 401 from submit when the caller is not a user', async () => {
      const { app, httpAuth, store } = await buildHarness();
      httpAuth.credentials.mockRejectedValueOnce(
        new Error('Missing credentials'),
      );
      const res = await request(app).post('/submit').send(submitBody());
      expect(res.status).toBe(401);
      expect(await store.list()).toHaveLength(0);
    });

    it('requires a user for workflow-dispatching and mutating routes', async () => {
      const { app, httpAuth, service } = await buildHarness();
      (service as any).triggerPlanReview = jest.fn();
      for (const path of [
        '/plan',
        '/request/x/create-pr',
        '/request/x/infrastructure-pr',
        '/request/x/provision-access',
        '/request/x/execution/refresh',
        '/request/x/complete-access',
        '/task/x/cancel',
      ]) {
        httpAuth.credentials.mockRejectedValueOnce(new Error('no token'));
        const res = await request(app).post(path).send({});
        expect(res.status).toBe(401);
      }
      expect((service as any).triggerPlanReview).not.toHaveBeenCalled();
    });

    it('blocks requesters from approving their own request', async () => {
      const { app, store, jumpboxService } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      const res = await request(app).post(`/request/${id}/approve`).send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/own infrastructure request/);
      expect((await store.get(id))!.approvalChain[0].status).toBe('pending');
      expect(jumpboxService.provisionAccess).not.toHaveBeenCalled();
    });

    it('allows self-approval only when ALLOW_SELF_APPROVAL=true', async () => {
      process.env.ALLOW_SELF_APPROVAL = 'true';
      const { app } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const res = await request(app)
        .post(`/request/${submit.body.requestId}/approve`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('awaiting_tailscale_merge');
    });

    it('requires a distinct approver for each stage', async () => {
      const { app, store, actAs } = await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      const again = await request(app).post(`/request/${id}/approve`).send({});

      expect(again.status).toBe(409);
      const stages = (await store.get(id))!.approvalChain;
      expect(stages.map(s => s.status)).toEqual([
        'approved',
        'pending',
        'pending',
      ]);
    });

    it('opens one Tailscale PR when the final approval arrives twice concurrently', async () => {
      const { app, jumpboxService, permissions, actAs } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;

      // Hold both requests at the permission check until both have read the
      // (still pending) record, forcing a genuine write-write race.
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>(resolve => {
        release = resolve;
      });
      permissions.authorize.mockImplementation(async () => {
        arrived += 1;
        if (arrived === 2) release();
        await barrier;
        return [{ result: AuthorizeResult.ALLOW }];
      });

      actAs(ALICE);
      const results = await Promise.all([
        request(app).post(`/request/${id}/approve`).send({}),
        request(app).post(`/request/${id}/approve`).send({}),
      ]);

      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      expect(jumpboxService.provisionAccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /request/:id/access-status is read-only', () => {
    it('never creates a branch or PR, or changes stored state, however often it is polled after the Tailscale merge', async () => {
      const {
        app,
        store,
        createPullRequest,
        prepareFeatureBranch,
        jumpboxService,
        actAs,
      } = await buildHarness({ tailscaleMerged: true });
      const id = (await request(app).post('/submit').send(submitBody())).body
        .requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      const before = (await store.get(id))!;
      const provisionCalls = jumpboxService.provisionAccess.mock.calls.length;

      const polls = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app).get(`/request/${id}/access-status`),
        ),
      );
      for (let i = 0; i < 5; i++) {
        polls.push(await request(app).get(`/request/${id}/access-status`));
      }

      expect(polls.every(p => p.status === 200 && p.body.merged)).toBe(true);
      expect(polls.every(p => p.body.infraPrActionAvailable)).toBe(true);
      expect(prepareFeatureBranch).not.toHaveBeenCalled();
      expect(createPullRequest).not.toHaveBeenCalled();
      expect(jumpboxService.provisionAccess.mock.calls.length).toBe(
        provisionCalls,
      );
      const after = (await store.get(id))!;
      // Not even a persisted status change: same version, same record.
      expect(after.version).toBe(before.version);
      expect(after).toEqual(before);
    });

    it('reports a GitHub failure without changing anything', async () => {
      const { app, store, jumpboxService, actAs, prepareFeatureBranch } =
        await buildHarness({ tailscaleMerged: true });
      const id = (await request(app).post('/submit').send(submitBody())).body
        .requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      const before = (await store.get(id))!;
      jumpboxService.getPullRequestStatus.mockRejectedValue(new Error('503'));
      const res = await request(app).get(`/request/${id}/access-status`);
      expect(res.status).toBe(200);
      expect(res.body.observeError).toMatch(/503/);
      expect(res.body.infraPrActionAvailable).toBe(false);
      expect(prepareFeatureBranch).not.toHaveBeenCalled();
      expect((await store.get(id))!.version).toBe(before.version);
    });

    it('makes every GET route side-effect free', async () => {
      const h = await buildHarness({ tailscaleMerged: true });
      const id = (await request(h.app).post('/submit').send(submitBody())).body
        .requestId;
      h.actAs(ALICE);
      await request(h.app).post(`/request/${id}/approve`).send({});
      const before = (await h.store.get(id))!;
      const getRoutes = [
        '/preflight',
        '/mode',
        '/requests',
        '/legacy-requests',
        `/request/${id}`,
        `/request/${id}/execution`,
        `/request/${id}/pr-status`,
        `/request/${id}/access-status`,
        '/plan/status/1',
        '/task/unknown',
      ];
      for (let round = 0; round < 3; round++) {
        for (const path of getRoutes) await request(h.app).get(path);
      }
      expect(h.prepareFeatureBranch).not.toHaveBeenCalled();
      expect(h.createPullRequest).not.toHaveBeenCalled();
      expect(h.jumpboxService.provisionAccess).toHaveBeenCalledTimes(1); // the approval
      expect((await h.store.get(id))!).toEqual(before);
    });
  });

  describe('POST /request/:id/infrastructure-pr', () => {
    async function approved(opts: Parameters<typeof buildHarness>[0] = {}) {
      const h = await buildHarness({ tailscaleMerged: true, ...opts });
      const id = (await request(h.app).post('/submit').send(submitBody())).body
        .requestId;
      h.actAs(ALICE);
      await request(h.app).post(`/request/${id}/approve`).send({});
      return { ...h, id };
    }

    it('creates one branch and PR when the action arrives three times concurrently', async () => {
      const h = await approved();
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>(resolve => {
        release = resolve;
      });
      h.jumpboxService.getPullRequestStatus.mockImplementation(async () => {
        arrived += 1;
        if (arrived === 3) release();
        await barrier;
        return { state: 'closed', merged: true };
      });
      const calls = await Promise.all(
        [1, 2, 3].map(() =>
          request(h.app).post(`/request/${h.id}/infrastructure-pr`).send({}),
        ),
      );
      expect(calls.map(c => c.status).sort()).toEqual([200, 409, 409]);
      expect(h.prepareFeatureBranch).toHaveBeenCalledTimes(1);
      expect(h.createPullRequest).toHaveBeenCalledTimes(1);
    });

    it('is idempotent once the PR exists', async () => {
      const h = await approved();
      await request(h.app).post(`/request/${h.id}/infrastructure-pr`).send({});
      const again = await request(h.app)
        .post(`/request/${h.id}/infrastructure-pr`)
        .send({});
      expect(again.status).toBe(200);
      expect(again.body.alreadyCreated).toBe(true);
      expect(h.createPullRequest).toHaveBeenCalledTimes(1);
    });

    it('records a retryable failure and resumes on an explicit retry', async () => {
      const prepareFeatureBranch = jest
        .fn()
        .mockRejectedValueOnce(new Error('branch protection'))
        .mockResolvedValue({
          clusterName: 'aks-scp-prd-eus-st-contoso',
          tfvarsPath:
            'azure-kubernetes-service-standard/values/aks-scp-prd-eus-st-contoso.tfvars',
          featureBranch:
            'feature/SCP-1234-create-aks-aks-scp-prd-eus-st-contoso',
          commitSha: 'abc1234',
          reused: true,
        });
      const h = await approved({ prepareFeatureBranch });
      const first = await request(h.app)
        .post(`/request/${h.id}/infrastructure-pr`)
        .send({});
      expect(first.status).toBe(502);
      let stored = (await h.store.get(h.id))!;
      expect(stored.status).toBe('infra_pr_failed');
      expect(stored.infraPrOperation).toMatchObject({
        state: 'failed',
        attempt: 1,
        error: expect.stringContaining('branch protection'),
      });
      expect(h.createPullRequest).not.toHaveBeenCalled();

      // Polling a failed request still never retries on its own.
      await request(h.app).get(`/request/${h.id}/access-status`);
      expect(prepareFeatureBranch).toHaveBeenCalledTimes(1);

      const retry = await request(h.app)
        .post(`/request/${h.id}/infrastructure-pr`)
        .send({});
      expect(retry.status).toBe(200);
      stored = (await h.store.get(h.id))!;
      expect(stored.status).toBe('awaiting_pr_merge');
      expect(stored.prRepository).toBe('SymphonySensa/scp-infra-as-code');
      expect(stored.infraPrOperation).toMatchObject({
        state: 'completed',
        attempt: 2,
        branchReused: true,
      });
    });

    it('refuses until the Tailscale access PR is merged', async () => {
      const h = await approved({ tailscaleMerged: false });
      const res = await request(h.app)
        .post(`/request/${h.id}/infrastructure-pr`)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/not merged/);
      expect(h.prepareFeatureBranch).not.toHaveBeenCalled();
    });

    it('requires the requester or an approver', async () => {
      const h = await approved();
      h.permissions.authorize.mockImplementation(async (queries: unknown[]) =>
        queries.map(() => ({ result: AuthorizeResult.DENY })),
      );
      h.actAs(BOB);
      const res = await request(h.app)
        .post(`/request/${h.id}/infrastructure-pr`)
        .send({});
      expect(res.status).toBe(403);
      expect(h.prepareFeatureBranch).not.toHaveBeenCalled();
    });

    it('re-runs the preflight gates and blocks without any Git operation', async () => {
      const submissionGates = jest.fn(async () => PASSING_GATES as any);
      const h = await approved({ submissionGates });
      submissionGates.mockResolvedValueOnce({
        blocking: true,
        checkedAt: 'x',
        checks: [
          {
            id: 'cidr_azure',
            label: 'Address space vs Azure VNets',
            status: 'failed',
            detail: 'overlap',
          },
        ],
      });
      const res = await request(h.app)
        .post(`/request/${h.id}/infrastructure-pr`)
        .send({});
      expect(res.status).toBe(412);
      expect(h.prepareFeatureBranch).not.toHaveBeenCalled();
      expect((await h.store.get(h.id))!.status).toBe(
        'awaiting_tailscale_merge',
      );
    });
  });

  describe('POST /request/:id/complete-access', () => {
    it('refuses with 501 instead of fabricating bootstrap and validation', async () => {
      const { app, store, registry, actAs } = await buildHarness({
        tailscaleMerged: true,
      });
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      registry.updateClusterLifecycle.mockClear();

      const res = await request(app)
        .post(`/request/${id}/complete-access`)
        .send({});

      expect(res.status).toBe(501);
      const stored = (await store.get(id))!;
      expect(stored.status).not.toBe('completed');
      expect(stored.registryStatus).not.toBe('Ready');
      expect(registry.updateClusterLifecycle).not.toHaveBeenCalled();
    });
  });

  describe('external side-effect safety', () => {
    it('does not write to the Platform Registry on approval', async () => {
      const { app, registry, actAs } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      actAs(ALICE);
      const res = await request(app)
        .post(`/request/${submit.body.requestId}/approve`)
        .send({});
      expect(res.status).toBe(200);
      expect(registry.updateClusterLifecycle).not.toHaveBeenCalled();
    });

    it('never opens a second Tailscale PR via the legacy provision-access route', async () => {
      const { app, store, jumpboxService, actAs } = await buildHarness({
        tailscaleMerged: true,
      });
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      await request(app).post(`/request/${id}/infrastructure-pr`).send({});
      expect((await store.get(id))!.status).toBe('awaiting_pr_merge');

      const res = await request(app)
        .post(`/request/${id}/provision-access`)
        .send({});

      expect(res.status).toBe(200);
      expect(jumpboxService.provisionAccess).toHaveBeenCalledTimes(1);
    });

    it('records an audit warning when the self-approval exception is used', async () => {
      process.env.ALLOW_SELF_APPROVAL = 'true';
      try {
        const { app, store } = await buildHarness();
        const submit = await request(app).post('/submit').send(submitBody());
        await request(app)
          .post(`/request/${submit.body.requestId}/approve`)
          .send({});
        const stored = (await store.get(submit.body.requestId))!;
        expect(stored.logs.join('\n')).toMatch(
          /self-approval by requester user:default\/requester/,
        );
      } finally {
        delete process.env.ALLOW_SELF_APPROVAL;
      }
    });
  });

  describe('stage authorization', () => {
    const activeActive = () => submitBody();

    it('refuses to submit a profile whose stages have no approver group', async () => {
      delete process.env.CLOUDHUB_AKS_OPERATIONS_GROUP_REFS;
      const { app, store } = await buildHarness(THREE_STAGE);
      const res = await request(app).post('/submit').send(activeActive());
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/Operations/);
      expect(await store.list()).toHaveLength(0);
    });

    it("authorizes each stage with that stage's own permission", async () => {
      const { app, permissions, actAs } = await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(activeActive());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      actAs(BOB);
      permissions.authorize.mockClear();
      await request(app).post(`/request/${id}/approve`).send({});

      const requested = permissions.authorize.mock.calls[0][0].map(
        (r: { permission: { name: string } }) => r.permission.name,
      );
      expect(requested).toEqual([aksApproveCloudArchitectPermission.name]);
    });

    it('does not let a Platform Team approver decide the Cloud Architect stage', async () => {
      const { app, store, permissions, actAs } = await buildHarness(
        THREE_STAGE,
      );
      const submit = await request(app).post('/submit').send(activeActive());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});

      // BOB holds only jumpbox.approve.
      permissions.authorize.mockImplementation(async (reqs: any[]) =>
        reqs.map(r => ({
          result:
            r.permission.name === jumpboxApprovePermission.name
              ? AuthorizeResult.ALLOW
              : AuthorizeResult.DENY,
        })),
      );
      actAs(BOB);
      const res = await request(app).post(`/request/${id}/approve`).send({});

      expect(res.status).toBe(403);
      expect((await store.get(id))!.approvalChain[1].status).toBe('pending');
    });

    it('decides stages strictly in order', async () => {
      const { app, store, actAs } = await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(activeActive());
      const id = submit.body.requestId;
      actAs(ALICE);
      const res = await request(app)
        .post(`/request/${id}/approve`)
        .send({ role: 'Operations' });
      expect(res.status).toBe(409);
      expect((await store.get(id))!.approvalChain.map(s => s.status)).toEqual([
        'pending',
        'pending',
        'pending',
      ]);
    });

    it('refuses to approve legacy requests with an unverifiable requester', async () => {
      const { app, store, actAs, jumpboxService } = await buildHarness(
        THREE_STAGE,
      );
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      // Simulate a row written before identities came from credentials.
      const legacy = (await store.get(id))!;
      legacy.requestor = 'Jane Doe';
      await store.save(legacy);

      actAs(ALICE);
      const approve = await request(app)
        .post(`/request/${id}/approve`)
        .send({});
      expect(approve.status).toBe(409);
      expect(approve.body.error).toMatch(/predates verified requester/);
      expect(jumpboxService.provisionAccess).not.toHaveBeenCalled();

      const reject = await request(app).post(`/request/${id}/reject`).send({});
      expect(reject.status).toBe(200);
      expect(reject.body.status).toBe('rejected');
    });
  });

  describe('approval integrity (configuration fingerprint)', () => {
    it('binds the request and each approval to the configuration fingerprint', async () => {
      const { app, store, actAs } = await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      expect(submit.body.configFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      const stored = (await store.get(id))!;
      expect(stored.configFingerprint).toBe(submit.body.configFingerprint);
      expect(stored.approvalChain[0].fingerprint).toBe(
        submit.body.configFingerprint,
      );
    });

    it('resets approvals when the stored configuration was altered', async () => {
      const { app, store, actAs, jumpboxService } = await buildHarness(
        THREE_STAGE,
      );
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});

      // Out-of-band change to the persisted configuration.
      const tampered = (await store.get(id))!;
      tampered.payload = { ...tampered.payload, addressSpace: '10.231.0.0/16' };
      await store.save(tampered);

      actAs(BOB);
      const res = await request(app).post(`/request/${id}/approve`).send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/no longer matches/);
      const stored = (await store.get(id))!;
      expect(stored.approvalChain.every(s => s.status === 'pending')).toBe(
        true,
      );
      expect(stored.configFingerprint).not.toBe(submit.body.configFingerprint);
      expect(jumpboxService.provisionAccess).not.toHaveBeenCalled();
    });

    it('refuses to create the infrastructure PR for a configuration nobody approved', async () => {
      const { app, store, actAs, prepareFeatureBranch, createPullRequest } =
        await buildHarness({ tailscaleMerged: true });
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});

      const tampered = (await store.get(id))!;
      tampered.clusterAdministrators = ['octocat', 'mallory'];
      await store.save(tampered);

      const res = await request(app)
        .post(`/request/${id}/infrastructure-pr`)
        .send({});
      expect(res.status).toBe(409);
      expect(prepareFeatureBranch).not.toHaveBeenCalled();
      expect(createPullRequest).not.toHaveBeenCalled();
      expect((await store.get(id))!.status).toBe('pending_approval');
    });

    it('passes the approved configuration and approvals into the PR', async () => {
      const { app, actAs, createPullRequest, prepareFeatureBranch } =
        await buildHarness({ tailscaleMerged: true });
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      await request(app).post(`/request/${id}/infrastructure-pr`).send({});

      expect(prepareFeatureBranch.mock.calls[0][0]).toMatchObject({
        tenantId: 'contoso',
        addressSpace: '10.230.0.0/16',
      });
      expect(createPullRequest.mock.calls[0][2]).toMatchObject({
        requestId: id,
        configFingerprint: submit.body.configFingerprint,
        approvals: [{ role: 'Platform Team', approver: ALICE }],
      });
    });

    it('refuses approval of legacy requests without a fingerprint', async () => {
      const { app, store, actAs } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const legacy = (await store.get(submit.body.requestId))!;
      legacy.configFingerprint = undefined;
      await store.save(legacy);

      actAs(ALICE);
      const res = await request(app)
        .post(`/request/${submit.body.requestId}/approve`)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/approval integrity/);
    });
  });

  describe('POST /request/:id/amend', () => {
    it('lets only the requester amend', async () => {
      const { app, actAs } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      actAs(ALICE);
      const res = await request(app)
        .post(`/request/${submit.body.requestId}/amend`)
        .send(submitBody({ addressSpace: '10.231.0.0/16' }));
      expect(res.status).toBe(403);
    });

    it('invalidates approvals when the configuration changes', async () => {
      const { app, store, actAs } = await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});

      actAs(REQUESTER);
      const res = await request(app)
        .post(`/request/${id}/amend`)
        .send(
          submitBody({ tenantId: 'contoso2', addressSpace: '10.231.0.0/16' }),
        );

      expect(res.status).toBe(200);
      expect(res.body.clusterName).toBe('aks-scp-prd-eus-st-contoso2');
      const stored = (await store.get(id))!;
      expect(stored.approvalChain.map(s => s.status)).toEqual([
        'pending',
        'pending',
        'pending',
      ]);
      expect(stored.configFingerprint).not.toBe(submit.body.configFingerprint);
      expect(stored.claimClusterName).toBe('aks-scp-prd-eus-st-contoso2');
      expect(stored.logs.join('\n')).toMatch(/approval by .*alice invalidated/);
    });

    it('keeps approvals when the amendment changes nothing', async () => {
      const { app, store, actAs } = await buildHarness(THREE_STAGE);
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});

      actAs(REQUESTER);
      await request(app)
        .post(`/request/${id}/amend`)
        .send(submitBody({ clusterAdministrators: ['OctoCat'] }));
      expect((await store.get(id))!.approvalChain[0].status).toBe('approved');
    });

    it('refuses amendments once fully approved', async () => {
      const { app, actAs } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const id = submit.body.requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});

      actAs(REQUESTER);
      const res = await request(app)
        .post(`/request/${id}/amend`)
        .send(submitBody({ addressSpace: '10.231.0.0/16' }));
      expect(res.status).toBe(409);
    });

    it('validates the amended configuration', async () => {
      const { app } = await buildHarness();
      const submit = await request(app).post('/submit').send(submitBody());
      const res = await request(app)
        .post(`/request/${submit.body.requestId}/amend`)
        .send(submitBody({ env: 'production' }));
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty('env');
    });
  });

  describe('in-flight uniqueness claims', () => {
    it('rejects a second in-flight request for the same cluster', async () => {
      const { app, store } = await buildHarness();
      await request(app).post('/submit').send(submitBody());
      const dup = await request(app)
        .post('/submit')
        .send(submitBody({ addressSpace: '10.231.0.0/16' }));
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatch(/cluster name/);
      expect(await store.list()).toHaveLength(1);
    });

    it('rejects a second in-flight request for the same address space', async () => {
      const { app } = await buildHarness();
      await request(app).post('/submit').send(submitBody());
      const dup = await request(app)
        .post('/submit')
        .send(submitBody({ tenantId: 'globex' }));
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatch(/address space/);
    });

    it('releases the claims when a request is rejected', async () => {
      const { app, actAs } = await buildHarness();
      const first = await request(app).post('/submit').send(submitBody());
      actAs(ALICE);
      await request(app)
        .post(`/request/${first.body.requestId}/reject`)
        .send({});
      actAs(REQUESTER);
      const again = await request(app).post('/submit').send(submitBody());
      expect(again.status).toBe(200);
    });
  });

  describe('naming and configuration consistency', () => {
    it('preview, persisted request, values file and PR input agree', async () => {
      const { app, store, service, actAs, prepareFeatureBranch } =
        await buildHarness({ tailscaleMerged: true });
      const body = submitBody({
        env: 'dev',
        location: 'australiaeast',
        tenantId: 'lfs2',
      });

      const preview = await request(app).post('/plan').send(body);
      expect(preview.body.valid).toBe(true);
      expect(preview.body.names.clusterName).toBe('aks-scp-dev-ae-st-lfs2');
      expect(preview.body.subnets.aks).toBe('10.230.0.0/18');
      expect(preview.body.dispatched).toBe(false);

      const submit = await request(app).post('/submit').send(body);
      const stored = (await store.get(submit.body.requestId))!;
      expect(stored.clusterName).toBe(preview.body.names.clusterName);
      expect(stored.jumpboxName).toBe('jumpbox-scp-dev-ae-st-lfs2');
      expect(stored.claimAddressSpace).toBe('10.230.0.0/16');
      expect(service.generateTfvars(stored.payload)).toBe(
        preview.body.valuesFile,
      );

      actAs(ALICE);
      await request(app)
        .post(`/request/${submit.body.requestId}/approve`)
        .send({});
      await request(app)
        .post(`/request/${submit.body.requestId}/infrastructure-pr`)
        .send({});
      expect(prepareFeatureBranch.mock.calls[0][0]).toEqual(stored.payload);
    });

    it('returns field errors and no values file for an invalid preview', async () => {
      const { app } = await buildHarness();
      const res = await request(app)
        .post('/plan')
        .send(submitBody({ addressSpace: '10.0.0.0/16' }));
      expect(res.body.valid).toBe(false);
      expect(res.body.fieldErrors).toHaveProperty('addressSpace');
      expect(res.body.valuesFile).toBeUndefined();
    });
  });
  describe('submission gates', () => {
    const BLOCKING = {
      blocking: true,
      checkedAt: '2026-10-13T00:00:00.000Z',
      checks: [
        {
          id: 'compute_quota',
          label: 'Compute quota and VM availability',
          status: 'unverified',
          detail: 'Could not be verified: azure responded 503',
        },
      ],
    };

    it('blocks submission when any check is not passed, and stores nothing', async () => {
      const { app, store } = await buildHarness({
        submissionGates: jest.fn(async () => BLOCKING),
      });
      const res = await request(app).post('/submit').send(submitBody());
      expect(res.status).toBe(412);
      expect(res.body.gates.checks[0].status).toBe('unverified');
      expect(await store.list()).toHaveLength(0);
    });

    it('fails closed when no gate evaluator is configured', async () => {
      const { app, store } = await buildHarness({ defaultGates: true });
      const res = await request(app).post('/submit').send(submitBody());
      expect(res.status).toBe(412);
      const unverified = res.body.gates.checks
        .filter((c: any) => c.status === 'unverified')
        .map((c: any) => c.id);
      expect(unverified).toEqual([
        'github_permissions',
        'cidr_repository',
        'cidr_azure',
        'compute_quota',
      ]);
      // prd is additionally off until explicitly enabled.
      expect(
        res.body.gates.checks.find((c: any) => c.id === 'production_enabled')
          .status,
      ).toBe('failed');
      expect(await store.list()).toHaveLength(0);
    });

    it('returns the gate report with the review preview', async () => {
      const submissionGates = jest.fn(async () => BLOCKING);
      const { app } = await buildHarness({ submissionGates });
      const res = await request(app).post('/plan').send(submitBody());
      expect(res.status).toBe(200);
      expect(res.body.gates.blocking).toBe(true);
      expect(submissionGates).toHaveBeenCalledWith(
        expect.objectContaining({ addressSpace: '10.230.0.0/16' }),
        ['Platform Team'],
      );
    });

    it('re-runs the gates at the final approval and blocks it without any Git operation', async () => {
      const submissionGates = jest.fn(async () => PASSING_GATES as any);
      const { app, store, jumpboxService, actAs } = await buildHarness({
        submissionGates,
      });
      const id = (await request(app).post('/submit').send(submitBody())).body
        .requestId;
      submissionGates.mockResolvedValueOnce(BLOCKING);
      actAs(ALICE);
      const res = await request(app).post(`/request/${id}/approve`).send({});
      expect(res.status).toBe(412);
      expect(jumpboxService.provisionAccess).not.toHaveBeenCalled();
      const stored = (await store.get(id))!;
      expect(stored.status).toBe('pending_approval');
      expect(stored.approvalChain[0].status).toBe('pending');
    });

    it('blocks an amendment that fails the gates', async () => {
      const submissionGates = jest.fn(async () => PASSING_GATES as any);
      const { app, store } = await buildHarness({ submissionGates });
      const id = (await request(app).post('/submit').send(submitBody())).body
        .requestId;
      submissionGates.mockResolvedValueOnce(BLOCKING);
      const res = await request(app)
        .post(`/request/${id}/amend`)
        .send(submitBody({ addressSpace: '10.231.0.0/16' }));
      expect(res.status).toBe(412);
      expect((await store.get(id))!.payload.addressSpace).toBe('10.230.0.0/16');
    });
  });

  describe('read authorization', () => {
    async function withPermissions(approvers: string[]) {
      const h = await buildHarness();
      h.permissions.authorize.mockImplementation(
        async (queries: unknown[], { credentials }: any) =>
          queries.map(() => ({
            result: approvers.includes(credentials.principal.userEntityRef)
              ? AuthorizeResult.ALLOW
              : AuthorizeResult.DENY,
          })),
      );
      return h;
    }

    it('limits request details to the requester and approvers', async () => {
      const h = await withPermissions([ALICE]);
      const id = (await request(h.app).post('/submit').send(submitBody())).body
        .requestId;

      for (const path of [
        `/request/${id}`,
        `/request/${id}/execution`,
        `/request/${id}/access-status`,
        `/request/${id}/pr-status`,
      ]) {
        h.actAs(BOB);
        expect((await request(h.app).get(path)).status).toBe(403);
      }
      h.actAs(BOB);
      expect(
        (await request(h.app).post(`/request/${id}/execution/refresh`)).status,
      ).toBe(403);

      h.actAs(REQUESTER);
      expect((await request(h.app).get(`/request/${id}`)).status).toBe(200);
      h.actAs(ALICE);
      expect((await request(h.app).get(`/request/${id}`)).status).toBe(200);
    });

    it('lists only the caller’s own requests unless they are an approver', async () => {
      const h = await withPermissions([ALICE]);
      await request(h.app).post('/submit').send(submitBody());
      h.actAs(BOB);
      await request(h.app)
        .post('/submit')
        .send(
          submitBody({ tenantId: 'globex', addressSpace: '10.231.0.0/16' }),
        );

      h.actAs(BOB);
      let res = await request(h.app).get('/requests');
      expect(res.body.requests.map((r: any) => r.requestor)).toEqual([BOB]);
      h.actAs(ALICE);
      res = await request(h.app).get('/requests');
      expect(res.body.requests).toHaveLength(2);
    });

    it('keeps the error message when a response also carries the request', async () => {
      const h = await buildHarness();
      const id = (await request(h.app).post('/submit').send(submitBody())).body
        .requestId;
      // Postgres rows always carry an `error` key (undefined when unset),
      // which must not erase the response message.
      const stored = (await h.store.get(id))!;
      stored.error = undefined;
      await h.store.save(stored);
      const res = await request(h.app).post(`/request/${id}/approve`).send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'Requesters cannot approve their own infrastructure request',
      );
      h.actAs(ALICE);
      const amend = await request(h.app)
        .post(`/request/${id}/amend`)
        .send(submitBody());
      expect(amend.status).toBe(403);
      expect(amend.body.error).toBe(
        'Only the requester can amend this request',
      );
    });

    it('requires an authenticated user to read requests', async () => {
      const h = await buildHarness();
      h.httpAuth.credentials.mockRejectedValue(new Error('no token'));
      expect((await request(h.app).get('/requests')).status).toBe(401);
    });
  });

  describe('execution tracking routes', () => {
    it('no longer infers provisioning from a merge without a tracker', async () => {
      const { app, store, actAs } = await buildHarness({
        tailscaleMerged: true,
      });
      const id = (await request(app).post('/submit').send(submitBody())).body
        .requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      await request(app).post(`/request/${id}/infrastructure-pr`).send({});
      const res = await request(app).get(`/request/${id}/pr-status`);
      expect(res.status).toBe(409);
      expect((await store.get(id))!.status).toBe('awaiting_pr_merge');
      const refresh = await request(app).post(
        `/request/${id}/execution/refresh`,
      );
      expect(refresh.status).toBe(503);
    });

    it('tracks a submitted request from PR to awaiting operator apply through the routes, reading only', async () => {
      const state = emptyFakeState();
      const apis = createFakeExternalApis(state);
      const { app, store, actAs, createPullRequest } = await buildHarness({
        tailscaleMerged: true,
        makeTracker: s =>
          new AksExecutionTracker({
            store: s,
            logger: makeLogger(),
            github: GithubReader.create({ token: 'gh', fetchImpl: apis.fetch }),
            tfc: TerraformCloudReader.create({
              token: 'tfc',
              fetchImpl: apis.fetch,
            }),
            infraRepository: 'SymphonySensa/scp-infra-as-code',
            workspacesFile: 'workspacemanager/workspaces.tfvars',
            baseBranch: 'main',
            minRefreshIntervalMs: 0,
          }),
      });
      const id = (await request(app).post('/submit').send(submitBody())).body
        .requestId;
      actAs(ALICE);
      await request(app).post(`/request/${id}/approve`).send({});
      await request(app).post(`/request/${id}/infrastructure-pr`).send({});
      expect(createPullRequest).toHaveBeenCalledTimes(1);
      const stored = (await store.get(id))!;
      expect(stored.prRepository).toBe('SymphonySensa/scp-infra-as-code');
      const cluster = stored.clusterName;

      // Open, approved, Quality Gate passed.
      state.pulls[42] = { state: 'open', merged: false, headSha: 'h1' };
      state.reviewDecision[42] = 'APPROVED';
      state.checkRuns.h1 = [{ status: 'completed', conclusion: 'success' }];
      let res = await request(app).post(`/request/${id}/execution/refresh`);
      expect(res.body.execution.phase).toBe('awaiting_merge');
      expect(res.body.requestStatus).toBe('awaiting_pr_merge');

      // Merged; workspacemanager applied; workspace + first run planned.
      state.pulls[42] = {
        state: 'closed',
        merged: true,
        mergedAt: '2026-10-13T10:00:00Z',
        mergeCommitSha: 'm1',
        headSha: 'h1',
      };
      state.files[
        `m1:workspacemanager/workspaces.tfvars`
      ] = `workspaces = {\n  "azure-kubernetes-service-standard" = {\n    "${cluster}" = {}\n  }\n}\n`;
      state.files[
        `m1:azure-kubernetes-service-standard/values/${cluster}.tfvars`
      ] = 'x';
      state.workspaces.workspacemanager = {
        id: 'ws-wsm',
        name: 'workspacemanager',
        createdAt: '2025-01-01T00:00:00Z',
        projectName: 'SCP-TERRAFORM-ADMINISTRATION',
        workingDirectory: 'workspacemanager',
        vcsRepo: 'SymphonySensa/scp-infra-as-code',
        vcsBranch: 'main',
      };
      state.runs['ws-wsm'] = [
        {
          id: 'run-wsm',
          status: 'applied',
          createdAt: '2026-10-13T10:01:00Z',
          commitSha: 'm1',
        },
      ];
      state.workspaces[cluster] = {
        id: 'ws-c',
        name: cluster,
        createdAt: '2026-10-13T10:05:00Z',
        projectName: 'SCP-PRD-AKS',
        workingDirectory: 'azure-kubernetes-service-standard',
        vcsRepo: 'SymphonySensa/scp-infra-as-code',
        vcsBranch: 'main',
      };
      state.runs['ws-c'] = [
        {
          id: 'run-c',
          status: 'planned',
          confirmable: true,
          createdAt: '2026-10-13T10:05:10Z',
        },
      ];
      // GET pr-status shows stored state only; refreshing is an explicit POST.
      const storedOnly = await request(app).get(`/request/${id}/pr-status`);
      expect(storedOnly.body.merged).toBe(false);
      await request(app).post(`/request/${id}/execution/refresh`);
      res = await request(app).get(`/request/${id}/pr-status`);
      expect(res.status).toBe(200);
      expect(res.body.merged).toBe(true);
      expect(res.body.execution.phase).toBe('awaiting_operator_apply');
      expect(res.body.requestStatus).toBe('provisioning');
      expect(res.body.freshness).toBe('current');

      res = await request(app).get(`/request/${id}/execution`);
      expect(res.body.execution.run.url).toBe(
        `https://app.terraform.io/app/sensa-cloud-platform/workspaces/${cluster}/runs/run-c`,
      );
      assertReadOnly(apis.calls);
    });
  });

  describe('legacy requests', () => {
    async function seedLegacy(store: InfrastructureRequestStore) {
      const now = new Date();
      await store.create({
        requestId: 'INFRA-LEGACY',
        requestor: 'Jane Doe',
        customer: 'Contoso',
        environment: 'prod',
        subscription: '',
        clusterName: 'aks-contoso-prod-eus',
        clusterProfile: 'single-region',
        regions: 'eastus',
        nodeSize: '',
        kubernetesVersion: '',
        estimatedMonthlyCost: 0,
        planSummary: {} as any,
        status: 'awaiting_pr_merge',
        approvalChain: [],
        createdAt: now,
        updatedAt: now,
        logs: [],
        payload: { customer: 'Contoso' } as any,
        clusterAdministrators: [],
        prNumber: 9,
        prUrl: 'https://github.com/jubermohamad/platform_cloudhub/pull/9',
        claimClusterName: 'aks-contoso-prod-eus',
      });
    }

    it('lists legacy requests for approvers only', async () => {
      const h = await buildHarness();
      await seedLegacy(h.store);
      h.actAs(ALICE);
      const res = await request(h.app).get('/legacy-requests');
      expect(res.body.requests).toEqual([
        expect.objectContaining({
          requestId: 'INFRA-LEGACY',
          prUrl: 'https://github.com/jubermohamad/platform_cloudhub/pull/9',
        }),
      ]);
      h.permissions.authorize.mockResolvedValue([
        { result: AuthorizeResult.DENY },
        { result: AuthorizeResult.DENY },
        { result: AuthorizeResult.DENY },
      ]);
      expect((await request(h.app).get('/legacy-requests')).status).toBe(403);
    });

    it('retires a legacy request inside CloudHub without touching external systems', async () => {
      const h = await buildHarness();
      await seedLegacy(h.store);
      h.actAs(ALICE);
      const res = await request(h.app)
        .post('/request/INFRA-LEGACY/retire-legacy')
        .send({ reason: 'superseded' });
      expect(res.status).toBe(200);
      const stored = (await h.store.get('INFRA-LEGACY'))!;
      expect(stored.status).toBe('rejected');
      expect(stored.claimClusterName).toBeNull();
      expect(stored.logs.join('\n')).toContain("(was 'awaiting_pr_merge')");
      expect(stored.logs.join('\n')).toContain('close manually');
      expect(h.jumpboxService.provisionAccess).not.toHaveBeenCalled();
      expect(h.createPullRequest).not.toHaveBeenCalled();
    });

    it('refuses to retire a current request and never tracks a legacy PR number', async () => {
      const h = await buildHarness({
        makeTracker: s =>
          new AksExecutionTracker({
            store: s,
            logger: makeLogger(),
            github: null,
            tfc: null,
            infraRepository: 'SymphonySensa/scp-infra-as-code',
            workspacesFile: 'workspacemanager/workspaces.tfvars',
            baseBranch: 'main',
          }),
      });
      await seedLegacy(h.store);
      const id = (await request(h.app).post('/submit').send(submitBody())).body
        .requestId;
      h.actAs(ALICE);
      expect(
        (await request(h.app).post(`/request/${id}/retire-legacy`).send({}))
          .status,
      ).toBe(409);
      const res = await request(h.app).get('/request/INFRA-LEGACY/pr-status');
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Legacy request/);
      expect(res.body.trackable).toBe(false);
    });
  });

  describe('Generic Workflow API and Lifecycle', () => {
    it('creates draft request, validates, submits, and tracks events', async () => {
      const h = await buildHarness();
      h.actAs(REQUESTER);

      // Create draft
      const draftRes = await request(h.app)
        .post('/requests')
        .send({ draft: true, customer: 'Contoso', env: 'dev' });
      expect(draftRes.status).toBe(201);
      expect(draftRes.body.status).toBe('DRAFT');
      expect(draftRes.body.workflowState).toBe('DRAFT');
      const requestId = draftRes.body.requestId;

      // Validate
      const valRes = await request(h.app)
        .post(`/requests/${requestId}/validate`)
        .send(submitBody());
      expect(valRes.status).toBe(200);
      expect(valRes.body.valid).toBe(true);

      // Submit draft
      const submitRes = await request(h.app)
        .post(`/requests/${requestId}/submit`)
        .send(submitBody());
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.status).toBe('pending_approval');
      expect(submitRes.body.workflowState).toBe('PENDING_APPROVAL');

      // Approvals route
      h.actAs(ALICE);
      const approveRes = await request(h.app)
        .post(`/requests/${requestId}/approvals`)
        .send({ decision: 'approve' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('awaiting_tailscale_merge');

      // Events endpoint
      const eventsRes = await request(h.app).get(`/requests/${requestId}/events`);
      expect(eventsRes.status).toBe(200);
      expect(eventsRes.body.events.length).toBeGreaterThanOrEqual(3);
      expect(
        eventsRes.body.events.some(
          (e: { eventType: string }) => e.eventType === 'draft_created',
        ),
      ).toBe(true);
      expect(
        eventsRes.body.events.some(
          (e: { eventType: string }) => e.eventType === 'approval_granted',
        ),
      ).toBe(true);

      // Addon deployment pre-check
      const addonRes = await request(h.app)
        .post(`/requests/${requestId}/addons/deploy`)
        .send({ addon: 'common-res' });
      expect(addonRes.status).toBe(400); // Blocked because infra is not yet ready

      // Operational verification endpoint
      const verifyRes = await request(h.app)
        .post(`/requests/${requestId}/verify`)
        .send({});
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.readiness).toBeDefined();
      expect(verifyRes.body.readiness.infrastructureReady).toBe(false);

      // Cancellation endpoint
      const cancelRes = await request(h.app)
        .post(`/requests/${requestId}/cancel`)
        .send({});
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCEL_REQUESTED');
    });
  });
});
