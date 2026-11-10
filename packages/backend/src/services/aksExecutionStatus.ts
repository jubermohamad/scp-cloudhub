/**
 * AKS infrastructure execution tracking: persisted facts, the mapping from
 * GitHub / Terraform Cloud states to CloudHub phases, and merge rules that
 * keep repeated or out-of-order observations from overwriting newer state.
 *
 * Everything here is pure; external reads live in aksExternalReaders.ts and
 * orchestration in AksExecutionTracker.ts.
 *
 * Success is never inferred: a merged PR, a successful plan, or an existing
 * workspace each map to their own intermediate phase. Only a Terraform Cloud
 * run that reached `applied` and whose state outputs were read back reaches
 * `outputs_available`.
 */

import type { InfrastructureRequestStatus } from './InfrastructureRequestStore';

// ─── Phases ──────────────────────────────────────────────────────────────────

export const EXECUTION_PHASES = [
  'unknown',
  'pr_checks_pending',
  'quality_gate_failed',
  'changes_requested',
  'awaiting_review',
  'awaiting_merge',
  'pr_closed',
  'pr_merged',
  'workspace_creation_pending',
  'workspace_creation_failed',
  'workspace_mapping_mismatch',
  'plan_pending',
  'plan_failed',
  'plan_cancelled',
  'plan_no_changes',
  'awaiting_operator_apply',
  'apply_running',
  'apply_failed',
  'apply_cancelled',
  'apply_discarded',
  'apply_succeeded',
  'outputs_available',
] as const;
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

/** Phase of one Terraform Cloud run (cluster workspace or workspacemanager). */
export type RunPhase =
  | 'plan_pending'
  | 'plan_failed'
  | 'plan_cancelled'
  | 'plan_no_changes'
  | 'awaiting_operator_apply'
  | 'apply_running'
  | 'apply_failed'
  | 'apply_cancelled'
  | 'apply_discarded'
  | 'apply_succeeded'
  | 'unknown';

export const PRE_MERGE_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  'pr_checks_pending',
  'quality_gate_failed',
  'changes_requested',
  'awaiting_review',
  'awaiting_merge',
]);

// ─── Persisted facts ─────────────────────────────────────────────────────────

export type ReviewDecision =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_REQUIRED';

export interface QualityGateFacts {
  /** not_reported: no "Terraform Quality Gate" check from GitHub Actions yet. */
  status: 'not_reported' | 'pending' | 'passed' | 'failed';
  conclusion: string | null;
  url: string | null;
  completedAt: string | null;
}

export interface SpeculativePlanFacts {
  /** Commit status context posted by TFC, e.g. "Terraform Cloud/sensa-cloud-platform/workspacemanager". */
  context: string;
  state: string;
  url: string | null;
}

export interface PullRequestFacts {
  repository: string;
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  headSha: string;
  /** GitHub's review decision, which accounts for required CODEOWNERS review. */
  reviewDecision: ReviewDecision | null;
  approvedBy: string[];
  changesRequestedBy: string[];
  qualityGate: QualityGateFacts;
  /** Advisory only: TFC speculative plans are not required checks on main. */
  speculativePlans: SpeculativePlanFacts[];
  observedAt: string;
}

export interface WorkspaceMappingFacts {
  /** Merge commit the files were read at. */
  commitSha: string;
  workspacesFileHasEntry: boolean;
  valuesFilePresent: boolean;
  /** Raw override body when the entry is not `{}` (reviewers may edit it). */
  entryOverrides: string | null;
  projectNameOverride: string | null;
  vcsBranchOverride: string | null;
  expectedProject: string;
  observedAt: string;
}

export interface WorkspaceFacts {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  projectName: string | null;
  workingDirectory: string | null;
  vcsRepo: string | null;
  vcsBranch: string | null;
  autoApply: boolean;
  /** TFC `current-run` / `current-state-version` relationships when observed. */
  currentRunId: string | null;
  currentStateVersionId: string | null;
  /** Differences from the configuration workspacemanager should have applied. */
  mismatches: string[];
  observedAt: string;
}

export interface ResourceCounts {
  status: string | null;
  additions: number | null;
  changes: number | null;
  destructions: number | null;
}

export interface TfcRunFacts {
  id: string;
  workspaceName: string;
  url: string;
  status: string;
  phase: RunPhase;
  isConfirmable: boolean;
  hasChanges: boolean | null;
  isDestroy: boolean;
  createdAt: string;
  statusTimestamps: Record<string, string>;
  commitSha: string | null;
  /** How a workspacemanager run was attributed to this request's merge. */
  matchedBy?: 'merge_commit' | 'first_after_merge';
  message: string | null;
  plan: ResourceCounts | null;
  apply: ResourceCounts | null;
  observedAt: string;
}

/**
 * Read with only the "read state outputs" permission
 * (current-state-version-outputs); the state version itself is never read.
 */
export interface OutputFacts {
  stateVersionId: string | null;
  /** The workspace's current run when the outputs were read. */
  runId: string | null;
  /** Non-sensitive allow-listed outputs only. */
  values: Record<string, unknown>;
  /** Names of outputs that exist but were not read (sensitive or not allow-listed). */
  omitted: string[];
  observedAt: string;
}

export interface RefreshErrorFacts {
  service: 'github' | 'terraform-cloud' | 'internal';
  kind: string;
  message: string;
  at: string;
}

export interface ExecutionTracking {
  schemaVersion: 1;
  phase: ExecutionPhase;
  detail: string;
  phaseSince: string;
  pullRequest: PullRequestFacts | null;
  mapping: WorkspaceMappingFacts | null;
  workspaceManagerRun: TfcRunFacts | null;
  workspace: WorkspaceFacts | null;
  run: TfcRunFacts | null;
  outputs: OutputFacts | null;
  refresh: {
    lastAttemptAt: string | null;
    /** Last refresh that completed every read without error. */
    lastSuccessAt: string | null;
    error: RefreshErrorFacts | null;
  };
  history: Array<{ phase: ExecutionPhase; detail: string; at: string }>;
}

export const HISTORY_LIMIT = 50;

export function emptyExecutionTracking(now: string): ExecutionTracking {
  return {
    schemaVersion: 1,
    phase: 'unknown',
    detail: 'Not yet observed',
    phaseSince: now,
    pullRequest: null,
    mapping: null,
    workspaceManagerRun: null,
    workspace: null,
    run: null,
    outputs: null,
    refresh: { lastAttemptAt: null, lastSuccessAt: null, error: null },
    history: [],
  };
}

// ─── GitHub mappings ─────────────────────────────────────────────────────────

/** The required status check on scp-infra-as-code main (ruleset default-branch-protection). */
export const QUALITY_GATE_CHECK_NAME = 'Terraform Quality Gate';
/** GitHub Actions app id; the ruleset pins the required check to it. */
export const GITHUB_ACTIONS_APP_ID = 15368;

const CHECK_FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);
/** GitHub treats these as satisfying a required check. */
const CHECK_PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

export function mapQualityGate(
  check: {
    status: string;
    conclusion: string | null;
    html_url?: string | null;
    completed_at?: string | null;
  } | null,
): QualityGateFacts {
  if (!check) {
    return {
      status: 'not_reported',
      conclusion: null,
      url: null,
      completedAt: null,
    };
  }
  const base = {
    conclusion: check.conclusion,
    url: check.html_url ?? null,
    completedAt: check.completed_at ?? null,
  };
  if (check.status !== 'completed') return { status: 'pending', ...base };
  if (check.conclusion && CHECK_PASSING_CONCLUSIONS.has(check.conclusion)) {
    return { status: 'passed', ...base };
  }
  if (check.conclusion && CHECK_FAILED_CONCLUSIONS.has(check.conclusion)) {
    return { status: 'failed', ...base };
  }
  // Unknown conclusion: never treat as passed.
  return { status: 'pending', ...base };
}

// ─── Terraform Cloud run mapping ─────────────────────────────────────────────

/** Before the plan is ready for a decision (fetch, plan, run tasks, policy). */
const RUN_PLANNING = new Set([
  'pending',
  'fetching',
  'fetching_completed',
  'pre_plan_running',
  'pre_plan_completed',
  'queuing',
  'plan_queued',
  'planning',
  'cost_estimating',
  'policy_checking',
  'post_plan_running',
]);
/** Plan finished; waits for an operator decision when the run is confirmable. */
const RUN_DECISION = new Set([
  'planned',
  'cost_estimated',
  'policy_checked',
  'policy_override',
  'policy_soft_failed',
  'post_plan_completed',
  'post_plan_awaiting_decision',
  'planned_and_saved',
]);
const RUN_APPLYING = new Set([
  'confirmed',
  'apply_queued',
  'queuing_apply',
  'applying',
  'post_apply_running',
]);
const RUN_APPLIED = new Set(['applied', 'post_apply_completed']);

function applyStarted(timestamps: Record<string, string>): boolean {
  return Boolean(
    timestamps['confirmed-at'] ||
      timestamps['apply-queued-at'] ||
      timestamps['applying-at'],
  );
}

export function mapRunStatus(input: {
  status: string;
  isConfirmable: boolean;
  statusTimestamps: Record<string, string>;
}): RunPhase {
  const { status, isConfirmable, statusTimestamps } = input;
  if (RUN_PLANNING.has(status)) return 'plan_pending';
  if (RUN_DECISION.has(status)) {
    return isConfirmable ? 'awaiting_operator_apply' : 'plan_pending';
  }
  if (RUN_APPLYING.has(status)) return 'apply_running';
  if (RUN_APPLIED.has(status)) return 'apply_succeeded';
  if (status === 'planned_and_finished') return 'plan_no_changes';
  if (status === 'discarded') return 'apply_discarded';
  if (status === 'errored') {
    return applyStarted(statusTimestamps) ? 'apply_failed' : 'plan_failed';
  }
  if (status === 'canceled' || status === 'force_canceled') {
    return applyStarted(statusTimestamps)
      ? 'apply_cancelled'
      : 'plan_cancelled';
  }
  return 'unknown';
}

const RUN_PHASE_RANK: Record<RunPhase, number> = {
  unknown: 0,
  plan_pending: 10,
  awaiting_operator_apply: 20,
  apply_running: 30,
  plan_failed: 40,
  plan_cancelled: 40,
  plan_no_changes: 40,
  apply_failed: 40,
  apply_cancelled: 40,
  apply_discarded: 40,
  apply_succeeded: 40,
};

export function isTerminalRunPhase(phase: RunPhase): boolean {
  return RUN_PHASE_RANK[phase] === 40;
}

// ─── Merge rules (idempotent, out-of-order safe) ─────────────────────────────

/** A merged PR never reverts to open/closed because of a stale response. */
export function mergePullRequest(
  previous: PullRequestFacts | null,
  next: PullRequestFacts | null,
): PullRequestFacts | null {
  if (!next) return previous;
  if (!previous) return next;
  if (previous.merged && !next.merged) return previous;
  return next;
}

/**
 * Within one run the TFC status only moves forward, so a lower-ranked
 * observation is stale and ignored. A different run replaces the tracked one
 * only when it was created later.
 */
export function mergeRun(
  previous: TfcRunFacts | null,
  next: TfcRunFacts | null,
): TfcRunFacts | null {
  if (!next) return previous;
  if (!previous) return next;
  if (previous.id !== next.id) {
    return Date.parse(next.createdAt) > Date.parse(previous.createdAt)
      ? next
      : previous;
  }
  return RUN_PHASE_RANK[next.phase] >= RUN_PHASE_RANK[previous.phase]
    ? next
    : previous;
}

export function mergeOutputs(
  previous: OutputFacts | null,
  next: OutputFacts | null,
): OutputFacts | null {
  // Outputs are always the workspace's current state; the latest read wins.
  return next ?? previous;
}

// ─── Phase derivation ────────────────────────────────────────────────────────

const RUN_PHASE_TEXT: Record<RunPhase, string> = {
  plan_pending: 'plan running or queued',
  awaiting_operator_apply:
    'plan finished; waiting for an operator to confirm apply in Terraform Cloud',
  apply_running: 'apply running',
  apply_succeeded: 'apply finished',
  apply_failed: 'apply errored',
  apply_cancelled: 'apply cancelled',
  apply_discarded: 'plan discarded by an operator (not applied)',
  plan_failed: 'plan errored',
  plan_cancelled: 'run cancelled before apply',
  plan_no_changes: 'plan finished with no changes to apply',
  unknown: 'status not recognised',
};

/** Outputs that prove the cluster exists; aks_cluster_id is always set by the root. */
export const REQUIRED_OUTPUT = 'aks_cluster_id';

/**
 * Outputs count for a run only if they were read while that applied run was
 * the workspace's current run (so they are its state, not an older one's).
 */
function outputsBelongToRun(outputs: OutputFacts, run: TfcRunFacts): boolean {
  return outputs.runId !== null && outputs.runId === run.id;
}

export function deriveExecutionPhase(
  t: Pick<
    ExecutionTracking,
    | 'pullRequest'
    | 'mapping'
    | 'workspaceManagerRun'
    | 'workspace'
    | 'run'
    | 'outputs'
  >,
): { phase: ExecutionPhase; detail: string } {
  const pr = t.pullRequest;
  if (!pr) {
    return { phase: 'unknown', detail: 'Pull request not yet observed' };
  }
  const prRef = `PR #${pr.number}`;

  if (!pr.merged) {
    if (pr.state === 'closed') {
      return {
        phase: 'pr_closed',
        detail: `${prRef} was closed without merging`,
      };
    }
    if (pr.qualityGate.status === 'failed') {
      return {
        phase: 'quality_gate_failed',
        detail: `${QUALITY_GATE_CHECK_NAME} concluded '${pr.qualityGate.conclusion}' on ${prRef}`,
      };
    }
    if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      return {
        phase: 'changes_requested',
        detail: `Changes requested on ${prRef} by ${
          pr.changesRequestedBy.join(', ') || 'a reviewer'
        }`,
      };
    }
    if (pr.qualityGate.status !== 'passed') {
      return {
        phase: 'pr_checks_pending',
        detail:
          pr.qualityGate.status === 'not_reported'
            ? `${QUALITY_GATE_CHECK_NAME} has not reported on ${prRef} yet`
            : `${QUALITY_GATE_CHECK_NAME} is running on ${prRef}`,
      };
    }
    if (pr.reviewDecision !== 'APPROVED') {
      return {
        phase: 'awaiting_review',
        detail: `${prRef} needs an approving CODEOWNERS review`,
      };
    }
    return {
      phase: 'awaiting_merge',
      detail: `${prRef} is approved and passing; waiting for a maintainer to merge`,
    };
  }

  const mergedRef = `${prRef} merged (${(pr.mergeCommitSha ?? '').slice(
    0,
    7,
  )})`;
  if (t.mapping && !t.mapping.workspacesFileHasEntry) {
    return {
      phase: 'workspace_mapping_mismatch',
      detail: `${mergedRef}, but the merged workspaces.tfvars has no entry for this cluster`,
    };
  }
  if (t.mapping && !t.mapping.valuesFilePresent) {
    return {
      phase: 'workspace_mapping_mismatch',
      detail: `${mergedRef}, but the merged commit has no values file for this cluster`,
    };
  }

  const ws = t.workspace;
  if (ws) {
    if (ws.mismatches.length > 0) {
      return {
        phase: 'workspace_mapping_mismatch',
        detail: `Workspace ${
          ws.name
        } does not match its workspacemanager definition: ${ws.mismatches.join(
          '; ',
        )}`,
      };
    }
    const run = t.run;
    if (!run) {
      return {
        phase: 'plan_pending',
        detail: `Workspace ${ws.name} exists; no run has been queued yet`,
      };
    }
    const runRef = `Run ${run.id} in ${ws.name}`;
    if (run.phase === 'apply_succeeded') {
      if (
        t.outputs &&
        outputsBelongToRun(t.outputs, run) &&
        t.outputs.values[REQUIRED_OUTPUT]
      ) {
        return {
          phase: 'outputs_available',
          detail: `${runRef} applied; outputs read from state version ${
            t.outputs.stateVersionId ?? 'unknown'
          }`,
        };
      }
      return {
        phase: 'apply_succeeded',
        detail: `${runRef} applied; waiting for its state outputs`,
      };
    }
    if (run.phase === 'unknown') {
      return {
        phase: 'unknown',
        detail: `${runRef} has unrecognised status '${run.status}'`,
      };
    }
    return {
      phase: run.phase,
      detail: `${runRef}: ${RUN_PHASE_TEXT[run.phase]}`,
    };
  }

  const wsm = t.workspaceManagerRun;
  if (wsm) {
    const wsmRef = `workspacemanager run ${wsm.id}`;
    switch (wsm.phase) {
      case 'plan_pending':
      case 'awaiting_operator_apply':
      case 'apply_running':
        return {
          phase: 'workspace_creation_pending',
          detail: `${wsmRef}: ${RUN_PHASE_TEXT[wsm.phase]}`,
        };
      case 'apply_succeeded':
        // Attributed by time only: it may not be the run that carries this
        // change, so keep waiting instead of declaring failure.
        if (wsm.matchedBy === 'first_after_merge') {
          return {
            phase: 'workspace_creation_pending',
            detail: `${wsmRef} applied, but the workspace is not visible yet`,
          };
        }
        return {
          phase: 'workspace_creation_failed',
          detail: `${wsmRef} applied, but the workspace was not found`,
        };
      case 'unknown':
        return {
          phase: 'unknown',
          detail: `${wsmRef} has unrecognised status '${wsm.status}'`,
        };
      default:
        return {
          phase: 'workspace_creation_failed',
          detail: `${wsmRef}: ${
            RUN_PHASE_TEXT[wsm.phase]
          }; the workspace was not created`,
        };
    }
  }

  return {
    phase: 'pr_merged',
    detail: `${mergedRef}; waiting for the workspacemanager run`,
  };
}

/**
 * Request status implied by an execution phase, or null to leave it as is.
 * Post-merge failures stay `provisioning` so an operator retry in TFC is
 * still observed; the phase carries the failure.
 */
export function requestStatusForPhase(
  phase: ExecutionPhase,
): InfrastructureRequestStatus | null {
  if (phase === 'unknown') return null;
  if (PRE_MERGE_PHASES.has(phase)) return 'awaiting_pr_merge';
  if (phase === 'pr_closed') return 'failed';
  if (phase === 'outputs_available') return 'infrastructure_ready';
  return 'provisioning';
}

/** How current the stored phase is, for presentation. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function executionFreshness(
  t: ExecutionTracking | null | undefined,
  now: Date,
): {
  freshness: 'current' | 'stale' | 'never_verified';
  reason: string | null;
} {
  if (!t || !t.refresh.lastSuccessAt) {
    return {
      freshness: 'never_verified',
      reason: t?.refresh.error?.message ?? 'Status has not been verified yet',
    };
  }
  if (t.refresh.error) {
    return {
      freshness: 'stale',
      reason: `Cannot refresh: ${t.refresh.error.message}. Showing the last verified status from ${t.refresh.lastSuccessAt}.`,
    };
  }
  if (now.getTime() - Date.parse(t.refresh.lastSuccessAt) > STALE_AFTER_MS) {
    return {
      freshness: 'stale',
      reason: `Last verified at ${t.refresh.lastSuccessAt}`,
    };
  }
  return { freshness: 'current', reason: null };
}
