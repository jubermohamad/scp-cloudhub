import {
  AKS_FLAVOR_POOLS,
  AZURE_REGION_SHORTNAMES,
  aksTfcProjectForWorkspace,
  cidrsOverlap,
  cidrsubnet,
  deriveAksNames,
  deriveAksSubnets,
  hclString,
  normalizeAksClusterRequest,
  normalizeWorkflowState,
  renderAksValuesFile,
  validateAksClusterRequest,
  validateWorkflowTransition,
  type AksClusterRequest,
} from './aksCluster';

function request(overrides: Record<string, unknown> = {}): AksClusterRequest {
  return normalizeAksClusterRequest({
    customer: 'Contoso',
    businessUnit: 'Retail',
    owner: 'Owner@Contoso.com',
    costCentre: 'P64358',
    changeTicket: 'scp-1234',
    clusterProfile: 'single-region',
    env: 'PRD',
    location: 'UKSouth',
    tenancy: 'st',
    tenantId: 'Contoso',
    kubernetesVersion: '1.36.2',
    addressSpace: '10.230.0.0/16',
    ...AKS_FLAVOR_POOLS.medium,
    ...overrides,
  });
}

describe('deriveAksNames', () => {
  it('follows the naming module generic pattern with no sequence', () => {
    expect(deriveAksNames(request())).toEqual({
      regionCode: 'uks',
      clusterName: 'aks-scp-prd-uks-st-contoso',
      resourceGroupName: 'rg-scp-prd-uks-st-contoso',
      vnetName: 'vnet-scp-prd-uks-st-contoso',
      nodeResourceGroupName: 'mc-rg-scp-prd-uks-st-contoso-node-rg',
      jumpboxName: 'jumpbox-scp-prd-uks-st-contoso',
      workspaceName: 'aks-scp-prd-uks-st-contoso',
      valuesFilePath:
        'azure-kubernetes-service-standard/values/aks-scp-prd-uks-st-contoso.tfvars',
    });
  });

  it.each([
    ['australiaeast', 'ae'],
    ['swedencentral', 'sdc'],
    ['westeurope', 'we'],
    ['spaincentral', 'esc'],
  ])('uses the standard-root region code for %s', (location, code) => {
    expect(deriveAksNames(request({ location })).regionCode).toBe(code);
  });

  it('reproduces existing standard-root cluster names', () => {
    const existing = [
      ['prd', 'uksouth', 'st', 'mcard', 'aks-scp-prd-uks-st-mcard'],
      ['prd', 'australiaeast', 'st', 'lfs', 'aks-scp-prd-ae-st-lfs'],
      ['prd', 'canadacentral', 'mt', 'all', 'aks-scp-prd-cnc-mt-all'],
      [
        'dev',
        'polandcentral',
        'st',
        'intdemo02',
        'aks-scp-dev-plc-st-intdemo02',
      ],
    ];
    for (const [env, location, tenancy, tenantId, name] of existing) {
      expect(
        deriveAksNames(request({ env, location, tenancy, tenantId }))
          .clusterName,
      ).toBe(name);
    }
  });

  it('never produces the deprecated aue code', () => {
    expect(Object.values(AZURE_REGION_SHORTNAMES)).not.toContain('aue');
  });
});

describe('deriveAksSubnets', () => {
  it('matches the standard root cidrsubnet() derivations', () => {
    expect(deriveAksSubnets('10.166.0.0/16')).toEqual({
      aks: '10.166.0.0/18',
      secondary: '10.166.128.0/18',
      netapp: '10.166.192.0/24',
      vpnGateway: '10.166.255.0/27',
    });
    expect(cidrsubnet('10.0.0.0/16', 12, 4095)).toBe('10.0.255.240/28');
  });
});

describe('validateAksClusterRequest', () => {
  it('accepts a valid request', () => {
    expect(validateAksClusterRequest(request())).toEqual({});
  });

  it('normalises case and whitespace', () => {
    const r = request();
    expect(r.env).toBe('prd');
    expect(r.location).toBe('uksouth');
    expect(r.tenantId).toBe('contoso');
    expect(r.changeTicket).toBe('SCP-1234');
    expect(r.owner).toBe('owner@contoso.com');
  });

  it.each([
    ['env', { env: 'prod' }],
    ['location', { location: 'atlantis' }],
    ['tenancy', { tenancy: 'xt' }],
    ['tenantId', { tenantId: 'a' }],
    ['tenantId', { tenantId: 'has-hyphen' }],
    ['kubernetesVersion', { kubernetesVersion: '1.33' }],
    ['addressSpace', { addressSpace: '10.0.0.0/16' }],
    ['addressSpace', { addressSpace: '10.230.0.0/24' }],
    ['addressSpace', { addressSpace: '172.16.0.0/16' }],
    ['addressSpace', { addressSpace: '10.256.0.0/16' }],
    ['changeTicket', { changeTicket: '' }],
    ['costCentre', { costCentre: 'x' }],
    ['owner', { owner: 'not-an-email' }],
    ['customer', { customer: 'bad\u0000name' }],
    ['clusterProfile', { clusterProfile: 'active-active' }],
    ['clusterProfile', { clusterProfile: 'galaxy' }],
  ])('rejects an invalid %s', (field, overrides) => {
    expect(validateAksClusterRequest(request(overrides))).toHaveProperty(field);
  });

  it('validates node pools', () => {
    const bad = (systemPool: unknown, userPool: unknown = null) =>
      validateAksClusterRequest(request({ systemPool, userPool }));
    const ok = AKS_FLAVOR_POOLS.medium.systemPool;
    expect(bad({ ...ok, minCount: 0 })).toHaveProperty('systemPool');
    expect(bad({ ...ok, minCount: 3, maxCount: 2 })).toHaveProperty(
      'systemPool',
    );
    expect(bad({ ...ok, maxCount: 1001 })).toHaveProperty('systemPool');
    expect(bad({ ...ok, vmSize: 'D8; rm -rf' })).toHaveProperty('systemPool');
    expect(bad({ ...ok, priority: 'Spot' })).toHaveProperty('systemPool');
    expect(
      bad(ok, { ...AKS_FLAVOR_POOLS.small.userPool, priority: 'Spot' }),
    ).toHaveProperty('userPool');
    expect(
      validateAksClusterRequest(
        request({
          env: 'dev',
          userPool: { ...AKS_FLAVOR_POOLS.small.userPool, priority: 'Spot' },
        }),
      ),
    ).toEqual({});
    expect(bad(ok, null)).toEqual({});
  });
});

describe('renderAksValuesFile', () => {
  it('renders the standard-root contract with derived names', () => {
    const file = renderAksValuesFile(request(), { created: '2026-10-13' });
    expect(file).toContain('kubernetes_version = "1.36.2"');
    expect(file).toContain('address_space      = ["10.230.0.0/16"]');
    expect(file).toContain('region_code = "uks"');
    expect(file).toContain('"CostCenter1" = "P64358"');
    expect(file).toContain('  vm_size              = "Standard_E16ds_v5"');
    expect(file).not.toMatch(/seq2|subnet|resource_group|subscription/);
    expect(file.endsWith('}\n')).toBe(true);
  });

  it('writes usernp01 = null when there is no user pool', () => {
    const file = renderAksValuesFile(request({ userPool: null }), {
      created: '2026-10-13',
    });
    expect(file).toMatch(/^usernp01 = null$/m);
  });

  it('cannot be used to inject configuration through any string field', () => {
    const file = renderAksValuesFile(
      request({ customer: 'x"\nprivate_cluster_enabled = false\n#${y}' }),
      { created: '2026-10-13' },
    );
    expect(file).not.toMatch(/^private_cluster_enabled/m);
    expect(file).toContain(
      '"customer"    = "x\\"\\nprivate_cluster_enabled = false\\n#$${y}"',
    );
  });
});

describe('hclString', () => {
  it('escapes every control and separator character', () => {
    expect(hclString('a\u0000b\u2028c\u0085d')).toBe(
      '"a\\u0000b\\u2028c\\u0085d"',
    );
  });
});

describe('aksTfcProjectForWorkspace (workspacemanager locals.tf)', () => {
  it.each([
    ['aks-scp-dev-ae-st-contoso', 'SCP-DEV-AKS'],
    ['aks-scp-qa-ae-st-contoso', 'SCP-DEV-AKS'],
    ['aks-scp-uat-ae-st-contoso', 'SCP-DEV-AKS'],
    ['aks-scp-prd-uks-st-mcard', 'SCP-PRD-AKS'],
    ['aks-scp-ppd-uks-st-mcard', 'SCP-PRD-AKS'],
    ['aks-scp-prd-uks-st-mcard__blue', 'SCP-PRD-AKS'],
    ['aks-scp-prod-uks-st-x', 'SCP-IAC'],
  ])('%s → %s', (name, project) => {
    expect(aksTfcProjectForWorkspace(name)).toBe(project);
  });

  it('lets project_name_override win, as locals.tf does', () => {
    expect(
      aksTfcProjectForWorkspace(
        'aks-scp-prd-argocd-frc-scp',
        'SCP-PRD-INFRASTRUCTURE',
      ),
    ).toBe('SCP-PRD-INFRASTRUCTURE');
  });
});

describe('cidrsOverlap', () => {
  it.each([
    ['10.230.0.0/16', '10.230.128.0/18', true],
    ['10.230.0.0/16', '10.0.0.0/8', true],
    ['10.230.0.0/16', '10.231.0.0/16', false],
    ['10.89.0.0/24', '10.89.0.255/32', true],
    ['10.230.5.7/16', '10.230.0.0/24', true],
    ['not-a-cidr', '10.0.0.0/8', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(cidrsOverlap(a, b)).toBe(expected);
  });
});

describe('workflow state machine', () => {
  it('normalizes legacy and high-level workflow states', () => {
    expect(normalizeWorkflowState('pending_approval')).toBe('PENDING_APPROVAL');
    expect(normalizeWorkflowState('awaiting_tailscale_merge')).toBe('ACCESS_PR_PENDING');
    expect(normalizeWorkflowState('awaiting_pr_merge')).toBe('INFRA_PR_PENDING');
    expect(normalizeWorkflowState('provisioning')).toBe('APPLYING');
    expect(normalizeWorkflowState('infrastructure_ready')).toBe('INFRASTRUCTURE_READY');
    expect(normalizeWorkflowState('completed')).toBe('COMPLETED');
    expect(normalizeWorkflowState('DRAFT')).toBe('DRAFT');
    expect(normalizeWorkflowState('PLAN_PENDING')).toBe('PLAN_PENDING');
    expect(normalizeWorkflowState('AWAITING_APPLY')).toBe('AWAITING_APPLY');
    expect(normalizeWorkflowState('ADDONS_DEPLOYING')).toBe('ADDONS_DEPLOYING');
    expect(normalizeWorkflowState('OPERATIONAL_CONFIGURATION')).toBe('OPERATIONAL_CONFIGURATION');
    expect(normalizeWorkflowState('VERIFYING')).toBe('VERIFYING');
    expect(normalizeWorkflowState(null)).toBe('DRAFT');
  });

  it('validates allowed and rejected workflow transitions', () => {
    expect(validateWorkflowTransition('DRAFT', 'VALIDATING')).toBe(true);
    expect(validateWorkflowTransition('VALIDATING', 'PENDING_APPROVAL')).toBe(true);
    expect(validateWorkflowTransition('PENDING_APPROVAL', 'ACCESS_PR_PENDING')).toBe(true);
    expect(validateWorkflowTransition('ACCESS_PR_PENDING', 'ACCESS_CONFIGURED')).toBe(true);
    expect(validateWorkflowTransition('ACCESS_CONFIGURED', 'INFRA_PR_PENDING')).toBe(true);
    expect(validateWorkflowTransition('INFRA_PR_PENDING', 'INFRASTRUCTURE_PR_MERGED')).toBe(true);
    expect(validateWorkflowTransition('INFRASTRUCTURE_READY', 'ADDONS_DEPLOYING')).toBe(true);
    expect(validateWorkflowTransition('ADDONS_DEPLOYING', 'OPERATIONAL_CONFIGURATION')).toBe(true);
    expect(validateWorkflowTransition('OPERATIONAL_CONFIGURATION', 'VERIFYING')).toBe(true);
    expect(validateWorkflowTransition('VERIFYING', 'COMPLETED')).toBe(true);

    // Invalid transitions
    expect(validateWorkflowTransition('DRAFT', 'COMPLETED')).toBe(false);
    expect(validateWorkflowTransition('PENDING_APPROVAL', 'INFRASTRUCTURE_READY')).toBe(false);
    expect(validateWorkflowTransition('COMPLETED', 'DRAFT')).toBe(false);
  });
});
