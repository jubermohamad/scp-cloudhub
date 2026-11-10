import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  AKS_FLAVOR_POOLS,
  normalizeAksClusterRequest,
} from '@internal/plugin-platform-common/backend';
import {
  InfrastructureRequestStore,
  type InfrastructureRequest,
} from '../services/InfrastructureRequestStore';
import { AksExecutionTracker } from '../services/AksExecutionTracker';
import {
  GithubReader,
  TerraformCloudReader,
} from '../services/aksExternalReaders';
import { executionFreshness } from '../services/aksExecutionStatus';
import {
  assertReadOnly,
  createFakeExternalApis,
  emptyFakeState,
  type FakeState,
  type FakeTfcRun,
} from '../test-utils/fakeAksExternalApis';

const REPO = 'SymphonySensa/scp-infra-as-code';
const CLUSTER = 'aks-scp-dev-ae-st-contoso';
const VALUES = `azure-kubernetes-service-standard/values/${CLUSTER}.tfvars`;
const WORKSPACES = 'workspacemanager/workspaces.tfvars';
const MERGE_SHA = 'merge42sha';
const HEAD_SHA = 'head42sha';

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

function payload(env = 'dev') {
  return normalizeAksClusterRequest({
    customer: 'Contoso',
    businessUnit: 'Retail',
    owner: 'owner@contoso.com',
    costCentre: 'P64358',
    changeTicket: 'SCP-1234',
    clusterProfile: 'single-region',
    env,
    location: 'australiaeast',
    tenancy: 'st',
    tenantId: 'contoso',
    kubernetesVersion: '1.36.2',
    addressSpace: '10.230.0.0/16',
    ...AKS_FLAVOR_POOLS.small,
  });
}

function record(
  overrides: Partial<InfrastructureRequest> = {},
): InfrastructureRequest {
  const now = new Date('2026-10-13T09:00:00Z');
  return {
    requestId: 'INFRA-T1',
    requestor: 'user:default/requester',
    customer: 'Contoso',
    environment: 'dev',
    subscription: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
    clusterName: CLUSTER,
    clusterProfile: 'single-region',
    regions: 'australiaeast',
    nodeSize: 'Standard_B2s',
    kubernetesVersion: '1.36.2',
    estimatedMonthlyCost: 0,
    planSummary: {
      resourcesToCreate: 0,
      resourcesToModify: 0,
      resourcesToDestroy: 0,
      monthlyCost: 0,
      errors: [],
      warnings: [],
    },
    status: 'awaiting_pr_merge',
    approvalChain: [
      {
        role: 'Platform Team',
        status: 'approved',
        approver: 'user:default/alice',
      },
    ],
    createdAt: now,
    updatedAt: now,
    logs: [],
    payload: payload(),
    clusterAdministrators: ['octocat'],
    configFingerprint: 'sha256:approved',
    claimClusterName: CLUSTER,
    claimAddressSpace: '10.230.0.0/16',
    prNumber: 42,
    prUrl: `https://github.com/${REPO}/pull/42`,
    prRepository: REPO,
    ...overrides,
  } as InfrastructureRequest;
}

const WORKSPACES_FILE_CONTENT = (entry: string) => `workspaces = {
  "azure-kubernetes-service-standard" = {
    "aks-scp-prd-cnc-st-manu" = {}
    ${entry}
  }
}
`;

function openPr(
  state: FakeState,
  opts: {
    gate?: [string, string | null] | null;
    decision?: string | null;
  } = {},
) {
  state.pulls[42] = { state: 'open', merged: false, headSha: HEAD_SHA };
  state.reviewDecision[42] = opts.decision ?? 'REVIEW_REQUIRED';
  state.checkRuns[HEAD_SHA] =
    opts.gate === null
      ? []
      : [
          {
            status: opts.gate?.[0] ?? 'completed',
            conclusion: opts.gate?.[1] ?? 'success',
          },
        ];
}

function mergePr(state: FakeState, entry = `"${CLUSTER}" = {}`) {
  state.pulls[42] = {
    state: 'closed',
    merged: true,
    mergedAt: '2026-10-13T10:00:00Z',
    mergeCommitSha: MERGE_SHA,
    headSha: HEAD_SHA,
  };
  state.reviewDecision[42] = 'APPROVED';
  state.checkRuns[HEAD_SHA] = [{ status: 'completed', conclusion: 'success' }];
  state.files[`${MERGE_SHA}:${WORKSPACES}`] = WORKSPACES_FILE_CONTENT(entry);
  state.files[`${MERGE_SHA}:${VALUES}`] = 'kubernetes_version = "1.36.2"\n';
  state.workspaces.workspacemanager = {
    id: 'ws-wsm',
    name: 'workspacemanager',
    createdAt: '2025-01-01T00:00:00Z',
    projectName: 'SCP-TERRAFORM-ADMINISTRATION',
    workingDirectory: 'workspacemanager',
    vcsRepo: REPO,
    vcsBranch: 'main',
  };
}

function wsmRun(
  state: FakeState,
  run: Partial<FakeTfcRun> & { status: string },
) {
  state.runs['ws-wsm'] = [
    {
      id: 'run-wsm-1',
      createdAt: '2026-10-13T10:01:00Z',
      commitSha: MERGE_SHA,
      ...run,
    },
  ];
}

function createWorkspace(
  state: FakeState,
  overrides: Record<string, unknown> = {},
) {
  state.workspaces[CLUSTER] = {
    id: 'ws-cluster',
    name: CLUSTER,
    createdAt: '2026-10-13T10:05:00Z',
    projectName: 'SCP-DEV-AKS',
    workingDirectory: 'azure-kubernetes-service-standard',
    vcsRepo: REPO,
    vcsBranch: '',
    ...overrides,
  };
}

function clusterRun(
  state: FakeState,
  run: Partial<FakeTfcRun> & { status: string },
) {
  const runs = state.runs['ws-cluster'] ?? [];
  const id = run.id ?? 'run-c-1';
  state.runs['ws-cluster'] = [
    ...runs.filter(r => r.id !== id),
    { id, createdAt: '2026-10-13T10:05:30Z', commitSha: MERGE_SHA, ...run },
  ];
}

async function harness(
  opts: { tfc?: boolean; github?: boolean; timeoutMs?: number } = {},
) {
  const state = emptyFakeState();
  const apis = createFakeExternalApis(state);
  const store = new InfrastructureRequestStore(makeLogger(), null);
  await store.init();
  let clock = new Date('2026-10-13T11:00:00Z');
  const make = () =>
    new AksExecutionTracker({
      store,
      logger: makeLogger(),
      github:
        opts.github === false
          ? null
          : GithubReader.create({
              token: 'gh',
              fetchImpl: apis.fetch,
              timeoutMs: opts.timeoutMs,
            }),
      tfc:
        opts.tfc === false
          ? null
          : TerraformCloudReader.create({
              token: 'tfc',
              fetchImpl: apis.fetch,
              timeoutMs: opts.timeoutMs,
            }),
      infraRepository: REPO,
      workspacesFile: WORKSPACES,
      baseBranch: 'main',
      now: () => clock,
      minRefreshIntervalMs: 0,
    });
  const tracker = make();
  const tick = (ms = 60_000) => {
    clock = new Date(clock.getTime() + ms);
  };
  const refresh = async (t = tracker) => {
    tick();
    const result = await t.refresh('INFRA-T1');
    return result.record!;
  };
  return { state, apis, store, tracker, make, refresh, tick, now: () => clock };
}

describe('AksExecutionTracker', () => {
  describe('pull request review and merge', () => {
    it('tracks Quality Gate and CODEOWNERS review without inferring progress', async () => {
      const h = await harness();
      await h.store.create(record());

      openPr(h.state, { gate: ['in_progress', null] });
      let r = await h.refresh();
      expect(r.execution!.phase).toBe('pr_checks_pending');
      expect(r.status).toBe('awaiting_pr_merge');

      openPr(h.state, {
        gate: ['completed', 'success'],
        decision: 'REVIEW_REQUIRED',
      });
      r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_review');

      h.state.reviews[42] = [{ login: 'reviewer', state: 'CHANGES_REQUESTED' }];
      openPr(h.state, { decision: 'CHANGES_REQUESTED' });
      r = await h.refresh();
      expect(r.execution!.phase).toBe('changes_requested');
      expect(r.execution!.detail).toContain('reviewer');

      h.state.reviews[42] = [
        { login: 'reviewer', state: 'CHANGES_REQUESTED' },
        { login: 'reviewer', state: 'APPROVED' },
      ];
      openPr(h.state, { decision: 'APPROVED' });
      r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_merge');
      expect(r.execution!.pullRequest!.approvedBy).toEqual(['reviewer']);
      expect(r.status).toBe('awaiting_pr_merge');
    });

    it('reports a failed Quality Gate and ignores look-alike checks from other apps', async () => {
      const h = await harness();
      await h.store.create(record());
      openPr(h.state, { decision: 'APPROVED' });
      h.state.checkRuns[HEAD_SHA] = [
        { status: 'completed', conclusion: 'failure', appId: 15368 },
        {
          status: 'completed',
          conclusion: 'success',
          appId: 999,
          startedAt: '2026-10-13T01:00:00Z',
        },
      ];
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('quality_gate_failed');
      expect(r.execution!.pullRequest!.qualityGate.conclusion).toBe('failure');
    });

    it('treats a merge as merged only, never as provisioned', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('pr_merged');
      expect(r.status).toBe('provisioning');
      expect(r.execution!.mapping).toMatchObject({
        workspacesFileHasEntry: true,
        valuesFilePresent: true,
        expectedProject: 'SCP-DEV-AKS',
      });
      expect(r.execution!.outputs).toBeNull();
    });

    it('fails the request and releases its claims when the PR is closed unmerged', async () => {
      const h = await harness();
      await h.store.create(record());
      h.state.pulls[42] = { state: 'closed', merged: false, headSha: HEAD_SHA };
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('pr_closed');
      expect(r.status).toBe('failed');
      expect(r.claimClusterName).toBeNull();
      expect(r.claimAddressSpace).toBeNull();
    });

    it('flags a merged commit that no longer registers the workspace', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state, '"aks-scp-dev-ae-st-other" = {}');
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('workspace_mapping_mismatch');
    });
  });

  describe('workspace creation', () => {
    it.each([
      ['planning', false, 'workspace_creation_pending'],
      ['planned', true, 'workspace_creation_pending'],
      ['applying', false, 'workspace_creation_pending'],
      ['errored', false, 'workspace_creation_failed'],
      ['discarded', false, 'workspace_creation_failed'],
      ['applied', false, 'workspace_creation_failed'],
    ])(
      'workspacemanager run %s (confirmable=%s) → %s while the workspace is absent',
      async (status, confirmable, phase) => {
        const h = await harness();
        await h.store.create(record());
        mergePr(h.state);
        wsmRun(h.state, { status, confirmable });
        const r = await h.refresh();
        expect(r.execution!.phase).toBe(phase);
        expect(r.execution!.workspaceManagerRun).toMatchObject({
          id: 'run-wsm-1',
          matchedBy: 'merge_commit',
        });
      },
    );

    it('checks the workspace against the project derived from its name, not the request env label', async () => {
      const h = await harness();
      // Request labelled prd but the workspace name (and so workspacemanager) says dev.
      await h.store.create(record({ environment: 'prd' }));
      mergePr(h.state);
      createWorkspace(h.state, { projectName: 'SCP-PRD-AKS' });
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('workspace_mapping_mismatch');
      expect(r.execution!.workspace!.mismatches[0]).toContain(
        'project is SCP-PRD-AKS, expected SCP-DEV-AKS',
      );
    });

    it('honours a project_name_override added to the merged entry', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(
        h.state,
        `"${CLUSTER}" = {\n      project_name_override = "SCP-PRD-INFRASTRUCTURE"\n    }`,
      );
      createWorkspace(h.state, { projectName: 'SCP-PRD-INFRASTRUCTURE' });
      const r = await h.refresh();
      expect(r.execution!.mapping!.expectedProject).toBe(
        'SCP-PRD-INFRASTRUCTURE',
      );
      expect(r.execution!.phase).toBe('plan_pending');
    });

    it('flags a workspace with auto-apply or a non-main branch', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state, { autoApply: true, vcsBranch: 'feature/x' });
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('workspace_mapping_mismatch');
      expect(r.execution!.workspace!.mismatches.join(' ')).toMatch(
        /auto-apply/,
      );
      expect(r.execution!.workspace!.mismatches.join(' ')).toMatch(
        /feature\/x/,
      );
    });

    it('keeps the last verified phase and reports staleness when the workspace lookup fails', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, { status: 'planned', confirmable: true });
      let r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_operator_apply');

      h.state.fail = url =>
        url.includes('app.terraform.io') ? 503 : undefined;
      r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_operator_apply');
      expect(r.execution!.refresh.error).toMatchObject({
        service: 'terraform-cloud',
        kind: 'unavailable',
      });
      expect(executionFreshness(r.execution, h.now()).freshness).toBe('stale');
    });

    it('reports a workspace that disappears instead of regressing', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      await h.refresh();
      delete h.state.workspaces[CLUSTER];
      const r = await h.refresh();
      expect(r.execution!.workspace).not.toBeNull();
      expect(r.execution!.refresh.error!.message).toMatch(/no longer found/);
    });
  });

  describe('cluster run and operator apply', () => {
    it('follows plan → operator decision → apply → outputs, and only then reports success', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      wsmRun(h.state, { status: 'applied' });
      createWorkspace(h.state);

      clusterRun(h.state, { status: 'planning' });
      let r = await h.refresh();
      expect(r.execution!.phase).toBe('plan_pending');

      clusterRun(h.state, {
        status: 'planned',
        confirmable: true,
        plan: { status: 'finished', add: 57, change: 0, destroy: 0 },
      });
      r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_operator_apply');
      expect(r.execution!.run!.plan).toMatchObject({ additions: 57 });
      expect(r.status).toBe('provisioning');

      clusterRun(h.state, {
        status: 'applying',
        timestamps: {
          'confirmed-at': '2026-10-13T10:20:00Z',
          'applying-at': '2026-10-13T10:20:05Z',
        },
      });
      r = await h.refresh();
      expect(r.execution!.phase).toBe('apply_running');

      clusterRun(h.state, {
        status: 'applied',
        timestamps: {
          'confirmed-at': '2026-10-13T10:20:00Z',
          'applied-at': '2026-10-13T10:40:00Z',
        },
        apply: { status: 'finished', add: 57, change: 0, destroy: 0 },
      });
      r = await h.refresh();
      // Applied, but no state outputs yet: not reported as complete.
      expect(r.execution!.phase).toBe('apply_succeeded');
      expect(r.status).toBe('provisioning');

      h.state.stateVersions['ws-cluster'] = {
        id: 'sv-1',
        createdAt: '2026-10-13T10:40:01Z',
        runId: 'run-c-1',
      };
      h.state.outputs['ws-cluster'] = [
        {
          name: 'aks_cluster_id',
          sensitive: false,
          value: '/subscriptions/x/aks',
        },
        { name: 'cluster_fqdn', sensitive: false, value: 'aks.example' },
        {
          name: 'kube_config',
          sensitive: true,
          value: 'TOP-SECRET-KUBECONFIG',
        },
        { name: 'cmk_storageclass_logs', sensitive: false, value: 'noise' },
      ];
      r = await h.refresh();
      expect(r.execution!.phase).toBe('outputs_available');
      expect(r.status).toBe('infrastructure_ready');
      expect(r.execution!.outputs!.values).toEqual({
        aks_cluster_id: '/subscriptions/x/aks',
        cluster_fqdn: 'aks.example',
      });
      expect(r.execution!.outputs!.omitted).toEqual([
        'cmk_storageclass_logs',
        'kube_config',
      ]);
      expect(JSON.stringify(await h.store.get('INFRA-T1'))).not.toContain(
        'TOP-SECRET',
      );

      // Tracking stops once the request is infrastructure_ready.
      const calls = h.apis.calls.length;
      const after = await h.tracker.refresh('INFRA-T1', { force: true });
      expect(after.refreshed).toBe(false);
      expect(h.apis.calls.length).toBe(calls);
      assertReadOnly(h.apis.calls);
    });

    it.each([
      ['errored', {}, 'plan_failed'],
      ['canceled', {}, 'plan_cancelled'],
      ['planned_and_finished', {}, 'plan_no_changes'],
      ['errored', { 'confirmed-at': 't', 'applying-at': 't' }, 'apply_failed'],
      ['canceled', { 'confirmed-at': 't' }, 'apply_cancelled'],
      ['force_canceled', { 'applying-at': 't' }, 'apply_cancelled'],
      ['discarded', {}, 'apply_discarded'],
    ])('run %s %j → %s', async (status, timestamps, phase) => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, { status, timestamps });
      const r = await h.refresh();
      expect(r.execution!.phase).toBe(phase);
      expect(r.status).toBe('provisioning');
    });

    it('follows an operator retry after a failed run', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, {
        id: 'run-c-1',
        status: 'errored',
        timestamps: { 'applying-at': 't' },
      });
      let r = await h.refresh();
      expect(r.execution!.phase).toBe('apply_failed');

      clusterRun(h.state, {
        id: 'run-c-2',
        createdAt: '2026-10-13T12:00:00Z',
        status: 'planned',
        confirmable: true,
      });
      r = await h.refresh();
      expect(r.execution!.run!.id).toBe('run-c-2');
      expect(r.execution!.phase).toBe('awaiting_operator_apply');
    });

    it('ignores speculative and destroy runs', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, {
        id: 'run-plan-only',
        status: 'planned_and_finished',
        planOnly: true,
      });
      clusterRun(h.state, {
        id: 'run-destroy',
        status: 'planned',
        confirmable: true,
        isDestroy: true,
      });
      const r = await h.refresh();
      expect(r.execution!.run).toBeNull();
      expect(r.execution!.phase).toBe('plan_pending');
    });
  });

  describe('outputs (least privilege)', () => {
    it('reads outputs without fetching the state version, and only for the current run', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, {
        id: 'run-c-1',
        status: 'applied',
        timestamps: { 'applied-at': '2026-10-13T10:40:00Z' },
      });
      h.state.stateVersions['ws-cluster'] = {
        id: 'sv-1',
        createdAt: '2026-10-13T10:40:01Z',
        runId: 'run-c-1',
      };
      h.state.outputs['ws-cluster'] = [
        { name: 'aks_cluster_id', sensitive: false, value: 'id' },
      ];
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('outputs_available');
      expect(r.execution!.outputs).toMatchObject({
        stateVersionId: 'sv-1',
        runId: 'run-c-1',
      });
      // "Read state outputs" only: the state version itself is never fetched.
      expect(
        h.apis.calls.some(c =>
          new URL(c.url).pathname.endsWith('/current-state-version'),
        ),
      ).toBe(false);
    });

    it('does not credit outputs read while another run is current', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, {
        id: 'run-c-1',
        status: 'applied',
        timestamps: { 'applied-at': '2026-10-13T10:40:00Z' },
      });
      // A newer (destroy) run is now the workspace's current run.
      clusterRun(h.state, {
        id: 'run-destroy',
        createdAt: '2026-10-13T11:30:00Z',
        status: 'planning',
        isDestroy: true,
      });
      h.state.stateVersions['ws-cluster'] = {
        id: 'sv-1',
        createdAt: '2026-10-13T10:40:01Z',
        runId: 'run-c-1',
      };
      h.state.outputs['ws-cluster'] = [
        { name: 'aks_cluster_id', sensitive: false, value: 'id' },
      ];
      const r = await h.refresh();
      expect(r.execution!.run!.id).toBe('run-c-1');
      expect(r.execution!.phase).toBe('apply_succeeded');
    });
  });

  describe('idempotency and ordering', () => {
    it('logs a phase once however often it is polled', async () => {
      const h = await harness();
      await h.store.create(record());
      openPr(h.state);
      for (let i = 0; i < 4; i++) await h.refresh();
      const r = (await h.store.get('INFRA-T1'))!;
      expect(r.execution!.history).toHaveLength(1);
      expect(
        r.logs.filter(l => l.includes('Infrastructure: awaiting_review')),
      ).toHaveLength(1);
    });

    it('never lets a stale observation of the same run move it backwards', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, {
        status: 'applying',
        timestamps: { 'applying-at': 't' },
      });
      await h.refresh();
      // A lagging replica reports the earlier status of the same run.
      clusterRun(h.state, { status: 'planned', confirmable: true });
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('apply_running');
      expect(r.execution!.run!.status).toBe('applying');
    });

    it('never replaces the tracked run with an older one', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      createWorkspace(h.state);
      clusterRun(h.state, {
        id: 'run-new',
        createdAt: '2026-10-13T12:00:00Z',
        status: 'planning',
      });
      await h.refresh();
      h.state.runs['ws-cluster'] = [
        { id: 'run-old', createdAt: '2026-10-13T10:06:00Z', status: 'errored' },
      ];
      const r = await h.refresh();
      expect(r.execution!.run!.id).toBe('run-new');
    });

    it('does not re-read a merged PR, so a stale replica cannot reopen it', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      await h.refresh();
      h.state.pulls[42] = { state: 'open', merged: false, headSha: HEAD_SHA };
      const r = await h.refresh();
      expect(r.execution!.pullRequest!.merged).toBe(true);
      expect(r.execution!.phase).toBe('pr_merged');
    });

    it('shares one refresh between concurrent callers', async () => {
      const h = await harness();
      await h.store.create(record());
      openPr(h.state);
      h.tick();
      await Promise.all([
        h.tracker.refresh('INFRA-T1'),
        h.tracker.refresh('INFRA-T1'),
        h.tracker.refresh('INFRA-T1'),
      ]);
      expect(
        h.apis.calls.filter(c => c.url.endsWith('/pulls/42')),
      ).toHaveLength(1);
    });

    it('lets only one of two concurrent tracker instances persist a transition', async () => {
      const h = await harness();
      await h.store.create(record());
      openPr(h.state);
      h.tick();
      const [a, b] = await Promise.all([
        h.tracker.refresh('INFRA-T1'),
        h.make().refresh('INFRA-T1'),
      ]);
      expect([a.refreshed, b.refreshed].sort()).toEqual([false, true]);
      const r = (await h.store.get('INFRA-T1'))!;
      expect(r.logs.filter(l => l.includes('Infrastructure:'))).toHaveLength(1);
    });

    it('throttles polls inside the minimum interval', async () => {
      const h = await harness();
      await h.store.create(record());
      openPr(h.state);
      const tracker = new AksExecutionTracker({
        store: h.store,
        logger: makeLogger(),
        github: GithubReader.create({ token: 'gh', fetchImpl: h.apis.fetch }),
        tfc: null,
        infraRepository: REPO,
        workspacesFile: WORKSPACES,
        baseBranch: 'main',
        now: h.now,
        minRefreshIntervalMs: 30_000,
      });
      await tracker.refresh('INFRA-T1');
      const calls = h.apis.calls.length;
      const second = await tracker.refresh('INFRA-T1');
      expect(second).toMatchObject({ refreshed: false, reason: 'throttled' });
      expect(h.apis.calls.length).toBe(calls);
    });
  });

  describe('unavailable services', () => {
    it('times out, keeps the last verified status and marks it stale', async () => {
      const h = await harness({ timeoutMs: 20 });
      await h.store.create(record());
      openPr(h.state, { decision: 'APPROVED' });
      let r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_merge');

      h.state.fail = () => 'timeout';
      r = await h.refresh();
      expect(r.execution!.phase).toBe('awaiting_merge');
      expect(r.execution!.refresh.error).toMatchObject({
        service: 'github',
        kind: 'timeout',
      });
      const freshness = executionFreshness(r.execution, h.now());
      expect(freshness.freshness).toBe('stale');
      expect(freshness.reason).toMatch(/Cannot refresh/);
    });

    it('reports unknown (never verified) when the first read fails', async () => {
      const h = await harness();
      await h.store.create(record());
      h.state.fail = () => 'network';
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('unknown');
      expect(r.status).toBe('awaiting_pr_merge');
      expect(executionFreshness(r.execution, h.now()).freshness).toBe(
        'never_verified',
      );
    });

    it('records a missing Terraform Cloud token as an error, not as progress', async () => {
      const h = await harness({ tfc: false });
      await h.store.create(record());
      mergePr(h.state);
      const r = await h.refresh();
      expect(r.execution!.phase).toBe('pr_merged');
      expect(r.execution!.refresh.error).toMatchObject({
        kind: 'not_configured',
      });
    });
  });

  describe('restart recovery', () => {
    it('resumes from persisted state in a fresh tracker instance', async () => {
      const h = await harness();
      await h.store.create(record());
      mergePr(h.state);
      wsmRun(h.state, { status: 'applied' });
      createWorkspace(h.state);
      clusterRun(h.state, { status: 'planned', confirmable: true });
      await h.refresh();

      // "Restart": a new tracker with no in-memory state, same store.
      clusterRun(h.state, {
        status: 'applied',
        timestamps: { 'applied-at': '2026-10-13T10:40:00Z' },
      });
      h.state.stateVersions['ws-cluster'] = {
        id: 'sv-1',
        createdAt: '2026-10-13T10:40:01Z',
        runId: 'run-c-1',
      };
      h.state.outputs['ws-cluster'] = [
        { name: 'aks_cluster_id', sensitive: false, value: 'id' },
      ];
      const before = h.apis.calls.length;
      h.tick();
      const summary = await h.make().refreshAll();
      expect(summary).toMatchObject({ checked: 1, refreshed: 1, errors: 0 });
      const r = (await h.store.get('INFRA-T1'))!;
      expect(r.execution!.phase).toBe('outputs_available');
      // The merged PR and the pinned workspacemanager run are not re-discovered.
      const resumed = h.apis.calls.slice(before);
      expect(resumed.some(c => c.url.endsWith('/pulls/42'))).toBe(false);
      expect(resumed.some(c => c.url.includes('/workspaces/ws-wsm/runs'))).toBe(
        false,
      );
    });
  });

  describe('execution boundary', () => {
    it('only ever reads from GitHub and Terraform Cloud across the whole lifecycle', async () => {
      const h = await harness();
      await h.store.create(record());
      openPr(h.state, { gate: ['in_progress', null] });
      await h.refresh();
      openPr(h.state, { decision: 'APPROVED' });
      await h.refresh();
      mergePr(h.state);
      wsmRun(h.state, { status: 'planned', confirmable: true });
      await h.refresh();
      wsmRun(h.state, { status: 'applied' });
      createWorkspace(h.state);
      clusterRun(h.state, { status: 'planned', confirmable: true });
      await h.refresh();
      // Waiting for the operator: polling never confirms the run.
      for (let i = 0; i < 3; i++) await h.refresh();
      expect((await h.store.get('INFRA-T1'))!.execution!.phase).toBe(
        'awaiting_operator_apply',
      );

      expect(h.apis.calls.length).toBeGreaterThan(10);
      assertReadOnly(h.apis.calls);
      expect(new Set(h.apis.calls.map(c => c.method))).toEqual(
        new Set(['GET', 'POST']),
      );
      expect(
        h.apis.calls
          .filter(c => c.method === 'POST')
          .every(c => c.url === 'https://api.github.com/graphql'),
      ).toBe(true);
    });

    it.each([
      [
        'legacy (no fingerprint)',
        { configFingerprint: undefined },
        /Legacy request/,
      ],
      ['no PR repository recorded', { prRepository: null }, /repository/],
      [
        'PR in another repository',
        { prRepository: 'jubermohamad/platform_cloudhub' },
        /tracking covers/,
      ],
      ['no PR yet', { prNumber: undefined }, /No infrastructure pull request/],
    ])(
      'does not track a request with %s and makes no calls',
      async (_label, overrides, reason) => {
        const h = await harness();
        await h.store.create(
          record(overrides as Partial<InfrastructureRequest>),
        );
        const result = await h.tracker.refresh('INFRA-T1', { force: true });
        expect(result.refreshed).toBe(false);
        expect(result.reason).toMatch(reason);
        expect(h.apis.calls).toHaveLength(0);
      },
    );
  });
});
