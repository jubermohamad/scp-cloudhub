export type PersonaRole =
  | 'platform-admin'
  | 'app-engineering'
  | 'professional-services'
  | 'readonly';

export type DevelopmentProfileStatus = 'ACTIVE' | 'DEPRECATED' | 'DISABLED';

export type WorkspaceMode = 'SHARED_TEAM' | 'DEVELOPER' | 'EPHEMERAL_PR';

export type WorkspaceLifecycleStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'STARTING'
  | 'STOPPING'
  | 'STOPPED'
  | 'VALIDATING'
  | 'PROVISIONING'
  | 'READY'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED';

// Backward compatible aliases during developer-environment -> workspace migration.
export type DeveloperEnvironmentType = WorkspaceMode;
export type DeveloperEnvironmentStatus = WorkspaceLifecycleStatus;

export type ResourceProfileId = 'SMALL' | 'MEDIUM' | 'LARGE';

export type DeveloperWorkspaceType = 'devcontainer';

export type DevContainerStatus =
  | 'NOT_CONFIGURED'
  | 'PLATFORM_MANAGED'
  | 'CUSTOM'
  | 'OUTDATED'
  | 'INVALID'
  | 'CONFLICT';

export type DeveloperWorkspaceStatus =
  | 'NOT_CONFIGURED'
  | 'CONFIGURING'
  | 'READY'
  | 'OUTDATED'
  | 'INVALID'
  | 'CUSTOM'
  | 'FAILED';

export type WorkspaceConnectionStatus = 'UNAVAILABLE' | 'READY' | 'FAILED';

export type WorkspaceConnectionMode = 'manual-vscode-kubernetes';

export type WorkspaceConnectionSessionStatus =
  | 'NOT_CONFIGURED'
  | 'READY'
  | 'FAILED';

export type WorkspaceConnectionSessionMode = 'cloudhub-session-url';

export type CiWorkflowStatus =
  | 'NOT_CONFIGURED'
  | 'PLATFORM_MANAGED'
  | 'OUTDATED'
  | 'CUSTOM'
  | 'INVALID'
  | 'CONFLICT'
  | 'FAILED';

export type BuildAdapterType =
  | 'node'
  | 'python'
  | 'java'
  | 'scala'
  | 'database';

export type DeploymentExecutorType = 'aks-helm';

export type ApplicationDeploymentStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'BUILDING'
  | 'BUILD_FAILED'
  | 'IMAGE_PUBLISHED'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'VERIFYING'
  | 'READY'
  | 'FAILED'
  | 'ROLLED_BACK'
  | 'CANCELLED';

export interface DevelopmentWorkspaceImageRef {
  registry: string;
  repository: string;
  tag: string;
}

export interface DevelopmentProfileWorkspaceConfig {
  type: DeveloperWorkspaceType;
  image: DevelopmentWorkspaceImageRef;
  remoteUser: string;
  workspaceFolder: string;
  tools: string[];
  vscode: {
    extensions: string[];
    settings: Record<string, unknown>;
  };
  environmentVariables: Record<string, string>;
  features: Record<string, unknown>;
  postCreateCommand?: string | null;
}

export interface PortalDeploymentDiffStatusView {
  deploymentId: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  currentStep: string;
  statusMessage: string | null;
  failureReason: string | null;
  correlationStatus: 'PENDING' | 'CORRELATED' | 'AMBIGUOUS' | 'FAILED';
  correlationMessage: string | null;
  updatedAt: string;
  startedAt: string;
  completedAt: string | null;
}

export interface DevelopmentProfile {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  runtime: string;
  runtimeVersion: string | null;
  languages: string[];
  buildTools: string[];
  platformTools: string[];
  ideConfiguration: Record<string, unknown>;
  deploymentType: string;
  packaging: string;
  observabilityConfiguration: Record<string, unknown>;
  securityConfiguration: Record<string, unknown>;
  workspaceConfiguration?: DevelopmentProfileWorkspaceConfig | null;
  status: DevelopmentProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTemplate {
  id: string;
  displayName: string;
  description: string;
  runtime: string;
  runtimeVersion: string | null;
  developmentProfileId: string;
  developmentProfileVersion: string;
  workspaceType: DeveloperWorkspaceType;
  image: DevelopmentWorkspaceImageRef;
  tools: string[];
  extensions: string[];
}

export interface ResourceProfile {
  id: ResourceProfileId;
  displayName: string;
  description: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  storageQuota?: string | null;
}

export interface WorkspacePlatformServices {
  containerRegistry: { enabled: boolean; status: string };
  secrets: { enabled: boolean; provider: string; status: string };
  ingress: { enabled: boolean; status: string };
  observability: {
    logs: boolean;
    metrics: boolean;
    traces: boolean;
    status: string;
  };
  dependencies: {
    postgresql: boolean;
    kafka: boolean;
    redis: boolean;
    objectStorage: boolean;
  };
}

export type DeveloperEnvironmentPlatformServices = WorkspacePlatformServices;

export interface WorkspaceSecurityBaseline {
  rbac: string;
  resourceQuota: string;
  networkPolicy: string;
  podSecurity: string;
  workloadIdentity: string;
  keyVaultIntegration: string;
  acrAccess: string;
  ingressDns: string;
  observability: string;
  labels: Record<string, string>;
}

export type DeveloperEnvironmentSecurityBaseline = WorkspaceSecurityBaseline;

export interface WorkspaceRecord {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  productId: string;
  componentId: string;
  componentDisplayName: string;
  ownerTeam: string;
  developmentProfileId: string;
  developmentProfileVersion: string;
  sourceRepositoryProvider: string;
  sourceRepositoryOrganization: string | null;
  sourceRepositoryName: string | null;
  sourceRepositoryUrl: string | null;
  sourceBranch: string;
  cloudProvider: string;
  runtimePlatform: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  namespaceStatus: string;
  environmentType: WorkspaceMode;
  resourceProfile: ResourceProfileId;
  platformServices: WorkspacePlatformServices;
  securityBaseline: WorkspaceSecurityBaseline;
  status: WorkspaceLifecycleStatus;
  statusMessage: string | null;
  failureReason: string | null;
  workspaceType: DeveloperWorkspaceType;
  workspaceStatus: DeveloperWorkspaceStatus;
  workspaceStatusMessage: string | null;
  workspaceProfileVersion: string;
  workspaceImageRegistry: string;
  workspaceImageRepository: string;
  workspaceImageTag: string;
  workspacePodName: string | null;
  workspacePvcName: string | null;
  workspaceServiceAccountName: string | null;
  workspaceDevContainerStatus: DevContainerStatus;
  workspaceLastValidatedAt: string | null;
  latestDeploymentId?: string | null;
  latestDeploymentStatus?: ApplicationDeploymentStatus | null;
  latestDeploymentCreatedAt?: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  lastTransitionAt: string;
}

export interface WorkspaceAuditLogRecord {
  id: string;
  actorRef: string;
  role: PersonaRole;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type DeveloperEnvironmentRecord = WorkspaceRecord;

export interface DevContainerDefinition {
  name: string;
  image: string;
  remoteUser: string;
  workspaceFolder: string;
  customizations: {
    vscode: {
      extensions: string[];
      settings: Record<string, unknown>;
    };
  };
  containerEnv: Record<string, string>;
  features: Record<string, unknown>;
  postCreateCommand?: string;
}

export interface DeveloperWorkspaceRecord {
  environmentId: string;
  componentId: string;
  componentDisplayName: string;
  developmentProfileId: string;
  developmentProfileVersion: string;
  repository: {
    provider: string;
    organization: string | null;
    name: string | null;
    url: string | null;
  };
  branch: string;
  workspaceType: DeveloperWorkspaceType;
  workspaceStatus: DeveloperWorkspaceStatus;
  workspaceStatusMessage: string | null;
  workspaceProfileVersion: string;
  devContainerStatus: DevContainerStatus;
  devContainerPath: string;
  devContainerImage: string;
  devContainer: DevContainerDefinition;
  recommendedExtensions: string[];
  workspaceFolder: string;
  platformCapabilities: string[];
  setupInstructions: string[];
  repositoryIntegration: {
    mode: 'unavailable' | 'read-only' | 'simulated';
    canReadRepository: boolean;
    canCreatePullRequest: boolean;
    reason?: string;
  };
  workspaceLastValidatedAt: string | null;
}

export interface WorkspaceConnectionRecord {
  environmentId: string;
  workspaceStatus: WorkspaceLifecycleStatus;
  connectionStatus: WorkspaceConnectionStatus;
  connectionMode: WorkspaceConnectionMode;
  targetCluster: string;
  namespace: string;
  podName: string | null;
  containerName: string;
  portForwardCommand: string | null;
  vscodeAttachHint: string;
  reason?: string;
  instructions: string[];
  updatedAt: string;
}

export interface WorkspaceConnectionSessionRecord {
  environmentId: string;
  sessionStatus: WorkspaceConnectionSessionStatus;
  sessionMode: WorkspaceConnectionSessionMode;
  launchUrl: string | null;
  expiresAt: string | null;
  reason?: string;
  instructions: string[];
  updatedAt: string;
}

export interface GenerateWorkspaceResult {
  workspace: DeveloperWorkspaceRecord;
  generatedFiles: Array<{
    path: string;
    content: string;
    mediaType: 'application/json';
  }>;
  repositoryUpdate: {
    mode: 'manual';
    instructions: string[];
  };
}

export interface BuildProfileConfig {
  adapter: BuildAdapterType;
  packageManager?: string;
  dependencyCommand?: string;
  lintCommand?: string;
  buildCommand?: string;
  testCommand?: string;
}

export interface ContainerProfileConfig {
  dockerfile: string;
  context: string;
}

export interface DeploymentProfileConfig {
  packaging: 'helm';
  branchPolicy: {
    mode: 'allow-list';
    allowedBranches: string[];
  };
  service?: {
    port?: number | null;
    targetPort?: number | null;
  };
  health?: {
    readinessPath?: string | null;
    livenessPath?: string | null;
  };
}

export interface CiWorkflowRecord {
  environmentId: string;
  componentId: string;
  repository: {
    provider: string;
    organization: string | null;
    name: string | null;
    url: string | null;
  };
  branchPolicy: DeploymentProfileConfig['branchPolicy'];
  workflowStatus: CiWorkflowStatus;
  workflowStatusMessage: string | null;
  ciWorkflowPath: string;
  deployWorkflowPath: string;
  buildProfile: BuildProfileConfig;
  container: ContainerProfileConfig;
  deployment: DeploymentProfileConfig;
  generatedFiles: Array<{
    path: string;
    content: string;
    mediaType: 'text/yaml';
  }>;
  repositoryIntegration: {
    mode: 'unavailable' | 'read-only' | 'simulated';
    canReadRepository: boolean;
    canCreatePullRequest: boolean;
    reason?: string;
  };
  workflowLastValidatedAt: string | null;
}

export interface GenerateCiWorkflowResult {
  workflow: CiWorkflowRecord;
  repositoryUpdate: {
    mode: 'manual';
    instructions: string[];
  };
}

export interface DeploymentPipelineStage {
  id: 'SOURCE' | 'BUILD' | 'TEST' | 'SECURITY' | 'IMAGE' | 'DEPLOY' | 'VERIFY';
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  message?: string;
}

export type WorkflowRunStatus = 'queued' | 'in_progress' | 'completed';
export type WorkflowConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | null;

export interface WorkflowStepInfo {
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  number: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface WorkflowJobInfo {
  id: number;
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  startedAt?: string | null;
  completedAt?: string | null;
  steps: WorkflowStepInfo[];
}

export interface WorkflowRunInfo {
  runId: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowConclusion;
  htmlUrl: string;
  jobs: WorkflowJobInfo[];
}

export interface ApplicationDeploymentRecord {
  id: string;
  developerEnvironmentId: string;
  componentId: string;
  repository: string;
  branch: string;
  commitSha: string;
  imageRepository: string;
  imageTag: string;
  imageDigest: string | null;
  clusterId: string;
  clusterName: string;
  namespace: string;
  releaseName: string;
  deploymentStrategy: string;
  executorType: DeploymentExecutorType;
  status: ApplicationDeploymentStatus;
  statusMessage: string | null;
  failureReason: string | null;
  endpointUrl: string | null;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  workflowRun?: WorkflowRunInfo | null;
  pipelineStages: DeploymentPipelineStage[];
  requestedBy: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceRequest {
  componentId: string;
  source: {
    repository?: {
      provider: string;
      organization?: string | null;
      name?: string | null;
      url?: string | null;
    };
    branch: string;
  };
  runtime: {
    cloudProvider: string;
    platform: string;
    clusterId?: string;
  };
  environmentType: WorkspaceMode;
  resourceProfile: ResourceProfileId;
  platformServices?: Partial<WorkspacePlatformServices>;
}

export type CreateDeveloperEnvironmentRequest = CreateWorkspaceRequest;

export interface ClusterMetadata {
  id: string;
  tenantId: string | null;
  clusterName: string;
  region: string;
  subscriptionId: string;
  cloudProvider: string;
  environment: string;
  kubernetesVersion: string;
  status: string;
  resourceGroup?: string;
  tags?: Record<string, string>;
  createdAt: string;
}

export interface NodePoolMetadata {
  id: string;
  clusterId: string;
  nodepoolName: string;
  vmSize: string;
  nodeCount: number;
  mode: string;
}

export interface PlatformDeploymentRecord {
  id: string;
  clusterId: string;
  platformVersion: string;
  deploymentStatus: string;
  deployedAt: string;
}

export interface TenantOverlayRecord {
  id: string;
  tenantId: string;
  clusterId: string;
  overlayVersion: string;
  deploymentStatus: string;
  deployedBy: string;
  deployedAt: string;
}

export interface DiscoveredCluster {
  clusterName: string;
  region: string;
  resourceGroup: string;
  kubernetesVersion: string;
  nodePools: number;
  environment: string;
  tags: Record<string, string>;
  status: string;
  subscriptionId: string;
}

export interface ProvisionRequest {
  clusterName: string;
  subscriptionId: string;
  region: string;
  environment: string;
  tenantId?: string;
  nodePools: Array<{
    name: string;
    vmSize: string;
    nodeCount: number;
    mode: string;
  }>;
}

export interface GitOpsCommitResult {
  repo: string;
  branch: string;
  commitSha: string;
  pipelineUrl: string;
  mode: 'simulated' | 'github-api';
}

// ─── Deployment Portal (self-service Helmfile deploy wizard) ──────────────────

export type PortalDeploymentStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'DISPATCHING'
  | 'QUEUED'
  | 'DEPLOYING'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED';

export interface PortalDeploymentInstance {
  appName: string;
  appInstance: string;
  helmfilePath: string;
  metadata: Record<string, string>;
}

export type PortalDeploymentInstanceStatus = 'EXISTING' | 'NEW';

export interface PortalDeploymentJob {
  id: string;
  deploymentId: string;
  githubJobId: number;
  jobName: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastLogLine: number;
  updatedAt: string;
}
export interface PortalDeploymentRecord {
  id: string;
  deploymentName: string;
  application: string;
  instanceName: string;
  customer: string;
  environment: string;
  cluster: string;
  subscriptionId: string;
  resourceGroup: string;
  chartVersion: string;
  aiStoreIntegration: boolean;
  configureSkupper?: boolean;
  triggerFailover?: boolean;
  actionValidation?: boolean;
  acceptance?: boolean;
  namespace: string;
  helmfilePath: string;
  helmfileContent: string | null;
  branch: string;
  commitSha: string | null;
  prUrl: string | null;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  status: PortalDeploymentStatus;
  currentStep: string;
  statusMessage: string | null;
  failureReason: string | null;
  mode: 'simulated' | 'github-api';
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt: string | null;
  workflowRepository: string | null;
  workflowId: string | null;
  workflowRef: string | null;
  workflowInputs: Record<string, string>;
  dispatchInitiatedAt: string | null;
  workflowRunAttempt: number | null;
  workflowStatus: string | null;
  workflowConclusion: string | null;
  correlationStatus: 'PENDING' | 'CORRELATED' | 'AMBIGUOUS' | 'FAILED' | null;
  correlationMessage: string | null;
  correlationAttempts: number;
  correlationDeadline: string | null;
  lastLogLine: number;
  instanceMode: 'auto' | 'existing' | 'new';
  instanceStatus: PortalDeploymentInstanceStatus;
}

export interface CreatePortalDeploymentInput {
  id?: string;
  application: string;
  instanceName: string;
  customer: string;
  onePasswordVault?: string;
  chartVersion: string;
  aiStoreIntegration: boolean;
  actorRef: string;
  role: PersonaRole;
  start?: boolean;
  environment?: string;
  clusterName?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  configureSkupper?: boolean;
  triggerFailover?: boolean;
  actionValidation?: boolean;
  acceptance?: boolean;
  instanceMode?: 'auto' | 'existing' | 'new';
  helmfilePath?: string;
  helmfileContent?: string;
}

export interface ApprovePortalDeploymentInput {
  id: string;
  approverRef: string;
  role: PersonaRole;
  note?: string;
}

export interface RejectPortalDeploymentInput {
  id: string;
  approverRef: string;
  role: PersonaRole;
  note?: string;
}

export type DeploymentApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DeploymentApprovalRecord {
  id: string;
  deploymentId: string | null;
  application: string;
  instanceName: string;
  customer: string;
  environment: string;
  cluster: string;
  subscriptionId: string;
  resourceGroup: string;
  chartVersion: string;
  status: DeploymentApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentApprovalInput {
  application: string;
  instanceName: string;
  customer: string;
  chartVersion: string;
  requestedBy: string;
  role: PersonaRole;
  environment?: string;
  cluster?: string;
  subscriptionId?: string;
  resourceGroup?: string;
}

export interface PortalDeploymentApplicationOption {
  id: string;
  appName: string;
  displayName: string;
  description: string;
  chartVersions: string[];
  supportsAiStoreIntegration: boolean;
}

export interface PortalDeploymentOptions {
  applications: PortalDeploymentApplicationOption[];
  environments: string[];
  vaults: string[];
  customersByVault: Record<string, string[]>;
  customers: string[];
  repository: string;
  branch: string;
}

export interface PortalSecretRefSource {
  path: string;
  line: number;
}

export type PortalSecretRefStatus =
  | 'READY'
  | 'MISSING'
  | 'PLACEHOLDER'
  | 'EMPTY'
  | 'ERROR';

export interface PortalSecretRefFinding {
  reference: string;
  normalizedReference: string;
  vault: string;
  item: string;
  section: string | null;
  field: string;
  status: PortalSecretRefStatus;
  message: string;
  sources: PortalSecretRefSource[];
}

export interface PortalFilePlaceholderFinding {
  path: string;
  line: number;
  token: string;
}

export interface PortalSecretReadinessReport {
  ready: boolean;
  checkedAt: string;
  cached: boolean;
  cacheExpiresAt: string;
  application: string;
  instanceName: string;
  clusterName?: string;
  includePipelineRefs: boolean;
  filesScanned: string[];
  referencesDiscovered: number;
  findings: PortalSecretRefFinding[];
  missing: PortalSecretRefFinding[];
  placeholders: PortalSecretRefFinding[];
  filePlaceholders: PortalFilePlaceholderFinding[];
  summary: string;
}

export type DeploymentMode =
  | 'FRESH_INSTALL'
  | 'UPGRADE'
  | 'ROLLBACK'
  | 'CONFIGURATION_UPDATE';

export interface DeploymentModeDetection {
  mode: DeploymentMode;
  isFreshInstall: boolean;
  /** Whether apps/<application>/<instanceName> already exists in the scripts repo. */
  appInstanceExists: boolean;
  /**
   * Whether the target Kubernetes namespace already exists on the target
   * cluster. Null when no cluster was selected yet, so the check couldn't
   * run — this is not itself evidence of a fresh install.
   */
  namespaceExists: boolean | null;
  /** Current `<namespace>__helm_chart_version` value read from 1Password's pipeline_refs, if any. */
  currentChartVersion: string | null;
  targetChartVersion: string | null;
  requiredSteps: string[];
}

export interface PortalSecretProvisionStatusView {
  operationId: string;
  application: string;
  instanceName: string;
  customer: string;
  clusterName?: string;
  workflowRepository: string;
  workflowId: string;
  workflowRef: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  message: string;
  sections: string[];
  fieldsGenerated: string[];
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  readiness: PortalSecretReadinessReport | null;
  /**
   * Post-write, cache-bypassed read-back of every field that was just
   * generated — proof the value actually landed in 1Password, not just that
   * the write call returned 200.
   */
  verifiedFields?: Array<{
    field: string;
    section: string;
    vault: string;
    item: string;
    status: PortalSecretRefStatus;
    verified: boolean;
  }>;
}

export type PortalSecretFieldType =
  | 'password'
  | 'certificate'
  | 'key'
  | 'license'
  | 'base64'
  | 'pipeline_ref'
  | 'other';

export interface PortalSecretFieldInfo extends PortalSecretRefFinding {
  type: PortalSecretFieldType;
}

export interface PortalSecretUpdateRequest {
  application: string;
  instanceName: string;
  customer: string;
  vault: string;
  item: string;
  section: string | null;
  field: string;
  value: string;
  actorRef: string;
  role: PersonaRole;
}

export interface PortalSecretUpdateResult {
  success: boolean;
  reference: string;
  message: string;
  readiness: PortalSecretReadinessReport | null;
}

export interface PortalHelmfilePreview {
  path: string;
  namespace: string;
  content: string;
  clusterName?: string;
  environment?: string;
  instanceStatus?: PortalDeploymentInstanceStatus;
}

export interface PortalDeploymentStatusView {
  deploymentId: string;
  workflowRunId: string | null;
  status: PortalDeploymentStatus;
  currentStep: string;
  workflowRunUrl: string | null;
  statusMessage: string | null;
  failureReason: string | null;
  updatedAt: string;
  completedAt: string | null;
  // Carried on the status view so a client tracking a live deployment can
  // render the commit and execution mode without re-fetching the record.
  commitSha: string | null;
  mode: string;
  // Canonical https://{app}-{customer}-{suffix}.symphonyai.dev|cloud URL.
  applicationUrl: string | null;
}

// ─── GPU Compute (self-service GPU VM provisioning) ────────────────────────

// The only Azure VM SKUs CloudHub allows users to request. Backed by the
// azure-ai-research-vm Terraform module (SymphonySensa/scp-azure-terraform-modules,
// feature/juber-ai-vm branch only).
export type GpuSkuId = 'a100' | 'h100';

export interface GpuSkuOption {
  id: GpuSkuId;
  label: string;
  vmSize: string;
  gpuFamily: string;
}

export type GpuInstanceStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'TRIGGERING_WORKFLOW'
  | 'PROVISIONING'
  | 'READY'
  | 'STARTING'
  | 'STOPPING'
  | 'STOPPED'
  | 'START_FAILED'
  | 'STOP_FAILED'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED'
  | 'DELETE_FAILED';

export interface GpuInstanceRecord {
  id: string;
  name: string;
  gpuSku: GpuSkuId;
  vmSize: string;
  region: string;
  resourceGroup: string;
  subscriptionId: string;
  subnetId: string;
  environment: string;
  costCenter?: string;
  owner: string;
  businessJustification: string;
  leaseDuration: string;
  terraformRepository: string;
  terraformBranch: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  mode: 'simulated' | 'terraform-cloud';
  status: GpuInstanceStatus;
  statusMessage: string | null;
  failureReason: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
}

export interface CreateGpuInstanceInput {
  name: string;
  gpuSku: GpuSkuId;
  region: string;
  subscriptionId: string;
  vnetName: string;
  subnetName: string;
  owner: string;
  businessJustification: string;
  leaseDuration: string;
  actorRef: string;
  role: PersonaRole;
}

export interface GpuQuotaCheckResult {
  gpuSku: GpuSkuId;
  region: string;
  vmSize: string;
  gpuFamily: string;
  currentUsage: number;
  limit: number;
  available: number;
  requested: number;
  sufficient: boolean;
  message: string;
}

export interface GpuComputeOptions {
  skus: GpuSkuOption[];
  leaseDurations: string[];
  onboardedVnets: GpuOnboardedVnet[];
  resourceGroup: string;
  terraformRepository: string;
  terraformBranch: string;
}

export interface GpuOnboardedVnet {
  subscriptionId: string;
  resourceGroup: string;
  vnetName: string;
  region: string;
}

export interface GpuNetworkProfileDiagnosticEntry {
  name: string;
  source: 'sku' | 'generic-fallback';
  network: {
    subscriptionId: string;
    resourceGroup: string;
    vnetName: string;
    subnetName: string;
    region: string;
  };
}

export interface GpuNetworkProfileDiagnostics {
  bySku: Record<GpuSkuId, GpuNetworkProfileDiagnosticEntry[]>;
  allProfileNames: string[];
}

export interface GpuNetworkSubnet {
  id?: string;
  name: string;
  addressRange: string;
  totalAddresses?: number;
  usedAddresses?: number;
  availableIpAddresses: number;
  lowCapacity?: boolean;
}

export interface GpuInstanceEvent {
  id: string;
  instanceId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ─── Low-cost self-service test VMs ───────────────────────────────────────

export type TestVmStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'READY'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED'
  | 'DELETE_FAILED';

export interface TestVmSizeOption {
  id: string;
  label: string;
  vmSize: string;
  vcpus: number;
  memoryGb: number;
  hourlyUsd: number;
  monthlyUsd: number;
}

export interface TestVmRecord {
  id: string;
  name: string;
  vmSize: string;
  region: string;
  resourceGroup: string;
  subnetId: string;
  environment: string;
  owner: string;
  terraformRepository: string;
  terraformBranch: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  mode: 'simulated' | 'terraform-cloud';
  status: TestVmStatus;
  statusMessage: string | null;
  failureReason: string | null;
  monthlyUsd: number;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTestVmInput {
  name: string;
  vmSize?: string;
  owner?: string;
  actorRef: string;
  role: PersonaRole;
}

export interface TestVmOptions {
  sizes: TestVmSizeOption[];
  defaultSize: string;
  resourceGroup: string;
  region: string;
  environment: string;
  subnetId: string;
  terraformRepository: string;
  terraformBranch: string;
  configured: boolean;
}

// ─── Azure foundation resources (Terraform module backed) ─────────────────

export type AzureFoundationResourceType =
  | 'resource-group'
  | 'vnet-subnet'
  | 'key-vault'
  | 'storage-account';

export type AzureFoundationProvisionStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'READY'
  | 'FAILED';

export interface AzureFoundationResourceRecord {
  id: string;
  resourceType: AzureFoundationResourceType;
  name: string;
  provider: 'azure';
  modulePath: string;
  terraformRepository: string;
  terraformBranch: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  mode: 'simulated' | 'terraform-cloud';
  status: AzureFoundationProvisionStatus;
  statusMessage: string | null;
  failureReason: string | null;
  properties: Record<string, unknown>;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAzureFoundationResourceInput {
  resourceType: AzureFoundationResourceType;
  name: string;
  properties: Record<string, unknown>;
  actorRef: string;
  role: PersonaRole;
}

export interface AzureFoundationResourceOption {
  resourceType: AzureFoundationResourceType;
  modulePath: string;
  defaults: Record<string, unknown>;
}

export interface AzureFoundationOptions {
  provider: 'azure';
  terraformRepository: string;
  terraformBranch: string;
  resources: AzureFoundationResourceOption[];
}

// ─── GPU Authorization (Entra ID group-based access control) ──────────────

// Future-proofed role model — only GPU_USER (and optionally GPU_ADMIN, when
// GPU_ADMIN_GROUP_ID is configured) are enforced today. GPU_APPROVER is
// reserved for a future approval workflow.
export type GpuRole = 'GPU_ADMIN' | 'GPU_USER' | 'GPU_APPROVER' | 'NONE';

export interface GpuAuthorizationResult {
  authorized: boolean;
  role: GpuRole;
  groupId: string | null;
  source: 'token' | 'graph' | 'unconfigured';
}
