import type { Entity } from '@backstage/catalog-model';

export type CloudProvider = 'Azure' | 'AWS' | 'GCP' | 'On-Prem';

export interface DiscoveredCluster {
  clusterName: string;
  resourceGroup: string;
  region: string;
  kubernetesVersion: string;
  nodePoolCount: number;
  subscriptionId: string;
  environment: string | null;
  tags: Record<string, string>;
  provisioningState: string;
}

export interface ValidationResult {
  clusterReachable: boolean;
  provisioningStateSucceeded: boolean;
  kubernetesApiReachable: boolean;
  kubeconfigRetrievable: boolean;
  namingConventionValid: boolean;
  tagsValid: boolean;
  notAlreadyOnboarded: boolean;
  detectedEnvironment: string | null;
  issues: string[];
}

export interface DiscoveredClusterWithValidation extends DiscoveredCluster {
  validation: ValidationResult;
}

export interface NodePoolRecord {
  nodepoolName: string;
  vmSize: string;
  nodeCount: number;
  mode: string;
}

export interface TenantRecord {
  id: string;
  tenantName: string;
  businessUnit: string | null;
  cloudProvider: CloudProvider;
  subscriptionId: string;
  regions: string[];
  environments: string[];
  clusterCount?: number;
  createdAt: string;
}

export interface ClusterRecord {
  id: string;
  tenantId: string | null;
  clusterName: string;
  subscriptionId: string;
  resourceGroup: string;
  region: string;
  environment: string | null;
  kubernetesVersion: string;
  provisioningState: string;
  cloudProvider: string;
  onboarded: boolean;
  onboardingState: string;
  tags: Record<string, string>;
  catalogEntityRef: string | null;
  createdAt: string;
}

export interface CatalogRegistrationResult {
  entity: Entity;
  entityRef: string;
  registrationStatus: 'registered' | 'skipped' | 'failed';
  error?: string;
}

export interface DiscoverClustersInput {
  cloudProvider: CloudProvider;
  subscriptionId: string;
  resourceGroup?: string;
  region?: string;
  environment?: string;
}

export interface CreateTenantInput {
  tenantName: string;
  businessUnit?: string;
  cloudProvider: CloudProvider;
  subscriptionId: string;
  regions: string[];
  environments: string[];
}

export interface OnboardClustersInput {
  tenantId: string;
  cloudProvider: CloudProvider;
  selectedClusterNames: string[];
  discoveredClusters: DiscoveredClusterWithValidation[];
}

export interface CloudDiscoveryProvider {
  authenticate(): Promise<void>;
  discoverClusters(input: DiscoverClustersInput): Promise<DiscoveredCluster[]>;
  fetchNodePools(cluster: DiscoveredCluster): Promise<NodePoolRecord[]>;
  validateCluster(
    cluster: DiscoveredCluster,
  ): Promise<Partial<ValidationResult>>;
}
