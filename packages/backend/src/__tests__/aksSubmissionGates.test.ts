import {
  AKS_FLAVOR_POOLS,
  normalizeAksClusterRequest,
} from '@internal/plugin-platform-common/backend';
import { GithubReader } from '../services/aksExternalReaders';
import {
  AzureReader,
  RepositoryAddressInventory,
  evaluateSubmissionGates,
  extractAddressAllocations,
  type SubmissionGateDeps,
} from '../services/aksSubmissionGates';
import type { FetchLike } from '../services/readOnlyHttp';
import {
  assertReadOnly,
  createFakeExternalApis,
  emptyFakeState,
  type FakeState,
  type RecordedCall,
} from '../test-utils/fakeAksExternalApis';

const INFRA = 'SymphonySensa/scp-infra-as-code';
const TAILSCALE = 'SymphonyFS/tailscale';

function request(overrides: Record<string, unknown> = {}) {
  return normalizeAksClusterRequest({
    customer: 'Contoso',
    businessUnit: 'Retail',
    owner: 'owner@contoso.com',
    costCentre: 'P64358',
    changeTicket: 'SCP-1234',
    clusterProfile: 'single-region',
    env: 'dev',
    location: 'australiaeast',
    tenancy: 'st',
    tenantId: 'contoso',
    kubernetesVersion: '1.36.2',
    addressSpace: '10.230.0.0/16',
    ...AKS_FLAVOR_POOLS.medium,
    ...overrides,
  });
}

/** Fake Azure Resource Graph + Compute endpoints, recording every call. */
function fakeAzure(opts: {
  vnets?: Array<{
    id: string;
    name: string;
    subscriptionId: string;
    prefixes: string[];
  }>;
  skus?: any[];
  usages?: Array<{ name: string; current: number; limit: number }>;
  fail?: number;
}) {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body });
    const respond = (status: number, body: unknown) => ({
      status,
      ok: status < 300,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    });
    if (opts.fail) return respond(opts.fail, {});
    const { pathname } = new URL(url);
    if (pathname === '/providers/Microsoft.ResourceGraph/resources') {
      return respond(200, { data: opts.vnets ?? [] });
    }
    if (pathname.endsWith('/providers/Microsoft.Compute/skus')) {
      return respond(200, { value: opts.skus ?? [] });
    }
    if (pathname.endsWith('/usages')) {
      return respond(200, {
        value: (opts.usages ?? []).map(u => ({
          name: { value: u.name },
          currentValue: u.current,
          limit: u.limit,
        })),
      });
    }
    return respond(404, {});
  };
  return {
    reader: AzureReader.create({
      getToken: async () => 'arm-token',
      fetchImpl: fetch,
    }),
    calls,
  };
}

const sku = (
  name: string,
  family: string,
  vcpus: number,
  restricted = false,
) => ({
  resourceType: 'virtualMachines',
  name,
  family,
  capabilities: [{ name: 'vCPUs', value: String(vcpus) }],
  restrictions: restricted
    ? [{ type: 'Location', reasonCode: 'NotAvailableForSubscription' }]
    : [],
});

const MEDIUM_SKUS = [
  sku('Standard_D8ds_v5', 'standardDDSv5Family', 8),
  sku('Standard_E16ds_v5', 'standardEDSv5Family', 16),
  // jumpbox (azure-linux-virtual-machine module default)
  sku('Standard_B2s', 'standardBSFamily', 2),
];

const AMPLE_USAGES = [
  { name: 'cores', current: 100, limit: 2000 },
  { name: 'standardDDSv5Family', current: 0, limit: 500 },
  { name: 'standardEDSv5Family', current: 0, limit: 1000 },
  { name: 'lowPriorityCores', current: 0, limit: 100 },
  { name: 'standardBSFamily', current: 0, limit: 100 },
];

function githubState(): FakeState {
  const state = emptyFakeState();
  state.mainSha = 'main123';
  state.tree.main123 = {
    paths: [
      'azure-kubernetes-service-standard/values/aks-scp-prd-uks-st-mcard.tfvars',
      'azure-kubernetes-service-legacy/values/fr-napoleon.tfvars',
      'cloudflare-network/values/net-cf-saifs.tfvars',
      'workspacemanager/workspaces.tfvars',
      'README.md',
    ],
  };
  state.files[
    'main123:azure-kubernetes-service-standard/values/aks-scp-prd-uks-st-mcard.tfvars'
  ] = 'address_space      = ["10.166.0.0/16"]\n';
  state.files[
    'main123:azure-kubernetes-service-legacy/values/fr-napoleon.tfvars'
  ] =
    'vnet_address_space = ["10.82.0.0/16"]\nsubnet_address_prefixes = ["10.230.0.0/18"]\nservice_cidr = "10.230.0.0/16"\n';
  state.files['main123:cloudflare-network/values/net-cf-saifs.tfvars'] =
    'routes = {\n  louvre = {\n    prefix      = "10.89.0.0/24"\n  }\n}\n';
  state.repoAccess[INFRA] = { push: true, archived: false };
  state.repoAccess[TAILSCALE] = { push: true, archived: false };
  return state;
}

function deps(
  overrides: Partial<SubmissionGateDeps> & { state?: FakeState } = {},
) {
  const state = overrides.state ?? githubState();
  const apis = createFakeExternalApis(state);
  const github = GithubReader.create({ token: 'gh', fetchImpl: apis.fetch });
  const azure = fakeAzure({
    vnets: [
      {
        id: '/s/1/vnet-a',
        name: 'vnet-a',
        subscriptionId: 's1',
        prefixes: ['10.1.0.0/16'],
      },
    ],
    skus: MEDIUM_SKUS,
    usages: AMPLE_USAGES,
  });
  const value: SubmissionGateDeps = {
    github,
    githubWriteProbes: { infra: github, tailscale: github },
    azure: azure.reader,
    repositories: { infra: INFRA, tailscale: TAILSCALE },
    baseBranch: 'main',
    productionSubmissionsEnabled: false,
    ...overrides,
  };
  return { value, apis, azure, state };
}

const statusOf = (
  report: Awaited<ReturnType<typeof evaluateSubmissionGates>>,
  id: string,
) => report.checks.find(check => check.id === id);

describe('extractAddressAllocations', () => {
  it('reads VNet spaces and routed prefixes, not subnets or service CIDRs', () => {
    const content = [
      'address_space = ["10.1.0.0/16"]',
      'vnet_address_space                       = ["10.2.0.0/16"]',
      'address_space = [',
      '  "10.3.0.0/16", # primary',
      '  "10.4.0.0/16",',
      ']',
      'subnet_address_prefixes = ["10.1.0.0/18"]',
      'service_cidr = "10.5.0.0/16"',
      '# address_space = ["10.6.0.0/16"]',
      '    prefix      = "10.89.0.0/24"',
    ].join('\n');
    expect(
      extractAddressAllocations('f.tfvars', content).map(a => a.cidr),
    ).toEqual([
      '10.1.0.0/16',
      '10.2.0.0/16',
      '10.3.0.0/16',
      '10.4.0.0/16',
      '10.89.0.0/24',
    ]);
  });
});

describe('evaluateSubmissionGates', () => {
  it('passes when every check is verified and clear', async () => {
    const d = deps();
    const report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      d.value,
    );
    expect(report.checks.map(c => [c.id, c.status])).toEqual([
      ['approver_groups', 'passed'],
      ['github_permissions', 'passed'],
      ['cidr_repository', 'passed'],
      ['cidr_azure', 'passed'],
      ['compute_quota', 'passed'],
    ]);
    expect(report.blocking).toBe(false);
    assertReadOnly(d.apis.calls);
    assertReadOnly(d.azure.calls);
    // Resource Graph: one fixed KQL read of VNet address spaces, nothing else.
    const graph = d.azure.calls.filter(c => c.method === 'POST');
    expect(graph).toHaveLength(1);
    expect(new URL(graph[0].url).pathname).toBe(
      '/providers/Microsoft.ResourceGraph/resources',
    );
    const body = JSON.parse(graph[0].body!);
    expect(Object.keys(body).sort()).toEqual(['options', 'query']);
    expect(body.query).toBe(
      "Resources | where type =~ 'microsoft.network/virtualnetworks' | project id, name, subscriptionId, prefixes = properties.addressSpace.addressPrefixes",
    );
    expect(
      d.azure.calls
        .filter(c => c.method !== 'POST')
        .every(c => c.method === 'GET'),
    ).toBe(true);
  });

  it('blocks on overlap with any range declared on scp-infra-as-code, not only CloudHub requests', async () => {
    const report = await evaluateSubmissionGates(
      request({ addressSpace: '10.82.0.0/16' }),
      ['Platform Team'],
      deps().value,
    );
    expect(statusOf(report, 'cidr_repository')).toMatchObject({
      status: 'failed',
    });
    expect(statusOf(report, 'cidr_repository')!.detail).toContain(
      'azure-kubernetes-service-legacy/values/fr-napoleon.tfvars:1',
    );
    expect(report.blocking).toBe(true);
  });

  it('blocks on overlap with a Cloudflare-routed prefix', async () => {
    const report = await evaluateSubmissionGates(
      request({ addressSpace: '10.89.0.0/16' }),
      ['Platform Team'],
      deps().value,
    );
    expect(statusOf(report, 'cidr_repository')!.status).toBe('failed');
  });

  it('blocks on overlap with an Azure VNet that is not in the repository', async () => {
    const report = await evaluateSubmissionGates(
      request({ addressSpace: '10.1.0.0/16' }),
      ['Platform Team'],
      deps().value,
    );
    expect(statusOf(report, 'cidr_azure')).toMatchObject({ status: 'failed' });
    expect(statusOf(report, 'cidr_repository')!.status).toBe('passed');
  });

  it('treats an Azure identity that sees no VNets as unverified', async () => {
    const azure = fakeAzure({
      vnets: [],
      skus: MEDIUM_SKUS,
      usages: AMPLE_USAGES,
    });
    const report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps({ azure: azure.reader }).value,
    );
    expect(statusOf(report, 'cidr_azure')!.status).toBe('unverified');
    expect(report.blocking).toBe(true);
  });

  it('blocks when Azure is not configured or unavailable', async () => {
    let report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps({ azure: null }).value,
    );
    expect(statusOf(report, 'cidr_azure')!.status).toBe('unverified');
    expect(statusOf(report, 'compute_quota')!.status).toBe('unverified');
    expect(report.blocking).toBe(true);

    const down = fakeAzure({ fail: 503 });
    report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps({ azure: down.reader }).value,
    );
    expect(statusOf(report, 'compute_quota')!.status).toBe('unverified');
    expect(statusOf(report, 'compute_quota')!.detail).toMatch(/503/);
  });

  it('blocks when the repository inventory cannot be read completely', async () => {
    const state = githubState();
    state.tree.main123.truncated = true;
    const report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps({ state }).value,
    );
    expect(statusOf(report, 'cidr_repository')!.status).toBe('unverified');
  });

  describe('compute quota', () => {
    it('fails when the node-pool minimum exceeds the free family quota', async () => {
      const azure = fakeAzure({
        vnets: [
          {
            id: 'v',
            name: 'v',
            subscriptionId: 's',
            prefixes: ['10.1.0.0/16'],
          },
        ],
        skus: MEDIUM_SKUS,
        usages: [
          ...AMPLE_USAGES.filter(u => u.name !== 'standardEDSv5Family'),
          { name: 'standardEDSv5Family', current: 990, limit: 1000 },
        ],
      });
      const report = await evaluateSubmissionGates(
        request(),
        ['Platform Team'],
        deps({ azure: azure.reader }).value,
      );
      // medium user pool: 2 × E16ds_v5 = 32 vCPUs minimum, 10 free.
      expect(statusOf(report, 'compute_quota')).toMatchObject({
        status: 'failed',
      });
      expect(statusOf(report, 'compute_quota')!.detail).toMatch(
        /standardEDSv5Family: pools need 32 vCPUs/,
      );
    });

    it('warns (without blocking) when only the autoscaling maximum does not fit', async () => {
      const azure = fakeAzure({
        vnets: [
          {
            id: 'v',
            name: 'v',
            subscriptionId: 's',
            prefixes: ['10.1.0.0/16'],
          },
        ],
        skus: MEDIUM_SKUS,
        usages: [
          ...AMPLE_USAGES.filter(u => u.name !== 'standardEDSv5Family'),
          { name: 'standardEDSv5Family', current: 0, limit: 100 },
        ],
      });
      const report = await evaluateSubmissionGates(
        request(),
        ['Platform Team'],
        deps({ azure: azure.reader }).value,
      );
      const quota = statusOf(report, 'compute_quota')!;
      expect(quota.status).toBe('passed');
      expect(quota.warnings!.join(' ')).toMatch(
        /maximum needs 480 vCPUs; 100 are free/,
      );
    });

    it('fails for a VM size that is not offered or is restricted in the region', async () => {
      const missing = fakeAzure({
        vnets: [
          {
            id: 'v',
            name: 'v',
            subscriptionId: 's',
            prefixes: ['10.1.0.0/16'],
          },
        ],
        skus: [MEDIUM_SKUS[0], MEDIUM_SKUS[2]],
        usages: AMPLE_USAGES,
      });
      let report = await evaluateSubmissionGates(
        request(),
        ['Platform Team'],
        deps({ azure: missing.reader }).value,
      );
      expect(statusOf(report, 'compute_quota')!.detail).toMatch(
        /Standard_E16ds_v5 is not offered/,
      );

      const restricted = fakeAzure({
        vnets: [
          {
            id: 'v',
            name: 'v',
            subscriptionId: 's',
            prefixes: ['10.1.0.0/16'],
          },
        ],
        skus: [
          MEDIUM_SKUS[0],
          MEDIUM_SKUS[2],
          sku('Standard_E16ds_v5', 'standardEDSv5Family', 16, true),
        ],
        usages: AMPLE_USAGES,
      });
      report = await evaluateSubmissionGates(
        request(),
        ['Platform Team'],
        deps({ azure: restricted.reader }).value,
      );
      expect(statusOf(report, 'compute_quota')!.detail).toMatch(/restricted/);
    });

    it('counts Spot user pools against the low-priority quota', async () => {
      const azure = fakeAzure({
        vnets: [
          {
            id: 'v',
            name: 'v',
            subscriptionId: 's',
            prefixes: ['10.1.0.0/16'],
          },
        ],
        skus: MEDIUM_SKUS,
        usages: [
          ...AMPLE_USAGES.filter(u => u.name !== 'lowPriorityCores'),
          { name: 'lowPriorityCores', current: 0, limit: 10 },
        ],
      });
      const report = await evaluateSubmissionGates(
        request({
          userPool: { ...AKS_FLAVOR_POOLS.medium.userPool, priority: 'Spot' },
        }),
        ['Platform Team'],
        deps({ azure: azure.reader }).value,
      );
      expect(statusOf(report, 'compute_quota')!.detail).toMatch(
        /lowPriorityCores/,
      );
    });

    it('is unverified when Azure does not report a needed quota', async () => {
      const azure = fakeAzure({
        vnets: [
          {
            id: 'v',
            name: 'v',
            subscriptionId: 's',
            prefixes: ['10.1.0.0/16'],
          },
        ],
        skus: MEDIUM_SKUS,
        usages: AMPLE_USAGES.filter(u => u.name !== 'cores'),
      });
      const report = await evaluateSubmissionGates(
        request(),
        ['Platform Team'],
        deps({ azure: azure.reader }).value,
      );
      expect(statusOf(report, 'compute_quota')!.status).toBe('unverified');
    });
  });

  it('fails when the write token cannot push or a repository is archived', async () => {
    const state = githubState();
    state.repoAccess[TAILSCALE] = { push: false, archived: false };
    state.repoAccess[INFRA] = { push: true, archived: true };
    const report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps({ state }).value,
    );
    const check = statusOf(report, 'github_permissions')!;
    expect(check.status).toBe('failed');
    expect(check.detail).toMatch(/archived/);
    expect(check.detail).toMatch(
      /token used for SymphonyFS\/tailscale cannot push/,
    );
  });

  it('fails when an approval stage has no group configured', async () => {
    delete process.env.CLOUDHUB_AKS_OPERATIONS_GROUP_REFS;
    const report = await evaluateSubmissionGates(
      request(),
      ['Platform Team', 'Operations'],
      deps().value,
    );
    expect(statusOf(report, 'approver_groups')).toMatchObject({
      status: 'failed',
    });
  });

  it('keeps production submissions off until explicitly enabled', async () => {
    let report = await evaluateSubmissionGates(
      request({ env: 'prd' }),
      ['Platform Team'],
      deps().value,
    );
    expect(statusOf(report, 'production_enabled')!.status).toBe('failed');
    expect(report.blocking).toBe(true);
    report = await evaluateSubmissionGates(
      request({ env: 'ppd' }),
      ['Platform Team'],
      deps({ productionSubmissionsEnabled: true }).value,
    );
    expect(statusOf(report, 'production_enabled')!.status).toBe('passed');
    expect(statusOf(report, 'production_enabled')).toBeDefined();
    // dev requests do not carry the production switch at all.
    report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps().value,
    );
    expect(statusOf(report, 'production_enabled')).toBeUndefined();
  });

  it('reports every external check unverified when nothing is configured', async () => {
    const report = await evaluateSubmissionGates(request(), ['Platform Team'], {
      github: null,
      githubWriteProbes: { infra: null, tailscale: null },
      azure: null,
      repositories: { infra: INFRA, tailscale: TAILSCALE },
      baseBranch: 'main',
      productionSubmissionsEnabled: false,
    });
    expect(
      report.checks.filter(c => c.status === 'unverified').map(c => c.id),
    ).toEqual([
      'github_permissions',
      'cidr_repository',
      'cidr_azure',
      'compute_quota',
    ]);
    expect(report.blocking).toBe(true);
  });

  it('caches the repository inventory per main commit', async () => {
    const d = deps();
    const inventory = new RepositoryAddressInventory(
      d.value.github!,
      INFRA,
      'main',
    );
    await inventory.allocations();
    const first = d.apis.calls.length;
    await inventory.allocations();
    // Second call only re-reads the branch head.
    expect(d.apis.calls.length - first).toBe(1);
    d.state.mainSha = 'main456';
    d.state.tree.main456 = { paths: [] };
    expect((await inventory.allocations()).allocations).toEqual([]);
  });

  it('includes the jumpbox VM in the quota demand', async () => {
    const azure = fakeAzure({
      vnets: [
        { id: 'v', name: 'v', subscriptionId: 's', prefixes: ['10.1.0.0/16'] },
      ],
      skus: MEDIUM_SKUS,
      usages: [
        ...AMPLE_USAGES.filter(u => u.name !== 'standardBSFamily'),
        { name: 'standardBSFamily', current: 99, limit: 100 },
      ],
    });
    const report = await evaluateSubmissionGates(
      request(),
      ['Platform Team'],
      deps({ azure: azure.reader }).value,
    );
    // 1 free B-series vCPU; the Standard_B2s jumpbox needs 2.
    expect(statusOf(report, 'compute_quota')).toMatchObject({
      status: 'failed',
    });
    expect(statusOf(report, 'compute_quota')!.detail).toMatch(
      /standardBSFamily: pools need 2 vCPUs/,
    );
  });
});
