/**
 * CloudHub Platform Registry — types for the authoritative inventory model.
 *
 * Hierarchy: Tenants → Cloud Accounts → Environments → Clusters →
 *            Namespaces → Deployment Targets → Applications → Deployments
 */

export type CloudProvider = 'AZURE' | 'AWS' | 'GCP' | 'ONPREM';

export type ClusterType =
  | 'AKS'
  | 'EKS'
  | 'GKE'
  | 'OpenShift'
  | 'RKE2'
  | 'Vanilla Kubernetes';

export type EntityStatus = 'active' | 'inactive' | 'pending' | 'error';

/**
 * Deployment lifecycle states. A deployment moves through these via the
 * workflow endpoints; `superseded` and `rolled_back` are terminal records of
 * prior state.
 */
export type DeploymentStatus =
  | 'pending'
  | 'in_progress'
  | 'active'
  | 'failed'
  | 'superseded'
  | 'rolled_back';

export interface Platform {
  id: string;
  platformCode: string;
  platformName: string;
  platformType: string | null;
  status: EntityStatus;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAccount {
  id: string;
  platformId: string | null;
  platformName?: string;
  cloudProvider: CloudProvider;
  accountName: string;
  accountIdentifier: string;
  status: EntityStatus;
}

export interface Environment {
  id: string;
  platformId: string;
  platformName?: string;
  environmentName: string;
  environmentType: string | null;
  status: EntityStatus;
}

export interface Cluster {
  id: string;
  platformId: string;
  platformName?: string;
  customerTag?: string;
  envTag?: string;
  customerId?: string;
  customerName?: string;
  environment?: string;
  environmentId: string | null;
  environmentName?: string;
  cloudAccountId: string | null;
  clusterName: string;
  clusterType: ClusterType;
  provider: CloudProvider;
  subscriptionId?: string | null;
  region: string | null;
  secondaryRegion: string | null;
  resourceGroup: string | null;
  accountScope: string | null;
  clusterEndpoint: string | null;
  kubernetesVersion: string | null;
  netrevealVersion?: string | null;
  postgresReportingService?: string | null;
  postgresReportingNamespace?: string | null;
  active?: boolean;
  status: EntityStatus;
  discoveredAt: string | null;
  lastSyncedAt: string | null;
}

export interface CustomerRecord {
  customerName: string;
  customerId?: string;
  platformCode?: string;
}

export interface Namespace {
  id: string;
  clusterId: string;
  clusterName?: string;
  namespaceName: string;
  owner: string | null;
  purpose: string | null;
  status: EntityStatus;
}

export interface DeploymentTarget {
  id: string;
  platformId: string;
  platformName?: string;
  environmentId: string | null;
  environmentName?: string;
  clusterId: string | null;
  clusterName?: string;
  namespaceId: string | null;
  namespaceName?: string;
  targetName: string;
  deploymentType: string | null;
  status: EntityStatus;
}

export interface Application {
  id: string;
  applicationName: string;
  applicationType: string | null;
  helmChart: string | null;
  repository: string | null;
  defaultNamespace: string | null;
  supportedPlatforms: string[];
}

export interface Deployment {
  id: string;
  deploymentTargetId: string;
  targetName?: string;
  applicationId: string;
  applicationName?: string;
  version: string | null;
  status: DeploymentStatus;
  deployedBy: string | null;
  deployedAt: string;
}

export type DeploymentEventType = 'created' | 'status_changed' | 'rolled_back';

export interface DeploymentEvent {
  id: string;
  deploymentId: string;
  eventType: DeploymentEventType;
  fromStatus: DeploymentStatus | null;
  toStatus: DeploymentStatus;
  note: string | null;
  actor: string | null;
  createdAt: string;
}

export interface RegistrySummary {
  platforms: number;
  cloudAccounts: number;
  environments: number;
  clusters: number;
  namespaces: number;
  deploymentTargets: number;
  applications: number;
  deployments: number;
}

/**
 * A platform together with every related entity in its slice of the estate.
 * Powers the platform drill-down view in the plugin UI.
 */
export interface PlatformDetail {
  platform: Platform;
  cloudAccounts: CloudAccount[];
  environments: Environment[];
  clusters: Cluster[];
  namespaces: Namespace[];
  deploymentTargets: DeploymentTarget[];
  deployments: Deployment[];
}

export interface OnboardPlatformInput {
  platform: {
    platformCode: string;
    platformName: string;
    platformType?: string | null;
    ownerEmail?: string | null;
  };
  cloudAccount?: {
    cloudProvider: CloudProvider;
    accountName: string;
    accountIdentifier: string;
    platformId?: string | null;
  } | null;
  environments?: string[];
}

export interface OnboardPlatformResult {
  platform: Platform;
  cloudAccount: CloudAccount | null;
  environments: Environment[];
}

export interface DiscoveredCluster {
  clusterName: string;
  clusterType: ClusterType;
  provider: CloudProvider;
  customerTag?: string;
  envTag?: string;
  region: string;
  resourceGroup: string | null;
  accountScope: string | null;
  clusterEndpoint: string;
  kubernetesVersion: string;
  nodeCount: number;
  alreadyRegistered: boolean;
  platformCode?: string;
  environmentName?: string;
  active?: boolean;
  status?: EntityStatus;
}

export interface ImportClustersInput {
  platformId: string;
  environmentId?: string | null;
  cloudAccountId?: string | null;
  clusters: DiscoveredCluster[];
}

export interface CreateDeploymentInput {
  deploymentTargetId: string;
  applicationId: string;
  version?: string | null;
  deployedBy?: string | null;
}

export interface TransitionDeploymentInput {
  status: DeploymentStatus;
  note?: string | null;
  actor?: string | null;
}

export interface RollbackDeploymentInput {
  actor?: string | null;
  note?: string | null;
}
