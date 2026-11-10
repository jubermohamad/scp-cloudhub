import {
  Alert,
  Button,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  EXPORT_MODES,
  nonIncrementalDatasets,
} from '../../../exportWizardModel';
import {
  EXPORT_MODE_DESCRIPTIONS,
  EXPORT_MODE_LABELS,
  optionsFrom,
  WATERMARK_STRATEGY_LABELS,
} from '../../../labels';
import type { ExportMode, WatermarkStrategy } from '../../../types';
import type { StepProps } from './types';

export function ModeStep({ form, update }: Omit<StepProps, 'api'>) {
  const unsupported =
    form.exportMode === 'INCREMENTAL'
      ? nonIncrementalDatasets(form.datasets)
      : [];
  return (
    <Stack spacing={2}>
      <RadioGroup
        value={form.exportMode}
        onChange={e => update({ exportMode: e.target.value as ExportMode })}
        aria-label="Export mode"
      >
        {EXPORT_MODES.map(mode => (
          <FormControlLabel
            key={mode}
            value={mode}
            control={<Radio />}
            label={
              <Stack>
                <Typography variant="body2">
                  {EXPORT_MODE_LABELS[mode]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {EXPORT_MODE_DESCRIPTIONS[mode]}
                </Typography>
              </Stack>
            }
            sx={{
              mb: 1.5,
              alignItems: 'flex-start',
              '& .MuiRadio-root': { pt: 0.5 },
            }}
          />
        ))}
      </RadioGroup>

      {form.exportMode === 'INCREMENTAL' && (
        <TextField
          select
          size="small"
          label="Watermark strategy"
          value={form.watermarkStrategy}
          onChange={e =>
            update({ watermarkStrategy: e.target.value as WatermarkStrategy })
          }
          helperText="How each run compares the watermark column with the value recorded by the previous run."
        >
          {optionsFrom(WATERMARK_STRATEGY_LABELS).map(option => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      )}

      {unsupported.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() =>
                update({
                  datasets: form.datasets.filter(
                    dataset => !unsupported.includes(dataset),
                  ),
                })
              }
            >
              Remove them
            </Button>
          }
        >
          {unsupported.map(dataset => dataset.datasetId).join(', ')}{' '}
          {unsupported.length === 1 ? 'does' : 'do'} not support incremental
          export.
        </Alert>
      )}
    </Stack>
  );
}
