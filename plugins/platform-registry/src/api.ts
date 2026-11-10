import type {
  Application,
  CloudAccount,
  Cluster,
  Deployment,
  DeploymentEvent,
  DeploymentTarget,
  DiscoveredCluster,
  DiscoveryPreflightResult,
  Environment,
  ListResult,
  Namespace,
  OnboardPlatformInput,
  RegistrySummary,
  Platform,
  PlatformDetail,
} from './types';

interface ListArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  provider?: string;
}

const PLUGIN_ID = 'platform-registry';

type BackendFetch = (
  pluginId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

function toQuery(args?: ListArgs): string {
  if (!args) return '';
  const params = new URLSearchParams();
  if (args.page !== undefined) params.set('page', String(args.page));
  if (args.pageSize !== undefined)
    params.set('pageSize', String(args.pageSize));
  if (args.search) params.set('search', args.search);
  if (args.sortBy) params.set('sortBy', args.sortBy);
  if (args.sortOrder) params.set('sortOrder', args.sortOrder);
  if (args.provider) params.set('provider', args.provider);
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
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
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
    listPlatforms: (args?: ListArgs) =>
      request<ListResult<Platform>>(`/platforms${toQuery(args)}`),
    listCustomers: () =>
      request<Array<{ customerName: string; customerId?: string; platformCode?: string }>>(
        '/customers',
      ),
    listCustomerClusters: (customer: string, environment?: string) =>
      request<Array<Partial<Cluster> & { clusterName: string; environment: string }>>(
        `/customers/${encodeURIComponent(customer)}/clusters${
          environment ? `?environment=${encodeURIComponent(environment)}` : ''
        }`,
      ),
    getPlatformDetail: (id: string) =>
      request<PlatformDetail>(`/platforms/${id}/detail`),
    listCloudAccounts: (args?: ListArgs) =>
      request<ListResult<CloudAccount>>(`/cloud-accounts${toQuery(args)}`),
    listEnvironments: (args?: ListArgs) =>
      request<ListResult<Environment>>(`/environments${toQuery(args)}`),
    listClusters: (args?: ListArgs) =>
      request<ListResult<Cluster>>(`/clusters${toQuery(args)}`),
    listOnboardedClusters: (args?: ListArgs) =>
      request<ListResult<Cluster>>(`/clusters/onboarded${toQuery(args)}`),
    listNamespaces: (args?: ListArgs) =>
      request<ListResult<Namespace>>(`/namespaces${toQuery(args)}`),
    listDeploymentTargets: (args?: ListArgs) =>
      request<ListResult<DeploymentTarget>>(
        `/deployment-targets${toQuery(args)}`,
      ),
    listApplications: (args?: ListArgs) =>
      request<ListResult<Application>>(`/applications${toQuery(args)}`),
    listDeployments: (args?: ListArgs) =>
      request<ListResult<Deployment>>(`/deployments${toQuery(args)}`),

    // ---- create ----
    createPlatform: (body: Record<string, unknown>) =>
      request<Platform>('/platforms', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createCloudAccount: (body: Record<string, unknown>) =>
      request<CloudAccount>('/cloud-accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createEnvironment: (body: Record<string, unknown>) =>
      request<Environment>('/environments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createCluster: (body: Record<string, unknown>) =>
      request<Cluster>('/clusters', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createNamespace: (body: Record<string, unknown>) =>
      request<Namespace>('/namespaces', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createDeploymentTarget: (body: Record<string, unknown>) =>
      request<DeploymentTarget>('/deployment-targets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createApplication: (body: Record<string, unknown>) =>
      request<Application>('/applications', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createDeployment: (body: Record<string, unknown>) =>
      request<Deployment>('/deployments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    // ---- deployment workflow ----
    transitionDeployment: (
      id: string,
      body: { status: string; note?: string; actor?: string },
    ) =>
      request<Deployment>(`/deployments/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    rollbackDeployment: (
      id: string,
      body?: { actor?: string; note?: string },
    ) =>
      request<Deployment>(`/deployments/${id}/rollback`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    listDeploymentEvents: (id: string) =>
      request<{ items: DeploymentEvent[] }>(`/deployments/${id}/events`),

    // ---- delete ----
    deletePlatform: (id: string) =>
      request<void>(`/platforms/${id}`, { method: 'DELETE' }),
    deleteCloudAccount: (id: string) =>
      request<void>(`/cloud-accounts/${id}`, { method: 'DELETE' }),
    deleteEnvironment: (id: string) =>
      request<void>(`/environments/${id}`, { method: 'DELETE' }),
    deleteCluster: (id: string) =>
      request<void>(`/clusters/${id}`, { method: 'DELETE' }),
    deleteNamespace: (id: string) =>
      request<void>(`/namespaces/${id}`, { method: 'DELETE' }),
    deleteDeploymentTarget: (id: string) =>
      request<void>(`/deployment-targets/${id}`, { method: 'DELETE' }),
    deleteApplication: (id: string) =>
      request<void>(`/applications/${id}`, { method: 'DELETE' }),

    // ---- workflows ----
    onboardPlatform: (body: OnboardPlatformInput) =>
      request<{ platform: Platform }>('/onboarding/platform', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    discoverClusters: (cloudAccountId: string, provider?: string) =>
      request<{ items: DiscoveredCluster[] }>('/discovery/clusters', {
        method: 'POST',
        body: JSON.stringify({ cloudAccountId, provider }),
      }),
    discoveryPreflight: (cloudAccountId: string, provider?: string) =>
      request<DiscoveryPreflightResult>('/discovery/preflight', {
        method: 'POST',
        body: JSON.stringify({ cloudAccountId, provider }),
      }),
    importClusters: (body: {
      platformId: string;
      environmentId?: string | null;
      cloudAccountId?: string | null;
      clusters: DiscoveredCluster[];
    }) =>
      request<{ imported: number }>('/discovery/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };
}

export type PlatformRegistryApi = ReturnType<typeof createPlatformRegistryApi>;
