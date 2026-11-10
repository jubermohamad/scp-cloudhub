import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CertificationResult } from '../components/CertificationResult';
import { HealthSummaryCard } from '../components/HealthSummaryCard';
import { HealthBreakdownTable } from '../components/HealthBreakdownTable';
import { FindingsPanel } from '../components/FindingsPanel';
import { ClusterSelector } from '../components/ClusterSelector';
import type { AksHealthRunResult, AksHealthCheck } from '../api/AksHealthApi';

describe('AKS Health UI Components', () => {
  const mockChecks: AksHealthCheck[] = [
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
      findings: [
        'Namespace: nr-scotia',
        'Cluster: postgresql-cluster',
        'Issue: Cluster failing over',
        'Ready: 2/3',
        'Recommendation: Investigate primary replica instability',
      ],
      details: {
        namespace: 'nr-scotia',
        cluster: 'postgresql-cluster',
        issue: 'Cluster failing over',
        ready: '2/3',
        recommendation: 'Investigate primary replica instability',
      },
    },
    { name: 'Events', status: 'WARNING', score: 3, weight: 5 },
    { name: 'Security', status: 'PASS', score: 3, weight: 3 },
    { name: 'Observability', status: 'PASS', score: 1, weight: 1 },
    { name: 'Backup DR', status: 'PASS', score: 1, weight: 1 },
  ];

  const mockResult: AksHealthRunResult = {
    clusterName: 'aks-scp-prd-cnc-st-scotia',
    overallScore: 87,
    status: 'DEGRADED',
    certified: false,
    reason: 'PostgreSQL cluster in failover state',
    checks: mockChecks,
  };

  it('CertificationResult renders exact cluster and status details', () => {
    render(<CertificationResult result={mockResult} />);

    expect(
      screen.getByText('Cluster: aks-scp-prd-cnc-st-scotia'),
    ).toBeInTheDocument();
    expect(screen.getByText('Control Plane')).toBeInTheDocument();
    expect(screen.getByText('CloudNativePG')).toBeInTheDocument();
    expect(screen.getByText('87/100')).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('NO')).toBeInTheDocument();
    expect(
      screen.getByText('PostgreSQL cluster in failover state'),
    ).toBeInTheDocument();
  });

  it('HealthSummaryCard renders score and badges', () => {
    render(<HealthSummaryCard result={mockResult} />);

    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText('/100')).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('NO')).toBeInTheDocument();
    expect(
      screen.getByText('PostgreSQL cluster in failover state'),
    ).toBeInTheDocument();
  });

  it('ClusterSelector renders dropdowns and triggers check', () => {
    const onRun = jest.fn();
    render(
      <ClusterSelector
        customers={['ScotiaBank', 'MetroBank']}
        selectedCustomer="ScotiaBank"
        onSelectCustomer={jest.fn()}
        environments={['PROD']}
        selectedEnvironment="PROD"
        onSelectEnvironment={jest.fn()}
        clusters={[
          {
            id: '123',
            customerName: 'ScotiaBank',
            environment: 'PROD',
            subscriptionId: 'sub-1',
            resourceGroup: 'rg-1',
            clusterName: 'aks-scp-prd-cnc-st-scotia',
            region: 'eastus2',
          },
        ]}
        selectedClusterId="123"
        onSelectCluster={jest.fn()}
        onRunHealthCheck={onRun}
        isRunning={false}
        loadingClusters={false}
      />,
    );

    expect(screen.getByText('AKS Health Certification')).toBeInTheDocument();
    const runBtn = screen.getByRole('button', { name: /Run Health Check/i });
    expect(runBtn).toBeEnabled();
    fireEvent.click(runBtn);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('HealthBreakdownTable lists all 12 checks', () => {
    const onSelect = jest.fn();
    render(
      <HealthBreakdownTable checks={mockChecks} onSelectCheck={onSelect} />,
    );

    expect(screen.getByText('Control Plane')).toBeInTheDocument();
    expect(screen.getByText('CloudNativePG')).toBeInTheDocument();
    expect(screen.getByText('Backup DR')).toBeInTheDocument();
  });

  it('FindingsPanel renders CNPG failover inspection details', () => {
    const cnpgCheck = mockChecks.find(c => c.name === 'CloudNativePG')!;
    render(<FindingsPanel open onClose={jest.fn()} check={cnpgCheck} />);

    expect(screen.getByText('nr-scotia')).toBeInTheDocument();
    expect(screen.getByText('postgresql-cluster')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(
      screen.getByText('Investigate primary replica instability'),
    ).toBeInTheDocument();
  });
});
