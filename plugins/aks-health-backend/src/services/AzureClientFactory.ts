import { ContainerServiceClient } from '@azure/arm-containerservice';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';

export class AzureClientFactory {
  private readonly logger: LoggerService;
  private readonly clients = new Map<string, ContainerServiceClient>();

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  getContainerServiceClient(subscriptionId: string): ContainerServiceClient {
    let client = this.clients.get(subscriptionId);
    if (!client) {
      const credential = createCloudHubAzureCredential((message, metadata) =>
        this.logger.info(message, metadata),
      );
      client = new ContainerServiceClient(credential, subscriptionId);
      this.clients.set(subscriptionId, client);
    }
    return client;
  }

  async getManagedCluster(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
  ) {
    const client = this.getContainerServiceClient(subscriptionId);
    return await client.managedClusters.get(resourceGroup, clusterName);
  }

  async getClusterKubeConfig(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
  ): Promise<string | null> {
    const client = this.getContainerServiceClient(subscriptionId);
    try {
      const userCreds =
        await client.managedClusters.listClusterUserCredentials(
          resourceGroup,
          clusterName,
        );
      const val = userCreds.kubeconfigs?.[0]?.value;
      if (val) {
        return Buffer.from(val).toString('utf8');
      }
    } catch (err: any) {
      this.logger.warn(
        `[aks-health] Failed user credentials retrieval for ${clusterName}: ${err.message}`,
      );
    }

    try {
      const adminCreds =
        await client.managedClusters.listClusterAdminCredentials(
          resourceGroup,
          clusterName,
        );
      const val = adminCreds.kubeconfigs?.[0]?.value;
      if (val) {
        return Buffer.from(val).toString('utf8');
      }
    } catch (err: any) {
      this.logger.warn(
        `[aks-health] Failed admin credentials retrieval for ${clusterName}: ${err.message}`,
      );
    }

    return null;
  }
}
