import { Chip } from '@mui/material';
import { makeStyles } from '@mui/styles';

const useStyles = makeStyles(theme => ({
  active: {
    backgroundColor: '#DCFCE7',
    color: '#166534',
    fontWeight: 600,
  },
  pending: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontWeight: 600,
  },
  error: {
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    fontWeight: 600,
  },
  inactive: {
    backgroundColor: '#E5E7EB',
    color: '#374151',
    fontWeight: 600,
  },
  provider: {
    backgroundColor: '#E0E7FF',
    color: '#1E3A8A',
    fontWeight: 600,
    marginRight: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  },
}));

function getStatusClassName(key: string, classes: Record<string, string>) {
  if (key === 'active') return classes.active;
  if (key === 'pending' || key === 'in_progress') return classes.pending;
  if (key === 'error' || key === 'failed') return classes.error;
  return classes.inactive;
}

export function StatusChip({ status }: { status: string }) {
  const classes = useStyles();
  const key = (status || 'inactive').toLowerCase();
  const className = getStatusClassName(key, classes);
  const label = (status || 'inactive').replace(/_/g, ' ');
  return <Chip size="small" label={label} className={className} />;
}

export function TagChip({ label }: { label: string }) {
  const classes = useStyles();
  return <Chip size="small" label={label} className={classes.provider} />;
}
