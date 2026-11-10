import { ReactNode } from 'react';
import {
  Autocomplete,
  Button,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterAltOffOutlinedIcon from '@mui/icons-material/FilterAltOffOutlined';
import { ENVIRONMENT_LABELS, optionsFrom } from '../../labels';
import type { GridFilters } from '../../gridQuery';
import type { FilterOptions } from '../../types';
import { isoToLocalInput, localInputToIso } from '../../utils';

export type StandardFilter =
  | 'tenant'
  | 'cluster'
  | 'environment'
  | 'status'
  | 'dataset'
  | 'owner'
  | 'dateRange';

export interface SelectOption {
  value: string;
  label: string;
}

/** Page-specific filter beyond the standard set, e.g. category on datasets. */
export interface ExtraFilter {
  key: string;
  label: string;
  /** Select from options, or free text. */
  options?: SelectOption[];
  placeholder?: string;
}

interface Props {
  filters: GridFilters;
  onFilterChange: (key: string, value: GridFilters[string]) => void;
  onClear: () => void;
  /** Which standard filters this page offers. */
  show: StandardFilter[];
  options: FilterOptions;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  statusOptions?: SelectOption[];
  statusLabel?: string;
  extra?: ExtraFilter[];
  /** Extra controls (switches etc.) appended to the bar. */
  children?: ReactNode;
}

const FIELD_SX = { minWidth: 160, flex: '1 1 160px', maxWidth: { sm: 240 } };

function asString(value: GridFilters[string]): string {
  return value === undefined || value === null ? '' : String(value);
}

/** Server-driven filter bar shared by every grid. Each page declares which filters it uses. */
export function EntityFilterBar({
  filters,
  onFilterChange,
  onClear,
  show,
  options,
  search,
  statusOptions = [],
  statusLabel = 'Status',
  extra = [],
  children,
}: Props) {
  const has = (filter: StandardFilter) => show.includes(filter);
  const tenantId = asString(filters.tenantId);
  const clusters = options.clusters.filter(
    cluster => !tenantId || cluster.tenantId === tenantId,
  );
  const active =
    Object.entries(filters).some(
      ([, value]) => value !== undefined && value !== '' && value !== false,
    ) || Boolean(search?.value);

  const select = (
    key: string,
    label: string,
    items: SelectOption[],
    allLabel = 'All',
  ) => (
    <TextField
      key={key}
      select
      size="small"
      label={label}
      value={asString(filters[key])}
      onChange={event => onFilterChange(key, event.target.value || undefined)}
      sx={FIELD_SX}
    >
      <MenuItem value="">
        <em>{allLabel}</em>
      </MenuItem>
      {items.map(item => (
        <MenuItem key={item.value} value={item.value}>
          {item.label}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        flexWrap="wrap"
        alignItems="center"
        role="search"
      >
        {search && (
          <TextField
            size="small"
            label="Search"
            placeholder={search.placeholder}
            value={search.value}
            onChange={event => search.onChange(event.target.value)}
            sx={{ minWidth: 220, flex: '2 1 220px', maxWidth: { sm: 360 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        )}
        {has('tenant') && (
          <TextField
            select
            size="small"
            label="Tenant"
            value={tenantId}
            onChange={event => {
              const value = event.target.value || undefined;
              onFilterChange('tenantId', value);
              // A cluster from another tenant would match nothing.
              const cluster = options.clusters.find(
                item => item.id === filters.clusterId,
              );
              if (value && cluster && cluster.tenantId !== value) {
                onFilterChange('clusterId', undefined);
              }
            }}
            sx={FIELD_SX}
          >
            <MenuItem value="">
              <em>All tenants</em>
            </MenuItem>
            {options.tenants.map(tenant => (
              <MenuItem key={tenant} value={tenant}>
                {tenant}
              </MenuItem>
            ))}
          </TextField>
        )}
        {has('cluster') && (
          <Autocomplete
            size="small"
            options={clusters}
            value={
              options.clusters.find(
                cluster => cluster.id === filters.clusterId,
              ) ?? null
            }
            onChange={(_event, value) => onFilterChange('clusterId', value?.id)}
            getOptionLabel={cluster => cluster.clusterName}
            renderOption={(props, cluster) => (
              <li {...props} key={cluster.id}>
                {cluster.clusterName}
                {!tenantId && ` · ${cluster.tenantId}`}
              </li>
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={params => <TextField {...params} label="Cluster" />}
            sx={{ ...FIELD_SX, maxWidth: { sm: 280 } }}
          />
        )}
        {has('environment') &&
          select('environment', 'Environment', optionsFrom(ENVIRONMENT_LABELS))}
        {has('status') && select('status', statusLabel, statusOptions)}
        {has('dataset') && (
          <Autocomplete
            size="small"
            options={options.datasets}
            value={
              options.datasets.find(
                dataset => dataset.id === filters.datasetId,
              ) ?? null
            }
            onChange={(_event, value) => onFilterChange('datasetId', value?.id)}
            getOptionLabel={dataset => dataset.datasetId}
            renderOption={(props, dataset) => (
              <li {...props} key={dataset.id}>
                {dataset.datasetId} — {dataset.displayName}
              </li>
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={params => <TextField {...params} label="Dataset" />}
            sx={{ ...FIELD_SX, maxWidth: { sm: 280 } }}
          />
        )}
        {has('owner') &&
          select(
            'ownerId',
            'Owner',
            options.owners.map(owner => ({ value: owner, label: owner })),
          )}
        {extra.map(filter =>
          filter.options ? (
            select(filter.key, filter.label, filter.options)
          ) : (
            <TextField
              key={filter.key}
              size="small"
              label={filter.label}
              placeholder={filter.placeholder}
              value={asString(filters[filter.key])}
              onChange={event =>
                onFilterChange(filter.key, event.target.value || undefined)
              }
              sx={FIELD_SX}
            />
          ),
        )}
        {has('dateRange') && (
          <>
            <TextField
              size="small"
              type="datetime-local"
              label="From"
              InputLabelProps={{ shrink: true }}
              value={isoToLocalInput(asString(filters.from) || undefined)}
              onChange={event =>
                onFilterChange('from', localInputToIso(event.target.value))
              }
              sx={{ ...FIELD_SX, minWidth: 200 }}
            />
            <TextField
              size="small"
              type="datetime-local"
              label="To"
              InputLabelProps={{ shrink: true }}
              value={isoToLocalInput(asString(filters.to) || undefined)}
              onChange={event =>
                onFilterChange('to', localInputToIso(event.target.value))
              }
              sx={{ ...FIELD_SX, minWidth: 200 }}
            />
          </>
        )}
        {children}
        <Button
          size="small"
          startIcon={<FilterAltOffOutlinedIcon />}
          onClick={onClear}
          disabled={!active}
          sx={{ ml: 'auto' }}
        >
          Clear filters
        </Button>
      </Stack>
    </Paper>
  );
}
