import type { Request } from 'express';
import type {
  HttpAuthService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { ADMIN_GROUP_DEFAULT, TENANT_GROUP_PREFIX_DEFAULT } from './constants';
import { ForbiddenError } from './errors';

/**
 * The signed-in user and what they may do.
 *
 * - Platform admin (grp-cloudhub-data-export, CloudHubPlatformOwners, or
 *   configured admin group): every tenant, plus catalog, cluster and agent administration.
 * - Tenant admin (<prefix><tenant>.admin): view and manage that tenant's exports.
 * - Tenant user (<prefix><tenant>.user): view that tenant's exports and runs.
 */
export interface Caller {
  actor: string;
  isPlatformAdmin: boolean;
  /** Tenants the caller can manage. */
  tenantAdminOf: string[];
  /** Tenants the caller can view (always includes tenantAdminOf). */
  tenantMemberOf: string[];
}

/** `null` means every tenant; otherwise the tenant ids a query must be limited to. */
export type TenantScope = string[] | null;

/** Built-in platform admin groups plus optional groups from DATA_EXPORT_ADMIN_GROUPS. */
export function adminGroups(): string[] {
  const configured = process.env.DATA_EXPORT_ADMIN_GROUPS;
  const groups = [
    ADMIN_GROUP_DEFAULT,
    'grp-cloudhub-data-export',
    'cloudhubplatformowners',
    ...(configured ? configured.split(',') : []),
  ];
  return groups.map(group => group.trim().toLowerCase()).filter(Boolean);
}

export function tenantGroupPrefix(): string {
  return (
    process.env.DATA_EXPORT_TENANT_GROUP_PREFIX ?? TENANT_GROUP_PREFIX_DEFAULT
  )
    .trim()
    .toLowerCase();
}

/** Matches an ownership ref such as `group:default/cloudhub.dataexport.admin` against a bare group name. */
export function isMemberOf(
  ownershipRefs: string[],
  allowed: string[],
): boolean {
  const normalized = ownershipRefs.map(ref => ref.toLowerCase());
  return allowed.some(group =>
    normalized.some(
      ref =>
        ref === group || ref.endsWith(`/${group}`) || ref.endsWith(`:${group}`),
    ),
  );
}

/** Strips the `kind:namespace/` part of an entity ref, leaving the group name. */
function groupName(ref: string): string {
  const lowered = ref.toLowerCase();
  const afterSlash = lowered.slice(lowered.lastIndexOf('/') + 1);
  return afterSlash.slice(afterSlash.lastIndexOf(':') + 1);
}

/** Derives the caller's roles from their ownership refs. Pure, so it is unit tested directly. */
export function resolveRoles(actor: string, ownershipRefs: string[]): Caller {
  const prefix = tenantGroupPrefix();
  const admin = new Set<string>();
  const member = new Set<string>();
  for (const ref of ownershipRefs) {
    const name = groupName(ref);
    if (!name.startsWith(prefix)) continue;
    const match = /^([a-z0-9][a-z0-9-]{0,62})\.(admin|user)$/.exec(
      name.slice(prefix.length),
    );
    if (!match) continue;
    member.add(match[1]);
    if (match[2] === 'admin') admin.add(match[1]);
  }
  return {
    actor,
    isPlatformAdmin: isMemberOf(ownershipRefs, adminGroups()),
    tenantAdminOf: [...admin].sort(),
    tenantMemberOf: [...member].sort(),
  };
}

export function visibleTenants(caller: Caller): TenantScope {
  return caller.isPlatformAdmin ? null : caller.tenantMemberOf;
}

export function canViewTenant(caller: Caller, tenantId: string): boolean {
  return caller.isPlatformAdmin || caller.tenantMemberOf.includes(tenantId);
}

export function canManageTenant(caller: Caller, tenantId: string): boolean {
  return caller.isPlatformAdmin || caller.tenantAdminOf.includes(tenantId);
}

/**
 * Resolves the signed-in user and their roles.
 * Throws when the request has no valid user identity; the router maps that to 401.
 */
export async function resolveCaller(
  httpAuth: HttpAuthService,
  userInfo: UserInfoService,
  req: Request,
): Promise<Caller> {
  const credentials = await httpAuth.credentials(
    req as unknown as Parameters<typeof httpAuth.credentials>[0],
    { allow: ['user'] },
  );
  const info = await userInfo.getUserInfo(credentials);
  return resolveRoles(info.userEntityRef, info.ownershipEntityRefs ?? []);
}

export function requirePlatformAdmin(caller: Caller): void {
  if (!caller.isPlatformAdmin) throw new ForbiddenError('Requires CloudHub.DataExport.Admin');
}

export function requireManage(caller: Caller, tenantId: string): void {
  if (!canManageTenant(caller, tenantId)) throw new ForbiddenError(`Requires tenant admin for ${tenantId}`);
}

/** A shared destination (no tenant) is managed by platform admins only. */
export function canManageDestination(caller: Caller, destination: { tenantId: string | null }): boolean {
  return destination.tenantId === null ? caller.isPlatformAdmin : canManageTenant(caller, destination.tenantId);
}

/** Tenant admins see their tenants' audit trail; platform admins see everything; others see nothing. */
export function auditScope(caller: Caller): TenantScope {
  if (caller.isPlatformAdmin) return null;
  if (caller.tenantAdminOf.length === 0) throw new ForbiddenError('Audit history requires a tenant or platform admin role');
  return caller.tenantAdminOf;
}
