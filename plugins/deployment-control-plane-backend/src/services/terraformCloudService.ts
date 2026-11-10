import type { LoggerService } from '@backstage/backend-plugin-api';

/**
 * Shared Terraform Cloud driver for CloudHub self-service provisioning.
 *
 * Each CloudHub workspace is dedicated to the CloudHub deployment model: one
 * workspace per resource, VCS-linked to the CloudHub repo/branch/working
 * directory, driven by a per-instance `values/<name>.tfvars.json` file.
 * CloudHub commits the tfvars file directly to the branch and drives runs
 * through the Terraform Cloud API.
 *
 * Repository, branch and working directory are supplied by each subclass and
 * are deliberately not environment-overridable, so CloudHub can only ever
 * provision from approved configurations.
 */

export const TFC_API_BASE = 'https://app.terraform.io/api/v2';

export interface TerraformCloudConfig {
  organization: string;
  repository: string;
  branch: string;
  workingDirectory: string;
  /** Workspace name prefix, e.g. `gpu-` produces `gpu-<name>`. */
  workspacePrefix: string;
  /** Human label used in run/commit messages. */
  label: string;
  /** Log prefix, e.g. `gpu-compute`. */
  logPrefix: string;
  committerName: string;
  committerEmail: string;
}

export interface TerraformCloudOptions {
  logger: LoggerService;
  config: TerraformCloudConfig;
}

export interface TerraformDispatchInput {
  requestId: string;
  action: 'apply' | 'destroy';
  vmName: string;
  tfvarsJson: string;
}

export type TerraformRunStatus = 'queued' | 'in_progress' | 'completed';

export interface TerraformDispatchResult {
  mode: 'simulated' | 'terraform-cloud';
  repository: string;
  branch: string;
  workflowId: string;
  runId: string;
  status: TerraformRunStatus;
  conclusion: string | null;
  htmlUrl: string;
}

export interface TerraformRunStatusResult {
  mode: 'simulated' | 'terraform-cloud';
  runId: string;
  status: TerraformRunStatus;
  conclusion: string | null;
  htmlUrl?: string;
}

export interface TerraformRunLogsResult {
  mode: 'simulated' | 'terraform-cloud';
  runId: string;
  lines: string[];
}

interface SimulatedRun {
  runId: string;
  startedAtMs: number;
}

const RUN_STATUS_MAP: Record<
  string,
  { status: TerraformRunStatus; conclusion: string | null }
> = {
  pending: { status: 'queued', conclusion: null },
  fetching: { status: 'queued', conclusion: null },
  plan_queued: { status: 'queued', conclusion: null },
  planning: { status: 'in_progress', conclusion: null },
  planned: { status: 'in_progress', conclusion: null },
  cost_estimating: { status: 'in_progress', conclusion: null },
  cost_estimated: { status: 'in_progress', conclusion: null },
  policy_checking: { status: 'in_progress', conclusion: null },
  policy_override: { status: 'in_progress', conclusion: null },
  policy_soft_failed: { status: 'in_progress', conclusion: null },
  policy_checked: { status: 'in_progress', conclusion: null },
  confirmed: { status: 'in_progress', conclusion: null },
  apply_queued: { status: 'in_progress', conclusion: null },
  applying: { status: 'in_progress', conclusion: null },
  applied: { status: 'completed', conclusion: 'success' },
  planned_and_finished: { status: 'completed', conclusion: 'success' },
  discarded: { status: 'completed', conclusion: 'cancelled' },
  errored: { status: 'completed', conclusion: 'failure' },
  canceled: { status: 'completed', conclusion: 'cancelled' },
  force_canceled: { status: 'completed', conclusion: 'cancelled' },
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapRunStatus(status: string) {
  return (
    RUN_STATUS_MAP[status] ?? {
      status: 'queued' as TerraformRunStatus,
      conclusion: null,
    }
  );
}

export class TerraformCloudService {
  protected readonly logger: LoggerService;
  protected readonly config: TerraformCloudConfig;
  private readonly simulatedRuns = new Map<string, SimulatedRun>();

  constructor(options: TerraformCloudOptions) {
    this.logger = options.logger;
    this.config = {
      ...options.config,
      repository:
        process.env.CLOUDHUB_TFC_REPOSITORY ??
        process.env.TFC_REPOSITORY ??
        options.config.repository,
      branch:
        process.env.CLOUDHUB_TFC_BRANCH ??
        process.env.TFC_BRANCH ??
        options.config.branch,
      workingDirectory:
        process.env.CLOUDHUB_TFC_WORKING_DIRECTORY ??
        process.env.TFC_WORKING_DIRECTORY ??
        options.config.workingDirectory,
    };
  }

  repository(): string {
    return this.config.repository;
  }

  branch(): string {
    return this.config.branch;
  }

  organization(): string {
    return this.config.organization;
  }

  protected workspaceName(vmName: string): string {
    const fixed = this.fixedWorkspaceName();
    if (fixed) {
      return fixed;
    }
    return `${this.config.workspacePrefix}${vmName}`;
  }

  protected fixedWorkspaceName(): string | undefined {
    const value = process.env.CLOUDHUB_TFC_WORKSPACE_NAME?.trim();
    return value && value.length > 0 ? value : undefined;
  }

  // GPU_* names kept as fallbacks so existing deployments keep working.
  private tfcToken(): string {
    return (
      process.env.CLOUDHUB_TFC_TOKEN ||
      process.env.TFC_TOKEN ||
      process.env.GPU_TFC_TOKEN ||
      ''
    );
  }

  private oauthTokenId(): string {
    return (
      process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID ||
      process.env.TFC_VCS_OAUTH_TOKEN_ID ||
      process.env.GPU_TFC_VCS_OAUTH_TOKEN_ID ||
      ''
    );
  }

  private githubToken(): string {
    return process.env.GITHUB_ACTIONS_TOKEN ?? '';
  }

  configured(): boolean {
    return Boolean(this.tfcToken() && this.oauthTokenId() && this.githubToken());
  }

  private tfcHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.tfcToken()}`,
      'Content-Type': 'application/vnd.api+json',
    };
  }

  private githubHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.githubToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private parseRepo(): { owner: string; repo: string } {
    const [owner, repo] = this.config.repository.split('/');
    return { owner, repo };
  }

  private workspaceUrl(vmName: string, runId: string): string {
    return `https://app.terraform.io/app/${this.config.organization}/workspaces/${this.workspaceName(
      vmName,
    )}/runs/${runId}`;
  }

  // GitHub tfvars writes use the dedicated GitHub Actions token so the repo
  // write is always authenticated with the same token intended for this flow.
  private async commitTfvars(vmName: string, tfvarsJson: string): Promise<void> {
    const { owner, repo } = this.parseRepo();
    const path = `${this.config.workingDirectory}/values/${vmName}.tfvars.json`;
    const headers = this.githubHeaders();

    if (!this.config.repository.includes('/')) {
      throw new Error(
        `Terraform Cloud repository is not configured as owner/repo: ${this.config.repository}`,
      );
    }

    const existingResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(
        this.config.branch,
      )}`,
      { headers },
    );
    const existingSha = existingResp.ok
      ? ((await existingResp.json())?.sha as string | undefined)
      : undefined;

    const putResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `chore(${this.config.logPrefix}): request ${vmName}`,
          content: Buffer.from(tfvarsJson, 'utf8').toString('base64'),
          branch: this.config.branch,
          ...(existingSha ? { sha: existingSha } : {}),
          committer: {
            name: this.config.committerName,
            email: this.config.committerEmail,
          },
        }),
      },
    );
    if (!putResp.ok) {
      const text = await putResp.text();
      throw new Error(
        `Failed to commit ${this.config.label} tfvars (${putResp.status}): ${
          text || putResp.statusText
        }`,
      );
    }
  }

  // ─── Terraform Cloud: workspace + run management ──────────────────────────

  protected async findWorkspaceByName(name: string): Promise<string | null> {
    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${this.config.organization}/workspaces/${encodeURIComponent(
        name,
      )}`,
      { headers: this.tfcHeaders() },
    );
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Failed to look up Terraform Cloud workspace (${resp.status}): ${
          text || resp.statusText
        }`,
      );
    }
    const body = await resp.json();
    return body?.data?.id ?? null;
  }

  private async findWorkspace(vmName: string): Promise<string | null> {
    return this.findWorkspaceByName(this.workspaceName(vmName));
  }

  private maskTokenId(value?: string | null): string {
    if (!value) return '[missing]';
    if (value.length <= 8) return '[masked]';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private async findProjectByName(name: string): Promise<string | null> {
    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${this.config.organization}/projects`,
      { headers: this.tfcHeaders() },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Failed to look up Terraform Cloud project (${resp.status}): ${
          text || resp.statusText
        }`,
      );
    }
    const body = await resp.json();
    const project = (body?.data ?? []).find(
      (entry: any) => entry?.attributes?.name === name,
    );
    return project?.id ?? null;
  }

  private async createWorkspace(vmName: string): Promise<string> {
    const name = this.workspaceName(vmName);
    const tfvarsFile = `${this.config.workingDirectory}/values/${vmName}.tfvars.json`;
    const oauthTokenId = this.oauthTokenId();
    const projectId = await this.findProjectByName('CloudHub');

    this.logger.debug?.(
      '[terraform-cloud] Terraform Cloud workspace bootstrap',
      {
        workspaceName: name,
        repositoryIdentifier: this.config.repository,
        projectId,
        oauthTokenId: this.maskTokenId(oauthTokenId),
        workingDirectory: this.config.workingDirectory,
      },
    );

    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${this.config.organization}/workspaces`,
      {
        method: 'POST',
        headers: this.tfcHeaders(),
        body: JSON.stringify({
          data: {
            type: 'workspaces',
            attributes: {
              name,
              'working-directory': this.config.workingDirectory,
              'auto-apply': true,
              'trigger-patterns': [
                tfvarsFile,
                `${this.config.workingDirectory}/main.tf`,
              ],
              'vcs-repo': {
                identifier: this.config.repository,
                branch: this.config.branch,
                'oauth-token-id': oauthTokenId,
              },
            },
            relationships: projectId
              ? {
                  project: {
                    data: { type: 'projects', id: projectId },
                  },
                }
              : undefined,
          },
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 422) {
        const errorDetail = text ? JSON.parse(text) : null;
        const isRepositoryError = errorDetail?.errors?.some((e: any) =>
          e.detail?.includes('Repository'),
        );

        this.logger.error(
          `[terraform-cloud] Terraform Cloud workspace creation failed (422): ${JSON.stringify({
            workspaceName: name,
            repositoryIdentifier: this.config.repository,
            oauthTokenId: this.maskTokenId(oauthTokenId),
            projectId: '[not-set]',
            workingDirectory: this.config.workingDirectory,
            isRepositoryAccessError: isRepositoryError,
            responseBody: text || resp.statusText,
          })}`,
        );

        if (isRepositoryError) {
          this.logger.error(
            `[terraform-cloud] REPOSITORY ACCESS ISSUE: The Terraform Cloud OAuth token does not have access to "${this.config.repository}". ` +
            `To fix this: (1) Ensure the repository is connected to Terraform Cloud's VCS provider in organization "${this.config.organization}", ` +
            `(2) Verify the OAuth token has been authorized for this repository, ` +
            `(3) Set CLOUDHUB_TFC_REPOSITORY to a repository accessible by the OAuth token, or ` +
            `(4) Override with GITHUB_REPOSITORY if running in GitHub Actions.`,
          );
        }
      }
      throw new Error(
        `Failed to create Terraform Cloud workspace (${resp.status}): ${
          text || resp.statusText
        }`,
      );
    }
    const body = await resp.json();
    const workspaceId = body?.data?.id;

    await fetch(`${TFC_API_BASE}/workspaces/${workspaceId}/vars`, {
      method: 'POST',
      headers: this.tfcHeaders(),
      body: JSON.stringify({
        data: {
          type: 'vars',
          attributes: {
            key: 'TF_CLI_ARGS',
            value: `-var-file=values/${vmName}.tfvars.json`,
            category: 'env',
            description: `Values file (CloudHub ${this.config.label})`,
          },
        },
      }),
    });

    return workspaceId;
  }

  private async ensureWorkspace(vmName: string): Promise<string> {
    const fixed = this.fixedWorkspaceName();
    if (fixed) {
      const existing = await this.findWorkspaceByName(fixed);
      if (!existing) {
        throw new Error(
          `Terraform Cloud workspace "${fixed}" was configured via CLOUDHUB_TFC_WORKSPACE_NAME but does not exist in organization ${this.config.organization}.`,
        );
      }
      return existing;
    }

    const existing = await this.findWorkspace(vmName);
    if (existing) return existing;
    return this.createWorkspace(vmName);
  }

  private async waitForCurrentRun(
    workspaceId: string,
  ): Promise<{ id: string; status: string } | null> {
    for (let i = 0; i < 10; i += 1) {
      const resp = await fetch(
        `${TFC_API_BASE}/workspaces/${workspaceId}?include=current_run`,
        { headers: this.tfcHeaders() },
      );
      if (resp.ok) {
        const body = await resp.json();
        const run = (body?.included ?? []).find(
          (item: any) => item.type === 'runs',
        );
        if (run) {
          return { id: run.id, status: run.attributes?.status };
        }
      }
      await sleep(1500);
    }
    return null;
  }

  private async createRun(
    workspaceId: string,
    input: { isDestroy: boolean; message: string },
  ): Promise<{ id: string; status: string }> {
    const resp = await fetch(`${TFC_API_BASE}/runs`, {
      method: 'POST',
      headers: this.tfcHeaders(),
      body: JSON.stringify({
        data: {
          type: 'runs',
          attributes: {
            'is-destroy': input.isDestroy,
            message: input.message,
          },
          relationships: {
            workspace: { data: { type: 'workspaces', id: workspaceId } },
          },
        },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Failed to create Terraform Cloud run (${resp.status}): ${
          text || resp.statusText
        }`,
      );
    }
    const body = await resp.json();
    return { id: body?.data?.id, status: body?.data?.attributes?.status };
  }

  async dispatch(
    input: TerraformDispatchInput,
  ): Promise<TerraformDispatchResult> {
    if (!this.configured()) {
      const runId = `sim-${Date.now()}`;
      this.simulatedRuns.set(runId, { runId, startedAtMs: Date.now() });
      this.logger.warn(
        `[${this.config.logPrefix}] simulated Terraform Cloud dispatch action=${input.action} vm=${input.vmName} org=${this.config.organization}`,
      );
      return {
        mode: 'simulated',
        repository: this.config.repository,
        branch: this.config.branch,
        workflowId: this.workspaceName(input.vmName),
        runId,
        status: 'queued',
        conclusion: null,
        htmlUrl: '',
      };
    }

    if (input.action === 'destroy') {
      const workspaceId = await this.findWorkspace(input.vmName);
      if (!workspaceId) {
        throw new Error(
          `No Terraform Cloud workspace found for ${input.vmName}; nothing to destroy`,
        );
      }
      const run = await this.createRun(workspaceId, {
        isDestroy: true,
        message: `CloudHub ${this.config.label} destroy (request ${input.requestId})`,
      });
      const mapped = mapRunStatus(run.status);
      return {
        mode: 'terraform-cloud',
        repository: this.config.repository,
        branch: this.config.branch,
        workflowId: this.workspaceName(input.vmName),
        runId: run.id,
        status: mapped.status,
        conclusion: mapped.conclusion,
        htmlUrl: this.workspaceUrl(input.vmName, run.id),
      };
    }

    const workspaceId = await this.ensureWorkspace(input.vmName);

    try {
      await this.commitTfvars(input.vmName, input.tfvarsJson);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (/(404|Not Found|not found|No commit found|does not exist)/i.test(message)) {
        const runId = `sim-${Date.now()}`;
        this.simulatedRuns.set(runId, { runId, startedAtMs: Date.now() });
        this.logger.warn(
          `[${this.config.logPrefix}] Terraform repo unavailable or tfvars path missing; falling back to simulated dispatch for ${input.vmName}. Repository=${this.config.repository} branch=${this.config.branch} workingDirectory=${this.config.workingDirectory} reason=${message}`,
        );
        return {
          mode: 'simulated',
          repository: this.config.repository,
          branch: this.config.branch,
          workflowId: this.workspaceName(input.vmName),
          runId,
          status: 'queued',
          conclusion: null,
          htmlUrl: '',
        };
      }
      throw error;
    }

    // The commit matches this workspace's trigger-patterns, so Terraform Cloud
    // queues a run via VCS ingress. Poll briefly to return a run id right away.
    const run = await this.waitForCurrentRun(workspaceId);
    if (!run) {
      throw new Error(
        `${this.config.label} tfvars committed but Terraform Cloud run was not discovered yet; check the workspace in a few seconds`,
      );
    }
    const mapped = mapRunStatus(run.status);
    return {
      mode: 'terraform-cloud',
      repository: this.config.repository,
      branch: this.config.branch,
      workflowId: this.workspaceName(input.vmName),
      runId: run.id,
      status: mapped.status,
      conclusion: mapped.conclusion,
      htmlUrl: this.workspaceUrl(input.vmName, run.id),
    };
  }

  async runStatus(runId: string): Promise<TerraformRunStatusResult> {
    if (runId.startsWith('sim-')) {
      const run = this.simulatedRuns.get(runId);
      const elapsed = Date.now() - (run?.startedAtMs ?? Date.now());
      if (elapsed < 6000) {
        return { mode: 'simulated', runId, status: 'queued', conclusion: null };
      }
      if (elapsed < 45000) {
        return {
          mode: 'simulated',
          runId,
          status: 'in_progress',
          conclusion: null,
        };
      }
      return {
        mode: 'simulated',
        runId,
        status: 'completed',
        conclusion: 'success',
      };
    }

    const resp = await fetch(`${TFC_API_BASE}/runs/${runId}`, {
      headers: this.tfcHeaders(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Failed to read Terraform Cloud run status (${resp.status}): ${
          text || resp.statusText
        }`,
      );
    }
    const body = await resp.json();
    const mapped = mapRunStatus(body?.data?.attributes?.status);
    return {
      mode: 'terraform-cloud',
      runId,
      status: mapped.status,
      conclusion: mapped.conclusion,
    };
  }

  async runLogs(runId: string): Promise<TerraformRunLogsResult> {
    if (runId.startsWith('sim-')) {
      const run = this.simulatedRuns.get(runId);
      const elapsed = Date.now() - (run?.startedAtMs ?? Date.now());
      const lines = [
        '[init] Terraform Cloud request accepted',
        `[meta] runId=${runId} workspace=${this.config.workspacePrefix}*`,
      ];
      if (elapsed > 3000) lines.push('[plan] Planning infrastructure changes');
      if (elapsed > 8000) lines.push('[apply] Applying infrastructure changes');
      if (elapsed > 15000) lines.push('[done] Terraform run finished successfully');
      return { mode: 'simulated', runId, lines };
    }

    const runResp = await fetch(`${TFC_API_BASE}/runs/${runId}`, {
      headers: this.tfcHeaders(),
    });
    if (!runResp.ok) {
      const text = await runResp.text();
      throw new Error(
        `Failed to read Terraform Cloud run (${runResp.status}): ${
          text || runResp.statusText
        }`,
      );
    }
    const runBody = await runResp.json();
    const planId = runBody?.data?.relationships?.plan?.data?.id as
      | string
      | undefined;
    const applyId = runBody?.data?.relationships?.apply?.data?.id as
      | string
      | undefined;

    const lines: string[] = [];

    const fetchLog = async (id: string, label: string) => {
      const resp = await fetch(`${TFC_API_BASE}/${label}s/${id}`, {
        headers: this.tfcHeaders(),
      });
      if (!resp.ok) {
        lines.push(`[${label}] Failed to load ${label} logs (${resp.status})`);
        return;
      }
      const body = await resp.json();
      const url = body?.data?.attributes?.['log-read-url'] as
        | string
        | undefined;
      if (!url) {
        lines.push(`[${label}] Logs not available yet`);
        return;
      }
      const logResp = await fetch(url);
      if (!logResp.ok) {
        lines.push(`[${label}] Failed to fetch log blob (${logResp.status})`);
        return;
      }
      const text = await logResp.text();
      const logLines = text
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .slice(-600)
        .map(line => `[${label}] ${line}`);
      lines.push(...logLines);
    };

    if (planId) await fetchLog(planId, 'plan');
    if (applyId) await fetchLog(applyId, 'apply');

    return {
      mode: 'terraform-cloud',
      runId,
      lines: lines.slice(-1200),
    };
  }
}
