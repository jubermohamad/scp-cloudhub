import { Alert, Stack, TextField } from '@mui/material';
import {
  DESTINATION_FIELDS,
  DESTINATION_TYPE_HELP,
} from '../../destinationFields';
import type { DestinationType } from '../../types';

interface Props {
  type: DestinationType;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
}

/** Configuration fields for a destination type. Credentials are referenced, never entered. */
export function DestinationConfigFields({
  type,
  values,
  onChange,
  disabled,
}: Props) {
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        {DESTINATION_TYPE_HELP[type]}
      </Alert>
      {DESTINATION_FIELDS[type].map(field => {
        const value = values[field.key] ?? '';
        const invalid =
          Boolean(value.trim()) &&
          Boolean(field.pattern) &&
          !field.pattern!.test(value.trim());
        return (
          <TextField
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            required={field.required}
            size="small"
            disabled={disabled}
            value={value}
            error={invalid}
            helperText={invalid ? field.formatHint : field.helperText}
            inputProps={
              field.key === 'port' ? { inputMode: 'numeric' } : undefined
            }
            onChange={event =>
              onChange({ ...values, [field.key]: event.target.value })
            }
          />
        );
      })}
    </Stack>
  );
}
