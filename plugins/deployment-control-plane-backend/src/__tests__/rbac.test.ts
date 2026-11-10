import {
  canApproveDeployment,
  canCreateDeveloperEnvironment,
  canDeleteDeveloperEnvironment,
  canDeployApplication,
  canDeployOverlay,
  canDeployPlatform,
  canManageSecretValues,
  hasPermission,
  canProvisionInfrastructure,
  canRead,
  personaFromRole,
  resolvePersonaRole,
} from '../rbac';

describe('deployment control plane RBAC', () => {
  it('maps platform admin groups correctly', () => {
    const role = resolvePersonaRole(['group:default/cloudhubplatformowners']);
    expect(role).toBe('platform-admin');
    expect(canProvisionInfrastructure(role)).toBe(true);
    expect(canDeployPlatform(role)).toBe(true);
    expect(canDeployOverlay(role)).toBe(true);
    expect(canRead(role)).toBe(true);
  });

  it('maps professional services groups correctly', () => {
    const role = resolvePersonaRole(['group:default/cloudhubps']);
    expect(role).toBe('professional-services');
    expect(canDeployOverlay(role)).toBe(true);
    expect(canProvisionInfrastructure(role)).toBe(false);
  });

  it('maps canonical Entra group names correctly', () => {
    expect(resolvePersonaRole(['CloudHubPlatformOwners'])).toBe(
      'platform-admin',
    );
    expect(resolvePersonaRole(['CloudHubAppEng'])).toBe('app-engineering');
    expect(resolvePersonaRole(['CloudHubPS'])).toBe('professional-services');
    expect(resolvePersonaRole(['CloudHubSRE'])).toBe('readonly');
  });

  it('returns sidebar persona IDs rather than Entra group names', () => {
    expect(personaFromRole('platform-admin')).toBe('cloudhub-platform');
    expect(personaFromRole('app-engineering')).toBe('app-engineering');
    expect(personaFromRole('professional-services')).toBe(
      'professional-services',
    );
    expect(personaFromRole('readonly')).toBe('readonly');
  });

  it('maps app engineering groups correctly', () => {
    const role = resolvePersonaRole(['group:default/cloudhubappeng']);
    expect(role).toBe('app-engineering');
    expect(canDeployApplication(role)).toBe(true);
    expect(canRead(role)).toBe(true);
    expect(canCreateDeveloperEnvironment(role)).toBe(true);
    expect(canDeleteDeveloperEnvironment(role)).toBe(true);
    expect(canProvisionInfrastructure(role)).toBe(false);
  });

  it('maps cloudhub-login-allow to readonly role', () => {
    const role = resolvePersonaRole(['group:default/cloudhub-login-allow']);
    expect(role).toBe('readonly');
    expect(canRead(role)).toBe(true);
    expect(canDeployOverlay(role)).toBe(false);
    expect(canProvisionInfrastructure(role)).toBe(false);
  });

  it('uses permission checks for role capabilities', () => {
    const platformRole = resolvePersonaRole(['CloudHub.PlatformAdmin']);
    const appRole = resolvePersonaRole(['CloudHub.AppEngineer']);
    const psRole = resolvePersonaRole(['CloudHub.ProfessionalServices']);
    const sreRole = resolvePersonaRole(['CloudHub.SRE']);

    expect(hasPermission(platformRole, 'user.manage')).toBe(true);
    expect(hasPermission(appRole, 'app.deploy')).toBe(true);
    expect(hasPermission(psRole, 'customer.config.manage')).toBe(true);
    expect(hasPermission(sreRole, 'monitoring.view')).toBe(true);
    expect(hasPermission(sreRole, 'cluster.create')).toBe(false);
  });

  it('maps CloudHubPlatformOwners to platform-admin', () => {
    const role = resolvePersonaRole(['CloudHubPlatformOwners']);
    expect(role).toBe('platform-admin');
    expect(canProvisionInfrastructure(role)).toBe(true);
    expect(canDeployOverlay(role)).toBe(true);
  });

  it('maps Entra app roles to app-engineering', () => {
    const role = resolvePersonaRole(['role:CloudHub.AppEngineer']);
    expect(role).toBe('app-engineering');
    expect(canCreateDeveloperEnvironment(role)).toBe(true);
  });

  it('maps Entra app roles to professional-services', () => {
    const role = resolvePersonaRole(['CloudHub.ProfessionalServices']);
    expect(role).toBe('professional-services');
    expect(canDeployOverlay(role)).toBe(true);
  });

  it('maps Entra app roles to readonly (SRE)', () => {
    const role = resolvePersonaRole(['CloudHub.SRE']);
    expect(role).toBe('readonly');
    expect(canRead(role)).toBe(true);
  });

  it('defaults to readonly role', () => {
    const role = resolvePersonaRole(['group:default/unknown-team']);
    expect(role).toBe('readonly');
    expect(canRead(role)).toBe(true);
    expect(canDeployOverlay(role)).toBe(false);
    expect(canProvisionInfrastructure(role)).toBe(false);
  });

  it('keeps readonly restricted for developer environment writes', () => {
    const role = resolvePersonaRole(['group:default/cloudhub-login-allow']);
    expect(role).toBe('readonly');
    expect(canCreateDeveloperEnvironment(role)).toBe(false);
    expect(canDeleteDeveloperEnvironment(role)).toBe(false);
  });

  it('does not grant platform-admin privileges based on a user name alone', () => {
    expect(resolvePersonaRole([], 'user:symphonysensa/jubermohamad')).toBe(
      'readonly',
    );
    expect(
      resolvePersonaRole([], 'user:default/jubermohamad@symphonysensa.com'),
    ).toBe('readonly');
    expect(
      canApproveDeployment([], 'user:default/jubermohamad@symphonysensa.com'),
    ).toBe(false);
  });

  it('grants platform-admin privileges to the verified owners-group entitlement', () => {
    const role = resolvePersonaRole(
      ['group:default/cloudhubplatformowners'],
      'user:symphonysensa/jubermohamad',
    );
    expect(role).toBe('platform-admin');
    expect(canCreateDeveloperEnvironment(role)).toBe(true);
    expect(canProvisionInfrastructure(role)).toBe(true);
    expect(canApproveDeployment(['group:default/cloudhubplatformowners'])).toBe(
      true,
    );
  });

  it('allows only platform-admin to update secret values', () => {
    expect(canManageSecretValues('platform-admin')).toBe(true);
    expect(canManageSecretValues('professional-services')).toBe(false);
    expect(canManageSecretValues('app-engineering')).toBe(false);
    expect(canManageSecretValues('readonly')).toBe(false);
  });

  it('allows approval when admin group is represented as object id or app role', () => {
    expect(
      canApproveDeployment(['778023ed-fa96-43b3-8c35-4679943c01ee']),
    ).toBe(true);
    expect(canApproveDeployment(['role:CloudHub.PlatformAdmin'])).toBe(true);
  });

  it('allows approval for CloudHubPlatformOwners group members', () => {
    expect(canApproveDeployment(['group:default/cloudhubplatformowners'])).toBe(
      true,
    );
    expect(canApproveDeployment(['CloudHubPlatformOwners'])).toBe(true);
  });

});
