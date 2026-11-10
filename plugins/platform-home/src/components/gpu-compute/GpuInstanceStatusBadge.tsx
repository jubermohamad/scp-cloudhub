import { Chip } from '@mui/material';
import type { GpuInstanceStatus } from './types';

const STATUS_COLORS: Record<GpuInstanceStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#F3F4F6', fg: '#374151' },
  VALIDATING: { bg: '#E0E7FF', fg: '#3730A3' },
  TRIGGERING_WORKFLOW: { bg: '#E0E7FF', fg: '#3730A3' },
  PROVISIONING: { bg: '#FEF3C7', fg: '#92400E' },
  READY: { bg: '#DCFCE7', fg: '#166534' },
  STARTING: { bg: '#FEF3C7', fg: '#92400E' },
  STOPPING: { bg: '#FFEDD5', fg: '#9A3412' },
  STOPPED: { bg: '#E5E7EB', fg: '#374151' },
  START_FAILED: { bg: '#FEE2E2', fg: '#991B1B' },
  STOP_FAILED: { bg: '#FEE2E2', fg: '#991B1B' },
  FAILED: { bg: '#FEE2E2', fg: '#991B1B' },
  DELETING: { bg: '#FFEDD5', fg: '#9A3412' },
  DELETED: { bg: '#E5E7EB', fg: '#4B5563' },
  DELETE_FAILED: { bg: '#FEE2E2', fg: '#991B1B' },
};

export function GpuInstanceStatusBadge({
  status,
}: {
  status: GpuInstanceStatus;
}) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.PENDING;
  return (
    <Chip
      size="small"
      label={status}
      style={{
        backgroundColor: color.bg,
        color: color.fg,
        fontWeight: 700,
        fontSize: '0.7rem',
      }}
    />
  );
}
