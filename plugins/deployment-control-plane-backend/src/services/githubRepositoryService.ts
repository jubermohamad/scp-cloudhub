import crypto from 'crypto';
import type { Pool } from 'pg';
import { Octokit } from '@octokit/rest';
import type { LoggerService } from '@backstage/backend-plugin-api';

export type RepositoryVisibility = 'private' | 'internal' | 'public';

export interface CreateRepositoryInput {
  repositoryName: string;
  description?: string;
  visibility: RepositoryVisibility;
  ownerTeam: string;
  templateName?: string;
  enableBranchProtection: boolean;
  enableCodeOwners: boolean;
  enableDependabot: boolean;
}

export interface CreateRepositoryResult {
  success: boolean;
  repositoryName?: string;
  repositoryUrl?: string;
  ownerTeam?: string;
  message?: string;
}

export interface RepositoryRequestRecord {
  id: string;
  repositoryName: string;
  description: string | null;
  visibility: string;
  ownerTeam: string;
  templateName: string | null;
  requestedBy: string;
  githubRepoUrl: string | null;
  status: string;
  createdAt: Date;
}

const REPO_NAME_RE = /^[a-z0-9-]+$/;

export class GitHubRepositoryService {
  private readonly logger: LoggerService;
  private readonly octokit: Octokit;
  private readonly organization: string;
  private readonly pool: Pool | null;

  constructor(options: {
    logger: LoggerService;
    token: string;
    organization?: string;
    pool?: Pool | null;
  }) {
    this.logger = options.logger;
    this.octokit = new Octokit({ auth: options.token });
    this.organization = options.organization ?? 'SymphonySensa';
    this.pool = options.pool ?? null;
  }

  async listTemplates(): Promise<string[]> {
    return ['Empty', 'node-api-template', 'react-app-template', 'terraform-module-template'];
  }

  async listTeams(): Promise<{ slug: string; name: string }[]> {
    const org = this.organization;
    const octokit = this.octokit;
    const teams: { slug: string; name: string }[] = [];
    for await (const response of octokit.paginate.iterator(
      octokit.rest.teams.list,
      { org, per_page: 100 },
    )) {
      for (const team of response.data) {
        teams.push({ slug: team.slug, name: team.name ?? team.slug });
      }
    }
    return teams;
  }

  async repositoryExists(
    octokit: Octokit,
    org: string,
    name: string,
  ): Promise<boolean> {
    try {
      await octokit.rest.repos.get({ owner: org, repo: name });
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) return false;
      throw error;
    }
  }

  validateRepositoryName(name: string): { valid: boolean; message?: string } {
    const trimmed = name.trim();
    if (!trimmed) {
      return { valid: false, message: 'Repository name is required.' };
    }
    if (trimmed.length < 3 || trimmed.length > 100) {
      return {
        valid: false,
        message: 'Repository name must be between 3 and 100 characters.',
      };
    }
    if (!REPO_NAME_RE.test(trimmed)) {
      return {
        valid: false,
        message:
          'Repository name may only contain lowercase letters, numbers, and hyphens.',
      };
    }
    return { valid: true };
  }

  async createRepository(
    input: CreateRepositoryInput,
    requestedBy: string,
  ): Promise<CreateRepositoryResult> {
    const org = this.organization;
    const octokit = this.octokit;
    const validation = this.validateRepositoryName(input.repositoryName);
    if (!validation.valid) {
      await this.writeAudit({ ...input, requestedBy, status: 'VALIDATION_FAILED' });
      return { success: false, message: validation.message };
    }

    const exists = await this.repositoryExists(octokit, org, input.repositoryName);
    if (exists) {
      await this.writeAudit({ ...input, requestedBy, status: 'ALREADY_EXISTS' });
      return {
        success: false,
        message: 'A GitHub repository with that name already exists.',
      };
    }

    try {
      let repoUrl: string;
      let repoName: string;

      if (input.templateName && input.templateName !== 'Empty') {
        const templateParts = input.templateName.split('/');
        const templateOwner = templateParts.length > 1 ? templateParts[0] : org;
        const templateRepo = templateParts.length > 1 ? templateParts[1] : input.templateName;

        const { data: created } = await octokit.rest.repos.createUsingTemplate({
          template_owner: templateOwner,
          template_repo: templateRepo,
          owner: org,
          name: input.repositoryName,
          description: input.description,
          private: input.visibility === 'private',
          include_all_branches: false,
        });
        repoUrl = created.html_url;
        repoName = created.name;
      } else {
        const { data: created } = await octokit.rest.repos.createInOrg({
          org,
          name: input.repositoryName,
          description: input.description,
          visibility: input.visibility as 'private' | 'public' | undefined,
          auto_init: true,
        });
        repoUrl = created.html_url;
        repoName = created.name;
      }

      await this.assignTeamPermissions(octokit, org, repoName, input.ownerTeam);

      if (input.enableBranchProtection) {
        await this.configureBranchProtection(this.octokit, org, repoName);
      }

      if (input.enableCodeOwners) {
        await this.createCodeOwners(this.octokit, org, repoName, input.ownerTeam);
      }

      if (input.enableDependabot) {
        await this.enableDependabot(this.octokit, org, repoName);
      }

      await this.writeAudit({
        ...input,
        requestedBy,
        status: 'SUCCESS',
        githubRepoUrl: repoUrl,
      });

      this.logger.info(
        `[github-repository] Created repository ${org}/${repoName} for ${requestedBy}`,
      );

      return {
        success: true,
        repositoryName: repoName,
        repositoryUrl: repoUrl,
        ownerTeam: input.ownerTeam,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[github-repository] Failed to create repository ${org}/${input.repositoryName}: ${message}`,
      );
      await this.writeAudit({
        ...input,
        requestedBy,
        status: 'FAILED',
      });
      return {
        success: false,
        message: `Repository creation failed: ${message}`,
      };
    }
  }

  private async assignTeamPermissions(
    octokit: Octokit,
    org: string,
    repo: string,
    teamSlug: string,
  ): Promise<void> {
    try {
      await octokit.rest.teams.addOrUpdateRepoPermissionsInOrg({
        org,
        team_slug: teamSlug,
        owner: org,
        repo,
        permission: 'admin',
      });
      this.logger.info(
        `[github-repository] Assigned team ${teamSlug} admin permission on ${org}/${repo}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[github-repository] Failed to assign team ${teamSlug} to ${org}/${repo}: ${message}`,
      );
      throw new Error(`Failed to assign owner team: ${message}`);
    }
  }

  private async configureBranchProtection(
    octokit: Octokit,
    org: string,
    repo: string,
    branch = 'main',
  ): Promise<void> {
    try {
      await octokit.rest.repos.updateBranchProtection({
        owner: org,
        repo,
        branch,
        required_status_checks: null,
        enforce_admins: true,
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
          require_code_owner_reviews: false,
        },
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false,
      });
      this.logger.info(
        `[github-repository] Configured branch protection for ${org}/${repo}:${branch}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[github-repository] Failed to configure branch protection for ${org}/${repo}:${branch}: ${message}`,
      );
      throw new Error(`Failed to configure branch protection: ${message}`);
    }
  }

  private async createCodeOwners(
    octokit: Octokit,
    org: string,
    repo: string,
    teamSlug: string,
  ): Promise<void> {
    try {
      const content = `* @${org}/${teamSlug}\n`;
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: org,
        repo,
        path: '.github/CODEOWNERS',
        message: 'chore: add CODEOWNERS',
        content: Buffer.from(content).toString('base64'),
      });
      this.logger.info(
        `[github-repository] Created CODEOWNERS for ${org}/${repo}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[github-repository] Failed to create CODEOWNERS for ${org}/${repo}: ${message}`,
      );
      throw new Error(`Failed to create CODEOWNERS: ${message}`);
    }
  }

  private async enableDependabot(
    octokit: Octokit,
    org: string,
    repo: string,
  ): Promise<void> {
    const content = `version: 2

updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"

  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
`;
    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: org,
        repo,
        path: '.github/dependabot.yml',
        message: 'chore: enable Dependabot',
        content: Buffer.from(content).toString('base64'),
      });
      this.logger.info(
        `[github-repository] Enabled Dependabot for ${org}/${repo}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[github-repository] Failed to enable Dependabot for ${org}/${repo}: ${message}`,
      );
      throw new Error(`Failed to enable Dependabot: ${message}`);
    }
  }

  private async writeAudit(
    input: CreateRepositoryInput & {
      requestedBy: string;
      status: string;
      githubRepoUrl?: string;
    },
  ): Promise<void> {
    if (!this.pool) {
      this.logger.warn(
        '[github-repository] PostgreSQL pool unavailable; skipping audit write',
      );
      return;
    }

    const id = crypto.randomUUID();
    const trimmedDescription = (input.description ?? '').trim() || null;
    const trimmedTemplate = (input.templateName ?? '').trim() || null;

    try {
      await this.pool.query(
        `INSERT INTO github_repository_requests (
          id, repository_name, description, visibility, owner_team,
          template_name, requested_by, github_repo_url, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          id,
          input.repositoryName.trim(),
          trimmedDescription,
          input.visibility,
          input.ownerTeam.trim(),
          trimmedTemplate,
          input.requestedBy,
          input.githubRepoUrl ?? null,
          input.status,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[github-repository] Failed to write audit record: ${message}`,
      );
    }
  }
}
