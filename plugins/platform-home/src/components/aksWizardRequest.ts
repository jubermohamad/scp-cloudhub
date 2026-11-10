/**
 * Pure mapping between the /create/aks wizard form and the canonical AKS
 * request accepted by the provisioning backend (POST /plan, /submit, /amend).
 * Kept free of React so it can be unit-tested directly.
 */
import {
  AKS_FLAVOR_POOLS,
  normalizeAksClusterRequest,
  type AksClusterRequest,
  type AksNodeSizeFlavor,
} from '@internal/plugin-platform-common';

/** Kubernetes version used by the current standard-root clusters. */
export const AKS_DEFAULT_KUBERNETES_VERSION = '1.36.2';

/** Editable wizard inputs; every value maps onto the canonical request. */
export interface AksWizardForm {
  clusterProfile: string;
  nodeSizeFlavor: AksNodeSizeFlavor;
  customer: string;
  businessUnit: string;
  owner: string;
  costCentre: string;
  changeTicket: string;
  env: string;
  location: string;
  tenancy: string;
  tenantId: string;
  kubernetesVersion: string;
  addressSpace: string;
  userPoolEnabled: boolean;
  userMinNodes: string;
  userMaxNodes: string;
  /** Priority of the user pool (the system pool is always Regular). */
  nodePriority: 'Regular' | 'Spot';
}

export function createInitialAksWizardForm(
  flavor: AksNodeSizeFlavor = 'small',
): AksWizardForm {
  const { userPool } = AKS_FLAVOR_POOLS[flavor];
  return {
    clusterProfile: 'free-tier',
    nodeSizeFlavor: flavor,
    customer: '',
    businessUnit: '',
    owner: '',
    costCentre: '',
    changeTicket: '',
    env: 'dev',
    location: 'australiaeast',
    tenancy: 'st',
    tenantId: '',
    kubernetesVersion: AKS_DEFAULT_KUBERNETES_VERSION,
    addressSpace: '',
    userPoolEnabled: true,
    userMinNodes: String(userPool.minCount),
    userMaxNodes: String(userPool.maxCount),
    nodePriority: 'Regular',
  };
}

export type AksWizardRequestBody = AksClusterRequest & {
  clusterAdministrators?: string[];
};

/**
 * Build the canonical request from the wizard form. The system pool and the
 * user-pool VM size come from the selected flavor; only the user-pool node
 * counts, its priority and whether it exists are editable.
 */
export function toAksClusterRequest(
  form: AksWizardForm,
  clusterAdmins?: string[],
): AksWizardRequestBody {
  const pools = AKS_FLAVOR_POOLS[form.nodeSizeFlavor] ?? AKS_FLAVOR_POOLS.small;
  const request = normalizeAksClusterRequest({
    customer: form.customer,
    businessUnit: form.businessUnit,
    owner: form.owner,
    costCentre: form.costCentre,
    changeTicket: form.changeTicket,
    clusterProfile: form.clusterProfile,
    env: form.env,
    location: form.location,
    tenancy: form.tenancy,
    tenantId: form.tenantId,
    kubernetesVersion: form.kubernetesVersion,
    addressSpace: form.addressSpace,
    systemPool: { ...pools.systemPool },
    userPool: form.userPoolEnabled
      ? {
          vmSize: pools.userPool.vmSize,
          minCount: form.userMinNodes,
          maxCount: form.userMaxNodes,
          priority: form.nodePriority,
        }
      : null,
  });
  return clusterAdmins
    ? { ...request, clusterAdministrators: [...clusterAdmins] }
    : request;
}
