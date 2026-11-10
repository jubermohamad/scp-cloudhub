import { Chip } from '@mui/material';
import {
  DESTINATION_STATUS_LABELS,
  HEALTH_LABELS,
  JOB_STATUS_LABELS,
  labelFor,
} from '../../labels';
import type { DestinationStatus, Health, JobStatus } from '../../types';
import {
  ChipTone,
  destinationStatusTone,
  healthTone,
  jobStatusTone,
} from '../../utils';

interface Props {
  label: string;
  tone: ChipTone;
  /** Outlined chips for secondary states, e.g. queued vs running. */
  variant?: 'filled' | 'outlined';
}

/** Status pill that uses theme palette colours so it reads correctly in dark mode. */
export function StatusChip({ label, tone, variant }: Props) {
  const color = tone === 'default' ? 'default' : tone;
  return (
    <Chip
      size="small"
      label={label}
      color={color}
      variant={variant ?? (tone === 'default' ? 'outlined' : 'filled')}
    />
  );
}

/** Pending states are outlined so they read as "not started" next to active ones. */
const OUTLINED_JOB_STATUSES: JobStatus[] = ['CREATED', 'ASSIGNED', 'UPLOADING'];

export function JobStatusChip({ status }: { status: JobStatus }) {
  return (
    <StatusChip
      label={labelFor(JOB_STATUS_LABELS, status)}
      tone={jobStatusTone(status)}
      variant={OUTLINED_JOB_STATUSES.includes(status) ? 'outlined' : undefined}
    />
  );
}

export function HealthChip({ health }: { health: Health }) {
  return (
    <StatusChip
      label={labelFor(HEALTH_LABELS, health)}
      tone={healthTone(health)}
    />
  );
}

export function DestinationStatusChip({
  status,
  enabled,
}: {
  status: DestinationStatus;
  enabled: boolean;
}) {
  if (!enabled) return <StatusChip label="Disabled" tone="default" />;
  return (
    <StatusChip
      label={labelFor(DESTINATION_STATUS_LABELS, status)}
      tone={destinationStatusTone(status)}
    />
  );
}

export function EnabledChip({
  enabled,
  on = 'Active',
  off = 'Disabled',
}: {
  enabled: boolean;
  on?: string;
  off?: string;
}) {
  return (
    <StatusChip
      label={enabled ? on : off}
      tone={enabled ? 'success' : 'default'}
    />
  );
}
