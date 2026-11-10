import { ComputeManagementClient } from '@azure/arm-compute';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { platformAzureCredential } from './platformAzureCredential';

export type AzureVmPowerState =
  | 'running'
  | 'deallocated'
  | 'starting'
  | 'stopping'
  | 'unknown';

function subscriptionId(): string {
  const id =
    process.env.GPU_AZURE_SUBSCRIPTION_ID ?? process.env.AZURE_SUBSCRIPTION_ID;
  if (!id) {
    throw new Error(
      'GPU_AZURE_SUBSCRIPTION_ID or AZURE_SUBSCRIPTION_ID must be set to control GPU VM power state',
    );
  }
  return id;
}

/**
 * GpuVmPowerService
 *
 * Starts/stops (deallocates) GPU VMs directly via the Azure Compute API.
 * The VM's Azure name always equals the CloudHub instance name (the
 * Terraform module sets override_vm_name), so no extra resource lookup is
 * needed beyond resourceGroup + name already stored on the instance record.
 * Deallocating (not just powering off) is required to actually stop GPU
 * compute billing.
 */
export class GpuVmPowerService {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  private client(): ComputeManagementClient {
    return new ComputeManagementClient(
      platformAzureCredential(this.logger),
      subscriptionId(),
    );
  }

  async start(resourceGroup: string, vmName: string): Promise<void> {
    this.logger.info(`[gpu-compute] starting VM ${vmName} in ${resourceGroup}`);
    await this.client().virtualMachines.beginStart(resourceGroup, vmName);
  }

  async stop(resourceGroup: string, vmName: string): Promise<void> {
    this.logger.info(
      `[gpu-compute] deallocating VM ${vmName} in ${resourceGroup}`,
    );
    await this.client().virtualMachines.beginDeallocate(resourceGroup, vmName);
  }

  async getPowerState(
    resourceGroup: string,
    vmName: string,
  ): Promise<AzureVmPowerState> {
    const vm = await this.client().virtualMachines.get(resourceGroup, vmName, {
      expand: 'instanceView',
    });
    const code = vm.instanceView?.statuses
      ?.find(s => s.code?.startsWith('PowerState/'))
      ?.code?.replace('PowerState/', '');

    switch (code) {
      case 'running':
        return 'running';
      case 'deallocated':
      case 'stopped':
        return 'deallocated';
      case 'starting':
        return 'starting';
      case 'deallocating':
      case 'stopping':
        return 'stopping';
      default:
        return 'unknown';
    }
  }
}
