/**
 * CloudHub Platform – Backstage Permission Policy
 *
 * Enforces the persona-based RBAC model:
 *
 *   Platform Super User   group:default/cloudhubplatformowners
 *   App Engineering       group:default/cloudhubappeng
 *   Presales              group:default/cloudhubpresales
 *   Professional Services group:default/cloudhubps
 *   SRE                   group:default/cloudhubsre (read-only)
 *   Login Allow (RO)      group:default/cloudhub-login-allow
 *
 * Canonical Entra groups are the first entries in each list.
 * Legacy aliases remain only for transitional catalog / IdP cleanup.
 *
 * Access Matrix
 * ─────────────────────────────────────────────────────────────────
 * Capability                    Platform   AppEng  Presales  PS    SRE
 * Create / modify templates       ✅        ❌        ❌       ❌    ❌
 * Create catalog entities         ✅        ❌        ❌       ❌    ❌
 * Delete catalog entities         ✅        ❌        ❌       ❌    ❌
 * Run scaffolder tasks            ✅        ✅        ✅       ✅    ❌
 * Read catalog                    ✅        ✅        ✅       ✅    ✅
 *
 * * SRE is read-only in the portal. The frontend persona sidebar and
 *   backend deny-list both block scaffolder and write actions.
 *
 * Strict access is enabled by default. Unauthenticated users and
 * authenticated users without a mapped CloudHub access group are DENIED.
 */

import {
  AuthorizeResult,
  type PolicyDecision,
} from '@backstage/plugin-permission-common';
import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import type {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { stageForPermission } from './aksApprovalStages';

// ─── Group entity refs ────────────────────────────────────────────────────────
// These must match the group names in your IdP / catalog.
// Each persona group can have multiple aliases to handle different IdP conventions.

const PLATFORM_GROUPS = [
  'group:default/cloudhubplatformowners',
  'cloudhubplatformowners',
  'CloudHubPlatformOwners',
  'group:default/grp-platform-super-admins',
  'group:default/platform-team',
  'group:default/cloudhub-platform',
  'group:default/platform',
  'cloudhub.platformadmin',
  'role:cloudhub.platformadmin',
];

const APP_ENGINEERING_GROUPS = [
  'group:default/cloudhubappeng',
  'cloudhubappeng',
  'CloudHubAppEng',
  'group:default/grp-platform-app-engineering',
  'group:default/app-engineering',
  'group:default/developer-experience',
  'cloudhub.appengineer',
  'role:cloudhub.appengineer',
];

const PRESALES_GROUPS = [
  'group:default/cloudhubpresales',
  'group:default/grp-platform-presales',
  'group:default/presales',
  'cloudhub.presales',
  'role:cloudhub.presales',
];

const PS_GROUPS = [
  'group:default/cloudhubps',
  'cloudhubps',
  'CloudHubPS',
  'group:default/grp-platform-prof-services',
  'group:default/ps-team',
  'group:default/professional-services',
  'cloudhub.professionalservices',
  'role:cloudhub.professionalservices',
];

const SRE_GROUPS = [
  'group:default/cloudhubsre',
  'cloudhubsre',
  'CloudHubSRE',
  'group:default/grp-platform-sre',
  'group:default/sre-team',
  'group:default/sre',
  'group:default/reliability-engineering',
  'cloudhub.sre',
  'role:cloudhub.sre',
];

const LOGIN_ALLOW_GROUPS = [
  'group:default/cloudhub-login-allow',
  'cloudhubloginallow',
  'CloudHubLoginAllow',
  'group:default/grp-platform-readonly',
  'group:default/readonly',
];

const JUMPBOX_APPROVER_GROUPS = [
  process.env.CLOUDHUB_APPROVER_GROUP_REF ?? 'group:default/platform-approvers',
];

// ─── Permissions that only the Platform team may invoke ───────────────────────
const PLATFORM_ONLY_PERMISSIONS = new Set([
  // Template lifecycle – create / edit / delete scaffolder templates
  'scaffolder.template.management',
  // Catalog writes – PS and SRE must not register or delete entities
  'catalog.entity.create',
  'catalog.entity.delete',
  'catalog.location.create',
  'catalog.location.delete',
]);

// ─── Permissions allowed for platform workflow execution ─────────────────────
const WORKFLOW_EXECUTION_PERMISSIONS = new Set([
  // Scaffolder task execution (running a template wizard)
  // Platform, App Engineering, Presales and PS are allowed to launch
  // approved workflows.
  'scaffolder.task.create',
  'scaffolder.task.cancel',
]);

// ─── Permissions allowed for Platform + PS ───────────────────────────────────
const PLATFORM_PS_PERMISSIONS = new Set([
  // Catalog refreshes (e.g., re-index an entity)
  'catalog.entity.refresh',
]);

// ─── Permissions allowed for Platform + App Engineering ──────────────────────
const PLATFORM_APP_PERMISSIONS = new Set(['deployment.view', 'catalog.read']);

// ─── Explicit write actions denied for login-allow/read-only users ───────────
const READ_ONLY_DENY_PERMISSIONS = new Set([
  ...PLATFORM_ONLY_PERMISSIONS,
  ...WORKFLOW_EXECUTION_PERMISSIONS,
  'deployment.trigger',
  'catalog.entity.refresh',
]);

function strictAccessEnabled(): boolean {
  return (process.env.CLOUDHUB_STRICT_AUTH || 'true').toLowerCase() !== 'false';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ownershipRefs(user?: PolicyQueryUser): string[] {
  return user?.info?.ownershipEntityRefs ?? [];
}

function isMemberOf(
  user: PolicyQueryUser | undefined,
  groups: string[],
): boolean {
  const refs = ownershipRefs(user).map(ref => ref.toLowerCase());
  return groups.some(group => {
    const needle = group.toLowerCase();
    return refs.some(ref => {
      return (
        ref === needle ||
        ref === `group:default/${needle}` ||
        ref.endsWith(`/${needle}`) ||
        ref.endsWith(`:${needle}`)
      );
    });
  });
}

/** Guest users have no IdP group memberships.
 *  The guest auth provider sets ownershipEntityRefs to ['user:default/guest'],
 *  so we treat that single-ref case as a guest as well.
 */
function isGuest(user?: PolicyQueryUser): boolean {
  const refs = ownershipRefs(user);
  if (refs.length === 0) return true;
  return refs.length === 1 && refs[0] === 'user:default/guest';
}

// ─── Policy implementation ────────────────────────────────────────────────────

// Exported for unit testing — see __tests__/cloudhubPermissionPolicy.test.ts
export const __test = {
  PLATFORM_GROUPS,
  APP_ENGINEERING_GROUPS,
  PRESALES_GROUPS,
  PS_GROUPS,
  SRE_GROUPS,
  LOGIN_ALLOW_GROUPS,
  JUMPBOX_APPROVER_GROUPS,
  PLATFORM_ONLY_PERMISSIONS,
  WORKFLOW_EXECUTION_PERMISSIONS,
  PLATFORM_PS_PERMISSIONS,
  PLATFORM_APP_PERMISSIONS,
  READ_ONLY_DENY_PERMISSIONS,
  strictAccessEnabled,
};

export class CloudHubPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const permissionName = request.permission.name;
    const isPlatformUser = isMemberOf(user, PLATFORM_GROUPS);
    const isAppEngineeringUser = isMemberOf(user, APP_ENGINEERING_GROUPS);
    const isPresalesUser = isMemberOf(user, PRESALES_GROUPS);
    const isProfessionalServicesUser = isMemberOf(user, PS_GROUPS);
    const isSreUser = isMemberOf(user, SRE_GROUPS);
    const isLoginAllowUser = isMemberOf(user, LOGIN_ALLOW_GROUPS);
    const isJumpboxApprover = isMemberOf(user, JUMPBOX_APPROVER_GROUPS);
    const hasPrivilegedPersona =
      isPlatformUser ||
      isAppEngineeringUser ||
      isPresalesUser ||
      isProfessionalServicesUser ||
      isSreUser;
    const hasPortalAccessGroup =
      isLoginAllowUser || hasPrivilegedPersona || isJumpboxApprover;
    const strictAccess = strictAccessEnabled();

    // ── AKS / jumpbox approval stages ───────────────────────────────────────────
    // Decided FIRST and only by explicit approver-group membership. These must
    // never fall through to the guest, strict-mode or login-allow baselines
    // below (the login-allow branch ALLOWs anything not on its deny list, which
    // previously granted jumpbox.approve to every signed-in user).
    const approvalStage = stageForPermission(permissionName);
    if (approvalStage) {
      const groups = approvalStage.groups();
      return {
        result:
          groups.length > 0 && isMemberOf(user, groups)
            ? AuthorizeResult.ALLOW
            : AuthorizeResult.DENY,
      };
    }

    // ── Guest mode ────────────────────────────────────────────────────────────
    // Deny guest/unauthenticated access by default. This can be temporarily
    // relaxed by setting CLOUDHUB_STRICT_AUTH=false.
    if (isGuest(user)) {
      if (strictAccess) {
        return { result: AuthorizeResult.DENY };
      }
      return { result: AuthorizeResult.ALLOW };
    }

    // In strict mode, every authenticated user must belong to at least one
    // approved CloudHub persona/read-only access group.
    if (strictAccess && !hasPortalAccessGroup) {
      return { result: AuthorizeResult.DENY };
    }

    // ── Login allow group (portal read-only baseline) ───────────────────────
    // When a user has only cloudhub-login-allow (or readonly alias), allow
    // portal read scenarios but deny known write/execute actions.
    if (isLoginAllowUser && !hasPrivilegedPersona) {
      return {
        result: READ_ONLY_DENY_PERMISSIONS.has(permissionName)
          ? AuthorizeResult.DENY
          : AuthorizeResult.ALLOW,
      };
    }

    // ── Platform-only writes ──────────────────────────────────────────────────
    if (PLATFORM_ONLY_PERMISSIONS.has(permissionName)) {
      return {
        result: isPlatformUser ? AuthorizeResult.ALLOW : AuthorizeResult.DENY,
      };
    }

    // ── Scaffolder task execution: Platform + App Engineering + PS + SRE ─────
    if (WORKFLOW_EXECUTION_PERMISSIONS.has(permissionName)) {
      const allowed =
        isPlatformUser ||
        isAppEngineeringUser ||
        isPresalesUser ||
        isProfessionalServicesUser;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }

    // ── Catalog refreshes: Platform + PS ──────────────────────────────────────
    if (PLATFORM_PS_PERMISSIONS.has(permissionName)) {
      const allowed = isPlatformUser || isProfessionalServicesUser;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }

    if (permissionName === 'deployment.trigger') {
      const allowed =
        isPlatformUser ||
        isAppEngineeringUser ||
        isPresalesUser ||
        isProfessionalServicesUser;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }

    if (
      permissionName === 'deployment.view' ||
      permissionName === 'catalog.read'
    ) {
      const allowed =
        isPlatformUser ||
        isAppEngineeringUser ||
        isPresalesUser ||
        isProfessionalServicesUser ||
        isSreUser ||
        isLoginAllowUser;
      return { result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY };
    }

    // ── Default: allow unknown permissions for authenticated users ───────────
    //
    // Backstage emits a long list of permission names (catalog.entity.read,
    // scaffolder.template.parameter.read, scaffolder.template.step.read,
    // catalog.location.read, etc.). Only writes are gated above. Defaulting
    // to DENY here causes the catalog/scaffolder backends to hide entities
    // (the by-name endpoints return 404) for every authenticated user –
    // e.g. /api/catalog/entities/by-name/template/default/create-aks-cluster
    // and /api/scaffolder/v2/templates/.../parameter-schema would 404 even
    // though the template is registered. Read access is granted to all
    // authenticated users per the access matrix documented above.
    return { result: AuthorizeResult.ALLOW };
  }
}

// ─── Backend module ───────────────────────────────────────────────────────────

export const permissionModuleCloudHubPolicy = createBackendModule({
  pluginId: 'permission',
  moduleId: 'cloudhub-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new CloudHubPermissionPolicy());
      },
    });
  },
});

// Export as default for easier dynamic imports
export default permissionModuleCloudHubPolicy;
