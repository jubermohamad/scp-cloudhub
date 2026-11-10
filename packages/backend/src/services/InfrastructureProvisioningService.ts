import type { LoggerService } from '@backstage/backend-plugin-api';
import { Octokit } from '@octokit/rest';
import { baseUrlFor } from './readOnlyHttp';
import {
  AKS_STANDARD_ROOT,
  AKS_VALUES_DIR as STANDARD_VALUES_DIR,
  AKS_WORKSPACES_FILE,
  deriveAksNames,
  findAksWorkspaceEntry,
  normalizeAksClusterRequest,
  renderAksValuesFile,
  validateAksClusterRequest,
  type AksClusterRequest,
  type AksClusterRequestErrors,
} from '@internal/plugin-platform-common/backend';

// AKS clusters are created by the SCP IaC automation: a values file under
// azure-kubernetes-service-standard/values/ plus a workspacemanager entry,
// merged into main of SymphonySensa/scp-infra-as-code, after which Terraform
// Cloud creates the workspace and runs plan/apply (docs/aks-workflow-audit.md,
// decisions D1/D2). INFRA_REPO is the only override; the old fallbacks to the
// CloudHub repo (SRI_PIPELINE_REPO / GITHUB_ACTIONS_REPO) are intentionally
// gone so a deployment cannot silently keep committing into the wrong repo.
export const INFRA_REPOSITORY =
  process.env.INFRA_REPO ?? 'SymphonySensa/scp-infra-as-code';
const [GITHUB_OWNER = 'SymphonySensa', GITHUB_REPO = 'scp-infra-as-code'] =
  INFRA_REPOSITORY.split('/');
// main is the single source of truth. Every request cuts a dedicated feature
// branch from main and opens a PR back into main.
export const BASE_BRANCH = process.env.GITHUB_BASE_BRANCH ?? 'main';
const BASE_BRANCH_REF = `heads/${BASE_BRANCH}`;
export const WORKSPACES_FILE = AKS_WORKSPACES_FILE;
export const AKS_VALUES_DIR = STANDARD_VALUES_DIR;

export interface ValidationIssueSet {
  errors: string[];
  warnings: string[];
  fieldErrors: AksClusterRequestErrors;
}

export interface PlanSummary {
  resourcesToCreate: number;
  resourcesToModify: number;
  resourcesToDestroy: number;
  monthlyCost: number;
  errors: string[];
  warnings: string[];
}

export interface FeatureBranchResult {
  clusterName: string;
  tfvarsPath: string;
  featureBranch: string;
  commitSha: string;
  commitMessage: string;
  /** True when an existing branch from an earlier attempt was resumed. */
  reused: boolean;
}

/** Context written into the infrastructure PR description. */
export interface PullRequestContext {
  requestId: string;
  configFingerprint: string;
  approvals: Array<{ role: string; approver?: string; decidedAt?: string }>;
}

/**
 * Whether a values file on the branch is the approved one. Only the `created`
 * tag date may differ (a retry on a later day re-renders it).
 */
function sameValuesFile(existing: string, expected: string): boolean {
  const normalize = (text: string) =>
    text.replace(/^(\s*"created"\s*=\s*)"[^"]*"/m, '$1""').trimEnd();
  return normalize(existing) === normalize(expected);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingBrace(content: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

const SINGLE_LINE_WORKSPACE = /^( {4})("[^"]+")\s*=\s*\{\}\s*$/;

/**
 * Add `"<cluster>" = {}` to the azure-kubernetes-service-standard block of
 * workspacemanager/workspaces.tfvars, keeping the file `terraform fmt`-clean:
 * the entry joins the first run of single-line entries and the whole run is
 * re-aligned to its longest key. Throws if the workspace already exists.
 */
export function insertAksWorkspaceEntry(
  content: string,
  clusterName: string,
): string {
  const header = new RegExp(
    `^( {2})"${escapeRegex(AKS_STANDARD_ROOT)}"\\s*=\\s*\\{`,
    'm',
  );
  const match = header.exec(content);
  if (!match) {
    throw new Error(
      `${AKS_WORKSPACES_FILE} has no "${AKS_STANDARD_ROOT}" block`,
    );
  }
  const open = content.indexOf('{', match.index);
  const close = findMatchingBrace(content, open);
  if (close === -1) {
    throw new Error(`Could not parse the "${AKS_STANDARD_ROOT}" block`);
  }
  const block = content.slice(open + 1, close);
  if (new RegExp(`^\\s*"${escapeRegex(clusterName)}"\\s*=`, 'm').test(block)) {
    throw new Error(`Workspace ${clusterName} is already registered`);
  }

  const lines = block.split('\n');
  const runStart = lines.findIndex(line => SINGLE_LINE_WORKSPACE.test(line));
  const entry = `    "${clusterName}" = {}`;
  if (runStart === -1) {
    lines.splice(1, 0, entry);
  } else {
    let runEnd = runStart;
    while (
      runEnd + 1 < lines.length &&
      SINGLE_LINE_WORKSPACE.test(lines[runEnd + 1])
    ) {
      runEnd += 1;
    }
    const run = [...lines.slice(runStart, runEnd + 1), entry];
    const keys = run.map(line => SINGLE_LINE_WORKSPACE.exec(line)![2]);
    const width = Math.max(...keys.map(key => key.length));
    lines.splice(
      runStart,
      runEnd - runStart + 1,
      ...keys.map(key => `    ${key.padEnd(width)} = {}`),
    );
  }
  return `${content.slice(0, open + 1)}${lines.join('\n')}${content.slice(
    close,
  )}`;
}

/**
 * The infrastructure PR is never merged by CloudHub, and CloudHub never
 * enables GitHub auto-merge on it: the Terraform Quality Gate, a CODEOWNERS
 * review and a maintainer-controlled merge are the gate (decision D2/D3).
 * There is deliberately no configuration that changes this.
 */
export class InfrastructureProvisioningService {
  private readonly logger: LoggerService;

  private readonly octokit: Octokit | null;

  readonly mode: 'real' | 'sim';

  constructor(logger: LoggerService) {
    this.logger = logger;
    const githubToken =
      process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_TOKEN;
    this.mode = githubToken ? 'real' : 'sim';
    this.octokit = githubToken
      ? new Octokit({
          auth: githubToken,
          // Non-production only (local smoke tests against a stub).
          baseUrl: baseUrlFor(
            'CLOUDHUB_GITHUB_API_URL',
            'https://api.github.com',
          ),
        })
      : null;
  }

  /** Canonicalise untrusted input (see @internal/plugin-platform-common). */
  normalizeRequest(raw: unknown): AksClusterRequest {
    return normalizeAksClusterRequest(raw);
  }

  buildClusterName(request: AksClusterRequest): string {
    return deriveAksNames(request).clusterName;
  }

  tfvarsFilePath(request: AksClusterRequest): string {
    return deriveAksNames(request).valuesFilePath;
  }

  validateRequest(request: AksClusterRequest): ValidationIssueSet {
    const fieldErrors = validateAksClusterRequest(request);
    return {
      fieldErrors,
      errors: Object.entries(fieldErrors).map(
        ([field, message]) => `${field}: ${message}`,
      ),
      warnings: [],
    };
  }

  /**
   * No cost or resource figures are invented here. The preliminary cost
   * estimate arrives with backend preflight; the authoritative resource plan is
   * the Terraform Cloud run after merge.
   */
  estimatePlan(request: AksClusterRequest): PlanSummary {
    return {
      resourcesToCreate: 0,
      resourcesToModify: 0,
      resourcesToDestroy: 0,
      monthlyCost: 0,
      errors: this.validateRequest(request).errors,
      warnings: [
        'Cost not estimated yet; the Terraform plan is produced by Terraform Cloud after the infrastructure PR merges.',
      ],
    };
  }

  /** The exact values file the infrastructure PR will commit. */
  generateTfvars(
    request: AksClusterRequest,
    created: string = new Date().toISOString().slice(0, 10),
  ): string {
    return renderAksValuesFile(request, { created });
  }

  async preflight(): Promise<{
    ok: boolean;
    mode: 'real' | 'sim';
    reason?: string;
  }> {
    if (!this.octokit) {
      return {
        ok: false,
        mode: 'sim',
        reason:
          'GitHub credentials are not configured; set GITHUB_ACTIONS_TOKEN or GITHUB_TOKEN.',
      };
    }

    try {
      // Repo and base-branch access are hard requirements for branch/PR work.
      await this.octokit.repos.get({ owner: GITHUB_OWNER, repo: GITHUB_REPO });
      await this.octokit.git.getRef({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        ref: BASE_BRANCH_REF,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[provisioning] preflight failed: ${msg}`);
      return {
        ok: false,
        mode: 'real',
        reason: `GitHub preflight failed for ${INFRA_REPOSITORY}: ${msg}`,
      };
    }

    return { ok: true, mode: 'real' };
  }

  /**
   * Create the request's feature branch from main and commit the values file
   * and workspace registration. Does NOT open a PR.
   */
  async prepareFeatureBranch(
    request: AksClusterRequest,
  ): Promise<FeatureBranchResult> {
    if (!this.octokit) {
      throw new Error(
        'GITHUB_TOKEN is not configured; cannot create feature branch',
      );
    }

    const validation = this.validateRequest(request);
    if (validation.errors.length > 0) {
      throw new Error(
        `Invalid provisioning request: ${validation.errors.join('; ')}`,
      );
    }

    const names = deriveAksNames(request);
    const clusterName = names.clusterName;
    const tfvarsPath = names.valuesFilePath;
    const tfvarsContent = this.generateTfvars(request);
    const commitMessage = `${request.changeTicket}: create AKS cluster ${clusterName}`;

    let baseSha: string;
    try {
      baseSha = await this.getRefSha(BASE_BRANCH_REF);
    } catch (error) {
      throw this.describeFailure(`resolve base branch '${BASE_BRANCH}'`, error);
    }

    // Never overwrite an existing cluster definition.
    if (await this.fileExists(tfvarsPath, BASE_BRANCH)) {
      throw new Error(
        `${tfvarsPath} already exists on ${BASE_BRANCH}; ${clusterName} is already defined`,
      );
    }

    // CONTRIBUTING.md: <type>/SCP-<ticket>-<short-description>. The name is
    // deterministic so a retry resumes the same branch instead of creating a
    // second one.
    const featureBranch = `feature/${request.changeTicket}-create-aks-${clusterName}`;
    let branchSha: string | null;
    try {
      branchSha = await this.branchHeadSha(featureBranch);
    } catch (error) {
      throw this.describeFailure(`look up branch '${featureBranch}'`, error);
    }
    const reused = branchSha !== null;
    if (!reused) {
      try {
        await this.octokit.git.createRef({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          ref: `refs/heads/${featureBranch}`,
          sha: baseSha,
        });
      } catch (error) {
        throw this.describeFailure(
          `create feature branch '${featureBranch}'`,
          error,
        );
      }
    }
    let commitSha = branchSha ?? baseSha;

    // Values file: commit it once; an existing copy must be the approved one.
    let existingValues: { content: string; sha: string } | null;
    try {
      existingValues = await this.getFileIfExists(tfvarsPath, featureBranch);
    } catch (error) {
      throw this.describeFailure(`read '${tfvarsPath}' on the branch`, error);
    }
    if (!existingValues) {
      try {
        commitSha = await this.upsertFileWithSha({
          branch: featureBranch,
          path: tfvarsPath,
          content: tfvarsContent,
          message: commitMessage,
        });
      } catch (error) {
        throw this.describeFailure(`commit values file '${tfvarsPath}'`, error);
      }
    } else if (!sameValuesFile(existingValues.content, tfvarsContent)) {
      throw new Error(
        `Branch ${featureBranch} already holds a ${tfvarsPath} that differs from the approved configuration; resolve it in GitHub before retrying`,
      );
    }

    // Workspace registration: insert once.
    try {
      const workspaceFile = await this.getFile(WORKSPACES_FILE, featureBranch);
      if (!findAksWorkspaceEntry(workspaceFile.content, clusterName)) {
        commitSha = await this.upsertFileWithSha({
          branch: featureBranch,
          path: WORKSPACES_FILE,
          content: insertAksWorkspaceEntry(workspaceFile.content, clusterName),
          message: commitMessage,
          sha: workspaceFile.sha,
        });
      }
    } catch (error) {
      throw this.describeFailure(`update '${WORKSPACES_FILE}'`, error);
    }

    return {
      clusterName,
      tfvarsPath,
      featureBranch,
      commitSha: commitSha.slice(0, 7),
      commitMessage,
      reused,
    };
  }

  /** Open the PR from the feature branch into main. */
  async createPullRequest(
    request: AksClusterRequest,
    featureBranch: string,
    context?: PullRequestContext,
  ): Promise<{ prNumber: number; prUrl: string; reused: boolean }> {
    if (!this.octokit) {
      throw new Error(
        'GITHUB_TOKEN is not configured; cannot create pull request',
      );
    }

    const names = deriveAksNames(request);
    const clusterName = names.clusterName;

    // Adopt a PR this branch already has (retry after a lost response).
    let existing: Array<{
      number: number;
      html_url: string;
      state: string;
      merged_at?: string | null;
    }>;
    try {
      const { data } = await this.octokit.pulls.list({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        head: `${GITHUB_OWNER}:${featureBranch}`,
        base: BASE_BRANCH,
        state: 'all',
        per_page: 20,
      });
      existing = data;
    } catch (error) {
      throw this.describeFailure('look up existing pull requests', error);
    }
    const adoptable =
      existing.find(pr => pr.state === 'open') ??
      existing.find(pr => Boolean(pr.merged_at));
    if (adoptable) {
      return {
        prNumber: adoptable.number,
        prUrl: adoptable.html_url,
        reused: true,
      };
    }
    if (existing.length > 0) {
      throw new Error(
        `PR #${existing[0].number} from ${featureBranch} was closed without merging; CloudHub does not reopen or replace it automatically`,
      );
    }

    let pr: { number: number; html_url: string };
    try {
      const { data } = await this.octokit.pulls.create({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        title: `${request.changeTicket}: create AKS cluster ${clusterName}`,
        body: [
          `Automated AKS provisioning request for \`${clusterName}\`, generated by CloudHub.`,
          '',
          ...(context
            ? [
                `- CloudHub request: \`${context.requestId}\``,
                `- Approved configuration: \`${context.configFingerprint}\``,
                ...context.approvals.map(
                  stage =>
                    `- ${stage.role}: approved by \`${
                      stage.approver ?? '?'
                    }\` at ${stage.decidedAt ?? '?'}`,
                ),
                '',
              ]
            : []),
          'Changes:',
          `- \`${names.valuesFilePath}\``,
          `- \`${WORKSPACES_FILE}\` (workspace \`${names.workspaceName}\`, VCS branch \`main\`)`,
          '',
          `Derived names: RG \`${names.resourceGroupName}\`, VNet \`${names.vnetName}\`, jumpbox \`${names.jumpboxName}\`.`,
          '',
          'After merge, Terraform Cloud creates the workspace and queues a plan; the apply requires operator confirmation in Terraform Cloud.',
        ].join('\n'),
        head: featureBranch,
        base: BASE_BRANCH,
      });
      pr = data;
    } catch (error) {
      throw this.describeFailure('create pull request', error);
    }

    return { prNumber: pr.number, prUrl: pr.html_url, reused: false };
  }

  /**
   * Poll GitHub for the current state of a pull request.
   * Returns merged=true once the PR is closed with a merge commit.
   */
  async getPRStatus(
    prNumber: number,
  ): Promise<{ prState: string; merged: boolean; draft: boolean }> {
    if (!this.octokit) {
      throw new Error(
        'GitHub credentials are not configured; cannot query pull request status.',
      );
    }
    const { data } = await this.octokit.pulls.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      pull_number: prNumber,
    });
    return {
      prState: data.merged ? 'merged' : data.state,
      merged: data.merged,
      draft: data.draft ?? false,
    };
  }

  private describeFailure(action: string, error: unknown): Error {
    const status = (error as { status?: number }).status;
    const raw = error instanceof Error ? error.message : String(error);
    const suffix = status ? ` (HTTP ${status})` : '';
    this.logger.error(`[provisioning] Failed to ${action}${suffix}: ${raw}`);
    return new Error(`Failed to ${action}${suffix}: ${raw}`);
  }

  private async getRefSha(ref: string): Promise<string> {
    if (!this.octokit) {
      throw new Error('Octokit is not initialized');
    }
    const { data } = await this.octokit.git.getRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref,
    });
    return data.object.sha;
  }

  private async fileExists(path: string, ref: string): Promise<boolean> {
    if (!this.octokit) {
      throw new Error('Octokit is not initialized');
    }
    try {
      await this.octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path,
        ref,
      });
      return true;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return false;
      throw this.describeFailure(`check for existing '${path}'`, error);
    }
  }

  /** Head SHA of a branch, or null when it does not exist. */
  private async branchHeadSha(branch: string): Promise<string | null> {
    if (!this.octokit) {
      throw new Error('Octokit is not initialized');
    }
    try {
      const { data } = await this.octokit.git.getRef({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        ref: `heads/${branch}`,
      });
      return data.object.sha;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  private async getFileIfExists(
    path: string,
    branch: string,
  ): Promise<{ content: string; sha: string } | null> {
    try {
      return await this.getFile(path, branch);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  private async getFile(
    path: string,
    branch: string,
  ): Promise<{ content: string; sha: string }> {
    if (!this.octokit) {
      throw new Error('Octokit is not initialized');
    }

    const { data } = await this.octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path,
      ref: branch,
    });

    if (Array.isArray(data) || !('content' in data)) {
      throw new Error(`Expected file at ${path} but got directory listing`);
    }

    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha,
    };
  }

  private async upsertFileWithSha(input: {
    branch: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
  }): Promise<string> {
    if (!this.octokit) {
      throw new Error('Octokit is not initialized');
    }
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: input.path,
      branch: input.branch,
      message: input.message,
      sha: input.sha,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
    });
    return data.commit.sha ?? '';
  }
}

export type { AksClusterRequest };
