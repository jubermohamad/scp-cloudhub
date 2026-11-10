import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  FormControlLabel,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import {
  DEFAULT_SORT,
  filtersFromSearchParams,
  SORTABLE,
} from '../../gridQuery';
import {
  ENVIRONMENT_LABELS,
  HEALTH_LABELS,
  labelFor,
  optionsFrom,
} from '../../labels';
import type { Cluster } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import { formatDateTime, formatRelative } from '../../utils';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';
import { HealthChip, StatusChip } from '../common/StatusChip';
import { useToast } from '../common/useToast';
import {
  ClusterDetailDrawer,
  MANAGED_CLUSTER_EXPLANATION,
} from './ClusterDetailDrawer';
import { ClusterFormDialog } from './ClusterFormDialog';
import { ClusterSyncButton } from './ClusterSyncButton';

const FILTER_KEYS = ['tenantId', 'environment', 'status', 'includeRetired'];

export function ClustersPage() {
  return (
    <HubLayout label="Clusters">
      <ClustersContent />
    </HubLayout>
  );
}

function ClustersContent() {
  const { api, isPlatformAdmin, filterOptions, reloadFilterOptions } = useHub();
  const [searchParams] = useSearchParams();
  const grid = useServerGrid<Cluster>(query => api.listClusters(query), {
    allowedSort: SORTABLE.clusters,
    defaultSort: DEFAULT_SORT.clusters,
    initialFilters: filtersFromSearchParams(searchParams, FILTER_KEYS),
  });
  const { showToast, toastElement } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const refresh = () => {
    grid.reload({ silent: true });
    reloadFilterOptions();
  };

  const columns = useMemo<GridColDef<Cluster>[]>(
    () => [
      {
        field: 'clusterName',
        headerName: 'Cluster',
        minWidth: 200,
        flex: 1.3,
        renderCell: ({ row }) => (
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace' }}
            noWrap
            title={row.clusterName}
          >
            {row.clusterName}
          </Typography>
        ),
      },
      { field: 'tenantId', headerName: 'Tenant', minWidth: 110 },
      {
        field: 'environment',
        headerName: 'Environment',
        minWidth: 120,
        valueFormatter: (value: string) => labelFor(ENVIRONMENT_LABELS, value),
      },
      {
        field: 'region',
        headerName: 'Region',
        minWidth: 120,
        valueFormatter: (value: string | null) => value ?? '—',
      },
      {
        field: 'agentVersion',
        headerName: 'Agent Version',
        minWidth: 120,
        sortable: false,
        valueFormatter: (value: string | null) => value ?? '—',
      },
      {
        field: 'health',
        headerName: 'Status',
        minWidth: 110,
        renderCell: ({ row }) => <HealthChip health={row.health} />,
      },
      {
        field: 'lastHeartbeat',
        headerName: 'Last Heartbeat',
        minWidth: 140,
        renderCell: ({ row }) => (
          <Tooltip title={formatDateTime(row.lastHeartbeat)}>
            <span>{formatRelative(row.lastHeartbeat)}</span>
          </Tooltip>
        ),
      },
      {
        field: 'platformRegistryId',
        headerName: 'Managed',
        minWidth: 150,
        sortable: false,
        renderCell: ({ row }) =>
          row.platformRegistryId ? (
            <Tooltip title={MANAGED_CLUSTER_EXPLANATION}>
              <span>
                <StatusChip
                  label="Platform Registry"
                  tone="info"
                  variant="outlined"
                />
              </span>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Manual
            </Typography>
          ),
      },
      {
        field: 'isRetired',
        headerName: 'Retired',
        minWidth: 100,
        sortable: false,
        renderCell: ({ row }) =>
          row.isRetired ? (
            <StatusChip label="Retired" tone="default" />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No
            </Typography>
          ),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'center' }}
        spacing={1}
      >
        <Typography variant="body2" color="text.secondary">
          AKS clusters that run exports. Health comes from agent heartbeats:
          healthy under 5 minutes, warning to 10, critical to 15, then offline.
          Clusters synced from Platform Registry are read-only here.
        </Typography>
        {isPlatformAdmin && (
          <Stack direction="row" spacing={1} flexShrink={0}>
            <ClusterSyncButton api={api} onSynced={() => refresh()} />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setRegistering(true)}
            >
              Register cluster
            </Button>
          </Stack>
        )}
      </Stack>

      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={['tenant', 'environment', 'status']}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Cluster name',
        }}
        statusLabel="Health"
        statusOptions={optionsFrom(HEALTH_LABELS)}
      >
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={grid.filters.includeRetired === true}
              onChange={(_e, checked) =>
                grid.setFilter('includeRetired', checked || undefined)
              }
            />
          }
          label="Include retired"
        />
      </EntityFilterBar>

      <ServerDataGrid<Cluster>
        ariaLabel="Clusters"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage={
          isPlatformAdmin
            ? 'No clusters match. Sync from Platform Registry or register a cluster.'
            : 'No clusters are registered for your tenants yet.'
        }
        onRowClick={({ row }) => setSelectedId(row.id)}
        getRowClassName={({ row }) => (row.isRetired ? 'dx-row-muted' : '')}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
      />

      <ClusterDetailDrawer
        clusterId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
        showToast={showToast}
      />
      <ClusterFormDialog
        open={registering}
        api={api}
        tenantSuggestions={filterOptions.tenants}
        onClose={() => setRegistering(false)}
        onSaved={saved => {
          showToast('success', `Registered ${saved.clusterName}`);
          refresh();
        }}
      />
      {toastElement}
    </Stack>
  );
}
