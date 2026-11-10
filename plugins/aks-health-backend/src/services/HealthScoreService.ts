import type {
  CertificationResult,
  CertificationStatus,
  CheckStatus,
  HealthResult,
  PlatformCluster,
} from '../types';

export class HealthScoreService {
  /**
   * Calculates check score based on certification rules:
   * PASS: 100% of category weight
   * WARNING: 50% of category weight (or specific partial score)
   * FAIL: 0 score
   */
  calculateCheckScore(
    status: CheckStatus,
    weight: number,
    customScore?: number,
  ): number {
    if (status === 'PASS') {
      return weight;
    }
    if (status === 'FAIL') {
      return 0;
    }
    if (typeof customScore === 'number' && customScore >= 0) {
      return Math.min(weight, Math.max(0, customScore));
    }
    return Math.round(weight * 0.5);
  }

  /**
   * Evaluates final certification status and decision:
   * Score >= 90 AND No FAIL categories = CERTIFIED (Status: HEALTHY)
   * Score 75-89 OR Single FAIL = DEGRADED (Status: DEGRADED)
   * Score < 75 OR Multiple FAILS = UNHEALTHY (Status: UNHEALTHY)
   */
  evaluateCertification(
    cluster: PlatformCluster,
    checks: HealthResult[],
    runTimestamp: string = new Date().toISOString(),
  ): CertificationResult {
    const totalScore = checks.reduce((sum, c) => sum + (c.score || 0), 0);
    const overallScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    const failChecks = checks.filter(c => c.status === 'FAIL');
    const warnChecks = checks.filter(c => c.status === 'WARNING');
    const failCount = failChecks.length;

    let status: CertificationStatus;
    let certified: boolean;
    let reason: string;

    if (overallScore >= 90 && failCount === 0) {
      status = 'HEALTHY';
      certified = true;
      reason =
        warnChecks.length > 0
          ? `Cluster certified with ${warnChecks.length} minor warning(s)`
          : 'All certification checks passed';
    } else if ((overallScore >= 75 && overallScore <= 89) || failCount === 1) {
      status = 'DEGRADED';
      certified = false;
      const primaryFail = failChecks[0];
      if (primaryFail) {
        reason = primaryFail.reason || `${primaryFail.name} check failed`;
      } else {
        reason = `Cluster health degraded with overall score ${overallScore}/100`;
      }
    } else {
      status = 'UNHEALTHY';
      certified = false;
      if (failCount > 1) {
        reason = `Multiple critical failures detected: ${failChecks
          .map(f => f.name)
          .join(', ')}`;
      } else {
        reason = `Cluster score ${overallScore}/100 below operational threshold`;
      }
    }

    const formattedOutput = this.formatCertificationText(
      cluster.clusterName,
      checks,
      overallScore,
      status,
      certified,
      reason,
    );

    return {
      clusterId: cluster.id,
      clusterName: cluster.clusterName,
      overallScore,
      status,
      certified,
      reason,
      runTimestamp,
      checks,
      formattedOutput,
    };
  }

  /**
   * Formats output in the exact required layout:
   *
   * Cluster: aks-scp-prd-cnc-st-scotia
   *
   * Control Plane     PASS
   * Nodes             PASS
   * Capacity          PASS
   * System Pods       PASS
   * Networking        PASS
   * Storage           PASS
   * Workloads         WARNING
   * CloudNativePG     FAIL
   * Events            WARNING
   *
   * Overall Score: 87/100
   *
   * Status: DEGRADED
   *
   * Certification: NO
   *
   * Reason:
   * PostgreSQL cluster in failover state
   */
  formatCertificationText(
    clusterName: string,
    checks: HealthResult[],
    overallScore: number,
    status: CertificationStatus,
    certified: boolean,
    reason: string,
  ): string {
    const lines: string[] = [];
    lines.push(`Cluster: ${clusterName}`);
    lines.push('');

    for (const check of checks) {
      const paddedName = check.name.padEnd(18, ' ');
      lines.push(`${paddedName}${check.status}`);
    }

    lines.push('');
    lines.push(`Overall Score: ${overallScore}/100`);
    lines.push('');
    lines.push(`Status: ${status}`);
    lines.push('');
    lines.push(`Certification: ${certified ? 'YES' : 'NO'}`);
    lines.push('');
    lines.push('Reason:');
    lines.push(reason);

    return lines.join('\n');
  }
}
