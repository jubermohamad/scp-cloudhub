import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import type { CloudProvider } from './cloudProvider';
import type { DiscoveredCluster, ProvisionRequest } from '../types';

function credential(logger: LoggerService) {
  return createCloudHubAzureCredential((message, metadata) =>
    logger.info(message, metadata),
  );
}

// Subnets whose name is fixed by Azure and reserved for a platform service.
// A GPU VM NIC cannot be placed in any of these, so they must never reach the
// subnet picker (see docs/gpu-compute-network-onboarding.md).
const AZURE_RESERVED_SUBNET_NAMES = new Set([
  'gatewaysubnet',
  'azurefirewallsubnet',
  'azurefirewallmanagementsubnet',
  'azurebastionsubnet',
  'routeserversubnet',
]);

export function isAzureReservedSubnetName(name: string): boolean {
  return AZURE_RESERVED_SUBNET_NAMES.has(name.trim().toLowerCase());
}

export class AzureProvider implements CloudProvider {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;

  }

  async discoverSubscriptions(): Promise<Array<{ id: string; name: string }>> {
    const token = await credential(this.logger).getToken(
      'https://management.azure.com/.default',
    );
    if (!token) throw new Error('Unable to acquire Azure management token');
    const response = await fetch(
      'https://management.azure.com/subscriptions?api-version=2020-01-01',
      {
        headers: { Authorization: `Bearer ${token.token}` },
      },
    );
    if (!response.ok)
      throw new Error(
        `Azure subscription discovery failed with HTTP ${response.status}`,
      );
    const body = (await response.json()) as {
      value?: Array<{
        subscriptionId?: string;
        displayName?: string;
        state?: string;
      }>;
    };
    return (body.value ?? [])
      .filter(
        subscription =>
          subscription.state === 'Enabled' &&
          subscription.subscriptionId &&
          subscription.displayName,
      )
      .map(subscription => ({
        id: subscription.subscriptionId as string,
        name: subscription.displayName as string,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async discoverGpuVnets(input: {
    subscriptionId: string;
  }): Promise<
    Array<{ name: string; resourceGroup: string; location: string }>
  > {
    const graph = new ResourceGraphClient(credential(this.logger));
    const result = await graph.resources({
      subscriptions: [input.subscriptionId],
      query:
        "Resources | where type =~ 'microsoft.network/virtualnetworks' | project name, resourceGroup, location | order by name asc",
      options: { resultFormat: 'objectArray' },
    });
    return ((result.data as Array<Record<string, any>>) ?? [])
      .map(row => ({
        name: String(row.name ?? ''),
        resourceGroup: String(row.resourceGroup ?? ''),
        location: String(row.location ?? ''),
      }))
      .filter(vnet => vnet.name && vnet.resourceGroup && vnet.location);
  }

  async discoverClusters(input: {
    subscriptionId: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]> {
    const cred = credential(this.logger);
    const graph = new ResourceGraphClient(cred);

    const clauses = [
      "type =~ 'microsoft.containerservice/managedclusters'",
      `subscriptionId == '${input.subscriptionId}'`,
    ];
    if (input.region) {
      clauses.push(`location =~ '${input.region}'`);
    }
    if (input.environment) {
      clauses.push(`tags.environment =~ '${input.environment}'`);
    }
    if (input.resourceGroup) {
      clauses.push(`resourceGroup =~ '${input.resourceGroup}'`);
    }

    const result = await graph.resources({
      subscriptions: [input.subscriptionId],
      query: `
        Resources
        | where ${clauses.join(' and ')}
        | project id, name, location, resourceGroup, subscriptionId, tags, properties
      `,
      options: { resultFormat: 'objectArray' },
    });

    const rows = (result.data as Array<Record<string, any>>) ?? [];
    this.logger.info(
      `[control-plane] Azure discover returned ${rows.length} clusters`,
    );

    return rows.map(row => {
      const name = String(row.name ?? 'unknown');
      const rg = String(row.resourceGroup ?? '');
      const tags = (row.tags as Record<string, string>) ?? {};
      const envFromTag = tags.environment ?? '';
      const envFromName = name
        .split('-')
        .find((x: string) =>
          ['dev', 'qa', 'uat', 'test', 'stage', 'prod'].includes(
            x.toLowerCase(),
          ),
        );

      return {
        clusterName: name,
        region: String(row.location ?? ''),
        resourceGroup: rg,
        kubernetesVersion: String(
          row.properties?.kubernetesVersion ?? 'unknown',
        ),
        nodePools: Number(row.properties?.agentPoolProfiles?.length ?? 0),
        environment: String(envFromTag || envFromName || 'unknown'),
        tags,
        status: String(row.properties?.provisioningState ?? 'Unknown'),
        subscriptionId: String(row.subscriptionId ?? input.subscriptionId),
      };
    });
  }

  async discoverResourceGroups(input: {
    subscriptionId: string;
    search?: string;
  }): Promise<string[]> {
    const cred = credential(this.logger);
    const graph = new ResourceGraphClient(cred);

    const clauses = [
      "type =~ 'microsoft.resources/subscriptions/resourcegroups'",
      `subscriptionId == '${input.subscriptionId}'`,
    ];

    const search = input.search?.trim();
    if (search) {
      const escaped = search.replace(/'/g, "''");
      clauses.push(`tolower(name) contains tolower('${escaped}')`);
    }

    const result = await graph.resources({
      subscriptions: [input.subscriptionId],
      query: `
        ResourceContainers
        | where ${clauses.join(' and ')}
        | project resourceGroup = name
        | order by resourceGroup asc
      `,
      options: { resultFormat: 'objectArray' },
    });

    const rows = (result.data as Array<Record<string, any>>) ?? [];
    const groups = rows
      .map(row => String(row.resourceGroup ?? '').trim())
      .filter(Boolean);

    this.logger.info(
      `[control-plane] Azure discover resource groups returned ${groups.length} group(s) for subscription=${input.subscriptionId}`,
    );

    return groups;
  }

  async discoverSubnets(input: {
    subscriptionId: string;
    search?: string;
  }): Promise<
    Array<{ id: string; name: string; vnetName: string; resourceGroup: string }>
  > {
    const cred = credential(this.logger);
    const graph = new ResourceGraphClient(cred);

    const result = await graph.resources({
      subscriptions: [input.subscriptionId],
      query: `
        Resources
        | where type =~ 'microsoft.network/virtualnetworks'
        | mv-expand subnet = properties.subnets
        | project
            id = tostring(subnet.id),
            name = tostring(subnet.name),
            vnetName = name,
            resourceGroup
        | order by vnetName asc, name asc
      `,
      options: { resultFormat: 'objectArray' },
    });

    const rows = (result.data as Array<Record<string, any>>) ?? [];
    const subnets = rows
      .map(row => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        vnetName: String(row.vnetName ?? ''),
        resourceGroup: String(row.resourceGroup ?? ''),
      }))
      .filter(subnet => subnet.id);

    const search = input.search?.trim().toLowerCase();
    const filtered = search
      ? subnets.filter(
          subnet =>
            subnet.name.toLowerCase().includes(search) ||
            subnet.vnetName.toLowerCase().includes(search),
        )
      : subnets;

    this.logger.info(
      `[control-plane] Azure discover subnets returned ${filtered.length} subnet(s) for subscription=${input.subscriptionId}`,
    );

    return filtered;
  }

  async discoverGpuSubnets(input: {
    subscriptionId: string;
    resourceGroup: string;
    vnetName: string;
    region: string;
  }): Promise<
    Array<{
      id: string;
      name: string;
      addressRange: string;
      totalAddresses: number;
      usedAddresses: number;
      availableIpAddresses: number;
      location: string;
    }>
  > {
    const graph = new ResourceGraphClient(credential(this.logger));
    const safeResourceGroup = input.resourceGroup.replace(/'/g, "''");
    const safeVnet = input.vnetName.replace(/'/g, "''");
    // `delegations` and `ipConfigurations` are absent (null) rather than empty
    // on some subnets, and array_length(null) is null — hence the coalesce.
    // Project delegations as a COUNT, never as a string: Azure returns `[]`
    // for a non-delegated subnet and tostring([]) is the truthy string "[]",
    // which previously filtered out every subnet in the VNet.
    const result = await graph.resources({
      subscriptions: [input.subscriptionId],
      query: `Resources | where type =~ 'microsoft.network/virtualnetworks' | where resourceGroup =~ '${safeResourceGroup}' | where name =~ '${safeVnet}' | where location =~ '${input.region}' | mv-expand subnet = properties.subnets | project id=tostring(subnet.id), name=tostring(subnet.name), addressRange=tostring(subnet.properties.addressPrefix), used=coalesce(array_length(subnet.properties.ipConfigurations), 0), delegationCount=coalesce(array_length(subnet.properties.delegations), 0), platformReserved=tostring(subnet.tags['platform-reserved'])`,
      options: { resultFormat: 'objectArray' },
    });
    return ((result.data as Array<Record<string, any>>) ?? [])
      .map(row => {
        const prefix = String(row.addressRange ?? '');
        const mask = Number(prefix.split('/')[1]);
        const total =
          Number.isInteger(mask) && mask >= 0 && mask <= 32
            ? 2 ** (32 - mask)
            : 0;
        const usable = Math.max(total - 5, 0);
        const usedAddresses = Number(row.used ?? 0);
        return {
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          addressRange: prefix,
          totalAddresses: total,
          usedAddresses,
          availableIpAddresses: Math.max(usable - usedAddresses, 0),
          location: input.region,
          delegationCount: Number(row.delegationCount ?? 0),
          platformReserved: String(row.platformReserved ?? ''),
        };
      })
      .filter(
        subnet =>
          subnet.id &&
          subnet.name &&
          subnet.addressRange &&
          !subnet.platformReserved.toLowerCase().match(/^(true|yes)$/) &&
          subnet.delegationCount === 0 &&
          !isAzureReservedSubnetName(subnet.name),
      );
  }

  async discoverClustersByCustomerTag(input: {
    subscriptionIds: string[];
    tagKey: string;
    tagValue: string;
  }): Promise<DiscoveredCluster[]> {
    const cred = credential(this.logger);
    const graph = new ResourceGraphClient(cred);

    if (!input.subscriptionIds.length) {
      this.logger.warn(
        '[control-plane] discoverClustersByCustomerTag: no subscriptionIds provided',
      );
      return [];
    }

    // Sanitise tag key/value – only allow alphanumeric, hyphens and underscores
    const safeTagKey = input.tagKey.replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeTagValue = input.tagValue.replace(/[^a-zA-Z0-9_\-]/g, '');

    const query = `
      Resources
      | where type =~ 'microsoft.containerservice/managedclusters'
      | where tags['${safeTagKey}'] =~ '${safeTagValue}'
      | project id, name, location, resourceGroup, subscriptionId, tags, properties
    `;

    const result = await graph.resources({
      subscriptions: input.subscriptionIds,
      query,
      options: { resultFormat: 'objectArray' },
    });

    const rows = (result.data as Array<Record<string, any>>) ?? [];
    this.logger.info(
      `[control-plane] Customer tag discover (${safeTagKey}=${safeTagValue}) returned ${rows.length} clusters across ${input.subscriptionIds.length} subscription(s)`,
    );

    return rows.map(row => {
      const name = String(row.name ?? 'unknown');
      const rg = String(row.resourceGroup ?? '');
      const tags = (row.tags as Record<string, string>) ?? {};
      const envFromTag = tags.environment ?? '';
      const envFromName = name
        .split('-')
        .find((x: string) =>
          ['dev', 'qa', 'uat', 'test', 'stage', 'prod'].includes(
            x.toLowerCase(),
          ),
        );

      return {
        clusterName: name,
        region: String(row.location ?? ''),
        resourceGroup: rg,
        kubernetesVersion: String(
          row.properties?.kubernetesVersion ?? 'unknown',
        ),
        nodePools: Number(row.properties?.agentPoolProfiles?.length ?? 0),
        environment: String(envFromTag || envFromName || 'unknown'),
        tags,
        status: String(row.properties?.provisioningState ?? 'Unknown'),
        subscriptionId: String(row.subscriptionId ?? input.subscriptionIds[0]),
      };
    });
  }

  async provisionCluster(
    input: ProvisionRequest,
  ): Promise<{ accepted: boolean; details: Record<string, unknown> }> {
    // Control plane only: we return GitOps-ready intent rather than executing provisioning.
    return {
      accepted: true,
      details: {
        clusterName: input.clusterName,
        subscriptionId: input.subscriptionId,
        region: input.region,
        environment: input.environment,
        nodePools: input.nodePools,
        mode: 'gitops-intent',
      },
    };
  }

  async updateCluster(input: {
    clusterName: string;
    subscriptionId: string;
    region?: string;
    nodePools?: Array<{ name: string; nodeCount: number }>;
  }): Promise<{ accepted: boolean; details: Record<string, unknown> }> {
    const cred = credential(this.logger);
    const cs = new ContainerServiceClient(cred, input.subscriptionId);

    // No direct update to cluster configuration from Backstage workflows.
    // This call validates cluster visibility for orchestration planning.
    const list = cs.managedClusters.list();
    for await (const c of list) {
      if (String(c.name).toLowerCase() === input.clusterName.toLowerCase()) {
        return {
          accepted: true,
          details: {
            clusterName: input.clusterName,
            region: c.location,
            updatePlan: input.nodePools ?? [],
            mode: 'gitops-intent',
          },
        };
      }
    }

    return {
      accepted: false,
      details: {
        reason: `Cluster ${input.clusterName} not found in subscription`,
      },
    };
  }
}
