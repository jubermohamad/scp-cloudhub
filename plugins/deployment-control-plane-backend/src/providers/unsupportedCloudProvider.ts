import type { LoggerService } from '@backstage/backend-plugin-api';
import type { CloudProvider } from './cloudProvider';
import type { DiscoveredCluster, ProvisionRequest } from '../types';

export type UnsupportedCloud = 'aws' | 'gcp';

const LABEL: Record<UnsupportedCloud, string> = {
  aws: 'AWS',
  gcp: 'Google Cloud',
};

/**
 * Placeholder provider for clouds CloudHub does not implement yet. Azure is the
 * only supported cloud today; these fail loudly rather than silently returning
 * empty results that would look like a working-but-empty environment.
 */
export class UnsupportedCloudProvider implements CloudProvider {
  private readonly cloud: UnsupportedCloud;
  private readonly logger: LoggerService;

  constructor(cloud: UnsupportedCloud, logger: LoggerService) {
    this.cloud = cloud;
    this.logger = logger;
  }

  private unsupported(operation: string): never {
    const message = `${LABEL[this.cloud]} is not supported yet: ${operation} is only implemented for Azure.`;
    this.logger.warn(`[cloud-provider] ${message}`);
    throw new Error(message);
  }

  async discoverClusters(_input: {
    subscriptionId: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]> {
    return this.unsupported('cluster discovery');
  }

  async discoverResourceGroups(_input: {
    subscriptionId: string;
    search?: string;
  }): Promise<string[]> {
    return this.unsupported('resource group discovery');
  }

  async provisionCluster(
    _input: ProvisionRequest,
  ): Promise<{ accepted: boolean; details: Record<string, unknown> }> {
    return this.unsupported('cluster provisioning');
  }

  async updateCluster(_input: {
    clusterName: string;
    subscriptionId: string;
    region?: string;
    nodePools?: Array<{ name: string; nodeCount: number }>;
  }): Promise<{ accepted: boolean; details: Record<string, unknown> }> {
    return this.unsupported('cluster update');
  }
}

export class AwsProvider extends UnsupportedCloudProvider {
  constructor(logger: LoggerService) {
    super('aws', logger);
  }
}

export class GcpProvider extends UnsupportedCloudProvider {
  constructor(logger: LoggerService) {
    super('gcp', logger);
  }
}
