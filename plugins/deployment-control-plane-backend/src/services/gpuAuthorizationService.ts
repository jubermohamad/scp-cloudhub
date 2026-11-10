import type { LoggerService } from '@backstage/backend-plugin-api';
import { EntraGroupMembershipResolver } from './entraGroupMembershipResolver';
import type { GpuAuthorizationResult, GpuRole } from '../types';

// Single source of truth for the GPU_COMPUTE_ACCESS policy. Every GPU
// Compute route (view, create, delete) must call this — never re-implement
// group matching elsewhere.
//
// Configuration (env vars, no hardcoded group names):
//   GPU_ENTRA_GROUP_ID   - Azure AD *object id* of the GPU user group (required)
//   GPU_ADMIN_GROUP_ID   - Azure AD object id of a future GPU admin group (optional)
//   GPU_GRAPH_ENABLED    - "true" to verify membership via Microsoft Graph
//                          checkMemberGroups when the caller's token did not
//                          already establish a GPU role.
//
// Group matching and the Graph fallback live in EntraGroupMembershipResolver
// so this policy and the VM policy share one implementation.
//
// Fails closed: if GPU_ENTRA_GROUP_ID is not configured, every request is
// denied rather than silently allowed.
export class GpuAuthorizationService {
  private readonly logger: LoggerService;
  private readonly memberships: EntraGroupMembershipResolver;

  constructor(logger: LoggerService) {
    this.logger = logger;
    this.memberships = new EntraGroupMembershipResolver(
      logger,
      'gpu-authorization',
    );
  }

  private userGroupId(): string | null {
    return process.env.GPU_ENTRA_GROUP_ID?.trim() || null;
  }

  private adminGroupId(): string | null {
    return process.env.GPU_ADMIN_GROUP_ID?.trim() || null;
  }

  private graphEnabled(): boolean {
    return process.env.GPU_GRAPH_ENABLED === 'true';
  }

  private localDevProvisioningConfigured(): boolean {
    return Boolean(
      process.env.CLOUDHUB_TFC_TOKEN?.trim() &&
        process.env.CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID?.trim() &&
        process.env.CLOUDHUB_GITHUB_TOKEN?.trim(),
    );
  }

  private localDevBypassEnabled(): boolean {
    return (
      process.env.NODE_ENV === 'development' &&
      this.localDevProvisioningConfigured()
    );
  }

  async getUserGpuRole(input: {
    groups: string[];
    actorRef: string;
  }): Promise<GpuRole> {
    return (await this.resolveRole(input)).role;
  }

  private async resolveRole(input: {
    groups: string[];
    actorRef: string;
  }): Promise<{ role: GpuRole; source: 'token' | 'graph' | 'unconfigured' }> {
    const platformAdminGroupMarkers = new Set([
      'cloudhubplatformowners',
      'cloudhub.platformadmin',
      'role:cloudhub.platformadmin',
      'grp-platform-super-admins',
      'grp-cloudhub-platformadmin',
      'platform-admin',
      '778023ed-fa96-43b3-8c35-4679943c01ee', // GRP-CloudHub-PlatformAdmin object ID
    ]);

    const hasPlatformAdminGroup = input.groups.some(group => {
      const normalized = group.trim().toLowerCase();
      const catalogValue = normalized
        .replace(/^group:default\//, '')
        .replace(/^group:/, '')
        .replace(/^.*\//, '');

      return (
        platformAdminGroupMarkers.has(normalized) ||
        platformAdminGroupMarkers.has(catalogValue)
      );
    });

    if (hasPlatformAdminGroup) {
      this.logger.debug(
        `[gpu-authorization] Platform admin group detected | User: ${input.actorRef}`,
      );
      return { role: 'GPU_ADMIN', source: 'token' };
    }

    if (this.localDevBypassEnabled()) {
      this.logger.warn(
        '[gpu-authorization] Development bypass enabled via CLOUDHUB_* provisioning credentials; granting GPU_ADMIN for local runtime',
      );
      return { role: 'GPU_ADMIN', source: 'token' };
    }

    const userGroupId = this.userGroupId();
    if (!userGroupId) {
      this.logger.warn(
        '[gpu-authorization] GPU_ENTRA_GROUP_ID is not configured; denying all GPU Compute access',
      );
      return { role: 'NONE', source: 'unconfigured' };
    }

    const adminGroupId = this.adminGroupId();
    const { matched, source } = await this.memberships.resolveMemberships({
      groups: input.groups,
      actorRef: input.actorRef,
      candidateGroupIds: [userGroupId, ...(adminGroupId ? [adminGroupId] : [])],
      graphEnabled: this.graphEnabled(),
    });

    if (adminGroupId && matched.includes(adminGroupId)) {
      return { role: 'GPU_ADMIN', source };
    }
    if (matched.includes(userGroupId)) {
      return { role: 'GPU_USER', source };
    }

    return { role: 'NONE', source: 'token' };
  }

  async isGpuAuthorized(input: {
    groups: string[];
    actorRef: string;
  }): Promise<GpuAuthorizationResult> {
    const userGroupId = this.userGroupId();
    const { role, source } = await this.resolveRole(input);
    const authorized = role !== 'NONE';

    if (authorized) {
      this.logger.info(
        `[gpu-authorization] User authorized for GPU Compute | User: ${input.actorRef} | Role: ${role} | Group: ${userGroupId}`,
      );
    } else {
      this.logger.warn(
        `[gpu-authorization] GPU authorization denied | User: ${input.actorRef}`,
      );
    }

    return { authorized, role, groupId: userGroupId, source };
  }
}
