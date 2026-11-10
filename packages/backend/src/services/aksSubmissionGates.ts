/**
 * Mandatory submission gates for AKS cluster requests. Every check reads only
 * (ReadOnlyHttpClient), and every check must report `passed`: a failed check
 * and a check that could not be verified both block submission. Nothing here
 * falls back to "assume OK".
 *
 *  - cidr_repository  address space vs every VNet / routed range declared on
 *                     scp-infra-as-code main (all roots, not only CloudHub's)
 *  - cidr_azure       address space vs every VNet Azure Resource Graph returns
 *                     for the configured reader identity
 *  - compute_quota    node-pool and jumpbox VM sizes offered in the region and
 *                     the regional vCPU quota (family, total, Spot) covers the
 *                     pools' minimum plus the jumpbox
 *  - github_permissions  the token CloudHub writes with can push to the infra
 *                     and Tailscale policy repositories, and neither is archived
 *  - approver_groups  every approval stage of the request's chain has groups
 *  - production_enabled  prd/ppd submissions are switched on explicitly
 */

import {
  AKS_JUMPBOX_VM_SIZE,
  AKS_STANDARD_SUBSCRIPTION_ID,
  AKS_WORKSPACES_FILE,
  cidrsOverlap,
  type AksClusterRequest,
  type AksNodePool,
} from '@internal/plugin-platform-common/backend';
import { unconfiguredStages } from '../aksApprovalStages';
import {
  ExternalServiceError,
  ReadOnlyHttpClient,
  baseUrlFor,
  type FetchLike,
} from './readOnlyHttp';
import type { GithubReader } from './aksExternalReaders';

export type GateStatus = 'passed' | 'failed' | 'unverified';

export type GateId =
  | 'production_enabled'
  | 'approver_groups'
  | 'github_permissions'
  | 'cidr_repository'
  | 'cidr_azure'
  | 'compute_quota';

export interface GateResult {
  id: GateId;
  label: string;
  status: GateStatus;
  detail: string;
  warnings?: string[];
  evidence?: unknown;
}

export interface SubmissionGateReport {
  /** True when any check is not `passed`. */
  blocking: boolean;
  checkedAt: string;
  checks: GateResult[];
}

// ─── Address-space inventory: scp-infra-as-code ──────────────────────────────

/**
 * Keys that declare a VNet address space or a range routed to one
 * (cloudflare-network magic_wan_static_routes `prefix`). Subnet prefixes sit
 * inside a declared VNet and service CIDRs are cluster-internal, so both are
 * excluded.
 */
const ALLOCATION_KEYS = [
  'address_space',
  'vnet_address_space',
  'address_space_cidr',
  'prefix',
];
const ALLOCATION_LINE = new RegExp(
  `^\\s*"?(${ALLOCATION_KEYS.join('|')})"?\\s*=\\s*(.*)$`,
);
const CIDR = /\b(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})\b/g;

export interface AddressAllocation {
  source: string;
  line?: number;
  key?: string;
  cidr: string;
}

export function extractAddressAllocations(
  path: string,
  content: string,
): AddressAllocation[] {
  const found: AddressAllocation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/(#|\/\/).*$/, '');
    const match = ALLOCATION_LINE.exec(code);
    if (!match) continue;
    let value = match[2];
    // Multi-line list: read until the closing bracket.
    if (value.includes('[') && !value.includes(']')) {
      for (let j = i + 1; j < lines.length; j++) {
        const more = lines[j].replace(/(#|\/\/).*$/, '');
        value += ` ${more}`;
        if (more.includes(']')) break;
      }
    }
    for (const cidr of value.match(CIDR) ?? []) {
      found.push({ source: path, line: i + 1, key: match[1], cidr });
    }
  }
  return found;
}

export class RepositoryAddressInventory {
  private cache: {
    sha: string;
    files: number;
    allocations: AddressAllocation[];
  } | null = null;

  constructor(
    private readonly github: GithubReader,
    private readonly repository: string,
    private readonly branch: string,
  ) {}

  async allocations(): Promise<{
    sha: string;
    files: number;
    allocations: AddressAllocation[];
  }> {
    const sha = await this.github.branchHead(this.repository, this.branch);
    if (this.cache?.sha === sha) return this.cache;
    const tree = await this.github.listTree(this.repository, sha);
    if (tree.truncated) {
      throw new ExternalServiceError(
        'github',
        'invalid_response',
        `The ${this.repository} tree listing was truncated; the inventory would be incomplete`,
      );
    }
    const files = tree.paths.filter(
      path => path.endsWith('.tfvars') && path !== AKS_WORKSPACES_FILE,
    );
    const allocations: AddressAllocation[] = [];
    for (const path of files) {
      const content = await this.github.readFile(this.repository, path, sha);
      if (content)
        allocations.push(...extractAddressAllocations(path, content));
    }
    this.cache = { sha, files: files.length, allocations };
    return this.cache;
  }
}

// ─── Azure (Resource Graph, Compute) ─────────────────────────────────────────

const ARM = 'https://management.azure.com';
const RESOURCE_GRAPH_PATH =
  '/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01';

export interface AzureVnet {
  id: string;
  name: string;
  subscriptionId: string;
  prefixes: string[];
}

interface ResourceSku {
  resourceType: string;
  name: string;
  family?: string;
  capabilities?: Array<{ name: string; value: string }>;
  restrictions?: Array<{ type: string; reasonCode?: string }>;
}

interface Usage {
  name: { value: string; localizedValue?: string };
  currentValue: number;
  limit: number;
}

export class AzureReader {
  readonly client: ReadOnlyHttpClient;

  constructor(client: ReadOnlyHttpClient) {
    this.client = client;
  }

  static create(options: {
    getToken: () => Promise<string>;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  }): AzureReader {
    return new AzureReader(
      new ReadOnlyHttpClient({
        service: 'azure',
        baseUrl: baseUrlFor('CLOUDHUB_AKS_ARM_API_URL', ARM),
        headers: async () => ({
          Authorization: `Bearer ${await options.getToken()}`,
        }),
        queryEndpoints: { [RESOURCE_GRAPH_PATH]: 'resource-graph' },
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? 20_000,
      }),
    );
  }

  async listVirtualNetworks(managementGroup?: string): Promise<AzureVnet[]> {
    const vnets: AzureVnet[] = [];
    let skipToken: string | undefined;
    do {
      const page = await this.client.readQuery<{
        data: Array<{
          id: string;
          name: string;
          subscriptionId: string;
          prefixes: string[] | null;
        }>;
        $skipToken?: string;
      }>(RESOURCE_GRAPH_PATH, {
        query:
          "Resources | where type =~ 'microsoft.network/virtualnetworks' | project id, name, subscriptionId, prefixes = properties.addressSpace.addressPrefixes",
        ...(managementGroup ? { managementGroups: [managementGroup] } : {}),
        options: {
          resultFormat: 'objectArray',
          $top: 1000,
          ...(skipToken ? { $skipToken: skipToken } : {}),
        },
      });
      for (const row of page.data ?? []) {
        vnets.push({ ...row, prefixes: row.prefixes ?? [] });
      }
      skipToken = page.$skipToken;
    } while (skipToken);
    return vnets;
  }

  private async paged<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: { value: T[]; nextLink?: string } = await this.client.get(
        next,
      );
      items.push(...(page.value ?? []));
      next = page.nextLink;
    }
    return items;
  }

  async virtualMachineSkus(
    subscriptionId: string,
    location: string,
  ): Promise<ResourceSku[]> {
    const skus = await this.paged<ResourceSku>(
      `/subscriptions/${encodeURIComponent(
        subscriptionId,
      )}/providers/Microsoft.Compute/skus?api-version=2021-07-01&%24filter=${encodeURIComponent(
        `location eq '${location}'`,
      )}`,
    );
    return skus.filter(sku => sku.resourceType === 'virtualMachines');
  }

  async computeUsages(
    subscriptionId: string,
    location: string,
  ): Promise<Usage[]> {
    return this.paged<Usage>(
      `/subscriptions/${encodeURIComponent(
        subscriptionId,
      )}/providers/Microsoft.Compute/locations/${encodeURIComponent(
        location,
      )}/usages?api-version=2023-09-01`,
    );
  }
}

// ─── Gate evaluation ─────────────────────────────────────────────────────────

export interface SubmissionGateDeps {
  /** Reader for inventory (any token with contents:read on the infra repo). */
  github: GithubReader | null;
  /** Readers authenticated with the token each writer uses (GET-only probes). */
  githubWriteProbes: {
    infra: GithubReader | null;
    tailscale: GithubReader | null;
  };
  azure: AzureReader | null;
  repositories: { infra: string; tailscale: string };
  baseBranch: string;
  productionSubmissionsEnabled: boolean;
  azureManagementGroup?: string;
  inventory?: RepositoryAddressInventory | null;
  now?: () => Date;
}

const LABELS: Record<GateId, string> = {
  production_enabled: 'Production submissions enabled',
  approver_groups: 'Approver groups configured',
  github_permissions: 'GitHub write access',
  cidr_repository: 'Address space vs scp-infra-as-code',
  cidr_azure: 'Address space vs Azure VNets',
  compute_quota: 'Compute quota and VM availability',
};

function result(
  id: GateId,
  status: GateStatus,
  detail: string,
  extra: Partial<GateResult> = {},
): GateResult {
  return { id, label: LABELS[id], status, detail, ...extra };
}

function unverified(id: GateId, error: unknown): GateResult {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  return result(id, 'unverified', `Could not be verified: ${message}`);
}

async function checkGithubPermissions(
  deps: SubmissionGateDeps,
): Promise<GateResult> {
  const targets: Array<[string, GithubReader | null, string]> = [
    [
      deps.repositories.infra,
      deps.githubWriteProbes.infra,
      'GITHUB_ACTIONS_TOKEN / GITHUB_TOKEN',
    ],
    [
      deps.repositories.tailscale,
      deps.githubWriteProbes.tailscale,
      'GITHUB_TOKEN (or CLOUDHUB_GITHUB_TOKEN)',
    ],
  ];
  const missing = targets.filter(([, probe]) => !probe);
  if (missing.length) {
    return result(
      'github_permissions',
      'unverified',
      missing
        .map(
          ([repository, , variable]) =>
            `No token is configured for writes to ${repository} (${variable})`,
        )
        .join('; '),
    );
  }
  const problems: string[] = [];
  const evidence: Record<string, unknown> = {};
  for (const [repository, probe] of targets) {
    const access = await probe!.repositoryAccess(repository);
    evidence[repository] = access;
    if (access.archived) problems.push(`${repository} is archived`);
    if (!access.push) {
      problems.push(`the token used for ${repository} cannot push to it`);
    }
  }
  return problems.length
    ? result('github_permissions', 'failed', problems.join('; '), { evidence })
    : result(
        'github_permissions',
        'passed',
        `Push access confirmed on ${deps.repositories.infra} and ${deps.repositories.tailscale} with the tokens their writers use`,
        { evidence },
      );
}

async function checkRepositoryCidr(
  request: AksClusterRequest,
  deps: SubmissionGateDeps,
): Promise<GateResult> {
  const inventory =
    deps.inventory ??
    (deps.github
      ? new RepositoryAddressInventory(
          deps.github,
          deps.repositories.infra,
          deps.baseBranch,
        )
      : null);
  if (!inventory) {
    return result(
      'cidr_repository',
      'unverified',
      'No GitHub read access is configured',
    );
  }
  const { sha, allocations } = await inventory.allocations();
  const conflicts = allocations.filter(a =>
    cidrsOverlap(a.cidr, request.addressSpace),
  );
  if (conflicts.length) {
    return result(
      'cidr_repository',
      'failed',
      `${request.addressSpace} overlaps ${conflicts
        .slice(0, 10)
        .map(c => `${c.cidr} (${c.source}:${c.line})`)
        .join(', ')}${
        conflicts.length > 10 ? ` and ${conflicts.length - 10} more` : ''
      }`,
      { evidence: { commit: sha, conflicts } },
    );
  }
  return result(
    'cidr_repository',
    'passed',
    `No overlap with ${allocations.length} declared ranges on ${
      deps.repositories.infra
    }@${sha.slice(0, 7)}`,
    { evidence: { commit: sha, ranges: allocations.length } },
  );
}

async function checkAzureCidr(
  request: AksClusterRequest,
  deps: SubmissionGateDeps,
): Promise<GateResult> {
  if (!deps.azure) {
    return result(
      'cidr_azure',
      'unverified',
      'No Azure reader identity is configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)',
    );
  }
  const vnets = await deps.azure.listVirtualNetworks(deps.azureManagementGroup);
  if (vnets.length === 0) {
    // An identity that can see nothing proves nothing.
    return result(
      'cidr_azure',
      'unverified',
      'Azure Resource Graph returned no virtual networks; the reader identity likely lacks Reader access',
    );
  }
  const conflicts = vnets.flatMap(vnet =>
    vnet.prefixes
      .filter(prefix => cidrsOverlap(prefix, request.addressSpace))
      .map(prefix => ({ vnet: vnet.id, prefix })),
  );
  const subscriptions = new Set(vnets.map(v => v.subscriptionId)).size;
  if (conflicts.length) {
    return result(
      'cidr_azure',
      'failed',
      `${request.addressSpace} overlaps ${conflicts
        .slice(0, 10)
        .map(c => `${c.prefix} (${c.vnet.split('/').pop()})`)
        .join(', ')}`,
      { evidence: { conflicts, vnets: vnets.length, subscriptions } },
    );
  }
  return result(
    'cidr_azure',
    'passed',
    `No overlap with ${
      vnets.length
    } VNets across ${subscriptions} subscription(s)${
      deps.azureManagementGroup ? ` under ${deps.azureManagementGroup}` : ''
    }`,
    { evidence: { vnets: vnets.length, subscriptions } },
  );
}

async function checkQuota(
  request: AksClusterRequest,
  deps: SubmissionGateDeps,
): Promise<GateResult> {
  if (!deps.azure) {
    return result(
      'compute_quota',
      'unverified',
      'No Azure reader identity is configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)',
    );
  }
  const subscription = AKS_STANDARD_SUBSCRIPTION_ID;
  const skus = await deps.azure.virtualMachineSkus(
    subscription,
    request.location,
  );
  const usages = await deps.azure.computeUsages(subscription, request.location);

  const pools: Array<[string, AksNodePool]> = [['system', request.systemPool]];
  if (request.userPool) pools.push(['user', request.userPool]);
  // One jumpbox VM per cluster, sized by the module default.
  pools.push([
    'jumpbox',
    {
      vmSize: AKS_JUMPBOX_VM_SIZE,
      minCount: 1,
      maxCount: 1,
      priority: 'Regular',
    },
  ]);

  const problems: string[] = [];
  const warnings: string[] = [];
  // bucket (usage name) → vCPUs at min / max node counts
  const demand = new Map<string, { min: number; max: number }>();
  const add = (bucket: string, min: number, max: number) => {
    const current = demand.get(bucket) ?? { min: 0, max: 0 };
    demand.set(bucket, { min: current.min + min, max: current.max + max });
  };
  for (const [label, pool] of pools) {
    const sku = skus.find(
      s => s.name.toLowerCase() === pool.vmSize.toLowerCase(),
    );
    if (!sku) {
      problems.push(
        `${label} pool size ${pool.vmSize} is not offered in ${request.location}`,
      );
      continue;
    }
    if ((sku.restrictions ?? []).some(r => r.type === 'Location')) {
      problems.push(
        `${label} pool size ${pool.vmSize} is restricted for this subscription in ${request.location}`,
      );
      continue;
    }
    const vcpus = Number(
      sku.capabilities?.find(c => c.name === 'vCPUs')?.value,
    );
    if (!sku.family || !Number.isFinite(vcpus) || vcpus <= 0) {
      return result(
        'compute_quota',
        'unverified',
        `Azure did not report the vCPU family/count for ${pool.vmSize}`,
      );
    }
    const min = pool.minCount * vcpus;
    const max = pool.maxCount * vcpus;
    if (pool.priority === 'Spot') {
      add('lowPriorityCores', min, max);
    } else {
      add(sku.family, min, max);
      add('cores', min, max);
    }
  }

  const evidence: Array<Record<string, unknown>> = [];
  for (const [bucket, need] of demand) {
    const usage = usages.find(
      u => u.name.value.toLowerCase() === bucket.toLowerCase(),
    );
    if (!usage) {
      return result(
        'compute_quota',
        'unverified',
        `Azure did not report a ${bucket} quota in ${request.location}`,
      );
    }
    const available = usage.limit - usage.currentValue;
    evidence.push({
      quota: bucket,
      limit: usage.limit,
      used: usage.currentValue,
      available,
      ...need,
    });
    if (need.min > available) {
      problems.push(
        `${bucket}: pools need ${need.min} vCPUs at minimum size but only ${available} of ${usage.limit} are free`,
      );
    } else if (need.max > available) {
      warnings.push(
        `${bucket}: autoscaling to maximum needs ${need.max} vCPUs; ${available} are free`,
      );
    }
  }
  return problems.length
    ? result('compute_quota', 'failed', problems.join('; '), {
        warnings,
        evidence,
      })
    : result(
        'compute_quota',
        'passed',
        `Node-pool minimums and the ${AKS_JUMPBOX_VM_SIZE} jumpbox fit the free quota in ${request.location} (subscription ${subscription})`,
        { warnings, evidence },
      );
}

const PRODUCTION_ENVS = new Set(['prd', 'ppd']);

export async function evaluateSubmissionGates(
  request: AksClusterRequest,
  approvalChain: string[],
  deps: SubmissionGateDeps,
): Promise<SubmissionGateReport> {
  const checks: GateResult[] = [];

  if (PRODUCTION_ENVS.has(request.env)) {
    checks.push(
      deps.productionSubmissionsEnabled
        ? result(
            'production_enabled',
            'passed',
            'provisioning.aks.productionSubmissions.enabled is true',
          )
        : result(
            'production_enabled',
            'failed',
            'Production (prd/ppd) submissions are disabled until provisioning.aks.productionSubmissions.enabled is set',
          ),
    );
  }

  const missing = unconfiguredStages(approvalChain);
  checks.push(
    missing.length
      ? result(
          'approver_groups',
          'failed',
          `No approver group configured for: ${missing.join(', ')}`,
        )
      : result(
          'approver_groups',
          'passed',
          `Groups configured for ${approvalChain.join(', ')}`,
        ),
  );

  const external: Array<[GateId, () => Promise<GateResult>]> = [
    ['github_permissions', () => checkGithubPermissions(deps)],
    ['cidr_repository', () => checkRepositoryCidr(request, deps)],
    ['cidr_azure', () => checkAzureCidr(request, deps)],
    ['compute_quota', () => checkQuota(request, deps)],
  ];
  const settled = await Promise.all(
    external.map(([id, run]) => run().catch(error => unverified(id, error))),
  );
  checks.push(...settled);

  return {
    blocking: checks.some(check => check.status !== 'passed'),
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    checks,
  };
}
