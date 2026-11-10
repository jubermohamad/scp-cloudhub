import { ColumnDef, RegistryListPage } from './common/RegistryListPage';
import { FieldDef } from './common/CreateEntityDialog';
import { StatusChip } from './common/StatusChip';
import type { DeploymentTarget } from '../types';

const columns: ColumnDef<DeploymentTarget>[] = [
  { key: 'name', label: 'Target Name', render: r => r.targetName },
  { key: 'platform', label: 'Platform', render: r => r.platformName ?? '—' },
  {
    key: 'environment',
    label: 'Environment',
    render: r => r.environmentName ?? '—',
  },
  { key: 'cluster', label: 'Cluster', render: r => r.clusterName ?? '—' },
  { key: 'namespace', label: 'Namespace', render: r => r.namespaceName ?? '—' },
  { key: 'type', label: 'Type', render: r => r.deploymentType ?? '—' },
  {
    key: 'status',
    label: 'Status',
    render: r => <StatusChip status={r.status} />,
  },
];

const createFields: FieldDef[] = [
  { name: 'targetName', label: 'Target Name', type: 'text', required: true },
  {
    name: 'platformId',
    label: 'Platform',
    type: 'reference',
    required: true,
    referenceKey: 'platforms',
  },
  {
    name: 'environmentId',
    label: 'Environment',
    type: 'reference',
    referenceKey: 'environments',
  },
  {
    name: 'clusterId',
    label: 'Cluster',
    type: 'reference',
    referenceKey: 'clusters',
  },
  {
    name: 'namespaceId',
    label: 'Namespace',
    type: 'reference',
    referenceKey: 'namespaces',
  },
  { name: 'deploymentType', label: 'Deployment Type', type: 'text' },
];

export function DeploymentTargetsPage() {
  return (
    <RegistryListPage
      title="Platform Registry"
      subtitle="Deployment Targets"
      pageType="Deployment Targets"
      columns={columns}
      searchPlaceholder="Search deployment targets"
      fetcher={(api, args) => api.listDeploymentTargets(args)}
      createFields={createFields}
      createLabel="New Deployment Target"
      referenceKeys={['platforms', 'environments', 'clusters', 'namespaces']}
      onCreate={(api, values) => api.createDeploymentTarget(values)}
      onDelete={(api, id) => api.deleteDeploymentTarget(id)}
    />
  );
}
