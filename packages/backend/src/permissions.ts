import { createPermission } from '@backstage/plugin-permission-common';

export const jumpboxApprovePermission = createPermission({
  name: 'jumpbox.approve',
  attributes: { action: 'update' },
});

/** Decide the "Cloud Architect" stage of an AKS infrastructure request. */
export const aksApproveCloudArchitectPermission = createPermission({
  name: 'provisioning.aks.approve.cloud-architect',
  attributes: { action: 'update' },
});

/** Decide the "Operations" stage of an AKS infrastructure request. */
export const aksApproveOperationsPermission = createPermission({
  name: 'provisioning.aks.approve.operations',
  attributes: { action: 'update' },
});
