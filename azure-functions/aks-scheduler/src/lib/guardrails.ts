/**
 * guardrails.ts
 *
 * Safety checks that must all pass before the scheduler executes any action.
 * Enforcing these here (close to the execution path) means they cannot be
 * bypassed even if Backstage configuration is incorrect.
 *
 * Rules (non-negotiable):
 *   1. Never touch production clusters.
 *   2. Skip if the cluster is already in the desired state (idempotency).
 *   3. Skip if the cluster is currently transitioning (Starting/Stopping).
 */

import { ManagedCluster } from './types';

export type GuardrailResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Evaluate whether performing `action` on `cluster` is safe right now.
 */
export function checkGuardrails(
  cluster: ManagedCluster,
  action: 'stop' | 'start',
): GuardrailResult {
  // ── Rule 1: Never touch production ──────────────────────────────────────
  if (cluster.environment === 'prod' || cluster.environment === 'production') {
    return {
      allowed: false,
      reason: `GUARDRAIL: cluster "${cluster.clusterName}" has environment="${cluster.environment}" — production clusters are never automatically stopped/started.`,
    };
  }

  // ── Rule 2: Skip transitioning clusters ─────────────────────────────────
  const transitioningStates = [
    'Starting',
    'Stopping',
    'Creating',
    'Updating',
    'Deleting',
  ];
  if (transitioningStates.includes(cluster.powerState)) {
    return {
      allowed: false,
      reason: `GUARDRAIL: cluster "${cluster.clusterName}" is currently "${cluster.powerState}" — skipping to avoid race condition.`,
    };
  }

  // ── Rule 3: Idempotency — skip if already in desired state ───────────────
  if (action === 'stop' && cluster.powerState === 'Stopped') {
    return {
      allowed: false,
      reason: `GUARDRAIL: cluster "${cluster.clusterName}" is already Stopped — skipping stop action.`,
    };
  }
  if (action === 'start' && cluster.powerState === 'Running') {
    return {
      allowed: false,
      reason: `GUARDRAIL: cluster "${cluster.clusterName}" is already Running — skipping start action.`,
    };
  }

  return { allowed: true };
}
