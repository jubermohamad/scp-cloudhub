import type { LoggerService } from '@backstage/backend-plugin-api';
import { existsSync } from 'node:fs';
import path from 'node:path';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface DispatchInput {
  serviceId: string;
  workflowId: string;
  ref: string;
  inputs: Record<string, string>;
  repository?: string;
}

export type WorkflowRunStatus = 'queued' | 'in_progress' | 'completed';
export type WorkflowConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | null;

export interface WorkflowStep {
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  number: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  startedAt?: string | null;
  completedAt?: string | null;
  steps: WorkflowStep[];
}

export interface WorkflowRunStatusResult {
  runId: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  htmlUrl: string;
  jobs: WorkflowJob[];
}

type GitHubTokenSource =
  | 'GITHUB_PAT'
  | 'GITHUB_ACTIONS_TOKEN'
  | 'CLOUDHUB_GITHUB_TOKEN'
  | 'GITHUB_TOKEN';

interface GitHubTokenCandidate {
  source: GitHubTokenSource;
  value: string;
}

export interface PipelineDispatchResult {
  mode: 'simulated' | 'github-api';
  repository: string;
  workflowId: string;
  ref: string;
  inputs?: Record<string, string>;
  runId: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  htmlUrl: string;
}

export interface PipelineRunStatusResult extends WorkflowRunStatusResult {
  mode: 'simulated' | 'github-api';
  workflowId?: string;
}

export interface WorkflowRunCorrelationResult {
  status: 'none' | 'correlated' | 'ambiguous';
  run?: {
    id: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null;
    htmlUrl: string;
    attempt?: number | null;
  };
  message?: string;
}

export class GitHubActionsService {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  private repository(override?: string): string {
    return (
      override ??
      process.env.SRI_PIPELINE_REPO ??
      process.env.GITHUB_ACTIONS_REPO ??
      'jubermohamad/platform_cloudhub'
    );
  }

  private tokenCandidates(): GitHubTokenCandidate[] {
    const configured: GitHubTokenCandidate[] = [];
    const pushCandidate = (
      source: GitHubTokenSource,
      raw: string | undefined,
    ) => {
      const value = raw?.trim() ?? '';
      if (value.length > 0) {
        configured.push({ source, value });
      }
    };

    pushCandidate('GITHUB_PAT', process.env.GITHUB_PAT);
    pushCandidate('GITHUB_ACTIONS_TOKEN', process.env.GITHUB_ACTIONS_TOKEN);
    pushCandidate('CLOUDHUB_GITHUB_TOKEN', process.env.CLOUDHUB_GITHUB_TOKEN);
    pushCandidate('GITHUB_TOKEN', process.env.GITHUB_TOKEN);

    // Keep configured precedence but avoid trying the same token value twice.
    const seen = new Set<string>();
    return configured.filter(candidate => {
      if (seen.has(candidate.value)) {
        return false;
      }
      seen.add(candidate.value);
      return true;
    });
  }

  private configured(repository?: string): boolean {
    const repo = this.repository(repository);
    return this.tokenCandidates().length > 0 && repo.includes('/');
  }

  private parseRepo(repository?: string): { owner: string; repo: string } {
    const [owner, repo] = this.repository(repository).split('/');
    if (!owner || !repo) {
      throw new Error('SRI_PIPELINE_REPO must be set as owner/repo');
    }
    return { owner, repo };
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private safeWorkflowInputs(inputs: Record<string, string>): string {
    const safeInputs = Object.fromEntries(
      Object.entries(inputs).map(([name, value]) => [
        name,
        /secret|token|password|credential|private.?key|api.?key/i.test(name)
          ? '[REDACTED]'
          : value,
      ]),
    );
    return JSON.stringify(safeInputs);
  }

  private static isTokenAuthorizationFailure(
    status: number,
    bodyText: string,
  ): boolean {
    if (status === 401) {
      return true;
    }
    if (status !== 403) {
      return false;
    }
    const lower = bodyText.toLowerCase();
    return (
      lower.includes('resource not accessible by personal access token') ||
      lower.includes('insufficient') ||
      lower.includes('forbidden')
    );
  }

  private dispatchFailureMessage(input: {
    status: number;
    statusText: string;
    bodyText: string;
    owner: string;
    repo: string;
    workflowId: string;
    ref: string;
    url: string;
    source: GitHubTokenSource;
  }): string {
    const body = (input.bodyText || input.statusText).slice(0, 2000);
    const target = [
      `Target: ${input.owner}/${input.repo}, workflow ${input.workflowId},`,
      `ref ${input.ref}, API URL ${input.url}, token source ${input.source}.`,
    ].join(' ');
    if (input.status === 403) {
      return [
        `GitHub workflow dispatch failed (403) for ${input.owner}/${input.repo} workflow ${input.workflowId} using ${input.source}.`,
        target,
        'The token is authenticated but not allowed to dispatch this workflow.',
        'Use a token that can access this repository and dispatch Actions.',
        'Required permissions: classic PAT scopes `repo` + `workflow`, or',
        'fine-grained PAT with Actions: write (and repository access).',
        `GitHub response: ${body}`,
      ].join(' ');
    }

    return [
      `GitHub workflow dispatch failed (${input.status}) using ${input.source}.`,
      target,
      `GitHub response: ${body}`,
    ].join(' ');
  }

  private parseUnexpectedWorkflowInputs(bodyText: string): string[] {
    if (!bodyText) {
      return [];
    }

    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { message?: unknown };
      if (
        typeof parsed?.message === 'string' &&
        parsed.message.trim().length > 0
      ) {
        message = parsed.message;
      }
    } catch {
      // Keep the original body string.
    }

    const match = message.match(/Unexpected inputs provided:\s*(\[[^\]]*\])/i);
    if (!match) {
      return [];
    }

    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map(value => String(value).trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private normalizeRepoSegment(value: string, label: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalized)) {
      throw new Error(
        `Invalid ${label} '${value}'. Only lowercase letters, numbers, and hyphens are allowed.`,
      );
    }
    return normalized;
  }

  private localAppsRoot(): string {
    const configured = process.env.CLOUDHUB_LOCAL_REPO_ROOT?.trim();
    const repoRoot = configured && configured.length > 0 ? configured : process.cwd();
    return path.resolve(repoRoot, 'apps');
  }

  private safeLocalInstancePath(appName: string, appInstance: string): string {
    const appsRoot = this.localAppsRoot();
    const resolved = path.resolve(appsRoot, appName, appInstance);
    if (!(resolved === appsRoot || resolved.startsWith(`${appsRoot}${path.sep}`))) {
      throw new Error('Invalid application or instance path');
    }
    return path.join(resolved, 'helmfile.yaml');
  }

  async verifyAppInstanceExists(
    appName: string,
    appInstance: string,
    branch = 'main',
    repository?: string,
  ): Promise<boolean> {
    const safeAppName = this.normalizeRepoSegment(appName, 'application');
    const safeInstanceName = this.normalizeRepoSegment(appInstance, 'instance');

    if (!this.configured(repository)) {
      const localPath = this.safeLocalInstancePath(safeAppName, safeInstanceName);
      const exists = existsSync(localPath);
      this.logger.warn(
        `[control-plane] GitHub token is not configured; using local repository fallback for app instance verification at ${localPath}. Exists=${exists}`,
      );
      return exists;
    }
    const response = await this.getRepositoryContent(
      `apps/${safeAppName}/${safeInstanceName}/helmfile.yaml`,
      branch,
      repository,
    );
    return response.status === 200;
  }

  /** Raw text of a repository file, or null when it does not exist. */
  async readRepositoryFile(
    path: string,
    branch = 'main',
    repository?: string,
  ): Promise<string | null> {
    if (!this.configured(repository)) {
      return null;
    }
    const response = await this.getRepositoryContent(path, branch, repository);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Unable to read ${this.repository(repository)}/${path} (${response.status}).`,
      );
    }
    const body = (await response.json()) as {
      encoding?: string;
      content?: string;
    };
    if (body.encoding !== 'base64' || typeof body.content !== 'string') {
      return null;
    }
    return Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString(
      'utf8',
    );
  }

  private async getRepositoryContent(
    path: string,
    branch: string,
    repository?: string,
  ): Promise<Response> {
    const tokens = this.tokenCandidates();
    if (tokens.length === 0) {
      throw new Error(
        'GitHub token is not configured for app instance verification.',
      );
    }
    const url = `https://api.github.com/repos/${this.repository(
      repository,
    )}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branch)}`;
    return fetch(url, { headers: this.headers(tokens[0].value) });
  }

  async dispatch(input: DispatchInput): Promise<PipelineDispatchResult> {
    if (!this.configured(input.repository)) {
      const repo = this.repository(input.repository);
      const runId = `sim-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      this.logger.warn(
        `[control-plane] GitHub Actions not configured; falling back to simulated dispatch for ${input.workflowId} in ${repo}.`,
      );
      return {
        mode: 'simulated',
        repository: repo,
        workflowId: input.workflowId,
        ref: input.ref,
        inputs: { ...input.inputs },
        runId,
        status: 'queued',
        conclusion: null,
        htmlUrl: `https://github.com/${repo}/actions/runs/${runId}`,
      };
    }

    const { owner, repo } = this.parseRepo(input.repository);
    const dispatchTs = this.nowIso();
    const tokens = this.tokenCandidates();
    let lastErrorMessage =
      'GitHub workflow dispatch failed with all configured tokens.';

    for (let index = 0; index < tokens.length; index += 1) {
      const tokenCandidate = tokens[index];
      let effectiveInputs = { ...input.inputs };
      const dispatchUrl =
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/` +
        `${encodeURIComponent(input.workflowId)}/dispatches`;

      this.logger.info(
        `[control-plane] GitHub workflow dispatch target: owner=${owner} ` +
          `repo=${repo} workflow=${input.workflowId} ref=${input.ref} ` +
          `tokenSource=${tokenCandidate.source} url=${dispatchUrl} ` +
          `inputs=${this.safeWorkflowInputs(effectiveInputs)}`,
      );

      for (;;) {
        const dispatchResp = await fetch(dispatchUrl, {
          method: 'POST',
          headers: this.headers(tokenCandidate.value),
          body: JSON.stringify({ ref: input.ref, inputs: effectiveInputs }),
        });

        if (!dispatchResp.ok) {
          const text = await dispatchResp.text();
          this.logger.error(
            `[control-plane] GitHub workflow dispatch response: ` +
              `status=${dispatchResp.status} ` +
              `statusText=${dispatchResp.statusText} owner=${owner} ` +
              `repo=${repo} workflow=${input.workflowId} ref=${input.ref} ` +
              `tokenSource=${tokenCandidate.source} url=${dispatchUrl} ` +
              `inputs=${this.safeWorkflowInputs(effectiveInputs)} ` +
              `body=${text.slice(0, 2000)}`,
          );

          if (dispatchResp.status === 422) {
            const unsupportedInputs = this.parseUnexpectedWorkflowInputs(text);
            if (unsupportedInputs.length > 0) {
              const filteredInputs = { ...effectiveInputs };
              let removedAny = false;
              for (const inputName of unsupportedInputs) {
                if (
                  Object.prototype.hasOwnProperty.call(
                    filteredInputs,
                    inputName,
                  )
                ) {
                  delete filteredInputs[inputName];
                  removedAny = true;
                }
              }
              if (removedAny) {
                this.logger.warn(
                  `[control-plane] workflow ${
                    input.workflowId
                  } rejected unsupported inputs (${unsupportedInputs.join(
                    ', ',
                  )}); retrying dispatch without them`,
                );
                effectiveInputs = filteredInputs;
                continue;
              }
            }
          }

          const failureMessage = this.dispatchFailureMessage({
            status: dispatchResp.status,
            statusText: dispatchResp.statusText,
            bodyText: text,
            owner,
            repo,
            workflowId: input.workflowId,
            ref: input.ref,
            url: dispatchUrl,
            source: tokenCandidate.source,
          });
          lastErrorMessage = failureMessage;

          const isRetryableTokenFailure =
            GitHubActionsService.isTokenAuthorizationFailure(
              dispatchResp.status,
              text,
            ) && index < tokens.length - 1;

          if (isRetryableTokenFailure) {
            this.logger.warn(
              `[control-plane] workflow dispatch denied with ${tokenCandidate.source}; trying next configured token`,
            );
            break;
          }

          throw new Error(failureMessage);
        }

        let correlation = await this.findWorkflowRun({
          repository: `${owner}/${repo}`,
          workflowId: input.workflowId,
          ref: input.ref,
          inputs: effectiveInputs,
          dispatchInitiatedAt: dispatchTs,
          token: tokenCandidate.value,
        });
        // A freshly dispatched run is not always visible in the runs list
        // immediately; retry briefly before treating it as uncorrelated.
        for (
          let attempt = 0;
          attempt < 4 && correlation.status === 'none';
          attempt += 1
        ) {
          await sleep(1500);
          correlation = await this.findWorkflowRun({
            repository: `${owner}/${repo}`,
            workflowId: input.workflowId,
            ref: input.ref,
            inputs: effectiveInputs,
            dispatchInitiatedAt: dispatchTs,
            token: tokenCandidate.value,
          });
        }
        if (!correlation.run) {
          return {
            mode: 'github-api',
            repository: `${owner}/${repo}`,
            workflowId: input.workflowId,
            ref: input.ref,
            inputs: { ...effectiveInputs },
            runId: '',
            status: 'queued',
            conclusion: null,
            htmlUrl: '',
          };
        }
        const run = correlation.run;

        return {
          mode: 'github-api',
          repository: `${owner}/${repo}`,
          workflowId: input.workflowId,
          ref: input.ref,
          inputs: { ...effectiveInputs },
          runId: run.id,
          status: run.status,
          conclusion: (run.conclusion as WorkflowConclusion) ?? null,
          htmlUrl: run.htmlUrl,
        };
      }
    }

    throw new Error(lastErrorMessage);
  }

  async findWorkflowRun(input: {
    repository: string;
    workflowId: string;
    ref: string;
    inputs: Record<string, string>;
    dispatchInitiatedAt: string;
    token?: string;
  }): Promise<WorkflowRunCorrelationResult> {
    const [owner, repo] = input.repository.split('/');
    const token = input.token ?? this.tokenCandidates()[0]?.value;
    if (!owner || !repo || !token)
      return {
        status: 'none',
        message: 'GitHub correlation is not configured.',
      };
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
        input.workflowId,
      )}/runs?event=workflow_dispatch&branch=${encodeURIComponent(
        input.ref,
      )}&per_page=100`,
      { headers: this.headers(token) },
    );
    if (!response.ok)
      return {
        status: 'none',
        message: `Run listing failed with ${response.status}.`,
      };
    const body = await response.json();
    const candidates = (body?.workflow_runs ?? []).filter(
      (run: Record<string, unknown>) =>
        String(run.created_at ?? '') >= input.dispatchInitiatedAt &&
        (!run.head_branch || run.head_branch === input.ref) &&
        this.runMatchesInputs(run, input.inputs),
    );
    if (candidates.length === 0)
      return {
        status: 'none',
        message: 'No matching workflow run is visible yet.',
      };
    if (candidates.length > 1)
      return {
        status: 'ambiguous',
        message: `Found ${candidates.length} matching workflow runs.`,
      };
    const run = candidates[0];
    return {
      status: 'correlated',
      run: {
        id: String(run.id),
        status: run.status as 'queued' | 'in_progress' | 'completed',
        conclusion: (run.conclusion as string | null) ?? null,
        htmlUrl: String(run.html_url ?? ''),
        attempt:
          run.run_attempt === null || run.run_attempt === undefined
            ? null
            : Number(run.run_attempt),
      },
    };
  }

  private runMatchesInputs(
    run: Record<string, unknown>,
    inputs: Record<string, string>,
  ): boolean {
    // Different workflows name their identity inputs differently
    // (appName/appInstance, app_name/instance_name, application/instanceName).
    const appName = inputs.appName || inputs.app_name || inputs.application;
    const appInstance =
      inputs.appInstance || inputs.instance_name || inputs.instanceName;
    if (!appName || !appInstance) return false;
    const identity = `${String(run.name ?? '')} ${String(
      run.display_title ?? '',
    )}`.toLowerCase();
    return (
      identity.includes(`[${appName.toLowerCase()}]`) &&
      identity.includes(`[${appInstance.toLowerCase()}]`)
    );
  }

  async runStatus(
    runId: string,
    repository?: string,
  ): Promise<PipelineRunStatusResult> {
    if (runId.startsWith('sim-')) {
      throw new Error(
        'Simulated workflow run IDs are not supported in live production mode.',
      );
    }

    const { owner, repo } = this.parseRepo(repository);
    const tokens = this.tokenCandidates();
    let lastErrorMessage =
      'Failed to read run status with all configured GitHub tokens.';

    for (let index = 0; index < tokens.length; index += 1) {
      const tokenCandidate = tokens[index];
      const runResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(
          runId,
        )}`,
        { headers: this.headers(tokenCandidate.value) },
      );

      if (!runResp.ok) {
        const text = await runResp.text();
        lastErrorMessage = `Failed to read run status (${
          runResp.status
        }) using ${tokenCandidate.source}: ${text || runResp.statusText}`;
        const retryableTokenFailure =
          GitHubActionsService.isTokenAuthorizationFailure(
            runResp.status,
            text,
          ) && index < tokens.length - 1;
        if (retryableTokenFailure) {
          continue;
        }
        throw new Error(lastErrorMessage);
      }

      const run = await runResp.json();

      const jobsResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(
          runId,
        )}/jobs?per_page=100`,
        { headers: this.headers(tokenCandidate.value) },
      );

        const jobs: WorkflowJob[] = [];
      if (jobsResp.ok) {
        const jobsBody = await jobsResp.json();
        for (const job of jobsBody?.jobs ?? []) {
          jobs.push({
            id: job.id,
            name: job.name,
            status: job.status as WorkflowRunStatus,
            conclusion: (job.conclusion as WorkflowConclusion) ?? null,
            startedAt: job.started_at ?? null,
            completedAt: job.completed_at ?? null,
              steps: (job.steps ?? []).map((step: Record<string, unknown>) => ({
                name: String(step.name ?? ''),
                status: step.status as WorkflowRunStatus,
                conclusion: (step.conclusion as WorkflowConclusion) ?? null,
                number: Number(step.number ?? 0),
                startedAt: (step.started_at as string | null | undefined) ?? null,
                completedAt:
                  (step.completed_at as string | null | undefined) ?? null,
              })),
          });
        }
      }

      return {
        mode: 'github-api',
        runId: String(run.id),
        workflowId: run.name,
        status: run.status as WorkflowRunStatus,
        conclusion: (run.conclusion as WorkflowConclusion) ?? null,
        htmlUrl: String(run.html_url ?? ''),
        jobs,
      };
    }

    throw new Error(lastErrorMessage);
  }

  async runLogs(
    runId: string,
    repository?: string,
  ): Promise<{
    mode: 'simulated' | 'github-api';
    runId: string;
    lines: string[];
    jobLines: Array<{ jobId: number; jobName: string; lines: string[] }>;
  }> {
    if (runId.startsWith('sim-')) {
      throw new Error(
        'Simulated workflow run IDs are not supported in live production mode.',
      );
    }

    const { owner, repo } = this.parseRepo(repository);
    const tokens = this.tokenCandidates();
    let lastErrorMessage =
      'Failed to read run logs with all configured GitHub tokens.';

    for (let index = 0; index < tokens.length; index += 1) {
      const tokenCandidate = tokens[index];
      const jobsResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(
          runId,
        )}/jobs?per_page=20`,
        { headers: this.headers(tokenCandidate.value) },
      );

      if (!jobsResp.ok) {
        const text = await jobsResp.text();
        lastErrorMessage = `Failed to list jobs (${jobsResp.status}) using ${
          tokenCandidate.source
        }: ${text || jobsResp.statusText}`;
        const retryableTokenFailure =
          GitHubActionsService.isTokenAuthorizationFailure(
            jobsResp.status,
            text,
          ) && index < tokens.length - 1;
        if (retryableTokenFailure) {
          continue;
        }
        throw new Error(lastErrorMessage);
      }

      const jobsBody = await jobsResp.json();
      const jobs = (jobsBody?.jobs ?? []) as any[];
      const merged: string[] = [];
      const jobLines: Array<{
        jobId: number;
        jobName: string;
        lines: string[];
      }> = [];

      for (const job of jobs) {
        const logsResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
          { headers: this.headers(tokenCandidate.value) },
        );

        if (!logsResp.ok) {
          merged.push(`[${job.name}] failed to load logs (${logsResp.status})`);
          continue;
        }

        const text = await logsResp.text();
        const lines = text
          .split('\n')
          .map(line => line.trimEnd())
          .filter(Boolean)
          .map(line => `[${job.name}] ${line}`);
        merged.push(...lines.slice(-250));
        jobLines.push({
          jobId: Number(job.id),
          jobName: String(job.name),
          lines,
        });
      }

      const lines = merged.slice(-1200);
      return { mode: 'github-api', runId, lines, jobLines };
    }

    throw new Error(lastErrorMessage);
  }

  async getRefCommitSha(input: { repository: string; ref: string }): Promise<string | null> {
    const tokens = this.tokenCandidates();
    if (tokens.length === 0) return null;
    const [owner, repo] = (input.repository || this.repository()).split('/');
    if (!owner || !repo) return null;
    for (const tokenCandidate of tokens) {
      try {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/ref/${encodeURIComponent(input.ref)}`,
          { headers: this.headers(tokenCandidate.value) },
        );
        if (!resp.ok) continue;
        const body = await resp.json();
        if (body?.object?.sha) return String(body.object.sha);
      } catch (e) {
        this.logger?.warn?.(`[github] getRefCommitSha failed: ${String(e)}`);
        continue;
      }
    }
    return null;
  }
}
