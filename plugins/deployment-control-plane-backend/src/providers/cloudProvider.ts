import type { DiscoveredCluster, ProvisionRequest } from '../types';

export interface CloudProvider {
  discoverClusters(input: {
    subscriptionId: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]>;
  discoverResourceGroups(input: {
    subscriptionId: string;
    search?: string;
  }): Promise<string[]>;
  provisionCluster(
    input: ProvisionRequest,
  ): Promise<{ accepted: boolean; details: Record<string, unknown> }>;
  updateCluster(input: {
    clusterName: string;
    subscriptionId: string;
    region?: string;
    nodePools?: Array<{ name: string; nodeCount: number }>;
  }): Promise<{ accepted: boolean; details: Record<string, unknown> }>;
}
