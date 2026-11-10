import crypto from 'crypto';
import { Pool } from 'pg';
import * as k8s from '@kubernetes/client-node';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import type {
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import {
  SRI_CATALOG_COMPONENTS,
  getSriCatalogComponent,
} from '@internal/plugin-platform-common/backend';
import type {
  ApplicationDeploymentRecord,
  ApplicationDeploymentStatus,
  BuildProfileConfig,
  CiWorkflowRecord,
  CiWorkflowStatus,
  ClusterMetadata,
  CreateDeveloperEnvironmentRequest,
  CreateWorkspaceRequest,
  DevContainerDefinition,
  DevContainerStatus,
  DeploymentPipelineStage,
  DeploymentProfileConfig,
  GenerateCiWorkflowResult,
  DeveloperWorkspaceRecord,
  DeveloperWorkspaceStatus,
  WorkspacePlatformServices,
  WorkspaceRecord,
  WorkspaceAuditLogRecord,
  DeveloperEnvironmentPlatformServices,
  DeveloperEnvironmentRecord,
  DeveloperEnvironmentSecurityBaseline,
  DevelopmentProfileWorkspaceConfig,
  DevelopmentProfile,
  GenerateWorkspaceResult,
  DiscoveredCluster,
  NodePoolMetadata,
  PersonaRole,
  PlatformDeploymentRecord,
  ProvisionRequest,
  ResourceProfile,
  TenantOverlayRecord,
  WorkspaceConnectionRecord,
  WorkspaceConnectionSessionRecord,
  WorkspaceTemplate,
  CreatePortalDeploymentInput,
  CreateDeploymentApprovalInput,
  DeploymentApprovalRecord,
  DeploymentApprovalStatus,
  PortalDeploymentDiffStatusView,
  PortalDeploymentOptions,
  PortalDeploymentRecord,
  PortalDeploymentStatusView,
  PortalHelmfilePreview,
  PortalSecretProvisionStatusView,
  PortalSecretReadinessReport,
  PortalSecretFieldInfo,
  PortalSecretUpdateRequest,
  PortalSecretUpdateResult,
  CreateGpuInstanceInput,
  GpuComputeOptions,
  GpuInstanceRecord,
  GpuQuotaCheckResult,
  GpuAuthorizationResult,
  CreateTestVmInput,
  CreateAzureFoundationResourceInput,
  AzureFoundationOptions,
  AzureFoundationResourceRecord,
  TestVmOptions,
  TestVmRecord,
  DeploymentMode,
  DeploymentModeDetection,
} from '../types';
import { AzureProvider } from '../providers/azureProvider';
import { GitOpsOrchestrator } from './gitOpsOrchestrator';
import { ArgoCdService } from './argoCdService';
import { GitHubActionsService } from './githubActionsService';
import {
  DeploymentPortalService,
  type SecretProvisionProgressEvent,
} from './deploymentPortalService';
import { ScriptsApplicationCatalogService } from './scriptsApplicationCatalogService';
import { AksHelmDeploymentExecutor } from './aksHelmDeploymentExecutor';
import { GpuTerraformCloudService } from './gpuTerraformCloudService';
import { GpuQuotaService } from './gpuQuotaService';
import { TestVmService } from './testVmService';
import { VmTerraformCloudService } from './vmTerraformCloudService';
import { AzureFoundationResourceService } from './azureFoundationResourceService';
import { GpuComputeService } from './gpuComputeService';
import { GpuAuthorizationService } from './gpuAuthorizationService';
import { GpuVmPowerService } from './gpuVmPowerService';
import {
  KubernetesWorkspaceProvisioner,
  type WorkspaceProvisioningPreflightReport,
} from './workspaceKubernetesProvisioner';
import type { DeploymentExecutor } from './deploymentExecutor';
import { ClusterDiscoveryService } from './clusterDiscoveryService';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import { ClusterTagService } from './clusterTagService';
import { ClusterTagValidator } from '../utils/clusterTagValidator';
import { CloudHubNetworksService } from './cloudHubNetworksService';
import { OnePasswordSecretReadinessService } from './onePasswordSecretReadinessService';

// Numeric-aware chart version comparison: "1.9.0" must sort before "1.10.0",
// which plain string comparison gets wrong. Falls back to a string compare
// as soon as either side stops looking like a plain numeric segment (e.g.
// "-rc1", "latest"), since those aren't ours to order.
function compareChartVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .split(/[.-]/)
      .map(part => {
        const num = Number(part);
        return Number.isFinite(num) && part.trim() !== '' ? num : null;
      });
  const partsA = parse(a);
  const partsB = parse(b);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const numA = partsA[i];
    const numB = partsB[i];
    if (numA === null || numB === null) {
      return a.localeCompare(b);
    }
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
}

function pgSslConfig() {
  return process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

const POSTGRES_AAD_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

function createAzurePostgresPasswordProvider(logger: LoggerService) {
  const credential = createCloudHubAzureCredential((message, metadata) =>
    logger.info(message, metadata),
  );
  let cachedToken: { token: string; expiresOnTimestamp: number } | null = null;

  return async () => {
    if (
      cachedToken &&
      cachedToken.expiresOnTimestamp - Date.now() > 5 * 60_000
    ) {
      return cachedToken.token;
    }

    const token = await credential.getToken(POSTGRES_AAD_SCOPE);
    if (!token?.token) {
      throw new Error('Failed to acquire Azure PostgreSQL access token');
    }

    cachedToken = token;
    logger.info('[control-plane] acquired Azure PostgreSQL access token');
    return token.token;
  };
}

function mapApprovalRow(
  row: Record<string, unknown>,
): DeploymentApprovalRecord {
  const toIsoOrNull = (v: unknown): string | null =>
    v ? new Date(v as string).toISOString() : null;
  return {
    id: String(row.id),
    deploymentId: row.deployment_id ? String(row.deployment_id) : null,
    application: String(row.application),
    instanceName: String(row.instance_name),
    customer: String(row.customer),
    environment: String(row.environment),
    cluster: String(row.cluster),
    subscriptionId: String(row.subscription_id),
    resourceGroup: String(row.resource_group),
    chartVersion: String(row.chart_version),
    status: String(row.status) as DeploymentApprovalStatus,
    requestedBy: String(row.requested_by),
    requestedAt: toIsoOrNull(row.requested_at) ?? new Date().toISOString(),
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: toIsoOrNull(row.decided_at),
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    createdAt: toIsoOrNull(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updated_at) ?? new Date().toISOString(),
  };
}

const CONTROL_PLANE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS control_plane_tenants (
  id UUID PRIMARY KEY,
  tenant_name VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_clusters (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES control_plane_tenants(id),
  cluster_name VARCHAR(255),
  environment VARCHAR(100),
  region VARCHAR(100),
  subscription_id VARCHAR(255),
  cloud_provider VARCHAR(50),
  kubernetes_version VARCHAR(50),
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE control_plane_clusters ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE control_plane_clusters ADD COLUMN IF NOT EXISTS resource_group VARCHAR(255);
ALTER TABLE control_plane_clusters ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS control_plane_node_pools (
  id UUID PRIMARY KEY,
  cluster_id VARCHAR(255),
  nodepool_name VARCHAR(255),
  vm_size VARCHAR(100),
  node_count INT,
  mode VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS control_plane_platform_deployments (
  id UUID PRIMARY KEY,
  cluster_id VARCHAR(255),
  platform_version VARCHAR(100),
  deployment_status VARCHAR(50),
  deployed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_tenant_overlays (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES control_plane_tenants(id),
  cluster_id VARCHAR(255),
  overlay_version VARCHAR(100),
  deployment_status VARCHAR(50),
  deployed_by VARCHAR(255),
  deployed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_audit_logs (
  id UUID PRIMARY KEY,
  actor_ref VARCHAR(255) NOT NULL,
  persona VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100) NOT NULL,
  target_id VARCHAR(255),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane_development_profiles (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  description TEXT,
  runtime VARCHAR(100) NOT NULL,
  runtime_version VARCHAR(50),
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  build_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  platform_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  ide_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  deployment_type VARCHAR(100) NOT NULL,
  packaging VARCHAR(100) NOT NULL,
  observability_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  security_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  workspace_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE control_plane_development_profiles
  ADD COLUMN IF NOT EXISTS workspace_configuration JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS control_plane_developer_environments (
  id UUID PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  product_id VARCHAR(100) NOT NULL,
  component_id VARCHAR(150) NOT NULL,
  component_display_name VARCHAR(255) NOT NULL,
  owner_team VARCHAR(255) NOT NULL,
  development_profile_id VARCHAR(100) NOT NULL REFERENCES control_plane_development_profiles(id),
  development_profile_version VARCHAR(50) NOT NULL,
  source_repository_provider VARCHAR(50) NOT NULL,
  source_repository_organization VARCHAR(255),
  source_repository_name VARCHAR(255),
  source_repository_url TEXT,
  source_branch VARCHAR(255) NOT NULL,
  cloud_provider VARCHAR(50) NOT NULL,
  runtime_platform VARCHAR(100) NOT NULL,
  cluster_id VARCHAR(255) NOT NULL,
  cluster_name VARCHAR(255) NOT NULL,
  namespace VARCHAR(255) NOT NULL,
  namespace_status VARCHAR(50) NOT NULL,
  environment_type VARCHAR(50) NOT NULL,
  resource_profile VARCHAR(50) NOT NULL,
  platform_services JSONB NOT NULL DEFAULT '{}'::jsonb,
  security_baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL,
  status_message TEXT,
  failure_reason TEXT,
  workspace_type VARCHAR(50) NOT NULL DEFAULT 'devcontainer',
  workspace_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CONFIGURED',
  workspace_status_message TEXT,
  workspace_profile_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  workspace_image_registry VARCHAR(255) NOT NULL DEFAULT '',
  workspace_image_repository VARCHAR(255) NOT NULL DEFAULT '',
  workspace_image_tag VARCHAR(100) NOT NULL DEFAULT '',
  workspace_pod_name VARCHAR(255),
  workspace_pvc_name VARCHAR(255),
  workspace_service_account_name VARCHAR(255),
  workspace_devcontainer_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CONFIGURED',
  workspace_last_validated_at TIMESTAMP,
  requested_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_transition_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_type VARCHAR(50) NOT NULL DEFAULT 'devcontainer';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_status_message TEXT;
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_profile_version VARCHAR(50) NOT NULL DEFAULT 'v1';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_image_registry VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_image_repository VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_image_tag VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_pod_name VARCHAR(255);
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_pvc_name VARCHAR(255);
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_service_account_name VARCHAR(255);
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_devcontainer_status VARCHAR(50) NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE control_plane_developer_environments
  ADD COLUMN IF NOT EXISTS workspace_last_validated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_cp_dev_env_component
  ON control_plane_developer_environments (component_id);
CREATE INDEX IF NOT EXISTS idx_cp_dev_env_owner_team
  ON control_plane_developer_environments (owner_team);
CREATE INDEX IF NOT EXISTS idx_cp_dev_env_status
  ON control_plane_developer_environments (status);
CREATE INDEX IF NOT EXISTS idx_cp_dev_env_cluster
  ON control_plane_developer_environments (cluster_id);
CREATE INDEX IF NOT EXISTS idx_cp_dev_env_created_at
  ON control_plane_developer_environments (created_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_application_deployments (
  id UUID PRIMARY KEY,
  developer_environment_id UUID NOT NULL REFERENCES control_plane_developer_environments(id),
  component_id VARCHAR(150) NOT NULL,
  repository VARCHAR(512) NOT NULL,
  branch VARCHAR(255) NOT NULL,
  commit_sha VARCHAR(80) NOT NULL,
  image_repository VARCHAR(512) NOT NULL,
  image_tag VARCHAR(120) NOT NULL,
  image_digest VARCHAR(255),
  cluster_id VARCHAR(255) NOT NULL,
  cluster_name VARCHAR(255) NOT NULL,
  namespace VARCHAR(255) NOT NULL,
  release_name VARCHAR(255) NOT NULL,
  deployment_strategy VARCHAR(100) NOT NULL DEFAULT 'helm-upgrade',
  executor_type VARCHAR(50) NOT NULL DEFAULT 'aks-helm',
  status VARCHAR(50) NOT NULL,
  status_message TEXT,
  failure_reason TEXT,
  endpoint_url TEXT,
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  pipeline_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by VARCHAR(255) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_app_dep_env
  ON control_plane_application_deployments (developer_environment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_app_dep_component
  ON control_plane_application_deployments (component_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_app_dep_status
  ON control_plane_application_deployments (status);

CREATE TABLE IF NOT EXISTS control_plane_portal_deployments (
  id UUID PRIMARY KEY,
  deployment_name VARCHAR(255) NOT NULL,
  application VARCHAR(100) NOT NULL,
  instance_name VARCHAR(120) NOT NULL,
  customer VARCHAR(120) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  cluster VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  resource_group VARCHAR(255) NOT NULL,
  chart_version VARCHAR(60) NOT NULL,
  ai_store_integration BOOLEAN NOT NULL DEFAULT FALSE,
  namespace VARCHAR(120) NOT NULL,
  helmfile_path TEXT NOT NULL,
  helmfile_content TEXT,
  branch VARCHAR(255) NOT NULL,
  commit_sha VARCHAR(80),
  pr_url TEXT,
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  status VARCHAR(50) NOT NULL,
  current_step VARCHAR(160) NOT NULL DEFAULT '',
  status_message TEXT,
  failure_reason TEXT,
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  mode VARCHAR(30) NOT NULL DEFAULT 'simulated',
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  sri_deploy_source VARCHAR(50) DEFAULT 'cloudhub-native',
  backend_source VARCHAR(50) DEFAULT 'cloudhub-native'
);

ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255);
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS requested_by VARCHAR(255);
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP;
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS workflow_repository VARCHAR(255),
  ADD COLUMN IF NOT EXISTS workflow_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS workflow_ref VARCHAR(255),
  ADD COLUMN IF NOT EXISTS workflow_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dispatch_initiated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS workflow_run_attempt INTEGER,
  ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS workflow_conclusion VARCHAR(50),
  ADD COLUMN IF NOT EXISTS correlation_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS correlation_message TEXT,
  ADD COLUMN IF NOT EXISTS correlation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correlation_deadline TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_log_line INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instance_status VARCHAR(20) NOT NULL DEFAULT 'EXISTING',
  ADD COLUMN IF NOT EXISTS instance_mode VARCHAR(20) NOT NULL DEFAULT 'auto';

CREATE TABLE IF NOT EXISTS control_plane_deployment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES control_plane_portal_deployments(id) ON DELETE CASCADE,
  github_job_id BIGINT NOT NULL,
  job_name VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  conclusion VARCHAR(50),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_log_line INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (deployment_id, github_job_id)
);
CREATE INDEX IF NOT EXISTS idx_control_plane_portal_deployments_run
  ON control_plane_portal_deployments (workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_portal_deployments_reconcile
  ON control_plane_portal_deployments (status, correlation_status, workflow_run_id);

CREATE INDEX IF NOT EXISTS idx_cp_portal_dep_created_at
  ON control_plane_portal_deployments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_portal_dep_app_instance
  ON control_plane_portal_deployments (application, instance_name);
CREATE INDEX IF NOT EXISTS idx_cp_portal_dep_status
  ON control_plane_portal_deployments (status);

CREATE TABLE IF NOT EXISTS control_plane_gpu_instances (
  id UUID PRIMARY KEY,
  name VARCHAR(63) NOT NULL,
  gpu_sku VARCHAR(20) NOT NULL,
  vm_size VARCHAR(80) NOT NULL,
  region VARCHAR(60) NOT NULL,
  resource_group VARCHAR(120) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  subnet_id TEXT NOT NULL,
  environment VARCHAR(50) NOT NULL,
  cost_center VARCHAR(120) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  business_justification TEXT NOT NULL,
  lease_duration VARCHAR(20) NOT NULL,
  terraform_repository VARCHAR(255) NOT NULL,
  terraform_branch VARCHAR(120) NOT NULL,
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  mode VARCHAR(30) NOT NULL DEFAULT 'simulated',
  status VARCHAR(30) NOT NULL,
  status_message TEXT,
  failure_reason TEXT,
  requested_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cp_gpu_instances_created_at
  ON control_plane_gpu_instances (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_gpu_instances_status
  ON control_plane_gpu_instances (status);

CREATE TABLE IF NOT EXISTS control_plane_gpu_instance_events (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES control_plane_gpu_instances(id) ON DELETE CASCADE,
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_gpu_instance_events_instance_id
  ON control_plane_gpu_instance_events (instance_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control_plane_test_vms (
  id UUID PRIMARY KEY,
  name VARCHAR(63) NOT NULL,
  vm_size VARCHAR(80) NOT NULL,
  region VARCHAR(60) NOT NULL,
  resource_group VARCHAR(120) NOT NULL,
  subnet_id TEXT NOT NULL,
  environment VARCHAR(50) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  terraform_repository VARCHAR(255) NOT NULL,
  terraform_branch VARCHAR(120) NOT NULL,
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  mode VARCHAR(30) NOT NULL DEFAULT 'simulated',
  status VARCHAR(30) NOT NULL,
  status_message TEXT,
  failure_reason TEXT,
  monthly_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  requested_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cp_test_vms_created_at
  ON control_plane_test_vms (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_test_vms_status
  ON control_plane_test_vms (status);

CREATE TABLE IF NOT EXISTS control_plane_azure_foundation_requests (
  id UUID PRIMARY KEY,
  resource_type VARCHAR(50) NOT NULL,
  name VARCHAR(63) NOT NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'azure',
  module_path VARCHAR(120) NOT NULL,
  terraform_repository VARCHAR(255) NOT NULL,
  terraform_branch VARCHAR(120) NOT NULL,
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  mode VARCHAR(30) NOT NULL DEFAULT 'terraform-cloud',
  status VARCHAR(30) NOT NULL,
  status_message TEXT,
  failure_reason TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_foundation_requests_created_at
  ON control_plane_azure_foundation_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_foundation_requests_status
  ON control_plane_azure_foundation_requests (status);

CREATE TABLE IF NOT EXISTS control_plane_deployment_approvals (
  id UUID PRIMARY KEY,
  deployment_id UUID,
  application VARCHAR(100) NOT NULL,
  instance_name VARCHAR(120) NOT NULL,
  customer VARCHAR(120) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  cluster VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  resource_group VARCHAR(255) NOT NULL,
  chart_version VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  requested_by VARCHAR(255) NOT NULL,
  requested_at TIMESTAMP DEFAULT NOW(),
  decided_by VARCHAR(255),
  decided_at TIMESTAMP,
  decision_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE control_plane_deployment_approvals
  ADD COLUMN IF NOT EXISTS deployment_id UUID;

CREATE INDEX IF NOT EXISTS idx_cp_dep_approval_status
  ON control_plane_deployment_approvals (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_dep_approval_deployment_id
  ON control_plane_deployment_approvals (deployment_id)
  WHERE deployment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deployment_events (
  id UUID PRIMARY KEY,
  deployment_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  actor VARCHAR(255),
  actor_role VARCHAR(50),
  note TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_deployment_events_deployment
    FOREIGN KEY (deployment_id)
    REFERENCES control_plane_portal_deployments(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployment_events_deployment_id
  ON deployment_events (deployment_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_deployment_events_event_type
  ON deployment_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_events_created_at
  ON deployment_events (created_at DESC);

CREATE TABLE IF NOT EXISTS github_repository_requests (
  id UUID PRIMARY KEY,
  repository_name VARCHAR(255) NOT NULL,
  description TEXT,
  visibility VARCHAR(50) NOT NULL,
  owner_team VARCHAR(255) NOT NULL,
  template_name VARCHAR(255),
  requested_by VARCHAR(255) NOT NULL,
  github_repo_url TEXT,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_repo_requests_created_at
  ON github_repository_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_repo_requests_status
  ON github_repository_requests (status);

ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS backend_source VARCHAR(50) DEFAULT 'cloudhub-native';
CREATE INDEX IF NOT EXISTS idx_cp_portal_backend_source
  ON control_plane_portal_deployments(backend_source);
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS sri_deploy_source VARCHAR(50) DEFAULT 'cloudhub-native';
CREATE INDEX IF NOT EXISTS idx_cp_portal_sri_deploy_source
  ON control_plane_portal_deployments(sri_deploy_source);
`;

const SRI_PROVISIONAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sri_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  deployment_app VARCHAR(100),
  supported BOOLEAN DEFAULT true,
  chart_versions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sri_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL,
  component_id VARCHAR(100),
  provisioner_status VARCHAR(50) DEFAULT 'pending',
  manifest_content TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sri_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_name VARCHAR(100) NOT NULL UNIQUE,
  resources JSONB DEFAULT '{}'::jsonb,
  chart_overrides JSONB DEFAULT '{}'::jsonb,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sri_components_component_id
  ON sri_components(component_id);
CREATE INDEX IF NOT EXISTS idx_sri_deployments_deployment_id
  ON sri_deployments(deployment_id);
CREATE INDEX IF NOT EXISTS idx_sri_deployments_created_at
  ON sri_deployments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sri_skus_sku_name
  ON sri_skus(sku_name);
`;

const DEV_IMAGE_REGISTRY =
  process.env.CLOUDHUB_DEV_IMAGE_REGISTRY ??
  process.env.ACR_LOGIN_SERVER ??
  'companyacr.azurecr.io';

const WORKSPACE_IMAGE_TAGS = {
  base: process.env.CLOUDHUB_DEV_BASE_IMAGE_TAG ?? '1.0.0',
  node: process.env.CLOUDHUB_DEV_NODE_IMAGE_TAG ?? '1.0.0',
  python: process.env.CLOUDHUB_DEV_PYTHON_IMAGE_TAG ?? '1.0.0',
  java: process.env.CLOUDHUB_DEV_JAVA_IMAGE_TAG ?? '1.0.0',
  scala: process.env.CLOUDHUB_DEV_SCALA_IMAGE_TAG ?? '1.0.0',
  postgres: process.env.CLOUDHUB_DEV_POSTGRES_IMAGE_TAG ?? '1.0.0',
};

const DOMAIN_WORKSPACE_IMAGE_MAP = {
  'sensa-investigation': {
    repository:
      process.env.CLOUDHUB_DEV_IMAGE_REPOSITORY_INVESTIGATION ??
      'sri-dev-python',
    tag: process.env.CLOUDHUB_DEV_IMAGE_TAG_INVESTIGATION ?? 'latest',
  },
  'sensa-detection': {
    repository:
      process.env.CLOUDHUB_DEV_IMAGE_REPOSITORY_DETECTION ?? 'sri-dev-java',
    tag: process.env.CLOUDHUB_DEV_IMAGE_TAG_DETECTION ?? 'latest',
  },
  'sensa-data': {
    repository:
      process.env.CLOUDHUB_DEV_IMAGE_REPOSITORY_DATA ?? 'sri-dev-python',
    tag: process.env.CLOUDHUB_DEV_IMAGE_TAG_DATA ?? 'latest',
  },
  'sri-domain': {
    repository:
      process.env.CLOUDHUB_DEV_IMAGE_REPOSITORY_SANCTIONS ?? 'sri-dev-python',
    tag: process.env.CLOUDHUB_DEV_IMAGE_TAG_SANCTIONS ?? 'latest',
  },
  'sensa-agent': {
    repository:
      process.env.CLOUDHUB_DEV_IMAGE_REPOSITORY_AGENT ?? 'sri-dev-python',
    tag: process.env.CLOUDHUB_DEV_IMAGE_TAG_AGENT ?? 'latest',
  },
} as const;

function normalizeDomainKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function resolveDomainTemplateKey(
  domain: string,
): keyof typeof DOMAIN_WORKSPACE_IMAGE_MAP | null {
  const normalized = normalizeDomainKey(domain);
  const aliases: Record<string, keyof typeof DOMAIN_WORKSPACE_IMAGE_MAP> = {
    investigation: 'sensa-investigation',
    'sensa-investigation': 'sensa-investigation',
    detection: 'sensa-detection',
    'sensa-detection': 'sensa-detection',
    data: 'sensa-data',
    'sensa-data': 'sensa-data',
    sanctions: 'sri-domain',
    'sri-domain': 'sri-domain',
    agents: 'sensa-agent',
    agent: 'sensa-agent',
    'sensa-agent': 'sensa-agent',
  };
  return aliases[normalized] ?? null;
}

const PLATFORM_WORKFLOW_REPO =
  process.env.CLOUDHUB_PLATFORM_WORKFLOW_REPO ?? 'company/cloudhub-workflows';

const PLATFORM_WORKFLOW_REF =
  process.env.CLOUDHUB_PLATFORM_WORKFLOW_REF ?? 'v1';

const WORKSPACE_NAMESPACE =
  process.env.CLOUDHUB_WORKSPACE_NAMESPACE ?? 'cloudhub-workspaces';
const WORKSPACE_CLUSTER_ID =
  process.env.CLOUDHUB_WORKSPACE_CLUSTER_ID ?? 'cloudhub-workspace-aks';
const WORKSPACE_CLUSTER_NAME =
  process.env.CLOUDHUB_WORKSPACE_AKS_CLUSTER ??
  process.env.CLOUDHUB_WORKSPACE_AKS_CLUSTER_NAME ??
  process.env.CLOUDHUB_WORKSPACE_CLUSTER_NAME ??
  '';
const WORKSPACE_CLUSTER_RESOURCE_GROUP =
  process.env.CLOUDHUB_WORKSPACE_AKS_RESOURCE_GROUP ??
  process.env.CLOUDHUB_WORKSPACE_CLUSTER_RESOURCE_GROUP ??
  '';
const WORKSPACE_CLUSTER_ENVIRONMENT =
  process.env.CLOUDHUB_WORKSPACE_CLUSTER_ENVIRONMENT ?? 'dev';
const WORKSPACE_CLUSTER_REGION =
  process.env.CLOUDHUB_WORKSPACE_CLUSTER_REGION ?? 'unknown';
const WORKSPACE_CLUSTER_SUBSCRIPTION_ID =
  process.env.CLOUDHUB_AZURE_SUBSCRIPTION_ID ??
  process.env.CLOUDHUB_WORKSPACE_CLUSTER_SUBSCRIPTION_ID ??
  'unknown';

function workspaceConfig(input: {
  repository: string;
  tag: string;
  tools: string[];
  extensions: string[];
  postCreateCommand?: string;
}): DevelopmentProfileWorkspaceConfig {
  return {
    type: 'devcontainer',
    image: {
      registry: DEV_IMAGE_REGISTRY,
      repository: input.repository,
      tag: input.tag,
    },
    remoteUser: 'developer',
    workspaceFolder: '/workspaces/${localWorkspaceFolderBasename}',
    tools: input.tools,
    vscode: {
      extensions: input.extensions,
      settings: {
        'terminal.integrated.defaultProfile.linux': 'bash',
      },
    },
    environmentVariables: {},
    features: {},
    postCreateCommand: input.postCreateCommand ?? null,
  };
}

const DEVELOPMENT_PROFILE_SEEDS: Omit<
  DevelopmentProfile,
  'createdAt' | 'updatedAt'
>[] = [
  {
    id: 'node-api',
    name: 'node-api',
    displayName: 'Node.js API',
    version: 'v1',
    description:
      'TypeScript/Node.js API development standard managed by Platform Engineering.',
    runtime: 'node',
    runtimeVersion: '22',
    languages: ['typescript'],
    buildTools: ['npm'],
    platformTools: ['git', 'docker', 'kubectl', 'helm', 'azure-cli'],
    ideConfiguration: {
      editor: 'vscode',
      extensionsRecommended: ['dbaeumer.vscode-eslint'],
    },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: {
      containerScanning: 'enabled',
      dependencyScanning: 'enabled',
    },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/node',
      tag: WORKSPACE_IMAGE_TAGS.node,
      tools: [
        'node',
        'npm',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: [
        'dbaeumer.vscode-eslint',
        'esbenp.prettier-vscode',
        'ms-vscode.vscode-typescript-next',
      ],
      postCreateCommand:
        'if [ -f package-lock.json ]; then npm ci; elif [ -f package.json ]; then npm install; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'react-ui',
    name: 'react-ui',
    displayName: 'React UI',
    version: 'v1',
    description:
      'TypeScript/React frontend development profile for SRI UI components.',
    runtime: 'react',
    runtimeVersion: '22',
    languages: ['typescript'],
    buildTools: ['npm'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { browserTelemetry: 'enabled' },
    securityConfiguration: { dependencyScanning: 'enabled' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/node',
      tag: WORKSPACE_IMAGE_TAGS.node,
      tools: [
        'node',
        'npm',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: [
        'dbaeumer.vscode-eslint',
        'esbenp.prettier-vscode',
        'ms-vscode.vscode-typescript-next',
      ],
      postCreateCommand:
        'if [ -f package-lock.json ]; then npm ci; elif [ -f package.json ]; then npm install; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'python-service',
    name: 'python-service',
    displayName: 'Python Service',
    version: 'v1',
    description: 'Python service baseline for SRI backend services.',
    runtime: 'python',
    runtimeVersion: '3.11',
    languages: ['python'],
    buildTools: ['pip'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: {
      containerScanning: 'enabled',
      dependencyScanning: 'enabled',
    },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/python',
      tag: WORKSPACE_IMAGE_TAGS.python,
      tools: [
        'python',
        'pip',
        'venv',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['ms-python.python', 'ms-python.vscode-pylance'],
      postCreateCommand:
        'if [ -f requirements.txt ]; then pip install -r requirements.txt; elif [ -f pyproject.toml ]; then pip install -e .; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'python-ai',
    name: 'python-ai',
    displayName: 'Python AI',
    version: 'v1',
    description:
      'Python AI/Copilot baseline for investigation assistive services.',
    runtime: 'python',
    runtimeVersion: '3.11',
    languages: ['python'],
    buildTools: ['pip'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: { modelSupplyChainChecks: 'enabled' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/python',
      tag: WORKSPACE_IMAGE_TAGS.python,
      tools: [
        'python',
        'pip',
        'venv',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['ms-python.python', 'ms-python.vscode-pylance'],
      postCreateCommand:
        'if [ -f requirements.txt ]; then pip install -r requirements.txt; elif [ -f pyproject.toml ]; then pip install -e .; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'python-data',
    name: 'python-data',
    displayName: 'Python Data',
    version: 'v1',
    description:
      'Data pipeline profile for ingestion and transformation services.',
    runtime: 'python',
    runtimeVersion: '3.11',
    languages: ['python'],
    buildTools: ['pip'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: { dependencyScanning: 'enabled' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/python',
      tag: WORKSPACE_IMAGE_TAGS.python,
      tools: [
        'python',
        'pip',
        'venv',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['ms-python.python', 'ms-python.vscode-pylance'],
      postCreateCommand:
        'if [ -f requirements.txt ]; then pip install -r requirements.txt; elif [ -f pyproject.toml ]; then pip install -e .; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'python-agent',
    name: 'python-agent',
    displayName: 'Python Agent',
    version: 'v1',
    description: 'Agentic runtime profile for SRI automated workflows.',
    runtime: 'python',
    runtimeVersion: '3.11',
    languages: ['python'],
    buildTools: ['pip'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: { runtimePolicy: 'restricted' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/python',
      tag: WORKSPACE_IMAGE_TAGS.python,
      tools: [
        'python',
        'pip',
        'venv',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['ms-python.python', 'ms-python.vscode-pylance'],
      postCreateCommand:
        'if [ -f requirements.txt ]; then pip install -r requirements.txt; elif [ -f pyproject.toml ]; then pip install -e .; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'java-springboot',
    name: 'java-springboot',
    displayName: 'Java Spring Boot',
    version: 'v1',
    description: 'Spring Boot service profile for SRI detection APIs.',
    runtime: 'java',
    runtimeVersion: '17',
    languages: ['java'],
    buildTools: ['maven', 'gradle'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: { dependencyScanning: 'enabled' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/java',
      tag: WORKSPACE_IMAGE_TAGS.java,
      tools: [
        'java',
        'maven',
        'gradle',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['vscjava.vscode-java-pack', 'vmware.vscode-spring-boot'],
      postCreateCommand:
        'if [ -f pom.xml ]; then mvn -q -DskipTests dependency:go-offline; elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then gradle dependencies; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'scala-spark',
    name: 'scala-spark',
    displayName: 'Scala Spark',
    version: 'v1',
    description:
      'Spark engine profile for model execution and scoring workloads.',
    runtime: 'scala',
    runtimeVersion: '2.12',
    languages: ['scala'],
    buildTools: ['sbt'],
    platformTools: ['git', 'docker', 'kubectl', 'helm'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { opentelemetry: 'enabled' },
    securityConfiguration: { dependencyScanning: 'enabled' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/scala',
      tag: WORKSPACE_IMAGE_TAGS.scala,
      tools: [
        'java',
        'scala',
        'sbt',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['scala-lang.scala', 'vscjava.vscode-java-pack'],
      postCreateCommand: 'if [ -f build.sbt ]; then sbt update; fi',
    }),
    status: 'ACTIVE',
  },
  {
    id: 'postgres-db',
    name: 'postgres-db',
    displayName: 'PostgreSQL DB',
    version: 'v1',
    description:
      'Database schema and migration profile for SRI detection datastore.',
    runtime: 'postgresql',
    runtimeVersion: '16',
    languages: ['plpgsql', 'java'],
    buildTools: ['flyway'],
    platformTools: ['git', 'docker', 'kubectl'],
    ideConfiguration: { editor: 'vscode' },
    deploymentType: 'kubernetes',
    packaging: 'helm',
    observabilityConfiguration: { dbMetrics: 'enabled' },
    securityConfiguration: { schemaPolicyChecks: 'enabled' },
    workspaceConfiguration: workspaceConfig({
      repository: 'cloudhub/dev/postgres',
      tag: WORKSPACE_IMAGE_TAGS.postgres,
      tools: [
        'psql',
        'flyway',
        'java',
        'git',
        'kubectl',
        'helm',
        'azure-cli',
        'github-cli',
      ],
      extensions: ['mtxr.sqltools', 'vscjava.vscode-java-pack'],
    }),
    status: 'ACTIVE',
  },
];

const RESOURCE_PROFILES: ResourceProfile[] = [
  {
    id: 'SMALL',
    displayName: 'Small',
    description: 'Standard lightweight development workload.',
    cpuRequest: '250m',
    cpuLimit: '500m',
    memoryRequest: '512Mi',
    memoryLimit: '1Gi',
    storageQuota: '5Gi',
  },
  {
    id: 'MEDIUM',
    displayName: 'Medium',
    description: 'Standard API/service development workload.',
    cpuRequest: '500m',
    cpuLimit: '1000m',
    memoryRequest: '1Gi',
    memoryLimit: '2Gi',
    storageQuota: '10Gi',
  },
  {
    id: 'LARGE',
    displayName: 'Large',
    description: 'Resource-intensive development workload.',
    cpuRequest: '1000m',
    cpuLimit: '2000m',
    memoryRequest: '2Gi',
    memoryLimit: '4Gi',
    storageQuota: '20Gi',
  },
];

export class ControlPlaneService {
  private readonly logger: LoggerService;
  private pool: Pool | null;
  private sriProvisionalPool: Pool | null = null;
  private readonly gitOps: GitOpsOrchestrator;
  private readonly argo: ArgoCdService;
  private readonly azure: AzureProvider;
  private readonly actions: GitHubActionsService;
  private readonly scriptsCatalog: ScriptsApplicationCatalogService;
  private readonly deploymentExecutor: DeploymentExecutor;
  private readonly workspaceProvisioner: KubernetesWorkspaceProvisioner;
  private readonly portal: DeploymentPortalService;
  private readonly gpuCompute: GpuComputeService;
  private readonly gpuAuth: GpuAuthorizationService;
  private readonly testVm: TestVmService;
  private readonly foundation: AzureFoundationResourceService;
  private readonly cloudhubNetworks: CloudHubNetworksService;
  private readonly onePassword: OnePasswordSecretReadinessService;
  private initialized = false;

  private readonly memoryClusters = new Map<string, ClusterMetadata>();
  private readonly memoryNodePools = new Map<string, NodePoolMetadata[]>();
  private readonly memoryPlatformDeployments: PlatformDeploymentRecord[] = [];
  private readonly memoryTenantOverlays: TenantOverlayRecord[] = [];
  private readonly memoryDevelopmentProfiles = new Map<
    string,
    DevelopmentProfile
  >();
  private readonly memoryWorkspaces = new Map<
    string,
    DeveloperEnvironmentRecord
  >();
  private readonly memoryApplicationDeployments = new Map<
    string,
    ApplicationDeploymentRecord
  >();
  private readonly memoryApprovals = new Map<
    string,
    DeploymentApprovalRecord
  >();
  private readonly memoryAuditLogs: WorkspaceAuditLogRecord[] = [];

  constructor(logger: LoggerService, config?: RootConfigService) {
    this.logger = logger;
    this.gitOps = new GitOpsOrchestrator(logger);
    this.argo = new ArgoCdService(logger);
    this.azure = new AzureProvider(logger);
    this.cloudhubNetworks = new CloudHubNetworksService({ logger, config });
    this.actions = new GitHubActionsService(logger);
    this.deploymentExecutor = new AksHelmDeploymentExecutor(this.actions);
    this.workspaceProvisioner = new KubernetesWorkspaceProvisioner(logger);
    const scriptsCatalog = new ScriptsApplicationCatalogService(logger);
    const secretReadiness = new OnePasswordSecretReadinessService({
      logger,
      catalog: scriptsCatalog,
      config,
    });
    this.onePassword = secretReadiness;
    this.scriptsCatalog = scriptsCatalog;
    // Initialize settings service before portal service (portal depends on settings)
    this.portal = new DeploymentPortalService({
      logger,
      getPool: () => this.pool,
      getSriProvisionalPool: () => this.sriProvisionalPool,
      actions: this.actions,
      catalog: scriptsCatalog,
      secretReadiness,
      discoverClusters: query => {
        const subId =
          query.subscriptionId ||
          process.env.AZURE_SUBSCRIPTION_ID ||
          'b0799078-b42a-4b59-9e70-22cd09a20ee2';
        return this.discoverDeployableClusters({
          subscriptionId: subId,
          resourceGroup: query.resourceGroup,
        });
      },
      listCustomerCatalog: () => this.listCustomerCatalog(),
      listCustomerCodes: () => this.listCustomerCodes(),
      audit: audit => this.audit(audit),
    });

    this.gpuCompute = new GpuComputeService({
      logger,
      getPool: () => this.pool,
      terraform: new GpuTerraformCloudService(logger),
      quota: new GpuQuotaService(logger),
      power: new GpuVmPowerService(logger),
      azure: this.azure,
      networks: this.cloudhubNetworks,
      audit: audit => this.audit(audit),
    });

    this.gpuAuth = new GpuAuthorizationService(logger);

    this.testVm = new TestVmService({
      logger,
      getPool: () => this.pool,
      terraform: new VmTerraformCloudService(logger),
      azure: this.azure,
      networks: this.cloudhubNetworks,
      audit: audit => this.audit(audit),
    });

    this.foundation = new AzureFoundationResourceService({
      logger,
      getPool: () => this.pool,
      audit: audit => this.audit(audit),
    });

    const host = process.env.POSTGRES_HOST ?? process.env.PGHOST;
    if (!host) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[control-plane] POSTGRES_HOST is required in production; in-memory fallback is not permitted',
        );
      }
      this.pool = null;
      this.logger.warn(
        '[control-plane] POSTGRES_HOST not set; using in-memory store for local runtime',
      );
      return;
    }

    const password = process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD;
    const useAzureAdAuth =
      process.env.POSTGRES_AAD_AUTH === 'true' || (!password && !!host);

    const postgresPassword = useAzureAdAuth
      ? createAzurePostgresPasswordProvider(logger)
      : password ?? undefined;

    this.pool = new Pool({
      host,
      port: parseInt(
        process.env.POSTGRES_PORT ?? process.env.PGPORT ?? '5432',
        10,
      ),
      user: process.env.POSTGRES_USER ?? process.env.PGUSER ?? 'backstage',
      password: postgresPassword,
      database:
        process.env.POSTGRES_DB ?? process.env.PGDATABASE ?? 'backstage',
      ssl: pgSslConfig(),
    });

    // Initialize SRI-Provisional pool (same host, different database)
    if (process.env.SRI_PROVISIONAL_ENABLED === 'true') {
      this.sriProvisionalPool = new Pool({
        host,
        port: parseInt(
          process.env.POSTGRES_PORT ?? process.env.PGPORT ?? '5432',
          10,
        ),
        user: process.env.POSTGRES_USER ?? process.env.PGUSER ?? 'backstage',
        password: postgresPassword,
        database: 'sri_provisional',
        ssl: pgSslConfig(),
      });
      this.logger.info(
        '[control-plane] SRI-Provisional database pool initialized',
      );
    } else {
      this.sriProvisionalPool = null;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Validate 1Password token is available before initializing
    if (
      !process.env.OP_SERVICE_ACCOUNT_TOKEN &&
      !process.env.CLOUDHUB_1PASSWORD_DISABLED
    ) {
      this.logger.warn(
        '[control-plane] WARNING: OP_SERVICE_ACCOUNT_TOKEN environment variable not set. ' +
          '1Password provisioning features will fail. ' +
          'Set OP_SERVICE_ACCOUNT_TOKEN or CLOUDHUB_1PASSWORD_DISABLED=true to suppress this warning.',
      );
    }

    if (this.pool) {
      try {
        await this.pool.query(CONTROL_PLANE_SCHEMA_SQL);
        this.logger.info('[control-plane] PostgreSQL schema initialized');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[control-plane] PostgreSQL initialization failed, falling back to in-memory store: ${message}`,
        );
        try {
          await this.pool.end();
        } catch {
          // Ignore close failures and continue with in-memory fallback.
        }
        this.pool = null;
      }
    }
    if (this.sriProvisionalPool) {
      try {
        await this.sriProvisionalPool.query(SRI_PROVISIONAL_SCHEMA_SQL);
        this.logger.info('[control-plane] SRI-Provisional schema initialized');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[control-plane] SRI-Provisional initialization failed: ${message}`,
        );
        try {
          await this.sriProvisionalPool.end();
        } catch {
          // Ignore close failures
        }
        this.sriProvisionalPool = null;
      }
    }
    await this.seedDevelopmentProfiles();
    this.initialized = true;
    await this.portal.reconcileNonTerminalDeployments();
  }

  getRuntimeHealth(): {
    ready: boolean;
    initialized: boolean;
    storageMode: 'postgres' | 'in-memory';
    timestamp: string;
  } {
    const storageMode: 'postgres' | 'in-memory' = this.pool
      ? 'postgres'
      : 'in-memory';
    return {
      ready: this.initialized,
      initialized: this.initialized,
      storageMode,
      timestamp: new Date().toISOString(),
    };
  }

  getPool(): Pool | null {
    return this.pool;
  }

  private async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!this.pool) return [];
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  private async seedDevelopmentProfiles(): Promise<void> {
    const now = new Date().toISOString();

    if (this.pool) {
      for (const profile of DEVELOPMENT_PROFILE_SEEDS) {
        await this.query(
          `
          INSERT INTO control_plane_development_profiles
            (
              id, name, display_name, version, description, runtime, runtime_version,
              languages, build_tools, platform_tools, ide_configuration, deployment_type,
              packaging, observability_configuration, security_configuration,
              workspace_configuration, status, created_at, updated_at
            )
          VALUES
            (
              $1, $2, $3, $4, $5, $6, $7,
              $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12,
              $13, $14::jsonb, $15::jsonb, $16::jsonb, $17,
              $18, $19
            )
          ON CONFLICT (id)
          DO NOTHING
          `,
          [
            profile.id,
            profile.name,
            profile.displayName,
            profile.version,
            profile.description,
            profile.runtime,
            profile.runtimeVersion,
            JSON.stringify(profile.languages),
            JSON.stringify(profile.buildTools),
            JSON.stringify(profile.platformTools),
            JSON.stringify(profile.ideConfiguration),
            profile.deploymentType,
            profile.packaging,
            JSON.stringify(profile.observabilityConfiguration),
            JSON.stringify(profile.securityConfiguration),
            JSON.stringify(profile.workspaceConfiguration ?? {}),
            profile.status,
            now,
            now,
          ],
        );
      }
      return;
    }

    for (const seed of DEVELOPMENT_PROFILE_SEEDS) {
      if (!this.memoryDevelopmentProfiles.has(seed.id)) {
        this.memoryDevelopmentProfiles.set(seed.id, {
          ...seed,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  async discoverAks(input: {
    subscriptionId: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }) {
    return this.discoverDeployableClusters(input);
  }

  async assertClusterOnboarded(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<DiscoveredCluster> {
    const discoveryService = new ClusterDiscoveryService(
      this.azure,
      this.logger,
    );
    const cluster = await discoveryService.getDeployableCluster(input);
    if (!cluster) {
      throw new Error(
        `Cluster '${input.clusterName}' is not onboarded for CloudHub. Required AKS tags: cloudhub-enabled=true and cloudhub-onboarded=true.`,
      );
    }
    return cluster;
  }

  async discoverResourceGroups(input: {
    subscriptionId: string;
    search?: string;
  }) {
    try {
      return await this.azure.discoverResourceGroups(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[control-plane] Azure resource group discovery failed, using local fallback: ${message}`,
      );

      const clusters = await this.listClusters();
      const candidateGroups = Array.from(
        new Set(
          clusters
            .filter(cluster => cluster.subscriptionId === input.subscriptionId)
            .map(cluster => (cluster.resourceGroup ?? '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b));

      const search = input.search?.trim().toLowerCase();
      if (!search) {
        return candidateGroups;
      }

      return candidateGroups.filter(group =>
        group.toLowerCase().includes(search),
      );
    }
  }

  async discoverCustomerClusters(input: {
    subscriptionIds: string[];
    tagKey: string;
    tagValue: string;
  }): Promise<DiscoveredCluster[]> {
    const clusters = await this.azure.discoverClustersByCustomerTag(input);
    const deployable = clusters.filter(cluster =>
      ClusterTagValidator.isCloudHubEligible(cluster.tags),
    );
    this.logger.info(
      `[control-plane] Customer cluster discovery filtered to ${deployable.length}/${clusters.length} CloudHub-eligible clusters`,
    );
    return deployable;
  }

  async discoverSubnets(input: {
    subscriptionId: string;
    search?: string;
  }): Promise<
    Array<{ id: string; name: string; vnetName: string; resourceGroup: string }>
  > {
    return this.azure.discoverSubnets(input);
  }

  async listCustomerCodes(): Promise<string[]> {
    const catalog = await this.listCustomerCatalog();
    return Array.from(
      new Set(Object.values(catalog.customersByVault).flat()),
    ).sort((left, right) => left.localeCompare(right));
  }

  async listCustomerCatalog(): Promise<{
    vaults: string[];
    customersByVault: Record<string, string[]>;
  }> {
    if (this.onePassword.isConfigured?.() === false) {
      throw new Error(
        '1Password credentials are required. Set OP_SERVICE_ACCOUNT_TOKEN before using deployment catalog options.',
      );
    }

    const vaults = await this.onePassword.listVaultNames();
    if (vaults.length === 0) {
      throw new Error('1Password is reachable but no vaults are visible.');
    }

    const customersByVault: Record<string, string[]> = {};
    for (const vault of vaults) {
      try {
        customersByVault[vault] =
          await this.onePassword.listCustomerCodesFromVaults([vault]);
      } catch (error) {
        throw new Error(
          `Failed to list customer codes for 1Password vault '${vault}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      vaults,
      customersByVault,
    };
  }

  async registerCluster(input: {
    cluster: DiscoveredCluster;
    tenantId?: string;
    nodePools?: Array<{
      name: string;
      vmSize: string;
      nodeCount: number;
      mode: string;
    }>;
    actorRef: string;
    role: PersonaRole;
  }): Promise<ClusterMetadata> {
    await this.init();

    const cluster: ClusterMetadata = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId ?? null,
      clusterName: input.cluster.clusterName,
      environment: input.cluster.environment,
      region: input.cluster.region,
      subscriptionId: input.cluster.subscriptionId,
      cloudProvider: 'Azure',
      kubernetesVersion: input.cluster.kubernetesVersion,
      status: input.cluster.status,
      resourceGroup: input.cluster.resourceGroup,
      tags: input.cluster.tags,
      createdAt: new Date().toISOString(),
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_clusters
          (id, tenant_id, cluster_name, environment, region, subscription_id, cloud_provider, kubernetes_version, status, resource_group, tags, created_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
        `,
        [
          cluster.id,
          cluster.tenantId,
          cluster.clusterName,
          cluster.environment,
          cluster.region,
          cluster.subscriptionId,
          cluster.cloudProvider,
          cluster.kubernetesVersion,
          cluster.status,
          cluster.resourceGroup,
          JSON.stringify(cluster.tags ?? {}),
          cluster.createdAt,
        ],
      );
    } else {
      this.memoryClusters.set(cluster.id, cluster);
    }

    const pools = (input.nodePools ?? []).map(pool => ({
      id: crypto.randomUUID(),
      clusterId: cluster.id,
      nodepoolName: pool.name,
      vmSize: pool.vmSize,
      nodeCount: pool.nodeCount,
      mode: pool.mode,
    }));

    if (this.pool && pools.length) {
      for (const pool of pools) {
        await this.query(
          `
          INSERT INTO control_plane_node_pools (id, cluster_id, nodepool_name, vm_size, node_count, mode)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            pool.id,
            pool.clusterId,
            pool.nodepoolName,
            pool.vmSize,
            pool.nodeCount,
            pool.mode,
          ],
        );
      }
    } else {
      this.memoryNodePools.set(cluster.id, pools);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'cluster-register',
      targetType: 'cluster',
      targetId: cluster.id,
      payload: {
        ...cluster,
      },
    });

    return cluster;
  }

  async listClusters(): Promise<ClusterMetadata[]> {
    await this.init();
    if (this.pool) {
      const rows = await this.query<ClusterMetadata>(
        `
        SELECT
          id,
          tenant_id AS "tenantId",
          cluster_name AS "clusterName",
          environment,
          region,
          subscription_id AS "subscriptionId",
          cloud_provider AS "cloudProvider",
          kubernetes_version AS "kubernetesVersion",
          status,
          resource_group AS "resourceGroup",
          tags,
          created_at AS "createdAt"
        FROM control_plane_clusters
        ORDER BY created_at DESC
        `,
      );
      return rows.filter(cluster =>
        ClusterTagValidator.isCloudHubEligible(cluster.tags ?? {}),
      );
    }
    return Array.from(this.memoryClusters.values()).filter(cluster =>
      ClusterTagValidator.isCloudHubEligible(cluster.tags ?? {}),
    );
  }

  listSriCatalogComponents() {
    return SRI_CATALOG_COMPONENTS;
  }

  listResourceProfiles(): ResourceProfile[] {
    return RESOURCE_PROFILES;
  }

  private parseDevelopmentProfileRow(row: any): DevelopmentProfile {
    return {
      id: String(row.id),
      name: String(row.name),
      displayName: String(row.displayName ?? row.display_name),
      version: String(row.version),
      description: String(row.description ?? ''),
      runtime: String(row.runtime),
      runtimeVersion: row.runtimeVersion ?? row.runtime_version ?? null,
      languages: Array.isArray(row.languages)
        ? row.languages
        : JSON.parse(String(row.languages ?? '[]')),
      buildTools: Array.isArray(row.buildTools)
        ? row.buildTools
        : JSON.parse(String(row.buildTools ?? row.build_tools ?? '[]')),
      platformTools: Array.isArray(row.platformTools)
        ? row.platformTools
        : JSON.parse(String(row.platformTools ?? row.platform_tools ?? '[]')),
      ideConfiguration:
        typeof row.ideConfiguration === 'object' &&
        row.ideConfiguration !== null
          ? row.ideConfiguration
          : JSON.parse(
              String(row.ideConfiguration ?? row.ide_configuration ?? '{}'),
            ),
      deploymentType: String(row.deploymentType ?? row.deployment_type),
      packaging: String(row.packaging),
      observabilityConfiguration:
        typeof row.observabilityConfiguration === 'object' &&
        row.observabilityConfiguration !== null
          ? row.observabilityConfiguration
          : JSON.parse(
              String(
                row.observabilityConfiguration ??
                  row.observability_configuration ??
                  '{}',
              ),
            ),
      securityConfiguration:
        typeof row.securityConfiguration === 'object' &&
        row.securityConfiguration !== null
          ? row.securityConfiguration
          : JSON.parse(
              String(
                row.securityConfiguration ?? row.security_configuration ?? '{}',
              ),
            ),
      workspaceConfiguration:
        typeof row.workspaceConfiguration === 'object' &&
        row.workspaceConfiguration !== null
          ? row.workspaceConfiguration
          : JSON.parse(
              String(
                row.workspaceConfiguration ??
                  row.workspace_configuration ??
                  '{}',
              ),
            ),
      status: String(row.status) as DevelopmentProfile['status'],
      createdAt: String(row.createdAt ?? row.created_at),
      updatedAt: String(row.updatedAt ?? row.updated_at),
    };
  }

  async listDevelopmentProfiles(): Promise<DevelopmentProfile[]> {
    await this.init();
    if (this.pool) {
      const rows = await this.query<any>(
        `
        SELECT
          id,
          name,
          display_name AS "displayName",
          version,
          description,
          runtime,
          runtime_version AS "runtimeVersion",
          languages,
          build_tools AS "buildTools",
          platform_tools AS "platformTools",
          ide_configuration AS "ideConfiguration",
          deployment_type AS "deploymentType",
          packaging,
          observability_configuration AS "observabilityConfiguration",
          security_configuration AS "securityConfiguration",
          workspace_configuration AS "workspaceConfiguration",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM control_plane_development_profiles
        ORDER BY display_name ASC
        `,
      );
      return rows.map(row => this.parseDevelopmentProfileRow(row));
    }
    return Array.from(this.memoryDevelopmentProfiles.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  private async listWorkspaceRuntimeClusters(): Promise<
    Array<{
      id: string;
      clusterName: string;
      environment: string;
      region: string;
      subscriptionId: string;
      cloudProvider: string;
    }>
  > {
    if (this.pool) {
      try {
        const rows = await this.query<{
          id: string;
          cluster_name: string;
          environment_name: string | null;
          region: string | null;
          account_scope: string | null;
          provider: string;
          status: string;
        }>(
          `
          SELECT
            c.id,
            c.cluster_name,
            e.environment_name,
            c.region,
            c.account_scope,
            c.provider,
            c.status
          FROM pr_clusters c
          LEFT JOIN pr_environments e ON e.id = c.environment_id
          WHERE UPPER(c.provider) = 'AZURE'
            AND LOWER(c.status) = 'active'
          ORDER BY c.cluster_name ASC
          `,
        );

        if (rows.length > 0) {
          return rows.map(row => ({
            id: row.id,
            clusterName: row.cluster_name,
            environment: row.environment_name ?? 'dev',
            region: row.region ?? 'unknown',
            subscriptionId: row.account_scope ?? 'unknown',
            cloudProvider: row.provider,
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[control-plane] platform-registry cluster lookup unavailable; falling back to control-plane clusters: ${message}`,
        );
      }
    }

    // Workspace placement is platform-owned; never select an arbitrary registry cluster.
    if (!WORKSPACE_CLUSTER_NAME) {
      return [];
    }

    const clusters = await this.listClusters();
    return clusters.map(cluster => ({
      id: cluster.id,
      clusterName: cluster.clusterName,
      environment: cluster.environment,
      region: cluster.region,
      subscriptionId: cluster.subscriptionId,
      cloudProvider: cluster.cloudProvider,
    }));
  }

  private async resolveWorkspaceClusterById(clusterId: string): Promise<{
    id: string;
    clusterName: string;
    environment: string;
    region: string;
    subscriptionId: string;
    cloudProvider: string;
  } | null> {
    if (this.pool) {
      try {
        const rows = await this.query<{
          id: string;
          cluster_name: string;
          environment_name: string | null;
          region: string | null;
          account_scope: string | null;
          provider: string;
        }>(
          `
          SELECT
            c.id,
            c.cluster_name,
            e.environment_name,
            c.region,
            c.account_scope,
            c.provider
          FROM pr_clusters c
          LEFT JOIN pr_environments e ON e.id = c.environment_id
          WHERE c.id = $1
          LIMIT 1
          `,
          [clusterId],
        );

        if (rows[0]) {
          const row = rows[0];
          return {
            id: row.id,
            clusterName: row.cluster_name,
            environment: row.environment_name ?? 'dev',
            region: row.region ?? 'unknown',
            subscriptionId: row.account_scope ?? 'unknown',
            cloudProvider: row.provider,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[control-plane] platform-registry cluster resolution unavailable; using control-plane fallback: ${message}`,
        );
      }
    }

    const clusters = await this.listClusters();
    const fallback = clusters.find(item => item.id === clusterId);
    if (!fallback) {
      return null;
    }
    return {
      id: fallback.id,
      clusterName: fallback.clusterName,
      environment: fallback.environment,
      region: fallback.region,
      subscriptionId: fallback.subscriptionId,
      cloudProvider: fallback.cloudProvider,
    };
  }

  async getDevelopmentProfile(id: string): Promise<DevelopmentProfile | null> {
    await this.init();
    if (this.pool) {
      const rows = await this.query<any>(
        `
        SELECT
          id,
          name,
          display_name AS "displayName",
          version,
          description,
          runtime,
          runtime_version AS "runtimeVersion",
          languages,
          build_tools AS "buildTools",
          platform_tools AS "platformTools",
          ide_configuration AS "ideConfiguration",
          deployment_type AS "deploymentType",
          packaging,
          observability_configuration AS "observabilityConfiguration",
          security_configuration AS "securityConfiguration",
          workspace_configuration AS "workspaceConfiguration",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM control_plane_development_profiles
        WHERE id = $1
        LIMIT 1
        `,
        [id],
      );
      return rows[0] ? this.parseDevelopmentProfileRow(rows[0]) : null;
    }
    return this.memoryDevelopmentProfiles.get(id) ?? null;
  }

  private defaultWorkspacePlatformServices(): DeveloperEnvironmentPlatformServices {
    return {
      containerRegistry: { enabled: true, status: 'ENABLED' },
      secrets: {
        enabled: true,
        provider: '1Password',
        status: 'ENABLED',
      },
      ingress: { enabled: true, status: 'ENABLED' },
      observability: {
        logs: true,
        metrics: true,
        traces: true,
        status: 'ENABLED',
      },
      dependencies: {
        postgresql: false,
        kafka: false,
        redis: false,
        objectStorage: false,
      },
    };
  }

  private defaultWorkspaceSecurityBaseline(input: {
    productId: string;
    ownerTeam: string;
    componentId: string;
    namespaceStatus: string;
  }): DeveloperEnvironmentSecurityBaseline {
    const pendingOrConfigured =
      input.namespaceStatus === 'READY' ? 'CONFIGURED' : 'PENDING';
    return {
      rbac: pendingOrConfigured,
      resourceQuota: pendingOrConfigured,
      networkPolicy: pendingOrConfigured,
      podSecurity: pendingOrConfigured,
      workloadIdentity: 'NOT_CONFIGURED',
      keyVaultIntegration: 'NOT_CONFIGURED',
      acrAccess: 'NOT_CONFIGURED',
      ingressDns: 'NOT_CONFIGURED',
      observability: pendingOrConfigured,
      labels: {
        'company.io/product': input.productId.toLowerCase(),
        'company.io/team': input.ownerTeam,
        'company.io/environment': 'dev',
        'company.io/component': input.componentId,
        'company.io/managed-by': 'cloudhub',
      },
    };
  }

  private async resolveWorkspaceNamespace(
    clusterName: string,
  ): Promise<{ namespace: string; status: string }> {
    const namespace = WORKSPACE_NAMESPACE;

    if (!this.pool) {
      return { namespace, status: 'PENDING' };
    }

    try {
      const rows = await this.query<{ namespace_name: string }>(
        `
        SELECT n.namespace_name
        FROM pr_namespaces n
        INNER JOIN pr_clusters c ON c.id = n.cluster_id
        WHERE c.cluster_name = $1
          AND n.namespace_name = $2
        LIMIT 1
        `,
        [clusterName, namespace],
      );

      if (rows[0]?.namespace_name) {
        return { namespace: rows[0].namespace_name, status: 'READY' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[control-plane] Namespace lookup via platform-registry failed: ${message}`,
      );
    }

    return { namespace, status: 'PENDING' };
  }

  private async resolveWorkspaceCluster(preferredClusterId?: string): Promise<{
    id: string;
    clusterName: string;
    environment: string;
    region: string;
    subscriptionId: string;
    cloudProvider: string;
  } | null> {
    if (WORKSPACE_CLUSTER_ID) {
      const configured = await this.resolveWorkspaceClusterById(
        WORKSPACE_CLUSTER_ID,
      );
      if (configured) {
        return configured;
      }

      if (WORKSPACE_CLUSTER_NAME) {
        if (!WORKSPACE_CLUSTER_RESOURCE_GROUP) {
          this.logger.warn(
            '[control-plane] CLOUDHUB_WORKSPACE_AKS_RESOURCE_GROUP is not configured for the workspace AKS target',
          );
        }
        return {
          id: WORKSPACE_CLUSTER_ID,
          clusterName: WORKSPACE_CLUSTER_NAME,
          environment: WORKSPACE_CLUSTER_ENVIRONMENT,
          region: WORKSPACE_CLUSTER_REGION,
          subscriptionId: WORKSPACE_CLUSTER_SUBSCRIPTION_ID,
          cloudProvider: 'AZURE',
        };
      }
    }

    if (preferredClusterId) {
      const requested = await this.resolveWorkspaceClusterById(
        preferredClusterId,
      );
      if (requested) {
        return requested;
      }
    }

    const clusters = await this.listWorkspaceRuntimeClusters();
    const firstAzure = clusters.find(
      item => String(item.cloudProvider).toUpperCase() === 'AZURE',
    );
    if (!firstAzure) {
      return null;
    }

    return {
      id: firstAzure.id,
      clusterName: firstAzure.clusterName,
      environment: firstAzure.environment,
      region: firstAzure.region,
      subscriptionId: firstAzure.subscriptionId,
      cloudProvider: firstAzure.cloudProvider,
    };
  }

  private parseWorkspaceRow(row: any): DeveloperEnvironmentRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      displayName: String(row.displayName ?? row.display_name),
      description: row.description ?? null,
      productId: String(row.productId ?? row.product_id),
      componentId: String(row.componentId ?? row.component_id),
      componentDisplayName: String(
        row.componentDisplayName ?? row.component_display_name,
      ),
      ownerTeam: String(row.ownerTeam ?? row.owner_team),
      developmentProfileId: String(
        row.developmentProfileId ?? row.development_profile_id,
      ),
      developmentProfileVersion: String(
        row.developmentProfileVersion ?? row.development_profile_version,
      ),
      sourceRepositoryProvider: String(
        row.sourceRepositoryProvider ?? row.source_repository_provider,
      ),
      sourceRepositoryOrganization:
        row.sourceRepositoryOrganization ??
        row.source_repository_organization ??
        null,
      sourceRepositoryName:
        row.sourceRepositoryName ?? row.source_repository_name ?? null,
      sourceRepositoryUrl:
        row.sourceRepositoryUrl ?? row.source_repository_url ?? null,
      sourceBranch: String(row.sourceBranch ?? row.source_branch),
      cloudProvider: String(row.cloudProvider ?? row.cloud_provider),
      runtimePlatform: String(row.runtimePlatform ?? row.runtime_platform),
      clusterId: String(row.clusterId ?? row.cluster_id),
      clusterName: String(row.clusterName ?? row.cluster_name),
      namespace: String(row.namespace),
      namespaceStatus: String(row.namespaceStatus ?? row.namespace_status),
      environmentType: String(
        row.environmentType ?? row.environment_type,
      ) as DeveloperEnvironmentRecord['environmentType'],
      resourceProfile: String(
        row.resourceProfile ?? row.resource_profile,
      ) as DeveloperEnvironmentRecord['resourceProfile'],
      platformServices:
        typeof row.platformServices === 'object' &&
        row.platformServices !== null
          ? row.platformServices
          : JSON.parse(
              String(row.platformServices ?? row.platform_services ?? '{}'),
            ),
      securityBaseline:
        typeof row.securityBaseline === 'object' &&
        row.securityBaseline !== null
          ? row.securityBaseline
          : JSON.parse(
              String(row.securityBaseline ?? row.security_baseline ?? '{}'),
            ),
      status: String(row.status) as DeveloperEnvironmentRecord['status'],
      statusMessage: row.statusMessage ?? row.status_message ?? null,
      failureReason: row.failureReason ?? row.failure_reason ?? null,
      workspaceType: String(
        row.workspaceType ?? row.workspace_type ?? 'devcontainer',
      ) as DeveloperEnvironmentRecord['workspaceType'],
      workspaceStatus: String(
        row.workspaceStatus ?? row.workspace_status ?? 'NOT_CONFIGURED',
      ) as DeveloperEnvironmentRecord['workspaceStatus'],
      workspaceStatusMessage:
        row.workspaceStatusMessage ?? row.workspace_status_message ?? null,
      workspaceProfileVersion: String(
        row.workspaceProfileVersion ??
          row.workspace_profile_version ??
          row.developmentProfileVersion ??
          row.development_profile_version ??
          'v1',
      ),
      workspaceImageRegistry: String(
        row.workspaceImageRegistry ?? row.workspace_image_registry ?? '',
      ),
      workspaceImageRepository: String(
        row.workspaceImageRepository ?? row.workspace_image_repository ?? '',
      ),
      workspaceImageTag: String(
        row.workspaceImageTag ?? row.workspace_image_tag ?? '',
      ),
      workspacePodName: row.workspacePodName ?? row.workspace_pod_name ?? null,
      workspacePvcName: row.workspacePvcName ?? row.workspace_pvc_name ?? null,
      workspaceServiceAccountName:
        row.workspaceServiceAccountName ??
        row.workspace_service_account_name ??
        null,
      workspaceDevContainerStatus: String(
        row.workspaceDevContainerStatus ??
          row.workspace_devcontainer_status ??
          'NOT_CONFIGURED',
      ) as DeveloperEnvironmentRecord['workspaceDevContainerStatus'],
      workspaceLastValidatedAt:
        row.workspaceLastValidatedAt ?? row.workspace_last_validated_at ?? null,
      latestDeploymentId:
        row.latestDeploymentId ?? row.latest_deployment_id ?? null,
      latestDeploymentStatus: (row.latestDeploymentStatus ??
        row.latest_deployment_status ??
        null) as DeveloperEnvironmentRecord['latestDeploymentStatus'],
      latestDeploymentCreatedAt:
        row.latestDeploymentCreatedAt ??
        row.latest_deployment_created_at ??
        null,
      requestedBy: String(row.requestedBy ?? row.requested_by),
      createdAt: String(row.createdAt ?? row.created_at),
      updatedAt: String(row.updatedAt ?? row.updated_at),
      lastTransitionAt: String(row.lastTransitionAt ?? row.last_transition_at),
    };
  }

  private enrichWorkspaceWithLatestDeployment(
    item: DeveloperEnvironmentRecord,
  ): DeveloperEnvironmentRecord {
    const latest = Array.from(this.memoryApplicationDeployments.values())
      .filter(deployment => deployment.developerEnvironmentId === item.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    if (!latest) {
      return {
        ...item,
        latestDeploymentId: null,
        latestDeploymentStatus: null,
        latestDeploymentCreatedAt: null,
      };
    }

    return {
      ...item,
      latestDeploymentId: latest.id,
      latestDeploymentStatus: latest.status,
      latestDeploymentCreatedAt: latest.createdAt,
    };
  }

  async listWorkspaces(filters?: {
    ownerTeam?: string;
    requestedBy?: string;
    includeDeleted?: boolean;
  }): Promise<WorkspaceRecord[]> {
    await this.init();

    if (this.pool) {
      const params: unknown[] = [];
      const clauses: string[] = [];

      if (!filters?.includeDeleted) {
        clauses.push(`status <> 'DELETED'`);
      }
      if (filters?.ownerTeam) {
        params.push(filters.ownerTeam);
        clauses.push(`owner_team = $${params.length}`);
      }
      if (filters?.requestedBy) {
        params.push(filters.requestedBy);
        clauses.push(`requested_by = $${params.length}`);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await this.query<any>(
        `
        SELECT
          e.id,
          e.name,
          e.display_name AS "displayName",
          e.description,
          e.product_id AS "productId",
          e.component_id AS "componentId",
          e.component_display_name AS "componentDisplayName",
          e.owner_team AS "ownerTeam",
          e.development_profile_id AS "developmentProfileId",
          e.development_profile_version AS "developmentProfileVersion",
          e.source_repository_provider AS "sourceRepositoryProvider",
          e.source_repository_organization AS "sourceRepositoryOrganization",
          e.source_repository_name AS "sourceRepositoryName",
          e.source_repository_url AS "sourceRepositoryUrl",
          e.source_branch AS "sourceBranch",
          e.cloud_provider AS "cloudProvider",
          e.runtime_platform AS "runtimePlatform",
          e.cluster_id AS "clusterId",
          e.cluster_name AS "clusterName",
          e.namespace,
          e.namespace_status AS "namespaceStatus",
          e.environment_type AS "environmentType",
          e.resource_profile AS "resourceProfile",
          e.platform_services AS "platformServices",
          e.security_baseline AS "securityBaseline",
          e.status,
          e.status_message AS "statusMessage",
          e.failure_reason AS "failureReason",
          e.workspace_type AS "workspaceType",
          e.workspace_status AS "workspaceStatus",
          e.workspace_status_message AS "workspaceStatusMessage",
          e.workspace_profile_version AS "workspaceProfileVersion",
          e.workspace_image_registry AS "workspaceImageRegistry",
          e.workspace_image_repository AS "workspaceImageRepository",
          e.workspace_image_tag AS "workspaceImageTag",
          e.workspace_devcontainer_status AS "workspaceDevContainerStatus",
          e.workspace_last_validated_at AS "workspaceLastValidatedAt",
          latest_deployments.latest_deployment_id AS "latestDeploymentId",
          latest_deployments.latest_deployment_status AS "latestDeploymentStatus",
          latest_deployments.latest_deployment_created_at AS "latestDeploymentCreatedAt",
          e.requested_by AS "requestedBy",
          e.created_at AS "createdAt",
          e.updated_at AS "updatedAt",
          e.last_transition_at AS "lastTransitionAt"
        FROM control_plane_developer_environments e
        LEFT JOIN (
          SELECT DISTINCT ON (developer_environment_id)
            developer_environment_id,
            id AS latest_deployment_id,
            status AS latest_deployment_status,
            created_at AS latest_deployment_created_at
          FROM control_plane_application_deployments
          ORDER BY developer_environment_id, created_at DESC
        ) latest_deployments ON latest_deployments.developer_environment_id = e.id
        ${where}
        ORDER BY e.created_at DESC
        `,
        params,
      );
      return rows.map(row => this.parseWorkspaceRow(row));
    }

    const items = Array.from(this.memoryWorkspaces.values()).filter(item => {
      if (!filters?.includeDeleted && item.status === 'DELETED') return false;
      if (filters?.ownerTeam && item.ownerTeam !== filters.ownerTeam)
        return false;
      if (filters?.requestedBy && item.requestedBy !== filters.requestedBy)
        return false;
      return true;
    });

    return items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(item => this.enrichWorkspaceWithLatestDeployment(item));
  }

  async listDeveloperEnvironments(filters?: {
    ownerTeam?: string;
    requestedBy?: string;
    includeDeleted?: boolean;
  }): Promise<DeveloperEnvironmentRecord[]> {
    return this.listWorkspaces(filters);
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | null> {
    await this.init();
    if (this.pool) {
      const rows = await this.query<any>(
        `
        SELECT
          e.id,
          e.name,
          e.display_name AS "displayName",
          e.description,
          e.product_id AS "productId",
          e.component_id AS "componentId",
          e.component_display_name AS "componentDisplayName",
          e.owner_team AS "ownerTeam",
          e.development_profile_id AS "developmentProfileId",
          e.development_profile_version AS "developmentProfileVersion",
          e.source_repository_provider AS "sourceRepositoryProvider",
          e.source_repository_organization AS "sourceRepositoryOrganization",
          e.source_repository_name AS "sourceRepositoryName",
          e.source_repository_url AS "sourceRepositoryUrl",
          e.source_branch AS "sourceBranch",
          e.cloud_provider AS "cloudProvider",
          e.runtime_platform AS "runtimePlatform",
          e.cluster_id AS "clusterId",
          e.cluster_name AS "clusterName",
          e.namespace,
          e.namespace_status AS "namespaceStatus",
          e.environment_type AS "environmentType",
          e.resource_profile AS "resourceProfile",
          e.platform_services AS "platformServices",
          e.security_baseline AS "securityBaseline",
          e.status,
          e.status_message AS "statusMessage",
          e.failure_reason AS "failureReason",
          e.workspace_type AS "workspaceType",
          e.workspace_status AS "workspaceStatus",
          e.workspace_status_message AS "workspaceStatusMessage",
          e.workspace_profile_version AS "workspaceProfileVersion",
          e.workspace_image_registry AS "workspaceImageRegistry",
          e.workspace_image_repository AS "workspaceImageRepository",
          e.workspace_image_tag AS "workspaceImageTag",
          e.workspace_devcontainer_status AS "workspaceDevContainerStatus",
          e.workspace_last_validated_at AS "workspaceLastValidatedAt",
          latest_deployments.latest_deployment_id AS "latestDeploymentId",
          latest_deployments.latest_deployment_status AS "latestDeploymentStatus",
          latest_deployments.latest_deployment_created_at AS "latestDeploymentCreatedAt",
          e.requested_by AS "requestedBy",
          e.created_at AS "createdAt",
          e.updated_at AS "updatedAt",
          e.last_transition_at AS "lastTransitionAt"
        FROM control_plane_developer_environments e
        LEFT JOIN (
          SELECT DISTINCT ON (developer_environment_id)
            developer_environment_id,
            id AS latest_deployment_id,
            status AS latest_deployment_status,
            created_at AS latest_deployment_created_at
          FROM control_plane_application_deployments
          ORDER BY developer_environment_id, created_at DESC
        ) latest_deployments ON latest_deployments.developer_environment_id = e.id
        WHERE e.id = $1
        LIMIT 1
        `,
        [id],
      );
      return rows[0] ? this.parseWorkspaceRow(rows[0]) : null;
    }
    const item = this.memoryWorkspaces.get(id);
    return item ? this.enrichWorkspaceWithLatestDeployment(item) : null;
  }

  async getDeveloperEnvironment(
    id: string,
  ): Promise<DeveloperEnvironmentRecord | null> {
    return this.getWorkspace(id);
  }

  async getWorkspaceConnection(input: {
    id: string;
  }): Promise<WorkspaceConnectionRecord> {
    await this.init();

    const workspace = await this.getWorkspace(input.id);
    if (!workspace) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }

    const updatedAt = new Date().toISOString();
    const forwardedPort = Number.parseInt(
      process.env.CLOUDHUB_WORKSPACE_FORWARD_PORT ?? '8000',
      10,
    );
    const safePort =
      Number.isFinite(forwardedPort) && forwardedPort > 0
        ? forwardedPort
        : 8000;
    const vscodeAttachHint =
      'VS Code Command Palette -> Remote: Attach to Kubernetes Pod';
    const podName = workspace.workspacePodName ?? null;
    const base = {
      environmentId: workspace.id,
      workspaceStatus: workspace.status,
      connectionMode: 'manual-vscode-kubernetes' as const,
      targetCluster: workspace.clusterName,
      namespace: workspace.namespace,
      podName,
      containerName: 'workspace',
      portForwardCommand: null,
      vscodeAttachHint,
      updatedAt,
    };

    if (workspace.status !== 'READY') {
      return {
        ...base,
        connectionStatus: 'UNAVAILABLE',
        reason: `Workspace status is ${workspace.status}. Start the workspace before connecting.`,
        instructions: [
          'Open the workspace details page in CloudHub.',
          'Click Start Workspace and wait for lifecycle status READY.',
          'After the workspace is READY, click Check Connection to refresh preflight.',
          'Use Connect Workspace after preflight status shows READY.',
        ],
      };
    }

    try {
      const resources = this.workspaceResourceNames(workspace);
      const status = await this.workspaceProvisioner.getWorkspaceStatus(
        resources,
      );
      const runtimePodName = resources.podName;

      if (
        !status.podExists ||
        !status.podReady ||
        status.podPhase !== 'Running'
      ) {
        return {
          ...base,
          podName: runtimePodName,
          connectionStatus: 'UNAVAILABLE',
          reason: status.podReason
            ? `Workspace pod is not ready (${status.podReason}).`
            : `Workspace pod is not ready (phase=${
                status.podPhase ?? 'unknown'
              }).`,
          instructions: [
            'Refresh workspace status in CloudHub to confirm lifecycle transitions.',
            'If status remains non-ready, stop then start the workspace to recreate the pod.',
            'Retry Connect Workspace after the pod reports Running and Ready.',
          ],
        };
      }

      return {
        ...base,
        podName: runtimePodName,
        connectionStatus: 'READY',
        portForwardCommand: `kubectl port-forward pod/${runtimePodName} ${safePort}:${safePort} -n ${workspace.namespace}`,
        instructions: [
          `Run kubectl config current-context and ensure it is ${workspace.clusterName}.`,
          `Run kubectl get pod -n ${workspace.namespace} ${runtimePodName} to verify pod state.`,
          `Run kubectl port-forward pod/${runtimePodName} ${safePort}:${safePort} -n ${workspace.namespace} in a local terminal to expose workspace service ports.`,
          'Open VS Code and install the Kubernetes extension if it is not already installed.',
          'Open VS Code Command Palette and run Remote: Attach to Kubernetes Pod.',
          `Choose namespace ${workspace.namespace}, then pod ${runtimePodName}, then container workspace.`,
          'Keep this workspace running until you choose Stop Workspace or Delete Workspace in CloudHub.',
        ],
      };
    } catch (error) {
      return {
        ...base,
        connectionStatus: 'FAILED',
        reason: error instanceof Error ? error.message : String(error),
        instructions: [
          'Verify workspace platform configuration and namespace readiness with Platform Engineering.',
          'Retry Connect Workspace after the workspace runtime status is READY.',
        ],
      };
    }
  }

  async createWorkspaceConnectionSession(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<WorkspaceConnectionSessionRecord> {
    await this.init();

    const workspace = await this.getWorkspace(input.id);
    if (!workspace) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }

    const connection = await this.getWorkspaceConnection({ id: input.id });
    const updatedAt = new Date().toISOString();

    if (connection.connectionStatus !== 'READY' || !connection.podName) {
      return {
        environmentId: workspace.id,
        sessionStatus: 'FAILED',
        sessionMode: 'cloudhub-session-url',
        launchUrl: null,
        expiresAt: null,
        reason:
          connection.reason ?? 'Workspace connection preflight is not READY.',
        instructions: [
          'Click Check Connection and resolve preflight issues first.',
          'When preflight is READY, retry Start Managed Session.',
        ],
        updatedAt,
      };
    }

    const connectBaseUrl = (
      process.env.CLOUDHUB_WORKSPACE_CONNECT_BASE_URL ?? ''
    ).trim();
    const signingKey = (
      process.env.CLOUDHUB_WORKSPACE_CONNECT_SIGNING_KEY ?? ''
    ).trim();
    if (!connectBaseUrl || !signingKey) {
      return {
        environmentId: workspace.id,
        sessionStatus: 'NOT_CONFIGURED',
        sessionMode: 'cloudhub-session-url',
        launchUrl: null,
        expiresAt: null,
        reason:
          'Managed session gateway is not configured. Set CLOUDHUB_WORKSPACE_CONNECT_BASE_URL and CLOUDHUB_WORKSPACE_CONNECT_SIGNING_KEY.',
        instructions: [
          'Ask Platform Engineering to configure managed session gateway environment variables in backend runtime.',
          'Use Connect Workspace (manual mode) until managed session gateway is configured.',
        ],
        updatedAt,
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlCandidate = Number.parseInt(
      process.env.CLOUDHUB_WORKSPACE_CONNECT_TTL_SECONDS ?? '900',
      10,
    );
    const ttlSeconds = Number.isFinite(ttlCandidate)
      ? Math.max(60, Math.min(3600, ttlCandidate))
      : 900;
    const expiresAtSeconds = nowSeconds + ttlSeconds;
    const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();

    const payload = {
      workspaceId: workspace.id,
      actorRef: input.actorRef,
      cluster: workspace.clusterName,
      namespace: workspace.namespace,
      pod: connection.podName,
      container: connection.containerName,
      iat: nowSeconds,
      exp: expiresAtSeconds,
    };

    const payloadEncoded = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(payloadEncoded)
      .digest('base64url');
    const token = `${payloadEncoded}.${signature}`;
    const launchUrl = `${connectBaseUrl.replace(
      /\/$/,
      '',
    )}/connect?token=${encodeURIComponent(token)}`;

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'WORKSPACE_CONNECTION_SESSION_CREATED',
      targetType: 'developer-environment',
      targetId: workspace.id,
      payload: {
        sessionMode: 'cloudhub-session-url',
        expiresAt,
      },
    });

    return {
      environmentId: workspace.id,
      sessionStatus: 'READY',
      sessionMode: 'cloudhub-session-url',
      launchUrl,
      expiresAt,
      instructions: [
        'Open the launch URL to enter the managed workspace session.',
        'If the session page reports expired token, click Start Managed Session again to mint a new session.',
        'Keep the workspace in READY state while using the managed session.',
      ],
      updatedAt,
    };
  }

  async createWorkspace(input: {
    request: CreateWorkspaceRequest;
    actorRef: string;
    role: PersonaRole;
  }): Promise<WorkspaceRecord> {
    await this.init();

    if (!input.request.componentId) {
      throw new Error('COMPONENT_NOT_FOUND: componentId is required');
    }

    if (input.request.environmentType !== 'SHARED_TEAM') {
      throw new Error(
        'ENVIRONMENT_TYPE_UNSUPPORTED: Only SHARED_TEAM is supported in Phase 1',
      );
    }

    const component = getSriCatalogComponent(input.request.componentId);
    if (!component) {
      throw new Error(
        `COMPONENT_NOT_FOUND: Unknown component ${input.request.componentId}`,
      );
    }
    if (component.status !== 'active') {
      throw new Error(
        `COMPONENT_NOT_CONFIGURED: Component ${component.id} is not active`,
      );
    }

    const profile = await this.getDevelopmentProfile(
      component.developmentProfile.id,
    );
    if (!profile) {
      throw new Error(
        `DEVELOPMENT_PROFILE_NOT_FOUND: ${component.developmentProfile.id}`,
      );
    }
    if (profile.status === 'DISABLED') {
      throw new Error(`DEVELOPMENT_PROFILE_DISABLED: ${profile.id}`);
    }

    const sourceBranch = input.request.source?.branch?.trim();
    if (!sourceBranch) {
      throw new Error('SOURCE_BRANCH_REQUIRED: source.branch is required');
    }

    const sourceRepo = {
      provider: (component.repository.provider ?? 'github').toLowerCase(),
      organization:
        component.repository.organization ??
        input.request.source?.repository?.organization ??
        null,
      name:
        component.repository.name ??
        input.request.source?.repository?.name ??
        null,
      url:
        component.repository.url ??
        input.request.source?.repository?.url ??
        null,
    };

    if (!sourceRepo.name) {
      throw new Error(
        `REPOSITORY_NOT_CONFIGURED: Repository is not configured for ${component.id}`,
      );
    }

    const cluster = await this.resolveWorkspaceCluster(
      input.request.runtime?.clusterId,
    );
    if (!cluster) {
      throw new Error(
        'CLUSTER_NOT_FOUND: No workspace runtime cluster is configured',
      );
    }

    const resourceProfile = RESOURCE_PROFILES.find(
      profileItem => profileItem.id === input.request.resourceProfile,
    );
    if (!resourceProfile) {
      throw new Error(
        `RESOURCE_PROFILE_INVALID: ${input.request.resourceProfile}`,
      );
    }

    const namespaceResult = await this.resolveWorkspaceNamespace(
      cluster.clusterName,
    );
    const platformServices: WorkspacePlatformServices = {
      ...this.defaultWorkspacePlatformServices(),
      ...input.request.platformServices,
      dependencies: {
        ...this.defaultWorkspacePlatformServices().dependencies,
        ...(input.request.platformServices?.dependencies ?? {}),
      },
      observability: {
        ...this.defaultWorkspacePlatformServices().observability,
        ...(input.request.platformServices?.observability ?? {}),
      },
    };

    const now = new Date().toISOString();
    const environmentName = `${component.id}-${cluster.clusterName}-shared-team`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 120);

    const existingByName = this.pool
      ? (
          await this.query<any>(
            `
            SELECT *
            FROM control_plane_developer_environments
            WHERE name = $1
            LIMIT 1
            `,
            [environmentName],
          )
        )[0]
      : Array.from(this.memoryWorkspaces.values()).find(
          item => item.name === environmentName,
        );

    if (existingByName) {
      return this.pool
        ? this.parseWorkspaceRow(existingByName)
        : (existingByName as DeveloperEnvironmentRecord);
    }

    const preflight =
      await this.workspaceProvisioner.validateWorkspacePrerequisites({
        componentId: component.id,
        developmentProfileId: profile.id,
        dependencies: {
          postgresql: Boolean(platformServices.dependencies.postgresql),
          kafka: Boolean(platformServices.dependencies.kafka),
        },
      });
    if (!preflight.ready) {
      const failedMessages = preflight.checks
        .filter(check => check.status === 'FAILED')
        .map(check => check.message);
      throw new Error(
        `WORKSPACE_PRECHECK_FAILED: ${
          failedMessages.join(' | ') ||
          'Workspace runtime prerequisites failed.'
        }`,
      );
    }

    const securityBaseline = this.defaultWorkspaceSecurityBaseline({
      productId: component.product,
      ownerTeam: component.owner.team,
      componentId: component.id,
      namespaceStatus: namespaceResult.status,
    });

    const profileWorkspace = profile.workspaceConfiguration;
    if (!profileWorkspace) {
      throw new Error(
        `WORKSPACE_CONFIGURATION_MISSING: Development profile ${profile.id} has no workspace configuration`,
      );
    }
    const selectedWorkspaceImage = this.workspaceImageForComponent({
      componentDomain: component.domain,
      profileWorkspace,
    });

    const workspaceId = crypto.randomUUID();
    const workspaceResources =
      KubernetesWorkspaceProvisioner.resourceNames(workspaceId);
    const record: WorkspaceRecord = {
      id: workspaceId,
      name: environmentName,
      displayName: `${component.displayName} Workspace`,
      description: `Shared team development environment for ${component.displayName}`,
      productId: component.product,
      componentId: component.id,
      componentDisplayName: component.displayName,
      ownerTeam: component.owner.team,
      developmentProfileId: profile.id,
      developmentProfileVersion: profile.version,
      sourceRepositoryProvider: sourceRepo.provider,
      sourceRepositoryOrganization: sourceRepo.organization,
      sourceRepositoryName: sourceRepo.name,
      sourceRepositoryUrl: sourceRepo.url,
      sourceBranch,
      cloudProvider: input.request.runtime.cloudProvider.toUpperCase(),
      runtimePlatform: input.request.runtime.platform.toUpperCase(),
      clusterId: cluster.id,
      clusterName: cluster.clusterName,
      namespace: namespaceResult.namespace,
      namespaceStatus: namespaceResult.status,
      environmentType: 'SHARED_TEAM',
      resourceProfile: resourceProfile.id,
      platformServices,
      securityBaseline,
      status: 'REQUESTED',
      statusMessage:
        namespaceResult.status === 'READY'
          ? 'Environment request accepted and baseline reconciliation queued.'
          : 'Environment request accepted. Namespace baseline will be created by platform automation.',
      failureReason: null,
      workspaceType: 'devcontainer',
      workspaceStatus: 'NOT_CONFIGURED',
      workspaceStatusMessage:
        'Dev Container has not been validated yet for this repository.',
      workspaceProfileVersion: profile.version,
      workspaceImageRegistry: selectedWorkspaceImage.registry,
      workspaceImageRepository: selectedWorkspaceImage.repository,
      workspaceImageTag: selectedWorkspaceImage.tag,
      workspacePodName: workspaceResources.podName,
      workspacePvcName: workspaceResources.pvcName,
      workspaceServiceAccountName: workspaceResources.serviceAccountName,
      workspaceDevContainerStatus: 'NOT_CONFIGURED',
      workspaceLastValidatedAt: null,
      requestedBy: input.actorRef,
      createdAt: now,
      updatedAt: now,
      lastTransitionAt: now,
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_developer_environments
          (
            id, name, display_name, description, product_id, component_id,
            component_display_name, owner_team, development_profile_id,
            development_profile_version, source_repository_provider,
            source_repository_organization, source_repository_name,
            source_repository_url, source_branch, cloud_provider,
            runtime_platform, cluster_id, cluster_name, namespace,
            namespace_status, environment_type, resource_profile,
            platform_services, security_baseline, status, status_message,
            failure_reason, workspace_type, workspace_status,
            workspace_status_message, workspace_profile_version,
            workspace_image_registry, workspace_image_repository,
            workspace_image_tag, workspace_pod_name, workspace_pvc_name,
            workspace_service_account_name, workspace_devcontainer_status,
            workspace_last_validated_at, requested_by, created_at, updated_at,
            last_transition_at
          )
        VALUES
          (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9,
            $10, $11,
            $12, $13,
            $14, $15, $16,
            $17, $18, $19, $20,
            $21, $22, $23,
            $24::jsonb, $25::jsonb, $26, $27,
            $28, $29, $30,
            $31, $32,
            $33, $34,
            $35, $36, $37,
            $38, $39,
            $40, $41, $42,
            $43
          )
        `,
        [
          record.id,
          record.name,
          record.displayName,
          record.description,
          record.productId,
          record.componentId,
          record.componentDisplayName,
          record.ownerTeam,
          record.developmentProfileId,
          record.developmentProfileVersion,
          record.sourceRepositoryProvider,
          record.sourceRepositoryOrganization,
          record.sourceRepositoryName,
          record.sourceRepositoryUrl,
          record.sourceBranch,
          record.cloudProvider,
          record.runtimePlatform,
          record.clusterId,
          record.clusterName,
          record.namespace,
          record.namespaceStatus,
          record.environmentType,
          record.resourceProfile,
          JSON.stringify(record.platformServices),
          JSON.stringify(record.securityBaseline),
          record.status,
          record.statusMessage,
          record.failureReason,
          record.workspaceType,
          record.workspaceStatus,
          record.workspaceStatusMessage,
          record.workspaceProfileVersion,
          record.workspaceImageRegistry,
          record.workspaceImageRepository,
          record.workspaceImageTag,
          record.workspacePodName,
          record.workspacePvcName,
          record.workspaceServiceAccountName,
          record.workspaceDevContainerStatus,
          record.workspaceLastValidatedAt,
          record.requestedBy,
          record.createdAt,
          record.updatedAt,
          record.lastTransitionAt,
        ],
      );
    } else {
      this.memoryWorkspaces.set(record.id, record);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'WORKSPACE_REQUESTED',
      targetType: 'developer-environment',
      targetId: record.id,
      payload: {
        componentId: record.componentId,
        ownerTeam: record.ownerTeam,
        clusterId: record.clusterId,
        namespace: record.namespace,
        resourceProfile: record.resourceProfile,
        platformServices: record.platformServices,
        status: record.status,
      },
    });

    try {
      const validating = await this.updateWorkspaceStatusRecord({
        environment: record,
        status: 'VALIDATING',
        statusMessage: 'Validating the configured workspace platform.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_PROVISIONING_STARTED',
      });
      const provisioning = await this.updateWorkspaceStatusRecord({
        environment: validating,
        status: 'PROVISIONING',
        statusMessage: 'Creating workspace service account, storage, and pod.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_PROVISIONING_STARTED',
      });
      await this.workspaceProvisioner.createWorkspace({
        workspaceId: provisioning.id,
        componentId: provisioning.componentId,
        developmentProfileId: provisioning.developmentProfileId,
        developerRef: provisioning.requestedBy,
        dependencies: {
          postgresql: Boolean(
            provisioning.platformServices?.dependencies?.postgresql,
          ),
          kafka: Boolean(provisioning.platformServices?.dependencies?.kafka),
        },
        resourceProfile,
        image: `${provisioning.workspaceImageRegistry}/${provisioning.workspaceImageRepository}:${provisioning.workspaceImageTag}`,
        resources: workspaceResources,
      });
      for (const action of [
        'WORKSPACE_SERVICE_ACCOUNT_CREATED',
        'WORKSPACE_PVC_CREATED',
        'WORKSPACE_POD_CREATED',
      ]) {
        await this.audit({
          actorRef: input.actorRef,
          role: input.role,
          action,
          targetType: 'developer-environment',
          targetId: provisioning.id,
          payload: {
            workspaceId: provisioning.id,
            componentId: provisioning.componentId,
          },
        });
      }
      const starting = await this.updateWorkspaceStatusRecord({
        environment: provisioning,
        status: 'STARTING',
        statusMessage: 'Workspace pod is starting.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_STARTING',
      });
      return this.updateWorkspaceStatusRecord({
        environment: starting,
        status: 'READY',
        statusMessage: 'Workspace pod and persistent storage are ready.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_READY',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.updateWorkspaceStatusRecord({
        environment: record,
        status: 'FAILED',
        statusMessage: 'Workspace provisioning failed.',
        failureReason: message,
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_FAILED',
      });
    }
  }

  async createDeveloperEnvironment(input: {
    request: CreateDeveloperEnvironmentRequest;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperEnvironmentRecord> {
    return this.createWorkspace(input);
  }

  async deleteWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<WorkspaceRecord | null> {
    await this.init();

    const existing = await this.getDeveloperEnvironment(input.id);
    if (!existing) {
      return null;
    }

    const deleting = await this.updateWorkspaceStatusRecord({
      environment: existing,
      status: 'DELETING',
      statusMessage: 'Deleting workspace Kubernetes resources.',
      actorRef: input.actorRef,
      role: input.role,
      action: 'WORKSPACE_DELETE_REQUESTED',
    });
    try {
      await this.workspaceProvisioner.deleteWorkspace(
        this.workspaceResourceNames(deleting),
      );
      return this.updateWorkspaceStatusRecord({
        environment: deleting,
        status: 'DELETED',
        statusMessage:
          'Workspace pod, persistent storage, and service account were deleted.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_DELETED',
      });
    } catch (error) {
      return this.updateWorkspaceStatusRecord({
        environment: deleting,
        status: 'FAILED',
        statusMessage: 'Workspace cleanup failed.',
        failureReason: error instanceof Error ? error.message : String(error),
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_FAILED',
      });
    }
  }

  async deleteDeveloperEnvironment(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperEnvironmentRecord | null> {
    return this.deleteWorkspace(input);
  }

  private async updateWorkspaceStatusRecord(input: {
    environment: DeveloperEnvironmentRecord;
    status: DeveloperEnvironmentRecord['status'];
    statusMessage: string;
    failureReason?: string | null;
    actorRef: string;
    role: PersonaRole;
    action: string;
  }): Promise<DeveloperEnvironmentRecord> {
    const now = new Date().toISOString();
    const next: DeveloperEnvironmentRecord = {
      ...input.environment,
      status: input.status,
      statusMessage: input.statusMessage,
      failureReason: input.failureReason ?? input.environment.failureReason,
      updatedAt: now,
      lastTransitionAt: now,
    };

    if (this.pool) {
      await this.query(
        `
        UPDATE control_plane_developer_environments
        SET status = $2,
            status_message = $3,
          failure_reason = $4,
          updated_at = $5,
          last_transition_at = $6
        WHERE id = $1
        `,
        [
          next.id,
          next.status,
          next.statusMessage,
          next.failureReason,
          next.updatedAt,
          next.lastTransitionAt,
        ],
      );
    } else {
      this.memoryWorkspaces.set(next.id, next);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: input.action,
      targetType: 'developer-environment',
      targetId: next.id,
      payload: {
        status: next.status,
        statusMessage: next.statusMessage,
      },
    });

    return next;
  }

  private ensureWorkspaceTransitionAllowed(input: {
    current: DeveloperEnvironmentRecord['status'];
    target: 'READY' | 'STOPPED';
  }): void {
    const terminalStates: DeveloperEnvironmentRecord['status'][] = [
      'DELETED',
      'DELETING',
    ];
    if (terminalStates.includes(input.current)) {
      throw new Error(
        `WORKSPACE_STATE_INVALID: Cannot transition from terminal state ${input.current}`,
      );
    }

    const allowedToReady: DeveloperEnvironmentRecord['status'][] = [
      'REQUESTED',
      'PROVISIONING',
      'FAILED',
      'STOPPED',
      'READY',
    ];
    const allowedToStopped: DeveloperEnvironmentRecord['status'][] = [
      'READY',
      'REQUESTED',
      'PROVISIONING',
      'FAILED',
      'STOPPED',
    ];

    const allowed =
      input.target === 'READY' ? allowedToReady : allowedToStopped;
    if (!allowed.includes(input.current)) {
      throw new Error(
        `WORKSPACE_STATE_INVALID: Transition ${input.current} -> ${input.target} is not allowed`,
      );
    }
  }

  async startWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<WorkspaceRecord> {
    return this.resumeWorkspace(input);
  }

  async resumeWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<WorkspaceRecord> {
    await this.init();
    const existing = await this.getDeveloperEnvironment(input.id);
    if (!existing) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }

    this.ensureWorkspaceTransitionAllowed({
      current: existing.status,
      target: 'READY',
    });
    if (existing.status === 'READY') return existing;

    const starting = await this.updateWorkspaceStatusRecord({
      environment: existing,
      status: 'STARTING',
      statusMessage:
        'Resuming workspace pod using existing persistent storage.',
      actorRef: input.actorRef,
      role: input.role,
      action: 'WORKSPACE_RESUME_REQUESTED',
    });
    try {
      await this.workspaceProvisioner.resumeWorkspace(
        this.workspaceProvisioningInput(starting),
      );
      return this.updateWorkspaceStatusRecord({
        environment: starting,
        status: 'READY',
        statusMessage: 'Workspace resumed from saved state and is ready.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_RESUMED',
      });
    } catch (error) {
      return this.updateWorkspaceStatusRecord({
        environment: starting,
        status: 'FAILED',
        statusMessage: 'Workspace resume failed.',
        failureReason: error instanceof Error ? error.message : String(error),
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_FAILED',
      });
    }
  }

  async startDeveloperWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperEnvironmentRecord> {
    return this.resumeWorkspace(input);
  }

  async resumeDeveloperWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperEnvironmentRecord> {
    return this.resumeWorkspace(input);
  }

  async stopWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<WorkspaceRecord> {
    await this.init();
    const existing = await this.getDeveloperEnvironment(input.id);
    if (!existing) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }

    this.ensureWorkspaceTransitionAllowed({
      current: existing.status,
      target: 'STOPPED',
    });
    if (existing.status === 'STOPPED') return existing;

    const stopping = await this.updateWorkspaceStatusRecord({
      environment: existing,
      status: 'STOPPING',
      statusMessage:
        'Removing workspace pod while retaining persistent storage.',
      actorRef: input.actorRef,
      role: input.role,
      action: 'WORKSPACE_STOP_REQUESTED',
    });
    try {
      await this.workspaceProvisioner.stopWorkspace(
        this.workspaceResourceNames(stopping),
      );
      return this.updateWorkspaceStatusRecord({
        environment: stopping,
        status: 'STOPPED',
        statusMessage: 'Workspace pod stopped; persistent storage retained.',
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_STOPPED',
      });
    } catch (error) {
      return this.updateWorkspaceStatusRecord({
        environment: stopping,
        status: 'FAILED',
        statusMessage: 'Workspace stop failed.',
        failureReason: error instanceof Error ? error.message : String(error),
        actorRef: input.actorRef,
        role: input.role,
        action: 'WORKSPACE_FAILED',
      });
    }
  }

  async stopDeveloperWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperEnvironmentRecord> {
    return this.stopWorkspace(input);
  }

  private workspaceResourceNames(workspace: WorkspaceRecord) {
    if (
      !workspace.workspacePodName ||
      !workspace.workspacePvcName ||
      !workspace.workspaceServiceAccountName
    ) {
      throw new Error('WORKSPACE_RESOURCE_NAMES_MISSING');
    }
    return {
      podName: workspace.workspacePodName,
      pvcName: workspace.workspacePvcName,
      serviceAccountName: workspace.workspaceServiceAccountName,
    };
  }

  private workspaceProvisioningInput(workspace: WorkspaceRecord) {
    const resourceProfile = RESOURCE_PROFILES.find(
      profile => profile.id === workspace.resourceProfile,
    );
    if (!resourceProfile)
      throw new Error(`RESOURCE_PROFILE_INVALID: ${workspace.resourceProfile}`);
    return {
      workspaceId: workspace.id,
      componentId: workspace.componentId,
      developmentProfileId: workspace.developmentProfileId,
      developerRef: workspace.requestedBy,
      dependencies: {
        postgresql: Boolean(
          workspace.platformServices?.dependencies?.postgresql,
        ),
        kafka: Boolean(workspace.platformServices?.dependencies?.kafka),
      },
      resourceProfile,
      image: `${workspace.workspaceImageRegistry}/${workspace.workspaceImageRepository}:${workspace.workspaceImageTag}`,
      resources: this.workspaceResourceNames(workspace),
    };
  }

  private profileWorkspaceOrThrow(
    profile: DevelopmentProfile,
  ): DevelopmentProfileWorkspaceConfig {
    const workspace = profile.workspaceConfiguration;
    if (!workspace) {
      throw new Error(
        `WORKSPACE_CONFIGURATION_MISSING: Development profile ${profile.id} has no workspace configuration`,
      );
    }
    return workspace;
  }

  private workspaceImageForComponent(input: {
    componentDomain: string;
    profileWorkspace: DevelopmentProfileWorkspaceConfig;
  }): DevelopmentProfileWorkspaceConfig['image'] {
    const templateKey = resolveDomainTemplateKey(input.componentDomain);
    if (!templateKey) {
      return input.profileWorkspace.image;
    }

    const templateImage = DOMAIN_WORKSPACE_IMAGE_MAP[templateKey];
    return {
      registry: DEV_IMAGE_REGISTRY,
      repository: templateImage.repository,
      tag: templateImage.tag,
    };
  }

  private buildDevContainerDefinition(input: {
    environment: DeveloperEnvironmentRecord;
    componentDisplayName: string;
    profileWorkspace: DevelopmentProfileWorkspaceConfig;
    imageOverride?: DevelopmentProfileWorkspaceConfig['image'];
  }): DevContainerDefinition {
    const imageRef = input.imageOverride ?? input.profileWorkspace.image;
    const image = `${imageRef.registry}/${imageRef.repository}:${imageRef.tag}`;

    return {
      name: `${input.componentDisplayName} Developer Workspace`,
      image,
      remoteUser: input.profileWorkspace.remoteUser,
      workspaceFolder: input.profileWorkspace.workspaceFolder,
      customizations: {
        vscode: {
          extensions: input.profileWorkspace.vscode.extensions,
          settings: input.profileWorkspace.vscode.settings,
        },
      },
      containerEnv: input.profileWorkspace.environmentVariables,
      features: input.profileWorkspace.features,
      ...(input.profileWorkspace.postCreateCommand
        ? { postCreateCommand: input.profileWorkspace.postCreateCommand }
        : {}),
    };
  }

  private parseGitHubRepository(input: {
    provider: string;
    organization: string | null;
    name: string | null;
    url: string | null;
  }): { owner: string; repo: string } | null {
    if (input.provider.toLowerCase() !== 'github') {
      return null;
    }

    if (input.organization && input.name) {
      return { owner: input.organization, repo: input.name };
    }

    if (!input.url) {
      return null;
    }

    try {
      const parsed = new URL(input.url);
      const normalizedPath = parsed.pathname
        .replace(/^\//, '')
        .replace(/\.git$/, '');
      const [owner, repo] = normalizedPath.split('/');
      if (!owner || !repo) {
        return null;
      }
      return { owner, repo };
    } catch {
      return null;
    }
  }

  private async inspectRepositoryDevContainer(input: {
    environment: DeveloperEnvironmentRecord;
    expected: DevContainerDefinition;
  }): Promise<{
    workspaceStatus: DeveloperWorkspaceStatus;
    workspaceStatusMessage: string;
    devContainerStatus: DevContainerStatus;
    repositoryIntegration: DeveloperWorkspaceRecord['repositoryIntegration'];
  }> {
    const parsedRepo = this.parseGitHubRepository({
      provider: input.environment.sourceRepositoryProvider,
      organization: input.environment.sourceRepositoryOrganization,
      name: input.environment.sourceRepositoryName,
      url: input.environment.sourceRepositoryUrl,
    });

    if (!parsedRepo) {
      return {
        workspaceStatus: 'FAILED',
        workspaceStatusMessage:
          'Repository metadata is incomplete. Configure GitHub repository organization/name or URL.',
        devContainerStatus: 'INVALID',
        repositoryIntegration: {
          mode: 'unavailable',
          canReadRepository: false,
          canCreatePullRequest: false,
          reason: 'Repository metadata is incomplete or unsupported.',
        },
      };
    }

    const token =
      process.env.GITHUB_PAT ??
      process.env.GITHUB_TOKEN ??
      process.env.GITHUB_ACTIONS_TOKEN ??
      '';
    if (!token) {
      return {
        workspaceStatus: 'NOT_CONFIGURED',
        workspaceStatusMessage:
          'GitHub token is not configured for repository validation; generated Dev Container is available for manual setup.',
        devContainerStatus: 'NOT_CONFIGURED',
        repositoryIntegration: {
          mode: 'unavailable',
          canReadRepository: false,
          canCreatePullRequest: false,
          reason:
            'GITHUB_PAT (preferred) or GITHUB_TOKEN is not configured in CloudHub backend runtime.',
        },
      };
    }

    const apiUrl = `https://api.github.com/repos/${parsedRepo.owner}/${
      parsedRepo.repo
    }/contents/.devcontainer/devcontainer.json?ref=${encodeURIComponent(
      input.environment.sourceBranch,
    )}`;
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status === 404) {
      return {
        workspaceStatus: 'NOT_CONFIGURED',
        workspaceStatusMessage:
          '.devcontainer/devcontainer.json was not found in the repository branch.',
        devContainerStatus: 'NOT_CONFIGURED',
        repositoryIntegration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason:
            'PR creation is not implemented in Phase 2 backend integration yet.',
        },
      };
    }

    if (!response.ok) {
      const text = await response.text();
      return {
        workspaceStatus: 'FAILED',
        workspaceStatusMessage: `Repository validation failed (${
          response.status
        }): ${text || response.statusText}`,
        devContainerStatus: 'INVALID',
        repositoryIntegration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason: 'Repository read failed during validation.',
        },
      };
    }

    const body = (await response.json()) as {
      content?: string;
      encoding?: string;
    };
    if (!body.content || body.encoding !== 'base64') {
      return {
        workspaceStatus: 'INVALID',
        workspaceStatusMessage:
          'Repository returned devcontainer metadata in an unsupported format.',
        devContainerStatus: 'INVALID',
        repositoryIntegration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason:
            'PR creation is not implemented in Phase 2 backend integration yet.',
        },
      };
    }

    let parsedDevContainer: any;
    try {
      const decoded = Buffer.from(
        body.content.replace(/\n/g, ''),
        'base64',
      ).toString('utf8');
      parsedDevContainer = JSON.parse(decoded);
    } catch {
      return {
        workspaceStatus: 'INVALID',
        workspaceStatusMessage:
          '.devcontainer/devcontainer.json is not valid JSON.',
        devContainerStatus: 'INVALID',
        repositoryIntegration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason:
            'PR creation is not implemented in Phase 2 backend integration yet.',
        },
      };
    }

    const expectedImage = input.expected.image;
    const sameImage = parsedDevContainer.image === expectedImage;
    const sameUser =
      parsedDevContainer.remoteUser === input.expected.remoteUser;

    if (sameImage && sameUser) {
      return {
        workspaceStatus: 'READY',
        workspaceStatusMessage:
          'Repository Dev Container is aligned with the selected Development Profile.',
        devContainerStatus: 'PLATFORM_MANAGED',
        repositoryIntegration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason:
            'PR creation is not implemented in Phase 2 backend integration yet.',
        },
      };
    }

    if (
      typeof parsedDevContainer.image === 'string' &&
      parsedDevContainer.image.length > 0 &&
      !sameImage
    ) {
      return {
        workspaceStatus: 'OUTDATED',
        workspaceStatusMessage: `Repository Dev Container image differs from profile image. Expected ${expectedImage}.`,
        devContainerStatus: 'OUTDATED',
        repositoryIntegration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason:
            'PR creation is not implemented in Phase 2 backend integration yet.',
        },
      };
    }

    return {
      workspaceStatus: 'CUSTOM',
      workspaceStatusMessage:
        'Repository contains a custom Dev Container configuration that does not match platform-managed settings.',
      devContainerStatus: 'CUSTOM',
      repositoryIntegration: {
        mode: 'read-only',
        canReadRepository: true,
        canCreatePullRequest: false,
        reason:
          'PR creation is not implemented in Phase 2 backend integration yet.',
      },
    };
  }

  private workspaceSetupInstructions(
    workspace: DeveloperWorkspaceRecord,
  ): string[] {
    return [
      `Open repository ${workspace.repository.organization ?? ''}/${
        workspace.repository.name ?? ''
      } in VS Code.`,
      'Install the Dev Containers extension if it is not already installed.',
      'Run Reopen in Container from the VS Code command palette.',
      `VS Code will pull ${workspace.devContainerImage}.`,
      'After container startup, install application dependencies using repository-standard commands.',
      'Run local build/test/dev commands defined by the application repository.',
      'Authenticate at runtime with enterprise identity for Azure CLI and Kubernetes access (no credentials are baked into the image).',
    ];
  }

  private async persistWorkspaceState(input: {
    environment: DeveloperEnvironmentRecord;
    workspaceStatus: DeveloperWorkspaceStatus;
    workspaceStatusMessage: string;
    devContainerStatus: DevContainerStatus;
    validatedAt: string;
  }): Promise<DeveloperEnvironmentRecord> {
    const next: DeveloperEnvironmentRecord = {
      ...input.environment,
      workspaceStatus: input.workspaceStatus,
      workspaceStatusMessage: input.workspaceStatusMessage,
      workspaceDevContainerStatus: input.devContainerStatus,
      workspaceLastValidatedAt: input.validatedAt,
      updatedAt: input.validatedAt,
    };

    if (this.pool) {
      await this.query(
        `
        UPDATE control_plane_developer_environments
        SET workspace_status = $2,
            workspace_status_message = $3,
            workspace_devcontainer_status = $4,
            workspace_last_validated_at = $5,
            updated_at = $6
        WHERE id = $1
        `,
        [
          next.id,
          next.workspaceStatus,
          next.workspaceStatusMessage,
          next.workspaceDevContainerStatus,
          next.workspaceLastValidatedAt,
          next.updatedAt,
        ],
      );
    } else {
      this.memoryWorkspaces.set(next.id, next);
    }

    return next;
  }

  async getWorkspaceWorkspace(input: {
    id: string;
  }): Promise<DeveloperWorkspaceRecord> {
    await this.init();

    const environment = await this.getDeveloperEnvironment(input.id);
    if (!environment) {
      throw new Error('WORKSPACE_ENVIRONMENT_NOT_FOUND');
    }

    const profile = await this.getDevelopmentProfile(
      environment.developmentProfileId,
    );
    if (!profile) {
      throw new Error('WORKSPACE_PROFILE_NOT_FOUND');
    }

    const component = getSriCatalogComponent(environment.componentId);
    if (!component) {
      throw new Error('WORKSPACE_COMPONENT_NOT_FOUND');
    }

    const profileWorkspace = this.profileWorkspaceOrThrow(profile);
    const expectedDevContainer = this.buildDevContainerDefinition({
      environment,
      componentDisplayName: environment.componentDisplayName,
      profileWorkspace,
      imageOverride: {
        registry: environment.workspaceImageRegistry,
        repository: environment.workspaceImageRepository,
        tag: environment.workspaceImageTag,
      },
    });

    const inspection = await this.inspectRepositoryDevContainer({
      environment,
      expected: expectedDevContainer,
    });

    return {
      environmentId: environment.id,
      componentId: environment.componentId,
      componentDisplayName: environment.componentDisplayName,
      developmentProfileId: environment.developmentProfileId,
      developmentProfileVersion: environment.developmentProfileVersion,
      repository: {
        provider: environment.sourceRepositoryProvider,
        organization: environment.sourceRepositoryOrganization,
        name: environment.sourceRepositoryName,
        url: environment.sourceRepositoryUrl,
      },
      branch: environment.sourceBranch,
      workspaceType: 'devcontainer',
      workspaceStatus: inspection.workspaceStatus,
      workspaceStatusMessage: inspection.workspaceStatusMessage,
      workspaceProfileVersion: environment.workspaceProfileVersion,
      devContainerStatus: inspection.devContainerStatus,
      devContainerPath: '.devcontainer/devcontainer.json',
      devContainerImage: expectedDevContainer.image,
      devContainer: expectedDevContainer,
      recommendedExtensions:
        expectedDevContainer.customizations.vscode.extensions,
      workspaceFolder: expectedDevContainer.workspaceFolder,
      platformCapabilities: profileWorkspace.tools,
      setupInstructions: this.workspaceSetupInstructions({
        environmentId: environment.id,
        componentId: environment.componentId,
        componentDisplayName: environment.componentDisplayName,
        developmentProfileId: environment.developmentProfileId,
        developmentProfileVersion: environment.developmentProfileVersion,
        repository: {
          provider: environment.sourceRepositoryProvider,
          organization: environment.sourceRepositoryOrganization,
          name: environment.sourceRepositoryName,
          url: environment.sourceRepositoryUrl,
        },
        branch: environment.sourceBranch,
        workspaceType: 'devcontainer',
        workspaceStatus: inspection.workspaceStatus,
        workspaceStatusMessage: inspection.workspaceStatusMessage,
        workspaceProfileVersion: environment.workspaceProfileVersion,
        devContainerStatus: inspection.devContainerStatus,
        devContainerPath: '.devcontainer/devcontainer.json',
        devContainerImage: expectedDevContainer.image,
        devContainer: expectedDevContainer,
        recommendedExtensions:
          expectedDevContainer.customizations.vscode.extensions,
        workspaceFolder: expectedDevContainer.workspaceFolder,
        platformCapabilities: profileWorkspace.tools,
        setupInstructions: [],
        repositoryIntegration: inspection.repositoryIntegration,
        workspaceLastValidatedAt: environment.workspaceLastValidatedAt,
      }),
      repositoryIntegration: inspection.repositoryIntegration,
      workspaceLastValidatedAt: environment.workspaceLastValidatedAt,
    };
  }

  async getDeveloperEnvironmentWorkspace(input: {
    id: string;
  }): Promise<DeveloperWorkspaceRecord> {
    return this.getWorkspaceWorkspace(input);
  }

  async validateWorkspaceWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperWorkspaceRecord> {
    const workspace = await this.getWorkspaceWorkspace({ id: input.id });
    const environment = await this.getDeveloperEnvironment(input.id);
    if (!environment) {
      throw new Error('WORKSPACE_ENVIRONMENT_NOT_FOUND');
    }

    const validatedAt = new Date().toISOString();
    await this.persistWorkspaceState({
      environment,
      workspaceStatus: workspace.workspaceStatus,
      workspaceStatusMessage:
        workspace.workspaceStatusMessage ?? 'Workspace validation completed.',
      devContainerStatus: workspace.devContainerStatus,
      validatedAt,
    });

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'developer-workspace-validate',
      targetType: 'developer-environment',
      targetId: input.id,
      payload: {
        workspaceStatus: workspace.workspaceStatus,
        devContainerStatus: workspace.devContainerStatus,
        image: workspace.devContainerImage,
      },
    });

    return {
      ...workspace,
      workspaceLastValidatedAt: validatedAt,
    };
  }

  async validateDeveloperEnvironmentWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<DeveloperWorkspaceRecord> {
    return this.validateWorkspaceWorkspace(input);
  }

  async generateWorkspaceWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GenerateWorkspaceResult> {
    const workspace = await this.getWorkspaceWorkspace({ id: input.id });
    const content = JSON.stringify(workspace.devContainer, null, 2);

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'developer-workspace-generate',
      targetType: 'developer-environment',
      targetId: input.id,
      payload: {
        profile: workspace.developmentProfileId,
        image: workspace.devContainerImage,
        repository: workspace.repository,
      },
    });

    return {
      workspace,
      generatedFiles: [
        {
          path: '.devcontainer/devcontainer.json',
          content,
          mediaType: 'application/json',
        },
      ],
      repositoryUpdate: {
        mode: 'manual',
        instructions: [
          'Create a feature branch in the application repository.',
          'Add .devcontainer/devcontainer.json using the generated content.',
          'Commit and open a pull request for application-team review.',
          'After merge, run workspace validation in CloudHub again.',
        ],
      },
    };
  }

  async generateDeveloperEnvironmentWorkspace(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GenerateWorkspaceResult> {
    return this.generateWorkspaceWorkspace(input);
  }

  private decodeGithubContent(content: string): string {
    return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
  }

  private appImageRepository(componentId: string): string {
    const trimmed = componentId.replace(/^sri-/, '');
    return `sri/${trimmed}`;
  }

  private appImageRegistry(): string {
    return (
      process.env.CLOUDHUB_APP_IMAGE_REGISTRY ??
      process.env.ACR_LOGIN_SERVER ??
      'companyacr.azurecr.io'
    );
  }

  private releaseName(componentId: string): string {
    return componentId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 53);
  }

  private buildProfileForWorkspace(
    environment: DeveloperEnvironmentRecord,
  ): BuildProfileConfig {
    const id = environment.developmentProfileId;
    if (id.startsWith('node') || id === 'react-ui') {
      return {
        adapter: 'node',
        packageManager: 'npm',
        dependencyCommand: 'npm ci',
        lintCommand: 'npm run lint --if-present',
        buildCommand: 'npm run build --if-present',
        testCommand: 'npm test -- --ci --passWithNoTests',
      };
    }
    if (id.startsWith('python')) {
      return {
        adapter: 'python',
        packageManager: 'pip',
        dependencyCommand: 'pip install -r requirements.txt',
        lintCommand: 'ruff check .',
        buildCommand: 'python -m compileall .',
        testCommand: 'pytest',
      };
    }
    if (id.startsWith('java')) {
      return {
        adapter: 'java',
        packageManager: 'maven',
        dependencyCommand: 'mvn -B -q -DskipTests dependency:go-offline',
        lintCommand: 'mvn -B -q -DskipTests verify',
        buildCommand: 'mvn -B -DskipTests package',
        testCommand: 'mvn -B test',
      };
    }
    if (id.startsWith('scala')) {
      return {
        adapter: 'scala',
        packageManager: 'sbt',
        dependencyCommand: 'sbt update',
        lintCommand: 'sbt scalafmtCheckAll',
        buildCommand: 'sbt compile',
        testCommand: 'sbt test',
      };
    }
    return {
      adapter: 'database',
      packageManager: 'sql',
      dependencyCommand: 'echo "No dependency restore required"',
      lintCommand: 'echo "No lint adapter configured"',
      buildCommand: 'echo "No build adapter configured"',
      testCommand: 'echo "No tests adapter configured"',
    };
  }

  private deploymentProfileForWorkspace(
    environment: DeveloperEnvironmentRecord,
  ): DeploymentProfileConfig {
    return {
      packaging: 'helm',
      branchPolicy: {
        mode: 'allow-list',
        allowedBranches: [environment.sourceBranch, 'main'],
      },
      service: {
        port: 80,
        targetPort: 8080,
      },
      health: {
        readinessPath: '/health/ready',
        livenessPath: '/health/live',
      },
    };
  }

  private ciWorkflowTemplate(input: {
    componentId: string;
    buildProfile: BuildProfileConfig;
  }): string {
    return [
      'name: Application CI',
      '',
      'on:',
      '  push:',
      '  pull_request:',
      '',
      'jobs:',
      '  ci:',
      `    uses: ${PLATFORM_WORKFLOW_REPO}/.github/workflows/application-ci.yml@${PLATFORM_WORKFLOW_REF}`,
      '    with:',
      `      component-id: ${input.componentId}`,
      `      build-adapter: ${input.buildProfile.adapter}`,
    ].join('\n');
  }

  private deployWorkflowTemplate(input: {
    componentId: string;
    allowedBranches: string[];
  }): string {
    const firstBranch = input.allowedBranches[0] ?? 'main';
    return [
      'name: Deploy Shared Dev',
      '',
      'on:',
      '  push:',
      '    branches:',
      `      - ${firstBranch}`,
      '  workflow_dispatch:',
      '    inputs:',
      '      branch:',
      '        description: Branch to deploy',
      '        required: false',
      '        default: main',
      '',
      'concurrency:',
      `  group: deploy-${input.componentId}-shared-dev`,
      '  cancel-in-progress: true',
      '',
      'jobs:',
      '  deploy:',
      `    uses: ${PLATFORM_WORKFLOW_REPO}/.github/workflows/deploy-aks-dev.yml@${PLATFORM_WORKFLOW_REF}`,
      '    with:',
      `      component-id: ${input.componentId}`,
      '      source-branch: ${{ github.event.inputs.branch || github.ref_name }}',
    ].join('\n');
  }

  private async inspectRepositoryCiWorkflow(input: {
    environment: DeveloperEnvironmentRecord;
    expectedCi: string;
    expectedDeploy: string;
  }): Promise<{
    status: CiWorkflowStatus;
    message: string;
    integration: CiWorkflowRecord['repositoryIntegration'];
  }> {
    const parsedRepo = this.parseGitHubRepository({
      provider: input.environment.sourceRepositoryProvider,
      organization: input.environment.sourceRepositoryOrganization,
      name: input.environment.sourceRepositoryName,
      url: input.environment.sourceRepositoryUrl,
    });

    if (!parsedRepo) {
      return {
        status: 'FAILED',
        message:
          'Repository metadata is incomplete for CI workflow validation.',
        integration: {
          mode: 'unavailable',
          canReadRepository: false,
          canCreatePullRequest: false,
          reason: 'Repository metadata is incomplete or unsupported.',
        },
      };
    }

    const token =
      process.env.GITHUB_PAT ??
      process.env.GITHUB_TOKEN ??
      process.env.GITHUB_ACTIONS_TOKEN ??
      '';
    if (!token) {
      return {
        status: 'NOT_CONFIGURED',
        message:
          'GitHub token is not configured for repository workflow validation.',
        integration: {
          mode: 'unavailable',
          canReadRepository: false,
          canCreatePullRequest: false,
          reason:
            'GITHUB_PAT (preferred) or GITHUB_TOKEN is not configured in CloudHub backend runtime.',
        },
      };
    }

    const fetchFile = async (path: string) => {
      const url = `https://api.github.com/repos/${parsedRepo.owner}/${
        parsedRepo.repo
      }/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(
        input.environment.sourceBranch,
      )}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Repository workflow read failed (${response.status}): ${
            text || response.statusText
          }`,
        );
      }
      const body = (await response.json()) as {
        content?: string;
        encoding?: string;
      };
      if (!body.content || body.encoding !== 'base64') {
        throw new Error(
          `Repository workflow ${path} returned unsupported content format`,
        );
      }
      return this.decodeGithubContent(body.content);
    };

    try {
      const [ci, deploy] = await Promise.all([
        fetchFile('.github/workflows/ci.yml'),
        fetchFile('.github/workflows/deploy-dev.yml'),
      ]);

      if (!ci && !deploy) {
        return {
          status: 'NOT_CONFIGURED',
          message: 'Thin platform-managed workflows are missing.',
          integration: {
            mode: 'read-only',
            canReadRepository: true,
            canCreatePullRequest: false,
            reason: 'PR creation is not implemented yet.',
          },
        };
      }

      if ((ci && !deploy) || (!ci && deploy)) {
        return {
          status: 'CONFLICT',
          message:
            'Only one of the required workflow files exists (.github/workflows/ci.yml and deploy-dev.yml).',
          integration: {
            mode: 'read-only',
            canReadRepository: true,
            canCreatePullRequest: false,
            reason: 'PR creation is not implemented yet.',
          },
        };
      }

      const ciManaged =
        ci?.includes(
          `${PLATFORM_WORKFLOW_REPO}/.github/workflows/application-ci.yml@${PLATFORM_WORKFLOW_REF}`,
        ) ?? false;
      const deployManaged =
        deploy?.includes(
          `${PLATFORM_WORKFLOW_REPO}/.github/workflows/deploy-aks-dev.yml@${PLATFORM_WORKFLOW_REF}`,
        ) ?? false;

      if (ciManaged && deployManaged) {
        return {
          status: 'PLATFORM_MANAGED',
          message:
            'Repository workflows are aligned with platform-managed CI/CD v1.',
          integration: {
            mode: 'read-only',
            canReadRepository: true,
            canCreatePullRequest: false,
            reason: 'PR creation is not implemented yet.',
          },
        };
      }

      const ciOutdated =
        ci?.includes('/.github/workflows/application-ci.yml@main') ?? false;
      const deployOutdated =
        deploy?.includes('/.github/workflows/deploy-aks-dev.yml@main') ?? false;
      if (ciOutdated || deployOutdated) {
        return {
          status: 'OUTDATED',
          message:
            'Workflows are present but pinned to non-versioned references.',
          integration: {
            mode: 'read-only',
            canReadRepository: true,
            canCreatePullRequest: false,
            reason: 'PR creation is not implemented yet.',
          },
        };
      }

      if (ci?.trim().length && deploy?.trim().length) {
        return {
          status: 'CUSTOM',
          message:
            'Repository has custom workflow files that differ from platform-managed templates.',
          integration: {
            mode: 'read-only',
            canReadRepository: true,
            canCreatePullRequest: false,
            reason: 'PR creation is not implemented yet.',
          },
        };
      }

      return {
        status: 'INVALID',
        message: 'Workflow files are present but invalid or empty.',
        integration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason: 'PR creation is not implemented yet.',
        },
      };
    } catch (error) {
      return {
        status: 'FAILED',
        message: error instanceof Error ? error.message : String(error),
        integration: {
          mode: 'read-only',
          canReadRepository: true,
          canCreatePullRequest: false,
          reason: 'Repository read failed during workflow validation.',
        },
      };
    }
  }

  async getWorkspaceCiWorkflow(input: {
    id: string;
  }): Promise<CiWorkflowRecord> {
    await this.init();

    const environment = await this.getDeveloperEnvironment(input.id);
    if (!environment) {
      throw new Error('CI_ENVIRONMENT_NOT_FOUND');
    }

    const buildProfile = this.buildProfileForWorkspace(environment);
    const deployment = this.deploymentProfileForWorkspace(environment);
    const container = {
      dockerfile: 'Dockerfile',
      context: '.',
    };

    const ciContent = this.ciWorkflowTemplate({
      componentId: environment.componentId,
      buildProfile,
    });

    const deployContent = this.deployWorkflowTemplate({
      componentId: environment.componentId,
      allowedBranches: deployment.branchPolicy.allowedBranches,
    });

    const inspection = await this.inspectRepositoryCiWorkflow({
      environment,
      expectedCi: ciContent,
      expectedDeploy: deployContent,
    });

    return {
      environmentId: environment.id,
      componentId: environment.componentId,
      repository: {
        provider: environment.sourceRepositoryProvider,
        organization: environment.sourceRepositoryOrganization,
        name: environment.sourceRepositoryName,
        url: environment.sourceRepositoryUrl,
      },
      branchPolicy: deployment.branchPolicy,
      workflowStatus: inspection.status,
      workflowStatusMessage: inspection.message,
      ciWorkflowPath: '.github/workflows/ci.yml',
      deployWorkflowPath: '.github/workflows/deploy-dev.yml',
      buildProfile,
      container,
      deployment,
      generatedFiles: [
        {
          path: '.github/workflows/ci.yml',
          content: ciContent,
          mediaType: 'text/yaml',
        },
        {
          path: '.github/workflows/deploy-dev.yml',
          content: deployContent,
          mediaType: 'text/yaml',
        },
      ],
      repositoryIntegration: inspection.integration,
      workflowLastValidatedAt: null,
    };
  }

  async getDeveloperEnvironmentCiWorkflow(input: {
    id: string;
  }): Promise<CiWorkflowRecord> {
    return this.getWorkspaceCiWorkflow(input);
  }

  async validateWorkspaceCiWorkflow(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<CiWorkflowRecord> {
    const workflow = await this.getWorkspaceCiWorkflow({ id: input.id });
    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'developer-ci-workflow-validate',
      targetType: 'developer-environment',
      targetId: input.id,
      payload: {
        status: workflow.workflowStatus,
        repository: workflow.repository,
      },
    });
    return {
      ...workflow,
      workflowLastValidatedAt: new Date().toISOString(),
    };
  }

  async validateDeveloperEnvironmentCiWorkflow(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<CiWorkflowRecord> {
    return this.validateWorkspaceCiWorkflow(input);
  }

  async generateWorkspaceCiWorkflow(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GenerateCiWorkflowResult> {
    const workflow = await this.getWorkspaceCiWorkflow({ id: input.id });

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'developer-ci-workflow-generate',
      targetType: 'developer-environment',
      targetId: input.id,
      payload: {
        status: workflow.workflowStatus,
        repository: workflow.repository,
      },
    });

    return {
      workflow,
      repositoryUpdate: {
        mode: 'manual',
        instructions: [
          'Create a feature branch in the application repository.',
          'Add .github/workflows/ci.yml using generated content.',
          'Add .github/workflows/deploy-dev.yml using generated content.',
          'Open a pull request and merge after review.',
          'Re-run CI workflow validation in CloudHub.',
        ],
      },
    };
  }

  async generateDeveloperEnvironmentCiWorkflow(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GenerateCiWorkflowResult> {
    return this.generateWorkspaceCiWorkflow(input);
  }

  private pipelineStagesForStatus(
    status: ApplicationDeploymentStatus,
  ): DeploymentPipelineStage[] {
    const stages: DeploymentPipelineStage[] = [
      { id: 'SOURCE', status: 'SUCCESS' },
      { id: 'BUILD', status: 'PENDING' },
      { id: 'TEST', status: 'PENDING' },
      { id: 'SECURITY', status: 'PENDING' },
      { id: 'IMAGE', status: 'PENDING' },
      { id: 'DEPLOY', status: 'PENDING' },
      { id: 'VERIFY', status: 'PENDING' },
    ];

    if (status === 'QUEUED') {
      stages[1].status = 'RUNNING';
    } else if (status === 'DEPLOYING' || status === 'BUILDING') {
      stages[1].status = 'SUCCESS';
      stages[2].status = 'SUCCESS';
      stages[3].status = 'SUCCESS';
      stages[4].status = 'SUCCESS';
      stages[5].status = 'RUNNING';
    } else if (status === 'READY') {
      for (const stage of stages) {
        stage.status = 'SUCCESS';
      }
    } else if (status === 'FAILED' || status === 'BUILD_FAILED') {
      stages[1].status = 'FAILED';
    }

    return stages;
  }

  private parseApplicationDeploymentRow(row: any): ApplicationDeploymentRecord {
    return {
      id: row.id,
      developerEnvironmentId:
        row.developerEnvironmentId ?? row.developer_environment_id,
      componentId: row.componentId ?? row.component_id,
      repository: row.repository,
      branch: row.branch,
      commitSha: row.commitSha ?? row.commit_sha,
      imageRepository: row.imageRepository ?? row.image_repository,
      imageTag: row.imageTag ?? row.image_tag,
      imageDigest: row.imageDigest ?? row.image_digest,
      clusterId: row.clusterId ?? row.cluster_id,
      clusterName: row.clusterName ?? row.cluster_name,
      namespace: row.namespace,
      releaseName: row.releaseName ?? row.release_name,
      deploymentStrategy: row.deploymentStrategy ?? row.deployment_strategy,
      executorType: row.executorType ?? row.executor_type,
      status: row.status,
      statusMessage: row.statusMessage ?? row.status_message,
      failureReason: row.failureReason ?? row.failure_reason,
      endpointUrl: row.endpointUrl ?? row.endpoint_url,
      workflowRunId: row.workflowRunId ?? row.workflow_run_id,
      workflowRunUrl: row.workflowRunUrl ?? row.workflow_run_url,
      pipelineStages:
        typeof row.pipelineStages === 'string'
          ? JSON.parse(row.pipelineStages)
          : row.pipelineStages ?? row.pipeline_stages ?? [],
      requestedBy: row.requestedBy ?? row.requested_by,
      startedAt: row.startedAt ?? row.started_at,
      completedAt: row.completedAt ?? row.completed_at,
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
    };
  }

  private endpointUrlForDeployment(
    environment: DeveloperEnvironmentRecord,
  ): string | null {
    if (!environment.platformServices?.ingress?.enabled) {
      return null;
    }

    const baseDomain = process.env.CLOUDHUB_DEV_BASE_DOMAIN;
    if (!baseDomain) {
      return null;
    }

    return `https://${environment.componentId}.${environment.namespace}.${baseDomain}`;
  }

  async listApplicationDeployments(input: {
    developerEnvironmentId?: string;
    componentId?: string;
    clusterName?: string;
  }): Promise<ApplicationDeploymentRecord[]> {
    await this.init();

    if (this.pool) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (input.developerEnvironmentId) {
        params.push(input.developerEnvironmentId);
        filters.push(`developer_environment_id = $${params.length}`);
      }
      if (input.componentId) {
        params.push(input.componentId);
        filters.push(`component_id = $${params.length}`);
      }
      if (input.clusterName) {
        params.push(input.clusterName);
        filters.push(`cluster_name = $${params.length}`);
      }
      const whereClause =
        filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = await this.query<any>(
        `
        SELECT
          id,
          developer_environment_id AS "developerEnvironmentId",
          component_id AS "componentId",
          repository,
          branch,
          commit_sha AS "commitSha",
          image_repository AS "imageRepository",
          image_tag AS "imageTag",
          image_digest AS "imageDigest",
          cluster_id AS "clusterId",
          cluster_name AS "clusterName",
          namespace,
          release_name AS "releaseName",
          deployment_strategy AS "deploymentStrategy",
          executor_type AS "executorType",
          status,
          status_message AS "statusMessage",
          failure_reason AS "failureReason",
          endpoint_url AS "endpointUrl",
          workflow_run_id AS "workflowRunId",
          workflow_run_url AS "workflowRunUrl",
          pipeline_stages AS "pipelineStages",
          requested_by AS "requestedBy",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM control_plane_application_deployments
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT 100
        `,
        params,
      );
      return rows.map(row => this.parseApplicationDeploymentRow(row));
    }

    return Array.from(this.memoryApplicationDeployments.values())
      .filter(
        item =>
          !input.developerEnvironmentId ||
          item.developerEnvironmentId === input.developerEnvironmentId,
      )
      .filter(
        item => !input.componentId || item.componentId === input.componentId,
      )
      .filter(
        item => !input.clusterName || item.clusterName === input.clusterName,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getCommonResPreflight(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
    namespace?: string;
  }): Promise<{
    ready: boolean;
    checkedAt: string;
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
    namespace: string | null;
    namespaceExists: boolean;
    registrySecretName: string | null;
    registrySecretType: string | null;
    message: string;
  }> {
    await this.init();

    const clusterName = input.clusterName.trim();
    const subscriptionId = input.subscriptionId.trim();
    const resourceGroup = input.resourceGroup.trim();
    if (!clusterName) {
      throw new Error('clusterName is required for common-res preflight');
    }
    if (!subscriptionId) {
      throw new Error('subscriptionId is required for common-res preflight');
    }
    if (!resourceGroup) {
      throw new Error('resourceGroup is required for common-res preflight');
    }

    const namespace = input.namespace?.trim() || 'common-res';
    const coreApi = await this.getClusterCoreApi({
      subscriptionId,
      resourceGroup,
      clusterName,
    });

    let namespaceExists = false;
    try {
      await coreApi.readNamespace({ name: namespace });
      namespaceExists = true;
    } catch (error) {
      const statusCode = this.statusCode(error);
      if (statusCode !== 404) {
        throw error;
      }
    }

    const registrySecretNames = [
      'regcred',
      'regcred-acr',
      'symphonyfs-acr-secret',
    ] as const;
    let registrySecretName: string | null = null;
    let registrySecretType: string | null = null;

    for (const candidate of registrySecretNames) {
      try {
        const response = await coreApi.readNamespacedSecret({
          name: candidate,
          namespace,
        });
        const secret =
          'body' in (response as object)
            ? (response as { body: k8s.V1Secret }).body
            : (response as k8s.V1Secret);
        const hasDockerConfig = Boolean(
          secret.data?.['.dockerconfigjson'] ||
            secret.stringData?.['.dockerconfigjson'],
        );
        if (hasDockerConfig) {
          registrySecretName = candidate;
          registrySecretType = secret.type ?? 'kubernetes.io/dockerconfigjson';
          break;
        }
      } catch (error) {
        if (this.statusCode(error) !== 404) {
          throw error;
        }
      }
    }

    const ready = namespaceExists && Boolean(registrySecretName);

    return {
      ready,
      checkedAt: new Date().toISOString(),
      subscriptionId,
      resourceGroup,
      clusterName,
      namespace,
      namespaceExists,
      registrySecretName,
      registrySecretType,
      message: ready
        ? `common-res bootstrap looks ready on ${clusterName} (${namespace}); found ${registrySecretName}.`
        : `${
            namespaceExists ? 'Namespace exists' : 'Namespace is missing'
          } and no registry secret (regcred / ACR token) was found in ${namespace} on ${clusterName}. If this is a new cluster or namespace, deploy common-res first before continuing.`,
    };
  }

  /**
   * Reconciles the three independent "does this already exist" signals that
   * are otherwise checked separately and never compared against each other:
   * the app instance directory in the scripts repo (verifyAppInstanceExists),
   * the pinned chart version in 1Password's pipeline_refs
   * (getPipelineRefValue), and — once a cluster is selected — the Kubernetes
   * namespace itself. Together they classify a deployment as a fresh install
   * vs. an upgrade/rollback/no-op version change, so the wizard can show the
   * right required-steps checklist instead of leaving the user to guess.
   */
  async detectDeploymentMode(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    targetChartVersion?: string;
    clusterName?: string;
    subscriptionId?: string;
    resourceGroup?: string;
  }): Promise<DeploymentModeDetection> {
    await this.init();

    const application = input.application.trim();
    const instanceName = input.instanceName.trim();
    const customer = input.customer.trim();
    const targetChartVersion = input.targetChartVersion?.trim() || null;

    if (!application || !instanceName || !customer) {
      throw new Error(
        'application, instanceName, and customer are required to detect deployment mode.',
      );
    }

    const namespace = instanceName.startsWith(`${application}-`)
      ? instanceName
      : `${application}-${instanceName}`;

    const instanceCheck = await this.portal.verifyAppInstanceExists({
      application,
      instanceName,
    });
    const appInstanceExists = instanceCheck.exists;

    const currentChartVersion = await this.onePassword.getPipelineRefValue({
      customer,
      namespace,
      field: 'helm_chart_version',
      vault: input.vault,
    });

    let namespaceExists: boolean | null = null;
    if (input.clusterName && input.subscriptionId && input.resourceGroup) {
      try {
        const coreApi = await this.getClusterCoreApi({
          subscriptionId: input.subscriptionId.trim(),
          resourceGroup: input.resourceGroup.trim(),
          clusterName: input.clusterName.trim(),
        });
        await coreApi.readNamespace({ name: namespace });
        namespaceExists = true;
      } catch (error) {
        const statusCode = this.statusCode(error);
        if (statusCode === 404) {
          namespaceExists = false;
        } else {
          this.logger.warn(
            `[deployment-control-plane] Namespace existence check failed for '${namespace}' while detecting deployment mode: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    const isFreshInstall =
      !appInstanceExists && !currentChartVersion && namespaceExists !== true;

    let mode: DeploymentMode;
    let requiredSteps: string[];

    if (isFreshInstall) {
      mode = 'FRESH_INSTALL';
      requiredSteps = [
        'Create the 1Password customer section and generate infrastructure passwords / dev TLS certs',
        'Seed pipeline_refs: helm_chart_version, helm_chart_values_file_ref, project_overlay_files_ref',
        'Run helmfile diff — expect a full namespace/PVC/ingress manifest preview',
        'Run helmfile apply to provision the namespace, PVCs, and workloads',
        'Verify DNS and initial seed credentials',
      ];
    } else {
      const comparison =
        targetChartVersion && currentChartVersion
          ? compareChartVersions(targetChartVersion, currentChartVersion)
          : 0;
      mode =
        comparison < 0
          ? 'ROLLBACK'
          : comparison > 0
          ? 'UPGRADE'
          : 'CONFIGURATION_UPDATE';
      requiredSteps = [
        `Update pipeline_refs helm_chart_version: ${
          currentChartVersion ?? 'unknown'
        } → ${targetChartVersion ?? 'unset'}`,
        'Existing passwords and TLS certificates are preserved — Auto-Generate Secrets only fills in missing fields',
        'Run helmfile diff — expect only image tag / config changes, no PVC or StatefulSet destruction',
        'Run helmfile apply for a rolling update with storage preserved',
        'Trigger the update-views database migration job after rollout',
      ];
    }

    return {
      mode,
      isFreshInstall,
      appInstanceExists,
      namespaceExists,
      currentChartVersion,
      targetChartVersion,
      requiredSteps,
    };
  }

  private statusCode(error: unknown): number | undefined {
    if (error instanceof k8s.ApiException) {
      return error.code;
    }
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
    ) {
      return (error as { statusCode: number }).statusCode;
    }
    return undefined;
  }

  private async getClusterCoreApi(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<k8s.CoreV1Api> {
    const client = new ContainerServiceClient(
      this.buildAzureCredential(),
      input.subscriptionId,
    );
    const credentials = await client.managedClusters.listClusterUserCredentials(
      input.resourceGroup,
      input.clusterName,
    );
    const kubeconfig = credentials.kubeconfigs?.[0]?.value;
    if (!kubeconfig) {
      throw new Error(
        `Unable to retrieve kubeconfig for cluster ${input.clusterName}`,
      );
    }

    const kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromString(Buffer.from(kubeconfig).toString('utf8'));
    return kubeConfig.makeApiClient(k8s.CoreV1Api);
  }

  async getApplicationDeployment(input: {
    deploymentId: string;
  }): Promise<ApplicationDeploymentRecord | null> {
    await this.init();

    if (this.pool) {
      const rows = await this.query<any>(
        `
        SELECT
          id,
          developer_environment_id AS "developerEnvironmentId",
          component_id AS "componentId",
          repository,
          branch,
          commit_sha AS "commitSha",
          image_repository AS "imageRepository",
          image_tag AS "imageTag",
          image_digest AS "imageDigest",
          cluster_id AS "clusterId",
          cluster_name AS "clusterName",
          namespace,
          release_name AS "releaseName",
          deployment_strategy AS "deploymentStrategy",
          executor_type AS "executorType",
          status,
          status_message AS "statusMessage",
          failure_reason AS "failureReason",
          endpoint_url AS "endpointUrl",
          workflow_run_id AS "workflowRunId",
          workflow_run_url AS "workflowRunUrl",
          pipeline_stages AS "pipelineStages",
          requested_by AS "requestedBy",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM control_plane_application_deployments
        WHERE id = $1
        LIMIT 1
        `,
        [input.deploymentId],
      );
      return rows[0] ? this.parseApplicationDeploymentRow(rows[0]) : null;
    }

    return this.memoryApplicationDeployments.get(input.deploymentId) ?? null;
  }

  async createApplicationDeployment(input: {
    developerEnvironmentId: string;
    source: {
      branch: string;
      commitSha?: string | null;
    };
    actorRef: string;
    role: PersonaRole;
  }): Promise<ApplicationDeploymentRecord> {
    await this.init();

    const environment = await this.getDeveloperEnvironment(
      input.developerEnvironmentId,
    );
    if (!environment) {
      throw new Error('DEPLOYMENT_ENVIRONMENT_NOT_FOUND');
    }

    const branch = input.source.branch.trim();
    if (!branch) {
      throw new Error('DEPLOYMENT_BRANCH_REQUIRED');
    }

    const deploymentProfile = this.deploymentProfileForWorkspace(environment);
    if (!deploymentProfile.branchPolicy.allowedBranches.includes(branch)) {
      throw new Error(`DEPLOYMENT_BRANCH_NOT_ALLOWED: ${branch}`);
    }

    const commitSha =
      (input.source.commitSha ?? '').trim() || `manual-${Date.now()}`;
    const shortSha = commitSha.slice(0, 12).toLowerCase();
    const imageRepository = `${this.appImageRegistry()}/${this.appImageRepository(
      environment.componentId,
    )}`;
    const imageTag = shortSha;

    const deployResult = await this.deploymentExecutor.deploy({
      componentId: environment.componentId,
      workflowId:
        process.env.CLOUDHUB_APP_DEPLOY_WORKFLOW_ID ?? 'deploy-dev.yml',
      repositoryRef: `${environment.sourceRepositoryOrganization ?? ''}/${
        environment.sourceRepositoryName ?? ''
      }`,
      branch,
      inputs: {
        component_id: environment.componentId,
        environment_id: environment.id,
        cluster_name: environment.clusterName,
        namespace: environment.namespace,
        image_repository: imageRepository,
        image_tag: imageTag,
        commit_sha: commitSha,
        release_name: this.releaseName(environment.componentId),
      },
    });

    const now = new Date().toISOString();
    const record: ApplicationDeploymentRecord = {
      id: crypto.randomUUID(),
      developerEnvironmentId: environment.id,
      componentId: environment.componentId,
      repository: `${environment.sourceRepositoryOrganization ?? ''}/${
        environment.sourceRepositoryName ?? ''
      }`,
      branch,
      commitSha,
      imageRepository,
      imageTag,
      imageDigest: null,
      clusterId: environment.clusterId,
      clusterName: environment.clusterName,
      namespace: environment.namespace,
      releaseName: this.releaseName(environment.componentId),
      deploymentStrategy: 'helm-upgrade',
      executorType: this.deploymentExecutor.type,
      status: deployResult.status,
      statusMessage: deployResult.statusMessage,
      failureReason: null,
      endpointUrl: this.endpointUrlForDeployment(environment),
      workflowRunId: deployResult.workflowRunId,
      workflowRunUrl: deployResult.workflowRunUrl,
      pipelineStages: deployResult.pipelineStages,
      requestedBy: input.actorRef,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_application_deployments
          (
            id, developer_environment_id, component_id, repository, branch, commit_sha,
            image_repository, image_tag, image_digest, cluster_id, cluster_name,
            namespace, release_name, deployment_strategy, executor_type, status,
            status_message, failure_reason, endpoint_url, workflow_run_id,
            workflow_run_url, pipeline_stages, requested_by, started_at,
            completed_at, created_at, updated_at
          )
        VALUES
          (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16,
            $17, $18, $19, $20,
            $21, $22::jsonb, $23, $24,
            $25, $26, $27
          )
        `,
        [
          record.id,
          record.developerEnvironmentId,
          record.componentId,
          record.repository,
          record.branch,
          record.commitSha,
          record.imageRepository,
          record.imageTag,
          record.imageDigest,
          record.clusterId,
          record.clusterName,
          record.namespace,
          record.releaseName,
          record.deploymentStrategy,
          record.executorType,
          record.status,
          record.statusMessage,
          record.failureReason,
          record.endpointUrl,
          record.workflowRunId,
          record.workflowRunUrl,
          JSON.stringify(record.pipelineStages),
          record.requestedBy,
          record.startedAt,
          record.completedAt,
          record.createdAt,
          record.updatedAt,
        ],
      );
    } else {
      this.memoryApplicationDeployments.set(record.id, record);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'application-deployment-requested',
      targetType: 'application-deployment',
      targetId: record.id,
      payload: {
        componentId: record.componentId,
        branch: record.branch,
        commitSha: record.commitSha,
        imageRepository: record.imageRepository,
        imageTag: record.imageTag,
        workflowRunId: record.workflowRunId,
      },
    });

    return record;
  }

  async syncApplicationDeploymentStatus(input: {
    deploymentId: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<ApplicationDeploymentRecord> {
    await this.init();

    const current = await this.getApplicationDeployment({
      deploymentId: input.deploymentId,
    });
    if (!current) {
      throw new Error('APPLICATION_DEPLOYMENT_NOT_FOUND');
    }

    if (!current.workflowRunId) {
      throw new Error('APPLICATION_DEPLOYMENT_HAS_NO_WORKFLOW_RUN');
    }

    const status = await this.deploymentExecutor.getStatus(
      current.workflowRunId,
    );
    const next: ApplicationDeploymentRecord = {
      ...current,
      status: status.status,
      statusMessage: status.statusMessage,
      failureReason: status.failureReason ?? null,
      workflowRunUrl: status.workflowRunUrl ?? current.workflowRunUrl,
      workflowRun: status.workflowRun ?? null,
      pipelineStages: status.pipelineStages.length
        ? status.pipelineStages
        : this.pipelineStagesForStatus(status.status),
      completedAt:
        status.completedAt ??
        (status.status === 'READY' || status.status === 'FAILED'
          ? new Date().toISOString()
          : null),
      updatedAt: new Date().toISOString(),
    };

    if (this.pool) {
      await this.query(
        `
        UPDATE control_plane_application_deployments
        SET status = $2,
            status_message = $3,
            failure_reason = $4,
            workflow_run_url = $5,
            pipeline_stages = $6::jsonb,
            completed_at = $7,
            updated_at = $8
        WHERE id = $1
        `,
        [
          next.id,
          next.status,
          next.statusMessage,
          next.failureReason,
          next.workflowRunUrl,
          JSON.stringify(next.pipelineStages),
          next.completedAt,
          next.updatedAt,
        ],
      );
    } else {
      this.memoryApplicationDeployments.set(next.id, next);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'application-deployment-sync',
      targetType: 'application-deployment',
      targetId: next.id,
      payload: {
        status: next.status,
        workflowRunId: next.workflowRunId,
        workflowRunUrl: next.workflowRunUrl,
      },
    });

    return next;
  }

  async getDeveloperEnvironmentOptions() {
    const profiles = await this.listDevelopmentProfiles();

    return {
      product: 'SRI',
      environmentTypes: [{ id: 'SHARED_TEAM', displayName: 'Shared Team' }],
      resourceProfiles: RESOURCE_PROFILES,
      components: SRI_CATALOG_COMPONENTS,
      developmentProfiles: profiles,
      clusters: [],
    };
  }

  async getDeveloperWorkspaceOptions() {
    return this.getDeveloperEnvironmentOptions();
  }

  async getWorkspaceProvisioningPreflight(input?: {
    componentId?: string;
    developmentProfileId?: string;
    dependencies?: {
      postgresql?: boolean;
      kafka?: boolean;
      temporal?: boolean;
    };
  }): Promise<WorkspaceProvisioningPreflightReport> {
    await this.init();
    return this.workspaceProvisioner.validateWorkspacePrerequisites({
      componentId: input?.componentId,
      developmentProfileId: input?.developmentProfileId,
      dependencies: {
        postgresql: Boolean(input?.dependencies?.postgresql),
        kafka: Boolean(input?.dependencies?.kafka),
        temporal: Boolean(input?.dependencies?.temporal),
      },
    });
  }

  async listWorkspaceTemplates(): Promise<WorkspaceTemplate[]> {
    const profiles = await this.listDevelopmentProfiles();
    return profiles
      .filter(
        profile =>
          profile.status === 'ACTIVE' && profile.workspaceConfiguration,
      )
      .map(profile => ({
        id: profile.id,
        displayName: profile.displayName,
        description: profile.description,
        runtime: profile.runtime,
        runtimeVersion: profile.runtimeVersion,
        developmentProfileId: profile.id,
        developmentProfileVersion: profile.version,
        workspaceType: profile.workspaceConfiguration?.type ?? 'devcontainer',
        image: profile.workspaceConfiguration?.image ?? {
          registry: DEV_IMAGE_REGISTRY,
          repository: 'cloudhub/dev/base',
          tag: WORKSPACE_IMAGE_TAGS.base,
        },
        tools: profile.workspaceConfiguration?.tools ?? [],
        extensions: profile.workspaceConfiguration?.vscode.extensions ?? [],
      }));
  }

  async provisionInfrastructure(input: {
    request: ProvisionRequest;
    actorRef: string;
    role: PersonaRole;
  }) {
    await this.init();

    const validationIssues: string[] = [];
    if (!input.request.subscriptionId)
      validationIssues.push('subscription required');
    if (!input.request.region) validationIssues.push('region required');
    if (!input.request.environment)
      validationIssues.push('environment required');
    if (input.request.nodePools.length === 0)
      validationIssues.push('at least one node pool required');

    const providerPlan = await this.azure.provisionCluster(input.request);

    const artifacts = [
      {
        path: `infra/${input.request.environment}/${input.request.clusterName}/terraform.auto.tfvars.json`,
        content: JSON.stringify(
          {
            cluster_name: input.request.clusterName,
            subscription_id: input.request.subscriptionId,
            region: input.request.region,
            environment: input.request.environment,
            node_pools: input.request.nodePools,
          },
          null,
          2,
        ),
      },
      {
        path: `argocd/infra/${input.request.clusterName}.yaml`,
        content: [
          'apiVersion: argoproj.io/v1alpha1',
          'kind: Application',
          'metadata:',
          `  name: infra-${input.request.clusterName}`,
          'spec:',
          '  project: default',
          '  source:',
          '    repoURL: platform-infra-gitops',
        ].join('\n'),
      },
    ];

    const commit = await this.gitOps.commitArtifacts({
      repo: 'platform-infra-gitops',
      branch: `infra/${input.request.clusterName}`,
      message: `provision infra for ${input.request.clusterName}`,
      actor: input.actorRef,
      artifacts,
    });

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'infrastructure-provision',
      targetType: 'cluster',
      targetId: input.request.clusterName,
      payload: {
        request: input.request,
        providerPlan,
        validationIssues,
        commit,
      },
    });

    return {
      accepted: validationIssues.length === 0 && providerPlan.accepted,
      validationIssues,
      providerPlan,
      commit,
    };
  }

  async deployPlatform(input: {
    clusterId: string;
    platformVersion: string;
    actorRef: string;
    role: PersonaRole;
  }) {
    await this.init();

    const clusters = await this.listClusters();
    const cluster = clusters.find(c => c.id === input.clusterId);
    if (!cluster) {
      throw new Error('Cluster not registered');
    }

    const prerequisites = {
      clusterRegistered: true,
      namespaceExists: true,
      storageClassExists: true,
      ingressAvailable: true,
    };

    const artifacts = [
      {
        path: `platform/${cluster.clusterName}/helmfile.yaml`,
        content: [
          'releases:',
          '  - name: common-res',
          '  - name: nr-infra-common',
          '  - name: edb-netrevealv96',
        ].join('\n'),
      },
      {
        path: `argocd/platform/${cluster.clusterName}-applicationset.yaml`,
        content: [
          'apiVersion: argoproj.io/v1alpha1',
          'kind: ApplicationSet',
          'metadata:',
          `  name: platform-${cluster.clusterName}`,
          'spec: {}',
        ].join('\n'),
      },
    ];

    const commit = await this.gitOps.commitArtifacts({
      repo: 'platform-app-gitops',
      branch: `platform/${cluster.clusterName}`,
      message: `deploy platform ${input.platformVersion} to ${cluster.clusterName}`,
      actor: input.actorRef,
      artifacts,
    });

    await this.argo.createApplicationSet({
      name: `platform-${cluster.clusterName}`,
      namespace: 'argocd',
      spec: { cluster: cluster.clusterName, version: input.platformVersion },
    });

    const sync = await this.argo.triggerSync(`platform-${cluster.clusterName}`);

    const record: PlatformDeploymentRecord = {
      id: crypto.randomUUID(),
      clusterId: cluster.id,
      platformVersion: input.platformVersion,
      deploymentStatus: sync.status === 'synced' ? 'deployed' : 'pending',
      deployedAt: new Date().toISOString(),
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_platform_deployments (id, cluster_id, platform_version, deployment_status, deployed_at)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          record.id,
          record.clusterId,
          record.platformVersion,
          record.deploymentStatus,
          record.deployedAt,
        ],
      );
    } else {
      this.memoryPlatformDeployments.push(record);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: 'platform-deploy',
      targetType: 'cluster',
      targetId: cluster.id,
      payload: {
        sequence: ['common-res', 'nr-infra-common', 'edb-netrevealv96'],
        prerequisites,
        commit,
        sync,
      },
    });

    return {
      record,
      prerequisites,
      commit,
      sync,
      sequence: ['common-res', 'nr-infra-common', 'edb-netrevealv96'],
    };
  }

  // ─── Deployment Portal (self-service Helmfile deploy wizard) ───────────────

  async getPortalDeploymentOptions(): Promise<PortalDeploymentOptions> {
    await this.init();
    return this.portal.getOptions();
  }

  async listPortalDeploymentInstances(application?: string) {
    await this.init();
    return this.portal.listInstances(application);
  }

  async previewPortalHelmfile(input: {
    application: string;
    instanceName: string;
    customer: string;
    clusterName?: string;
    chartVersion: string;
    aiStoreIntegration: boolean;
  }): Promise<PortalHelmfilePreview> {
    return this.portal.previewHelmfile(input);
  }

  async getPortalDeploymentSecretReadiness(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    includePipelineRefs?: boolean;
    forceRefresh?: boolean;
  }): Promise<PortalSecretReadinessReport> {
    await this.init();
    return this.portal.getSecretReadiness(input);
  }

  async seedPortalPipelineRefs(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    chartVersion: string;
    overlayRef?: string;
  }): Promise<void> {
    await this.init();
    const application = input.application.trim();
    const instanceName = input.instanceName.trim();
    const customer = input.customer.trim();
    const vault = input.vault?.trim();
    const chartVersion = input.chartVersion.trim();
    const overlayRef = input.overlayRef?.trim() || undefined;

    if (!application || !instanceName || !customer || !chartVersion) {
      throw new Error(
        'application, instanceName, customer, and chartVersion are required',
      );
    }
    if (!vault) {
      throw new Error('vault is required');
    }

    const namespace = instanceName.startsWith(`${application}-`)
      ? instanceName
      : `${application}-${instanceName}`;

    // Heuristically attempt to resolve a values file ref from the scripts
    // repository when possible. We avoid fabricating valuesFileRef — only set
    // it when we can confidently derive a commit-ish (tag/sha) for the
    // values file corresponding to the selected chartVersion.
    let valuesFileRef: string | undefined = undefined;
    try {
      if (this.scriptsCatalog && this.scriptsCatalog.listInstances) {
        const instances = await this.scriptsCatalog.listInstances(application);
        const inst = instances.find(
          i => i.appInstance === instanceName || i.appName === instanceName,
        );
        if (inst && inst.helmfilePath) {
          const content = await this.scriptsCatalog.readTextIfExists(
            inst.helmfilePath,
          );
          if (content) {
            // Try to find a values file ref placeholder in the helmfile content
            const m = content.match(
              /helm_chart_values_file_ref.*?([A-Za-z0-9_\-\/\\.]+)\b/,
            );
            if (!m) {
              // Look for git::...\?ref={{ .Values.helm_chart_values_file_ref }} pattern
              if (
                /helm_chart_values_file_ref/.test(content) &&
                /git::/.test(content)
              ) {
                // If the scripts repo is the source, assume chartVersion maps to a tag
                const repo = process.env.SYMPHONYFS_SCRIPTS_REPOSITORY?.trim();
                const candidateTag = chartVersion;
                if (repo && candidateTag) {
                  // attempt to resolve a commit sha for the tag via GitHub API helper
                  try {
                    const gh = this.actions;
                    if (gh && gh.getRefCommitSha) {
                      const sha = await gh.getRefCommitSha({
                        repository: repo,
                        ref: candidateTag,
                      });
                      if (sha) valuesFileRef = sha;
                    }
                  } catch (e) {
                    this.logger?.info?.(
                      `[control-plane] could not resolve values file ref via GitHub: ${String(
                        e,
                      )}`,
                    );
                  }
                }
              }
            } else {
              // simple matched token; not a strong signal but we can try to use chartVersion
              const candidateTag = chartVersion;
              const repo = process.env.SYMPHONYFS_SCRIPTS_REPOSITORY?.trim();
              try {
                const gh = this.actions;
                if (gh && gh.getRefCommitSha && repo && candidateTag) {
                  const sha = await gh.getRefCommitSha({
                    repository: repo,
                    ref: candidateTag,
                  });
                  if (sha) valuesFileRef = sha;
                }
              } catch (e) {
                this.logger?.info?.(
                  `[control-plane] values file ref resolution failed: ${String(
                    e,
                  )}`,
                );
              }
            }
          }
        }
      }
    } catch (err) {
      this.logger?.info?.(
        `[control-plane] heuristic valuesFileRef resolution failed: ${String(
          err,
        )}`,
      );
    }

    // Delegate to the OnePassword readiness service to write pipeline refs.
    if (!this.onePassword || !this.onePassword.syncPipelineRefs) {
      throw new Error('OnePassword readiness service is not available');
    }

    await this.onePassword.syncPipelineRefs({
      vault,
      itemTitleOrId: customer,
      namespace,
      helmChartVersion: chartVersion,
      overlayRef,
      valuesFileRef,
    });
  }

  async provisionPortalDeploymentSecrets(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    applicationReleaseVersion?: string;
    actorRef: string;
    role: PersonaRole;
    bootstrapCustomerStructure?: boolean;
    entityResolutionChartVersion?: string;
    onProgress?: (event: SecretProvisionProgressEvent) => void;
  }): Promise<PortalSecretProvisionStatusView> {
    await this.init();
    return this.portal.provisionSecrets(input);
  }

  async getPortalSecretProvisionStatus(
    operationId: string,
  ): Promise<PortalSecretProvisionStatusView | null> {
    await this.init();
    return this.portal.getSecretProvisionStatus(operationId);
  }

  async getPortalSecretFieldsNeedingValues(input: {
    application: string;
    instanceName: string;
    customer: string;
    vault?: string;
    clusterName?: string;
    forceRefresh?: boolean;
  }): Promise<PortalSecretFieldInfo[]> {
    await this.init();
    return this.portal.getFieldsNeedingValues(input);
  }

  async updatePortalSecretFieldValue(
    input: PortalSecretUpdateRequest,
  ): Promise<PortalSecretUpdateResult> {
    await this.init();
    return this.portal.updateSecretFieldValue(input);
  }

  async verifyPortalAppInstanceExists(input: {
    application: string;
    instanceName: string;
    branch?: string;
  }): Promise<{
    exists: boolean;
    application: string;
    instanceName: string;
    branch: string;
    path: string;
    message: string;
  }> {
    await this.init();
    return this.portal.verifyAppInstanceExists(input);
  }

  async createPortalDeployment(
    input: CreatePortalDeploymentInput,
  ): Promise<PortalDeploymentRecord> {
    await this.init();
    return this.portal.create(input);
  }

  async runPortalDeploymentDiff(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentDiffStatusView> {
    await this.init();
    return this.portal.runDiff(input);
  }

  async getPortalDeploymentDiffStatus(
    id: string,
  ): Promise<PortalDeploymentDiffStatusView | null> {
    await this.init();
    return this.portal.getDiffStatus(id);
  }

  async approvePortalDeployment(input: {
    id: string;
    approverRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentRecord> {
    await this.init();
    return this.portal.approve(input);
  }

  async submitPortalDeploymentForApproval(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentRecord> {
    await this.init();
    return this.portal.submitForApproval(input);
  }

  async rejectPortalDeployment(input: {
    id: string;
    approverRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<PortalDeploymentRecord> {
    await this.init();
    return this.portal.reject(input);
  }

  async syncPortalDeploymentWorkflowRun(input: {
    workflowRunId: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null;
    htmlUrl?: string | null;
  }): Promise<PortalDeploymentRecord | null> {
    await this.init();
    return this.portal.syncWorkflowRun(input);
  }

  async listPortalDeployments(): Promise<PortalDeploymentRecord[]> {
    await this.init();
    return this.portal.list();
  }

  async getPortalDeployment(
    id: string,
  ): Promise<PortalDeploymentRecord | null> {
    await this.init();
    return this.portal.get(id);
  }

  async getPortalDeploymentStatus(
    id: string,
  ): Promise<PortalDeploymentStatusView | null> {
    await this.init();
    return this.portal.getStatus(id);
  }

  async checkPortalDeploymentHealth(id: string) {
    await this.init();
    return this.portal.checkApplicationHealth(id);
  }

  async getPortalDeploymentEvents(id: string): Promise<
    Array<{
      id: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actor?: string | null;
      actorRole?: string | null;
      note?: string | null;
      createdAt: string;
    }>
  > {
    await this.init();
    return this.portal.getDeploymentEvents(id);
  }

  async retryPortalDeployment(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<PortalDeploymentRecord> {
    await this.init();
    return this.portal.retry(input);
  }

  async updateSriProvisionalDeploymentStatus(input: {
    deploymentId: string;
    status: string;
    message: string | null;
  }): Promise<void> {
    await this.init();

    // Update SRI deployment status in sri_provisional database
    if (this.sriProvisionalPool) {
      try {
        await this.sriProvisionalPool.query(
          'UPDATE sri_deployments SET provisioner_status = $1, updated_at = NOW() WHERE deployment_id = $2',
          [input.status, input.deploymentId],
        );
      } catch (error) {
        this.logger.warn(
          `Failed to update SRI deployment status: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Update the portal deployment record via portal service
    await this.portal.updateDeploymentStatusFromWebhook({
      deploymentId: input.deploymentId,
      provisionerStatus: input.status,
      message: input.message,
    });

    this.logger.info(
      `[control-plane] SRI-Provisional deployment ${input.deploymentId} status updated to ${input.status}`,
    );
  }

  // ─── GPU Compute (self-service GPU VM provisioning) ────────────────────────

  async getGpuComputeOptions(): Promise<GpuComputeOptions> {
    return this.gpuCompute.getOptions();
  }

  async getGpuVnets(input?: { gpuSku?: 'a100' | 'h100' }) {
    return this.gpuCompute.getVnets(input);
  }

  async getGpuNetworkOptions(input: {
    gpuSku: 'a100' | 'h100';
    subscriptionId: string;
    vnetName: string;
    region: string;
  }) {
    return this.gpuCompute.getNetworkOptions(input);
  }

  getGpuNetworkProfileDiagnostics() {
    return this.gpuCompute.getNetworkProfileDiagnostics();
  }

  async getGpuAuthorization(input: {
    groups: string[];
    actorRef: string;
  }): Promise<GpuAuthorizationResult> {
    return this.gpuAuth.isGpuAuthorized(input);
  }

  async checkGpuQuota(input: {
    gpuSku: 'a100' | 'h100';
    region: string;
  }): Promise<GpuQuotaCheckResult> {
    return this.gpuCompute.checkQuota(input);
  }

  // ─── Low-cost self-service test VMs ────────────────────────────────────

  getTestVmOptions(): TestVmOptions {
    return this.testVm.getOptions();
  }

  async createTestVm(input: CreateTestVmInput): Promise<TestVmRecord> {
    await this.init();
    return this.testVm.create(input);
  }

  async listTestVms(): Promise<TestVmRecord[]> {
    await this.init();
    return this.testVm.list();
  }

  async getTestVm(id: string): Promise<TestVmRecord | null> {
    await this.init();
    return this.testVm.get(id);
  }

  async refreshTestVmStatus(id: string): Promise<TestVmRecord | null> {
    await this.init();
    return this.testVm.refreshStatus(id);
  }

  async deleteTestVm(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<TestVmRecord> {
    await this.init();
    return this.testVm.remove(input);
  }

  // ─── Azure foundation resources (Terraform modules) ─────────────────────

  getAzureFoundationOptions(): AzureFoundationOptions {
    return this.foundation.getOptions();
  }

  async createAzureFoundationResource(
    input: CreateAzureFoundationResourceInput,
  ): Promise<AzureFoundationResourceRecord> {
    await this.init();
    return this.foundation.create(input);
  }

  async listAzureFoundationResources(): Promise<
    AzureFoundationResourceRecord[]
  > {
    await this.init();
    return this.foundation.list();
  }

  async refreshAzureFoundationResourceStatus(
    id: string,
  ): Promise<AzureFoundationResourceRecord | null> {
    await this.init();
    return this.foundation.refreshStatus(id);
  }

  async createGpuInstance(
    input: CreateGpuInstanceInput,
  ): Promise<GpuInstanceRecord> {
    await this.init();
    return this.gpuCompute.create(input);
  }

  async listGpuInstances(): Promise<GpuInstanceRecord[]> {
    await this.init();
    return this.gpuCompute.list();
  }

  async getGpuInstance(id: string): Promise<GpuInstanceRecord | null> {
    await this.init();
    return this.gpuCompute.get(id);
  }

  async refreshGpuInstanceStatus(
    id: string,
  ): Promise<GpuInstanceRecord | null> {
    await this.init();
    return this.gpuCompute.refreshStatus(id);
  }

  async deleteGpuInstance(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GpuInstanceRecord> {
    await this.init();
    return this.gpuCompute.remove(input);
  }

  async startGpuInstance(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GpuInstanceRecord> {
    await this.init();
    return this.gpuCompute.start(input);
  }

  async stopGpuInstance(input: {
    id: string;
    actorRef: string;
    role: PersonaRole;
  }): Promise<GpuInstanceRecord> {
    await this.init();
    return this.gpuCompute.stop(input);
  }

  // ─── GPU VNet Management (admin-only) ────────────────────────────────────

  async listGpuVnets(gpuSku?: 'a100' | 'h100'): Promise<any[]> {
    await this.init();
    return this.gpuCompute.listManagedVnets(gpuSku);
  }

  async createGpuVnet(input: {
    subscriptionId: string;
    resourceGroup: string;
    vnetName: string;
    region: string;
    gpuSkus?: ('a100' | 'h100')[];
  }): Promise<any> {
    await this.init();
    return this.gpuCompute.createManagedVnet(input);
  }

  async getGpuVnetById(id: string): Promise<any | null> {
    await this.init();
    return this.gpuCompute.getManagedVnetById(id);
  }

  async updateGpuVnetSkus(
    id: string,
    gpuSkus: ('a100' | 'h100')[],
  ): Promise<any> {
    await this.init();
    return this.gpuCompute.updateManagedVnetSkus(id, gpuSkus);
  }

  async deleteGpuVnet(id: string): Promise<void> {
    await this.init();
    return this.gpuCompute.deleteManagedVnet(id);
  }

  onDeploymentEvent(
    deploymentId: string,
    listener: (event: {
      id: string;
      deploymentId: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actor?: string | null;
      actorRole?: string | null;
      note?: string | null;
      createdAt: string;
    }) => void,
  ): () => void {
    return this.portal.onDeploymentEvent(deploymentId, listener);
  }

  onGpuInstanceEvent(
    instanceId: string,
    listener: (event: import('../types').GpuInstanceEvent) => void,
  ): () => void {
    return this.gpuCompute.onInstanceEvent(instanceId, listener);
  }

  async listGpuInstanceEvents(instanceId: string) {
    await this.init();
    return this.gpuCompute.listEvents(instanceId);
  }

  async getGpuInstanceRunLogs(instanceId: string) {
    await this.init();
    return this.gpuCompute.runLogs(instanceId);
  }

  async deployOverlay(input: {
    tenantId: string;
    clusterId: string;
    overlayVersion: string;
    environment: string;
    action: 'deploy' | 'promote' | 'rollback';
    actorRef: string;
    role: PersonaRole;
  }) {
    await this.init();

    const platformDeployed = await this.hasBasePlatform(input.clusterId);
    const validationIssues: string[] = [];
    if (!platformDeployed) validationIssues.push('base platform not deployed');
    if (!input.tenantId) validationIssues.push('tenant required');
    if (!input.environment) validationIssues.push('environment required');

    const artifacts = [
      {
        path: `tenants/${input.tenantId}/${input.environment}/values-${input.overlayVersion}.yaml`,
        content: [
          `tenant: ${input.tenantId}`,
          `environment: ${input.environment}`,
          `overlayVersion: ${input.overlayVersion}`,
          `action: ${input.action}`,
        ].join('\n'),
      },
    ];

    const commit = await this.gitOps.commitArtifacts({
      repo: 'tenant-overlays-gitops',
      branch: `overlay/${input.tenantId}/${input.environment}`,
      message: `${input.action} overlay ${input.overlayVersion} for tenant ${input.tenantId}`,
      actor: input.actorRef,
      artifacts,
    });

    const appName = `tenant-${input.tenantId}-${input.environment}`;
    const sync = await this.argo.triggerSync(appName);

    const record: TenantOverlayRecord = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      clusterId: input.clusterId,
      overlayVersion: input.overlayVersion,
      deploymentStatus: validationIssues.length ? 'blocked' : sync.status,
      deployedBy: input.actorRef,
      deployedAt: new Date().toISOString(),
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_tenant_overlays
          (id, tenant_id, cluster_id, overlay_version, deployment_status, deployed_by, deployed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          record.id,
          record.tenantId,
          record.clusterId,
          record.overlayVersion,
          record.deploymentStatus,
          record.deployedBy,
          record.deployedAt,
        ],
      );
    } else {
      this.memoryTenantOverlays.push(record);
    }

    await this.audit({
      actorRef: input.actorRef,
      role: input.role,
      action: `overlay-${input.action}`,
      targetType: 'tenant-overlay',
      targetId: record.id,
      payload: {
        validationIssues,
        commit,
        sync,
        input,
      },
    });

    return {
      record,
      validationIssues,
      commit,
      sync,
    };
  }

  private async hasBasePlatform(clusterId: string): Promise<boolean> {
    if (this.pool) {
      const rows = await this.query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
        FROM control_plane_platform_deployments
        WHERE cluster_id = $1
          AND deployment_status IN ('deployed', 'synced')
        `,
        [clusterId],
      );
      return Number(rows[0]?.count ?? 0) > 0;
    }

    return this.memoryPlatformDeployments.some(
      x =>
        x.clusterId === clusterId &&
        ['deployed', 'synced'].includes(x.deploymentStatus),
    );
  }

  async deploymentHistory(scope: 'all' | 'platform' | 'overlay') {
    await this.init();
    if (!this.pool) {
      return {
        platform: scope === 'overlay' ? [] : this.memoryPlatformDeployments,
        overlays: scope === 'platform' ? [] : this.memoryTenantOverlays,
      };
    }

    const platform =
      scope === 'overlay'
        ? []
        : await this.query<PlatformDeploymentRecord>(
            `
            SELECT
              id,
              cluster_id AS "clusterId",
              platform_version AS "platformVersion",
              deployment_status AS "deploymentStatus",
              deployed_at AS "deployedAt"
            FROM control_plane_platform_deployments
            ORDER BY deployed_at DESC
            LIMIT 200
            `,
          );

    const overlays =
      scope === 'platform'
        ? []
        : await this.query<TenantOverlayRecord>(
            `
            SELECT
              id,
              tenant_id AS "tenantId",
              cluster_id AS "clusterId",
              overlay_version AS "overlayVersion",
              deployment_status AS "deploymentStatus",
              deployed_by AS "deployedBy",
              deployed_at AS "deployedAt"
            FROM control_plane_tenant_overlays
            ORDER BY deployed_at DESC
            LIMIT 200
            `,
          );

    return { platform, overlays };
  }

  async argocdStatus(appName: string) {
    return this.argo.status(appName);
  }

  async argocdSync(appName: string) {
    return this.argo.triggerSync(appName);
  }

  async listWorkspaceAuditLogs(input: {
    workspaceId: string;
    since?: string;
    limit?: number;
  }): Promise<WorkspaceAuditLogRecord[]> {
    await this.init();

    const safeLimit = Math.max(1, Math.min(input.limit ?? 200, 500));

    if (this.pool) {
      const params: unknown[] = [input.workspaceId];
      let where = "target_type = 'developer-environment' AND target_id = $1";

      if (input.since) {
        params.push(input.since);
        where += ` AND created_at > $${params.length}`;
      }

      params.push(safeLimit);
      const rows = await this.query<any>(
        `
        SELECT
          id,
          actor_ref AS "actorRef",
          persona AS "role",
          action,
          target_type AS "targetType",
          target_id AS "targetId",
          payload,
          created_at AS "createdAt"
        FROM control_plane_audit_logs
        WHERE ${where}
        ORDER BY created_at ASC
        LIMIT $${params.length}
        `,
        params,
      );

      return rows.map(row => ({
        id: row.id,
        actorRef: row.actorRef,
        role: row.role,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId ?? null,
        payload:
          typeof row.payload === 'string'
            ? JSON.parse(row.payload)
            : row.payload ?? {},
        createdAt: row.createdAt,
      }));
    }

    return this.memoryAuditLogs
      .filter(item => {
        if (
          item.targetType !== 'developer-environment' ||
          item.targetId !== input.workspaceId
        ) {
          return false;
        }
        if (!input.since) {
          return true;
        }
        return item.createdAt > input.since;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, safeLimit);
  }

  async createDeploymentApproval(
    input: CreateDeploymentApprovalInput,
  ): Promise<DeploymentApprovalRecord> {
    await this.init();
    const now = new Date().toISOString();
    const deploymentId = crypto.randomUUID();
    const preview = await this.previewPortalHelmfile({
      application: input.application,
      instanceName: input.instanceName,
      clusterName: input.cluster,
      customer: input.customer,
      chartVersion: input.chartVersion,
      aiStoreIntegration: false,
    });
    const record: DeploymentApprovalRecord = {
      id: crypto.randomUUID(),
      deploymentId,
      application: input.application,
      instanceName: input.instanceName,
      customer: input.customer,
      environment: input.environment ?? preview.environment ?? 'dev',
      cluster: input.cluster ?? preview.clusterName ?? '',
      subscriptionId: input.subscriptionId ?? '',
      resourceGroup: input.resourceGroup ?? '',
      chartVersion: input.chartVersion,
      status: 'PENDING',
      requestedBy: input.requestedBy,
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_deployment_approvals
          (id, deployment_id, application, instance_name, customer, environment, cluster,
           subscription_id, resource_group, chart_version, status,
           requested_by, requested_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `,
        [
          record.id,
          record.deploymentId,
          record.application,
          record.instanceName,
          record.customer,
          record.environment,
          record.cluster,
          record.subscriptionId,
          record.resourceGroup,
          record.chartVersion,
          record.status,
          record.requestedBy,
          record.requestedAt,
          record.createdAt,
          record.updatedAt,
        ],
      );
    } else {
      this.memoryApprovals.set(record.id, record);
    }

    await this.audit({
      actorRef: input.requestedBy,
      role: input.role,
      action: 'deployment-approval-requested',
      targetType: 'deployment-approval',
      targetId: record.id,
      payload: {
        deploymentId: record.deploymentId,
        application: record.application,
        instanceName: record.instanceName,
        cluster: record.cluster,
        environment: record.environment,
      },
    });

    return record;
  }

  async listDeploymentApprovals(
    status?: DeploymentApprovalStatus,
  ): Promise<DeploymentApprovalRecord[]> {
    await this.init();
    if (this.pool) {
      const rows = await this.query<Record<string, unknown>>(
        `
        SELECT * FROM control_plane_deployment_approvals
        ${status ? 'WHERE status = $1' : ''}
        ORDER BY created_at DESC
        LIMIT 200
        `,
        status ? [status] : [],
      );
      return rows.map(mapApprovalRow);
    }
    const all = Array.from(this.memoryApprovals.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return status ? all.filter(a => a.status === status) : all;
  }

  async getDeploymentApproval(
    id: string,
  ): Promise<DeploymentApprovalRecord | null> {
    await this.init();
    if (this.pool) {
      const rows = await this.query<Record<string, unknown>>(
        `SELECT * FROM control_plane_deployment_approvals WHERE id = $1`,
        [id],
      );
      return rows.length ? mapApprovalRow(rows[0]) : null;
    }
    return this.memoryApprovals.get(id) ?? null;
  }

  async decideDeploymentApproval(input: {
    id: string;
    decision: 'APPROVED' | 'REJECTED';
    approverRef: string;
    role: PersonaRole;
    note?: string;
  }): Promise<DeploymentApprovalRecord> {
    await this.init();
    const existing = await this.getDeploymentApproval(input.id);
    if (!existing) {
      throw Object.assign(new Error('Approval request not found.'), {
        status: 404,
      });
    }
    if (existing.status !== 'PENDING') {
      throw Object.assign(
        new Error(`Approval already ${existing.status.toLowerCase()}.`),
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const next: DeploymentApprovalRecord = {
      ...existing,
      status: input.decision,
      decidedBy: input.approverRef,
      decidedAt: now,
      decisionNote: input.note ?? null,
      updatedAt: now,
    };

    if (this.pool) {
      await this.query(
        `
        UPDATE control_plane_deployment_approvals
        SET status = $2, decided_by = $3, decided_at = $4,
            decision_note = $5, updated_at = $6
        WHERE id = $1
        `,
        [
          next.id,
          next.status,
          next.decidedBy,
          next.decidedAt,
          next.decisionNote,
          next.updatedAt,
        ],
      );
    } else {
      this.memoryApprovals.set(next.id, next);
    }

    await this.audit({
      actorRef: input.approverRef,
      role: input.role,
      action:
        input.decision === 'APPROVED'
          ? 'deployment-approval-approved'
          : 'deployment-approval-rejected',
      targetType: 'deployment-approval',
      targetId: next.id,
      payload: {
        deploymentId: next.deploymentId,
        application: next.application,
        instanceName: next.instanceName,
        requestedBy: next.requestedBy,
        note: next.decisionNote,
      },
    });

    return next;
  }

  async audit(input: {
    actorRef: string;
    role: PersonaRole;
    action: string;
    targetType: string;
    targetId?: string;
    payload: Record<string, unknown>;
  }) {
    const createdAt = new Date().toISOString();
    this.logger.info(
      `[control-plane][audit] actor=${input.actorRef} role=${
        input.role
      } action=${input.action} target=${input.targetType}:${
        input.targetId ?? '-'
      } at=${createdAt}`,
    );

    const logRecord: WorkspaceAuditLogRecord = {
      id: crypto.randomUUID(),
      actorRef: input.actorRef,
      role: input.role,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      payload: input.payload,
      createdAt,
    };

    if (this.pool) {
      await this.query(
        `
        INSERT INTO control_plane_audit_logs
          (id, actor_ref, persona, action, target_type, target_id, payload, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          logRecord.id,
          logRecord.actorRef,
          logRecord.role,
          logRecord.action,
          logRecord.targetType,
          logRecord.targetId,
          JSON.stringify(logRecord.payload),
          logRecord.createdAt,
        ],
      );
      return;
    }

    this.memoryAuditLogs.push(logRecord);
  }

  /**
   * Discover deployable (CloudHub-eligible) clusters by subscription
   */
  async discoverDeployableClusters(input: {
    subscriptionId: string;
    resourceGroup?: string;
    region?: string;
    environment?: string;
  }): Promise<DiscoveredCluster[]> {
    // Try registry first
    try {
      const registryClusters = await this.listClusters();
      const filtered = registryClusters
        .filter(cluster => cluster.subscriptionId === input.subscriptionId)
        .filter(cluster =>
          input.resourceGroup
            ? (cluster.resourceGroup ?? '').trim().toLowerCase() ===
              input.resourceGroup.trim().toLowerCase()
            : true,
        )
        .filter(cluster =>
          input.region
            ? cluster.region.trim().toLowerCase() ===
              input.region.trim().toLowerCase()
            : true,
        )
        .filter(cluster =>
          input.environment
            ? cluster.environment.trim().toLowerCase() ===
              input.environment.trim().toLowerCase()
            : true,
        )
        .map(cluster => ({
          clusterName: cluster.clusterName,
          region: cluster.region,
          resourceGroup: cluster.resourceGroup ?? '',
          kubernetesVersion: cluster.kubernetesVersion,
          nodePools: 0,
          environment: cluster.environment,
          status: cluster.status,
          subscriptionId: cluster.subscriptionId,
          tags: cluster.tags ?? {},
        }));

      if (filtered.length > 0) {
        this.logger.info(
          `[control-plane] Discovered ${filtered.length} deployable clusters from Platform Registry in subscription ${input.subscriptionId}`,
        );
        return filtered;
      }

      this.logger.debug(
        `[control-plane] Platform Registry empty for subscription ${input.subscriptionId}; falling back to Azure discovery`,
      );
    } catch (registryError) {
      this.logger.warn(
        `[control-plane] Platform Registry lookup failed; falling back to Azure discovery: ${
          registryError instanceof Error
            ? registryError.message
            : String(registryError)
        }`,
      );
    }

    // Fallback to Azure discovery with tag filtering
    try {
      const discoveryService = new ClusterDiscoveryService(
        this.azure,
        this.logger,
      );
      const clusters = await discoveryService.getDeployableClusters(input);

      this.logger.info(
        `[control-plane] Discovered ${clusters.length} deployable clusters from Azure in subscription ${input.subscriptionId}`,
      );

      return clusters;
    } catch (azureError) {
      this.logger.error(
        `[control-plane] Both Platform Registry and Azure discovery failed: ${
          azureError instanceof Error ? azureError.message : String(azureError)
        }`,
      );
      throw azureError;
    }
  }

  /**
   * Onboard a cluster for CloudHub deployments
   */
  async onboardCluster(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    userId?: string,
  ): Promise<{
    clusterName: string;
    resourceGroup: string;
    subscriptionId: string;
    tags: Record<string, string>;
  }> {
    // Create a new ClusterTagService with Azure credentials
    // We use ContainerServiceClient which is already available
    const tagService = new ClusterTagService(
      this.buildAzureCredential(),
      input.subscriptionId,
      this.logger,
    );

    const result = await tagService.onboardCluster(input, userId);

    this.logger.info(
      `[control-plane] Cluster ${input.clusterName} onboarded successfully${
        userId ? ` by ${userId}` : ''
      }`,
    );

    return result;
  }

  /**
   * Offboard a cluster from CloudHub deployments
   */
  async offboardCluster(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    userId?: string,
  ): Promise<{
    clusterName: string;
    resourceGroup: string;
    subscriptionId: string;
    tags: Record<string, string>;
  }> {
    // Create a new ClusterTagService with Azure credentials
    const tagService = new ClusterTagService(
      this.buildAzureCredential(),
      input.subscriptionId,
      this.logger,
    );

    const result = await tagService.offboardCluster(input, userId);

    this.logger.info(
      `[control-plane] Cluster ${input.clusterName} offboarded successfully${
        userId ? ` by ${userId}` : ''
      }`,
    );

    return result;
  }

  /**
   * List live Kubernetes namespaces on a discovered AKS cluster.
   */
  async listClusterNamespaces(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<
    Array<{ name: string; status: string; createdAt: string | null }>
  > {
    const client = new ContainerServiceClient(
      this.buildAzureCredential(),
      input.subscriptionId,
    );

    const credentials = await client.managedClusters.listClusterUserCredentials(
      input.resourceGroup,
      input.clusterName,
    );
    const kubeconfig = credentials.kubeconfigs?.[0]?.value;
    if (!kubeconfig) {
      throw new Error(
        `Unable to retrieve kubeconfig for cluster ${input.clusterName}`,
      );
    }

    const kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromString(Buffer.from(kubeconfig).toString('utf8'));
    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);

    const response = await coreApi.listNamespace();
    // @kubernetes/client-node has shipped both a `{ body }`-wrapped and a
    // direct-object response shape across major versions; handle both.
    const list =
      'body' in (response as object)
        ? (response as unknown as { body: k8s.V1NamespaceList }).body
        : (response as k8s.V1NamespaceList);

    return (list.items ?? []).map(item => ({
      name: item.metadata?.name ?? '',
      status: item.status?.phase ?? 'Unknown',
      createdAt: item.metadata?.creationTimestamp
        ? new Date(item.metadata.creationTimestamp).toISOString()
        : null,
    }));
  }

  /**
   * Build Azure credential for tag operations
   * (Used internally for cluster tag management)
   */
  private buildAzureCredential() {
    return createCloudHubAzureCredential((message, metadata) =>
      this.logger.info(message, metadata),
    );
  }
}
