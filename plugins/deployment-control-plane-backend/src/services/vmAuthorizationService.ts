import type { LoggerService } from '@backstage/backend-plugin-api';
import { EntraGroupMembershipResolver } from './entraGroupMembershipResolver';

export interface VmAuthorizationResult {
  authorized: boolean;
  groupId: string | null;
  source: 'token' | 'graph' | 'unconfigured';
}

/**
 * Single source of truth for VM power-control access (start/deallocate).
 * Mirrors the GPU_COMPUTE_ACCESS policy and shares its group matching via
 * EntraGroupMembershipResolver.
 *
 * Configuration:
 *   VM_OPERATORS_ENTRA_GROUP_ID - Azure AD object id of the VM operators group
 *                                 (required; access denied for everyone if unset)
 *   ENTRA_GRAPH_ENABLED         - "true" to verify membership via Microsoft Graph
 *                                 when the caller's token was inconclusive.
 *                                 Falls back to GPU_GRAPH_ENABLED.
 *
 * Fails closed: these routes deallocate real virtual machines, so an
 * unconfigured group id denies everyone rather than allowing everyone.
 */
export class VmAuthorizationService {
  private readonly logger: LoggerService;
  private readonly memberships: EntraGroupMembershipResolver;

  constructor(logger: LoggerService) {
    this.logger = logger;
    this.memberships = new EntraGroupMembershipResolver(
      logger,
      'vm-authorization',
    );
  }

  private operatorGroupId(): string | null {
    return process.env.VM_OPERATORS_ENTRA_GROUP_ID?.trim() || null;
  }

  private graphEnabled(): boolean {
    return (
      process.env.ENTRA_GRAPH_ENABLED === 'true' ||
      process.env.GPU_GRAPH_ENABLED === 'true'
    );
  }

  async isVmOperator(input: {
    groups: string[];
    actorRef: string;
  }): Promise<VmAuthorizationResult> {
    const groupId = this.operatorGroupId();
    if (!groupId) {
      this.logger.warn(
        '[vm-authorization] VM_OPERATORS_ENTRA_GROUP_ID is not configured; denying all VM power control',
      );
      return { authorized: false, groupId: null, source: 'unconfigured' };
    }

    const { matched, source } = await this.memberships.resolveMemberships({
      groups: input.groups,
      actorRef: input.actorRef,
      candidateGroupIds: [groupId],
      graphEnabled: this.graphEnabled(),
    });

    const authorized = matched.includes(groupId);
    if (authorized) {
      this.logger.info(
        `[vm-authorization] VM power control authorized | User: ${input.actorRef} | Group: ${groupId} | Source: ${source}`,
      );
    } else {
      this.logger.warn(
        `[vm-authorization] VM power control denied | User: ${input.actorRef}`,
      );
    }

    return { authorized, groupId, source };
  }
}
