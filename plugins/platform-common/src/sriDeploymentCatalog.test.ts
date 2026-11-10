import {
  SRI_CATALOG_COMPONENTS,
  SRI_COMPONENTS,
  SRI_DEPLOYMENT_WORKFLOW_ID,
  SYMPHONYFS_SCRIPTS_SUPPORTED_APPS,
  isSymphonyFsScriptsSupportedApp,
} from './sriDeploymentCatalog';

describe('SRI deployment catalog', () => {
  it('uses one workflow for every component', () => {
    expect(
      new Set(SRI_COMPONENTS.map(component => component.deployment.workflow)),
    ).toEqual(new Set([SRI_DEPLOYMENT_WORKFLOW_ID]));
  });

  it('keeps deployable components mapped to GitHub applications', () => {
    const supported = SRI_COMPONENTS.filter(
      component => component.deployment.supported,
    );

    expect(supported.length).toBeGreaterThan(0);
    supported.forEach(component => {
      expect(component.deployment.application).toEqual(expect.any(String));
      expect((component.deployment.application ?? '').trim()).not.toBe('');
    });
  });

  it('only marks a component supported when its appName is accepted by SymphonyFS/scripts', () => {
    SRI_COMPONENTS.forEach(component => {
      const isWhitelisted = isSymphonyFsScriptsSupportedApp(
        component.deployment.application,
      );
      expect(component.deployment.supported).toBe(isWhitelisted);
    });
  });

  it('lists exactly the apps with a bundled CloudHub Native chart', () => {
    expect(new Set(SYMPHONYFS_SCRIPTS_SUPPORTED_APPS)).toEqual(
      new Set([
        'ai-store',
        'datadog',
        'common-res',
        'dxv',
        'detectionhub',
        'edb-common-res',
        'flows',
        'invhub',
        'netreveal',
        'netrevealv95',
        'netrevealv96',
        'edb-netrevealv96',
        'mtls-outbound',
        'sensaai-sanctions',
        'tailscale',
        'velero',
        'istio-service-entry',
        'hybrid-manager',
      ]),
    );
  });

  it('defines stable developer-environment component IDs', () => {
    expect(SRI_CATALOG_COMPONENTS.map(component => component.id)).toEqual([
      'sri-investigation-api',
      'sri-investigation-ui',
      'sri-investigation-ai',
      'sri-detection-api',
      'sri-detection-engine',
      'sri-detection-ui',
      'sri-detection-db',
      'sri-data-pipeline',
      'sri-sanctions',
      'sri-agents',
    ]);
  });

  it('maps every catalog component to a development profile', () => {
    SRI_CATALOG_COMPONENTS.forEach(component => {
      expect(component.developmentProfile.id).toMatch(/^[a-z0-9-]+$/);
      expect(component.developmentProfile.version).toBe('v1');
      expect(component.product).toBe('SRI');
      expect(component.deployment.type).toBe('kubernetes');
    });
  });
});
