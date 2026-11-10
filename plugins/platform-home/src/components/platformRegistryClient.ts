export interface RegistrySummary {
  platforms: number;
  clusters: number;
  namespaces: number;
  deployments: number;
}

export interface Environment {
  id: string;
  platformName: string | null;
  environmentName: string;
  environmentType: string | null;
  status: 'active' | 'pending' | 'inactive' | 'error';
}

export interface Cluster {
  id: string;
  environmentId: string | null;
  environmentName: string;
  region: string;
  discoveredAt: string | null;
  lastSyncedAt: string | null;
}

export interface Deployment {
  id: string;
  deploymentTargetId: string;
  deployedAt: string | null;
}

interface ListResult<T> {
  items: T[];
}

interface CloudAccount {
  id: string;
  cloudProvider: string;
  accountIdentifier: string;
}

interface DiscoveredCluster {
  clusterName: string;
  clusterType: string;
  provider: string;
  region: string;
  resourceGroup: string | null;
  accountScope: string | null;
  clusterEndpoint: string;
  kubernetesVersion: string;
  nodeCount: number;
  alreadyRegistered: boolean;
}

interface ListArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

type BackendFetch = (
  pluginId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

const PLUGIN_ID = 'platform-registry';

function toQuery(args?: ListArgs): string {
  if (!args) return '';
  const params = new URLSearchParams();
  if (args.page !== undefined) params.set('page', String(args.page));
  if (args.pageSize !== undefined) params.set('pageSize', String(args.pageSize));
  if (args.search) params.set('search', args.search);
  if (args.sortBy) params.set('sortBy', args.sortBy);
  if (args.sortOrder) params.set('sortOrder', args.sortOrder);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function createPlatformRegistryApi(
  backendFetch: BackendFetch,
  persona?: string,
) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await backendFetch(PLUGIN_ID, path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(persona ? { 'x-cloudhub-persona': persona } : {}),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed with ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    getSummary: () => request<RegistrySummary>('/summary'),
    listCloudAccounts: (args?: ListArgs) =>
      request<ListResult<CloudAccount>>(`/cloud-accounts${toQuery(args)}`),
    discoverClusters: (cloudAccountId: string, provider = 'AZURE') =>
      request<{ items: DiscoveredCluster[] }>('/discovery/clusters', {
        method: 'POST',
        body: JSON.stringify({ cloudAccountId, provider }),
      }),
    listEnvironments: (args?: ListArgs) =>
      request<ListResult<Environment>>(`/environments${toQuery(args)}`),
    listClusters: (args?: ListArgs) =>
      request<ListResult<Cluster>>(`/clusters${toQuery(args)}`),
    listDeployments: (args?: ListArgs) =>
      request<ListResult<Deployment>>(`/deployments${toQuery(args)}`),
  };
}