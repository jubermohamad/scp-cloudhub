import { PERSONA_PERMISSIONS, PERSONAS, __test } from './PersonaContext';
import { identityApiRef, microsoftAuthApiRef } from '@backstage/core-plugin-api';

describe('PersonaContext persona catalogue', () => {
  it('includes only the canonical CloudHub personas', () => {
    expect(PERSONAS.some(p => p.id === 'cloudhub-platform')).toBe(true);
    expect(PERSONAS.some(p => p.id === 'app-engineering')).toBe(true);
    expect(PERSONAS.some(p => p.id === 'professional-services')).toBe(true);
    expect(PERSONAS.some(p => p.id === 'sre')).toBe(true);
    expect(PERSONAS.some(p => p.id === 'readonly')).toBe(true);
    const legacyIds = ['presales', 'read-only'] as const;
    expect(PERSONAS.some(p => legacyIds.includes(p.id as (typeof legacyIds)[number]))).toBe(false);
  });
});

describe('PersonaContext group resolution', () => {
  it('maps raw Entra group names to the platform persona', () => {
    expect(
      __test.resolvePersonaFromGroups(['CloudHubPlatformOwners']),
    ).toBe('cloudhub-platform');
  });

  it('maps raw Entra group names to app engineering', () => {
    expect(__test.resolvePersonaFromGroups(['CloudHubAppEng'])).toBe(
      'app-engineering',
    );
  });

  it('ignores non-canonical legacy groups', () => {
    expect(
      __test.resolvePersonaFromGroups([
        'group:default/cloudhubpresales',
        'group:default/some-other-group',
      ]),
    ).toBe(null);
  });

  it('prefers platform over other canonical personas when multiple groups are present', () => {
    expect(
      __test.resolvePersonaFromGroups([
        'group:default/cloudhubappeng',
        'group:default/cloudhubplatformowners',
      ]),
    ).toBe('cloudhub-platform');
  });

  it('verifies owners-group members receive platform persona', () => {
    expect(
      __test.resolvePersonaFromGroups(['CloudHubPlatformOwners']),
    ).toBe('cloudhub-platform');
  });

  it('verifies login-allow-only members receive read-only persona', () => {
    expect(
      __test.resolvePersonaFromGroups(['group:default/cloudhub-login-allow']),
    ).toBe('readonly');
  });
});

describe('PersonaContext identity fallback', () => {
  it('uses the Microsoft auth provider as the identity fallback when the standard identity API is unavailable', async () => {
    const profile = { displayName: 'Jane Doe', email: 'jane@example.com' };
    const microsoftAuthApi = {
      getBackstageIdentity: jest.fn().mockResolvedValue({
        identity: {
          userEntityRef: 'user:default/jane.doe',
          ownershipEntityRefs: ['group:default/cloudhubplatformowners'],
        },
        token: 'test-token',
      }),
      getProfile: jest.fn().mockResolvedValue(profile),
    };

    const apiHolder = {
      get: (ref: unknown) => {
        if (ref === microsoftAuthApiRef) {
          return microsoftAuthApi;
        }
        if (ref === identityApiRef) {
          return undefined;
        }
        return undefined;
      },
    };

    const identityApi = __test.resolveIdentityApi(apiHolder);

    expect(identityApi).toBeDefined();
    await expect(identityApi!.getBackstageIdentity()).resolves.toMatchObject({
      userEntityRef: 'user:default/jane.doe',
    });
    await expect(identityApi!.getProfileInfo!()).resolves.toMatchObject({
      displayName: 'Jane Doe',
      email: 'jane@example.com',
    });
  });
});

describe('PersonaContext permission matrix', () => {
  it('keeps the canonical persona set aligned to the supported CloudHub roles', () => {
    expect(PERSONA_PERMISSIONS['cluster.create']).not.toContain('presales');
    expect(PERSONA_PERMISSIONS['cluster.create']).not.toContain('read-only');
    expect(PERSONA_PERMISSIONS['service-wizard.run']).not.toContain('sre');
    expect(PERSONA_PERMISSIONS['deployment.trigger']).not.toContain('sre');
    expect(PERSONA_PERMISSIONS['deployment.view']).toContain('sre');
    expect(PERSONA_PERMISSIONS['catalog.read']).toContain('sre');
    expect(PERSONA_PERMISSIONS['deployment.rollback']).not.toContain('sre');
  });
});
