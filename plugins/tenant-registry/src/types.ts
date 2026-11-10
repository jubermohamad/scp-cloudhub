export type CloudProvider = 'Azure' | 'AWS' | 'GCP' | 'On-Prem';

export interface Tenant {
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
  validation: ValidationResult;
}

export interface ClusterInventoryItem {
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
  createdAt: string;
}

export interface TenantDetail extends Tenant {
  clusters: ClusterInventoryItem[];
}
