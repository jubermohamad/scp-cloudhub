import { ComputeManagementClient } from '@azure/arm-compute';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { platformAzureCredential } from './platformAzureCredential';
import type { GpuInstanceRecord, GpuQuotaCheckResult, GpuSkuId } from '../types';

// Azure vCPU-family quota names reported by the Usage API for each GPU SKU
// family this module supports. Matched case-insensitively because Azure's
// casing for these families is not stable across API versions.
const GPU_FAMILY_BY_SKU: Record<GpuSkuId, string> = {
  a100: 'standardNCADSA100v4Family',
  h100: 'StandardNCadsH100v5Family',
};

// vCPUs consumed per VM for each SKU (used to translate "1 GPU VM" into the
// vCPU quota units Azure actually tracks).
const VCPUS_PER_VM: Record<GpuSkuId, number> = {
  a100: 24,
  h100: 80,
};

function subscriptionId(): string {
  const id =
    process.env.GPU_AZURE_SUBSCRIPTION_ID ?? process.env.AZURE_SUBSCRIPTION_ID;
  if (!id) {
    throw new Error(
      'GPU_AZURE_SUBSCRIPTION_ID or AZURE_SUBSCRIPTION_ID must be set to validate GPU quota',
    );
  }
  return id;
}

/**
 * GpuQuotaService
 *
 * Validates that the platform-owned GPU subscription has enough remaining
 * vCPU-family quota in the requested region before a GPU VM request is
 * dispatched to Terraform. Azure will still reject the apply if quota was
 * consumed concurrently or if regional GPU capacity is unavailable — this is
 * a pre-flight check, not a guarantee.
 */
export class GpuQuotaService {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  async checkQuota(input: {
    gpuSku: GpuSkuId;
    vmSize: string;
    region: string;
    requestedVmCount?: number;
  }): Promise<GpuQuotaCheckResult> {
    const gpuFamily = GPU_FAMILY_BY_SKU[input.gpuSku];
    const requestedVms = input.requestedVmCount ?? 1;
    const requestedVcpus = VCPUS_PER_VM[input.gpuSku] * requestedVms;

    try {
      const client = new ComputeManagementClient(
        platformAzureCredential(this.logger),
        subscriptionId(),
      );

      let currentValue = 0;
      let limit = 0;
      let found = false;
      for await (const usage of client.usageOperations.list(input.region)) {
        if (
          usage.name?.value?.toLowerCase() === gpuFamily.toLowerCase()
        ) {
          currentValue = usage.currentValue ?? 0;
          limit = usage.limit ?? 0;
          found = true;
          break;
        }
      }

      if (!found) {
        this.logger.warn(
          `[gpu-compute] quota family ${gpuFamily} not found in region ${input.region}; treating as zero quota`,
        );
      }

      const available = Math.max(limit - currentValue, 0);
      const sufficient = available >= requestedVcpus;

      return {
        gpuSku: input.gpuSku,
        region: input.region,
        vmSize: input.vmSize,
        gpuFamily,
        currentUsage: currentValue,
        limit,
        available,
        requested: requestedVcpus,
        sufficient,
        message: sufficient
          ? `Sufficient ${gpuFamily} quota available (${available}/${limit} vCPUs free) in ${input.region}.`
          : `Insufficient ${gpuFamily} quota in ${input.region}: ${available}/${limit} vCPUs free, ${requestedVcpus} required. Request a quota increase or choose another region.`,
      };
    } catch (error) {
      this.logger.error(
        `[gpu-compute] quota check failed for ${gpuFamily} in ${input.region}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new Error(
        `Unable to validate GPU quota for ${input.region}. Try again later or contact the platform team.`,
      );
    }
  }
}

export function estimateExpiry(
  leaseDuration: string,
  from: Date = new Date(),
): string | null {
  const match = /^(\d+)d$/.exec(leaseDuration);
  if (!match) return null;
  const days = parseInt(match[1], 10);
  const expiry = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return expiry.toISOString();
}

export function isExpired(record: GpuInstanceRecord, now = new Date()): boolean {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt).getTime() < now.getTime();
}
