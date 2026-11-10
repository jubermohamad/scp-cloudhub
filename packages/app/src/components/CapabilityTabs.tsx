import { Tab, Tabs } from '@mui/material';
import { makeStyles } from '@mui/styles';
import { useLocation, useNavigate } from 'react-router-dom';

export type CapabilityTab = { label: string; path: string };

const useStyles = makeStyles(theme => ({
  tabs: {
    borderBottom: `1px solid ${theme.palette.divider}`,
    marginBottom: theme.spacing(2),
    minHeight: 40,
  },
  tab: {
    minHeight: 40,
    minWidth: 'auto',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
  },
}));

/**
 * Capability-level navigation inside a sidebar domain. The sidebar lists major
 * domains; the capabilities within a domain are tabs rendered by this strip.
 */
export function CapabilityTabs({ tabs }: { tabs: CapabilityTab[] }) {
  const classes = useStyles();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Longest match wins so nested routes select the most specific tab.
  const activeIndex = tabs.reduce(
    (best, tab, index) =>
      pathname.startsWith(tab.path) &&
      (best === -1 || tab.path.length > tabs[best].path.length)
        ? index
        : best,
    -1,
  );

  if (tabs.length < 2) {
    return null;
  }

  return (
    <Tabs
      className={classes.tabs}
      value={activeIndex === -1 ? false : activeIndex}
      indicatorColor="primary"
      textColor="primary"
      variant="scrollable"
      scrollButtons="auto"
    >
      {tabs.map(tab => (
        <Tab
          key={tab.path}
          className={classes.tab}
          label={tab.label}
          onClick={() => navigate(tab.path)}
        />
      ))}
    </Tabs>
  );
}
