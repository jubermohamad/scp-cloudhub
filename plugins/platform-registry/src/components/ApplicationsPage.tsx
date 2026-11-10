import { ColumnDef, RegistryListPage } from './common/RegistryListPage';
import { FieldDef } from './common/CreateEntityDialog';
import { TagChip } from './common/StatusChip';
import type { Application } from '../types';

const columns: ColumnDef<Application>[] = [
  { key: 'name', label: 'Application', render: r => r.applicationName },
  { key: 'type', label: 'Type', render: r => r.applicationType ?? '—' },
  { key: 'chart', label: 'Helm Chart', render: r => r.helmChart ?? '—' },
  {
    key: 'namespace',
    label: 'Default Namespace',
    render: r => r.defaultNamespace ?? '—',
  },
  {
    key: 'platforms',
    label: 'Supported Platforms',
    render: r =>
      r.supportedPlatforms.length
        ? r.supportedPlatforms.map(p => <TagChip key={p} label={p} />)
        : '—',
  },
];

const createFields: FieldDef[] = [
  {
    name: 'applicationName',
    label: 'Application Name',
    type: 'text',
    required: true,
  },
  { name: 'applicationType', label: 'Application Type', type: 'text' },
  { name: 'helmChart', label: 'Helm Chart', type: 'text' },
  { name: 'repository', label: 'Repository', type: 'text' },
  { name: 'defaultNamespace', label: 'Default Namespace', type: 'text' },
  {
    name: 'supportedPlatforms',
    label: 'Supported Platforms',
    type: 'multiselect',
    options: [
      { value: 'AKS', label: 'AKS' },
      { value: 'EKS', label: 'EKS' },
      { value: 'GKE', label: 'GKE' },
      { value: 'OpenShift', label: 'OpenShift' },
      { value: 'RKE2', label: 'RKE2' },
    ],
  },
];

export function ApplicationsPage() {
  return (
    <RegistryListPage
      title="Platform Registry"
      subtitle="Application Catalog"
      pageType="Applications"
      columns={columns}
      searchPlaceholder="Search applications"
      fetcher={(api, args) => api.listApplications(args)}
      createFields={createFields}
      createLabel="New Application"
      onCreate={(api, values) => api.createApplication(values)}
      onDelete={(api, id) => api.deleteApplication(id)}
    />
  );
}
