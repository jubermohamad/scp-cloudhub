/**
 * types.ts
 *
 * Local type mirrors for the Backstage API contracts consumed by this
 * Azure Function. Keep in sync with packages/backend/src/costAutomationTypes.ts.
 */

export interface ScheduleEntry {
  cron: string;
  dayOfWeek: number; // 0 = Sun … 6 = Sat
  time: string; // "HH:MM" local
}

export interface ClusterSchedule {
  clusterName: string;
  timezone: string;
  stop: ScheduleEntry | null;
  start: ScheduleEntry | null;
  enabled: boolean;
  updatedAt: string;
  /** When true, all scheduled actions are suspended until re-enabled. */
  paused?: boolean;
  /** Emergency override action to execute on the next tick. */
  overrideAction?: 'START' | 'STOP' | null;
  /** ISO timestamp after which the override is considered expired. */
  overrideExpiresAt?: string | null;
}

export interface ManagedCluster {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  environment: string;
  powerState: 'Running' | 'Stopped' | 'Unknown';
  status: string;
}
