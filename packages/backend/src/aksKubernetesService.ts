/**
 * aksKubernetesService.ts
 *
 * Kubernetes data-plane service: node listing and pod-to-node mapping.
 *
 * Uses @kubernetes/client-node (v1.4.0) to connect to an AKS cluster
 * and build a structured NodeWithPods map for cost analysis.
 *
 * Authentication options (in priority order):
 *   1. Explicit base64 kubeconfig passed as a parameter
 *   2. AKS user credentials fetched from Azure when subscription + resource
 *      group are provided
 *   3. KUBECONFIG env var / default ~/.kube/config
 *   4. In-cluster service account (when running inside Kubernetes)
 *
 * The Backstage SPN must have the ClusterRole applied via
 * platform_tools/aks_onboarding/rbac/ before this service can connect.
 *
 * Public API:
 *   buildNodePodMap(clusterName, kubeConfigBase64?)  → NodePodMap
 *   listClusterNodes(clusterName, kubeConfigBase64?) → NodeWithPods[]
 */

import * as k8s from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import type {
  ContainerResources,
  NodePodMap,
  NodeWithPods,
  PodSummary,
} from './costAutomationTypes';

// ─── KubeConfig factory ───────────────────────────────────────────────────────

const MGMT_BASE = 'https://management.azure.com';
const API_VERSION = '2024-01-01';

async function getBearerToken(logger: LoggerService): Promise<string> {
  const credential = createCloudHubAzureCredential((message, metadata) =>
    logger.info(message, metadata),
  );
  const token = await credential.getToken(
    'https://management.azure.com/.default',
  );
  if (!token?.token) {
    throw new Error(
      'Failed to acquire Azure management token for AKS credentials.',
    );
  }
  return token.token;
}

async function fetchAksUserKubeConfigBase64(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  logger: LoggerService,
): Promise<string> {
  const token = await getBearerToken(logger);
  const clusterBase =
    `${MGMT_BASE}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;

  const fetchCredential = async (
    action: 'listClusterUserCredentials' | 'listClusterAdminCredentials',
  ) => {
    const url = `${clusterBase}/${action}?api-version=${API_VERSION}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false as const, status: res.status, body };
    }

    const data = (await res.json()) as {
      kubeconfigs?: Array<{ value?: string }>;
      kubeConfig?: Array<{ value?: string }>;
    };
    const kubeConfigBase64 =
      data.kubeconfigs?.[0]?.value ?? data.kubeConfig?.[0]?.value;
    if (!kubeConfigBase64) {
      return {
        ok: false as const,
        status: 502,
        body: `Azure returned no kubeconfig from ${action}.`,
      };
    }

    return { ok: true as const, kubeConfigBase64 };
  };

  const userAttempt = await fetchCredential('listClusterUserCredentials');
  if (userAttempt.ok) {
    return userAttempt.kubeConfigBase64;
  }

  logger.warn(
    `[aksK8s] HTTP ${userAttempt.status} while fetching user kubeconfig for cluster="${clusterName}": ${userAttempt.body}`,
  );

  // Some environments permit admin credentials but not user credentials.
  if (userAttempt.status === 401 || userAttempt.status === 403) {
    const adminAttempt = await fetchCredential('listClusterAdminCredentials');
    if (adminAttempt.ok) {
      logger.warn(
        `[aksK8s] Falling back to admin kubeconfig for cluster="${clusterName}" because user credentials are not permitted.`,
      );
      return adminAttempt.kubeConfigBase64;
    }
    logger.warn(
      `[aksK8s] HTTP ${adminAttempt.status} while fetching admin kubeconfig for cluster="${clusterName}": ${adminAttempt.body}`,
    );
  }

  throw new Error(
    `Azure API returned HTTP ${userAttempt.status}: ${userAttempt.body}`,
  );
}

function buildKubeConfig(
  clusterName: string,
  kubeConfigBase64?: string,
): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();

  if (kubeConfigBase64) {
    const yaml = Buffer.from(kubeConfigBase64, 'base64').toString('utf8');
    kc.loadFromString(yaml);
    return kc;
  }

  // Try env / default kubeconfig file, then in-cluster.
  // We track whether loadFromDefault succeeded so that an HTTP-endpoint
  // validation error is NOT silently swallowed by the outer catch.
  let loadedFromDefault = false;
  try {
    kc.loadFromDefault();
    loadedFromDefault = true;
  } catch {
    kc.loadFromCluster();
    return kc;
  }

  if (loadedFromDefault) {
    // Switch to the context matching the cluster if multiple are present
    const contexts = kc.getContexts();
    const match = contexts.find(
      c =>
        c.name === clusterName ||
        c.cluster === clusterName ||
        c.name.toLowerCase().includes(clusterName.toLowerCase()),
    );
    if (match) {
      kc.setCurrentContext(match.name);
    }

    // Reject HTTP API server endpoints early.
    // @kubernetes/client-node throws "HTTP protocol is not allowed when
    // skipTLSVerify is not set or false" only when the first network request
    // is attempted, making debugging harder.  We surface the problem here so
    // the error message is unambiguous and the router's error-code classifier
    // (KUBECONFIG_HTTP_PROTOCOL_NOT_ALLOWED) is triggered as expected.
    const currentCluster = kc.getCurrentCluster();
    if (
      currentCluster?.server?.startsWith('http://') &&
      !currentCluster.skipTLSVerify
    ) {
      throw new Error(
        'HTTP protocol is not allowed when skipTLSVerify is not set or false. ' +
          'The fallback kubeconfig resolves to an HTTP server endpoint. ' +
          'Configure a valid HTTPS kubeconfig (or KUBECONFIG) for this cluster, ' +
          'or enable Azure credential-based kubeconfig retrieval.',
      );
    }
  }

  return kc;
}

// ─── Resource helpers ─────────────────────────────────────────────────────────

function mapContainerResources(
  res?: k8s.V1ResourceRequirements,
): ContainerResources {
  return {
    cpuRequest: res?.requests?.cpu ?? null,
    memoryRequest: res?.requests?.memory ?? null,
    cpuLimit: res?.limits?.cpu ?? null,
    memoryLimit: res?.limits?.memory ?? null,
  };
}

function nodeStatus(node: k8s.V1Node): 'Ready' | 'NotReady' | 'Unknown' {
  const condition = node.status?.conditions?.find(c => c.type === 'Ready');
  if (!condition) return 'Unknown';

  if (condition.status === 'True') {
    return 'Ready';
  }
  if (condition.status === 'False') {
    return 'NotReady';
  }
  return 'Unknown';
}

function nodePoolLabel(node: k8s.V1Node): string {
  const labels = node.metadata?.labels ?? {};
  // AKS sets this label on every node: kubernetes.azure.com/agentpool
  return (
    labels['kubernetes.azure.com/agentpool'] ?? labels.agentpool ?? 'unknown'
  );
}

// ─── Core mapping function ────────────────────────────────────────────────────

/**
 * Build a complete pod-to-node map for the target cluster.
 *
 * Algorithm:
 *   1. List all nodes (requires nodes/get,list ClusterRole)
 *   2. List all pods across all namespaces (requires pods/get,list ClusterRole)
 *   3. Group pods by pod.spec.nodeName
 *   4. Enrich each node with its pod list
 *   5. Capture pods with no matching node (should never happen, safety net)
 */
export async function buildNodePodMap(
  clusterName: string,
  logger: LoggerService,
  kubeConfigBase64?: string,
  subscriptionId?: string,
  resourceGroup?: string,
): Promise<NodePodMap> {
  let resolvedKubeConfigBase64 = kubeConfigBase64;
  if (!resolvedKubeConfigBase64 && subscriptionId && resourceGroup) {
    try {
      resolvedKubeConfigBase64 = await fetchAksUserKubeConfigBase64(
        subscriptionId,
        resourceGroup,
        clusterName,
        logger,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Re-throw authorization errors — the local kubeconfig fallback cannot
      // help when Azure rejects us with 401/403, and falling back produces a
      // misleading KUBECONFIG_HTTP_PROTOCOL_NOT_ALLOWED error instead of the
      // real AKS_CREDENTIALS_RBAC_MISSING one.
      if (/401|403|AuthorizationFailed/i.test(message)) {
        throw err;
      }
      logger.warn(
        `[aksK8s] Falling back to default kubeconfig for cluster="${clusterName}" because Azure credential fetch failed: ${message}`,
      );
      // Continue without explicit kubeconfig: buildKubeConfig will try
      // KUBECONFIG/default file, then in-cluster service account.
    }
  }

  const kc = buildKubeConfig(clusterName, resolvedKubeConfigBase64);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const fetchedAt = new Date().toISOString();

  logger.info(`[aksK8s] Fetching nodes and pods for cluster="${clusterName}"`);

  // Parallel fetch of nodes + pods
  const [nodeRes, podRes] = await Promise.all([
    coreApi.listNode(),
    coreApi.listPodForAllNamespaces(),
  ]);

  const rawNodes = nodeRes.items ?? [];
  const rawPods = podRes.items ?? [];

  logger.info(
    `[aksK8s] Fetched ${rawNodes.length} nodes, ${rawPods.length} pods for cluster="${clusterName}"`,
  );

  // Build pod summaries indexed by node name
  const podsByNode = new Map<string, PodSummary[]>();
  const unmappedPods: PodSummary[] = [];

  for (const pod of rawPods) {
    const nodeName = pod.spec?.nodeName ?? '';
    const summary: PodSummary = {
      namespace: pod.metadata?.namespace ?? 'unknown',
      name: pod.metadata?.name ?? 'unknown',
      phase: pod.status?.phase ?? 'Unknown',
      nodeName,
      containers: (pod.spec?.containers ?? []).map(c => ({
        name: c.name,
        image: c.image ?? 'unknown',
        resources: mapContainerResources(c.resources),
      })),
      labels: pod.metadata?.labels ?? {},
      createdAt: pod.metadata?.creationTimestamp?.toISOString() ?? '',
    };

    if (!nodeName) {
      unmappedPods.push(summary);
      continue;
    }

    const existing = podsByNode.get(nodeName);
    if (existing) {
      existing.push(summary);
    } else {
      podsByNode.set(nodeName, [summary]);
    }
  }

  // Build enriched node list
  const nodes: NodeWithPods[] = rawNodes.map(node => {
    const name = node.metadata?.name ?? 'unknown';
    const labels = node.metadata?.labels ?? {};
    return {
      nodeName: name,
      nodePool: nodePoolLabel(node),
      instanceType:
        labels['node.kubernetes.io/instance-type'] ??
        labels['beta.kubernetes.io/instance-type'] ??
        'unknown',
      region:
        labels['topology.kubernetes.io/region'] ??
        labels['failure-domain.beta.kubernetes.io/region'] ??
        'unknown',
      status: nodeStatus(node),
      allocatableCpu:
        (node.status?.allocatable as Record<string, string> | undefined)?.cpu ??
        'unknown',
      allocatableMemory:
        (node.status?.allocatable as Record<string, string> | undefined)
          ?.memory ?? 'unknown',
      totalPods: podsByNode.get(name)?.length ?? 0,
      pods: podsByNode.get(name) ?? [],
    };
  });

  return { clusterName, fetchedAt, nodes, unmappedPods };
}

/**
 * List nodes only (lighter call — no pod data).
 * Useful for the lifecycle manager to check node readiness before scaling.
 */
export async function listClusterNodes(
  clusterName: string,
  logger: LoggerService,
  kubeConfigBase64?: string,
  subscriptionId?: string,
  resourceGroup?: string,
): Promise<NodeWithPods[]> {
  const map = await buildNodePodMap(
    clusterName,
    logger,
    kubeConfigBase64,
    subscriptionId,
    resourceGroup,
  );
  return map.nodes;
}
