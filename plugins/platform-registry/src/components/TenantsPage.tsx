import { Link as RouterLink } from 'react-router-dom';
import { Link } from '@mui/material';
import { ColumnDef, RegistryListPage } from './common/RegistryListPage';
import { FieldDef } from './common/CreateEntityDialog';
import { StatusChip } from './common/StatusChip';
import type { Platform } from '../types';

const columns: ColumnDef<Platform>[] = [
  { key: 'code', label: 'Platform Code', render: r => r.platformCode },
  {
    key: 'name',
    label: 'Platform Name',
    render: r => (
      <Link component={RouterLink} to={`/platform-registry/platforms/${r.id}`}>
        {r.platformName}
      </Link>
    ),
  },
  { key: 'type', label: 'Platform Type', render: r => r.platformType ?? '—' },
  { key: 'owner', label: 'Owner', render: r => r.ownerEmail ?? '—' },
  {
    key: 'status',
    label: 'Status',
    render: r => <StatusChip status={r.status} />,
  },
];

const createFields: FieldDef[] = [
  {
    name: 'platformCode',
    label: 'Platform Code',
    type: 'text',
    required: true,
  },
  {
    name: 'platformName',
    label: 'Platform Name',
    type: 'text',
    required: true,
  },
  { name: 'platformType', label: 'Platform Type', type: 'text' },
  { name: 'ownerEmail', label: 'Owner Email', type: 'text' },
];

export function PlatformsPage() {
  return (
    <RegistryListPage
      title="Platform Registry"
      subtitle="Platforms"
      pageType="Platforms"
      columns={columns}
      searchPlaceholder="Search platforms"
      fetcher={(api, args) => api.listPlatforms(args)}
      createFields={createFields}
      createLabel="New Platform"
      onCreate={(api, values) => api.createPlatform(values)}
      onDelete={(api, id) => api.deletePlatform(id)}
    />
  );
}
