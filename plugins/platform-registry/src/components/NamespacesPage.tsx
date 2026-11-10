import { ColumnDef, RegistryListPage } from './common/RegistryListPage';
import { FieldDef } from './common/CreateEntityDialog';
import { StatusChip } from './common/StatusChip';
import type { Namespace } from '../types';

const columns: ColumnDef<Namespace>[] = [
  { key: 'name', label: 'Namespace', render: r => r.namespaceName },
  { key: 'cluster', label: 'Cluster', render: r => r.clusterName ?? '—' },
  { key: 'owner', label: 'Owner', render: r => r.owner ?? '—' },
  { key: 'purpose', label: 'Purpose', render: r => r.purpose ?? '—' },
  {
    key: 'status',
    label: 'Status',
    render: r => <StatusChip status={r.status} />,
  },
];

const createFields: FieldDef[] = [
  { name: 'namespaceName', label: 'Namespace', type: 'text', required: true },
  {
    name: 'clusterId',
    label: 'Cluster',
    type: 'reference',
    required: true,
    referenceKey: 'clusters',
  },
  { name: 'owner', label: 'Owner', type: 'text' },
  { name: 'purpose', label: 'Purpose', type: 'text' },
];

export function NamespacesPage() {
  return (
    <RegistryListPage
      title="Platform Registry"
      subtitle="Namespaces"
      pageType="Namespaces"
      columns={columns}
      searchPlaceholder="Search namespaces"
      fetcher={(api, args) => api.listNamespaces(args)}
      createFields={createFields}
      createLabel="New Namespace"
      referenceKeys={['clusters']}
      onCreate={(api, values) => api.createNamespace(values)}
      onDelete={(api, id) => api.deleteNamespace(id)}
    />
  );
}
