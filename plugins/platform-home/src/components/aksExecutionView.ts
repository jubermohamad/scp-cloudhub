/**
 * Pure view logic for the AKS wizard's submission gates and read-only
 * infrastructure execution tracking. Mirrors the provisioning backend contract
 * (`POST /plan` gates, `/request/:id/execution[/refresh]`).
 *
 * Rule: never present a success the backend did not report.
 */

// ─── Submission gates ─────────────────────────────────────────────────────────

export type GateStatus = 'passed' | 'failed' | 'unverified';

export interface GateResult {
  id:
    | 'production_enabled'
    | 'approver_groups'
    | 'github_permissions'
    | 'cidr_repository'
    | 'cidr_azure'
    | 'compute_quota';
  label: string;
  status: GateStatus;
  detail: string;
  warnings?: string[];
  evidence?: unknown;
}

export interface SubmissionGateReport {
  blocking: boolean;
  checkedAt: string;
  checks: GateResult[];
}

export const GATES_BLOCKING_MESSAGE =
  'Submission is blocked until every preflight check passes; checks that cannot be verified also block.';

/** Returns the report only when it has the expected shape. */
export function parseGateReport(value: unknown): SubmissionGateReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<SubmissionGateReport>;
  if (!Array.isArray(report.checks)) return null;
  return {
    // Fail closed: a report that does not say it is non-blocking blocks.
    blocking:
      report.blocking !== false ||
      report.checks.some(c => c?.status !== 'passed'),
    checkedAt: typeof report.checkedAt === 'string' ? report.checkedAt : '',
    checks: report.checks,
  };
}

// ─── Execution tracking ───────────────────────────────────────────────────────

export type ExecutionPhase =
  | 'unknown'
  | 'pr_checks_pending'
  | 'quality_gate_failed'
  | 'changes_requested'
  | 'awaiting_review'
  | 'awaiting_merge'
  | 'pr_closed'
  | 'pr_merged'
  | 'workspace_creation_pending'
  | 'workspace_creation_failed'
  | 'workspace_mapping_mismatch'
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
  | 'outputs_available';

interface TfcCounts {
  status: string | null;
  additions: number | null;
  changes: number | null;
  destructions: number | null;
}

export interface TfcRun {
  id: string;
  workspaceName: string;
  url: string;
  status: string;
  phase: string;
  isConfirmable: boolean;
  createdAt: string;
  plan: TfcCounts | null;
  apply: TfcCounts | null;
  observedAt: string;
}

export interface ExecutionTracking {
  phase: ExecutionPhase;
  detail: string;
  phaseSince: string;
  pullRequest: {
    repository: string;
    number: number;
    url: string;
    state: 'open' | 'closed';
    merged: boolean;
    mergedAt: string | null;
    mergeCommitSha: string | null;
    reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
    approvedBy: string[];
    changesRequestedBy: string[];
    qualityGate: {
      status: 'not_reported' | 'pending' | 'passed' | 'failed';
      conclusion: string | null;
      url: string | null;
    };
    speculativePlans: { context: string; state: string; url: string | null }[];
    observedAt: string;
  } | null;
  mapping: {
    expectedProject: string;
    workspacesFileHasEntry: boolean;
    valuesFilePresent: boolean;
  } | null;
  workspaceManagerRun: TfcRun | null;
  workspace: {
    name: string;
    url: string;
    projectName: string | null;
    mismatches: string[];
    observedAt: string;
  } | null;
  run: TfcRun | null;
  outputs: {
    values: Record<string, unknown>;
    omitted: string[];
    stateVersionId: string;
    observedAt: string;
  } | null;
  refresh: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    error: {
      service: string;
      kind: string;
      message: string;
      at: string;
    } | null;
  };
  history: { phase: ExecutionPhase; detail: string; at: string }[];
}

export interface ExecutionView {
  requestId: string;
  requestStatus: string;
  clusterName: string;
  prRepository: string | null;
  prNumber: number | null;
  prUrl: string | null;
  trackable: boolean;
  notTrackableReason: string | null;
  execution: ExecutionTracking | null;
  freshness: 'current' | 'stale' | 'never_verified';
  reason: string | null;
  refreshed?: boolean;
  refreshSkippedReason?: string | null;
}

export type Severity = 'success' | 'info' | 'warning' | 'error';
export type StageState =
  | 'pending'
  | 'active'
  | 'done'
  | 'warning'
  | 'error'
  | 'action';

export interface StageLink {
  label: string;
  url: string;
}

export interface ExecutionStage {
  id:
    | 'pull_request'
    | 'workspace_manager'
    | 'workspace'
    | 'plan'
    | 'operator_apply'
    | 'apply'
    | 'outputs';
  label: string;
  state: StageState;
  /** One-line status shown next to the stage. */
  summary: string;
  /** Backend `execution.detail` when this stage holds the current phase. */
  detail?: string;
  facts: string[];
  /** Hard errors observed for this stage (e.g. workspace mismatches). */
  errors: string[];
  links: StageLink[];
  /** Extra callout (e.g. operator apply instructions). */
  notice?: { severity: Severity; text: string; link?: StageLink };
}

export const OPERATOR_APPLY_NOTICE =
  'Plan is ready. An operator must review and Confirm & Apply this run in Terraform Cloud. CloudHub only observes.';
export const APPLY_WAITING_OUTPUTS =
  'Apply finished — waiting for state outputs';
export const CORE_SERVICES_UNTRACKED =
  'Core services and cluster bootstrap are not yet tracked by CloudHub; this does not mean the cluster is ready for workloads.';
export const TRACKING_NOT_CONFIGURED =
  'Execution tracking is not configured on this backend';

const STAGE_ORDER: ExecutionStage['id'][] = [
  'pull_request',
  'workspace_manager',
  'workspace',
  'plan',
  'operator_apply',
  'apply',
  'outputs',
];

const STAGE_LABELS: Record<ExecutionStage['id'], string> = {
  pull_request: 'Infrastructure PR',
  workspace_manager: 'Workspace manager run',
  workspace: 'Terraform Cloud workspace',
  plan: 'Plan',
  operator_apply: 'Operator apply decision',
  apply: 'Apply',
  outputs: 'Outputs',
};

/** Where each execution phase sits in the lifecycle, and how it reads. */
const PHASE_POSITION: Record<
  ExecutionPhase,
  { stage: ExecutionStage['id']; state: StageState; summary: string }
> = {
  unknown: {
    stage: 'pull_request',
    state: 'pending',
    summary: 'Not yet observed',
  },
  pr_checks_pending: {
    stage: 'pull_request',
    state: 'active',
    summary: 'Checks running',
  },
  quality_gate_failed: {
    stage: 'pull_request',
    state: 'error',
    summary: 'Quality Gate failed',
  },
  changes_requested: {
    stage: 'pull_request',
    state: 'warning',
    summary: 'Changes requested',
  },
  awaiting_review: {
    stage: 'pull_request',
    state: 'active',
    summary: 'Awaiting review',
  },
  awaiting_merge: {
    stage: 'pull_request',
    state: 'active',
    summary: 'Approved — awaiting merge',
  },
  pr_closed: {
    stage: 'pull_request',
    state: 'error',
    summary: 'Closed without merge',
  },
  pr_merged: {
    stage: 'workspace_manager',
    state: 'active',
    summary: 'Waiting for workspace manager run',
  },
  workspace_creation_pending: {
    stage: 'workspace_manager',
    state: 'active',
    summary: 'Creating workspace',
  },
  workspace_creation_failed: {
    stage: 'workspace_manager',
    state: 'error',
    summary: 'Workspace creation failed',
  },
  workspace_mapping_mismatch: {
    stage: 'workspace',
    state: 'error',
    summary: 'Workspace does not match the request',
  },
  plan_pending: { stage: 'plan', state: 'active', summary: 'Planning' },
  plan_failed: { stage: 'plan', state: 'error', summary: 'Plan failed' },
  plan_cancelled: {
    stage: 'plan',
    state: 'warning',
    summary: 'Plan cancelled',
  },
  plan_no_changes: {
    stage: 'plan',
    state: 'warning',
    summary: 'Plan has no changes — nothing will be applied',
  },
  awaiting_operator_apply: {
    stage: 'operator_apply',
    state: 'action',
    summary: 'Waiting for an operator to Confirm & Apply in Terraform Cloud',
  },
  apply_running: { stage: 'apply', state: 'active', summary: 'Applying' },
  apply_failed: { stage: 'apply', state: 'error', summary: 'Apply failed' },
  apply_cancelled: {
    stage: 'apply',
    state: 'warning',
    summary: 'Apply cancelled',
  },
  apply_discarded: {
    stage: 'operator_apply',
    state: 'warning',
    summary: 'Run discarded by an operator',
  },
  apply_succeeded: {
    stage: 'outputs',
    state: 'active',
    summary: APPLY_WAITING_OUTPUTS,
  },
  outputs_available: {
    stage: 'outputs',
    state: 'done',
    summary: 'State outputs available',
  },
};

/** Effective phase; a backend `infrastructure_ready` status implies outputs. */
export function effectivePhase(view: ExecutionView | null): ExecutionPhase {
  if (view?.requestStatus === 'infrastructure_ready')
    return 'outputs_available';
  return view?.execution?.phase ?? 'unknown';
}

export function isInfrastructureProvisioned(
  view: ExecutionView | null,
): boolean {
  return effectivePhase(view) === 'outputs_available';
}

export function formatPlanCounts(counts: TfcCounts | null | undefined): string {
  if (!counts) return '';
  const parts: string[] = [];
  if (counts.additions !== null) parts.push(`+${counts.additions} to add`);
  if (counts.changes !== null) parts.push(`~${counts.changes} to change`);
  if (counts.destructions !== null)
    parts.push(`-${counts.destructions} to destroy`);
  return parts.join(' · ');
}

export function formatOutputValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const QUALITY_GATE_TEXT: Record<string, string> = {
  not_reported: 'not reported',
  pending: 'pending',
  passed: 'passed',
  failed: 'failed',
};

const REVIEW_TEXT: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  REVIEW_REQUIRED: 'review required',
};

function runFacts(run: TfcRun | null): string[] {
  if (!run) return [];
  return [`Run ${run.id}: ${run.status}`];
}

function stageData(
  id: ExecutionStage['id'],
  view: ExecutionView,
): Pick<ExecutionStage, 'facts' | 'errors' | 'links'> {
  const t = view.execution;
  const facts: string[] = [];
  const errors: string[] = [];
  const links: StageLink[] = [];
  switch (id) {
    case 'pull_request': {
      const pr = t?.pullRequest ?? null;
      const url = pr?.url ?? view.prUrl;
      const number = pr?.number ?? view.prNumber;
      if (url)
        links.push({
          label: number ? `Open PR #${number}` : 'Open PR',
          url,
        });
      if (pr) {
        let state = 'open';
        if (pr.merged) state = 'merged';
        else if (pr.state === 'closed') state = 'closed without merge';
        facts.push(
          `State: ${state}${
            pr.merged && pr.mergedAt ? ` (${pr.mergedAt})` : ''
          }`,
        );
        facts.push(
          `Quality Gate: ${
            QUALITY_GATE_TEXT[pr.qualityGate.status] ?? pr.qualityGate.status
          }${
            pr.qualityGate.conclusion ? ` (${pr.qualityGate.conclusion})` : ''
          }`,
        );
        if (pr.qualityGate.url)
          links.push({ label: 'Quality Gate', url: pr.qualityGate.url });
        facts.push(
          `Review: ${
            pr.reviewDecision
              ? REVIEW_TEXT[pr.reviewDecision] ?? pr.reviewDecision
              : 'none'
          }`,
        );
        if (pr.approvedBy.length)
          facts.push(`Approved by: ${pr.approvedBy.join(', ')}`);
        if (pr.changesRequestedBy.length)
          facts.push(
            `Changes requested by: ${pr.changesRequestedBy.join(', ')}`,
          );
        pr.speculativePlans.forEach(p => {
          facts.push(`Speculative plan ${p.context}: ${p.state}`);
          if (p.url) links.push({ label: p.context, url: p.url });
        });
      }
      break;
    }
    case 'workspace_manager': {
      const run = t?.workspaceManagerRun ?? null;
      facts.push(...runFacts(run));
      if (run?.url)
        links.push({ label: 'Workspace manager run', url: run.url });
      if (t?.mapping) {
        if (!t.mapping.workspacesFileHasEntry)
          facts.push('Workspace entry not found in workspaces.tfvars');
        if (!t.mapping.valuesFilePresent)
          facts.push('Values file not found on main');
      }
      break;
    }
    case 'workspace': {
      const ws = t?.workspace ?? null;
      if (ws) {
        facts.push(`Workspace: ${ws.name}`);
        facts.push(`Project: ${ws.projectName ?? 'unknown'}`);
        if (ws.url) links.push({ label: ws.name, url: ws.url });
        errors.push(...ws.mismatches);
      }
      if (t?.mapping?.expectedProject)
        facts.push(`Expected project: ${t.mapping.expectedProject}`);
      break;
    }
    case 'plan': {
      const run = t?.run ?? null;
      if (run) {
        facts.push(...runFacts(run));
        if (run.plan?.status) facts.push(`Plan status: ${run.plan.status}`);
        const counts = formatPlanCounts(run.plan);
        if (counts) facts.push(counts);
        if (run.url) links.push({ label: 'Terraform Cloud run', url: run.url });
      }
      break;
    }
    case 'operator_apply':
      break;
    case 'apply': {
      const run = t?.run ?? null;
      if (run?.apply) {
        if (run.apply.status) facts.push(`Apply status: ${run.apply.status}`);
        const counts = formatPlanCounts(run.apply);
        if (counts) facts.push(counts);
      }
      break;
    }
    case 'outputs': {
      const outputs = t?.outputs ?? null;
      if (outputs) {
        Object.entries(outputs.values).forEach(([k, v]) =>
          facts.push(`${k} = ${formatOutputValue(v)}`),
        );
        if (outputs.omitted.length)
          facts.push(
            `Sensitive outputs not shown: ${outputs.omitted.join(', ')}`,
          );
      }
      break;
    }
    default:
      break;
  }
  return { facts, errors, links };
}

/** Builds the seven-stage lifecycle view from what the backend observed. */
export function executionStages(view: ExecutionView): ExecutionStage[] {
  const phase = effectivePhase(view);
  const position = PHASE_POSITION[phase] ?? PHASE_POSITION.unknown;
  const currentIdx = STAGE_ORDER.indexOf(position.stage);
  const hasExecution = Boolean(view.execution);
  const detail = view.execution?.detail;

  return STAGE_ORDER.map((id, idx) => {
    const data = stageData(id, view);
    let state: StageState;
    let summary: string;
    let stageDetail: string | undefined;
    if (!hasExecution && phase !== 'outputs_available') {
      state = 'pending';
      summary = 'Not yet observed';
    } else if (idx < currentIdx) {
      state = 'done';
      summary = 'Done';
      if (id === 'operator_apply') summary = 'Confirmed by an operator';
      if (id === 'plan') summary = 'Plan finished';
    } else if (idx === currentIdx) {
      state = position.state;
      summary = position.summary;
      if (detail) stageDetail = detail;
    } else {
      state = 'pending';
      summary =
        position.state === 'error' || position.state === 'warning'
          ? 'Not reached'
          : 'Waiting';
    }

    const stage: ExecutionStage = {
      id,
      label: STAGE_LABELS[id],
      state,
      summary,
      ...(stageDetail ? { detail: stageDetail } : {}),
      ...data,
    };
    if (data.errors.length && state !== 'error' && state !== 'pending') {
      stage.state = 'error';
    }

    if (id === 'operator_apply' && phase === 'awaiting_operator_apply') {
      const runUrl = view.execution?.run?.url;
      stage.notice = {
        severity: 'info',
        text: OPERATOR_APPLY_NOTICE,
        ...(runUrl
          ? { link: { label: 'Open run in Terraform Cloud', url: runUrl } }
          : {}),
      };
    }
    if (id === 'outputs' && phase === 'outputs_available') {
      stage.notice = { severity: 'info', text: CORE_SERVICES_UNTRACKED };
    }
    return stage;
  });
}

/** Overall status line for the execution panel. */
export function executionHeadline(view: ExecutionView): {
  severity: Severity;
  title: string;
  message: string;
} {
  const phase = effectivePhase(view);
  const detail = view.execution?.detail ?? '';
  if (phase === 'outputs_available') {
    return {
      severity: 'success',
      title: 'Infrastructure provisioned',
      message: `Terraform Cloud applied the run and state outputs are available. ${CORE_SERVICES_UNTRACKED}`,
    };
  }
  if (!view.execution) {
    return {
      severity: 'info',
      title: 'Not yet observed',
      message:
        view.reason ??
        'CloudHub has not observed the infrastructure PR or Terraform Cloud yet.',
    };
  }
  const position = PHASE_POSITION[phase] ?? PHASE_POSITION.unknown;
  let severity: Severity = 'info';
  if (position.state === 'error') severity = 'error';
  else if (position.state === 'warning') severity = 'warning';
  return {
    severity,
    title:
      phase === 'apply_succeeded' ? APPLY_WAITING_OUTPUTS : position.summary,
    message: detail,
  };
}

/** Freshness banner, or null when the status is current. */
export function freshnessBanner(
  view: ExecutionView,
): { severity: Severity; message: string } | null {
  if (view.freshness === 'stale') {
    return {
      severity: 'warning',
      message:
        view.reason ??
        'Execution status could not be refreshed; showing the last verified status.',
    };
  }
  if (view.freshness === 'never_verified') {
    const reason = view.reason ?? 'Status has not been verified yet';
    return {
      severity: 'info',
      message: /not been verified/i.test(reason)
        ? reason
        : `Status has not been verified yet: ${reason}`,
    };
  }
  return null;
}

export function lastVerifiedAt(view: ExecutionView | null): string | null {
  return view?.execution?.refresh.lastSuccessAt ?? null;
}

const POLL_STATUSES = ['awaiting_pr_merge', 'provisioning'];
const TERMINAL_STATUSES = ['infrastructure_ready', 'failed'];

/**
 * Whether to keep polling the read-only refresh endpoint. With no view yet
 * (transient network error) polling continues.
 */
export function shouldPollExecution(view: ExecutionView | null): boolean {
  if (!view) return true;
  if (view.trackable === false) return false;
  if (TERMINAL_STATUSES.includes(view.requestStatus)) return false;
  return POLL_STATUSES.includes(view.requestStatus);
}

// ─── Request resumption ───────────────────────────────────────────────────────

export type ResumePhase =
  | 'configure'
  | 'review'
  | 'approval'
  | 'pull_request'
  | 'provision';

/** Wizard phase to show for a stored request's status. */
export function resumePhaseForStatus(status: string): ResumePhase {
  const norm = status.toLowerCase();
  switch (norm) {
    case 'draft':
      return 'configure';
    case 'validating':
      return 'review';
    case 'branch_ready':
    case 'awaiting_pr_merge':
    case 'infra_pr_pending':
    case 'infrastructure_pr_merged':
      return 'pull_request';
    case 'provisioning':
    case 'applying':
    case 'workspace_pending':
    case 'plan_pending':
    case 'awaiting_apply':
    case 'infrastructure_ready':
    case 'addons_deploying':
    case 'operational_configuration':
    case 'verifying':
    case 'completed':
      return 'provision';
    default:
      // pending_approval, approved, awaiting_tailscale_merge,
      // preparing_infra_pr, rejected, failed and anything unknown.
      return 'approval';
  }
}

export function resumeErrorMessage(status: number, requestId: string): string {
  if (status === 403)
    return `You cannot view request ${requestId}: only the requester and AKS approvers can open it.`;
  if (status === 404) return `Request ${requestId} was not found.`;
  return `Could not load request ${requestId} (HTTP ${status}).`;
}
