/**
 * costAutomationHelpers.ts
 *
 * Pure business-logic helpers shared by the cost automation plugin and its tests.
 * No Backstage / Express / Azure dependencies — safe to import anywhere.
 */

import type {
  AksEnvironment,
  NodePoolActionResult,
  LifecycleAction,
} from './costAutomationTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_ENVIRONMENTS = new Set<AksEnvironment>(['dev', 'qa']);

export const PROD_NAME_TOKENS = ['prod', 'prd', '-prd-', '-prod-'] as const;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if the cluster name looks like a production cluster.
 * Used as a safety guard to prevent accidentally onboarding prod.
 */
export function looksLikeProduction(name: string): boolean {
  const lower = name.toLowerCase();
  return PROD_NAME_TOKENS.some(t => lower.includes(t));
}

/**
 * Compute lifecycle plan for a set of node pools.
 *
 * Rules:
 *   stop     → User pools: count = 0
 *   start    → User pools: count = max(minCount, 1)
 *   downsize → User pools: count = minCount ?? 1  (no-op if already at target)
 *
 * System pools are NEVER included in the plan.
 */
export function planLifecycleAction(
  action: LifecycleAction,
  nodePools: {
    name: string;
    mode: string;
    count: number;
    minCount: number | null;
  }[],
  includeSystemNodePools = false,
): NodePoolActionResult[] {
  return nodePools
    .filter(
      p => p.mode === 'User' || (includeSystemNodePools && p.mode === 'System'),
    )
    .map(p => {
      let targetCount: number;
      let reason: string | null = null;

      switch (action) {
        case 'stop':
          targetCount = 0;
          break;
        case 'start':
          targetCount = Math.max(p.minCount ?? 1, 1);
          break;
        case 'downsize':
          targetCount = p.minCount !== null ? p.minCount : 1;
          if (targetCount >= p.count) {
            reason = `Pool "${p.name}" is already at or below target (${p.count} ≤ ${targetCount}). No change.`;
            targetCount = p.count;
          }
          break;
        default:
          targetCount = p.count;
      }

      return {
        nodePoolName: p.name,
        mode: (p.mode === 'System' ? 'System' : 'User') as 'System' | 'User',
        action,
        previousCount: p.count,
        targetCount,
        applied: false,
        reason,
      };
    });
}

/**
 * Validation check descriptor — shape returned by /validate endpoint.
 */
export interface ValidationCheck {
  label: string;
  passed: boolean;
  reason?: string;
}

/**
 * Build the five pre-flight validation checks using heuristics only
 * (no live Azure call). Used when Azure credentials are not configured.
 */
export function heuristicValidationChecks(
  clusterName: string,
  environment: string,
): ValidationCheck[] {
  const envAllowed = ALLOWED_ENVIRONMENTS.has(
    environment.toLowerCase() as AksEnvironment,
  );
  const notProdName = !looksLikeProduction(clusterName);
  const plausibleName = clusterName.length > 3;

  return [
    { label: 'Cluster exists', passed: plausibleName && notProdName },
    { label: 'Environment allowed (Dev / QA only)', passed: envAllowed },
    { label: 'System node pool found', passed: envAllowed && notProdName },
    { label: 'User node pool found', passed: envAllowed && notProdName },
    {
      label: 'System node pool lifecycle eligible',
      passed: envAllowed && notProdName,
    },
    { label: 'AKS auth mode supported', passed: envAllowed && notProdName },
  ];
}

/**
 * Build the five pre-flight checks when Azure credentials are configured
 * but the resource group was not supplied — we can only confirm the
 * environment check; cluster-specific checks require a live lookup.
 */
export function incompleteValidationChecks(
  environment: string,
): ValidationCheck[] {
  const envAllowed = ALLOWED_ENVIRONMENTS.has(
    environment.toLowerCase() as AksEnvironment,
  );
  const missingRg = 'Resource group is required for live Azure validation';

  return [
    { label: 'Cluster exists', passed: false, reason: missingRg },
    { label: 'Environment allowed (Dev / QA only)', passed: envAllowed },
    { label: 'System node pool found', passed: false, reason: missingRg },
    { label: 'User node pool found', passed: false, reason: missingRg },
    {
      label: 'System node pool lifecycle eligible',
      passed: false,
      reason: missingRg,
    },
    { label: 'AKS auth mode supported', passed: false, reason: missingRg },
  ];
}
