import {
  executionFreshness,
  emptyExecutionTracking,
  mapQualityGate,
  mapRunStatus,
  requestStatusForPhase,
  EXECUTION_PHASES,
} from '../services/aksExecutionStatus';
import { findAksWorkspaceEntry as findStandardWorkspaceEntry } from '@internal/plugin-platform-common/backend';

describe('mapRunStatus (Terraform Cloud run → phase)', () => {
  const applied = { 'confirmed-at': 't', 'applying-at': 't' };
  it.each([
    ['pending', false, {}, 'plan_pending'],
    ['fetching', false, {}, 'plan_pending'],
    ['plan_queued', false, {}, 'plan_pending'],
    ['planning', false, {}, 'plan_pending'],
    ['cost_estimating', false, {}, 'plan_pending'],
    ['policy_checking', false, {}, 'plan_pending'],
    ['post_plan_running', false, {}, 'plan_pending'],
    ['planned', false, {}, 'plan_pending'],
    ['planned', true, {}, 'awaiting_operator_apply'],
    ['cost_estimated', true, {}, 'awaiting_operator_apply'],
    ['policy_checked', true, {}, 'awaiting_operator_apply'],
    ['policy_override', true, {}, 'awaiting_operator_apply'],
    ['policy_soft_failed', true, {}, 'awaiting_operator_apply'],
    ['post_plan_completed', true, {}, 'awaiting_operator_apply'],
    ['planned_and_saved', true, {}, 'awaiting_operator_apply'],
    ['confirmed', false, {}, 'apply_running'],
    ['apply_queued', false, {}, 'apply_running'],
    ['applying', false, {}, 'apply_running'],
    ['post_apply_running', false, {}, 'apply_running'],
    ['applied', false, {}, 'apply_succeeded'],
    ['planned_and_finished', false, {}, 'plan_no_changes'],
    ['discarded', false, {}, 'apply_discarded'],
    ['errored', false, {}, 'plan_failed'],
    ['errored', false, applied, 'apply_failed'],
    ['canceled', false, {}, 'plan_cancelled'],
    ['canceled', false, applied, 'apply_cancelled'],
    ['force_canceled', false, applied, 'apply_cancelled'],
    ['some_new_status', true, {}, 'unknown'],
  ])(
    '%s (confirmable=%s, %j) → %s',
    (status, isConfirmable, statusTimestamps, phase) => {
      expect(mapRunStatus({ status, isConfirmable, statusTimestamps })).toBe(
        phase,
      );
    },
  );
});

describe('mapQualityGate (GitHub check run → gate)', () => {
  it.each([
    [null, 'not_reported'],
    [{ status: 'queued', conclusion: null }, 'pending'],
    [{ status: 'in_progress', conclusion: null }, 'pending'],
    [{ status: 'completed', conclusion: 'success' }, 'passed'],
    [{ status: 'completed', conclusion: 'skipped' }, 'passed'],
    [{ status: 'completed', conclusion: 'neutral' }, 'passed'],
    [{ status: 'completed', conclusion: 'failure' }, 'failed'],
    [{ status: 'completed', conclusion: 'timed_out' }, 'failed'],
    [{ status: 'completed', conclusion: 'cancelled' }, 'failed'],
    [{ status: 'completed', conclusion: 'action_required' }, 'failed'],
    [{ status: 'completed', conclusion: 'brand_new' }, 'pending'],
  ])('%j → %s', (check, status) => {
    expect(mapQualityGate(check).status).toBe(status);
  });
});

describe('requestStatusForPhase', () => {
  it('maps every phase without ever inferring readiness early', () => {
    const ready = EXECUTION_PHASES.filter(
      phase => requestStatusForPhase(phase) === 'infrastructure_ready',
    );
    expect(ready).toEqual(['outputs_available']);
    expect(requestStatusForPhase('pr_merged')).toBe('provisioning');
    expect(requestStatusForPhase('awaiting_operator_apply')).toBe(
      'provisioning',
    );
    expect(requestStatusForPhase('apply_succeeded')).toBe('provisioning');
    expect(requestStatusForPhase('awaiting_review')).toBe('awaiting_pr_merge');
    expect(requestStatusForPhase('pr_closed')).toBe('failed');
    expect(requestStatusForPhase('unknown')).toBeNull();
  });
});

describe('executionFreshness', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  it('distinguishes current, stale and never-verified status', () => {
    const t = emptyExecutionTracking('2026-10-13T11:00:00Z');
    expect(executionFreshness(t, now).freshness).toBe('never_verified');
    t.refresh.lastSuccessAt = '2026-10-13T11:59:00Z';
    expect(executionFreshness(t, now).freshness).toBe('current');
    t.refresh.lastSuccessAt = '2026-10-13T11:00:00Z';
    expect(executionFreshness(t, now).freshness).toBe('stale');
    t.refresh.lastSuccessAt = '2026-10-13T11:59:00Z';
    t.refresh.error = {
      service: 'github',
      kind: 'timeout',
      message: 'github did not respond',
      at: 'x',
    };
    expect(executionFreshness(t, now)).toMatchObject({
      freshness: 'stale',
      reason: expect.stringContaining('github did not respond'),
    });
  });
});

describe('findStandardWorkspaceEntry', () => {
  const file = `workspaces = {
  "azure-kubernetes-service-legacy" = {
    "aks-scp-dev-ae-st-x" = {}
  }
  "azure-kubernetes-service-standard" = {
    "aks-scp-prd-cnc-st-manu"      = {}
    # "aks-scp-dev-ae-st-commented" = {}
    "aks-scp-prd-argocd-frc-scp" = {
      project_name_override = "SCP-PRD-INFRASTRUCTURE"
    }
  }
}`;
  it('finds entries only inside the standard block', () => {
    expect(findStandardWorkspaceEntry(file, 'aks-scp-prd-cnc-st-manu')).toEqual(
      { body: null },
    );
    expect(
      findStandardWorkspaceEntry(file, 'aks-scp-prd-argocd-frc-scp')!.body,
    ).toContain('project_name_override = "SCP-PRD-INFRASTRUCTURE"');
    expect(findStandardWorkspaceEntry(file, 'aks-scp-dev-ae-st-x')).toBeNull();
    expect(
      findStandardWorkspaceEntry(file, 'aks-scp-dev-ae-st-commented'),
    ).toBeNull();
  });
});
