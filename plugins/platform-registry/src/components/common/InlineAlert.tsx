import { ReactNode } from 'react';
import { makeStyles } from '@mui/styles';

type Severity = 'success' | 'error' | 'info' | 'warning';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(1, 1.5),
    borderRadius: theme.shape.borderRadius,
    fontSize: '0.875rem',
    lineHeight: 1.4,
  },
  success: {
    backgroundColor: 'rgba(76, 175, 80, 0.12)',
    color: theme.palette.success.dark ?? '#1b5e20',
  },
  error: {
    backgroundColor: 'rgba(244, 67, 54, 0.12)',
    color: theme.palette.error.dark ?? '#b71c1c',
  },
  info: {
    backgroundColor: 'rgba(33, 150, 243, 0.12)',
    color: theme.palette.info?.dark ?? '#0d47a1',
  },
  warning: {
    backgroundColor: 'rgba(255, 152, 0, 0.12)',
    color: theme.palette.warning?.dark ?? '#e65100',
  },
}));

export function InlineAlert(props: {
  severity?: Severity;
  children: ReactNode;
}) {
  const { severity = 'info', children } = props;
  const classes = useStyles();
  return (
    <div className={`${classes.root} ${classes[severity]}`}>{children}</div>
  );
}
