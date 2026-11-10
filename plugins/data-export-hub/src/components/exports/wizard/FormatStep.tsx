import {
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
} from '@mui/material';
import {
  compressionOptions,
  FORMATS,
  RetentionChoice,
  withFormat,
} from '../../../exportWizardModel';
import { COMPRESSION_LABELS, FORMAT_LABELS } from '../../../labels';
import type { Compression, ExportFormat } from '../../../types';
import type { WizardForm } from '../../../exportWizardModel';

const RETENTION: Array<{ value: RetentionChoice; label: string }> = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'CUSTOM', label: 'Custom' },
  { value: 'NONE', label: 'None (keep files)' },
];

export function FormatStep({
  form,
  setForm,
}: {
  form: WizardForm;
  setForm: (updater: (current: WizardForm) => WizardForm) => void;
}) {
  const update = (patch: Partial<WizardForm>) =>
    setForm(current => ({ ...current, ...patch }));
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} sm={6}>
        <FormControl>
          <FormLabel id="dx-format-label">File format</FormLabel>
          <RadioGroup
            aria-labelledby="dx-format-label"
            value={form.fileFormat}
            onChange={e =>
              setForm(current =>
                withFormat(current, e.target.value as ExportFormat),
              )
            }
          >
            {FORMATS.map(value => (
              <FormControlLabel
                key={value}
                value={value}
                control={<Radio />}
                label={
                  value === 'PARQUET'
                    ? 'Parquet (default, columnar)'
                    : FORMAT_LABELS[value]
                }
              />
            ))}
          </RadioGroup>
        </FormControl>
      </Grid>
      <Grid item xs={12} sm={6} container spacing={2} alignContent="flex-start">
        <Grid item xs={12}>
          <TextField
            select
            fullWidth
            size="small"
            label="Compression"
            value={form.compression}
            onChange={e =>
              update({ compression: e.target.value as Compression })
            }
            helperText={
              form.fileFormat === 'PARQUET'
                ? 'Snappy is the Parquet default.'
                : 'Snappy is only available for Parquet; GZIP is the default.'
            }
          >
            {compressionOptions(form.fileFormat).map(value => (
              <MenuItem key={value} value={value}>
                {COMPRESSION_LABELS[value]}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12}>
          <TextField
            select
            fullWidth
            size="small"
            label="File retention at destination"
            value={form.retention}
            onChange={e =>
              update({ retention: e.target.value as RetentionChoice })
            }
            helperText="Older export files are removed from the destination after this period."
          >
            {RETENTION.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        {form.retention === 'CUSTOM' && (
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Retention (days)"
              inputProps={{ inputMode: 'numeric' }}
              value={form.customRetentionDays}
              onChange={e => update({ customRetentionDays: e.target.value })}
            />
          </Grid>
        )}
      </Grid>
    </Grid>
  );
}
