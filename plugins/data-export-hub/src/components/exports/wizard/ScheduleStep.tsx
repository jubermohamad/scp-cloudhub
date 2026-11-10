import {
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { SCHEDULES } from '../../../exportWizardModel';
import { SCHEDULE_DESCRIPTIONS, SCHEDULE_LABELS } from '../../../labels';
import type { Schedule } from '../../../types';
import type { StepProps } from './types';

export function ScheduleStep({ form, update }: Omit<StepProps, 'api'>) {
  return (
    <Stack spacing={2}>
      <RadioGroup
        value={form.schedule}
        onChange={e => update({ schedule: e.target.value as Schedule })}
        aria-label="Schedule"
      >
        {SCHEDULES.map(value => (
          <FormControlLabel
            key={value}
            value={value}
            control={<Radio />}
            label={
              <Stack>
                <Typography variant="body2">
                  {SCHEDULE_LABELS[value]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {SCHEDULE_DESCRIPTIONS[value]}
                </Typography>
              </Stack>
            }
            sx={{
              mb: 1,
              alignItems: 'flex-start',
              '& .MuiRadio-root': { pt: 0.5 },
            }}
          />
        ))}
      </RadioGroup>
      {form.schedule === 'CUSTOM_CRON' && (
        <TextField
          label="Cron expression"
          placeholder="0 2 * * *"
          helperText="Five fields in UTC: minute hour day-of-month month day-of-week"
          size="small"
          value={form.cronExpression}
          onChange={e => update({ cronExpression: e.target.value })}
          inputProps={{ style: { fontFamily: 'monospace' } }}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        The next run time is calculated by the scheduler and shown on the export
        once saved.
      </Typography>
    </Stack>
  );
}
