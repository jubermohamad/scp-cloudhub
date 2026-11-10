/**
 * backstageClient.ts
 *
 * Thin HTTP client for reading schedules and cluster state from the
 * Backstage Cost Automation API, and for writing execution results back
 * so the UI can show last-action feedback.
 */

import { ClusterSchedule, ManagedCluster } from './types';

const BASE_URL = (process.env.BACKSTAGE_URL ?? '').replace(/\/$/, '');

async function backstageFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = process.env.BACKSTAGE_API_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const schedulerKey = process.env.SCHEDULER_API_KEY;
  if (schedulerKey) headers['X-Scheduler-Key'] = schedulerKey;

  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Backstage API ${path} returned HTTP ${res.status}: ${await res.text()}`,
    );
  }
  return res.json() as Promise<T>;
}

/** All schedules currently stored in Backstage. */
export async function fetchSchedules(): Promise<ClusterSchedule[]> {
  const data = await backstageFetch<{
    schedules: ClusterSchedule[];
    exportedAt: string;
  }>('/api/cost-automation/azure/aks/schedules');
  return data.schedules;
}

/** Current power state of all onboarded clusters. */
export async function fetchManagedClusters(): Promise<ManagedCluster[]> {
  const data = await backstageFetch<{ clusters: ManagedCluster[] }>(
    '/api/cost-automation/azure/aks/managed',
  );
  return data.clusters;
}

/**
 * Fetch the live power state of a single cluster from Backstage,
 * which in turn calls the ARM API for a fresh read.
 * Returns null if the request fails (caller should fall back to cached state).
 */
export async function fetchLivePowerState(
  clusterName: string,
  subscriptionId: string,
  resourceGroup: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ subscriptionId, resourceGroup });
    const data = await backstageFetch<{
      clusterName: string;
      powerState: string;
      refreshedAt: string;
    }>(
      `/api/cost-automation/azure/aks/${encodeURIComponent(
        clusterName,
      )}/powerstate?${params}`,
    );
    return data.powerState ?? null;
  } catch {
    return null;
  }
}

/** Record a stop/start execution result in Backstage for UX feedback. */
export async function recordExecution(
  clusterName: string,
  payload: {
    action: 'STOP' | 'START';
    result: 'SUCCESS' | 'FAILURE';
    cron?: string;
    timezone?: string;
    reason?: string;
    errorMessage?: string;
    initiatedBy?: string;
  },
): Promise<void> {
  await backstageFetch(
    `/api/cost-automation/azure/aks/${encodeURIComponent(
      clusterName,
    )}/execution`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}
