import { Chip } from '@mui/material';
import type { DeveloperEnvironmentStatus } from './types';

const STATUS_COLORS: Record<
  DeveloperEnvironmentStatus,
  { bg: string; fg: string }
> = {
  DRAFT: { bg: '#F3F4F6', fg: '#374151' },
  REQUESTED: { bg: '#DBEAFE', fg: '#1E40AF' },
  STARTING: { bg: '#E0E7FF', fg: '#3730A3' },
  STOPPING: { bg: '#FDE68A', fg: '#92400E' },
  STOPPED: { bg: '#E5E7EB', fg: '#374151' },
  VALIDATING: { bg: '#E0E7FF', fg: '#3730A3' },
  PROVISIONING: { bg: '#FEF3C7', fg: '#92400E' },
  READY: { bg: '#DCFCE7', fg: '#166534' },
  FAILED: { bg: '#FEE2E2', fg: '#991B1B' },
  DELETING: { bg: '#FFEDD5', fg: '#9A3412' },
  DELETED: { bg: '#E5E7EB', fg: '#4B5563' },
};

export function WorkspaceStatusBadge({
  status,
}: {
  status: DeveloperEnvironmentStatus;
}) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;
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

export const DeveloperEnvironmentStatusBadge = WorkspaceStatusBadge;
