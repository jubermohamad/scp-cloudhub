/*
 * Client-side contract for the Data Export Hub API (`/api/data-export`).
 * The backend implementation is plugins/data-export-hub-backend; keep both in step.
 * Enumerations are upper-case codes; the UI maps them to labels.
 */

export type Environment = 'PRODUCTION' | 'STAGING' | 'SIT' | 'DEVELOPMENT';
export type Schedule =
  | 'RUN_ONCE'
  | 'ONCE'
  | 'HOURLY'
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'CUSTOM_CRON';
export type ExportFormat = 'PARQUET' | 'CSV' | 'TSV' | 'JSON';
export type ExportMode = 'FULL' | 'INCREMENTAL' | 'SNAPSHOT';
export type Compression = 'NONE' | 'GZIP' | 'SNAPPY';
export type WatermarkStrategy = 'GREATER_THAN' | 'GREATER_OR_EQUAL';
/** Only ADLS Gen2 and SFTP have delivery providers. Other types may exist in old data but cannot be created. */
export type DestinationType = 'ADLS_GEN2' | 'SFTP';
export type DestinationStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';
export type JobStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'ASSIGNED'
  | 'RUNNING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export type JobTrigger = 'SCHEDULE' | 'MANUAL' | 'RETRY';
/** Derived from heartbeat age: < 5 min HEALTHY, 5–10 WARNING, 10–15 CRITICAL, > 15 or never OFFLINE. */
export type Health = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
export type SourceProduct =
  | 'NETREVEAL'
  | 'SRI'
  | 'AISTORE'
  | 'EUREKA'
  | 'SENSAAI_SANCTIONS';
export type DatasetCategory =
  | 'ALERTS'
  | 'CASES'
  | 'CUSTOMERS'
  | 'CDD'
  | 'WORKFLOW'
  | 'SCREENING'
  | 'AUDIT'
  | 'REFERENCE_DATA';
export type Classification =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED';

/* ---------- common ---------- */

/** Query accepted by every list endpoint. Unknown filters are ignored; unknown sort fields are rejected (400). */
export interface ListQuery {
  /** Zero-based. */
  page?: number;
  /** 1–200, default 25. */
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  tenantId?: string;
  clusterId?: string;
  environment?: Environment;
  status?: string;
  /** Catalog dataset UUID. */
  datasetId?: string;
  ownerId?: string;
  /** ISO timestamps bounding the entity's primary date (jobs: createdAt; audit: occurredAt). */
  from?: string;
  to?: string;
  /** Entity-specific extras, e.g. exportId on /jobs, includeRetired on /clusters. */
  [extra: string]: string | number | boolean | undefined;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error?: string;
  details?: string[];
}

export interface Me {
  actor: string;
  isPlatformAdmin: boolean;
  tenantAdminOf: string[];
  tenantMemberOf: string[];
}

export interface RuntimeConfig {
  storage: {
    accountName: string;
    resourceId: string | null;
    clientId: string | null;
    configured: boolean;
    source: 'env' | 'resource-id' | 'default';
  };
}

/** Values for filter drop-downs, scoped to the caller. GET /filters */
export interface FilterOptions {
  tenants: string[];
  clusters: Array<{ id: string; clusterName: string; tenantId: string }>;
  datasets: Array<{ id: string; datasetId: string; displayName: string }>;
  owners: string[];
}

/* ---------- dashboard: GET /dashboard ---------- */

export interface Dashboard {
  generatedAt: string;
  /** Window used by the "top" widgets. */
  windowDays: number;
  kpis: {
    healthyClusters: number;
    registeredClusters: number;
    connectedAgents: number;
    registeredAgents: number;
    configuredExports: number;
    runningExports: number;
    queuedJobs: number;
    completedJobsToday: number;
    failedJobsToday: number;
    datasetsPublished: number;
    destinationsConfigured: number;
    rowsExportedToday: number;
    bytesExportedToday: number;
  };
  clusterHealth: Record<Health, number>;
  /** Today's jobs. RUNNING includes ASSIGNED and UPLOADING; QUEUED includes CREATED. */
  executionActivity: {
    COMPLETED: number;
    RUNNING: number;
    QUEUED: number;
    FAILED: number;
  };
  topDatasets: Array<{
    id: string;
    datasetId: string;
    displayName: string;
    executionCount: number;
    rowsExported: number;
  }>;
  topTenants: Array<{
    tenantId: string;
    exports: number;
    bytesExported: number;
  }>;
  topDestinations: Array<{
    id: string;
    name: string;
    type: string;
    filesDelivered: number;
  }>;
  /** Queue depth samples for the last 24 hours, oldest first. */
  queueDepth: Array<{ capturedAt: string; value: number }>;
}

/* ---------- data catalog: /datasets ---------- */

export interface DatasetColumn {
  name: string;
  type?: string;
  description?: string;
  nullable?: boolean;
  pii?: boolean;
}

export interface Dataset {
  id: string;
  datasetId: string;
  displayName: string;
  businessDescription: string | null;
  sourceProduct: SourceProduct;
  sourceDomain: string | null;
  category: DatasetCategory;
  ownerTeam: string | null;
  supportEmail: string | null;
  classification: Classification;
  containsPii: boolean;
  containsSensitiveData: boolean;
  estimatedDailyVolume: number | null;
  refreshPattern: string | null;
  retentionDays: number | null;
  supportsIncremental: boolean;
  watermarkColumn: string | null;
  watermarkStrategy: string | null;
  primaryKeys: string[];
  sourceTables: string[];
  columnMetadata: DatasetColumn[];
  sampleSchema: Record<string, unknown> | null;
  sqlTemplate: string | null;
  /** UUIDs of datasets this one is derived from. */
  dependsOn: string[];
  enabled: boolean;
  updatedAt: string;
}

/** GET /datasets/{id}/lineage — the dataset plus every upstream and downstream dataset reachable from it. */
export interface DatasetLineage {
  nodes: Array<{
    id: string;
    datasetId: string;
    displayName: string;
    category: DatasetCategory;
    enabled: boolean;
  }>;
  /** `from` is the upstream dataset, `to` the dataset that depends on it. */
  edges: Array<{ from: string; to: string }>;
}

/** POST /datasets body, and PUT /datasets/{id} with every field optional except datasetId (not editable). */
export type DatasetInput = Omit<Dataset, 'id' | 'updatedAt'>;

/* ---------- destinations: /destinations ---------- */

export interface Destination {
  id: string;
  type: DestinationType;
  name: string;
  /**
   * ADLS_GEN2: accountName, fileSystem (default data-export-hub), path (optional prefix). Uses workload identity.
   * SFTP: host, port (default 22), username, remotePath, secretRef (kv://<vault>/<secret>), hostKeyFingerprint (SHA256:...).
   */
  configuration: Record<string, string>;
  enabled: boolean;
  owner: string | null;
  /** null = shared, platform-managed destination; files are still written under tenant/<tenant>/. */
  tenantId: string | null;
  status: DestinationStatus;
  lastTestAt: string | null;
  lastTestMessage: string | null;
  updatedAt: string;
}

export interface DestinationInput {
  type: DestinationType;
  name: string;
  configuration: Record<string, string>;
  owner?: string | null;
  tenantId?: string | null;
}

export interface DestinationTestResult {
  destinationId: string | null;
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  message: string;
  checkedAt: string;
}

/* ---------- clusters and agents: /clusters, /agents ---------- */

export interface Agent {
  id: string;
  agentName: string | null;
  clusterId: string;
  clusterName: string;
  tenantId: string;
  /** Entra object id of the agent's workload identity. */
  identitySubject: string;
  agentVersion: string | null;
  /** Last status the agent reported. */
  reportedStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  health: Health;
  lastSeen: string | null;
  capabilities: Record<string, unknown>;
  createdAt: string;
}

export interface AgentDetail extends Agent {
  /** Most recent heartbeats, newest first (at most 50). */
  heartbeats: Array<{
    heartbeatTime: string;
    status: string;
    version: string | null;
  }>;
}

export interface AgentInput {
  agentName?: string | null;
  identitySubject: string;
}

export interface Cluster {
  id: string;
  clusterName: string;
  subscriptionId: string | null;
  resourceGroup: string | null;
  environment: Environment;
  region: string | null;
  tenantId: string;
  /** Set when the cluster is managed by Platform Registry sync; such clusters are read-only here. */
  platformRegistryId: string | null;
  isRetired: boolean;
  retiredAt: string | null;
  lastSyncedAt: string | null;
  health: Health;
  agentVersion: string | null;
  lastHeartbeat: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClusterDetail extends Cluster {
  agents: Agent[];
}

export interface ClusterInput {
  clusterName: string;
  subscriptionId: string | null;
  resourceGroup: string | null;
  environment: Environment;
  region: string | null;
  tenantId: string;
}

/** POST /clusters/sync result. */
export interface ClusterSyncResult {
  created: number;
  updated: number;
  retired: number;
  restored: number;
  skipped: Array<{ clusterName: string; reason: string }>;
  ranAt: string;
}

/* ---------- export packages: /packages ---------- */

export interface ExportPackage {
  id: string;
  packageCode: string;
  packageName: string;
  description: string;
  datasetIds: string[];
  enabled: boolean;
  createdAt: string;
}

/* ---------- export profiles: /exports ---------- */

export interface ExportProfile {
  id: string;
  name: string;
  tenantId: string;
  customerName?: string | null;
  packageCode?: string | null;
  packageName?: string | null;
  ownerId: string;
  createdBy: string | null;
  clusterId: string;
  clusterName: string;
  environment: Environment;
  namespace: string | null;
  schedule: Schedule;
  cronExpression: string;
  exportMode: ExportMode;
  fileFormat: ExportFormat;
  compression: Compression;
  retentionDays: number | null;
  watermarkStrategy: WatermarkStrategy | null;
  destinationId: string;
  destinationName: string | null;
  destinationType: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: JobStatus | null;
  /** Next fire time computed from the cron expression (UTC). */
  nextRunAt: string | null;
  datasets: Array<{ id: string; datasetId: string; displayName: string }>;
  createdAt: string;
  updatedAt: string;
}

/** POST /exports and PUT /exports/{id}. */
export interface ExportInput {
  name: string;
  tenantId: string;
  customerName?: string | null;
  packageCode?: string | null;
  packageCodes?: string[];
  packageName?: string | null;
  environment: Environment;
  clusterId: string;
  namespace: string | null;
  schedule: Schedule;
  cronExpression?: string;
  exportMode?: ExportMode;
  fileFormat?: ExportFormat;
  /** Default SNAPPY for PARQUET, GZIP otherwise. SNAPPY is only valid for PARQUET. */
  compression?: Compression;
  retentionDays?: number | null;
  /** Required for INCREMENTAL, ignored otherwise. Every dataset must support incremental export. */
  watermarkStrategy?: WatermarkStrategy | null;
  destinationId: string;
  datasetIds: string[];
  enabled?: boolean;
}

/* ---------- jobs (executions): /jobs ---------- */

export interface Job {
  id: string;
  profileId: string;
  exportName: string;
  tenantId: string;
  clusterId: string;
  clusterName: string;
  datasetId: string;
  datasetDisplayName: string;
  status: JobStatus;
  trigger: JobTrigger;
  priority: number;
  scheduledTime: string;
  assignedTime: string | null;
  startedTime: string | null;
  completedTime: string | null;
  durationSeconds: number | null;
  retryCount: number;
  maxRetries: number;
  rowsExported: number | null;
  bytesExported: number | null;
  filesDelivered: number | null;
  errorMessage: string | null;
  assignedAgentName: string | null;
  requestedBy: string | null;
  createdAt: string;
}

export interface JobDetail extends Job {
  watermarkFrom: string | null;
  watermarkTo: string | null;
  outputFiles: Array<{
    name: string;
    path: string;
    sizeBytes: number;
    sha256: string;
    records?: number;
  }>;
  manifest: Record<string, unknown> | null;
  logs: string | null;
}

/* ---------- audit: GET /audit ---------- */

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  tenantId: string | null;
  details: Record<string, unknown>;
}
