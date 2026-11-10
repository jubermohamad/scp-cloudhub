import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Stack, Tooltip, Typography } from '@mui/material';
import {
  GridActionsCellItem,
  GridColDef,
  GridRowParams,
} from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import {
  CREATABLE_DESTINATION_TYPES,
  destinationTypeLabel,
} from '../../destinationFields';
import {
  DEFAULT_SORT,
  filtersFromSearchParams,
  SORTABLE,
} from '../../gridQuery';
import { DESTINATION_STATUS_LABELS, optionsFrom } from '../../labels';
import type { Destination, DestinationTestResult } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import {
  canCreateInAnyTenant,
  canManageTenant,
  formatDateTime,
} from '../../utils';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';
import { DestinationStatusChip } from '../common/StatusChip';
import { useActionRunner } from '../common/useActionRunner';
import { ToastSeverity, useToast } from '../common/useToast';
import { EditDestinationDialog } from './EditDestinationDialog';
import { NewDestinationDialog } from './NewDestinationDialog';

const TEST_SEVERITY: Record<DestinationTestResult['status'], ToastSeverity> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  FAILED: 'error',
};

export function DestinationsPage() {
  return (
    <HubLayout label="Destinations">
      <DestinationsContent />
    </HubLayout>
  );
}

function DestinationsContent() {
  const { api, me, isPlatformAdmin, tenantOptions, filterOptions } = useHub();
  const [searchParams] = useSearchParams();
  const grid = useServerGrid<Destination>(
    query => api.listDestinations(query),
    {
      allowedSort: SORTABLE.destinations,
      defaultSort: DEFAULT_SORT.destinations,
      initialFilters: filtersFromSearchParams(searchParams, [
        'tenantId',
        'status',
        'type',
      ]),
    },
  );
  const { reload } = grid;
  const { showToast, toastElement } = useToast();
  const { busyKey, run } = useActionRunner(showToast);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Destination | null>(null);

  const columns = useMemo<GridColDef<Destination>[]>(
    () => [
      { field: 'name', headerName: 'Name', flex: 1.4, minWidth: 200 },
      {
        field: 'type',
        headerName: 'Type',
        minWidth: 120,
        valueFormatter: (value: string) => destinationTypeLabel(value),
      },
      {
        field: 'tenantId',
        headerName: 'Tenant',
        minWidth: 130,
        renderCell: ({ row }) =>
          row.tenantId ?? (
            <Typography variant="body2" color="text.secondary">
              Shared
            </Typography>
          ),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 120,
        renderCell: ({ row }) => (
          <DestinationStatusChip status={row.status} enabled={row.enabled} />
        ),
      },
      {
        field: 'lastTestAt',
        headerName: 'Last Test',
        minWidth: 180,
        renderCell: ({ row }) => (
          <Tooltip title={row.lastTestMessage ?? ''}>
            <span>{formatDateTime(row.lastTestAt)}</span>
          </Tooltip>
        ),
      },
      {
        field: 'owner',
        headerName: 'Owner',
        minWidth: 140,
        flex: 1,
        sortable: false,
        valueFormatter: (value: string | null) => value ?? '—',
      },
      {
        field: 'actions',
        type: 'actions',
        headerName: 'Actions',
        width: 130,
        getActions: ({ row }: GridRowParams<Destination>) => {
          if (!canManageTenant(me, row.tenantId)) return [];
          const busy = busyKey === row.id;
          return [
            <GridActionsCellItem
              key="test"
              icon={<NetworkCheckIcon fontSize="small" />}
              label={`Test connection for ${row.name}`}
              disabled={busy}
              onClick={() =>
                run(row.id, async () => {
                  const result = await api.testDestination({ id: row.id });
                  showToast(
                    TEST_SEVERITY[result.status],
                    `${row.name}: ${result.message}`,
                  );
                  reload({ silent: true });
                })
              }
            />,
            <GridActionsCellItem
              key="edit"
              icon={<EditOutlinedIcon fontSize="small" />}
              label={`Edit ${row.name}`}
              onClick={() => setEditing(row)}
            />,
            <GridActionsCellItem
              key="toggle"
              icon={
                row.enabled ? (
                  <BlockIcon fontSize="small" />
                ) : (
                  <CheckCircleOutlineIcon fontSize="small" />
                )
              }
              label={`${row.enabled ? 'Disable' : 'Enable'} ${row.name}`}
              disabled={busy}
              onClick={() =>
                run(
                  row.id,
                  async () => {
                    await api.updateDestination(row.id, {
                      enabled: !row.enabled,
                    });
                    reload({ silent: true });
                  },
                  `${row.enabled ? 'Disabled' : 'Enabled'} ${row.name}`,
                )
              }
            />,
          ];
        },
      },
    ],
    [api, me, busyKey, run, showToast, reload],
  );

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={1}
      >
        <Typography variant="body2" color="text.secondary">
          Destinations receive exported files. ADLS Gen2 is written with the
          cluster agent’s workload identity; SFTP uses an SSH key held in Key
          Vault and a pinned host key. Shared destinations are platform-managed
          and available to every tenant.
        </Typography>
        {canCreateInAnyTenant(me) && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreating(true)}
            sx={{ flexShrink: 0 }}
          >
            New destination
          </Button>
        )}
      </Stack>

      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={['tenant', 'status']}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Destination name',
        }}
        statusOptions={optionsFrom(DESTINATION_STATUS_LABELS)}
        extra={[
          {
            key: 'type',
            label: 'Type',
            options: CREATABLE_DESTINATION_TYPES.map(type => ({
              value: type,
              label: destinationTypeLabel(type),
            })),
          },
        ]}
      />

      <ServerDataGrid<Destination>
        ariaLabel="Destinations"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage="No destinations match. Create one to start exporting."
        getRowClassName={({ row }) => (row.enabled ? '' : 'dx-row-muted')}
      />

      <NewDestinationDialog
        open={creating}
        api={api}
        onClose={() => setCreating(false)}
        tenantOptions={tenantOptions}
        allowShared={isPlatformAdmin}
        onCreated={created => {
          showToast('success', `Created ${created.name}`);
          grid.reload();
        }}
      />
      <EditDestinationDialog
        destination={editing}
        api={api}
        onClose={() => setEditing(null)}
        onSaved={saved => {
          showToast('success', `Saved ${saved.name}`);
          grid.reload({ silent: true });
        }}
      />
      {toastElement}
    </Stack>
  );
}
