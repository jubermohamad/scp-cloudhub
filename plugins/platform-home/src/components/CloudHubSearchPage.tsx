import { makeStyles } from '@mui/styles';
import { Typography } from '@mui/material';
import { SearchPage } from '@backstage/plugin-search';

const useStyles = makeStyles(() => ({
  root: {
    padding: '24px 32px 48px',
    maxWidth: 1400,
    margin: '0 auto',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#111827',
  },
  intro: {
    marginTop: 6,
    marginBottom: 20,
    color: '#6B7280',
    fontSize: '0.9375rem',
  },
  search: {
    '& > *': { marginTop: 0 },
    '& [class*="BackstageHeader"]': { display: 'none' },
  },
}));

export function CloudHubSearchPage() {
  const classes = useStyles();
  return (
    <main className={classes.root}>
      <Typography className={classes.title}>Search CloudHub</Typography>
      <Typography className={classes.intro}>
        Find platform services, Kubernetes environments, applications, and operational documentation.
      </Typography>
      <div className={classes.search}>
        <SearchPage />
      </div>
    </main>
  );
}
