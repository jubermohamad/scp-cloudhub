/**
 * aksDiscoveryService.ts
 *
 * AKS discovery and node pool fetch via Azure Management REST API.
 *
 * Uses the shared CloudHub ClientSecretCredential for token acquisition. No
 * ARM SDK package is required — calls are made
 * directly against the management.azure.com REST API using the platform's
 * Service Principal credentials from environment variables.
 *
 * Environment variables consumed:
 *   AZURE_TENANT_ID        – Azure AD tenant
 *   AZURE_CLIENT_ID        – Service Principal client (application) ID
 *   AZURE_CLIENT_SECRET    – Service Principal secret  (from Key Vault in prod)
 *
 * Public API:
 *   discoverClusters(subscriptionId, resourceGroup?)  → AksClusterSummary[]
 *   fetchClusterDetail(subscriptionId, resourceGroup, clusterName) → AksClusterDetail
 *   fetchNodePools(subscriptionId, resourceGroup, clusterName)     → AksNodePool[]
 */

import { randomUUID } from 'crypto';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import type {
  AksAuthMode,
  AksClusterDetail,
  AksClusterSummary,
  AksNodePool,
  NodePoolMode,
} from './costAutomationTypes';

const MGMT_BASE = 'https://management.azure.com';
const API_VERSION = '2024-01-01';
const RBAC_API_VERSION = '2022-04-01';
/** Built-in role: Azure Kubernetes Service Cluster User Role */
const AKS_CLUSTER_USER_ROLE_DEF_ID = '4abbcc35-e782-43d8-92c5-2d3f1bd2253f';

// ─── Credential resolution ────────────────────────────────────────────────────

// ─── Token helpers ────────────────────────────────────────────────────────────

async function getBearerToken(logger: LoggerService): Promise<string> {
  const credential = createCloudHubAzureCredential((message, metadata) =>
    logger.info(message, metadata),
  );
  const token = await credential.getToken(
    'https://management.azure.com/.default',
  );
  if (!token?.token) {
    throw new Error(
      'Failed to acquire Azure management token. ' +
        'Check AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.',
    );
  }
  return token.token;
}

/**
 * Acquires a bearer token for the platform SPN (cloudhub-platform-svc-root).
 * Used only by assignClusterUserRole for RBAC write operations.
 */
async function getPlatformBearerToken(logger: LoggerService): Promise<string> {
  const credential = createCloudHubAzureCredential((message, metadata) =>
    logger.info(message, metadata),
  );
  const token = await credential.getToken(
    'https://management.azure.com/.default',
  );
  if (!token?.token) {
    throw new Error(
      'Failed to acquire Azure management token for platform SPN. ' +
        'Check AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.',
    );
  }
  return token.token;
}

// ─── Internal HTTP helper ─────────────────────────────────────────────────────

async function azureGet<T>(url: string, logger: LoggerService): Promise<T> {
  const token = await getBearerToken(logger);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.warn(`[aksDiscovery] HTTP ${res.status} for ${url}: ${body}`);
    throw new Error(`Azure API returned HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── ARM write helpers ─────────────────────────────────────────────────────────

/**
 * POST to an ARM endpoint (e.g. cluster start / stop LRO).
 * Accepts 200 (immediate) or 202 (LRO accepted) as success.
 */
async function azurePost(url: string, logger: LoggerService): Promise<void> {
  const token = await getBearerToken(logger);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok && res.status !== 202) {
    const body = await res.text();
    logger.warn(`[aksDiscovery] POST HTTP ${res.status} for ${url}: ${body}`);
    throw new Error(`Azure API returned HTTP ${res.status}: ${body}`);
  }
}

/**
 * PATCH an ARM resource (e.g. scale an agent pool's node count).
 * Accepts 200, 201, or 202 as success.
 */
async function azurePatch(
  url: string,
  body: unknown,
  logger: LoggerService,
): Promise<void> {
  const token = await getBearerToken(logger);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    logger.warn(`[aksDiscovery] PATCH HTTP ${res.status} for ${url}: ${text}`);
    throw new Error(`Azure API returned HTTP ${res.status}: ${text}`);
  }
}

// ─── Raw ARM types (internal, not exported) ───────────────────────────────────

interface ArmManagedCluster {
  name: string;
  location: string;
  tags?: Record<string, string>;
  properties?: {
    kubernetesVersion?: string;
    provisioningState?: string;
    powerState?: { code?: string };
    fqdn?: string;
    aadProfile?: { enableAzureRBAC?: boolean };
    disableLocalAccounts?: boolean;
    agentPoolProfiles?: ArmAgentPool[];
  };
}

interface ArmManagedClusterListResult {
  value: ArmManagedCluster[];
  nextLink?: string;
}

interface ArmAgentPool {
  name?: string;
  properties?: {
    mode?: string;
    vmSize?: string;
    count?: number;
    minCount?: number;
    maxCount?: number;
    enableAutoScaling?: boolean;
    osDiskSizeGB?: number;
    provisioningState?: string;
    powerState?: { code?: string };
    nodeLabels?: Record<string, string>;
    nodeTaints?: string[];
  };
}

interface ArmAgentPoolListResult {
  value: ArmAgentPool[];
  nextLink?: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function resolveAuthMode(cluster: ArmManagedCluster): AksAuthMode {
  const aad = cluster.properties?.aadProfile;
  const disableLocal = cluster.properties?.disableLocalAccounts;
  if (disableLocal) return 'azureRBAC';
  if (aad?.enableAzureRBAC) return 'azureRBAC';
  return 'local';
}

function resolvePowerState(
  powerCode: string | undefined,
): 'Running' | 'Stopped' | 'Unknown' {
  if (powerCode === 'running') {
    return 'Running';
  }
  if (powerCode === 'stopped') {
    return 'Stopped';
  }
  return 'Unknown';
}

function mapClusterSummary(
  cluster: ArmManagedCluster,
  subscriptionId: string,
  resourceGroup: string,
): AksClusterSummary {
  const p = cluster.properties ?? {};
  const powerCode = p.powerState?.code?.toLowerCase();
  return {
    clusterName: cluster.name,
    resourceGroup,
    subscriptionId,
    location: cluster.location,
    kubernetesVersion: p.kubernetesVersion ?? 'unknown',
    provisioningState: p.provisioningState ?? 'Unknown',
    powerState: resolvePowerState(powerCode),
    authMode: resolveAuthMode(cluster),
    fqdn: p.fqdn ?? null,
    tags: cluster.tags ?? {},
  };
}

function mapNodePool(pool: ArmAgentPool): AksNodePool {
  const p = pool.properties ?? {};
  const powerCode = p.powerState?.code?.toLowerCase();
  return {
    name: pool.name ?? 'unknown',
    mode: (p.mode === 'System' ? 'System' : 'User') as NodePoolMode,
    vmSize: p.vmSize ?? 'unknown',
    count: p.count ?? 0,
    minCount: p.minCount ?? null,
    maxCount: p.maxCount ?? null,
    autoscalingEnabled: p.enableAutoScaling ?? false,
    osDiskSizeGB: p.osDiskSizeGB ?? 0,
    provisioningState: p.provisioningState ?? 'Unknown',
    powerState: resolvePowerState(powerCode),
    nodeLabels: p.nodeLabels ?? {},
    nodeTaints: p.nodeTaints ?? [],
  };
}

// ─── Public service functions ─────────────────────────────────────────────────

/**
 * Discover all AKS clusters in a subscription, optionally filtered by resource group.
 * Handles Azure pagination via nextLink automatically.
 */
export async function discoverClusters(
  subscriptionId: string,
  resourceGroup: string | null,
  logger: LoggerService,
): Promise<AksClusterSummary[]> {
  const path = resourceGroup
    ? `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters`
    : `/subscriptions/${subscriptionId}/providers/Microsoft.ContainerService/managedClusters`;

  let url:
    | string
    | undefined = `${MGMT_BASE}${path}?api-version=${API_VERSION}`;
  const all: AksClusterSummary[] = [];

  while (url) {
    const page: ArmManagedClusterListResult =
      await azureGet<ArmManagedClusterListResult>(url, logger);
    const rg = resourceGroup ?? '';
    for (const cluster of page.value ?? []) {
      // Derive resource group from ARM resource ID if not provided
      const armId: string | undefined = (cluster as unknown as { id?: string })
        .id;
      const effectiveRg =
        (rg ||
          armId
            ?.split('/')
            .find(
              (_: string, i: number, arr: string[]) =>
                arr[i - 1]?.toLowerCase() === 'resourcegroups',
            )) ??
        '';
      all.push(mapClusterSummary(cluster, subscriptionId, effectiveRg));
    }
    url = page.nextLink;
  }

  logger.info(
    `[aksDiscovery] Found ${all.length} cluster(s) in subscription=${subscriptionId}`,
  );
  return all;
}

/**
 * Fetch node pools for a specific AKS cluster.
 */
export async function fetchNodePools(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  logger: LoggerService,
): Promise<AksNodePool[]> {
  const url =
    `${MGMT_BASE}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${clusterName}` +
    `/agentPools?api-version=${API_VERSION}`;

  const result = await azureGet<ArmAgentPoolListResult>(url, logger);
  const pools = (result.value ?? []).map(mapNodePool);

  logger.info(
    `[aksDiscovery] Fetched ${pools.length} node pool(s) for cluster="${clusterName}"`,
  );
  return pools;
}

/**
 * Fetch full cluster detail (summary + node pools) in a single composed call.
 */
export async function fetchClusterDetail(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  logger: LoggerService,
): Promise<AksClusterDetail> {
  const clusterUrl =
    `${MGMT_BASE}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${clusterName}` +
    `?api-version=${API_VERSION}`;

  const [raw, nodePools] = await Promise.all([
    azureGet<ArmManagedCluster>(clusterUrl, logger),
    fetchNodePools(subscriptionId, resourceGroup, clusterName, logger),
  ]);

  return {
    ...mapClusterSummary(raw, subscriptionId, resourceGroup),
    nodePools,
  };
}

// ─── ARM lifecycle actions ─────────────────────────────────────────────────────

/**
 * Trigger a cluster-level start or stop via ARM.
 * ARM returns 202 Accepted; we return immediately without polling.
 * The SPN requires: Microsoft.ContainerService/managedClusters/start/action
 *                   Microsoft.ContainerService/managedClusters/stop/action
 */
export async function triggerClusterLifecycle(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  action: 'start' | 'stop',
  logger: LoggerService,
): Promise<void> {
  const url =
    `${MGMT_BASE}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${clusterName}/${action}` +
    `?api-version=${API_VERSION}`;
  logger.info(
    `[aksDiscovery] Triggering cluster ${action} for "${clusterName}"`,
  );
  await azurePost(url, logger);
  logger.info(`[aksDiscovery] Cluster ${action} accepted for "${clusterName}"`);
}

/**
 * Assigns the built-in "Azure Kubernetes Service Cluster User Role" to the
 * AKS automation service principal on the target AKS cluster.
 *
 * This allows the automation SPN to call listClusterUserCredentials, which
 * is required for pod/node map retrieval.  The operation is idempotent —
 * if the role is already assigned, the function returns early.
 *
 * Authentication: uses the canonical CloudHub platform SPN configured in
 * AZURE_*; no alternate identity fallback is permitted.
 *
 * @returns `alreadyExisted` — true when the assignment was already present.
 */
export async function assignClusterUserRole(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  principalObjectId: string,
  logger: LoggerService,
): Promise<{ alreadyExisted: boolean }> {
  // All RBAC API calls use the same canonical platform SPN as AKS discovery.
  const token = await getPlatformBearerToken(logger);
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const scope =
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
  const roleDefId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${AKS_CLUSTER_USER_ROLE_DEF_ID}`;

  // ── Check for an existing assignment ───────────────────────────────────────
  const listUrl =
    `${MGMT_BASE}${scope}/providers/Microsoft.Authorization/roleAssignments` +
    `?api-version=${RBAC_API_VERSION}&$filter=principalId eq '${principalObjectId}'`;

  const listRes = await fetch(listUrl, { headers: authHeaders });
  if (!listRes.ok) {
    const body = await listRes.text();
    logger.warn(
      `[aksDiscovery] [rbac] List role assignments HTTP ${listRes.status}: ${body}`,
    );
    throw new Error(`Azure RBAC list failed (HTTP ${listRes.status}): ${body}`);
  }
  const existing = (await listRes.json()) as {
    value: { properties?: { roleDefinitionId?: string } }[];
  };
  const alreadyAssigned = (existing.value ?? []).some(ra =>
    ra.properties?.roleDefinitionId?.endsWith(AKS_CLUSTER_USER_ROLE_DEF_ID),
  );

  if (alreadyAssigned) {
    logger.info(
      `[aksDiscovery] [rbac] AKS Cluster User Role already assigned to principal="${principalObjectId}" on cluster="${clusterName}"`,
    );
    return { alreadyExisted: true };
  }

  // ── Create the role assignment ─────────────────────────────────────────────
  const assignmentName = randomUUID();
  const putUrl =
    `${MGMT_BASE}${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentName}` +
    `?api-version=${RBAC_API_VERSION}`;

  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      properties: {
        roleDefinitionId: roleDefId,
        principalId: principalObjectId,
        principalType: 'ServicePrincipal',
      },
    }),
  });

  if (!putRes.ok) {
    const body = await putRes.text();
    // 409 RoleAssignmentExists — the list-before-put may have missed it due to
    // eventual consistency or a concurrent assignment.  Treat as success.
    if (putRes.status === 409) {
      logger.info(
        `[aksDiscovery] [rbac] Role assignment already exists (409) for principal="${principalObjectId}" on cluster="${clusterName}"`,
      );
      return { alreadyExisted: true };
    }
    logger.warn(
      `[aksDiscovery] [rbac] Create role assignment HTTP ${putRes.status}: ${body}`,
    );
    throw new Error(
      `Azure RBAC assignment failed (HTTP ${putRes.status}): ${body}`,
    );
  }

  logger.info(
    `[aksDiscovery] [rbac] Assigned AKS Cluster User Role via platform SPN ` +
      `to principal="${principalObjectId}" on cluster="${clusterName}" (assignmentId=${assignmentName})`,
  );
  return { alreadyExisted: false };
}

/**
 * Scale a single AKS agent pool to the target node count.
 * The SPN requires: Microsoft.ContainerService/managedClusters/agentPools/write
 */
export async function patchNodePoolCount(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  poolName: string,
  count: number,
  logger: LoggerService,
): Promise<void> {
  const url =
    `${MGMT_BASE}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${clusterName}/agentPools/${poolName}` +
    `?api-version=${API_VERSION}`;
  logger.info(
    `[aksDiscovery] Scaling pool "${poolName}" on "${clusterName}" to ${count}`,
  );
  await azurePatch(url, { properties: { count } }, logger);
}
