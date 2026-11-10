import { HealthScoreService } from '../services/HealthScoreService';
import type { HealthResult, PlatformCluster } from '../types';

describe('HealthScoreService', () => {
  const service = new HealthScoreService();

  const mockCluster: PlatformCluster = {
    id: '44444444-0000-0000-0000-000000000020',
    customerName: 'ScotiaBank',
    environment: 'PROD',
    subscriptionId: 'sub-netreveal-prod',
    resourceGroup: 'rg-scotia-prd',
    clusterName: 'aks-scp-prd-cnc-st-scotia',
    region: 'eastus2',
  };

  it('calculates individual check scores correctly', () => {
    expect(service.calculateCheckScore('PASS', 15)).toBe(15);
    expect(service.calculateCheckScore('WARNING', 10)).toBe(5);
    expect(service.calculateCheckScore('WARNING', 5, 3)).toBe(3);
    expect(service.calculateCheckScore('FAIL', 10)).toBe(0);
  });

  it('evaluates scotia cluster exactly as specified in the prompt', () => {
    const checks: HealthResult[] = [
      { name: 'Control Plane', status: 'PASS', score: 15, weight: 15 },
      { name: 'Nodes', status: 'PASS', score: 15, weight: 15 },
      { name: 'Capacity', status: 'PASS', score: 10, weight: 10 },
      { name: 'System Pods', status: 'PASS', score: 10, weight: 10 },
      { name: 'Networking', status: 'PASS', score: 10, weight: 10 },
      { name: 'Storage', status: 'PASS', score: 10, weight: 10 },
      { name: 'Workloads', status: 'WARNING', score: 9, weight: 10 },
      {
        name: 'CloudNativePG',
        status: 'FAIL',
        score: 0,
        weight: 10,
        reason: 'PostgreSQL cluster in failover state',
      },
      { name: 'Events', status: 'WARNING', score: 3, weight: 5 },
      { name: 'Security', status: 'PASS', score: 3, weight: 3 },
      { name: 'Observability', status: 'PASS', score: 1, weight: 1 },
      { name: 'Backup DR', status: 'PASS', score: 1, weight: 1 },
    ];

    const result = service.evaluateCertification(mockCluster, checks);

    expect(result.overallScore).toBe(87);
    expect(result.status).toBe('DEGRADED');
    expect(result.certified).toBe(false);
    expect(result.reason).toBe('PostgreSQL cluster in failover state');

    const formatted = result.formattedOutput!;
    expect(formatted).toContain('Cluster: aks-scp-prd-cnc-st-scotia');
    expect(formatted).toContain('Control Plane     PASS');
    expect(formatted).toContain('Nodes             PASS');
    expect(formatted).toContain('Capacity          PASS');
    expect(formatted).toContain('System Pods       PASS');
    expect(formatted).toContain('Networking        PASS');
    expect(formatted).toContain('Storage           PASS');
    expect(formatted).toContain('Workloads         WARNING');
    expect(formatted).toContain('CloudNativePG     FAIL');
    expect(formatted).toContain('Events            WARNING');
    expect(formatted).toContain('Overall Score: 87/100');
    expect(formatted).toContain('Status: DEGRADED');
    expect(formatted).toContain('Certification: NO');
    expect(formatted).toContain('Reason:\nPostgreSQL cluster in failover state');
  });

  it('certifies a healthy cluster with score >= 90 and 0 failures', () => {
    const checks: HealthResult[] = [
      { name: 'Control Plane', status: 'PASS', score: 15, weight: 15 },
      { name: 'Nodes', status: 'PASS', score: 15, weight: 15 },
      { name: 'Capacity', status: 'PASS', score: 10, weight: 10 },
      { name: 'System Pods', status: 'PASS', score: 10, weight: 10 },
      { name: 'Networking', status: 'PASS', score: 10, weight: 10 },
      { name: 'Storage', status: 'PASS', score: 10, weight: 10 },
      { name: 'Workloads', status: 'PASS', score: 10, weight: 10 },
      { name: 'CloudNativePG', status: 'PASS', score: 10, weight: 10 },
      { name: 'Events', status: 'PASS', score: 5, weight: 5 },
      { name: 'Security', status: 'PASS', score: 3, weight: 3 },
      { name: 'Observability', status: 'PASS', score: 1, weight: 1 },
      { name: 'Backup DR', status: 'PASS', score: 1, weight: 1 },
    ];

    const result = service.evaluateCertification(mockCluster, checks);

    expect(result.overallScore).toBe(100);
    expect(result.status).toBe('HEALTHY');
    expect(result.certified).toBe(true);
    expect(result.formattedOutput).toContain('Certification: YES');
  });

  it('marks cluster UNHEALTHY if score < 75 or multiple failures', () => {
    const checks: HealthResult[] = [
      { name: 'Control Plane', status: 'FAIL', score: 0, weight: 15, reason: 'Control plane stopped' },
      { name: 'Nodes', status: 'FAIL', score: 0, weight: 15, reason: 'Nodes not ready' },
      { name: 'Capacity', status: 'PASS', score: 10, weight: 10 },
      { name: 'System Pods', status: 'PASS', score: 10, weight: 10 },
      { name: 'Networking', status: 'PASS', score: 10, weight: 10 },
      { name: 'Storage', status: 'PASS', score: 10, weight: 10 },
      { name: 'Workloads', status: 'PASS', score: 10, weight: 10 },
      { name: 'CloudNativePG', status: 'PASS', score: 10, weight: 10 },
      { name: 'Events', status: 'PASS', score: 5, weight: 5 },
      { name: 'Security', status: 'PASS', score: 3, weight: 3 },
      { name: 'Observability', status: 'PASS', score: 1, weight: 1 },
      { name: 'Backup DR', status: 'PASS', score: 1, weight: 1 },
    ];

    const result = service.evaluateCertification(mockCluster, checks);

    expect(result.overallScore).toBe(70);
    expect(result.status).toBe('UNHEALTHY');
    expect(result.certified).toBe(false);
    expect(result.formattedOutput).toContain('Certification: NO');
  });
});
