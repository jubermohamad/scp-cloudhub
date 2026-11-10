/**
 * Read-only tracker for the AKS infrastructure lifecycle after CloudHub opens
 * the infrastructure PR:
 *
 *   PR (Quality Gate, CODEOWNERS review, merge)            GitHub
 *   → workspacemanager run that creates the workspace      Terraform Cloud
 *   → cluster workspace (project / repo / branch checked)  Terraform Cloud
 *   → first cluster run: plan, operator decision, apply    Terraform Cloud
 *   → non-sensitive state outputs                          Terraform Cloud
 *
 * It only reads (GithubReader / TerraformCloudReader over ReadOnlyHttpClient)
 * and persists what it observed. The operator still confirms apply in
 * Terraform Cloud; nothing here can trigger, confirm or discard a run.
 *
 * Consistency: observations are merged with monotonic rules (merged PRs stay
 * merged, a run's status only moves forward, an older run never replaces a
 * newer one) and saved with the store's optimistic version check, so repeated
 * polls, concurrent pollers, or a restart can neither regress nor duplicate
 * state. Phase changes are logged once.
 */

import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  AKS_STANDARD_ROOT,
  deriveAksNames,
  type ExecutionEvent,
} from '@internal/plugin-platform-common/backend';
import {
  ConcurrentModificationError,
  type InfrastructureRequest,
  type InfrastructureRequestStatus,
  type InfrastructureRequestStore,
} from './InfrastructureRequestStore';
import { ExternalServiceError } from './readOnlyHttp';
import {
  HISTORY_LIMIT,
  deriveExecutionPhase,
  emptyExecutionTracking,
  isTerminalRunPhase,
  mergeOutputs,
  mergePullRequest,
  mergeRun,
  requestStatusForPhase,
  type ExecutionTracking,
  type PullRequestFacts,
  type RefreshErrorFacts,
  type TfcRunFacts,
} from './aksExecutionStatus';
import {
  WORKSPACE_MANAGER_WORKSPACE,
  type GithubReader,
  type TerraformCloudReader,
} from './aksExternalReaders';

/** Request statuses in which the tracker polls external services. */
export const TRACKED_STATUSES: InfrastructureRequestStatus[] = [
  'awaiting_pr_merge',
  'provisioning',
];

/** Runs created this long before the workspace still count (clock skew). */
const WORKSPACE_CLOCK_SKEW_MS = 60_000;

export type Trackability =
  | { trackable: true }
  | { trackable: false; reason: string };

export interface RefreshResult {
  record: InfrastructureRequest | null;
  refreshed: boolean;
  reason?: string;
}

export interface AksExecutionTrackerOptions {
  store: InfrastructureRequestStore;
  logger: LoggerService;
  github: GithubReader | null;
  tfc: TerraformCloudReader | null;
  /** Repository CloudHub opens infrastructure PRs in (owner/name). */
  infraRepository: string;
  workspacesFile: string;
  baseBranch: string;
  now?: () => Date;
  /** Polls closer together than this reuse the stored result. */
  minRefreshIntervalMs?: number;
}

export class AksExecutionTracker {
  private readonly options: AksExecutionTrackerOptions;
  private readonly inflight = new Map<string, Promise<RefreshResult>>();
  private workspaceManagerId: string | null = null;

  constructor(options: AksExecutionTrackerOptions) {
    this.options = options;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  trackability(record: InfrastructureRequest): Trackability {
    if (!record.configFingerprint) {
      return {
        trackable: false,
        reason:
          'Legacy request created before the approval-integrity model; it is not tracked. Reject or retire it and resubmit.',
      };
    }
    if (!record.prNumber) {
      return {
        trackable: false,
        reason: 'No infrastructure pull request has been opened yet',
      };
    }
    if (!record.prRepository) {
      return {
        trackable: false,
        reason:
          'The repository of this request’s pull request was not recorded, so its PR number cannot be resolved safely',
      };
    }
    if (record.prRepository !== this.options.infraRepository) {
      return {
        trackable: false,
        reason: `The pull request is in ${record.prRepository}; tracking covers ${this.options.infraRepository} only`,
      };
    }
    return { trackable: true };
  }

  /**
   * Observe the external state for one request and persist it. Concurrent
   * calls for the same request share one refresh; calls within the minimum
   * interval return the stored state unless `force` is set.
   */
  refresh(
    requestId: string,
    options: { force?: boolean } = {},
  ): Promise<RefreshResult> {
    const existing = this.inflight.get(requestId);
    if (existing) return existing;
    const promise = this.refreshOnce(requestId, options.force ?? false).finally(
      () => this.inflight.delete(requestId),
    );
    this.inflight.set(requestId, promise);
    return promise;
  }

  /** Refresh every request in a tracked status (scheduler entry point). */
  async refreshAll(): Promise<{
    checked: number;
    refreshed: number;
    errors: number;
  }> {
    const records = await this.options.store.listByStatus(TRACKED_STATUSES);
    let refreshed = 0;
    let errors = 0;
    let checked = 0;
    for (const record of records) {
      if (!this.trackability(record).trackable) continue;
      checked++;
      try {
        const result = await this.refresh(record.requestId);
        if (result.refreshed) refreshed++;
        if (result.record?.execution?.refresh.error) errors++;
      } catch (error) {
        errors++;
        this.options.logger.warn(
          `[provisioning] execution tracking failed for ${record.requestId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { checked, refreshed, errors };
  }

  private async refreshOnce(
    requestId: string,
    force: boolean,
  ): Promise<RefreshResult> {
    const { store } = this.options;
    const record = await store.get(requestId);
    if (!record) return { record: null, refreshed: false, reason: 'not_found' };

    const trackability = this.trackability(record);
    if (!trackability.trackable) {
      return { record, refreshed: false, reason: trackability.reason };
    }
    if (!TRACKED_STATUSES.includes(record.status)) {
      return {
        record,
        refreshed: false,
        reason: `Tracking is not active in status '${record.status}'`,
      };
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const previous = record.execution ?? emptyExecutionTracking(nowIso);
    const lastAttempt = previous.refresh.lastAttemptAt;
    if (
      !force &&
      lastAttempt &&
      now.getTime() - Date.parse(lastAttempt) <
        (this.options.minRefreshIntervalMs ?? 15_000)
    ) {
      return { record, refreshed: false, reason: 'throttled' };
    }

    const next: ExecutionTracking = structuredClone(previous);
    next.refresh.lastAttemptAt = nowIso;
    try {
      await this.observe(record, next, nowIso);
      next.refresh.error = null;
      next.refresh.lastSuccessAt = nowIso;
    } catch (error) {
      next.refresh.error = toRefreshError(error, nowIso);
      this.options.logger.warn(
        `[provisioning] execution refresh for ${requestId} incomplete: ${next.refresh.error.message}`,
      );
    }

    // Partial observations made before an error are kept: each fact was
    // verified, and the merge rules never let them regress.
    const derived = deriveExecutionPhase(next);
    if (derived.phase !== previous.phase) {
      next.phase = derived.phase;
      next.phaseSince = nowIso;
      next.history = [
        ...next.history,
        { phase: derived.phase, detail: derived.detail, at: nowIso },
      ].slice(-HISTORY_LIMIT);
      record.logs.push(
        `[${nowIso}] Infrastructure: ${derived.phase} — ${derived.detail}`,
      );

      // Persist normalized execution event
      const sourceSystem: ExecutionEvent['sourceSystem'] =
        derived.phase.startsWith('pr_') ||
        derived.phase.includes('gate') ||
        derived.phase.includes('changes_') ||
        derived.phase.includes('review')
          ? 'github'
          : derived.phase.startsWith('workspace') ||
            derived.phase.startsWith('plan') ||
            derived.phase.startsWith('apply') ||
            derived.phase === 'outputs_available'
          ? 'terraform-cloud'
          : 'cloudhub';

      const normalizedStatus: ExecutionEvent['normalizedStatus'] =
        derived.phase.includes('failed') ||
        derived.phase.includes('closed') ||
        derived.phase.includes('cancelled') ||
        derived.phase.includes('discarded') ||
        derived.phase.includes('mismatch')
          ? 'failed'
          : derived.phase === 'outputs_available' ||
            derived.phase === 'apply_succeeded' ||
            derived.phase === 'pr_merged'
          ? 'succeeded'
          : derived.phase.includes('pending') ||
            derived.phase.includes('running')
          ? 'in_progress'
          : 'pending';

      const severity: ExecutionEvent['severity'] =
        normalizedStatus === 'failed'
          ? 'error'
          : normalizedStatus === 'succeeded'
          ? 'success'
          : 'info';

      void store
        .appendEvent({
          requestId: record.requestId,
          configFingerprint: record.configFingerprint,
          eventId: `${derived.phase}-${nowIso}`,
          sourceSystem,
          eventType: derived.phase,
          normalizedStatus,
          message: derived.detail,
          step: 'provision',
          severity,
          externalRef: next.run?.url ?? next.pullRequest?.url,
          sourceUrl: next.run?.url ?? next.pullRequest?.url,
        })
        .catch(err => {
          this.options.logger.warn(`Failed to append execution event: ${err}`);
        });
    }
    next.detail = derived.detail;

    const status = requestStatusForPhase(next.phase);
    if (status && status !== record.status) {
      record.status = status;
      if (status === 'failed') {
        record.error = derived.detail;
        // A closed PR is no longer in flight: release the uniqueness claims.
        record.claimClusterName = null;
        record.claimAddressSpace = null;
      }
    }
    record.execution = next;

    try {
      await store.save(record);
    } catch (error) {
      if (error instanceof ConcurrentModificationError) {
        // Another poller or user action saved first; theirs stands.
        return {
          record: await store.get(requestId),
          refreshed: false,
          reason: 'concurrent',
        };
      }
      throw error;
    }
    return { record, refreshed: true };
  }

  private async observe(
    record: InfrastructureRequest,
    next: ExecutionTracking,
    now: string,
  ): Promise<void> {
    const { github, tfc } = this.options;
    if (!github) {
      throw new ExternalServiceError(
        'github',
        'not_configured',
        'GitHub read access is not configured',
      );
    }

    // 1. Pull request: re-read until merged (a merged PR is immutable).
    if (!next.pullRequest?.merged) {
      const observed = await github.readPullRequest(
        record.prRepository!,
        record.prNumber!,
        now,
      );
      next.pullRequest = mergePullRequest(next.pullRequest, observed);
    }
    const pr = next.pullRequest!;
    if (!pr.merged || !pr.mergeCommitSha) return;

    // 2. What the merged commit tells workspacemanager to create.
    const names = deriveAksNames(record.payload);
    if (!next.mapping) {
      next.mapping = await github.readMergedMapping({
        repository: record.prRepository!,
        commitSha: pr.mergeCommitSha,
        workspacesFile: this.options.workspacesFile,
        valuesFile: names.valuesFilePath,
        workspaceName: names.workspaceName,
        now,
      });
    }
    if (
      !next.mapping.workspacesFileHasEntry ||
      !next.mapping.valuesFilePresent
    ) {
      return;
    }

    if (!tfc) {
      throw new ExternalServiceError(
        'terraform-cloud',
        'not_configured',
        'Terraform Cloud read access is not configured',
      );
    }

    // 3. The cluster workspace, checked against its workspacemanager definition.
    const workspace = await tfc.findWorkspace(names.workspaceName, now, {
      project: next.mapping.expectedProject,
      workingDirectory: AKS_STANDARD_ROOT,
      repository: record.prRepository!,
      branch: this.options.baseBranch,
    });
    if (workspace) {
      next.workspace = workspace;
    } else if (next.workspace) {
      throw new ExternalServiceError(
        'terraform-cloud',
        'not_found',
        `Workspace ${names.workspaceName} was observed earlier but is no longer found`,
      );
    }

    // 4. The workspacemanager run that carries the merge (until it finishes).
    if (
      !next.workspaceManagerRun ||
      next.workspaceManagerRun.matchedBy !== 'merge_commit' ||
      !isTerminalRunPhase(next.workspaceManagerRun.phase)
    ) {
      next.workspaceManagerRun = mergeRun(
        next.workspaceManagerRun,
        await this.findWorkspaceManagerRun(next.workspaceManagerRun, pr, now),
      );
    }
    if (!next.workspace) return;

    // 5. The cluster run: newest apply run since the workspace was created.
    // Speculative (plan-only) runs are excluded by the reader, destroy runs
    // here; a newer run (e.g. an operator retry) supersedes an older one.
    const ws = next.workspace;
    const runs = await tfc.listRuns(ws.id, ws.name, now);
    const latest = runs
      .filter(
        run =>
          !run.isDestroy &&
          Date.parse(run.createdAt) >=
            Date.parse(ws.createdAt) - WORKSPACE_CLOCK_SKEW_MS,
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (latest) {
      next.run = mergeRun(next.run, await tfc.readRun(latest.id, ws.name, now));
    }

    // 6. Outputs, only once the tracked run has applied.
    if (next.run?.phase === 'apply_succeeded') {
      next.outputs = mergeOutputs(next.outputs, await tfc.readOutputs(ws, now));
    }
  }

  private async findWorkspaceManagerRun(
    current: TfcRunFacts | null,
    pr: PullRequestFacts,
    now: string,
  ): Promise<TfcRunFacts | null> {
    const tfc = this.options.tfc!;
    if (current?.matchedBy === 'merge_commit') {
      return {
        ...(await tfc.readRun(current.id, WORKSPACE_MANAGER_WORKSPACE, now)),
        matchedBy: 'merge_commit',
      };
    }
    if (!this.workspaceManagerId) {
      this.workspaceManagerId = await tfc.workspaceId(
        WORKSPACE_MANAGER_WORKSPACE,
      );
      if (!this.workspaceManagerId) {
        throw new ExternalServiceError(
          'terraform-cloud',
          'not_found',
          `Terraform Cloud workspace ${WORKSPACE_MANAGER_WORKSPACE} was not found`,
        );
      }
    }
    const runs = await tfc.listRuns(
      this.workspaceManagerId,
      WORKSPACE_MANAGER_WORKSPACE,
      now,
    );
    const exact = runs.find(run => run.commitSha === pr.mergeCommitSha);
    if (exact) {
      return {
        ...(await tfc.readRun(exact.id, WORKSPACE_MANAGER_WORKSPACE, now)),
        matchedBy: 'merge_commit',
      };
    }
    const mergedAt = Date.parse(pr.mergedAt ?? '');
    const firstAfter = runs
      .filter(run => Date.parse(run.createdAt) >= mergedAt)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    return firstAfter
      ? { ...firstAfter, matchedBy: 'first_after_merge' }
      : null;
  }
}

function toRefreshError(error: unknown, at: string): RefreshErrorFacts {
  if (error instanceof ExternalServiceError) {
    return {
      service: error.service === 'github' ? 'github' : 'terraform-cloud',
      kind: error.kind,
      message: error.message,
      at,
    };
  }
  return {
    service: 'internal',
    kind: 'internal',
    message: `Unexpected error while reading external status: ${
      error instanceof Error ? error.message : String(error)
    }`,
    at,
  };
}
