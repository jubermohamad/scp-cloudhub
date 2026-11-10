import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { DatasetOption } from '../../../exportWizardModel';
import { useAsync, useDebouncedValue } from '../../../hooks';
import { DATASET_CATEGORY_LABELS, labelFor } from '../../../labels';
import type { Dataset } from '../../../types';
import type { StepProps } from './types';

type DatasetPick = DatasetOption & { category?: string };

function toOption(dataset: Dataset): DatasetPick {
  return {
    id: dataset.id,
    datasetId: dataset.datasetId,
    displayName: dataset.displayName,
    supportsIncremental: dataset.supportsIncremental,
    category: dataset.category,
  };
}

/** Server-searched multi-select of enabled catalog datasets. */
export function DatasetsStep({ form, update, api }: StepProps) {
  const [input, setInput] = useState('');
  const search = useDebouncedValue(input, 300);
  const incremental = form.exportMode === 'INCREMENTAL';
  const results = useAsync(
    () =>
      api.listDatasets({
        search: search.trim() || undefined,
        status: 'ENABLED',
        // Exports need datasets with SQL, and incremental exports need incremental datasets;
        // filtering on the server keeps the 50-result page full of usable choices.
        hasSqlTemplate: 'true',
        supportsIncremental: incremental ? 'true' : undefined,
        pageSize: 50,
        sortBy: 'datasetId',
        sortOrder: 'asc',
      }),
    [api, search, incremental],
  );
  const options = (results.data?.items ?? [])
    .filter(dataset => !incremental || dataset.supportsIncremental)
    .map(toOption);

  return (
    <Stack spacing={1.5}>
      <Autocomplete<DatasetPick, true>
        multiple
        loading={results.loading}
        options={options}
        value={form.datasets}
        filterOptions={items => items}
        filterSelectedOptions
        inputValue={input}
        onInputChange={(_event, value, reason) => {
          if (reason !== 'reset') setInput(value);
        }}
        onChange={(_event, value) => update({ datasets: value })}
        getOptionLabel={option => `${option.datasetId} — ${option.displayName}`}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        renderOption={(props, option) => (
          <li {...props} key={option.id}>
            <Stack>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {option.datasetId}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {option.displayName}
                {option.category
                  ? ` · ${labelFor(DATASET_CATEGORY_LABELS, option.category)}`
                  : ''}
                {option.supportsIncremental ? ' · incremental' : ''}
              </Typography>
            </Stack>
          </li>
        )}
        renderInput={params => (
          <TextField
            {...params}
            label="Search and select datasets"
            size="small"
            helperText="Search by dataset ID or name. Disabled datasets are not listed."
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option.id}
              size="small"
              label={option.datasetId}
              color={
                incremental && option.supportsIncremental === false
                  ? 'warning'
                  : 'default'
              }
            />
          ))
        }
      />
      {results.error && (
        <Alert severity="error">
          Unable to search datasets: {results.error}
        </Alert>
      )}
      {incremental && (
        <Typography variant="caption" color="text.secondary">
          The export mode is Incremental, so only datasets with a watermark
          column are offered.
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {form.datasets.length} selected. Each dataset becomes its own job on
        every run.
      </Typography>
    </Stack>
  );
}
