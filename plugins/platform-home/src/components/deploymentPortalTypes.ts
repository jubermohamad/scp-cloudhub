/**
 * Shared types and helpers for the CloudHub Deployment Portal frontend
 * (DeploymentWizard + DeploymentHistory). Mirrors the backend contract exposed
 * by the deployment-control-plane `/deployments*` endpoints.
 */

import { readJsonResponse } from '@internal/plugin-platform-common';

export type PortalDeploymentStatus =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'VALIDATING'
  | 'GENERATING_HELMFILE'
  | 'COMMITTING'
  | 'TRIGGERING_WORKFLOW'
  | 'DISPATCHING'
  | 'QUEUED'
  | 'DEPLOYING'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED';

export interface PortalApplicationOption {
  id: string;
  appName: string;
  displayName: string;
  description: string;
  chartVersions: string[];
  supportsAiStoreIntegration: boolean;
}

export interface PortalDeploymentOptions {
  applications: PortalApplicationOption[];
  environments: string[];
  vaults: string[];
  customersByVault: Record<string, string[]>;
  customers: string[];
  repository: string;
  branch: string;
}

export interface PortalDiscoveredCluster {
  clusterName: string;
  region: string;
  resourceGroup: string;
  kubernetesVersion: string;
  nodePools: number;
  environment: string;
  status: string;
  subscriptionId: string;
  tags: Record<string, string>;
}

export interface PortalHelmfilePreview {
  path: string;
  namespace: string;
  content: string;
  clusterName?: string;
  environment?: string;
  instanceStatus?: 'EXISTING' | 'NEW';
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
  mode: 'github-api';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt: string | null;
}

export type PortalDeploymentApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

export interface PortalDeploymentApprovalRecord {
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
  status: PortalDeploymentApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
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
  commitSha?: string | null;
  mode?: string;
  applicationUrl?: string | null;
}

export interface PortalHealthProbeResult {
  healthy: boolean;
  url: string;
  healthyPath: string | null;
  attempts: Array<{
    path: string;
    statusCode: number | null;
    error: string | null;
  }>;
  checkedAt: string;
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
  appInstanceExists: boolean;
  namespaceExists: boolean | null;
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
   * generated — proof the value actually landed in 1Password.
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

export interface PortalSecretUpdateResult {
  success: boolean;
  reference: string;
  message: string;
  readiness: PortalSecretReadinessReport | null;
}

export interface PortalCommonResPreflightReport {
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
}

export const TERMINAL_STATUSES: PortalDeploymentStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
];

export function isTerminalStatus(status: PortalDeploymentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface StatusStyle {
  label: string;
  bg: string;
  fg: string;
}

export function statusStyle(status: PortalDeploymentStatus): StatusStyle {
  switch (status) {
    case 'SUCCEEDED':
      return { label: 'Succeeded', bg: '#ECFDF5', fg: '#059669' };
    case 'FAILED':
      return { label: 'Failed', bg: '#FEF2F2', fg: '#DC2626' };
    case 'DEPLOYING':
      return { label: 'Deploying', bg: '#EFF6FF', fg: '#2563EB' };
    case 'QUEUED':
      return { label: 'Queued', bg: '#EEF2FF', fg: '#4F46E5' };
    case 'DISPATCHING':
      return { label: 'Dispatching', bg: '#EEF2FF', fg: '#4F46E5' };
    case 'APPROVED':
      return { label: 'Approved', bg: '#ECFDF5', fg: '#059669' };
    case 'PENDING_APPROVAL':
      return { label: 'Pending Approval', bg: '#FEF9C3', fg: '#92400E' };
    case 'TRIGGERING_WORKFLOW':
      return { label: 'Triggering', bg: '#EEF2FF', fg: '#4F46E5' };
    case 'COMMITTING':
      return { label: 'Committing', bg: '#FEF9C3', fg: '#B45309' };
    case 'GENERATING_HELMFILE':
      return { label: 'Generating', bg: '#FEF9C3', fg: '#B45309' };
    case 'VALIDATING':
      return { label: 'Validating', bg: '#F3F4F6', fg: '#4B5563' };
    default:
      return { label: 'Pending', bg: '#F3F4F6', fg: '#4B5563' };
  }
}

/**
 * Read a JSON response body defensively — backend errors sometimes return an
 * empty body, and a gateway timeout returns an HTML page.
 */
export async function readJson(response: Response): Promise<any> {
  return readJsonResponse(response);
}
