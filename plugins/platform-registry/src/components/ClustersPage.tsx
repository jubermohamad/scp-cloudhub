import { useMemo } from 'react';
import { Tab, Tabs } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { ColumnDef, RegistryListPage } from './common/RegistryListPage';
import { StatusChip, TagChip } from './common/StatusChip';
import type { Cluster } from '../types';

const columns: ColumnDef<Cluster>[] = [
  {
    key: 'customerNameTag',
    label: 'Customer Name',
    render: r => r.customerTag || r.customerName || r.platformName || '—',
  },
  {
    key: 'envTag',
    label: 'Env',
    render: r => (
      <TagChip label={r.envTag || r.environment || r.environmentName || 'PROD'} />
    ),
  },
  { key: 'name', label: 'AKS Cluster', render: r => r.clusterName },
  { key: 'region', label: 'Region', render: r => r.region ?? '—' },
  {
    key: 'namespace',
    label: 'Namespace',
    render: r => r.postgresReportingNamespace ?? 'nrod',
  },
  {
    key: 'postgresReporting',
    label: 'PostgreSQL Reporting Endpoint',
    render: r =>
      `${r.postgresReportingService ?? 'postgres-ro'}.${
        r.postgresReportingNamespace ?? 'nrod'
      }.svc:5432`,
  },
  {
    key: 'status',
    label: 'Status',
    render: r => <StatusChip status={r.status} />,
  },
];

export function ClustersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const provider = new URLSearchParams(location.search).get('provider') ?? 'all';
  const providerTabs = useMemo(() => (
    <Tabs value={provider} indicatorColor="primary" textColor="primary" variant="scrollable" scrollButtons="auto">
      {[
        ['all', "All K8's Clusters"],
        ['azure', 'Azure - AKS'],
        ['aws', 'AWS - EKS'],
        ['gcp', 'GCP - GKE'],
        ['on-prem', 'On-Prem'],
      ].map(([value, label]) => <Tab key={value} value={value} label={label} onClick={() => navigate(`/platform-registry/clusters?provider=${value}`)} />)}
    </Tabs>
  ), [navigate, provider]);

  return (
    <RegistryListPage
      title="Platform Registry"
      subtitle="Live Kubernetes clusters tagged cloudhub-enabled=true and cloudhub-onboarded=true"
      pageType="All Kubernetes Clusters"
      emptyMessage="No eligible live clusters were found. Check that the Azure subscription or cloud account is configured and clusters have cloudhub-enabled=true and cloudhub-onboarded=true tags, then refresh."
      columns={columns}
      searchPlaceholder="Search clusters"
      fetcher={async (api, args) =>
        api.listOnboardedClusters({
          ...args,
          provider: provider === 'all' ? undefined : provider,
        })
      }
      extraTabs={providerTabs}
      showRefreshButton
      refreshLabel="Refresh Clusters"
      hideCreateButton
      onDelete={(api, id) => api.deleteCluster(id)}
    />
  );
}
