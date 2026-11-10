import type {
  ClusterInventoryItem,
  CloudProvider,
  DiscoveredCluster,
  Tenant,
  TenantDetail,
} from './types';

interface DiscoverArgs {
  cloudProvider: CloudProvider;
  subscriptionId: string;
  resourceGroup?: string;
  region?: string;
  environment?: string;
}

interface ListArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface CreateTenantInput {
  tenantName: string;
  businessUnit?: string;
  cloudProvider: CloudProvider;
  subscriptionId: string;
  regions: string[];
  environments: string[];
}

const PLUGIN_ID = 'tenant-registry';

type BackendFetch = (
  pluginId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export function createTenantRegistryApi(
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
    getTenants: (args: ListArgs = {}) => {
      const params = new URLSearchParams();
      if (args.page !== null && args.page !== undefined)
        params.set('page', String(args.page));
      if (args.pageSize !== null && args.pageSize !== undefined)
        params.set('pageSize', String(args.pageSize));
      if (args.search) params.set('search', args.search);
      if (args.sortBy) params.set('sortBy', args.sortBy);
      if (args.sortOrder) params.set('sortOrder', args.sortOrder);
      return request<{
        items: Tenant[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/tenants${params.toString() ? `?${params.toString()}` : ''}`);
    },
    getTenant: (id: string) => request<TenantDetail>(`/tenants/${id}`),
    createTenant: (input: CreateTenantInput) =>
      request<Tenant>('/tenants', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    deleteTenant: (id: string) =>
      request<{ deleted: string }>(`/tenants/${id}`, { method: 'DELETE' }),

    discoverClusters: (args: DiscoverArgs) => {
      const params = new URLSearchParams({
        cloudProvider: args.cloudProvider,
        subscriptionId: args.subscriptionId,
      });
      if (args.resourceGroup) params.set('resourceGroup', args.resourceGroup);
      if (args.region) params.set('region', args.region);
      if (args.environment) params.set('environment', args.environment);
      return request<{ items: DiscoveredCluster[] }>(
        `/clusters/discover?${params.toString()}`,
      );
    },

    onboardClusters: (payload: {
      tenantId: string;
      cloudProvider: CloudProvider;
      selectedClusterNames: string[];
      discoveredClusters: DiscoveredCluster[];
    }) =>
      request<{
        onboarded: ClusterInventoryItem[];
        failed: Array<{ clusterName: string; reason: string }>;
      }>('/clusters/onboard', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    getClusters: (args: ListArgs = {}) => {
      const params = new URLSearchParams();
      if (args.page !== null && args.page !== undefined)
        params.set('page', String(args.page));
      if (args.pageSize !== null && args.pageSize !== undefined)
        params.set('pageSize', String(args.pageSize));
      if (args.search) params.set('search', args.search);
      if (args.sortBy) params.set('sortBy', args.sortBy);
      if (args.sortOrder) params.set('sortOrder', args.sortOrder);
      return request<{
        items: ClusterInventoryItem[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/clusters${params.toString() ? `?${params.toString()}` : ''}`);
    },
    getCluster: (id: string) =>
      request<ClusterInventoryItem>(`/clusters/${id}`),
    deleteCluster: (id: string) =>
      request<{ deleted: string }>(`/clusters/${id}`, { method: 'DELETE' }),
  };
}
