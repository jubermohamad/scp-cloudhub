import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import {
  DEFAULT_SORT,
  filtersFromSearchParams,
  SORTABLE,
} from '../../gridQuery';
import { HEALTH_LABELS, optionsFrom } from '../../labels';
import type { Agent } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import { formatDateTime, formatRelative, capabilitySummary } from '../../utils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';
import { HealthChip } from '../common/StatusChip';
import { useActionRunner } from '../common/useActionRunner';
import { useToast } from '../common/useToast';
import { AgentDetailDrawer } from './AgentDetailDrawer';
import { AgentEditDialog } from './AgentEditDialog';

const FILTER_KEYS = ['tenantId', 'clusterId', 'status'];

export function AgentsPage() {
  return (
    <HubLayout label="Agents">
      <AgentsContent />
    </HubLayout>
  );
}

function AgentsContent() {
  const { api, filterOptions } = useHub();
  const [searchParams] = useSearchParams();
  const grid = useServerGrid<Agent>(query => api.listAgents(query), {
    allowedSort: SORTABLE.agents,
    defaultSort: DEFAULT_SORT.agents,
    initialFilters: filtersFromSearchParams(searchParams, FILTER_KEYS),
  });
  const { showToast, toastElement } = useToast();
  const { busyKey, run } = useActionRunner(showToast);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [removing, setRemoving] = useState<Agent | null>(null);

  const columns = useMemo<GridColDef<Agent>[]>(
    () => [
      {
        field: 'agentName',
        headerName: 'Agent Name',
        minWidth: 180,
        flex: 1,
        valueFormatter: (value: string | null) => value ?? 'Unnamed agent',
      },
      {
        field: 'clusterName',
        headerName: 'Cluster',
        minWidth: 180,
        flex: 1,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap>
            {row.clusterName}
          </Typography>
        ),
      },
      { field: 'tenantId', headerName: 'Tenant', minWidth: 110 },
      {
        field: 'agentVersion',
        headerName: 'Version',
        minWidth: 100,
        valueFormatter: (value: string | null) => value ?? '—',
      },
      {
        field: 'capabilities',
        headerName: 'Capabilities',
        minWidth: 220,
        flex: 1.2,
        sortable: false,
        renderCell: ({ row }) => {
          const chips = capabilitySummary(row.capabilities);
          if (chips.length === 0) {
            return (
              <Typography variant="body2" color="text.secondary">
                None
              </Typography>
            );
          }
          return (
            <Tooltip title={chips.join(', ')}>
              <Stack direction="row" spacing={0.5} overflow="hidden">
                {chips.slice(0, 3).map(chip => (
                  <Chip
                    key={chip}
                    size="small"
                    variant="outlined"
                    label={chip}
                  />
                ))}
                {chips.length > 3 && (
                  <Chip size="small" label={`+${chips.length - 3}`} />
                )}
              </Stack>
            </Tooltip>
          );
        },
      },
      {
        field: 'lastSeen',
        headerName: 'Last Seen',
        minWidth: 130,
        renderCell: ({ row }) => (
          <Tooltip title={formatDateTime(row.lastSeen)}>
            <span>{formatRelative(row.lastSeen)}</span>
          </Tooltip>
        ),
      },
      {
        field: 'health',
        headerName: 'Status',
        minWidth: 110,
        renderCell: ({ row }) => <HealthChip health={row.health} />,
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Export agents run inside each cluster, pull jobs and report heartbeats.
        Agents are registered from the cluster detail panel on the Clusters
        page.
      </Typography>

      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={['tenant', 'cluster', 'status']}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Agent or cluster name',
        }}
        statusLabel="Health"
        statusOptions={optionsFrom(HEALTH_LABELS)}
      />

      <ServerDataGrid<Agent>
        ariaLabel="Agents"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage="No agents match. Register an agent from a cluster's detail panel."
        onRowClick={({ row }) => setSelectedId(row.id)}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
      />

      <AgentDetailDrawer
        agentId={selectedId}
        version={version}
        onClose={() => setSelectedId(null)}
        onEdit={setEditing}
        onRemove={setRemoving}
      />
      <AgentEditDialog
        agent={editing}
        api={api}
        onClose={() => setEditing(null)}
        onSaved={saved => {
          showToast('success', `Saved ${saved.agentName ?? 'agent'}`);
          setVersion(v => v + 1);
          grid.reload({ silent: true });
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove agent?"
        confirmLabel="Remove"
        destructive
        busy={busyKey !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing!;
          await run(
            target.id,
            async () => {
              await api.deleteAgent(target.id);
              setSelectedId(null);
              grid.reload();
            },
            `Removed ${target.agentName ?? 'agent'}`,
          );
          setRemoving(null);
        }}
      >
        {removing?.agentName ?? 'This agent'} on {removing?.clusterName} will no
        longer be able to pull jobs. Register it again to restore access.
      </ConfirmDialog>
      {toastElement}
    </Stack>
  );
}
