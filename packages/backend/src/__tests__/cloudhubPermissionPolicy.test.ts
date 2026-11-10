/**
 * cloudhubPermissionPolicy.test.ts
 *
 * Unit tests for the persona-based RBAC policy that gates Backstage
 * actions used by the AKS cluster lifecycle (create / namespace / update)
 * and the App Engineering application-deployment flow.
 *
 * Personas (canonical Entra group names):
 *   Platform        group:default/cloudhubplatformowners
 *   App Engineering group:default/cloudhubappeng
 *   Presales        group:default/cloudhubpresales
 *   Prof. Services  group:default/cloudhubps
 *   SRE             group:default/cloudhubsre (read-only)
 *   Login Allow     group:default/cloudhub-login-allow
 *
 * Access matrix exercised below:
 *
 *   Capability                          Platform  AppEng  Presales  PS   SRE  Guest
 *   ──────────────────────────────────────────────────────────────────────
 *   scaffolder.template.management         ✅       ❌    ❌    ❌    ❌
 *   catalog.entity.create                  ✅       ❌    ❌    ❌    ❌
 *   catalog.entity.delete                  ✅       ❌    ❌    ❌    ❌
 *   catalog.location.create                ✅       ❌    ❌    ❌    ❌
 *   catalog.location.delete                ✅       ❌    ❌    ❌    ❌
 *   scaffolder.task.create                 ✅       ✅    ✅    ✅    ❌    ❌
 *   scaffolder.task.cancel                 ✅       ✅    ✅    ✅    ❌    ❌
 *   catalog.entity.refresh                 ✅       ❌    ❌    ✅    ❌
 *   deployment.trigger                     ✅       ✅    ✅    ✅    ❌    ❌
 *   deployment.view                        ✅       ✅    ✅    ✅    ✅    ❌
 *   catalog.read                           ✅       ✅    ✅    ✅    ✅    ❌
 *   <unknown permission name>              ✅       ✅    ✅    ✅    ✅    ❌
 */

import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type {
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';

import { CloudHubPermissionPolicy, __test } from '../cloudhubPermissionPolicy';
import {
  aksApproveCloudArchitectPermission,
  aksApproveOperationsPermission,
  jumpboxApprovePermission,
} from '../permissions';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function userInGroups(...groupRefs: string[]): PolicyQueryUser {
  return {
    identity: {
      type: 'user',
      userEntityRef: 'user:default/test-user',
      ownershipEntityRefs: groupRefs,
    },
    credentials: { $$type: '@backstage/BackstageCredentials' } as never,
    info: {
      userEntityRef: 'user:default/test-user',
      ownershipEntityRefs: groupRefs,
    },
    token: 'fake-token',
  } as unknown as PolicyQueryUser;
}

function permissionQuery(name: string): PolicyQuery {
  return {
    permission: {
      type: 'basic',
      name,
      attributes: {},
    },
  } as unknown as PolicyQuery;
}

const PLATFORM_USER = userInGroups('group:default/cloudhubplatformowners');
const APP_ENG_USER = userInGroups('group:default/cloudhubappeng');
const PRESALES_USER = userInGroups('group:default/cloudhubpresales');
const PS_USER = userInGroups('group:default/cloudhubps');
const SRE_USER = userInGroups('group:default/cloudhubsre');
const PLATFORM_ROLE_USER = userInGroups('CloudHub.PlatformAdmin');
const APP_ENG_ROLE_USER = userInGroups('role:CloudHub.AppEngineer');
const PRESALES_ROLE_USER = userInGroups('role:CloudHub.Presales');
const PS_ROLE_USER = userInGroups('CloudHub.ProfessionalServices');
const SRE_ROLE_USER = userInGroups('CloudHub.SRE');
const LOGIN_ALLOW_USER = userInGroups('group:default/cloudhub-login-allow');
const JUMPBOX_APPROVER_USER = userInGroups(
  process.env.CLOUDHUB_APPROVER_GROUP_REF ?? 'group:default/platform-approvers',
);
const UNKNOWN_USER = userInGroups('group:default/some-random-team');
const GUEST_USER = userInGroups(); // no group refs
const UNDEFINED_USER = undefined;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function decide(permission: string, user?: PolicyQueryUser) {
  const policy = new CloudHubPermissionPolicy();
  const decision = await policy.handle(permissionQuery(permission), user);
  return decision.result;
}

const ALLOW = AuthorizeResult.ALLOW;
const DENY = AuthorizeResult.DENY;

// ─── Group constants are wired correctly ─────────────────────────────────────

describe('CloudHubPermissionPolicy — persona group constants', () => {
  it('canonical Entra group is first in each persona list', () => {
    expect(__test.PLATFORM_GROUPS[0]).toBe(
      'group:default/cloudhubplatformowners',
    );
    expect(__test.APP_ENGINEERING_GROUPS[0]).toBe(
      'group:default/cloudhubappeng',
    );
    expect(__test.PRESALES_GROUPS[0]).toBe('group:default/cloudhubpresales');
    expect(__test.PS_GROUPS[0]).toBe('group:default/cloudhubps');
    expect(__test.SRE_GROUPS[0]).toBe('group:default/cloudhubsre');
    expect(__test.LOGIN_ALLOW_GROUPS[0]).toBe(
      'group:default/cloudhub-login-allow',
    );
  });

  it('recognizes raw Entra group aliases as persona members', async () => {
    const policy = new CloudHubPermissionPolicy();
    await expect(
      policy.handle(
        permissionQuery('catalog.read'),
        userInGroups('CloudHubAppEng'),
      ),
    ).resolves.toMatchObject({ result: AuthorizeResult.ALLOW });
    await expect(
      policy.handle(
        permissionQuery('catalog.read'),
        userInGroups('CloudHubSRE'),
      ),
    ).resolves.toMatchObject({ result: AuthorizeResult.ALLOW });
  });

  it('persona group lists do not overlap', () => {
    const all = [
      __test.PLATFORM_GROUPS,
      __test.APP_ENGINEERING_GROUPS,
      __test.PRESALES_GROUPS,
      __test.PS_GROUPS,
      __test.SRE_GROUPS,
    ];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const intersection = all[i].filter(g => all[j].includes(g));
        expect(intersection).toEqual([]);
      }
    }
  });

  it('App Engineering permissions cover deployment view + catalog read', () => {
    expect(__test.PLATFORM_APP_PERMISSIONS.has('deployment.view')).toBe(true);
    expect(__test.PLATFORM_APP_PERMISSIONS.has('catalog.read')).toBe(true);
  });

  it('workflow execution permissions include scaffolder task create/cancel', () => {
    expect(
      __test.WORKFLOW_EXECUTION_PERMISSIONS.has('scaffolder.task.create'),
    ).toBe(true);
    expect(
      __test.WORKFLOW_EXECUTION_PERMISSIONS.has('scaffolder.task.cancel'),
    ).toBe(true);
  });

  it('read-only deny set includes all known write actions', () => {
    expect(
      __test.READ_ONLY_DENY_PERMISSIONS.has('scaffolder.template.management'),
    ).toBe(true);
    expect(
      __test.READ_ONLY_DENY_PERMISSIONS.has('scaffolder.task.create'),
    ).toBe(true);
    expect(__test.READ_ONLY_DENY_PERMISSIONS.has('catalog.entity.create')).toBe(
      true,
    );
    expect(__test.READ_ONLY_DENY_PERMISSIONS.has('deployment.trigger')).toBe(
      true,
    );
  });
});

// ─── Guest access (strict by default) ───────────────────────────────────────

describe('CloudHubPermissionPolicy — guest access', () => {
  it.each([
    'scaffolder.template.management',
    'catalog.entity.create',
    'catalog.entity.delete',
    'catalog.location.create',
    'catalog.location.delete',
    'scaffolder.task.create',
    'scaffolder.task.cancel',
    'catalog.entity.refresh',
    'deployment.trigger',
    'deployment.view',
    'catalog.read',
    'something.not.in.the.matrix',
  ])('DENIES guest user for %s', async permission => {
    await expect(decide(permission, GUEST_USER)).resolves.toBe(DENY);
  });

  it('DENIES when user is undefined (no auth context yet)', async () => {
    await expect(decide('catalog.entity.delete', UNDEFINED_USER)).resolves.toBe(
      DENY,
    );
  });
});

// ─── Platform persona — full access ──────────────────────────────────────────

describe('CloudHubPermissionPolicy — Platform Super User', () => {
  const cases: Array<[string]> = [
    ['scaffolder.template.management'],
    ['catalog.entity.create'],
    ['catalog.entity.delete'],
    ['catalog.location.create'],
    ['catalog.location.delete'],
    ['scaffolder.task.create'],
    ['scaffolder.task.cancel'],
    ['catalog.entity.refresh'],
    ['deployment.trigger'],
    ['deployment.view'],
    ['catalog.read'],
  ];
  it.each(cases)('ALLOWS %s', async permission => {
    await expect(decide(permission, PLATFORM_USER)).resolves.toBe(ALLOW);
  });

  it('honours every legacy alias as Platform', async () => {
    for (const ref of __test.PLATFORM_GROUPS) {
      const user = userInGroups(ref);
      await expect(decide('catalog.entity.delete', user)).resolves.toBe(ALLOW);
    }
  });

  it('honours Entra app-role claim as Platform', async () => {
    await expect(
      decide('catalog.entity.delete', PLATFORM_ROLE_USER),
    ).resolves.toBe(ALLOW);
  });
});

// ─── App Engineering — deployment + scaffolder, no catalog writes ────────────

describe('CloudHubPermissionPolicy — App Engineering', () => {
  it('ALLOWS scaffolder task create (run service-deployment-wizard template)', async () => {
    await expect(decide('scaffolder.task.create', APP_ENG_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('ALLOWS scaffolder task cancel', async () => {
    await expect(decide('scaffolder.task.cancel', APP_ENG_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('ALLOWS deployment.trigger (apply app via GitHub Actions)', async () => {
    await expect(decide('deployment.trigger', APP_ENG_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('ALLOWS cluster creation for App Engineering', async () => {
    await expect(decide('cluster.create', APP_ENG_USER)).resolves.toBe(ALLOW);
  });

  it('ALLOWS deployment.view', async () => {
    await expect(decide('deployment.view', APP_ENG_USER)).resolves.toBe(ALLOW);
  });

  it('ALLOWS catalog.read', async () => {
    await expect(decide('catalog.read', APP_ENG_USER)).resolves.toBe(ALLOW);
  });

  it.each([
    'scaffolder.template.management',
    'catalog.entity.create',
    'catalog.entity.delete',
    'catalog.location.create',
    'catalog.location.delete',
  ])('DENIES catalog/template write: %s', async permission => {
    await expect(decide(permission, APP_ENG_USER)).resolves.toBe(DENY);
  });

  it('DENIES catalog.entity.refresh (Platform/PS only)', async () => {
    await expect(decide('catalog.entity.refresh', APP_ENG_USER)).resolves.toBe(
      DENY,
    );
  });

  it('honours every App Engineering alias', async () => {
    for (const ref of __test.APP_ENGINEERING_GROUPS) {
      const user = userInGroups(ref);
      await expect(decide('deployment.trigger', user)).resolves.toBe(ALLOW);
      await expect(decide('catalog.entity.delete', user)).resolves.toBe(DENY);
    }
  });

  it('honours Entra app-role claim as App Engineering', async () => {
    await expect(decide('deployment.trigger', APP_ENG_ROLE_USER)).resolves.toBe(
      ALLOW,
    );
    await expect(
      decide('catalog.entity.delete', APP_ENG_ROLE_USER),
    ).resolves.toBe(DENY);
  });
});

// ─── Presales — deployment + scaffolder, no cluster creation ────────────────

describe('CloudHubPermissionPolicy — Presales', () => {
  it('ALLOWS scaffolder task create', async () => {
    await expect(decide('scaffolder.task.create', PRESALES_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('ALLOWS deployment.trigger', async () => {
    await expect(decide('deployment.trigger', PRESALES_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('ALLOWS deployment.view and catalog.read', async () => {
    await expect(decide('deployment.view', PRESALES_USER)).resolves.toBe(ALLOW);
    await expect(decide('catalog.read', PRESALES_USER)).resolves.toBe(ALLOW);
  });

  it('DENIES catalog writes', async () => {
    await expect(decide('catalog.entity.create', PRESALES_USER)).resolves.toBe(
      DENY,
    );
    await expect(decide('catalog.entity.delete', PRESALES_USER)).resolves.toBe(
      DENY,
    );
  });

  it('honours Entra app-role claim as Presales', async () => {
    await expect(
      decide('deployment.trigger', PRESALES_ROLE_USER),
    ).resolves.toBe(ALLOW);
  });
});

// ─── Professional Services — scaffolder + catalog refresh, no deploy ─────────

describe('CloudHubPermissionPolicy — Professional Services', () => {
  it('ALLOWS scaffolder.task.create', async () => {
    await expect(decide('scaffolder.task.create', PS_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('ALLOWS catalog.entity.refresh', async () => {
    await expect(decide('catalog.entity.refresh', PS_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it.each([
    'scaffolder.template.management',
    'catalog.entity.create',
    'catalog.entity.delete',
    'catalog.location.create',
    'catalog.location.delete',
  ])('DENIES catalog/template write: %s', async permission => {
    await expect(decide(permission, PS_USER)).resolves.toBe(DENY);
  });

  it('ALLOWS deployment.trigger, deployment.view and catalog.read', async () => {
    await expect(decide('deployment.trigger', PS_USER)).resolves.toBe(ALLOW);
    await expect(decide('deployment.view', PS_USER)).resolves.toBe(ALLOW);
    await expect(decide('catalog.read', PS_USER)).resolves.toBe(ALLOW);
  });

  it('DENIES platform-only permissions', async () => {
    await expect(decide('catalog.entity.create', PS_USER)).resolves.toBe(DENY);
    await expect(decide('catalog.entity.delete', PS_USER)).resolves.toBe(DENY);
  });

  it('honours Entra app-role claim as Professional Services', async () => {
    await expect(decide('catalog.entity.refresh', PS_ROLE_USER)).resolves.toBe(
      ALLOW,
    );
    await expect(decide('deployment.trigger', PS_ROLE_USER)).resolves.toBe(
      ALLOW,
    );
  });
});

// ─── SRE — scaffolder + catalog refresh, no deploy ───────────────────────────

describe('CloudHubPermissionPolicy — SRE', () => {
  it('DENIES scaffolder.task.create', async () => {
    await expect(decide('scaffolder.task.create', SRE_USER)).resolves.toBe(
      DENY,
    );
  });

  it('DENIES catalog.entity.refresh', async () => {
    await expect(decide('catalog.entity.refresh', SRE_USER)).resolves.toBe(
      DENY,
    );
  });

  it.each([
    'scaffolder.template.management',
    'catalog.entity.create',
    'catalog.entity.delete',
    'catalog.location.create',
    'catalog.location.delete',
  ])('DENIES catalog/template write: %s', async permission => {
    await expect(decide(permission, SRE_USER)).resolves.toBe(DENY);
  });

  it('ALLOWS deployment.view, catalog.read and unknown read-only names', async () => {
    await expect(decide('deployment.view', SRE_USER)).resolves.toBe(ALLOW);
    await expect(decide('catalog.read', SRE_USER)).resolves.toBe(ALLOW);
    await expect(decide('something.not.in.the.matrix', SRE_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('DENIES deployment.trigger', async () => {
    await expect(decide('deployment.trigger', SRE_USER)).resolves.toBe(DENY);
  });

  it('honours Entra app-role claim as SRE', async () => {
    await expect(decide('catalog.read', SRE_ROLE_USER)).resolves.toBe(ALLOW);
    await expect(decide('deployment.trigger', SRE_ROLE_USER)).resolves.toBe(
      DENY,
    );
  });
});

// ─── Unknown / unmapped authenticated user ──────────────────────────────────

describe('CloudHubPermissionPolicy — unknown authenticated user', () => {
  it('DENIES platform-only writes', async () => {
    await expect(decide('catalog.entity.delete', UNKNOWN_USER)).resolves.toBe(
      DENY,
    );
  });

  it('DENIES workflow execution', async () => {
    await expect(decide('scaffolder.task.create', UNKNOWN_USER)).resolves.toBe(
      DENY,
    );
  });

  it('DENIES deployment.trigger', async () => {
    await expect(decide('deployment.trigger', UNKNOWN_USER)).resolves.toBe(
      DENY,
    );
  });

  it('DENIES unknown permission names for users without approved access groups', async () => {
    await expect(decide('catalog.entity.read', UNKNOWN_USER)).resolves.toBe(
      DENY,
    );
    await expect(
      decide('scaffolder.template.parameter.read', UNKNOWN_USER),
    ).resolves.toBe(DENY);
  });
});

// ─── Login allow role (portal read-only baseline) ───────────────────────────

describe('CloudHubPermissionPolicy — cloudhub-login-allow role', () => {
  it.each([
    'catalog.read',
    'deployment.view',
    'catalog.entity.read',
    'catalog.location.read',
    'something.not.in.the.matrix',
  ])('ALLOWS read/default permission: %s', async permission => {
    await expect(decide(permission, LOGIN_ALLOW_USER)).resolves.toBe(ALLOW);
  });

  it.each([
    'scaffolder.template.management',
    'catalog.entity.create',
    'catalog.entity.delete',
    'catalog.location.create',
    'catalog.location.delete',
    'scaffolder.task.create',
    'scaffolder.task.cancel',
    'catalog.entity.refresh',
    'deployment.trigger',
  ])('DENIES write/execute permission: %s', async permission => {
    await expect(decide(permission, LOGIN_ALLOW_USER)).resolves.toBe(DENY);
  });

  it('uses higher-privilege persona when user has both login-allow and AppEng group', async () => {
    const hybrid = userInGroups(
      'group:default/cloudhub-login-allow',
      'group:default/cloudhubappeng',
    );
    await expect(decide('deployment.trigger', hybrid)).resolves.toBe(ALLOW);
  });
});

// ─── AKS lifecycle scenarios (end-to-end persona expectations) ───────────────

describe('CloudHubPermissionPolicy — AKS lifecycle scenarios', () => {
  describe('Create AKS cluster (scaffolder dispatches plan/apply workflow)', () => {
    it('Platform can launch create-aks-cluster wizard', async () => {
      await expect(
        decide('scaffolder.task.create', PLATFORM_USER),
      ).resolves.toBe(ALLOW);
    });
    it('App Engineering can launch create-aks-cluster wizard', async () => {
      await expect(
        decide('scaffolder.task.create', APP_ENG_USER),
      ).resolves.toBe(ALLOW);
    });
    it('PS can launch create-aks-cluster wizard', async () => {
      await expect(decide('scaffolder.task.create', PS_USER)).resolves.toBe(
        ALLOW,
      );
    });
  });

  describe('Create namespace in existing cluster (PR + helm dispatch)', () => {
    it('App Engineering can launch namespace wizard', async () => {
      await expect(
        decide('scaffolder.task.create', APP_ENG_USER),
      ).resolves.toBe(ALLOW);
    });
    it('App Engineering can trigger the namespace deployment', async () => {
      await expect(decide('deployment.trigger', APP_ENG_USER)).resolves.toBe(
        ALLOW,
      );
    });
    it('Presales can launch namespace wizard and trigger deployment', async () => {
      await expect(
        decide('scaffolder.task.create', PRESALES_USER),
      ).resolves.toBe(ALLOW);
      await expect(decide('deployment.trigger', PRESALES_USER)).resolves.toBe(
        ALLOW,
      );
    });
  });

  describe('Update AKS cluster (re-render tfvars + dispatch terraform plan/apply)', () => {
    it('Platform can run the update wizard', async () => {
      await expect(
        decide('scaffolder.task.create', PLATFORM_USER),
      ).resolves.toBe(ALLOW);
    });
    it('SRE cannot run the update wizard', async () => {
      await expect(decide('scaffolder.task.create', SRE_USER)).resolves.toBe(
        DENY,
      );
    });
    it('Unknown user cannot run the update wizard', async () => {
      await expect(
        decide('scaffolder.task.create', UNKNOWN_USER),
      ).resolves.toBe(DENY);
    });
  });

  describe('App Engineering deploys application into existing cluster', () => {
    it('can launch service-deployment-wizard template', async () => {
      await expect(
        decide('scaffolder.task.create', APP_ENG_USER),
      ).resolves.toBe(ALLOW);
    });
    it('can trigger the helm upgrade --install workflow', async () => {
      await expect(decide('deployment.trigger', APP_ENG_USER)).resolves.toBe(
        ALLOW,
      );
    });
    it('can view deployment status', async () => {
      await expect(decide('deployment.view', APP_ENG_USER)).resolves.toBe(
        ALLOW,
      );
    });
    it('cannot create or delete catalog entities directly (must go through template PR)', async () => {
      await expect(decide('catalog.entity.create', APP_ENG_USER)).resolves.toBe(
        DENY,
      );
      await expect(decide('catalog.entity.delete', APP_ENG_USER)).resolves.toBe(
        DENY,
      );
    });
  });
});

describe('CloudHubPermissionPolicy — strict auth mode', () => {
  const oldStrict = process.env.CLOUDHUB_STRICT_AUTH;

  beforeAll(() => {
    process.env.CLOUDHUB_STRICT_AUTH = 'true';
  });

  afterAll(() => {
    if (oldStrict === undefined) {
      delete process.env.CLOUDHUB_STRICT_AUTH;
    } else {
      process.env.CLOUDHUB_STRICT_AUTH = oldStrict;
    }
  });

  it('DENIES guest users in strict mode', async () => {
    await expect(decide('catalog.entity.read', GUEST_USER)).resolves.toBe(DENY);
    await expect(decide('catalog.entity.read', UNDEFINED_USER)).resolves.toBe(
      DENY,
    );
  });

  it('DENIES authenticated users without any approved access group in strict mode', async () => {
    await expect(decide('catalog.entity.read', UNKNOWN_USER)).resolves.toBe(
      DENY,
    );
  });

  it('ALLOWS login-allow user read access in strict mode', async () => {
    await expect(decide('catalog.entity.read', LOGIN_ALLOW_USER)).resolves.toBe(
      ALLOW,
    );
  });

  it('DENIES jumpbox.approve to login-allow-only users', async () => {
    await expect(
      decide(jumpboxApprovePermission.name, LOGIN_ALLOW_USER),
    ).resolves.toBe(DENY);
  });

  it('ALLOWS jumpbox.approve only for the approver group', async () => {
    await expect(
      decide(jumpboxApprovePermission.name, JUMPBOX_APPROVER_USER),
    ).resolves.toBe(ALLOW);
    await expect(
      decide(jumpboxApprovePermission.name, PLATFORM_USER),
    ).resolves.toBe(DENY);
  });
});

describe('CloudHubPermissionPolicy — strict auth opt-out', () => {
  const oldStrict = process.env.CLOUDHUB_STRICT_AUTH;

  beforeAll(() => {
    process.env.CLOUDHUB_STRICT_AUTH = 'false';
  });

  afterAll(() => {
    if (oldStrict === undefined) {
      delete process.env.CLOUDHUB_STRICT_AUTH;
    } else {
      process.env.CLOUDHUB_STRICT_AUTH = oldStrict;
    }
  });

  it('ALLOWS guest users only when strict auth is explicitly disabled', async () => {
    await expect(decide('catalog.entity.read', GUEST_USER)).resolves.toBe(
      ALLOW,
    );
    await expect(decide('catalog.entity.read', UNDEFINED_USER)).resolves.toBe(
      ALLOW,
    );
  });
});

describe('CloudHubPermissionPolicy — AKS approval stages', () => {
  const saved = {
    arch: process.env.CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS,
    ops: process.env.CLOUDHUB_AKS_OPERATIONS_GROUP_REFS,
    strict: process.env.CLOUDHUB_STRICT_AUTH,
  };
  afterEach(() => {
    for (const [key, value] of [
      ['CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS', saved.arch],
      ['CLOUDHUB_AKS_OPERATIONS_GROUP_REFS', saved.ops],
      ['CLOUDHUB_STRICT_AUTH', saved.strict],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('DENIES unconfigured stages to everyone, including platform owners and jumpbox approvers', async () => {
    delete process.env.CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS;
    delete process.env.CLOUDHUB_AKS_OPERATIONS_GROUP_REFS;
    for (const user of [
      PLATFORM_USER,
      JUMPBOX_APPROVER_USER,
      LOGIN_ALLOW_USER,
    ]) {
      await expect(
        decide(aksApproveCloudArchitectPermission.name, user),
      ).resolves.toBe(DENY);
      await expect(
        decide(aksApproveOperationsPermission.name, user),
      ).resolves.toBe(DENY);
    }
  });

  it('ALLOWS a configured stage only for its own groups', async () => {
    process.env.CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS =
      'group:default/cloud-architects';
    const architect = userInGroups(
      'group:default/cloudhub-login-allow',
      'group:default/cloud-architects',
    );
    await expect(
      decide(aksApproveCloudArchitectPermission.name, architect),
    ).resolves.toBe(ALLOW);
    await expect(
      decide(aksApproveOperationsPermission.name, architect),
    ).resolves.toBe(DENY);
    await expect(
      decide(jumpboxApprovePermission.name, architect),
    ).resolves.toBe(DENY);
    await expect(
      decide(aksApproveCloudArchitectPermission.name, JUMPBOX_APPROVER_USER),
    ).resolves.toBe(DENY);
  });

  it('DENIES approvals to guests even when strict auth is disabled', async () => {
    process.env.CLOUDHUB_STRICT_AUTH = 'false';
    await expect(
      decide(jumpboxApprovePermission.name, GUEST_USER),
    ).resolves.toBe(DENY);
  });
});
