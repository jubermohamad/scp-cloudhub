/**
 * Wire contract between the Data Export Hub control plane (CloudHub backend,
 * plugin id `data-export`) and the cluster export agent.
 *
 * Base URL: `${CONTROL_PLANE_URL}/api/data-export/agent`.
 * Auth: `Authorization: Bearer <Entra access token>` obtained with Azure
 * Workload Identity for the scope `${CONTROL_PLANE_SCOPE}` (the CloudHub API
 * app ID URI + `/.default`). The token's subject (the managed identity's
 * object id) must match an agent registered in CloudHub; otherwise every call
 * returns 403. All bodies are JSON.
 *
 * The control plane mirrors these types in
 * plugins/data-export-hub-backend/src/agentProtocol.ts. Change both together.
 */

export const PROTOCOL_VERSION = 1;

export type AgentReportedStatus = 'ONLINE' | 'DEGRADED';
export type ExportMode = 'FULL' | 'INCREMENTAL' | 'SNAPSHOT';
export type FileFormat = 'PARQUET' | 'CSV' | 'TSV' | 'JSON';
export type Compression = 'NONE' | 'GZIP' | 'SNAPPY';
export type WatermarkStrategy = 'GREATER_THAN' | 'GREATER_OR_EQUAL';
export type DestinationType = 'ADLS_GEN2' | 'SFTP';

/* ---------- POST /heartbeat (every heartbeatIntervalSeconds) ---------- */

export interface DestinationCheckResult {
  destinationId: string;
  status: 'HEALTHY' | 'FAILED';
  message: string;
  checkedAt: string;
}

export interface HeartbeatRequest {
  protocolVersion: number;
  agentName: string;
  version: string;
  status: AgentReportedStatus;
  /** Free-form, at most 8 KB of JSON, e.g. formats, providers, kubernetesVersion. */
  capabilities: Record<string, unknown>;
  /** Results of live checks requested by a previous heartbeat response. */
  destinationChecks?: DestinationCheckResult[];
}

export interface DestinationDescriptor {
  id: string;
  type: DestinationType;
  /** Non-secret settings. SFTP `secretRef` is `kv://<vault-name>/<secret-name>`. */
  configuration: Record<string, string>;
}

export interface HeartbeatResponse {
  agentId: string;
  clusterId: string;
  clusterName: string;
  tenantId: string;
  heartbeatIntervalSeconds: number;
  pollIntervalSeconds: number;
  /** Destinations used by this cluster's exports that are due a live health check. */
  destinationsToCheck: DestinationDescriptor[];
}

/* ---------- POST /jobs/claim ---------- */
/* 200 { job } when a QUEUED job for this agent's cluster was assigned to it; 204 when none. */

export interface JobSpec {
  jobId: string;
  /** 1 for the first attempt, incremented on each retry. */
  attempt: number;
  tenantId: string;
  scheduledTime: string;
  profile: {
    id: string;
    name: string;
    packageCode?: string | null;
    packageName?: string | null;
    customerName?: string | null;
    exportMode: ExportMode;
    fileFormat: FileFormat;
    compression: Compression;
    retentionDays: number | null;
    watermarkStrategy: WatermarkStrategy | null;
    namespace: string | null;
  };
  dataset: {
    id: string;
    datasetId: string;
    /** A single read-only SELECT. Never null on a claimed job. */
    sqlTemplate: string;
    watermarkColumn: string | null;
    primaryKeys: string[];
  };
  packageReports?: Array<{
    id: string;
    datasetId: string;
    sqlTemplate: string;
    watermarkColumn: string | null;
    primaryKeys: string[];
  }>;
  /** Last successfully exported watermark for this profile and dataset (INCREMENTAL only). */
  watermark: { lastSuccessValue: string | null };
  destination: DestinationDescriptor;
  /**
   * Relative directory for this job's files, without leading or trailing slash:
   * `tenant/<tenantId>/exports/<profile-slug>/<yyyy>/<mm>/<dd>/<jobId>`.
   * Providers prepend their configured base path.
   */
  outputPrefix: string;
  /** Relative directory holding all of this profile's dated output, used for retention. */
  profilePrefix: string;
}

export interface ClaimResponse {
  job: JobSpec;
}

/* ---------- POST /jobs/{jobId}/progress ---------- */
/* Allowed transitions: ASSIGNED -> RUNNING -> UPLOADING. */

export interface ProgressRequest {
  status: 'RUNNING' | 'UPLOADING';
  rowsExported?: number;
  bytesExported?: number;
  message?: string;
}

export interface ProgressResponse {
  /** false when the job was cancelled or reassigned; the agent must stop and discard output. */
  continue: boolean;
}

/* ---------- POST /jobs/{jobId}/complete ---------- */

export interface DeliveredFile {
  name: string;
  /** Full path at the destination. */
  path: string;
  sizeBytes: number;
  sha256: string;
  records?: number;
}

export interface Manifest {
  customer?: string;
  cluster?: string;
  package?: string;
  runId: string;
  records: number;
  generatedAt?: string;
  manifestVersion?: 1;
  tenant?: string;
  profile?: string;
  profileId?: string;
  dataset?: string;
  attempt?: number;
  status?: 'COMPLETED';
  exportMode?: ExportMode;
  format?: FileFormat;
  compression?: Compression;
  bytes?: number;
  watermark?: { column: string | null; from: string | null; to: string | null };
  startedAt?: string;
  completedAt?: string;
  files: Array<{
    name: string;
    sha256?: string;
    bytes?: number;
    sizeBytes?: number;
    records?: number;
  }>;
  generatedBy?: { agent: string; version: string; cluster: string };
}

export interface CompleteRequest {
  rowsExported: number;
  bytesExported: number;
  files: DeliveredFile[];
  manifest: Manifest;
  /** New watermark (max value of the watermark column exported). null leaves it unchanged. */
  watermarkValue: string | null;
  /** Tail of the job log, at most 64 KB. */
  logs?: string;
}

/* ---------- POST /jobs/{jobId}/fail ---------- */

export interface FailRequest {
  errorMessage: string;
  /** true for transient failures (network, timeouts); false for bad SQL or config. */
  retryable: boolean;
  logs?: string;
}

export interface FailResponse {
  /** true when the control plane re-queued the job for another attempt. */
  willRetry: boolean;
}
