import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import {
  GridActionsCellItem,
  GridColDef,
  GridRowParams,
} from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HistoryIcon from '@mui/icons-material/History';
import { destinationTypeLabel } from '../../destinationFields';
import {
  DEFAULT_SORT,
  filtersFromSearchParams,
  SORTABLE,
} from '../../gridQuery';
import {
  ENVIRONMENT_LABELS,
  EXPORT_MODE_LABELS,
  FORMAT_LABELS,
  labelFor,
  SCHEDULE_LABELS,
} from '../../labels';
import type { ExportProfile } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import {
  canCreateInAnyTenant,
  canManageTenant,
  formatDateTime,
} from '../../utils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';
import { EnabledChip, JobStatusChip } from '../common/StatusChip';
import { useActionRunner } from '../common/useActionRunner';
import { useToast } from '../common/useToast';
import {
  ExportDetailDrawer,
  executionsForExportPath,
} from './ExportDetailDrawer';
import { ExportWizard } from './ExportWizard';

export function ExportsPage() {
  return (
    <HubLayout label="Exports">
      <ExportsContent />
    </HubLayout>
  );
}

const FILTER_KEYS = [
  'tenantId',
  'clusterId',
  'environment',
  'status',
  'datasetId',
  'ownerId',
];

function ExportsContent() {
  const { api, me, tenantOptions, filterOptions } = useHub();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const grid = useServerGrid<ExportProfile>(query => api.listExports(query), {
    allowedSort: SORTABLE.exports,
    defaultSort: DEFAULT_SORT.exports,
    initialFilters: filtersFromSearchParams(searchParams, FILTER_KEYS),
  });
  const { reload } = grid;
  const { showToast, toastElement } = useToast();
  const { busyKey, run } = useActionRunner(showToast);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<ExportProfile | undefined>(undefined);
  const [viewing, setViewing] = useState<ExportProfile | null>(null);
  const [deleting, setDeleting] = useState<ExportProfile | null>(null);

  const columns = useMemo<GridColDef<ExportProfile>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Export Name',
        flex: 1.5,
        minWidth: 200,
        renderCell: ({ row }) => (
          <Typography
            variant="body2"
            fontWeight={600}
            noWrap
            title={row.name}
            sx={{ cursor: 'pointer' }}
            onClick={() => setViewing(row)}
          >
            {row.name}
          </Typography>
        ),
      },
      {
        field: 'customerName',
        headerName: 'Customer',
        minWidth: 140,
        renderCell: ({ row }) => row.customerName || row.tenantId,
      },
      {
        field: 'environment',
        headerName: 'Environment',
        minWidth: 120,
        valueFormatter: (value: string) => labelFor(ENVIRONMENT_LABELS, value),
      },
      {
        field: 'clusterName',
        headerName: 'Production Cluster',
        minWidth: 180,
        sortable: false,
      },
      {
        field: 'packageName',
        headerName: 'Export Package',
        minWidth: 240,
        flex: 1.2,
        sortable: false,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={row.packageName || row.packageCode || 'Standard Package'}
          />
        ),
      },
      {
        field: 'schedule',
        headerName: 'Schedule',
        minWidth: 110,
        sortable: false,
        renderCell: ({ row }) => (
          <Tooltip title={row.cronExpression}>
            <span>{SCHEDULE_LABELS[row.schedule] ?? row.schedule}</span>
          </Tooltip>
        ),
      },
      {
        field: 'exportMode',
        headerName: 'Mode',
        minWidth: 110,
        valueFormatter: (value: string) => labelFor(EXPORT_MODE_LABELS, value),
      },
      {
        field: 'fileFormat',
        headerName: 'Format',
        minWidth: 90,
        valueFormatter: (value: string) => labelFor(FORMAT_LABELS, value),
      },
      {
        field: 'destinationName',
        headerName: 'Destination',
        minWidth: 160,
        sortable: false,
        renderCell: ({ row }) => (
          <Stack minWidth={0} lineHeight={1.2}>
            <Typography variant="body2" noWrap>
              {row.destinationName ?? '—'}
            </Typography>
            {row.destinationType && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {destinationTypeLabel(row.destinationType)}
              </Typography>
            )}
          </Stack>
        ),
      },
      {
        field: 'enabled',
        headerName: 'Status',
        minWidth: 100,
        renderCell: ({ row }) => <EnabledChip enabled={row.enabled} />,
      },
      {
        field: 'lastRunAt',
        headerName: 'Last Run',
        minWidth: 190,
        renderCell: ({ row }) =>
          row.lastRunAt ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption">
                {formatDateTime(row.lastRunAt)}
              </Typography>
              {row.lastRunStatus && (
                <JobStatusChip status={row.lastRunStatus} />
              )}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Never run
            </Typography>
          ),
      },
      {
        field: 'nextRunAt',
        headerName: 'Next Run',
        minWidth: 160,
        sortable: false,
        valueFormatter: (value: string | null, row) =>
          row.enabled ? formatDateTime(value) : '—',
      },
      {
        field: 'actions',
        type: 'actions',
        headerName: 'Actions',
        width: 110,
        getActions: ({ row }: GridRowParams<ExportProfile>) => {
          const busy = busyKey === row.id;
          const view = (
            <GridActionsCellItem
              key="view"
              icon={<VisibilityOutlinedIcon fontSize="small" />}
              label={`View ${row.name}`}
              onClick={() => setViewing(row)}
            />
          );
          const history = (
            <GridActionsCellItem
              key="history"
              icon={<HistoryIcon fontSize="small" />}
              label="Executions"
              showInMenu
              onClick={() => navigate(executionsForExportPath(row))}
            />
          );
          if (!canManageTenant(me, row.tenantId)) return [view, history];
          return [
            view,
            <GridActionsCellItem
              key="run"
              icon={<PlayArrowIcon fontSize="small" />}
              label={`Run ${row.name} now`}
              disabled={!row.enabled || busy}
              onClick={() =>
                run(
                  row.id,
                  async () => {
                    const jobs = await api.runExportNow(row.id);
                    reload({ silent: true });
                    return jobs;
                  },
                  jobs => `Queued ${jobs.length} job(s) for ${row.name}`,
                )
              }
            />,
            history,
            <GridActionsCellItem
              key="edit"
              icon={<EditOutlinedIcon fontSize="small" />}
              label="Edit"
              showInMenu
              onClick={() => {
                setEditing(row);
                setWizardOpen(true);
              }}
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
              label={row.enabled ? 'Disable' : 'Enable'}
              showInMenu
              disabled={busy}
              onClick={() =>
                run(
                  row.id,
                  async () => {
                    await api.setExportEnabled(row.id, !row.enabled);
                    reload({ silent: true });
                  },
                  `${row.enabled ? 'Disabled' : 'Enabled'} ${row.name}`,
                )
              }
            />,
            <GridActionsCellItem
              key="delete"
              icon={<DeleteOutlineIcon fontSize="small" />}
              label="Delete"
              showInMenu
              disabled={busy}
              onClick={() => setDeleting(row)}
            />,
          ];
        },
      },
    ],
    [api, me, busyKey, run, reload, navigate],
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
          Export profiles run their datasets on a registered cluster and deliver
          files to one destination on a schedule.
        </Typography>
        {canCreateInAnyTenant(me) && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ flexShrink: 0 }}
            onClick={() => {
              setEditing(undefined);
              setWizardOpen(true);
            }}
          >
            New export
          </Button>
        )}
      </Stack>

      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={[
          'tenant',
          'cluster',
          'environment',
          'status',
          'dataset',
          'owner',
        ]}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Export name',
        }}
        statusOptions={[
          { value: 'ACTIVE', label: 'Active' },
          { value: 'DISABLED', label: 'Disabled' },
        ]}
      />

      <ServerDataGrid<ExportProfile>
        ariaLabel="Export profiles"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage="No exports match. Select New export to schedule your first extract."
        getRowClassName={({ row }) => (row.enabled ? '' : 'dx-row-muted')}
        onRowDoubleClick={({ row }) => setViewing(row)}
      />

      <ExportWizard
        open={wizardOpen}
        api={api}
        profile={editing}
        tenantOptions={tenantOptions}
        onClose={() => setWizardOpen(false)}
        onSaved={saved => {
          showToast('success', `Saved ${saved.name}`);
          reload();
        }}
      />
      <ExportDetailDrawer profile={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete export?"
        confirmLabel="Delete"
        destructive
        busy={busyKey === deleting?.id}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting!;
          await run(
            target.id,
            async () => {
              await api.deleteExport(target.id);
              reload();
            },
            `Deleted ${target.name}`,
          );
          setDeleting(null);
        }}
      >
        {deleting?.name} will be removed and no longer scheduled. This cannot be
        undone; disable the export instead if you may need it again.
      </ConfirmDialog>
      {toastElement}
    </Stack>
  );
}
