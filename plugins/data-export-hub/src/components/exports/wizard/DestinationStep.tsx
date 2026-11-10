import {
  Alert,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CREATABLE_DESTINATION_TYPES,
  destinationTypeLabel,
  initialDestinationConfig,
  usableDestinations,
} from '../../../destinationFields';
import { useAsync } from '../../../hooks';
import type { DestinationType } from '../../../types';
import { DestinationConfigFields } from '../../destinations/DestinationConfigFields';
import type { StepProps } from './types';

/** Pick an existing shared/tenant destination or describe a new one (created on submit). */
export function DestinationStep({ form, update, api }: StepProps) {
  const destinations = useAsync(
    () =>
      api.listDestinations({ pageSize: 100, sortBy: 'name', sortOrder: 'asc' }),
    [api],
  );
  const usable = usableDestinations(
    destinations.data?.items ?? [],
    form.tenantId,
  );
  const truncated =
    destinations.data &&
    destinations.data.total > destinations.data.items.length;
  const showSaved =
    form.destinationId && !usable.some(item => item.id === form.destinationId);

  return (
    <Stack spacing={2}>
      <RadioGroup
        row
        value={form.destinationMode}
        onChange={e =>
          update({ destinationMode: e.target.value as 'existing' | 'new' })
        }
      >
        <FormControlLabel
          value="existing"
          control={<Radio />}
          label="Use an existing destination"
        />
        <FormControlLabel
          value="new"
          control={<Radio />}
          label="Create a new destination"
        />
      </RadioGroup>

      {destinations.error && (
        <Alert severity="error">
          Unable to load destinations: {destinations.error}
        </Alert>
      )}

      {form.destinationMode === 'existing' ? (
        <TextField
          select
          label="Destination"
          size="small"
          value={form.destinationId}
          onChange={e => {
            const chosen = usable.find(item => item.id === e.target.value);
            update({
              destinationId: e.target.value,
              destinationLabel: chosen
                ? `${chosen.name} · ${destinationTypeLabel(chosen.type)}`
                : '',
            });
          }}
          helperText={
            destinations.loading
              ? 'Loading destinations…'
              : truncated
              ? 'Showing the first 100 destinations.'
              : 'Shared destinations and destinations owned by this tenant. Disabled ones are hidden.'
          }
        >
          {usable.length === 0 && !showSaved && (
            <MenuItem disabled value="">
              No enabled destinations for {form.tenantId}
            </MenuItem>
          )}
          {showSaved && (
            <MenuItem value={form.destinationId}>
              {form.destinationLabel || form.destinationId}
            </MenuItem>
          )}
          {usable.map(destination => (
            <MenuItem key={destination.id} value={destination.id}>
              {destination.name} · {destinationTypeLabel(destination.type)}
              {destination.tenantId === null ? ' · shared' : ''}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Stack spacing={2}>
          <TextField
            label="Destination name"
            required
            size="small"
            value={form.newDestinationName}
            onChange={e => update({ newDestinationName: e.target.value })}
          />
          <TextField
            select
            label="Destination type"
            size="small"
            value={form.newDestinationType}
            onChange={e => {
              const type = e.target.value as DestinationType;
              update({
                newDestinationType: type,
                newDestinationConfig: initialDestinationConfig(type),
              });
            }}
          >
            {CREATABLE_DESTINATION_TYPES.map(value => (
              <MenuItem key={value} value={value}>
                {destinationTypeLabel(value)}
              </MenuItem>
            ))}
          </TextField>
          <DestinationConfigFields
            type={form.newDestinationType}
            values={form.newDestinationConfig}
            onChange={values => update({ newDestinationConfig: values })}
          />
          <Typography variant="caption" color="text.secondary">
            The new destination belongs to tenant {form.tenantId} and is created
            when you create the export.
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}
