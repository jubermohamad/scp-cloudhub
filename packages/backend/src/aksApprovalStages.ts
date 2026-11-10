/**
 * Authorization model for the stages of the AKS infrastructure approval chain.
 *
 * Each stage is decided under its own Backstage permission, and each permission
 * is granted only to explicitly configured groups. There is deliberately NO
 * fallback from one stage to another: a stage whose approver groups are not
 * configured cannot be approved, and requests that need it cannot be submitted.
 *
 * Group refs are matched against the caller's ownershipEntityRefs, which in
 * production are issued by symphonyMicrosoftSignInResolver from live Entra
 * membership. A group configured here therefore only works once the sign-in
 * resolver issues it as an entitlement.
 */

import type { BasicPermission } from '@backstage/plugin-permission-common';
import {
  aksApproveCloudArchitectPermission,
  aksApproveOperationsPermission,
  jumpboxApprovePermission,
} from './permissions';

export interface ApprovalStageDefinition {
  role: string;
  permission: BasicPermission;
  /** Env var holding the comma-separated approver group refs. */
  groupEnv: string;
  /** Configured approver group refs (read at call time). */
  groups(): string[];
}

function groupsFromEnv(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map(group => group.trim())
    .filter(Boolean);
}

export const APPROVAL_STAGES: Record<string, ApprovalStageDefinition> = {
  'Platform Team': {
    role: 'Platform Team',
    permission: jumpboxApprovePermission,
    groupEnv: 'CLOUDHUB_APPROVER_GROUP_REF',
    // Pre-existing behaviour of the jumpbox.approve permission.
    groups: () =>
      groupsFromEnv('CLOUDHUB_APPROVER_GROUP_REF', [
        'group:default/platform-approvers',
      ]),
  },
  'Cloud Architect': {
    role: 'Cloud Architect',
    permission: aksApproveCloudArchitectPermission,
    groupEnv: 'CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS',
    groups: () => groupsFromEnv('CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS'),
  },
  Operations: {
    role: 'Operations',
    permission: aksApproveOperationsPermission,
    groupEnv: 'CLOUDHUB_AKS_OPERATIONS_GROUP_REFS',
    groups: () => groupsFromEnv('CLOUDHUB_AKS_OPERATIONS_GROUP_REFS'),
  },
};

export function stageDefinition(
  role: string,
): ApprovalStageDefinition | undefined {
  return APPROVAL_STAGES[role];
}

/** Roles in `chain` that cannot currently be decided by anyone. */
export function unconfiguredStages(chain: string[]): string[] {
  return chain.filter(role => {
    const def = stageDefinition(role);
    return !def || def.groups().length === 0;
  });
}

/** Stage definition owning a permission name, if any. */
export function stageForPermission(
  name: string,
): ApprovalStageDefinition | undefined {
  return Object.values(APPROVAL_STAGES).find(
    def => def.permission.name === name,
  );
}
