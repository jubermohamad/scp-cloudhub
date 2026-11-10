/**
 * Canonical AKS cluster request model, shared by the /create/aks wizard
 * (preview) and the provisioning backend (validation, persistence, values-file
 * generation). Pure TypeScript, no React, so it is safe in both bundles.
 *
 * Every rule here mirrors the SCP IaC contract on
 * SymphonySensa/scp-infra-as-code main (6bc941b, 2026-10-12) and
 * SymphonySensa/scp-azure-terraform-modules main (7db1b47):
 *  - names: naming module v1.12.0 `generic` style
 *    "{rt}-scp-{env}-{region}-{tenancy}-{tenant}[-{seq2}]"; the AKS and RG
 *    module calls never pass seq2, so new clusters never carry a sequence.
 *  - region codes: azure-kubernetes-service-standard/locals.tf region_shortnames.
 *  - subnets: derived from address_space[0] in locals.tf (not inputs).
 *  - node pools: aks_nodepools.tf (`usernp01` defaults to {}, so "no user pool"
 *    must be written as `usernp01 = null`).
 *  - subscription: fixed by provider.tf, not a request input.
 * See docs/aks-workflow-audit.md for the evidence.
 */

export const AKS_STANDARD_ROOT = 'azure-kubernetes-service-standard';
export const AKS_VALUES_DIR = `${AKS_STANDARD_ROOT}/values`;
export const AKS_WORKSPACES_FILE = 'workspacemanager/workspaces.tfvars';

/**
 * Terraform Cloud layout (workspacemanager/providers.tf, variables.tf,
 * locals.tf on scp-infra-as-code main, 2026-10-13). The workspacemanager root
 * runs in the TFC workspace `workspacemanager` and creates one workspace per
 * entry in workspaces.tfvars, named exactly as the entry key.
 */
export const AKS_TFC_ORGANIZATION = 'sensa-cloud-platform';
export const AKS_TFC_WORKSPACE_MANAGER = 'workspacemanager';

/** locals.tf `dev_envs` / `prd_envs`. */
const TFC_DEV_ENVS = ['dev', 'test', 'stg', 'uat', 'qa'];
const TFC_PRD_ENVS = ['prd', 'ppd'];

/**
 * TFC project workspacemanager assigns to an azure-kubernetes-service-standard
 * workspace (locals.tf `effective_project_name`): an explicit
 * project_name_override wins; otherwise the env is the third `-` segment of
 * the workspace name (before any `__`) and selects SCP-DEV-AKS / SCP-PRD-AKS;
 * anything else falls back to SCP-IAC. The mapping comes from the workspace
 * name, never from the request's environment label.
 */
export function aksTfcProjectForWorkspace(
  workspaceName: string,
  projectNameOverride?: string | null,
): string {
  if (projectNameOverride) return projectNameOverride;
  const env = workspaceName.split('__')[0].split('-')[2];
  if (env && TFC_DEV_ENVS.includes(env)) return 'SCP-DEV-AKS';
  if (env && TFC_PRD_ENVS.includes(env)) return 'SCP-PRD-AKS';
  return 'SCP-IAC';
}

/**
 * Jumpbox VM size: azure-kubernetes-service-standard/aks_jumpbox.tf calls
 * sensa-cloud-platform/azure-linux-virtual-machine 1.6.0 without vm_size, and
 * that module's default (scp-azure-terraform-modules tag
 * azure-linux-virtual-machine-v1.6.0, variables.tf) is Standard_B2s.
 */
export const AKS_JUMPBOX_VM_SIZE = 'Standard_B2s';

/** provider.tf L26 of the standard root: every cluster lands here. */
export const AKS_STANDARD_SUBSCRIPTION_ID =
  'b0799078-b42a-4b59-9e70-22cd09a20ee2';

/** naming module `env` validation (workspacemanager maps prd/ppd → PRD project). */
export const AKS_ENVIRONMENTS = [
  'dev',
  'test',
  'stg',
  'uat',
  'qa',
  'ppd',
  'prd',
] as const;
export type AksEnvironment = (typeof AKS_ENVIRONMENTS)[number];

export const AKS_TENANCIES = ['st', 'mt'] as const;
export type AksTenancy = (typeof AKS_TENANCIES)[number];

/**
 * Profiles the generator can express as ONE standard-root cluster. Multi-region
 * profiles need paired clusters (paired_cluster_vnet / active_passive_netapp)
 * which are not generated yet, so they are rejected rather than silently
 * reduced to a single region.
 */
export const AKS_SINGLE_CLUSTER_PROFILES = [
  'free-tier',
  'dev-tier',
  'single-region',
] as const;
export const AKS_UNSUPPORTED_PROFILES = ['active-passive', 'active-active'];

/** azure-kubernetes-service-standard/locals.tf `region_shortnames` (lower-case keys). */
export const AZURE_REGION_SHORTNAMES: Readonly<Record<string, string>> = {
  australiacentral: 'acl',
  australiacentral2: 'acl2',
  australiaeast: 'ae',
  australiasoutheast: 'ase',
  brazilsouth: 'brs',
  brazilus: 'bru',
  brazilsoutheast: 'bse',
  centraluseuap: 'ccy',
  canadacentral: 'cnc',
  canadaeast: 'cne',
  centralus: 'cus',
  eastasia: 'ea',
  eastus2euap: 'ecy',
  spaincentral: 'esc',
  eastus: 'eus',
  eastus2: 'eus2',
  francecentral: 'frc',
  francesouth: 'frs',
  germanynorth: 'gn',
  germanywestcentral: 'gwc',
  centralindia: 'inc',
  southindia: 'ins',
  westindia: 'inw',
  israelcentral: 'ilc',
  italynorth: 'itn',
  japaneast: 'jpe',
  japanwest: 'jpw',
  jioindiacentral: 'jic',
  jioindiawest: 'jiw',
  koreacentral: 'krc',
  koreasouth: 'krs',
  mexicocentral: 'mxc',
  northcentralus: 'ncus',
  northeurope: 'ne',
  norwayeast: 'nwe',
  norwaywest: 'nww',
  newzealandnorth: 'nzn',
  polandcentral: 'plc',
  qatarcentral: 'qac',
  southafricanorth: 'san',
  southafricawest: 'saw',
  southcentralus: 'scus',
  swedencentral: 'sdc',
  swedensouth: 'sds',
  southeastasia: 'sea',
  switzerlandnorth: 'szn',
  switzerlandwest: 'szw',
  uaecentral: 'uac',
  uaenorth: 'uan',
  uksouth: 'uks',
  ukwest: 'ukw',
  westcentralus: 'wcus',
  westeurope: 'we',
  westus: 'wus',
  westus2: 'wus2',
  westus3: 'wus3',
  usdodcentral: 'udc',
  usdodeast: 'ude',
  usgovarizona: 'uga',
  usgoviowa: 'ugi',
  usgovtexas: 'ugt',
  usgovvirginia: 'ugv',
  usnateast: 'exe',
  usnatwest: 'exw',
  usseceast: 'rxe',
  ussecwest: 'rxw',
  chinanorth: 'bjb',
  chinanorth2: 'bjb2',
  chinanorth3: 'bjb3',
  chinaeast: 'sha',
  chinaeast2: 'sha2',
  chinaeast3: 'sha3',
  germanycentral: 'gec',
  germanynortheast: 'gne',
};

export interface AksNodePool {
  vmSize: string;
  minCount: number;
  maxCount: number;
  priority: 'Regular' | 'Spot';
}

/** The canonical, persisted, approval-bound AKS request. */
export interface AksClusterRequest {
  // Governance (recorded on the request; costCentre is also a tag).
  customer: string;
  businessUnit: string;
  owner: string;
  costCentre: string;
  changeTicket: string;
  clusterProfile: string;
  // Terraform inputs (azure-kubernetes-service-standard).
  env: AksEnvironment;
  location: string;
  tenancy: AksTenancy;
  tenantId: string;
  kubernetesVersion: string;
  addressSpace: string;
  systemPool: AksNodePool;
  /** null ⇒ `usernp01 = null` (no user pool). */
  userPool: AksNodePool | null;
}

export type AksClusterRequestErrors = Partial<
  Record<keyof AksClusterRequest | 'name' | 'systemPool' | 'userPool', string>
>;

export interface AksDerivedNames {
  regionCode: string;
  clusterName: string;
  resourceGroupName: string;
  vnetName: string;
  nodeResourceGroupName: string;
  /** Tailscale jumpbox tag/group suffix (locals.tf jumpbox_tag). */
  jumpboxName: string;
  workspaceName: string;
  valuesFilePath: string;
}

export interface AksDerivedSubnets {
  aks: string;
  secondary: string;
  netapp: string;
  vpnGateway: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export type AksNodeSizeFlavor = 'small' | 'medium' | 'large';

/**
 * Pool presets. Each is an observed configuration in the standard root:
 * small = tempcluster template / dev-*-st-scp (B2s 1-2 + B2s 0-2),
 * medium = aks-scp-template.tfvars (D8ds_v5 2-5 + E16ds_v5 2-30),
 * large = dev-plc-st-eng / prd-san-st-absa (D8ds_v5 2-5 + E32ds_v5 2-30).
 */
export const AKS_FLAVOR_POOLS: Record<
  AksNodeSizeFlavor,
  { systemPool: AksNodePool; userPool: AksNodePool }
> = {
  small: {
    systemPool: {
      vmSize: 'Standard_B2s',
      minCount: 1,
      maxCount: 2,
      priority: 'Regular',
    },
    userPool: {
      vmSize: 'Standard_B2s',
      minCount: 0,
      maxCount: 2,
      priority: 'Regular',
    },
  },
  medium: {
    systemPool: {
      vmSize: 'Standard_D8ds_v5',
      minCount: 2,
      maxCount: 5,
      priority: 'Regular',
    },
    userPool: {
      vmSize: 'Standard_E16ds_v5',
      minCount: 2,
      maxCount: 30,
      priority: 'Regular',
    },
  },
  large: {
    systemPool: {
      vmSize: 'Standard_D8ds_v5',
      minCount: 2,
      maxCount: 5,
      priority: 'Regular',
    },
    userPool: {
      vmSize: 'Standard_E32ds_v5',
      minCount: 2,
      maxCount: 30,
      priority: 'Regular',
    },
  },
};

// ─── Normalisation ───────────────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function int(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return Number.NaN;
}

function pool(value: unknown): AksNodePool | null {
  if (value === null || value === undefined) return null;
  const v = value as Record<string, unknown>;
  return {
    vmSize: str(v.vmSize),
    minCount: int(v.minCount),
    maxCount: int(v.maxCount),
    priority: str(v.priority) === 'Spot' ? 'Spot' : 'Regular',
  };
}

/**
 * Coerce untrusted input into the canonical shape (trimming, lower-casing the
 * name segments). Does not validate — call validateAksClusterRequest.
 */
export function normalizeAksClusterRequest(raw: unknown): AksClusterRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    customer: str(r.customer),
    businessUnit: str(r.businessUnit),
    owner: str(r.owner).toLowerCase(),
    costCentre: str(r.costCentre),
    changeTicket: str(r.changeTicket).toUpperCase(),
    clusterProfile: str(r.clusterProfile),
    env: str(r.env).toLowerCase() as AksEnvironment,
    location: str(r.location).toLowerCase(),
    tenancy: str(r.tenancy).toLowerCase() as AksTenancy,
    tenantId: str(r.tenantId).toLowerCase(),
    kubernetesVersion: str(r.kubernetesVersion),
    addressSpace: str(r.addressSpace),
    systemPool: pool(r.systemPool) ?? {
      vmSize: '',
      minCount: Number.NaN,
      maxCount: Number.NaN,
      priority: 'Regular',
    },
    userPool: pool(r.userPool),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

// Control and line/paragraph-separator characters, written as escapes inside
// a string so no raw separator can end up in the source.
const CONTROL_CHARS = '\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029';
const PRINTABLE = new RegExp(`^[^${CONTROL_CHARS}]+$`);
const CONTROL_CHAR_GLOBAL = new RegExp(`[${CONTROL_CHARS}]`, 'g');
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const VM_SIZE = /^Standard_[A-Za-z0-9_]{2,40}$/;
const K8S_VERSION = /^1\.\d{1,2}\.\d{1,2}$/;
const TENANT_ID = /^[a-z0-9]{2,24}$/;
const CHANGE_TICKET = /^SCP-\d{1,7}$/;
const COST_CENTRE = /^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/;
/** Every standard-root cluster is a /16 inside 10.0.0.0/8; 10.0.0.0/16 is the unused module default. */
const ADDRESS_SPACE = /^10\.(\d{1,3})\.0\.0\/16$/;
/** AKS allows up to 1000 nodes per pool. */
const MAX_POOL_NODES = 1000;

function validatePool(
  p: AksNodePool,
  kind: 'system' | 'user',
  env: string,
): string | undefined {
  if (!VM_SIZE.test(p.vmSize)) return 'VM size must look like Standard_D8ds_v5';
  const minFloor = kind === 'system' ? 1 : 0;
  if (!Number.isInteger(p.minCount) || p.minCount < minFloor) {
    return `Minimum nodes must be a whole number ≥ ${minFloor}`;
  }
  if (!Number.isInteger(p.maxCount) || p.maxCount < Math.max(1, p.minCount)) {
    return 'Maximum nodes must be a whole number ≥ minimum (and ≥ 1)';
  }
  if (p.maxCount > MAX_POOL_NODES) {
    return `Maximum nodes cannot exceed ${MAX_POOL_NODES}`;
  }
  if (p.priority === 'Spot') {
    if (kind === 'system') return 'The system pool cannot use Spot priority';
    if (env === 'prd' || env === 'ppd') {
      return 'Spot priority is not allowed for prd/ppd clusters';
    }
  }
  return undefined;
}

/** Field-keyed validation errors; empty object ⇒ valid. */
export function validateAksClusterRequest(
  r: AksClusterRequest,
): AksClusterRequestErrors {
  const e: AksClusterRequestErrors = {};

  if (!r.customer) e.customer = 'Required';
  else if (r.customer.length > 64 || !PRINTABLE.test(r.customer))
    e.customer = 'Up to 64 printable characters';
  if (!r.businessUnit) e.businessUnit = 'Required';
  else if (r.businessUnit.length > 64 || !PRINTABLE.test(r.businessUnit))
    e.businessUnit = 'Up to 64 printable characters';
  if (!EMAIL.test(r.owner)) e.owner = 'A valid email address is required';
  if (!COST_CENTRE.test(r.costCentre))
    e.costCentre = '2–32 letters, digits or hyphens (e.g. P64358)';
  if (!CHANGE_TICKET.test(r.changeTicket))
    e.changeTicket = 'A Jira key such as SCP-1234 is required';

  if (AKS_UNSUPPORTED_PROFILES.includes(r.clusterProfile)) {
    e.clusterProfile =
      'Multi-region profiles need paired clusters, which CloudHub cannot generate yet';
  } else if (
    !(AKS_SINGLE_CLUSTER_PROFILES as readonly string[]).includes(
      r.clusterProfile,
    )
  ) {
    e.clusterProfile = 'Unknown cluster profile';
  }

  if (!(AKS_ENVIRONMENTS as readonly string[]).includes(r.env))
    e.env = `One of ${AKS_ENVIRONMENTS.join(', ')}`;
  if (!AZURE_REGION_SHORTNAMES[r.location]) e.location = 'Unknown Azure region';
  if (!(AKS_TENANCIES as readonly string[]).includes(r.tenancy))
    e.tenancy = 'st (single-tenant) or mt (multi-tenant)';
  if (r.tenantId !== 'all' && !TENANT_ID.test(r.tenantId))
    e.tenantId = "'all' or 2–24 lower-case letters/digits";
  if (!K8S_VERSION.test(r.kubernetesVersion))
    e.kubernetesVersion = 'A full version such as 1.36.2';

  const cidr = ADDRESS_SPACE.exec(r.addressSpace);
  const octet = cidr ? Number(cidr[1]) : Number.NaN;
  if (!cidr || octet < 1 || octet > 255) {
    e.addressSpace =
      'A /16 inside 10.0.0.0/8, e.g. 10.230.0.0/16 (not 10.0.0.0/16)';
  }

  const sys = validatePool(r.systemPool, 'system', r.env);
  if (sys) e.systemPool = sys;
  if (r.userPool) {
    const usr = validatePool(r.userPool, 'user', r.env);
    if (usr) e.userPool = usr;
  }

  return e;
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Resource names exactly as the standard root + naming module v1.12.0 produce
 * them for naming_scope = "default" and no seq2.
 */
export function deriveAksNames(r: AksClusterRequest): AksDerivedNames {
  const regionCode = AZURE_REGION_SHORTNAMES[r.location] ?? '';
  const tuple = `scp-${r.env}-${regionCode}-${r.tenancy}-${r.tenantId}`;
  const clusterName = `aks-${tuple}`;
  return {
    regionCode,
    clusterName,
    resourceGroupName: `rg-${tuple}`,
    vnetName: `vnet-${tuple}`,
    nodeResourceGroupName: `mc-rg-${tuple}-node-rg`,
    jumpboxName: `jumpbox-${tuple}`,
    workspaceName: clusterName,
    valuesFilePath: `${AKS_VALUES_DIR}/${clusterName}.tfvars`,
  };
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

function intToIpv4(n: number): string {
  return [24, 16, 8, 0]
    .map(shift => Math.floor(n / 2 ** shift) % 256)
    .join('.');
}

/** Terraform's cidrsubnet(prefix, newbits, netnum). */
export function cidrsubnet(
  prefix: string,
  newbits: number,
  netnum: number,
): string {
  const [ip, lenText] = prefix.split('/');
  const len = Number(lenText) + newbits;
  const base = ipv4ToInt(ip);
  return `${intToIpv4(base + netnum * 2 ** (32 - len))}/${len}`;
}

/** Subnets the standard root derives from address_space[0] (locals.tf L8-11). */
export function deriveAksSubnets(addressSpace: string): AksDerivedSubnets {
  return {
    aks: cidrsubnet(addressSpace, 2, 0),
    secondary: cidrsubnet(addressSpace, 2, 2),
    netapp: cidrsubnet(addressSpace, 8, 192),
    vpnGateway: cidrsubnet(addressSpace, 11, 2040),
  };
}

/**
 * Locate `"<name>" = {...}` inside the azure-kubernetes-service-standard block
 * of workspaces.tfvars. Returns the override body ('' for `{}`) or null.
 */
export function findAksWorkspaceEntry(
  content: string,
  workspaceName: string,
): { body: string | null } | null {
  const lines = content.split('\n');
  const start = lines.findIndex(line =>
    new RegExp(`^\\s*"${AKS_STANDARD_ROOT}"\\s*=\\s*\\{\\s*$`).test(line),
  );
  if (start < 0) return null;
  let depth = 1;
  const quoted = `"${workspaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`;
  for (let i = start + 1; i < lines.length && depth > 0; i++) {
    const line = lines[i];
    const stripped = line.replace(/#.*$/, '');
    if (
      depth === 1 &&
      new RegExp(`^\\s*${quoted}\\s*=\\s*\\{`).test(stripped)
    ) {
      if (/\{\s*\}\s*$/.test(stripped)) return { body: null };
      const body: string[] = [];
      let entryDepth = 1;
      for (let j = i + 1; j < lines.length; j++) {
        const inner = lines[j].replace(/#.*$/, '');
        entryDepth += (inner.match(/\{/g) ?? []).length;
        entryDepth -= (inner.match(/\}/g) ?? []).length;
        if (entryDepth <= 0) break;
        body.push(lines[j].trim());
      }
      return { body: body.join('\n') };
    }
    depth += (stripped.match(/\{/g) ?? []).length;
    depth -= (stripped.match(/\}/g) ?? []).length;
  }
  return null;
}

/** Parse an IPv4 CIDR into its [first, last] address range, or null. */
export function ipv4CidrRange(cidr: string): [number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(
    cidr.trim(),
  );
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const len = Number(match[5]);
  if (octets.some(o => o > 255) || len > 32) return null;
  const size = 2 ** (32 - len);
  const start = Math.floor(ipv4ToInt(octets.join('.')) / size) * size;
  return [start, start + size - 1];
}

/** True when two IPv4 CIDRs share at least one address. */
export function cidrsOverlap(a: string, b: string): boolean {
  const ra = ipv4CidrRange(a);
  const rb = ipv4CidrRange(b);
  return !!ra && !!rb && ra[0] <= rb[1] && rb[0] <= ra[1];
}

// ─── Values-file rendering ───────────────────────────────────────────────────

/**
 * Quote a value as an HCL string literal. Escapes quotes, backslashes, every
 * control/separator character, and the `${` / `%{` template introducers, so no
 * user input can terminate the string or inject configuration.
 */
export function hclString(value: unknown): string {
  const escaped = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(
      CONTROL_CHAR_GLOBAL,
      c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )
    // Function replacers: in a replacement *string* `$$` collapses to `$`.
    .replace(/\$\{/g, () => '$${')
    .replace(/%\{/g, () => '%%{');
  return `"${escaped}"`;
}

/** Attributes with `=` aligned the way `terraform fmt` aligns a run of lines. */
function alignedAttributes(
  attrs: Array<[string, string]>,
  indent: string,
): string[] {
  const width = Math.max(...attrs.map(([k]) => k.length));
  return attrs.map(([k, v]) => `${indent}${k.padEnd(width)} = ${v}`);
}

function poolBlock(name: string, p: AksNodePool, k8s: string): string[] {
  const attrs: Array<[string, string]> = [
    ['min_count', String(p.minCount)],
    ['max_count', String(p.maxCount)],
    ['vm_size', hclString(p.vmSize)],
    ['orchestrator_version', hclString(k8s)],
  ];
  if (p.priority === 'Spot') {
    attrs.push(
      ['priority', hclString('Spot')],
      ['eviction_policy', hclString('Delete')],
      ['spot_max_price', '-1'],
    );
  }
  return [`${name} = {`, ...alignedAttributes(attrs, '  '), '}'];
}

/**
 * The cluster's values file for azure-kubernetes-service-standard, formatted
 * exactly as `terraform fmt` (1.15) would leave it. `created` is the tag date
 * (YYYY-MM-DD) and is the only input not taken from the request.
 */
export function renderAksValuesFile(
  r: AksClusterRequest,
  options: { created: string },
): string {
  const names = deriveAksNames(r);
  const lines: string[] = [
    '# Managed by CloudHub (/create/aks). Change it through a CloudHub request',
    '# amendment so the approved configuration and this file stay identical.',
    '',
    ...alignedAttributes(
      [
        ['kubernetes_version', hclString(r.kubernetesVersion)],
        ['address_space', `[${hclString(r.addressSpace)}]`],
      ],
      '',
    ),
    '',
    ...alignedAttributes(
      [
        ['env', hclString(r.env)],
        ['tenancy', hclString(r.tenancy)],
        ['tenant_id', hclString(r.tenantId)],
        ['location', hclString(r.location)],
        ['region_code', hclString(names.regionCode)],
      ],
      '',
    ),
    '',
    'tags = {',
    ...alignedAttributes(
      [
        ['"created"', hclString(options.created)],
        ['"customer"', hclString(r.customer)],
        ['"env"', hclString(r.env)],
        ['"terraform"', hclString('true')],
        ['"CostCenter1"', hclString(r.costCentre)],
      ],
      '  ',
    ),
    '}',
    '',
    ...poolBlock('default_node_pool', r.systemPool, r.kubernetesVersion),
    '',
    ...(r.userPool
      ? poolBlock('usernp01', r.userPool, r.kubernetesVersion)
      : ['usernp01 = null']),
  ];
  return `${lines.join('\n')}\n`;
}

// ─── Workflow State Machine ──────────────────────────────────────────────────

export const AKS_WORKFLOW_STATES = [
  // High-level lifecycle states
  'DRAFT',
  'VALIDATING',
  'PENDING_APPROVAL',
  'ACCESS_PR_PENDING',
  'ACCESS_CONFIGURED',
  'INFRA_PR_PENDING',
  'INFRASTRUCTURE_PR_MERGED',
  'WORKSPACE_PENDING',
  'PLAN_PENDING',
  'AWAITING_APPLY',
  'APPLYING',
  'INFRASTRUCTURE_READY',
  'ADDONS_DEPLOYING',
  'OPERATIONAL_CONFIGURATION',
  'VERIFYING',
  'COMPLETED',
  // Failure and exception states
  'VALIDATION_FAILED',
  'APPROVAL_REJECTED',
  'APPROVAL_INVALIDATED',
  'PR_CHECKS_FAILED',
  'PR_CLOSED',
  'WORKSPACE_FAILED',
  'WORKSPACE_MAPPING_MISMATCH',
  'PLAN_FAILED',
  'PLAN_CANCELLED',
  'NO_CHANGES',
  'APPLY_FAILED',
  'APPLY_CANCELLED',
  'APPLY_DISCARDED',
  'ADDONS_FAILED',
  'OPERATIONAL_CONFIGURATION_FAILED',
  'VERIFICATION_FAILED',
  'BLOCKED',
  'CANCEL_REQUESTED',
  // Generic failure / legacy compatibility
  'FAILED',
] as const;

export type AksWorkflowState = (typeof AKS_WORKFLOW_STATES)[number];

export const ALLOWED_WORKFLOW_TRANSITIONS: Record<
  AksWorkflowState,
  ReadonlyArray<AksWorkflowState>
> = {
  DRAFT: ['VALIDATING', 'PENDING_APPROVAL', 'CANCEL_REQUESTED'],
  VALIDATING: [
    'DRAFT',
    'PENDING_APPROVAL',
    'VALIDATION_FAILED',
    'CANCEL_REQUESTED',
  ],
  VALIDATION_FAILED: ['DRAFT', 'VALIDATING', 'CANCEL_REQUESTED'],
  PENDING_APPROVAL: [
    'APPROVAL_REJECTED',
    'APPROVAL_INVALIDATED',
    'ACCESS_PR_PENDING',
    'DRAFT',
    'BLOCKED',
    'CANCEL_REQUESTED',
  ],
  APPROVAL_REJECTED: ['DRAFT', 'CANCEL_REQUESTED'],
  APPROVAL_INVALIDATED: ['PENDING_APPROVAL', 'DRAFT', 'CANCEL_REQUESTED'],
  ACCESS_PR_PENDING: [
    'ACCESS_CONFIGURED',
    'PR_CHECKS_FAILED',
    'PR_CLOSED',
    'APPROVAL_INVALIDATED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  ACCESS_CONFIGURED: [
    'INFRA_PR_PENDING',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  INFRA_PR_PENDING: [
    'INFRASTRUCTURE_PR_MERGED',
    'PR_CHECKS_FAILED',
    'PR_CLOSED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  PR_CHECKS_FAILED: [
    'INFRA_PR_PENDING',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  PR_CLOSED: ['FAILED'],
  INFRASTRUCTURE_PR_MERGED: [
    'WORKSPACE_PENDING',
    'WORKSPACE_FAILED',
    'WORKSPACE_MAPPING_MISMATCH',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  WORKSPACE_PENDING: [
    'PLAN_PENDING',
    'WORKSPACE_FAILED',
    'WORKSPACE_MAPPING_MISMATCH',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  WORKSPACE_FAILED: [
    'WORKSPACE_PENDING',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  WORKSPACE_MAPPING_MISMATCH: ['BLOCKED', 'CANCEL_REQUESTED', 'FAILED'],
  PLAN_PENDING: [
    'AWAITING_APPLY',
    'PLAN_FAILED',
    'PLAN_CANCELLED',
    'NO_CHANGES',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  PLAN_FAILED: ['PLAN_PENDING', 'BLOCKED', 'CANCEL_REQUESTED', 'FAILED'],
  PLAN_CANCELLED: ['PLAN_PENDING', 'BLOCKED', 'CANCEL_REQUESTED', 'FAILED'],
  NO_CHANGES: ['BLOCKED', 'CANCEL_REQUESTED', 'FAILED'],
  AWAITING_APPLY: [
    'APPLYING',
    'APPLY_CANCELLED',
    'APPLY_DISCARDED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  APPLYING: [
    'INFRASTRUCTURE_READY',
    'APPLY_FAILED',
    'APPLY_CANCELLED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  APPLY_FAILED: ['APPLYING', 'AWAITING_APPLY', 'CANCEL_REQUESTED', 'FAILED'],
  APPLY_CANCELLED: [
    'APPLYING',
    'AWAITING_APPLY',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  APPLY_DISCARDED: ['PLAN_PENDING', 'CANCEL_REQUESTED', 'FAILED'],
  INFRASTRUCTURE_READY: [
    'ADDONS_DEPLOYING',
    'OPERATIONAL_CONFIGURATION',
    'VERIFYING',
    'COMPLETED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  ADDONS_DEPLOYING: [
    'OPERATIONAL_CONFIGURATION',
    'VERIFYING',
    'COMPLETED',
    'ADDONS_FAILED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  ADDONS_FAILED: ['ADDONS_DEPLOYING', 'BLOCKED', 'CANCEL_REQUESTED', 'FAILED'],
  OPERATIONAL_CONFIGURATION: [
    'VERIFYING',
    'COMPLETED',
    'OPERATIONAL_CONFIGURATION_FAILED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  OPERATIONAL_CONFIGURATION_FAILED: [
    'OPERATIONAL_CONFIGURATION',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  VERIFYING: [
    'COMPLETED',
    'VERIFICATION_FAILED',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  VERIFICATION_FAILED: [
    'VERIFYING',
    'BLOCKED',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  COMPLETED: [],
  BLOCKED: [
    'PENDING_APPROVAL',
    'ACCESS_PR_PENDING',
    'INFRA_PR_PENDING',
    'WORKSPACE_PENDING',
    'PLAN_PENDING',
    'AWAITING_APPLY',
    'APPLYING',
    'INFRASTRUCTURE_READY',
    'ADDONS_DEPLOYING',
    'OPERATIONAL_CONFIGURATION',
    'VERIFYING',
    'CANCEL_REQUESTED',
    'FAILED',
  ],
  CANCEL_REQUESTED: ['FAILED'],
  FAILED: [],
};

/** Normalize any status string (including legacy ones) to a canonical AksWorkflowState. */
export function normalizeWorkflowState(
  status: string | null | undefined,
): AksWorkflowState {
  if (!status) return 'DRAFT';
  const upper = status.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((AKS_WORKFLOW_STATES as readonly string[]).includes(upper)) {
    return upper as AksWorkflowState;
  }
  // Mapping of legacy lowercase or snake_case statuses
  switch (status.toLowerCase()) {
    case 'pending_approval':
      return 'PENDING_APPROVAL';
    case 'approved':
      return 'ACCESS_PR_PENDING';
    case 'awaiting_tailscale_merge':
      return 'ACCESS_PR_PENDING';
    case 'preparing_infra_pr':
      return 'ACCESS_CONFIGURED';
    case 'awaiting_pr_merge':
    case 'branch_ready':
      return 'INFRA_PR_PENDING';
    case 'infra_pr_failed':
      return 'PR_CHECKS_FAILED';
    case 'provisioning':
      return 'APPLYING';
    case 'infrastructure_ready':
      return 'INFRASTRUCTURE_READY';
    case 'bootstrapping':
      return 'ADDONS_DEPLOYING';
    case 'validating':
      return 'VERIFYING';
    case 'completed':
      return 'COMPLETED';
    case 'rejected':
      return 'APPROVAL_REJECTED';
    case 'failed':
      return 'FAILED';
    default:
      return 'DRAFT';
  }
}

export function validateWorkflowTransition(
  from: AksWorkflowState,
  to: AksWorkflowState,
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_WORKFLOW_TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
}

// ─── Execution Events Model ──────────────────────────────────────────────────

export type EventSourceSystem =
  | 'github'
  | 'terraform-cloud'
  | 'azure'
  | 'scripts'
  | 'operational'
  | 'cloudhub';

export type EventNormalizedStatus =
  | 'pending'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'warning';

export type EventWorkflowStep =
  | 'configure'
  | 'review'
  | 'approval'
  | 'pull_request'
  | 'provision'
  | 'addons'
  | 'operational'
  | 'verification';

export interface ExecutionEvent {
  id?: number;
  requestId: string;
  configFingerprint?: string;
  eventId: string;
  sourceSystem: EventSourceSystem;
  externalRef?: string;
  eventType: string;
  normalizedStatus: EventNormalizedStatus;
  message: string;
  sourceTimestamp?: string;
  ingestionTimestamp?: string;
  step?: EventWorkflowStep;
  severity: 'info' | 'success' | 'warning' | 'error';
  details?: Record<string, unknown>;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

// ─── Readiness Status Model ──────────────────────────────────────────────────

export interface AksReadinessStatus {
  infrastructureReady: boolean;
  addonsReady: boolean;
  operationallyReady: boolean;
  completed: boolean;
  overallStatus: string;
  details?: {
    terraformApplied?: boolean;
    outputsAvailable?: boolean;
    clusterExistsInAzure?: boolean;
    jumpboxConfigured?: boolean;
    addons?: Record<
      string,
      {
        status:
          | 'pending'
          | 'in_progress'
          | 'succeeded'
          | 'failed'
          | 'not_configured';
        runId?: string;
        message?: string;
      }
    >;
    operational?: Record<
      string,
      {
        status: 'pending' | 'verified' | 'manual_required';
        detail?: string;
      }
    >;
  };
}
