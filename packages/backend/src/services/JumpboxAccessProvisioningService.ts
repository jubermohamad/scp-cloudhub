/**
 * JumpboxAccessProvisioningService.ts
 *
 * Automates Tailscale jumpbox SSH access for a newly provisioned AKS cluster.
 *
 * This service is intentionally INDEPENDENT of InfrastructureProvisioningService:
 * it owns its own GitHub client and repository configuration (the Tailscale
 * policy repository) so the two provisioning concerns can evolve separately.
 *
 * Like the infrastructure service it uses the GitHub Contents API (via Octokit)
 * rather than a local `git clone`, which keeps it stateless and filesystem-free.
 * When GITHUB_TOKEN is not configured it runs in 'sim' mode and performs no
 * remote calls.
 *
 * The Tailscale policy file (policy.hujson) is HUJSON: JSON that additionally
 * permits comments and trailing commas. We parse it tolerantly, mutate the
 * object model, and re-serialise as strict JSON (which is valid HUJSON).
 */

import type { LoggerService } from '@backstage/backend-plugin-api';
import { Octokit } from '@octokit/rest';
import { baseUrlFor } from './readOnlyHttp';

/** Repository coordinates for the Tailscale policy repo. Config-driven. */
export interface JumpboxAccessConfig {
  owner: string;
  repo: string;
  baseBranch: string;
  policyPath: string;
  autoMergeEnabled?: boolean;
  autoMergeMethod?: string;
  /**
   * Commit author for policy commits. SymphonyFS/tailscale's main ruleset
   * requires a GitHub noreply author email; when unset, the noreply address
   * of the token's own GitHub user is used.
   */
  commitAuthorName?: string;
  commitAuthorEmail?: string;
}

/** SymphonyFS/tailscale ruleset "Users must use GitHub noreply address". */
export const TAILSCALE_NOREPLY_EMAIL =
  /^\d+\+[a-zA-Z0-9-]+@users\.noreply\.github\.com$/;

export const DEFAULT_JUMPBOX_CONFIG: JumpboxAccessConfig = {
  // SymphonyFS/tailscale is the live tailnet policy repo (gitops-acl-action
  // applies on push to main). SymphonySensa/tailscale is ARCHIVED and has no
  // `main` branch. See docs/aks-workflow-audit.md (D7).
  owner: process.env.TAILSCALE_REPO_OWNER ?? 'SymphonyFS',
  repo: process.env.TAILSCALE_REPO ?? 'tailscale',
  baseBranch: process.env.TAILSCALE_BASE_BRANCH ?? 'main',
  policyPath: process.env.TAILSCALE_POLICY_PATH ?? 'policy.hujson',
};

export interface JumpboxAccessRequest {
  /** Cluster the jumpbox belongs to, e.g. aks-visa-qa-aue. */
  clusterName: string;
  /** Tailscale tag/group name, e.g. jumpbox-visa-qa-aue. */
  jumpboxName: string;
  /** GitHub usernames of the cluster administrators to grant access. */
  clusterAdministrators: string[];
}

export interface JumpboxAccessResult {
  jumpboxName: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  policyPath: string;
  administrators: string[];
}

export interface TailscalePrStatus {
  state: 'open' | 'closed';
  merged: boolean;
}

/** The Tailscale ACL user that jumpbox SSH sessions run as. */
const SSH_USER = 'aksuser';
/** Session recorder tag enforced on every jumpbox SSH session. */
const SESSION_RECORDER_TAG = 'tag:session-recorder';
/** Default owner for auto-created jumpbox tags. */
const TAG_OWNER = 'autogroup:admin';

function isAutoMergeEnabled(): boolean {
  return process.env.CLOUDHUB_AUTO_MERGE_ENABLED === 'true';
}

function autoMergeMethod(): string {
  return (process.env.CLOUDHUB_AUTO_MERGE_METHOD ?? 'squash').toUpperCase();
}

/**
 * GitHub username rules (subset): 1-39 chars, alphanumeric or single hyphens,
 * cannot start/end with a hyphen. Used to reject malformed administrator input
 * before it reaches the policy file.
 */
const GITHUB_USERNAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export interface NormalizedAdmins {
  valid: string[];
  invalid: string[];
}

/**
 * Trim, drop empties, reject invalid GitHub usernames and de-duplicate
 * case-insensitively (first spelling wins). Order is preserved.
 */
export function normalizeAdministrators(admins: string[]): NormalizedAdmins {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of admins ?? []) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (!GITHUB_USERNAME_RE.test(name)) {
      invalid.push(name);
      continue;
    }
    seen.add(key);
    valid.push(name);
  }

  return { valid, invalid };
}

/** Derive the Tailscale jumpbox name from a cluster name (aks- -> jumpbox-). */
export function deriveJumpboxName(clusterName: string): string {
  const base = clusterName.trim().replace(/^aks-/, '');
  return `jumpbox-${base}`;
}

/** Map a GitHub username to its Tailscale identity. */
export function githubUserToTailscale(username: string): string {
  return `${username}@github`;
}

/**
 * Tolerantly convert HUJSON text into a plain object. Strips line comments,
 * block comments and trailing commas, then JSON.parse. Throws on invalid input.
 */
export function parseHujson(content: string): Record<string, any> {
  const withoutComments = stripHujsonComments(content);
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(withoutTrailingCommas) as Record<string, any>;
}

/** Serialise a policy object back to HUJSON (strict JSON is valid HUJSON). */
export function serializeHujson(policy: Record<string, any>): string {
  return `${JSON.stringify(policy, null, 2)}\n`;
}

/**
 * Remove // line comments and block comments without corrupting string
 * literals (which may legitimately contain // or /* sequences).
 */
function stripHujsonComments(content: string): string {
  let out = '';
  let inString = false;
  let stringQuote = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Preserve escaped character verbatim.
        out += next ?? '';
        i += 1;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  return out;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function includesValue(value: unknown, needle: string): boolean {
  return asArray(value).includes(needle);
}

export interface PolicyUpdateInput {
  jumpboxName: string;
  administrators: string[];
}

/**
 * Apply the jumpbox access grant to a parsed policy object in place and return
 * it. Ensures the tag owner, group membership, port-22 ACL and recorded SSH
 * rule all exist. Idempotent: re-running with the same input is a no-op beyond
 * refreshing the group membership.
 */
export function applyJumpboxPolicy(
  policy: Record<string, any>,
  input: PolicyUpdateInput,
): Record<string, any> {
  const tag = `tag:${input.jumpboxName}`;
  const group = `group:${input.jumpboxName}`;
  const users = input.administrators.map(githubUserToTailscale);

  // tagOwners: ensure the jumpbox tag is declared.
  policy.tagOwners = policy.tagOwners ?? {};
  if (!policy.tagOwners[tag]) {
    policy.tagOwners[tag] = [TAG_OWNER];
  }

  // groups: set the administrator membership (authoritative, de-duplicated).
  policy.groups = policy.groups ?? {};
  policy.groups[group] = users;

  // acls: allow the group to reach the jumpbox on SSH (port 22).
  policy.acls = asArray(policy.acls);
  const aclExists = (policy.acls as any[]).some(
    rule =>
      rule?.action === 'accept' &&
      includesValue(rule?.src, group) &&
      includesValue(rule?.dst, `${tag}:22`),
  );
  if (!aclExists) {
    (policy.acls as any[]).push({
      action: 'accept',
      src: [group],
      dst: [`${tag}:22`],
    });
  }

  // ssh: recorded SSH access as the aksuser, recorder enforced.
  policy.ssh = asArray(policy.ssh);
  const sshExists = (policy.ssh as any[]).some(
    rule =>
      rule?.action === 'accept' &&
      includesValue(rule?.src, group) &&
      includesValue(rule?.dst, tag),
  );
  if (!sshExists) {
    (policy.ssh as any[]).push({
      action: 'accept',
      src: [group],
      dst: [tag],
      users: [SSH_USER],
      recorder: [SESSION_RECORDER_TAG],
      enforceRecorder: true,
    });
  }

  return policy;
}

export interface PolicyValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate that a serialised policy is well-formed HUJSON and contains a
 * complete, correct jumpbox grant for the given administrators.
 */
export function validateJumpboxPolicy(
  content: string,
  input: PolicyUpdateInput,
): PolicyValidationResult {
  const errors: string[] = [];
  const tag = `tag:${input.jumpboxName}`;
  const group = `group:${input.jumpboxName}`;
  const expectedUsers = input.administrators.map(githubUserToTailscale);

  let policy: Record<string, any>;
  try {
    policy = parseHujson(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`policy is not valid HUJSON: ${msg}`] };
  }

  if (!policy.tagOwners?.[tag]) {
    errors.push(`tagOwners is missing ${tag}`);
  }

  const groupMembers = asArray(policy.groups?.[group]).map(String);
  if (groupMembers.length === 0) {
    errors.push(`groups is missing ${group}`);
  } else {
    for (const user of expectedUsers) {
      if (!groupMembers.includes(user)) {
        errors.push(`${group} is missing administrator ${user}`);
      }
    }
    const lowered = groupMembers.map(m => m.toLowerCase());
    const dupes = lowered.filter((m, idx) => lowered.indexOf(m) !== idx);
    if (dupes.length > 0) {
      errors.push(
        `${group} contains duplicate members: ${[...new Set(dupes)].join(
          ', ',
        )}`,
      );
    }
  }

  const aclOk = asArray(policy.acls).some(
    (rule: any) =>
      rule?.action === 'accept' &&
      includesValue(rule?.src, group) &&
      includesValue(rule?.dst, `${tag}:22`),
  );
  if (!aclOk) {
    errors.push(`acls is missing accept ${group} -> ${tag}:22`);
  }

  const sshRule = asArray(policy.ssh).find(
    (rule: any) =>
      rule?.action === 'accept' &&
      includesValue(rule?.src, group) &&
      includesValue(rule?.dst, tag),
  ) as any;
  if (!sshRule) {
    errors.push(`ssh is missing accept ${group} -> ${tag}`);
  } else {
    if (!includesValue(sshRule.users, SSH_USER)) {
      errors.push(`ssh rule for ${tag} must allow user ${SSH_USER}`);
    }
    if (sshRule.enforceRecorder !== true) {
      errors.push(`ssh rule for ${tag} must set enforceRecorder: true`);
    }
    if (!includesValue(sshRule.recorder, SESSION_RECORDER_TAG)) {
      errors.push(`ssh rule for ${tag} must record to ${SESSION_RECORDER_TAG}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Build the pull request description for a jumpbox access grant. */
export function buildPullRequestBody(input: {
  clusterName: string;
  jumpboxName: string;
  administrators: string[];
}): string {
  const tag = `tag:${input.jumpboxName}`;
  const group = `group:${input.jumpboxName}`;
  const adminList = input.administrators.map(a => `- ${a}`).join('\n');
  return [
    '## Summary',
    `Grant recorded jumpbox SSH access for AKS cluster \`${input.clusterName}\`.`,
    '',
    `- **Cluster Name:** ${input.clusterName}`,
    `- **Jumpbox Name:** ${input.jumpboxName}`,
    '',
    '### Cluster Administrators',
    adminList,
    '',
    '### Validation Performed',
    `- \`${tag}\` present in \`tagOwners\``,
    `- \`${group}\` contains all administrators with no duplicates`,
    `- ACL \`accept\` \`${group}\` → \`${tag}:22\``,
    `- SSH \`accept\` \`${group}\` → \`${tag}\` as user \`${SSH_USER}\` with \`enforceRecorder: true\``,
    '- `policy.hujson` parses as valid HUJSON',
    '',
    '### Impact',
    `Listed administrators gain recorded SSH access (as \`${SSH_USER}\`) to the jumpbox for this cluster only.`,
    '',
    '### Rollback Plan',
    `Revert this PR to remove the group, ACL and SSH rules for \`${tag}\`.`,
  ].join('\n');
}

export class JumpboxAccessProvisioningService {
  private readonly logger: LoggerService;
  private readonly octokit: Octokit | null;
  private readonly config: JumpboxAccessConfig;
  private commitIdentity: { name: string; email: string } | null = null;

  readonly mode: 'real' | 'sim';

  constructor(logger: LoggerService, config?: Partial<JumpboxAccessConfig>) {
    this.logger = logger;
    // Merge per-field so an explicitly-undefined config value (e.g. an unset
    // optional app-config key) falls back to the default rather than clobbering it.
    this.config = {
      owner: config?.owner ?? DEFAULT_JUMPBOX_CONFIG.owner,
      repo: config?.repo ?? DEFAULT_JUMPBOX_CONFIG.repo,
      baseBranch: config?.baseBranch ?? DEFAULT_JUMPBOX_CONFIG.baseBranch,
      policyPath: config?.policyPath ?? DEFAULT_JUMPBOX_CONFIG.policyPath,
      autoMergeEnabled: config?.autoMergeEnabled,
      autoMergeMethod: config?.autoMergeMethod,
      commitAuthorName:
        config?.commitAuthorName ?? process.env.TAILSCALE_COMMIT_AUTHOR_NAME,
      commitAuthorEmail:
        config?.commitAuthorEmail ?? process.env.TAILSCALE_COMMIT_AUTHOR_EMAIL,
    };
    const githubToken = process.env.GITHUB_TOKEN;
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

  get repo(): JumpboxAccessConfig {
    return { ...this.config };
  }

  deriveJumpboxName(clusterName: string): string {
    return deriveJumpboxName(clusterName);
  }

  /**
   * Confirm the Tailscale repo, base branch and policy file are reachable.
   */
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
          'GITHUB_TOKEN is not configured; Tailscale operations are unavailable.',
      };
    }
    try {
      await this.octokit.repos.get({
        owner: this.config.owner,
        repo: this.config.repo,
      });
      await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${this.config.baseBranch}`,
      });
      await this.getFile(this.config.policyPath, this.config.baseBranch);
      return { ok: true, mode: 'real' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[jumpbox] preflight failed: ${msg}`);
      return {
        ok: false,
        mode: 'real',
        reason: `Tailscale preflight failed: ${msg}`,
      };
    }
  }

  /**
   * Open a Tailscale policy PR granting the administrators SSH access to the
   * cluster jumpbox. Validates the updated policy before committing; if
   * validation fails the PR is NOT created.
   */
  async provisionAccess(
    request: JumpboxAccessRequest,
  ): Promise<JumpboxAccessResult> {
    if (!this.octokit) {
      throw new Error(
        'GITHUB_TOKEN is not configured; cannot open a Tailscale policy PR',
      );
    }

    const { valid, invalid } = normalizeAdministrators(
      request.clusterAdministrators,
    );
    if (invalid.length > 0) {
      throw new Error(`Invalid GitHub usernames: ${invalid.join(', ')}`);
    }
    if (valid.length === 0) {
      throw new Error(
        'At least one cluster administrator is required for jumpbox access',
      );
    }

    const { owner, repo, baseBranch, policyPath } = this.config;
    const jumpboxName =
      request.jumpboxName || this.deriveJumpboxName(request.clusterName);

    // Resolve a ruleset-compliant author before writing anything, so a
    // non-compliant identity fails here instead of leaving a dead branch.
    try {
      await this.resolveCommitIdentity();
    } catch (error) {
      throw this.describeFailure('resolve the Tailscale commit author', error);
    }

    // Resolve base branch and cut a dedicated feature branch.
    let baseSha: string;
    try {
      baseSha = await this.getRefSha(`heads/${baseBranch}`);
    } catch (error) {
      throw this.describeFailure(
        `resolve Tailscale base branch '${baseBranch}'`,
        error,
      );
    }

    const requestedBranch = `feature/add-jumpbox-access-${request.clusterName}`;
    let branch: string;
    try {
      branch = await this.createUniqueBranch(requestedBranch, baseSha);
    } catch (error) {
      throw this.describeFailure(
        `create Tailscale branch '${requestedBranch}'`,
        error,
      );
    }

    // Read, update and validate the policy BEFORE committing.
    let policyFile: { content: string; sha: string };
    try {
      policyFile = await this.getFile(policyPath, branch);
    } catch (error) {
      throw this.describeFailure(`read '${policyPath}'`, error);
    }

    let updatedContent: string;
    try {
      const policy = parseHujson(policyFile.content);
      applyJumpboxPolicy(policy, { jumpboxName, administrators: valid });
      updatedContent = serializeHujson(policy);
    } catch (error) {
      throw this.describeFailure(`update '${policyPath}'`, error);
    }

    const validation = validateJumpboxPolicy(updatedContent, {
      jumpboxName,
      administrators: valid,
    });
    if (!validation.ok) {
      // Abort without opening a PR when validation fails.
      this.logger.error(
        `[jumpbox] policy validation failed for ${jumpboxName}: ${validation.errors.join(
          '; ',
        )}`,
      );
      throw new Error(
        `Tailscale policy validation failed: ${validation.errors.join('; ')}`,
      );
    }

    // Commit the validated policy.
    try {
      await this.upsertFile({
        branch,
        path: policyPath,
        content: updatedContent,
        // SymphonyFS/tailscale's main ruleset requires conventional commits.
        message: `chore: grant jumpbox access for ${request.clusterName}`,
        sha: policyFile.sha,
      });
    } catch (error) {
      throw this.describeFailure(`commit '${policyPath}'`, error);
    }

    // Open the PR into the base branch.
    try {
      const { data: pr } = await this.octokit.pulls.create({
        owner,
        repo,
        title: `chore: add jumpbox access for ${request.clusterName}`,
        body: buildPullRequestBody({
          clusterName: request.clusterName,
          jumpboxName,
          administrators: valid,
        }),
        head: branch,
        base: baseBranch,
      });

      this.logger.info(
        `[jumpbox] opened Tailscale PR #${pr.number} for ${request.clusterName} (${jumpboxName})`,
      );

      await this.enableAutoMergeIfConfigured({
        pullRequestNodeId: pr.node_id,
        pullRequestNumber: pr.number,
        clusterName: request.clusterName,
      });

      return {
        jumpboxName,
        branch,
        prNumber: pr.number,
        prUrl: pr.html_url,
        policyPath,
        administrators: valid,
      };
    } catch (error) {
      throw this.describeFailure('create Tailscale pull request', error);
    }
  }

  private async enableAutoMergeIfConfigured(input: {
    pullRequestNodeId?: string;
    pullRequestNumber: number;
    clusterName: string;
  }): Promise<void> {
    const autoMergeEnabled =
      this.config.autoMergeEnabled ?? isAutoMergeEnabled();
    const mergeMethod = (
      this.config.autoMergeMethod ?? autoMergeMethod()
    ).toUpperCase();

    if (!autoMergeEnabled) {
      return;
    }
    if (!this.octokit) {
      throw new Error(
        'GITHUB_TOKEN is not configured; cannot enable auto-merge',
      );
    }
    if (!input.pullRequestNodeId) {
      throw new Error(
        `Missing node_id for Tailscale PR #${input.pullRequestNumber}; cannot enable auto-merge`,
      );
    }

    try {
      await this.octokit.graphql(
        `mutation EnablePullRequestAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {\n  enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: $mergeMethod}) {\n    pullRequest {\n      number\n      autoMergeRequest {\n        enabledAt\n      }\n    }\n  }\n}`,
        {
          pullRequestId: input.pullRequestNodeId,
          mergeMethod,
        },
      );
      this.logger.info(
        `[jumpbox] enabled auto-merge for Tailscale PR #${input.pullRequestNumber} (${input.clusterName})`,
      );
    } catch (error) {
      throw this.describeFailure(
        `enable auto-merge for Tailscale PR #${input.pullRequestNumber}`,
        error,
      );
    }
  }

  /** Current state of a Tailscale PR (used to gate bootstrap on merge). */
  async getPullRequestStatus(prNumber: number): Promise<TailscalePrStatus> {
    if (!this.octokit) {
      throw new Error(
        'GITHUB_TOKEN is not configured; cannot read Tailscale PR status',
      );
    }
    const { data } = await this.octokit.pulls.get({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
    });
    return {
      state: data.state === 'closed' ? 'closed' : 'open',
      merged: Boolean(data.merged_at),
    };
  }

  private describeFailure(action: string, error: unknown): Error {
    const status = (error as { status?: number }).status;
    const raw = error instanceof Error ? error.message : String(error);
    const suffix = status ? ` (HTTP ${status})` : '';
    this.logger.error(`[jumpbox] Failed to ${action}${suffix}: ${raw}`);
    return new Error(`Failed to ${action}${suffix}: ${raw}`);
  }

  private async getRefSha(ref: string): Promise<string> {
    if (!this.octokit) throw new Error('Octokit is not initialized');
    const { data } = await this.octokit.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref,
    });
    return data.object.sha;
  }

  private async createUniqueBranch(
    branch: string,
    baseSha: string,
  ): Promise<string> {
    if (!this.octokit) throw new Error('Octokit is not initialized');
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = attempt === 0 ? branch : `${branch}-${Date.now()}`;
      try {
        await this.octokit.git.createRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: `refs/heads/${candidate}`,
          sha: baseSha,
        });
        return candidate;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          !msg.includes('Reference already exists') ||
          attempt === maxAttempts - 1
        ) {
          throw error;
        }
      }
    }
    throw new Error('Could not create a unique branch name');
  }

  private async getFile(
    path: string,
    ref: string,
  ): Promise<{ content: string; sha: string }> {
    if (!this.octokit) throw new Error('Octokit is not initialized');
    const { data } = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
      ref,
    });
    if (Array.isArray(data) || !('content' in data)) {
      throw new Error(`Expected file at ${path} but got directory listing`);
    }
    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha,
    };
  }

  /**
   * The noreply author used for Tailscale policy commits: the configured one,
   * or `<id>+<login>@users.noreply.github.com` of the token's GitHub user.
   * Throws when the result does not satisfy the repository ruleset.
   */
  async resolveCommitIdentity(): Promise<{ name: string; email: string }> {
    if (this.commitIdentity) return this.commitIdentity;
    if (!this.octokit) throw new Error('Octokit is not initialized');
    let identity: { name: string; email: string };
    if (this.config.commitAuthorEmail) {
      identity = {
        name: this.config.commitAuthorName || 'CloudHub',
        email: this.config.commitAuthorEmail,
      };
    } else {
      const { data } = await this.octokit.users.getAuthenticated();
      identity = {
        name: this.config.commitAuthorName || data.name || data.login,
        email: `${data.id}+${data.login}@users.noreply.github.com`,
      };
    }
    if (!TAILSCALE_NOREPLY_EMAIL.test(identity.email)) {
      throw new Error(
        `Tailscale policy commits must use a GitHub noreply author email (<id>+<login>@users.noreply.github.com); '${identity.email}' does not match`,
      );
    }
    this.commitIdentity = identity;
    return identity;
  }

  private async upsertFile(input: {
    branch: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
  }): Promise<void> {
    if (!this.octokit) throw new Error('Octokit is not initialized');
    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.config.owner,
      repo: this.config.repo,
      path: input.path,
      branch: input.branch,
      message: input.message,
      sha: input.sha,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      author: await this.resolveCommitIdentity(),
      committer: await this.resolveCommitIdentity(),
    });
  }
}
