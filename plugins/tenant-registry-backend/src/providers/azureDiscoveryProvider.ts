import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import type {
  CloudDiscoveryProvider,
  DiscoveredCluster,
  DiscoverClustersInput,
  NodePoolRecord,
  ValidationResult,
} from '../types';

interface ResourceGraphItem {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tags?: Record<string, string>;
  properties?: {
    provisioningState?: string;
    kubernetesVersion?: string;
  };
}

const SUPPORTED_ENVIRONMENTS = ['dev', 'qa', 'uat', 'test', 'stage', 'prod'];

function detectEnvironment(
  clusterName: string,
  tags: Record<string, string>,
): string | null {
  const tagEnv = tags.environment?.toLowerCase();
  if (tagEnv && SUPPORTED_ENVIRONMENTS.includes(tagEnv)) {
    return tagEnv;
  }

  const parts = clusterName.toLowerCase().split('-');
  const match = parts.find(p => SUPPORTED_ENVIRONMENTS.includes(p));
  return match ?? null;
}

function formatResourceGroup(item: ResourceGraphItem): string {
  if (item.resourceGroup) return item.resourceGroup;
  const segments = item.id.split('/');
  const idx = segments.findIndex(x => x.toLowerCase() === 'resourcegroups');
  return idx >= 0 ? segments[idx + 1] ?? '' : '';
}

export class AzureDiscoveryProvider implements CloudDiscoveryProvider {
  private readonly logger: LoggerService;
  private readonly credential: ReturnType<typeof createCloudHubAzureCredential>;

  constructor(logger: LoggerService) {
    this.logger = logger;
    this.credential = createCloudHubAzureCredential((message, metadata) =>
      this.logger.info(message, metadata),
    );
  }

  async authenticate(): Promise<void> {
    await this.credential.getToken('https://management.azure.com/.default');
  }

  async discoverClusters(
    input: DiscoverClustersInput,
  ): Promise<DiscoveredCluster[]> {
    const graphClient = new ResourceGraphClient(this.credential);
    const subscriptions = [input.subscriptionId];

    const conditions: string[] = [
      "type =~ 'microsoft.containerservice/managedclusters'",
      `subscriptionId == '${input.subscriptionId}'`,
    ];
    if (input.resourceGroup) {
      conditions.push(`resourceGroup =~ '${input.resourceGroup}'`);
    }
    if (input.region) {
      conditions.push(`location =~ '${input.region}'`);
    }
    if (input.environment) {
      conditions.push(`tags.environment =~ '${input.environment}'`);
    }

    const query = `
      Resources
      | where ${conditions.join(' and ')}
      | project id, name, location, resourceGroup, subscriptionId, tags, properties
    `;

    const result = await graphClient.resources({
      subscriptions,
      query,
      options: {
        resultFormat: 'objectArray',
      },
    });

    const items = (result.data as ResourceGraphItem[]) ?? [];
    this.logger.info(
      `[tenant-registry] discovered ${items.length} AKS cluster(s) via Resource Graph`,
    );

    const clusters = await Promise.all(
      items.map(async item => {
        const subscriptionId = item.subscriptionId;
        const resourceGroup = formatResourceGroup(item);
        const clusterName = item.name;

        const csClient = new ContainerServiceClient(
          this.credential,
          subscriptionId,
        );

        const [detail, nodePools] = await Promise.all([
          csClient.managedClusters.get(resourceGroup, clusterName),
          csClient.agentPools.list(resourceGroup, clusterName),
        ]);

        const pools = [] as NodePoolRecord[];
        for await (const pool of nodePools) {
          pools.push({
            nodepoolName: pool.name ?? 'unknown',
            vmSize: pool.vmSize ?? 'unknown',
            nodeCount: pool.count ?? 0,
            mode: pool.mode ?? 'User',
          });
        }

        const tags = detail.tags ?? item.tags ?? {};
        const environment = detectEnvironment(clusterName, tags);

        return {
          clusterName,
          resourceGroup,
          region: detail.location ?? item.location,
          kubernetesVersion:
            detail.kubernetesVersion ??
            item.properties?.kubernetesVersion ??
            'unknown',
          nodePoolCount: pools.length,
          subscriptionId,
          environment,
          tags,
          provisioningState:
            detail.provisioningState ??
            item.properties?.provisioningState ??
            'Unknown',
        } satisfies DiscoveredCluster;
      }),
    );

    return clusters;
  }

  async fetchNodePools(cluster: DiscoveredCluster): Promise<NodePoolRecord[]> {
    const csClient = new ContainerServiceClient(
      this.credential,
      cluster.subscriptionId,
    );
    const pools = csClient.agentPools.list(
      cluster.resourceGroup,
      cluster.clusterName,
    );
    const out: NodePoolRecord[] = [];

    for await (const pool of pools) {
      out.push({
        nodepoolName: pool.name ?? 'unknown',
        vmSize: pool.vmSize ?? 'unknown',
        nodeCount: pool.count ?? 0,
        mode: pool.mode ?? 'User',
      });
    }

    return out;
  }

  async validateCluster(
    cluster: DiscoveredCluster,
  ): Promise<Partial<ValidationResult>> {
    const csClient = new ContainerServiceClient(
      this.credential,
      cluster.subscriptionId,
    );

    let kubeconfigRetrievable = false;
    let kubernetesApiReachable = false;
    let clusterReachable = false;

    try {
      const credentials =
        await csClient.managedClusters.listClusterUserCredentials(
          cluster.resourceGroup,
          cluster.clusterName,
        );
      kubeconfigRetrievable = !!credentials.kubeconfigs?.length;
      kubernetesApiReachable = kubeconfigRetrievable;
      clusterReachable = true;
    } catch {
      kubeconfigRetrievable = false;
      kubernetesApiReachable = false;
      clusterReachable = false;
    }

    return {
      clusterReachable,
      kubeconfigRetrievable,
      kubernetesApiReachable,
      provisioningStateSucceeded:
        (cluster.provisioningState ?? '').toLowerCase() === 'succeeded',
      detectedEnvironment: cluster.environment,
    };
  }
}
