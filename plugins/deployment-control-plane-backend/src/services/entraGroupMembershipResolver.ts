import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';

export type MembershipSource = 'token' | 'graph';

export interface MembershipResult {
  matched: string[];
  source: MembershipSource;
}

/**
 * Single implementation of Entra group membership validation. Every feature
 * that gates on an Entra group (GPU Compute, VM power control, ...) must go
 * through this — never re-implement group matching elsewhere.
 *
 * Resolution order is token-first, Graph only when inconclusive. A negative
 * token result is usually inconclusive: Backstage ownership refs are catalog
 * groups (`group:default/<slug>`) and do not carry raw Entra object ids.
 *
 * Graph uses the canonical AZURE_* platform identity. It needs directory read
 * permission (GroupMember.Read.All + User.Read.All).
 */
export class EntraGroupMembershipResolver {
  private readonly logger: LoggerService;
  private readonly label: string;

  constructor(logger: LoggerService, label: string) {
    this.logger = logger;
    this.label = label;
  }

  // The configured value is a raw Entra object id, but claims may arrive as a
  // catalog ref, so compare tolerantly.
  matchesGroup(groups: string[], groupId: string): boolean {
    const needle = groupId.trim().toLowerCase();
    if (!needle) return false;
    return groups.some(ref => {
      const normalized = ref.trim().toLowerCase();
      return (
        normalized === needle ||
        normalized === `group:default/${needle}` ||
        normalized.endsWith(`/${needle}`)
      );
    });
  }

  private principalFromActorRef(actorRef: string): string {
    const parts = actorRef.split('/');
    return parts[parts.length - 1] ?? actorRef;
  }

  private async checkGraphMembership(
    userPrincipalNameOrId: string,
    candidateGroupIds: string[],
  ): Promise<string[]> {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret || !userPrincipalNameOrId) {
      return [];
    }

    try {
      const credential = createCloudHubAzureCredential((message, metadata) =>
        this.logger.info(message, metadata),
      );
      const token = await credential.getToken(
        'https://graph.microsoft.com/.default',
      );
      if (!token?.token) return [];

      const resp = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
          userPrincipalNameOrId,
        )}/checkMemberGroups`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ groupIds: candidateGroupIds }),
        },
      );
      if (!resp.ok) {
        this.logger.warn(
          `[${this.label}] Graph checkMemberGroups failed (${resp.status}) for ${userPrincipalNameOrId}`,
        );
        return [];
      }
      const body = await resp.json();
      return Array.isArray(body?.value) ? body.value : [];
    } catch (error) {
      this.logger.error(
        `[${this.label}] Graph checkMemberGroups error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /** Returns the subset of candidateGroupIds the caller belongs to. */
  async resolveMemberships(input: {
    groups: string[];
    actorRef: string;
    candidateGroupIds: string[];
    graphEnabled: boolean;
  }): Promise<MembershipResult> {
    const candidates = input.candidateGroupIds.filter(Boolean);
    if (candidates.length === 0) {
      return { matched: [], source: 'token' };
    }

    const fromToken = candidates.filter(id =>
      this.matchesGroup(input.groups, id),
    );
    if (fromToken.length > 0) {
      return { matched: fromToken, source: 'token' };
    }

    if (input.graphEnabled) {
      const matched = await this.checkGraphMembership(
        this.principalFromActorRef(input.actorRef),
        candidates,
      );
      if (matched.length > 0) {
        return { matched, source: 'graph' };
      }
    }

    return { matched: [], source: 'token' };
  }
}
