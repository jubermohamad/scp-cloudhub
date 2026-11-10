import { ComputeManagementClient } from '@azure/arm-compute';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';

export type AzureVmPowerState = 'Running' | 'Stopped';

export interface AzureVmRecord {
  vmName: string;
  resourceGroupName: string;
  instanceType: string;
  location: string;
  currentState: AzureVmPowerState;
  costPerMonth: number;
  environment: string;
}

export interface AzureVmListOptions {
  /** Optional resource-group scope (case-insensitive). */
  resourceGroupName?: string;
  /**
   * When true and resourceGroupName is provided, include all VMs in that
   * resource group regardless of environment tags.
   */
  includeAllInResourceGroup?: boolean;
}

const HOURS_PER_MONTH = 730;

/** Tag keys accepted as the environment marker, lowest-priority last. */
const ENV_TAG_KEYS = ['env', 'environment'];

/**
 * Only VMs carrying this environment tag may be listed or power-controlled.
 * Untagged and production machines are excluded, so a mistake here cannot
 * deallocate production. Override with CLOUDHUB_VM_ALLOWED_ENV.
 */
function allowedEnvironment(): string {
  return (process.env.CLOUDHUB_VM_ALLOWED_ENV || 'dev').trim().toLowerCase();
}

function environmentTag(tags: Record<string, string> | undefined): string {
  if (!tags) return '';
  const lowered = new Map(
    Object.entries(tags).map(([k, v]) => [k.toLowerCase(), (v ?? '').trim()]),
  );
  for (const key of ENV_TAG_KEYS) {
    const value = lowered.get(key);
    if (value) return value.toLowerCase();
  }
  return '';
}

function resourceGroupFromId(id: string | undefined): string {
  const match = /\/resourceGroups\/([^/]+)\//i.exec(id ?? '');
  return match?.[1] ?? '';
}

/** `PowerState/running` -> `running` */
function powerStateFromStatuses(
  statuses: Array<{ code?: string }> | undefined,
): AzureVmPowerState {
  const code = statuses
    ?.map(s => s.code ?? '')
    .find(c => c.toLowerCase().startsWith('powerstate/'));
  return code?.toLowerCase() === 'powerstate/running' ? 'Running' : 'Stopped';
}

/**
 * Live Azure VM inventory and power control, replacing the previous in-memory
 * mock inventory. Pricing comes from the public Azure Retail Prices API.
 */
export class AzureVmService {
  private readonly logger: LoggerService;
  private readonly priceCache = new Map<string, number>();

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  private client(subscriptionId: string) {
    return new ComputeManagementClient(
      createCloudHubAzureCredential((message, metadata) =>
        this.logger.info(message, metadata),
      ),
      subscriptionId,
    );
  }

  /** Hourly USD for a SKU/region, 0 when pricing cannot be resolved. */
  private async hourlyRate(
    armSkuName: string,
    armRegionName: string,
  ): Promise<number> {
    const key = `${armSkuName}|${armRegionName}`.toLowerCase();
    const cached = this.priceCache.get(key);
    if (cached !== undefined) return cached;

    try {
      const filter =
        `serviceName eq 'Virtual Machines' and armSkuName eq '${armSkuName}' ` +
        `and armRegionName eq '${armRegionName}' and priceType eq 'Consumption'`;
      const response = await fetch(
        `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`,
      );
      if (!response.ok) {
        this.priceCache.set(key, 0);
        return 0;
      }
      const body = (await response.json()) as {
        Items?: Array<{
          retailPrice?: number;
          productName?: string;
          meterName?: string;
        }>;
      };
      const item = (body.Items ?? []).find(
        i =>
          !/windows/i.test(i.productName ?? '') &&
          !/spot|low priority/i.test(i.meterName ?? ''),
      );
      const rate = item?.retailPrice ?? 0;
      this.priceCache.set(key, rate);
      return rate;
    } catch (error) {
      this.logger.warn(
        `[cost-automation] retail price lookup failed for ${armSkuName}/${armRegionName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.priceCache.set(key, 0);
      return 0;
    }
  }

  async listVms(
    subscriptionId: string,
    options: AzureVmListOptions = {},
  ): Promise<AzureVmRecord[]> {
    const client = this.client(subscriptionId);
    const allowedEnv = allowedEnvironment();
    const requestedResourceGroup = (options.resourceGroupName ?? '').trim();
    const requestedResourceGroupLower = requestedResourceGroup.toLowerCase();
    const includeAllInResourceGroup =
      Boolean(options.includeAllInResourceGroup) &&
      requestedResourceGroupLower.length > 0;
    const records: AzureVmRecord[] = [];
    let skipped = 0;

    const vmSource = requestedResourceGroup
      ? client.virtualMachines.list(requestedResourceGroup)
      : client.virtualMachines.listAll({
          expand: 'instanceView',
        });

    for await (const vm of vmSource) {
      const resourceGroupName =
        resourceGroupFromId(vm.id) || requestedResourceGroup;
      if (
        requestedResourceGroupLower &&
        resourceGroupName.toLowerCase() !== requestedResourceGroupLower
      ) {
        skipped += 1;
        continue;
      }

      const environment = environmentTag(vm.tags);
      if (!includeAllInResourceGroup && environment !== allowedEnv) {
        skipped += 1;
        continue;
      }

      const instanceType = vm.hardwareProfile?.vmSize ?? 'unknown';
      const location = vm.location ?? '';
      const rate = await this.hourlyRate(instanceType, location);
      const instanceView = includeAllInResourceGroup
        ? await client.virtualMachines.instanceView(
            resourceGroupName,
            vm.name ?? '',
          )
        : vm.instanceView;

      records.push({
        vmName: vm.name ?? '',
        resourceGroupName,
        instanceType,
        location,
        environment,
        currentState: powerStateFromStatuses(instanceView?.statuses),
        costPerMonth: Math.round(rate * HOURS_PER_MONTH * 100) / 100,
      });
    }

    if (includeAllInResourceGroup) {
      this.logger.info(
        `[cost-automation] VM inventory scoped to resource group ${requestedResourceGroup}: ${records.length} eligible, ${skipped} excluded`,
      );
    } else {
      this.logger.info(
        `[cost-automation] VM inventory filtered to ${allowedEnv}: ${records.length} eligible, ${skipped} excluded`,
      );
    }

    return records.filter(vm => vm.vmName);
  }

  async startVm(
    subscriptionId: string,
    resourceGroupName: string,
    vmName: string,
  ): Promise<void> {
    this.logger.info(
      `[cost-automation] starting VM ${resourceGroupName}/${vmName}`,
    );
    await this.client(subscriptionId).virtualMachines.beginStart(
      resourceGroupName,
      vmName,
    );
  }

  /** Deallocates so compute billing stops; a plain power-off keeps charging. */
  async stopVm(
    subscriptionId: string,
    resourceGroupName: string,
    vmName: string,
  ): Promise<void> {
    this.logger.info(
      `[cost-automation] deallocating VM ${resourceGroupName}/${vmName}`,
    );
    await this.client(subscriptionId).virtualMachines.beginDeallocate(
      resourceGroupName,
      vmName,
    );
  }
}
