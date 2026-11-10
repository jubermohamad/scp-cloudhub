/**
 * costAutomationTypes.ts
 *
 * Canonical TypeScript types for all Cost Automation API contracts.
 * Used by the backend plugin, service modules, and frontend fetch clients.
 *
 * Sections:
 *   A – Azure AKS resource types (discovery / node pools)
 *   B – Kubernetes data plane types (nodes / pods / mapping)
 *   C – Lifecycle action types (start / stop / downsize + dry-run)
 *   D – Onboarding types (existing, extended)
 *   E – API request / response envelopes
 */

// ═══════════════════════════════════════════════════════════════════════════
// A – Azure AKS resource types
// ═══════════════════════════════════════════════════════════════════════════

/** Environments supported by cost automation. */
export type AksEnvironment = 'dev' | 'qa';

/** AKS auth mode — determines how RBAC binding is applied. */
export type AksAuthMode = 'local' | 'azureRBAC' | 'unknown';

/** Summarised view of a single AKS cluster (from Azure Management API). */
export interface AksClusterSummary {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  kubernetesVersion: string;
  provisioningState: string; // Succeeded | Creating | Updating | Deleting
  powerState: 'Running' | 'Stopped' | 'Unknown';
  authMode: AksAuthMode;
  fqdn: string | null;
  tags: Record<string, string>;
}

/** Type of AKS node pool. */
export type NodePoolMode = 'System' | 'User';

/** A single AKS agent pool (node pool). */
export interface AksNodePool {
  name: string;
  mode: NodePoolMode;
  vmSize: string;
  count: number;
  minCount: number | null;
  maxCount: number | null;
  autoscalingEnabled: boolean;
  osDiskSizeGB: number;
  provisioningState: string;
  powerState: 'Running' | 'Stopped' | 'Unknown';
  nodeLabels: Record<string, string>;
  nodeTaints: string[];
}

/** Full cluster detail including node pools. */
export interface AksClusterDetail extends AksClusterSummary {
  nodePools: AksNodePool[];
}

// ═══════════════════════════════════════════════════════════════════════════
// B – Kubernetes data plane types
// ═══════════════════════════════════════════════════════════════════════════

/** Resource requests/limits for a container. */
export interface ContainerResources {
  cpuRequest: string | null;
  memoryRequest: string | null;
  cpuLimit: string | null;
  memoryLimit: string | null;
}

/** Summary of a single pod. */
export interface PodSummary {
  namespace: string;
  name: string;
  phase: string; // Running | Pending | Succeeded | Failed | Unknown
  nodeName: string;
  containers: {
    name: string;
    image: string;
    resources: ContainerResources;
  }[];
  labels: Record<string, string>;
  createdAt: string;
}

/** A Kubernetes node with its scheduled pods. */
export interface NodeWithPods {
  nodeName: string;
  nodePool: string; // maps to AksNodePool.name via node label
  instanceType: string; // node.metadata.labels['node.kubernetes.io/instance-type']
  region: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  allocatableCpu: string;
  allocatableMemory: string;
  totalPods: number;
  pods: PodSummary[];
}

/** Full pod-to-node mapping result. */
export interface NodePodMap {
  clusterName: string;
  fetchedAt: string;
  nodes: NodeWithPods[];
  /** Pods whose nodeName is not in the node list (shouldn't happen, but captured). */
  unmappedPods: PodSummary[];
}

// ═══════════════════════════════════════════════════════════════════════════
// C – Lifecycle action types
// ═══════════════════════════════════════════════════════════════════════════

/** The set of lifecycle operations the cost automation engine can perform. */
export type LifecycleAction = 'start' | 'stop' | 'downsize';

/** Target scope for a lifecycle action. */
export interface LifecycleTarget {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  /** Optional: scope action to a specific node pool. Defaults to all user pools. */
  nodePoolName?: string;
}

/** Request body for POST /lifecycle. */
export interface LifecycleActionRequest {
  target: LifecycleTarget;
  action: LifecycleAction;
  /**
   * When true, include System-mode node pools in node-pool lifecycle plans
   * (for example downsize). Defaults to false.
   */
  includeSystemNodePools?: boolean;
  /**
   * When true, the backend validates and plans the action but does NOT execute it.
   * Returns the same response shape with `dryRun: true` and `applied: false`.
   */
  dryRun: boolean;
}

/** Per-node-pool result of a lifecycle action. */
export interface NodePoolActionResult {
  nodePoolName: string;
  mode: NodePoolMode;
  action: LifecycleAction;
  previousCount: number;
  targetCount: number;
  applied: boolean;
  reason: string | null;
}

/** Full response from POST /lifecycle. */
export interface LifecycleActionResult {
  clusterName: string;
  action: LifecycleAction;
  dryRun: boolean;
  applied: boolean;
  executedAt: string;
  nodePools: NodePoolActionResult[];
  /** Summary message suitable for UI display. */
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// D – Onboarding types
// ═══════════════════════════════════════════════════════════════════════════

export type OnboardingStatus = 'ONBOARDED' | 'PENDING' | 'FAILED';

export type OnboardingCapability = 'start' | 'stop' | 'downsize';

export interface OnboardedCluster {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  environment: AksEnvironment;
  /** Whether lifecycle actions may include System-mode node pools. */
  includeSystemNodePools?: boolean;
  authMode: AksAuthMode;
  powerState: 'Running' | 'Stopped' | 'Unknown';
  status: OnboardingStatus;
  capabilities: OnboardingCapability[];
  onboardedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// E – API request / response envelopes
// ═══════════════════════════════════════════════════════════════════════════

/** Standard error body returned by all cost automation endpoints. */
export interface ApiError {
  error: string;
  details?: string;
}

/** GET /azure/aks/discover */
export interface DiscoverClustersResponse {
  subscriptionId: string;
  resourceGroup: string | null;
  clusters: AksClusterSummary[];
  fetchedAt: string;
}

/** GET /azure/aks/:clusterName/nodepools */
export interface NodePoolsResponse {
  clusterName: string;
  nodePools: AksNodePool[];
  fetchedAt: string;
}

/** GET /azure/aks/:clusterName/pods */
export type NodePodMapResponse = NodePodMap;

/** GET /azure/aks/validate */
export interface ValidationCheck {
  label: string;
  passed: boolean;
}
export interface ValidateClusterResponse {
  checks: ValidationCheck[];
  powerState?: 'Running' | 'Stopped' | 'Unknown';
}

/** POST /azure/aks/onboard */
export interface OnboardClusterRequest {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  environment: AksEnvironment;
  includeSystemNodePools?: boolean;
}
export interface OnboardClusterResponse {
  message: string;
  cluster: OnboardedCluster;
}

/** GET /azure/aks/managed */
export interface ManagedClustersResponse {
  clusters: OnboardedCluster[];
}

/** DELETE /azure/aks/:clusterName/offboard */
export interface OffboardClusterResponse {
  message: string;
  clusterName: string;
  offboardedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// F – Schedule types (weekly stop/start automation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single scheduled action (stop or start).
 * - dayOfWeek: JS convention 0 = Sunday … 6 = Saturday
 * - time:      "HH:MM" in the cluster's local timezone
 * - cron:      standard 5-field cron expression (minute hour * * dayOfWeek)
 *              computed by the backend from dayOfWeek + time and stored for
 *              the Azure Function executor to consume.
 */
export interface ScheduleEntry {
  /** Day of the week (0 = Sun, 1 = Mon, …, 5 = Fri, 6 = Sat). */
  dayOfWeek: number;
  /** Local time as "HH:MM" (24-hour). */
  time: string;
  /** Standard 5-field cron expression, e.g. "0 20 * * 5". */
  cron: string;
}

/**
 * Weekly recurring schedule for a managed cluster.
 * Backstage persists this; an external Azure Function reads it and executes
 * the actual AKS stop/start — Backstage itself never triggers the action.
 */
export interface ClusterSchedule {
  clusterName: string;
  /** IANA timezone name, e.g. "Asia/Kolkata", "UTC", "America/New_York". */
  timezone: string;
  /** When to stop the cluster each week, or null if stop is not scheduled. */
  stop: ScheduleEntry | null;
  /** When to start the cluster each week, or null if start is not scheduled. */
  start: ScheduleEntry | null;
  /** When false the schedule is persisted but the executor must skip it. */
  enabled: boolean;
  updatedAt: string;
  /** Last automated action executed by the Azure Function scheduler. */
  lastAction: 'STOP' | 'START' | null;
  /** ISO timestamp of the last automated execution. */
  lastExecutedAt: string | null;
  /** Outcome of the last automated execution. */
  lastActionResult: 'SUCCESS' | 'FAILURE' | null;

  // ── Pause ──────────────────────────────────────────────────────────────
  /**
   * When true the Azure Function scheduler skips this cluster every tick.
   * The cluster remains onboarded; the schedule is preserved.
   * Active overrides still fire even while paused.
   */
  paused: boolean;

  // ── Holiday calendar ───────────────────────────────────────────────────
  /**
   * Named holiday calendar. The scheduler will skip on matched dates.
   * Supported: IN_PUBLIC_HOLIDAYS, UK_PUBLIC_HOLIDAYS,
   *            US_PUBLIC_HOLIDAYS, NL_PUBLIC_HOLIDAYS
   * Null = no holiday awareness.
   */
  holidayCalendar: string | null;

  // ── Override / emergency stop ──────────────────────────────────────────
  /**
   * Emergency action. Set via POST /azure/aks/:clusterName/schedule/override.
   * When active (overrideExpiresAt is in the future) the scheduler applies
   * this action on the next tick, bypassing schedule, pause, and holiday.
   * Cleared automatically after one successful execution.
   */
  overrideAction: 'START' | 'STOP' | null;

  /** ISO 8601 UTC timestamp when the override expires. */
  overrideExpiresAt: string | null;
}

/** POST /azure/aks/:clusterName/schedule */
export interface UpsertScheduleRequest {
  timezone?: string;
  stop?: { dayOfWeek: number; time: string } | null;
  start?: { dayOfWeek: number; time: string } | null;
  enabled?: boolean;
  holidayCalendar?: string | null;
}
export interface UpsertScheduleResponse {
  message: string;
  schedule: ClusterSchedule;
}

/** PATCH /azure/aks/:clusterName/schedule/pause */
export interface PauseScheduleRequest {
  paused: boolean;
}
export interface PauseScheduleResponse {
  message: string;
  clusterName: string;
  paused: boolean;
  updatedAt: string;
}

/** POST /azure/aks/:clusterName/schedule/override */
export interface OverrideScheduleRequest {
  /** The emergency action to execute on the next timer tick. */
  action: 'START' | 'STOP';
  /**
   * How long (in minutes) the override should remain active.
   * Defaults to 60. The Azure Function will clear it after the first
   * successful execution regardless of expiry.
   */
  durationMinutes?: number;
}
export interface OverrideScheduleResponse {
  message: string;
  clusterName: string;
  overrideAction: 'START' | 'STOP';
  overrideExpiresAt: string;
}

/** DELETE /azure/aks/:clusterName/schedule/override — returns 204 No Content */

// ═══════════════════════════════════════════════════════════════════════════
// G – Schedule execution log types
// ═══════════════════════════════════════════════════════════════════════════

/** Action type performed by the scheduler. */
export type ScheduledAction = 'STOP' | 'START';

/** Outcome of a scheduled execution. */
export type ExecutionResult = 'SUCCESS' | 'FAILURE';

/**
 * Single row from schedule_execution_log.
 * Written by the Azure Function after each stop/start attempt.
 */
export interface ScheduleExecutionLogEntry {
  id: number;
  clusterName: string;
  action: ScheduledAction;
  result: ExecutionResult;
  /** Cron expression that triggered this execution. */
  cron: string | null;
  /** IANA timezone used when evaluating the schedule. */
  timezone: string | null;
  /** Human-readable description of why the action was taken. */
  reason: string | null;
  /** Error message when result is FAILURE. */
  errorMessage: string | null;
  /** Identity of the caller (e.g. "aks-scheduler-azure-function"). */
  initiatedBy: string;
  /** ISO timestamp when the action was executed. */
  executedAt: string;
}

/**
 * POST /azure/aks/:clusterName/execution
 * Called by the Azure Function after each stop/start attempt to persist the result.
 */
export interface RecordExecutionRequest {
  action: ScheduledAction;
  result: ExecutionResult;
  cron?: string;
  timezone?: string;
  reason?: string;
  errorMessage?: string;
  /** Defaults to "aks-scheduler-azure-function" if omitted. */
  initiatedBy?: string;
}
export interface RecordExecutionResponse {
  message: string;
  entry: ScheduleExecutionLogEntry;
}

/**
 * GET /azure/aks/:clusterName/execution-log
 * Returns up to `limit` most recent execution log entries for the cluster.
 */
export interface GetExecutionLogResponse {
  clusterName: string;
  entries: ScheduleExecutionLogEntry[];
}
