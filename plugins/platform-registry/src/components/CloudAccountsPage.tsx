import { ColumnDef, RegistryListPage } from './common/RegistryListPage';
import { FieldDef } from './common/CreateEntityDialog';
import { StatusChip, TagChip } from './common/StatusChip';
import type { CloudAccount } from '../types';

const columns: ColumnDef<CloudAccount>[] = [
  {
    key: 'provider',
    label: 'Provider',
    render: r => <TagChip label={r.cloudProvider} />,
  },
  { key: 'account', label: 'Account Name', render: r => r.accountName },
  {
    key: 'identifier',
    label: 'Account Identifier',
    render: r => r.accountIdentifier,
  },
  {
    key: 'platform',
    label: 'Assigned Platform',
    render: r => r.platformName ?? 'Unassigned',
  },
  {
    key: 'status',
    label: 'Status',
    render: r => <StatusChip status={r.status} />,
  },
];

const createFields: FieldDef[] = [
  {
    name: 'cloudProvider',
    label: 'Cloud Provider',
    type: 'select',
    required: true,
    options: [
      { value: 'AZURE', label: 'Azure' },
      { value: 'AWS', label: 'AWS' },
      { value: 'GCP', label: 'GCP' },
      { value: 'ONPREM', label: 'On-Prem' },
    ],
  },
  { name: 'accountName', label: 'Account Name', type: 'text', required: true },
  {
    name: 'accountIdentifier',
    label: 'Account Identifier',
    type: 'text',
    required: true,
  },
  {
    name: 'platformId',
    label: 'Assign to Platform (optional)',
    type: 'reference',
    required: false,
    referenceKey: 'platforms',
  },
];

export function CloudAccountsPage() {
  return (
    <RegistryListPage
      title="Platform Registry"
      subtitle="SymphonyAI-managed Cloud Accounts"
      pageType="Platform Cloud Accounts"
      columns={columns}
      searchPlaceholder="Search platform cloud accounts"
      fetcher={(api, args) => api.listCloudAccounts(args)}
      createFields={createFields}
      createLabel="Register Platform Cloud Account"
      referenceKeys={['platforms']}
      onCreate={(api, values) => api.createCloudAccount(values)}
      onDelete={(api, id) => api.deleteCloudAccount(id)}
    />
  );
}
