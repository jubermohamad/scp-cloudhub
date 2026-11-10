import {
  APPLY_WAITING_OUTPUTS,
  CORE_SERVICES_UNTRACKED,
  OPERATOR_APPLY_NOTICE,
  executionHeadline,
  executionStages,
  freshnessBanner,
  lastVerifiedAt,
  parseGateReport,
  resumePhaseForStatus,
  shouldPollExecution,
  type ExecutionPhase,
  type ExecutionTracking,
  type ExecutionView,
  type TfcRun,
} from './aksExecutionView';

const AT = '2026-10-13T10:00:00.000Z';

function run(overrides: Partial<TfcRun> = {}): TfcRun {
  return {
    id: 'run-abc',
    workspaceName: 'aks-scp-dev-aue-st-contoso',
    url: 'https://app.terraform.io/app/org/workspaces/ws/runs/run-abc',
    status: 'planned',
    phase: 'plan',
    isConfirmable: true,
    createdAt: AT,
    plan: { status: 'finished', additions: 12, changes: 0, destructions: 0 },
    apply: null,
    observedAt: AT,
    ...overrides,
  };
}

function tracking(
  phase: ExecutionPhase,
  overrides: Partial<ExecutionTracking> = {},
): ExecutionTracking {
  return {
    phase,
    detail: `detail for ${phase}`,
    phaseSince: AT,
    pullRequest: {
      repository: 'org/scp-infra-as-code',
      number: 42,
      url: 'https://github.com/org/scp-infra-as-code/pull/42',
      state: 'open',
      merged: false,
      mergedAt: null,
      mergeCommitSha: null,
      reviewDecision: 'REVIEW_REQUIRED',
      approvedBy: [],
      changesRequestedBy: [],
      qualityGate: {
        status: 'passed',
        conclusion: 'success',
        url: 'https://sonar.example/qg',
      },
      speculativePlans: [],
      observedAt: AT,
    },
    mapping: null,
    workspaceManagerRun: null,
    workspace: null,
    run: null,
    outputs: null,
    refresh: { lastAttemptAt: AT, lastSuccessAt: AT, error: null },
    history: [],
    ...overrides,
  };
}

function view(
  execution: ExecutionTracking | null,
  overrides: Partial<ExecutionView> = {},
): ExecutionView {
  return {
    requestId: 'req-1',
    requestStatus: 'awaiting_pr_merge',
    clusterName: 'aks-scp-dev-aue-st-contoso',
    prRepository: 'org/scp-infra-as-code',
    prNumber: 42,
    prUrl: 'https://github.com/org/scp-infra-as-code/pull/42',
    trackable: true,
    notTrackableReason: null,
    execution,
    freshness: 'current',
    reason: null,
    ...overrides,
  };
}

const stageById = (v: ExecutionView, id: string) =>
  executionStages(v).find(s => s.id === id)!;

describe('executionStages', () => {
  it('shows awaiting_review as the active PR stage with PR facts and links', () => {
    const v = view(tracking('awaiting_review'));
    const stages = executionStages(v);
    expect(stages.map(s => s.id)).toEqual([
      'pull_request',
      'workspace_manager',
      'workspace',
      'plan',
      'operator_apply',
      'apply',
      'outputs',
    ]);
    const pr = stages[0];
    expect(pr.state).toBe('active');
    expect(pr.summary).toBe('Awaiting review');
    expect(pr.detail).toBe('detail for awaiting_review');
    expect(pr.links).toEqual(
      expect.arrayContaining([
        { label: 'Open PR #42', url: v.prUrl },
        { label: 'Quality Gate', url: 'https://sonar.example/qg' },
      ]),
    );
    expect(pr.facts).toContain('Review: review required');
    expect(stages.slice(1).every(s => s.state === 'pending')).toBe(true);
    expect(executionHeadline(v).severity).toBe('info');
  });

  it('shows quality_gate_failed as an error on the PR stage', () => {
    const t = tracking('quality_gate_failed');
    t.pullRequest!.qualityGate = {
      status: 'failed',
      conclusion: 'failure',
      url: 'https://sonar.example/qg',
    };
    const v = view(t);
    const pr = stageById(v, 'pull_request');
    expect(pr.state).toBe('error');
    expect(pr.detail).toBe('detail for quality_gate_failed');
    expect(pr.facts).toContain('Quality Gate: failed (failure)');
    expect(stageById(v, 'plan').summary).toBe('Not reached');
    expect(executionHeadline(v)).toMatchObject({
      severity: 'error',
      message: 'detail for quality_gate_failed',
    });
  });

  it('asks an operator to apply in Terraform Cloud without reporting success', () => {
    const t = tracking('awaiting_operator_apply', { run: run() });
    t.pullRequest!.merged = true;
    t.pullRequest!.state = 'closed';
    const v = view(t, { requestStatus: 'provisioning' });
    const stages = executionStages(v);
    const operator = stageById(v, 'operator_apply');
    expect(operator.state).toBe('action');
    expect(operator.notice).toEqual({
      severity: 'info',
      text: OPERATOR_APPLY_NOTICE,
      link: { label: 'Open run in Terraform Cloud', url: run().url },
    });
    expect(stageById(v, 'plan').state).toBe('done');
    expect(stageById(v, 'plan').facts).toContain(
      '+12 to add · ~0 to change · -0 to destroy',
    );
    expect(stageById(v, 'apply').state).toBe('pending');
    expect(stageById(v, 'outputs').state).toBe('pending');
    expect(stages.some(s => s.notice?.severity === 'success')).toBe(false);
    expect(executionHeadline(v).severity).not.toBe('success');
  });

  it('does not treat apply_succeeded without outputs as complete', () => {
    const v = view(
      tracking('apply_succeeded', {
        run: run({
          status: 'applied',
          apply: {
            status: 'finished',
            additions: 12,
            changes: 0,
            destructions: 0,
          },
        }),
      }),
      { requestStatus: 'provisioning' },
    );
    const outputs = stageById(v, 'outputs');
    expect(outputs.state).toBe('active');
    expect(outputs.summary).toBe(APPLY_WAITING_OUTPUTS);
    expect(stageById(v, 'apply').state).toBe('done');
    const headline = executionHeadline(v);
    expect(headline.severity).not.toBe('success');
    expect(headline.title).toBe(APPLY_WAITING_OUTPUTS);
    expect(shouldPollExecution(v)).toBe(true);
  });

  it('shows outputs_available as provisioned but core services untracked', () => {
    const v = view(
      tracking('outputs_available', {
        run: run({ status: 'applied' }),
        outputs: {
          values: { cluster_name: 'aks-x', node_count: 3 },
          omitted: ['kube_admin_config'],
          stateVersionId: 'sv-1',
          observedAt: AT,
        },
      }),
      { requestStatus: 'infrastructure_ready' },
    );
    const stages = executionStages(v);
    expect(stages.every(s => s.state === 'done')).toBe(true);
    const outputs = stageById(v, 'outputs');
    expect(outputs.facts).toEqual([
      'cluster_name = aks-x',
      'node_count = 3',
      'Sensitive outputs not shown: kube_admin_config',
    ]);
    expect(outputs.notice?.text).toBe(CORE_SERVICES_UNTRACKED);
    const headline = executionHeadline(v);
    expect(headline.severity).toBe('success');
    expect(headline.title).toBe('Infrastructure provisioned');
    expect(headline.message).toContain('not yet tracked');
    expect(headline.message).not.toMatch(/cluster (is )?ready\b(?! for)/i);
    expect(shouldPollExecution(v)).toBe(false);
  });

  it('flags workspace mismatches as errors', () => {
    const v = view(
      tracking('workspace_mapping_mismatch', {
        workspace: {
          name: 'ws',
          url: 'https://app.terraform.io/ws',
          projectName: 'wrong',
          mismatches: ['Project is wrong, expected scp'],
          observedAt: AT,
        },
      }),
      { requestStatus: 'provisioning' },
    );
    const ws = stageById(v, 'workspace');
    expect(ws.state).toBe('error');
    expect(ws.errors).toEqual(['Project is wrong, expected scp']);
    expect(ws.links).toEqual([
      { label: 'ws', url: 'https://app.terraform.io/ws' },
    ]);
  });
});

describe('freshnessBanner', () => {
  it('warns with the backend reason when stale', () => {
    const t = tracking('plan_pending', {
      refresh: {
        lastAttemptAt: AT,
        lastSuccessAt: '2026-10-13T09:00:00.000Z',
        error: {
          service: 'terraform-cloud',
          kind: 'unavailable',
          message: 'terraform-cloud responded 503',
          at: AT,
        },
      },
    });
    const reason =
      'Cannot refresh: terraform-cloud responded 503. Showing the last verified status from 2026-10-13T09:00:00.000Z.';
    const v = view(t, { freshness: 'stale', reason });
    expect(freshnessBanner(v)).toEqual({
      severity: 'warning',
      message: reason,
    });
    expect(lastVerifiedAt(v)).toBe('2026-10-13T09:00:00.000Z');
  });

  it('reports never_verified and nothing when current', () => {
    expect(
      freshnessBanner(
        view(null, {
          freshness: 'never_verified',
          reason: 'Status has not been verified yet',
        }),
      ),
    ).toEqual({
      severity: 'info',
      message: 'Status has not been verified yet',
    });
    expect(freshnessBanner(view(tracking('awaiting_review')))).toBeNull();
  });
});

describe('shouldPollExecution', () => {
  it('stops for untrackable requests', () => {
    const v = view(null, {
      trackable: false,
      notTrackableReason: 'Legacy request',
      freshness: 'never_verified',
    });
    expect(shouldPollExecution(v)).toBe(false);
    expect(executionStages(v).every(s => s.state === 'pending')).toBe(true);
  });

  it('polls only while awaiting merge or provisioning', () => {
    expect(shouldPollExecution(null)).toBe(true);
    expect(shouldPollExecution(view(null))).toBe(true);
    expect(
      shouldPollExecution(view(null, { requestStatus: 'provisioning' })),
    ).toBe(true);
    expect(shouldPollExecution(view(null, { requestStatus: 'failed' }))).toBe(
      false,
    );
    expect(
      shouldPollExecution(view(null, { requestStatus: 'branch_ready' })),
    ).toBe(false);
  });
});

describe('parseGateReport', () => {
  it('fails closed and ignores malformed reports', () => {
    expect(parseGateReport(undefined)).toBeNull();
    expect(parseGateReport({ blocking: false })).toBeNull();
    expect(
      parseGateReport({
        blocking: false,
        checkedAt: AT,
        checks: [
          {
            id: 'cidr_azure',
            label: 'CIDR',
            status: 'unverified',
            detail: 'x',
          },
        ],
      })?.blocking,
    ).toBe(true);
  });
});

describe('resumePhaseForStatus', () => {
  it.each([
    ['DRAFT', 'configure'],
    ['validating', 'review'],
    ['pending_approval', 'approval'],
    ['awaiting_tailscale_merge', 'approval'],
    ['preparing_infra_pr', 'approval'],
    ['rejected', 'approval'],
    ['failed', 'approval'],
    ['awaiting_pr_merge', 'pull_request'],
    ['provisioning', 'provision'],
    ['infrastructure_ready', 'provision'],
    ['completed', 'provision'],
  ])('%s → %s', (status, phase) => {
    expect(resumePhaseForStatus(status)).toBe(phase);
  });
});
