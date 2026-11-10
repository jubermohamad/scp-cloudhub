/**
 * Shared cost automation API contract types for frontend/backend boundaries.
 */

export type AksEnvironment = 'dev' | 'qa';
export type AksAuthMode = 'local' | 'azureRBAC' | 'unknown';
export type NodePoolMode = 'System' | 'User';

export interface ContainerResources {
  cpuRequest: string | null;
  memoryRequest: string | null;
  cpuLimit: string | null;
  memoryLimit: string | null;
}

export interface PodSummary {
  namespace: string;
  name: string;
  phase: string;
  nodeName: string;
  containers: {
    name: string;
    image: string;
    resources: ContainerResources;
  }[];
  labels: Record<string, string>;
  createdAt: string;
}

export interface NodeWithPods {
  nodeName: string;
  nodePool: string;
  instanceType: string;
  region: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  allocatableCpu: string;
  allocatableMemory: string;
  totalPods: number;
  pods: PodSummary[];
}

export type LifecycleAction = 'start' | 'stop' | 'downsize';

export interface NodePoolActionResult {
  nodePoolName: string;
  mode: NodePoolMode;
  action: LifecycleAction;
  previousCount: number;
  targetCount: number;
  applied: boolean;
  reason: string | null;
}

export interface LifecycleActionResult {
  clusterName: string;
  action: LifecycleAction;
  dryRun: boolean;
  applied: boolean;
  executedAt: string;
  nodePools: NodePoolActionResult[];
  summary: string;
}

export type OnboardingStatus = 'ONBOARDED' | 'PENDING' | 'FAILED';
export type OnboardingCapability = 'start' | 'stop' | 'downsize';

export interface OnboardedCluster {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  environment: AksEnvironment;
  includeSystemNodePools?: boolean;
  authMode: AksAuthMode;
  powerState: 'Running' | 'Stopped' | 'Unknown';
  status: OnboardingStatus;
  capabilities: OnboardingCapability[];
  onboardedAt: string;
}

export interface ScheduleEntry {
  dayOfWeek: number;
  time: string;
  cron: string;
}

export interface ClusterSchedule {
  clusterName: string;
  timezone: string;
  stop: ScheduleEntry | null;
  start: ScheduleEntry | null;
  enabled: boolean;
  updatedAt: string;
  lastAction: 'STOP' | 'START' | null;
  lastExecutedAt: string | null;
  lastActionResult: 'SUCCESS' | 'FAILURE' | null;
  paused: boolean;
  holidayCalendar: string | null;
  overrideAction: 'START' | 'STOP' | null;
  overrideExpiresAt: string | null;
}
