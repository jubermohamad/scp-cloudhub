/**
 * DeploymentLayout – shared chrome for every standalone deployment page.
 *
 * Each deployment stage is its own route and sidebar entry, so there is no
 * tab bar here any more. This only renders the lifecycle hero banner and the
 * bordered panel that holds the stage content.
 */

import { makeStyles } from '@mui/styles';
import { Typography } from '@mui/material';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(1.5, 4, 3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(1, 2, 2) },
  },
  heroBanner: {
    borderRadius: 12,
    padding: theme.spacing(2.5),
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(2),
    background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)',
  },
  heroTitle: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2 },
  heroSub: { fontSize: '0.875rem', opacity: 0.85 },
  panel: {
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    background: '#FFFFFF',
    overflow: 'visible',
  },
}));

export function DeploymentLayout({ children }: { children: React.ReactNode }) {
  const classes = useStyles();
  return (
    <div className={classes.root}>
      <div className={classes.heroBanner}>
        <Typography className={classes.heroTitle}>
          Deployment Lifecycle
        </Typography>
        <Typography className={classes.heroSub}>
          End-to-end Code-to-Production workflow: AKS provisioning → application
          deployment → customer overlay activation.
        </Typography>
      </div>
      <div className={classes.panel}>{children}</div>
    </div>
  );
}
