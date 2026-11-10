export type GpuSkuId = 'a100' | 'h100';

export interface GpuSkuOption {
  id: GpuSkuId;
  label: string;
  vmSize: string;
  gpuFamily: string;
}

export type GpuInstanceStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'TRIGGERING_WORKFLOW'
  | 'PROVISIONING'
  | 'READY'
  | 'STARTING'
  | 'STOPPING'
  | 'STOPPED'
  | 'START_FAILED'
  | 'STOP_FAILED'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED'
  | 'DELETE_FAILED';

export interface GpuInstanceRecord {
  id: string;
  name: string;
  gpuSku: GpuSkuId;
  vmSize: string;
  region: string;
  resourceGroup: string;
  subscriptionId: string;
  subnetId: string;
  environment: string;
  owner: string;
  businessJustification: string;
  leaseDuration: string;
  terraformRepository: string;
  terraformBranch: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  mode: 'simulated' | 'github-api' | 'terraform-cloud';
  status: GpuInstanceStatus;
  statusMessage: string | null;
  failureReason: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
}

export interface GpuComputeOptions {
  skus: GpuSkuOption[];
  leaseDurations: string[];
  onboardedVnets: Array<{
    subscriptionId: string;
    resourceGroup: string;
    vnetName: string;
    region: string;
  }>;
  resourceGroup: string;
  terraformRepository: string;
  terraformBranch: string;
}

export interface GpuQuotaCheckResult {
  gpuSku: GpuSkuId;
  region: string;
  vmSize: string;
  gpuFamily: string;
  currentUsage: number;
  limit: number;
  available: number;
  requested: number;
  sufficient: boolean;
  message: string;
}

export interface GpuNetworkSubnet {
  name: string;
  addressRange: string;
  totalAddresses?: number;
  usedAddresses?: number;
  availableIpAddresses: number;
  lowCapacity?: boolean;
}

export interface CreateGpuInstanceFormState {
  name: string;
  gpuSku: GpuSkuId | '';
  region: string;
  subscriptionId: string;
  vnetName: string;
  subnetName: string;
  owner: string;
  businessJustification: string;
  leaseDuration: string;
}

export interface GpuInstanceEvent {
  id: string;
  instanceId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface GpuInstanceLogSnapshot {
  mode: string;
  runId: string | null;
  lines: string[];
}
