export type DevelopmentProfileStatus = 'ACTIVE' | 'DEPRECATED' | 'DISABLED';
export type DeveloperEnvironmentType =
  | 'SHARED_TEAM'
  | 'DEVELOPER'
  | 'EPHEMERAL_PR';
export type DeveloperEnvironmentStatus =
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
  workspaceConfiguration?: {
    type: DeveloperWorkspaceType;
    image: {
      registry: string;
      repository: string;
      tag: string;
    };
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
  } | null;
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
  image: {
    registry: string;
    repository: string;
    tag: string;
  };
  tools: string[];
  extensions: string[];
}

export interface SriCatalogComponent {
  id: string;
  product: 'SRI' | 'NetReveal';
  domain: string;
  displayName: string;
  componentType: string;
  language: { name: string };
  runtime: { name: string; version: string | null };
  developmentProfile: { id: string; version: string };
  repository: {
    provider: 'github';
    organization: string | null;
    name: string | null;
    url: string | null;
    defaultBranch: string | null;
  };
  deployment: { type: 'kubernetes' };
  dependencies: string[];
  owner: { team: string };
  status: 'active' | 'deprecated' | 'disabled';
}

export interface ResourceProfile {
  id: 'SMALL' | 'MEDIUM' | 'LARGE';
  displayName: string;
  description: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  storageQuota?: string | null;
}

export interface DeveloperEnvironmentOptions {
  product: 'SRI';
  environmentTypes: Array<{ id: 'SHARED_TEAM'; displayName: string }>;
  resourceProfiles: ResourceProfile[];
  components: SriCatalogComponent[];
  developmentProfiles: DevelopmentProfile[];
  clusters: Array<{
    id: string;
    clusterName: string;
    environment: string;
    region: string;
    subscriptionId: string;
  }>;
}

export interface DeveloperEnvironmentRecord {
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
  environmentType: DeveloperEnvironmentType;
  resourceProfile: ResourceProfile['id'];
  platformServices: {
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
  };
  securityBaseline: {
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
  };
  status: DeveloperEnvironmentStatus;
  statusMessage: string | null;
  failureReason: string | null;
  workspaceType: DeveloperWorkspaceType;
  workspaceStatus: DeveloperWorkspaceStatus;
  workspaceStatusMessage: string | null;
  workspaceProfileVersion: string;
  workspaceImageRegistry: string;
  workspaceImageRepository: string;
  workspaceImageTag: string;
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
  workspaceStatus: DeveloperEnvironmentStatus;
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

export interface CiWorkflowRecord {
  environmentId: string;
  componentId: string;
  repository: {
    provider: string;
    organization: string | null;
    name: string | null;
    url: string | null;
  };
  branchPolicy: {
    mode: 'allow-list';
    allowedBranches: string[];
  };
  workflowStatus: CiWorkflowStatus;
  workflowStatusMessage: string | null;
  ciWorkflowPath: string;
  deployWorkflowPath: string;
  buildProfile: {
    adapter: 'node' | 'python' | 'java' | 'scala' | 'database';
    packageManager?: string;
    dependencyCommand?: string;
    lintCommand?: string;
    buildCommand?: string;
    testCommand?: string;
  };
  container: {
    dockerfile: string;
    context: string;
  };
  deployment: {
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
  };
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
  executorType: 'aks-helm';
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
