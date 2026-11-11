/**
 * DeploymentLayout – shared chrome for every standalone deployment page.
 *
 * Each deployment stage is its own route and sidebar entry, so there is no
 * tab bar here any more. This only renders the lifecycle hero banner and the
 * bordered panel that holds the stage content.
 */

import { makeStyles } from '@mui/styles';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(1.5, 4, 3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(1, 2, 2) },
  },
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
      <div className={classes.panel}>{children}</div>
    </div>
  );
}
