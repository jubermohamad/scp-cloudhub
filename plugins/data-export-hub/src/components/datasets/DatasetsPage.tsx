import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import {
  DEFAULT_SORT,
  filtersFromSearchParams,
  SORTABLE,
} from '../../gridQuery';
import {
  CLASSIFICATION_LABELS,
  DATASET_CATEGORY_LABELS,
  labelFor,
  optionsFrom,
  SOURCE_PRODUCT_LABELS,
} from '../../labels';
import { hubPaths } from '../../routes';
import type { Dataset } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';
import { EnabledChip, StatusChip } from '../common/StatusChip';
import { useToast } from '../common/useToast';
import { DatasetFormDialog } from './DatasetFormDialog';

const FILTER_KEYS = [
  'sourceProduct',
  'category',
  'classification',
  'status',
  'containsPii',
];

export function DatasetsPage() {
  return (
    <HubLayout label="Datasets">
      <DatasetsContent />
    </HubLayout>
  );
}

function DatasetsContent() {
  const { api, isPlatformAdmin, filterOptions, reloadFilterOptions } = useHub();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const grid = useServerGrid<Dataset>(query => api.listDatasets(query), {
    allowedSort: SORTABLE.datasets,
    defaultSort: DEFAULT_SORT.datasets,
    initialFilters: filtersFromSearchParams(searchParams, FILTER_KEYS),
  });
  const { showToast, toastElement } = useToast();
  const [registering, setRegistering] = useState(false);

  const columns = useMemo<GridColDef<Dataset>[]>(
    () => [
      {
        field: 'datasetId',
        headerName: 'Dataset ID',
        minWidth: 180,
        flex: 1,
        renderCell: ({ row }) => (
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace' }}
            noWrap
            title={row.datasetId}
          >
            {row.datasetId}
          </Typography>
        ),
      },
      {
        field: 'displayName',
        headerName: 'Display Name',
        minWidth: 200,
        flex: 1.4,
      },
      {
        field: 'sourceProduct',
        headerName: 'Source Product',
        minWidth: 150,
        valueFormatter: (value: string) =>
          labelFor(SOURCE_PRODUCT_LABELS, value),
      },
      {
        field: 'category',
        headerName: 'Category',
        minWidth: 130,
        valueFormatter: (value: string) =>
          labelFor(DATASET_CATEGORY_LABELS, value),
      },
      {
        field: 'classification',
        headerName: 'Classification',
        minWidth: 130,
        renderCell: ({ row }) => (
          <StatusChip
            label={labelFor(CLASSIFICATION_LABELS, row.classification)}
            tone={
              row.classification === 'RESTRICTED'
                ? 'error'
                : row.classification === 'CONFIDENTIAL'
                ? 'warning'
                : 'default'
            }
            variant="outlined"
          />
        ),
      },
      {
        field: 'containsPii',
        headerName: 'PII',
        minWidth: 80,
        sortable: false,
        renderCell: ({ row }) =>
          row.containsPii ? (
            <StatusChip label="PII" tone="warning" />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No
            </Typography>
          ),
      },
      {
        field: 'supportsIncremental',
        headerName: 'Incremental',
        minWidth: 110,
        sortable: false,
        renderCell: ({ row }) =>
          row.supportsIncremental ? (
            <CheckIcon
              fontSize="small"
              color="success"
              aria-label="Supports incremental"
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No
            </Typography>
          ),
      },
      {
        field: 'enabled',
        headerName: 'Status',
        minWidth: 100,
        sortable: false,
        renderCell: ({ row }) => (
          <EnabledChip enabled={row.enabled} on="Enabled" />
        ),
      },
    ],
    [],
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
          The data catalog lists every dataset that can be exported, with its
          business meaning, classification and lineage. Select a dataset to see
          its full description.
        </Typography>
        {isPlatformAdmin && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setRegistering(true)}
            sx={{ flexShrink: 0 }}
          >
            Register dataset
          </Button>
        )}
      </Stack>

      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={['status']}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Dataset ID or name',
        }}
        statusOptions={[
          { value: 'ENABLED', label: 'Enabled' },
          { value: 'DISABLED', label: 'Disabled' },
        ]}
        extra={[
          {
            key: 'sourceProduct',
            label: 'Source product',
            options: optionsFrom(SOURCE_PRODUCT_LABELS),
          },
          {
            key: 'category',
            label: 'Category',
            options: optionsFrom(DATASET_CATEGORY_LABELS),
          },
          {
            key: 'classification',
            label: 'Classification',
            options: optionsFrom(CLASSIFICATION_LABELS),
          },
          {
            key: 'containsPii',
            label: 'PII',
            options: [
              { value: 'true', label: 'Contains PII' },
              { value: 'false', label: 'No PII' },
            ],
          },
        ]}
      />

      <ServerDataGrid<Dataset>
        ariaLabel="Data catalog"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage="No datasets match these filters."
        onRowClick={({ row }) => navigate(hubPaths.datasetDetail(row.id))}
        getRowClassName={({ row }) => (row.enabled ? '' : 'dx-row-muted')}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
      />

      {isPlatformAdmin && (
        <DatasetFormDialog
          open={registering}
          api={api}
          catalog={filterOptions.datasets}
          onClose={() => setRegistering(false)}
          onSaved={created => {
            showToast('success', `Registered ${created.datasetId}`);
            grid.reload();
            reloadFilterOptions();
          }}
        />
      )}
      {toastElement}
    </Stack>
  );
}
