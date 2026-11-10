/**
 * costAutomationHelpers.test.ts
 *
 * Unit tests for the pure business-logic helpers in costAutomationHelpers.ts.
 * No I/O, no Azure / Kubernetes calls — fully synchronous.
 */

import {
  looksLikeProduction,
  planLifecycleAction,
  heuristicValidationChecks,
  incompleteValidationChecks,
  ALLOWED_ENVIRONMENTS,
} from '../costAutomationHelpers';

// ─── looksLikeProduction ──────────────────────────────────────────────────────

describe('looksLikeProduction', () => {
  test.each([
    ['aks-myapp-prod-westeu', true],
    ['aks-myapp-prd-westeu', true],
    ['cluster-prd-01', true],
    ['cluster-prod-01', true],
    ['aks-cloudhub-dev-itn-freetier-visaedb-app', false],
    ['aks-cloudhub-qa-itn-singleregion-visaedb-app', false],
    ['my-cluster', false],
    ['staging', false],
    ['', false],
  ])('"%s" → %s', (name, expected) => {
    expect(looksLikeProduction(name)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(looksLikeProduction('AKS-MYAPP-PROD-WEU')).toBe(true);
    expect(looksLikeProduction('AKS-MYAPP-PRD-WEU')).toBe(true);
  });
});

// ─── ALLOWED_ENVIRONMENTS ─────────────────────────────────────────────────────

describe('ALLOWED_ENVIRONMENTS', () => {
  it('contains dev and qa', () => {
    expect(ALLOWED_ENVIRONMENTS.has('dev')).toBe(true);
    expect(ALLOWED_ENVIRONMENTS.has('qa')).toBe(true);
  });

  it('does not contain prod or staging', () => {
    expect(ALLOWED_ENVIRONMENTS.has('prod' as never)).toBe(false);
    expect(ALLOWED_ENVIRONMENTS.has('staging' as never)).toBe(false);
  });
});

// ─── planLifecycleAction ──────────────────────────────────────────────────────

const pools = [
  { name: 'system', mode: 'System', count: 3, minCount: 1 },
  { name: 'user1', mode: 'User', count: 3, minCount: 1 },
  { name: 'user2', mode: 'User', count: 5, minCount: 2 },
];

describe('planLifecycleAction — stop', () => {
  it('sets all User pool counts to 0', () => {
    const result = planLifecycleAction('stop', pools);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.targetCount === 0)).toBe(true);
  });

  it('never includes System pools', () => {
    const result = planLifecycleAction('stop', pools);
    expect(result.find(r => r.nodePoolName === 'system')).toBeUndefined();
  });

  it('marks applied=false', () => {
    const result = planLifecycleAction('stop', pools);
    expect(result.every(r => r.applied === false)).toBe(true);
  });
});

describe('planLifecycleAction — start', () => {
  it('restores User pools to max(minCount, 1)', () => {
    const stoppedPools = pools.map(p => ({ ...p, count: 0 }));
    const result = planLifecycleAction('start', stoppedPools);
    const user1 = result.find(r => r.nodePoolName === 'user1')!;
    const user2 = result.find(r => r.nodePoolName === 'user2')!;
    expect(user1.targetCount).toBe(1); // max(minCount=1, 1) = 1
    expect(user2.targetCount).toBe(2); // max(minCount=2, 1) = 2
  });

  it('uses 1 when minCount is null', () => {
    const nillPools = [{ name: 'u', mode: 'User', count: 0, minCount: null }];
    const result = planLifecycleAction('start', nillPools);
    expect(result[0].targetCount).toBe(1);
  });
});

describe('planLifecycleAction — downsize', () => {
  it('reduces User pools to minCount', () => {
    const result = planLifecycleAction('downsize', pools);
    const user1 = result.find(r => r.nodePoolName === 'user1')!;
    const user2 = result.find(r => r.nodePoolName === 'user2')!;
    expect(user1.targetCount).toBe(1);
    expect(user2.targetCount).toBe(2);
  });

  it('is a no-op and adds a reason when pool is already at minCount', () => {
    const atMin = [{ name: 'u', mode: 'User', count: 1, minCount: 1 }];
    const result = planLifecycleAction('downsize', atMin);
    expect(result[0].targetCount).toBe(1);
    expect(result[0].reason).toMatch(/already at or below/i);
  });

  it('uses 1 when minCount is null', () => {
    const nillPools = [{ name: 'u', mode: 'User', count: 3, minCount: null }];
    const result = planLifecycleAction('downsize', nillPools);
    expect(result[0].targetCount).toBe(1);
  });
});

describe('planLifecycleAction — mixed pools', () => {
  it('returns empty array when all pools are System', () => {
    const systemOnly = [{ name: 'sys', mode: 'System', count: 2, minCount: 1 }];
    expect(planLifecycleAction('stop', systemOnly)).toHaveLength(0);
  });

  it('returns empty array when pool list is empty', () => {
    expect(planLifecycleAction('stop', [])).toHaveLength(0);
  });
});

// ─── heuristicValidationChecks ───────────────────────────────────────────────

describe('heuristicValidationChecks', () => {
  it('passes all checks for a valid dev cluster name', () => {
    const checks = heuristicValidationChecks('aks-myapp-dev-01', 'dev');
    expect(checks.every(c => c.passed)).toBe(true);
  });

  it('passes all checks for a valid qa cluster name', () => {
    const checks = heuristicValidationChecks('aks-myapp-qa-01', 'qa');
    expect(checks.every(c => c.passed)).toBe(true);
  });

  it('fails environment check for unsupported env', () => {
    const checks = heuristicValidationChecks('aks-myapp-staging-01', 'staging');
    const envCheck = checks.find(
      c => c.label === 'Environment allowed (Dev / QA only)',
    )!;
    expect(envCheck.passed).toBe(false);
  });

  it('fails cluster-specific checks for a production cluster name', () => {
    const checks = heuristicValidationChecks('aks-myapp-prod-01', 'dev');
    const clusterExists = checks.find(c => c.label === 'Cluster exists')!;
    expect(clusterExists.passed).toBe(false);
  });

  it('fails cluster-exists check for a very short name', () => {
    const checks = heuristicValidationChecks('ab', 'dev');
    const clusterExists = checks.find(c => c.label === 'Cluster exists')!;
    expect(clusterExists.passed).toBe(false);
  });

  it('returns exactly 5 checks', () => {
    expect(heuristicValidationChecks('aks-dev-01', 'dev')).toHaveLength(6);
  });
});

// ─── incompleteValidationChecks ──────────────────────────────────────────────

describe('incompleteValidationChecks', () => {
  it('passes only the environment check for dev', () => {
    const checks = incompleteValidationChecks('dev');
    const envCheck = checks.find(
      c => c.label === 'Environment allowed (Dev / QA only)',
    )!;
    expect(envCheck.passed).toBe(true);
    const others = checks.filter(
      c => c.label !== 'Environment allowed (Dev / QA only)',
    );
    expect(others.every(c => !c.passed)).toBe(true);
  });

  it('fails the environment check for an unsupported env', () => {
    const checks = incompleteValidationChecks('prod');
    const envCheck = checks.find(
      c => c.label === 'Environment allowed (Dev / QA only)',
    )!;
    expect(envCheck.passed).toBe(false);
  });

  it('attaches a reason to cluster-specific failures', () => {
    const checks = incompleteValidationChecks('dev');
    const clusterExists = checks.find(c => c.label === 'Cluster exists')!;
    expect(clusterExists.reason).toBeTruthy();
  });

  it('returns exactly 5 checks', () => {
    expect(incompleteValidationChecks('dev')).toHaveLength(6);
  });
});
