import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import {
  GridActionsCellItem,
  GridColDef,
  GridRowParams,
} from '@mui/x-data-grid';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ReplayIcon from '@mui/icons-material/Replay';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import {
  DEFAULT_SORT,
  filtersFromSearchParams,
  SORTABLE,
} from '../../gridQuery';
import {
  JOB_STATUS_LABELS,
  JOB_TRIGGER_LABELS,
  labelFor,
  optionsFrom,
} from '../../labels';
import type { Job } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import {
  canCancelJob,
  canRetryJob,
  formatBytes,
  formatCount,
  formatDateTime,
  formatSeconds,
  hasActiveJobs,
  shortId,
} from '../../utils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';
import { JobStatusChip } from '../common/StatusChip';
import { useActionRunner } from '../common/useActionRunner';
import { useToast } from '../common/useToast';
import { JobDetailDrawer } from './JobDetailDrawer';

const POLL_MS = 10_000;
const FILTER_KEYS = [
  'tenantId',
  'clusterId',
  'status',
  'datasetId',
  'from',
  'to',
  'search',
];

export function ExecutionsPage() {
  return (
    <HubLayout label="Executions">
      <ExecutionsContent />
    </HubLayout>
  );
}

function ExecutionsContent() {
  const { api, me, filterOptions } = useHub();
  const [searchParams, setSearchParams] = useSearchParams();
  const exportId = searchParams.get('exportId') ?? undefined;
  const exportName = searchParams.get('exportName') ?? undefined;
  const [initialFilters] = useState(() =>
    filtersFromSearchParams(searchParams, FILTER_KEYS),
  );
  const fixedQuery = useMemo(
    () => (exportId ? { exportId } : undefined),
    [exportId],
  );

  const grid = useServerGrid<Job>(query => api.listJobs(query), {
    allowedSort: SORTABLE.jobs,
    defaultSort: DEFAULT_SORT.jobs,
    initialFilters,
    fixedQuery,
    pollMs: POLL_MS,
    shouldPoll: hasActiveJobs,
  });
  const { reload } = grid;
  const { showToast, toastElement } = useToast();
  const { busyKey, run } = useActionRunner(showToast);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Job | null>(null);

  const columns = useMemo<GridColDef<Job>[]>(
    () => [
      {
        field: 'id',
        headerName: 'Run ID',
        minWidth: 100,
        sortable: false,
        renderCell: ({ row }) => (
          <Tooltip title={row.id}>
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', cursor: 'pointer' }}
              onClick={() => setViewingId(row.id)}
            >
              {shortId(row.id)}
            </Typography>
          </Tooltip>
        ),
      },
      { field: 'exportName', headerName: 'Export', minWidth: 170, flex: 1 },
      { field: 'tenantId', headerName: 'Tenant', minWidth: 110 },
      {
        field: 'clusterName',
        headerName: 'Cluster',
        minWidth: 140,
        sortable: false,
      },
      {
        field: 'datasetDisplayName',
        headerName: 'Dataset',
        minWidth: 170,
        flex: 1,
        sortable: false,
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 120,
        renderCell: ({ row }) => <JobStatusChip status={row.status} />,
      },
      {
        field: 'trigger',
        headerName: 'Trigger',
        minWidth: 100,
        sortable: false,
        valueFormatter: (value: string) => labelFor(JOB_TRIGGER_LABELS, value),
      },
      {
        field: 'createdAt',
        headerName: 'Created',
        minWidth: 170,
        valueFormatter: (value: string) => formatDateTime(value),
      },
      {
        field: 'scheduledTime',
        headerName: 'Scheduled',
        minWidth: 170,
        valueFormatter: (value: string) => formatDateTime(value),
      },
      {
        field: 'startedTime',
        headerName: 'Started',
        minWidth: 170,
        valueFormatter: (value: string | null) => formatDateTime(value),
      },
      {
        field: 'completedTime',
        headerName: 'Completed',
        minWidth: 170,
        valueFormatter: (value: string | null) => formatDateTime(value),
      },
      {
        field: 'durationSeconds',
        headerName: 'Duration',
        minWidth: 100,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null) => formatSeconds(value),
      },
      {
        field: 'rowsExported',
        headerName: 'Rows',
        minWidth: 100,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null) => formatCount(value),
      },
      {
        field: 'bytesExported',
        headerName: 'Bytes',
        minWidth: 100,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null) => formatBytes(value),
      },
      {
        field: 'retryCount',
        headerName: 'Retries',
        minWidth: 80,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        valueFormatter: (value: number, row) => `${value}/${row.maxRetries}`,
      },
      {
        field: 'actions',
        type: 'actions',
        headerName: 'Actions',
        width: 120,
        getActions: ({ row }: GridRowParams<Job>) => {
          const busy = busyKey === row.id;
          const actions = [
            <GridActionsCellItem
              key="view"
              icon={<VisibilityOutlinedIcon fontSize="small" />}
              label={`View run ${shortId(row.id)}`}
              onClick={() => setViewingId(row.id)}
            />,
          ];
          if (canRetryJob(me, row)) {
            actions.push(
              <GridActionsCellItem
                key="retry"
                icon={<ReplayIcon fontSize="small" />}
                label={`Retry run ${shortId(row.id)}`}
                disabled={busy}
                onClick={() =>
                  run(
                    row.id,
                    async () => {
                      await api.retryJob(row.id);
                      reload({ silent: true });
                    },
                    'Retry queued',
                  )
                }
              />,
            );
          }
          if (canCancelJob(me, row)) {
            actions.push(
              <GridActionsCellItem
                key="cancel"
                icon={<CancelOutlinedIcon fontSize="small" />}
                label={`Cancel run ${shortId(row.id)}`}
                disabled={busy}
                onClick={() => setCancelling(row)}
              />,
            );
          }
          return actions;
        },
      },
    ],
    [api, me, busyKey, run, reload],
  );

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        One job per dataset per run. The list refreshes every 10 seconds while
        any visible job is still in progress.
      </Typography>

      {exportId && (
        <Stack direction="row">
          <Chip
            label={`Export: ${exportName ?? shortId(exportId)}`}
            onDelete={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('exportId');
              next.delete('exportName');
              setSearchParams(next, { replace: true });
            }}
          />
        </Stack>
      )}

      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={['tenant', 'cluster', 'status', 'dataset', 'dateRange']}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Export name or dataset',
        }}
        statusOptions={optionsFrom(JOB_STATUS_LABELS)}
      />

      <ServerDataGrid<Job>
        ariaLabel="Executions"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage="No executions match these filters."
        onRowDoubleClick={({ row }) => setViewingId(row.id)}
        initialState={{
          columns: {
            columnVisibilityModel: {
              createdAt: false,
              trigger: false,
              completedTime: false,
              retryCount: false,
            },
          },
        }}
      />

      <JobDetailDrawer jobId={viewingId} onClose={() => setViewingId(null)} />
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this run?"
        confirmLabel="Cancel run"
        destructive
        busy={busyKey === cancelling?.id}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          const target = cancelling!;
          await run(
            target.id,
            async () => {
              await api.cancelJob(target.id);
              reload({ silent: true });
            },
            'Run cancelled',
          );
          setCancelling(null);
        }}
      >
        {cancelling &&
          `${cancelling.exportName} · ${
            cancelling.datasetDisplayName
          } is ${labelFor(
            JOB_STATUS_LABELS,
            cancelling.status,
          ).toLowerCase()}. The job is marked Cancelled and its agent is told to stop.`}
      </ConfirmDialog>
      {toastElement}
    </Stack>
  );
}
