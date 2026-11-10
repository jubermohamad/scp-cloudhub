import type {
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { EntraGroupMembershipResolver } from './entraGroupMembershipResolver';

export interface GitHubAuthorizationResult {
  authorized: boolean;
  enabled: boolean;
  source: 'token' | 'graph' | 'disabled' | 'unconfigured';
}

/**
 * Authorization gate for GitHub repository provisioning.
 *
 * Membership is resolved through Microsoft Entra ID groups. The list of
 * authorized groups is externalized in Backstage configuration and never
 * hardcoded. Group matching and the optional Microsoft Graph fallback are
 * delegated to EntraGroupMembershipResolver so all Entra-gated features share
 * one implementation.
 */
export class GitHubAuthorizationService {
  private readonly logger: LoggerService;
  private readonly enabled: boolean;
  private readonly authorizedGroups: string[];
  private readonly memberships: EntraGroupMembershipResolver;
  private readonly graphEnabled: boolean;

  constructor(options: { logger: LoggerService; config?: RootConfigService }) {
    this.logger = options.logger;
    this.memberships = new EntraGroupMembershipResolver(
      options.logger,
      'github-repo-provisioning',
    );

    const provisioningConfig = options.config?.getOptionalConfig(
      'github.repositoryProvisioning',
    );

    this.enabled = provisioningConfig?.getOptionalBoolean('enabled') ?? false;
    this.authorizedGroups =
      provisioningConfig?.getOptionalStringArray('authorizedGroups') ?? [];
    this.graphEnabled =
      process.env.GITHUB_REPO_PROVISIONING_GRAPH_ENABLED === 'true';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getAuthorizedGroups(): string[] {
    return [...this.authorizedGroups];
  }

  async authorize(input: {
    groups: string[];
    actorRef: string;
  }): Promise<GitHubAuthorizationResult> {
    if (!this.enabled) {
      this.logger.warn(
        '[github-authorization] Repository provisioning is disabled in configuration',
      );
      return { authorized: false, enabled: false, source: 'disabled' };
    }

    const candidates = this.authorizedGroups.filter(Boolean);
    if (candidates.length === 0) {
      this.logger.warn(
        '[github-authorization] No authorized groups configured; repository provisioning is unavailable',
      );
      return { authorized: false, enabled: true, source: 'unconfigured' };
    }

    const { matched, source } = await this.memberships.resolveMemberships({
      groups: input.groups,
      actorRef: input.actorRef,
      candidateGroupIds: candidates,
      graphEnabled: this.graphEnabled,
    });

    const authorized = matched.length > 0;

    if (authorized) {
      this.logger.info(
        `[github-authorization] User authorized for repository provisioning | User: ${input.actorRef} | Groups: ${matched.join(', ')} | Source: ${source}`,
      );
    } else {
      this.logger.warn(
        `[github-authorization] User denied repository provisioning | User: ${input.actorRef} | Source: ${source}`,
      );
    }

    return { authorized, enabled: true, source };
  }
}
