import type { PersonaRole } from './types';

export type CloudHubPermission =
  | 'cluster.create'
  | 'cluster.delete'
  | 'cluster.view'
  | 'platform.deploy'
  | 'app.deploy'
  | 'app.rollback'
  | 'overlay.deploy'
  | 'customer.config.manage'
  | 'secret.manage'
  | 'user.manage'
  | 'environment.create'
  | 'environment.delete'
  | 'health.view'
  | 'logs.view'
  | 'monitoring.view';

const PLATFORM_ADMIN_GROUPS = [
  'CloudHubPlatformOwners',
  'group:default/cloudhubplatformowners',
  'platform-admin',
  'CloudHub.PlatformAdmin',
  'cloudhub.platformadmin',
  'role:CloudHub.PlatformAdmin',
  'role:cloudhub.platformadmin',
];

const PROFESSIONAL_SERVICES_GROUPS = [
  'CloudHubPS',
  'group:default/cloudhubps',
  'CloudHub.ProfessionalServices',
  'cloudhub.professionalservices',
  'role:CloudHub.ProfessionalServices',
  'role:cloudhub.professionalservices',
];

const APP_ENGINEERING_GROUPS = [
  'CloudHubAppEng',
  'group:default/cloudhubappeng',
  'CloudHub.AppEngineer',
  'cloudhub.appengineer',
  'role:CloudHub.AppEngineer',
  'role:cloudhub.appengineer',
];

const READ_ONLY_GROUPS = [
  'CloudHubSRE',
  'group:default/cloudhubsre',
  'CloudHub.SRE',
  'cloudhub.sre',
  'role:CloudHub.SRE',
  'role:cloudhub.sre',
];


// Entra group whose members may approve deployment requests before deploy runs.
const DEPLOYMENT_APPROVER_GROUP = 'grp-cloudhub-platformadmin';
const DEPLOYMENT_APPROVER_GROUP_ALIASES = [
  DEPLOYMENT_APPROVER_GROUP,
  'group:default/grp-cloudhub-platformadmin',
  'group:default/cloudhubplatformowners',
  'cloudhubplatformowners',
  'CloudHubPlatformOwners',
  'cloudhub.platformadmin',
  'role:cloudhub.platformadmin',
  'platform-admin',
  '778023ed-fa96-43b3-8c35-4679943c01ee', // GRP-CloudHub-PlatformAdmin object ID
];

const ROLE_PERMISSIONS: Record<PersonaRole, CloudHubPermission[]> = {
  'platform-admin': [
    'cluster.create',
    'cluster.delete',
    'cluster.view',
    'platform.deploy',
    'app.deploy',
    'overlay.deploy',
    'customer.config.manage',
    'secret.manage',
    'user.manage',
    'environment.create',
    'environment.delete',
    'health.view',
    'logs.view',
    'monitoring.view',
  ],
  'app-engineering': [
    'cluster.view',
    'app.deploy',
    'app.rollback',
    'environment.create',
    'environment.delete',
    'health.view',
    'logs.view',
  ],
  'professional-services': [
    'cluster.view',
    'app.deploy',
    'overlay.deploy',
    'customer.config.manage',
    'environment.create',
    'health.view',
    'logs.view',
  ],
  readonly: ['cluster.view', 'health.view', 'logs.view', 'monitoring.view'],
};

export function resolvePersonaRole(
  groups: string[],
  _actorRef?: string,
): PersonaRole {
  if (matchesGroup(groups, PLATFORM_ADMIN_GROUPS)) {
    return 'platform-admin';
  }
  if (matchesGroup(groups, PROFESSIONAL_SERVICES_GROUPS)) {
    return 'professional-services';
  }
  if (matchesGroup(groups, APP_ENGINEERING_GROUPS)) {
    return 'app-engineering';
  }
  if (matchesGroup(groups, READ_ONLY_GROUPS)) {
    return 'readonly';
  }
  return 'readonly';
}

export function personaFromRole(
  role: PersonaRole,
):
  | 'cloudhub-platform'
  | 'app-engineering'
  | 'professional-services'
  | 'sre'
  | 'readonly' {
  switch (role) {
    case 'platform-admin':
      return 'cloudhub-platform';
    case 'app-engineering':
      return 'app-engineering';
    case 'professional-services':
      return 'professional-services';
    case 'readonly':
    default:
      return 'readonly';
  }
}

export function canRead(role: PersonaRole): boolean {
  return hasPermission(role, 'health.view');
}

export function hasPermission(
  role: PersonaRole,
  permission: CloudHubPermission,
): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function canProvisionInfrastructure(role: PersonaRole): boolean {
  return hasPermission(role, 'cluster.create');
}

export function canDeployPlatform(role: PersonaRole): boolean {
  return hasPermission(role, 'platform.deploy');
}

export function canDeployApplication(role: PersonaRole): boolean {
  return hasPermission(role, 'app.deploy');
}

export function canDeployOverlay(role: PersonaRole): boolean {
  return hasPermission(role, 'overlay.deploy');
}

export function canManageSecretValues(role: PersonaRole | string): boolean {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized in ROLE_PERMISSIONS) {
    return hasPermission(normalized as PersonaRole, 'secret.manage');
  }

  const resolved = resolvePersonaRole([normalized]);
  return hasPermission(resolved, 'secret.manage');
}

export function canCreateDeveloperEnvironment(role: PersonaRole): boolean {
  return hasPermission(role, 'environment.create');
}

export function canDeleteDeveloperEnvironment(role: PersonaRole): boolean {
  return hasPermission(role, 'environment.delete');
}

function normalizeGroupToken(token: string): string {
  return token.trim().toLowerCase();
}

function matchesGroup(groups: string[], candidates: string[]): boolean {
  const lowered = groups.map(normalizeGroupToken);
  return candidates.some(candidate => {
    const needle = normalizeGroupToken(candidate);
    return lowered.some(group => {
      return (
        group === needle ||
        group === `group:default/${needle}` ||
        group.endsWith(`/${needle}`) ||
        group.endsWith(`\\${needle}`) ||
        group.endsWith(`:${needle}`)
      );
    });
  });
}

export function canApproveDeployment(
  groups: string[],
  _actorRef?: string,
): boolean {
  return matchesGroup(groups, DEPLOYMENT_APPROVER_GROUP_ALIASES);
}

export const __groups = {
  PLATFORM_ADMIN_GROUPS,
  PROFESSIONAL_SERVICES_GROUPS,
  APP_ENGINEERING_GROUPS,
  READ_ONLY_GROUPS,
  DEPLOYMENT_APPROVER_GROUP,
  ROLE_PERMISSIONS,
};
