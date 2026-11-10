import type {
  Agent,
  AgentDetail,
  AgentInput,
  ApiErrorBody,
  AuditEvent,
  Cluster,
  ClusterDetail,
  ClusterInput,
  ClusterSyncResult,
  Dashboard,
  Dataset,
  DatasetInput,
  DatasetLineage,
  Destination,
  DestinationInput,
  DestinationTestResult,
  DestinationType,
  ExportInput,
  ExportPackage,
  ExportProfile,
  FilterOptions,
  Job,
  JobDetail,
  ListQuery,
  Me,
  Page,
  RuntimeConfig,
} from './types';

type BackendFetch = (
  pluginId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

const PLUGIN_ID = 'data-export';

export class DataExportApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'DataExportApiError';
  }
}

/** Serialises a list query, dropping empty values. */
export function toQueryString(query: ListQuery = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function createDataExportApi(backendFetch: BackendFetch) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await backendFetch(PLUGIN_ID, path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody &
      Record<string, unknown>;
    if (!response.ok) {
      throw new DataExportApiError(
        response.status,
        body.error ?? `Request failed with HTTP ${response.status}`,
        body.details ?? [],
      );
    }
    return body as T;
  }

  /** For downloads (manifest, logs): returns the raw response body as text. */
  async function requestText(path: string): Promise<string> {
    const response = await backendFetch(PLUGIN_ID, path);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      throw new DataExportApiError(
        response.status,
        body.error ?? `Request failed with HTTP ${response.status}`,
      );
    }
    return response.text();
  }

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    me: () => request<Me>('/me'),
    runtimeConfig: () => request<RuntimeConfig>('/runtime-config'),
    dashboard: () => request<Dashboard>('/dashboard'),
    filterOptions: () => request<FilterOptions>('/filters'),

    listDatasets: (query?: ListQuery) =>
      request<Page<Dataset>>(`/datasets${toQueryString(query)}`),
    getDataset: (id: string) => request<Dataset>(`/datasets/${id}`),
    getDatasetLineage: (id: string) =>
      request<DatasetLineage>(`/datasets/${id}/lineage`),
    registerDataset: (input: Partial<DatasetInput>) =>
      request<Dataset>('/datasets', json('POST', input)),
    updateDataset: (id: string, patch: Partial<DatasetInput>) =>
      request<Dataset>(`/datasets/${id}`, json('PUT', patch)),

    listDestinations: (query?: ListQuery) =>
      request<Page<Destination>>(`/destinations${toQueryString(query)}`),
    createDestination: (input: DestinationInput) =>
      request<Destination>('/destinations', json('POST', input)),
    updateDestination: (
      id: string,
      patch: { name?: string; enabled?: boolean; owner?: string | null },
    ) => request<Destination>(`/destinations/${id}`, json('PUT', patch)),
    testDestination: (
      body:
        | { id: string }
        | { type: DestinationType; configuration: Record<string, string> },
    ) =>
      request<DestinationTestResult>('/destinations/test', json('POST', body)),

    listClusters: (query?: ListQuery) =>
      request<Page<Cluster>>(`/clusters${toQueryString(query)}`),
    getCluster: (id: string) => request<ClusterDetail>(`/clusters/${id}`),
    createCluster: (input: ClusterInput) =>
      request<ClusterDetail>('/clusters', json('POST', input)),
    updateCluster: (id: string, input: ClusterInput) =>
      request<ClusterDetail>(`/clusters/${id}`, json('PUT', input)),
    /** Marks the cluster retired. Clusters are never physically deleted. */
    retireCluster: (id: string) =>
      request<ClusterDetail>(`/clusters/${id}/retire`, json('POST')),
    restoreCluster: (id: string) =>
      request<ClusterDetail>(`/clusters/${id}/restore`, json('POST')),
    syncClusters: () =>
      request<ClusterSyncResult>('/clusters/sync', json('POST')),

    listAgents: (query?: ListQuery) =>
      request<Page<Agent>>(`/agents${toQueryString(query)}`),
    getAgent: (id: string) => request<AgentDetail>(`/agents/${id}`),
    registerAgent: (clusterId: string, input: AgentInput) =>
      request<Agent>(`/clusters/${clusterId}/agents`, json('POST', input)),
    updateAgent: (id: string, input: Partial<AgentInput>) =>
      request<Agent>(`/agents/${id}`, json('PUT', input)),
    deleteAgent: (id: string) =>
      request<void>(`/agents/${id}`, { method: 'DELETE' }),

    listPackages: () => request<ExportPackage[]>('/packages'),

    listExports: (query?: ListQuery) =>
      request<Page<ExportProfile>>(`/exports${toQueryString(query)}`),
    getExport: (id: string) => request<ExportProfile>(`/exports/${id}`),
    createExport: (input: ExportInput) =>
      request<ExportProfile>('/exports', json('POST', input)),
    updateExport: (id: string, input: ExportInput) =>
      request<ExportProfile>(`/exports/${id}`, json('PUT', input)),
    setExportEnabled: (id: string, enabled: boolean) =>
      request<ExportProfile>(
        `/exports/${id}/enabled`,
        json('PUT', { enabled }),
      ),
    deleteExport: (id: string) =>
      request<void>(`/exports/${id}`, { method: 'DELETE' }),
    /** Queues one job per dataset immediately. Returns the created jobs. */
    runExportNow: (id: string) =>
      request<Job[]>(`/exports/${id}/run`, json('POST')),

    listJobs: (query?: ListQuery) =>
      request<Page<Job>>(`/jobs${toQueryString(query)}`),
    getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
    retryJob: (id: string) =>
      request<JobDetail>(`/jobs/${id}/retry`, json('POST')),
    cancelJob: (id: string) =>
      request<JobDetail>(`/jobs/${id}/cancel`, json('POST')),
    downloadManifest: (id: string) => requestText(`/jobs/${id}/manifest`),
    downloadLogs: (id: string) => requestText(`/jobs/${id}/logs`),

    listAudit: (query?: ListQuery) =>
      request<Page<AuditEvent>>(`/audit${toQueryString(query)}`),
  };
}

export type DataExportApi = ReturnType<typeof createDataExportApi>;
