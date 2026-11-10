import type { LoggerService } from '@backstage/backend-plugin-api';
import { TerraformCloudService } from './terraformCloudService';

/**
 * GpuTerraformCloudService
 *
 * Provisions/destroys GPU VMs with CloudHub-owned Terraform Cloud workspaces.
 * Each GPU workspace is VCS-linked to the CloudHub repository and driven by a
 * per-instance `values/<vmName>.tfvars.json` file. CloudHub commits the tfvars
 * file directly to the branch and triggers the Terraform Cloud run via the HCP
 * Terraform API.
 *
 * The Terraform Cloud organization, source repository, and working directory are
 * configured for CloudHub-first deployment. The branch defaults to main and can
 * be overridden via CLOUDHUB_TFC_BRANCH.
 */

const TFC_ORGANIZATION = 'sensa-cloud-platform';
const REPOSITORY =
  process.env.CLOUDHUB_TFC_REPOSITORY ??
  process.env.TFC_REPOSITORY ??
  process.env.GITHUB_REPOSITORY ??
  'jubermohamad/platform_cloudhub';
const BRANCH =
  process.env.CLOUDHUB_TFC_BRANCH ??
  process.env.TFC_BRANCH ??
  process.env.GITHUB_REF_NAME ??
  'main';
const WORKING_DIRECTORY =
  process.env.CLOUDHUB_TFC_WORKING_DIRECTORY ??
  process.env.TFC_WORKING_DIRECTORY ??
  'infra/gpu-self-service';
const TFC_API_BASE = 'https://app.terraform.io/api/v2';

export interface GpuWorkflowDispatchInput {
  requestId: string;
  action: 'apply' | 'destroy';
  vmName: string;
  vmSize: string;
  subnetId: string;
  location: string;
  resourceGroupName: string;
  tfvarsJson: string;
}

export interface GpuWorkflowDispatchResult {
  mode: 'simulated' | 'terraform-cloud';
  repository: string;
  branch: string;
  workflowId: string;
  runId: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  htmlUrl: string;
}

export interface GpuWorkflowRunStatusResult {
  mode: 'simulated' | 'terraform-cloud';
  runId: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  htmlUrl?: string;
}

const RUN_STATUS_MAP: Record<
  string,
  { status: 'queued' | 'in_progress' | 'completed'; conclusion: string | null }
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

export class GpuTerraformCloudService {
  private readonly logger: LoggerService;
  private readonly base: TerraformCloudService;

  constructor(logger: LoggerService) {
    this.logger = logger;
    this.base = new TerraformCloudService({
      logger,
      config: {
        organization: TFC_ORGANIZATION,
        repository: REPOSITORY,
        branch: BRANCH,
        workingDirectory: WORKING_DIRECTORY,
        workspacePrefix: 'platform_cloudhub-gpu-',
        label: 'GPU VM',
        logPrefix: 'gpu-compute',
        committerName: 'CloudHub GPU Compute',
        committerEmail: 'cloudhub-gpu-compute@symphony.ai',
      },
    });
  }

  repository(): string {
    return REPOSITORY;
  }

  branch(): string {
    return BRANCH;
  }

  organization(): string {
    return TFC_ORGANIZATION;
  }

  private fixedWorkspaceName(): string | undefined {
    const value = process.env.CLOUDHUB_TFC_WORKSPACE_NAME?.trim();
    return value && value.length > 0 ? value : undefined;
  }

  private async findWorkspaceByName(name: string): Promise<string | null> {
    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${TFC_ORGANIZATION}/workspaces/${encodeURIComponent(
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

  private workspaceName(vmName: string): string {
    const fixed = this.fixedWorkspaceName();
    if (fixed) {
      return fixed;
    }
    return `platform_cloudhub-gpu-${vmName}`;
  }

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

  private configured(): boolean {
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
    const [owner, repo] = REPOSITORY.split('/');
    return { owner, repo };
  }

  // The GPU tfvars file is committed directly to the repo using the dedicated
  // GitHub Actions token that is authorized for repository writes.
  private async commitTfvars(vmName: string, tfvarsJson: string): Promise<void> {
    const { owner, repo } = this.parseRepo();
    const path = `${WORKING_DIRECTORY}/values/${vmName}.tfvars.json`;
    const headers = this.githubHeaders();

    const existingResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(
        BRANCH,
      )}`,
      { headers },
    );
    const existingSha =
      existingResp.ok
        ? ((await existingResp.json())?.sha as string | undefined)
        : undefined;

    const putResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `chore(gpu-compute): request GPU VM ${vmName}`,
          content: Buffer.from(tfvarsJson, 'utf8').toString('base64'),
          branch: BRANCH,
          ...(existingSha ? { sha: existingSha } : {}),
          committer: {
            name: 'CloudHub GPU Compute',
            email: 'cloudhub-gpu-compute@symphony.ai',
          },
        }),
      },
    );
    if (!putResp.ok) {
      const text = await putResp.text();
      throw new Error(
        `Failed to commit GPU tfvars (${putResp.status}): ${
          text || putResp.statusText
        }`,
      );
    }
  }

  // ─── Terraform Cloud: workspace + run management ──────────────────────────

  private async findWorkspace(vmName: string): Promise<string | null> {
    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${TFC_ORGANIZATION}/workspaces/${this.workspaceName(
        vmName,
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

  private maskTokenId(value?: string | null): string {
    if (!value) return '[missing]';
    if (value.length <= 8) return '[masked]';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private async findProjectByName(name: string): Promise<string | null> {
    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${TFC_ORGANIZATION}/projects`,
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
    const tfvarsFile = `${WORKING_DIRECTORY}/values/${vmName}.tfvars.json`;
    const oauthTokenId = this.oauthTokenId();
    const projectId = await this.findProjectByName('CloudHub');

    this.logger.debug?.(
      '[gpu-compute] Terraform Cloud workspace bootstrap',
      {
        workspaceName: name,
        repositoryIdentifier: REPOSITORY,
        projectId,
        oauthTokenId: this.maskTokenId(oauthTokenId),
        workingDirectory: WORKING_DIRECTORY,
      },
    );

    const payload = {
      data: {
        type: 'workspaces',
        attributes: {
          name,
          'working-directory': WORKING_DIRECTORY,
          'auto-apply': true,
          'trigger-patterns': [tfvarsFile, `${WORKING_DIRECTORY}/main.tf`],
          'vcs-repo': {
            identifier: REPOSITORY,
            branch: BRANCH,
            'oauth-token-id': oauthTokenId,
          },
        },
        relationships: projectId
          ? {
              project: { data: { type: 'projects', id: projectId } },
            }
          : undefined,
      },
    };

    const resp = await fetch(
      `${TFC_API_BASE}/organizations/${TFC_ORGANIZATION}/workspaces`,
      {
        method: 'POST',
        headers: this.tfcHeaders(),
        body: JSON.stringify(payload),
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
          `[gpu-compute] Terraform Cloud workspace creation failed (422): ${JSON.stringify({
            workspaceName: name,
            repositoryIdentifier: REPOSITORY,
            oauthTokenId: this.maskTokenId(oauthTokenId),
            projectId: '[not-set]',
            workingDirectory: WORKING_DIRECTORY,
            isRepositoryAccessError: isRepositoryError,
            responseBody: text || resp.statusText,
          })}`,
        );

        if (isRepositoryError) {
          this.logger.error(
            `[gpu-compute] REPOSITORY ACCESS ISSUE: The Terraform Cloud OAuth token does not have access to "${REPOSITORY}". ` +
            `To fix this: (1) Ensure the repository is connected to Terraform Cloud's VCS provider in organization "${TFC_ORGANIZATION}", ` +
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

    // Without TF_CLI_ARGS the workspace plans with no values file, so the run
    // would apply module defaults instead of the requested VM. Surface a
    // failure here rather than letting it look like a successful dispatch.
    const varResp = await fetch(
      `${TFC_API_BASE}/workspaces/${workspaceId}/vars`,
      {
        method: 'POST',
        headers: this.tfcHeaders(),
        body: JSON.stringify({
          data: {
            type: 'vars',
            attributes: {
              key: 'TF_CLI_ARGS',
              value: `-var-file=values/${vmName}.tfvars.json`,
              category: 'env',
              description: 'Values file (CloudHub GPU Compute)',
            },
          },
        }),
      },
    );
    if (!varResp.ok) {
      this.logger.error(
        `[gpu-compute] Failed to set TF_CLI_ARGS on workspace ${name} (${varResp.status}); the workspace will plan without its values file`,
      );
    }

    return workspaceId;
  }

  private async ensureWorkspace(vmName: string): Promise<string> {
    const fixed = this.fixedWorkspaceName();
    if (fixed) {
      const existing = await this.findWorkspaceByName(fixed);
      if (!existing) {
        throw new Error(
          `Terraform Cloud workspace "${fixed}" was configured via CLOUDHUB_TFC_WORKSPACE_NAME but does not exist in organization ${TFC_ORGANIZATION}.`,
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
    input: GpuWorkflowDispatchInput,
  ): Promise<GpuWorkflowDispatchResult> {
    if (!this.configured()) {
      const runId = `sim-${Date.now()}`;
      this.logger.warn(
        `[gpu-compute] Terraform Cloud provisioning is not configured; falling back to simulated dispatch for ${input.vmName}. Required: CLOUDHUB_TFC_TOKEN, CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID, and GITHUB_TOKEN (or GITHUB_ACTIONS_TOKEN).`,
      );
      return {
        mode: 'simulated',
        repository: REPOSITORY,
        branch: BRANCH,
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
        message: `CloudHub GPU Compute destroy (request ${input.requestId})`,
      });
      const mapped = RUN_STATUS_MAP[run.status] ?? {
        status: 'queued' as const,
        conclusion: null,
      };
      return {
        mode: 'terraform-cloud',
        repository: REPOSITORY,
        branch: BRANCH,
        workflowId: this.workspaceName(input.vmName),
        runId: run.id,
        status: mapped.status,
        conclusion: mapped.conclusion,
        htmlUrl: `https://app.terraform.io/app/${TFC_ORGANIZATION}/workspaces/${this.workspaceName(
          input.vmName,
        )}/runs/${run.id}`,
      };
    }

    let workspaceId: string;
    try {
      workspaceId = await this.ensureWorkspace(input.vmName);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (
        this.fixedWorkspaceName() &&
        message.includes('CLOUDHUB_TFC_WORKSPACE_NAME')
      ) {
        throw error;
      }
      if (/(404|Not Found|not found|does not exist)/i.test(message)) {
        const runId = `sim-${Date.now()}`;
        this.logger.warn(
          `[gpu-compute] Terraform workspace bootstrap unavailable; falling back to simulated dispatch for ${input.vmName}. Repository=${REPOSITORY} branch=${BRANCH} reason=${message}`,
        );
        return {
          mode: 'simulated',
          repository: REPOSITORY,
          branch: BRANCH,
          workflowId: this.workspaceName(input.vmName),
          runId,
          status: 'queued',
          conclusion: null,
          htmlUrl: '',
        };
      }
      throw error;
    }

    try {
      await this.commitTfvars(input.vmName, input.tfvarsJson);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (/(404|Not Found|not found|No commit found|does not exist)/i.test(message)) {
        const runId = `sim-${Date.now()}`;
        this.logger.warn(
          `[gpu-compute] Terraform repo unavailable or tfvars path missing; falling back to simulated dispatch for ${input.vmName}. Repository=${REPOSITORY} branch=${BRANCH} workingDirectory=${WORKING_DIRECTORY} reason=${message}`,
        );
        return {
          mode: 'simulated',
          repository: REPOSITORY,
          branch: BRANCH,
          workflowId: this.workspaceName(input.vmName),
          runId,
          status: 'queued',
          conclusion: null,
          htmlUrl: '',
        };
      }
      throw error;
    }

    // The commit above matches this workspace's trigger-patterns, so
    // Terraform Cloud queues a run automatically via VCS ingress. Poll for
    // it briefly so we can return a run id right away.
    const run = await this.waitForCurrentRun(workspaceId);
    if (!run) {
      throw new Error(
        'GPU tfvars committed but Terraform Cloud run was not discovered yet; check the workspace in a few seconds',
      );
    }
    const mapped = RUN_STATUS_MAP[run.status] ?? {
      status: 'queued' as const,
      conclusion: null,
    };
    return {
      mode: 'terraform-cloud',
      repository: REPOSITORY,
      branch: BRANCH,
      workflowId: this.workspaceName(input.vmName),
      runId: run.id,
      status: mapped.status,
      conclusion: mapped.conclusion,
      htmlUrl: `https://app.terraform.io/app/${TFC_ORGANIZATION}/workspaces/${this.workspaceName(
        input.vmName,
      )}/runs/${run.id}`,
    };
  }

  async runStatus(runId: string): Promise<GpuWorkflowRunStatusResult> {
    if (runId.startsWith('sim-')) {
      throw new Error(
        'Simulated run identifiers are not supported in production mode.',
      );
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
    const status = body?.data?.attributes?.status;
    const mapped = RUN_STATUS_MAP[status] ?? {
      status: 'in_progress' as const,
      conclusion: null,
    };
    return {
      mode: 'terraform-cloud',
      runId,
      status: mapped.status,
      conclusion: mapped.conclusion,
    };
  }

  async runLogs(runId: string) {
    return this.base.runLogs(runId);
  }
}
