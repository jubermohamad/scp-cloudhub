import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mui/material';
import { makeStyles } from '@mui/styles';
import { createPortal } from 'react-dom';

type HeaderTab = { label: string; path: string; match: RegExp };

const useStyles = makeStyles(theme => ({
  navTabs: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  },
  navTab: {
    textTransform: 'none',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(14),
    fontWeight: 400,
    color: '#6B7280',
    borderRadius: 6,
    padding: theme.spacing(0.5, 0.75),
    minWidth: 'auto',
    lineHeight: 1.4,
    '&:hover': {
      backgroundColor: 'transparent',
      color: '#374151',
    },
  },
  navTabActive: {
    color: '#1D4ED8',
    fontWeight: 600,
    boxShadow: 'inset 0 -2px 0 #2563EB',
  },
}));

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);

  useEffect(() => {
    const update = () => {
      setPathname(window.location.pathname);
      setSearch(window.location.search);
    };
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      originalPushState.apply(this, args);
      update();
    };
    window.history.replaceState = function replaceState(...args) {
      originalReplaceState.apply(this, args);
      update();
    };

    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);

  return { pathname, search };
}

function getDeploymentTab(pathname: string, search: string): HeaderTab {
  const urlParams = new URLSearchParams(search);
  const stage = urlParams.get('stage');

  if (/^\/deployment\/stage\/1/.test(pathname)) {
    return {
      label: 'AKS Cluster',
      path: '/deployment/stage/1',
      match: /^\/deployment\/stage\/1/,
    };
  }
  if (pathname === '/deployment' && stage === 's3') {
    return {
      label: 'Deploy SRI',
      path: '/deployment?stage=s3',
      match: /^\/deployment$/, // Will match /deployment path with s3 stage in search
    };
  }
  if (pathname === '/deployment' && stage === 's4') {
    return {
      label: 'Deploy NetReveal',
      path: '/deployment?stage=s4',
      match: /^\/deployment$/, // Will match /deployment path with s4 stage in search
    };
  }
  if (/^\/deployment\/stage\/2/.test(pathname)) {
    return {
      label: 'Deploy Applications',
      path: '/deployment/stage/2',
      match: /^\/deployment\/stage\/2/,
    };
  }
  if (/^\/deployment\/stage\/3/.test(pathname)) {
    return {
      label: 'Customer Overlay',
      path: '/deployment/stage/3',
      match: /^\/deployment\/stage\/3/,
    };
  }
  return { label: 'Deployment', path: '/deployment', match: /^\/deployment/ };
}

const STATIC_TABS: HeaderTab[] = [
  { label: 'Cloud', path: '/cloud/azure', match: /^\/cloud/ },
  { label: 'Documentation', path: '/documentation', match: /^\/documentation/ },
];

export function AppShellTabs() {
  const classes = useStyles();
  const { pathname, search } = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);

  const staticTabs = useMemo(() => STATIC_TABS, []);

  const tabs = useMemo(
    () => [getDeploymentTab(pathname, search), ...staticTabs],
    [pathname, search, staticTabs],
  );

  useEffect(() => {
    let created: HTMLElement | null = null;
    let observer: MutationObserver | undefined;

    const attach = () => {
      const toolbar = document.querySelector(
        'header [class*="MuiToolbar-root"]',
      ) as HTMLElement | null;
      if (!toolbar) return false;

      let mount = toolbar.querySelector(
        '.scp-shell-tabs-host',
      ) as HTMLElement | null;
      if (!mount) {
        mount = document.createElement('div');
        mount.className = 'scp-shell-tabs-host';
        const firstIconButton = toolbar.querySelector('button');
        if (firstIconButton?.parentElement === toolbar) {
          toolbar.insertBefore(mount, firstIconButton);
        } else {
          toolbar.appendChild(mount);
        }
        created = mount;
      }

      setHost(mount);
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach() && observer) {
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      if (observer) observer.disconnect();
      if (created?.parentElement) created.parentElement.removeChild(created);
    };
  }, []);

  const goTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  if (!host) return null;

  return createPortal(
    <nav className={classes.navTabs} aria-label="App shell navigation tabs">
      {tabs.map(tab => {
        // For deployment tabs with stage param, check both pathname and search
        let active = tab.match.test(pathname);
        if (pathname === '/deployment') {
          const urlParams = new URLSearchParams(search);
          const stage = urlParams.get('stage');
          if (tab.path === '/deployment?stage=s3' && stage === 's3') {
            active = true;
          } else if (tab.path === '/deployment?stage=s4' && stage === 's4') {
            active = true;
          } else if (tab.path === '/deployment' && !stage) {
            active = true;
          }
        }
        return (
          <Button
            key={tab.path}
            className={`${classes.navTab} ${
              active ? classes.navTabActive : ''
            }`}
            onClick={() => goTo(tab.path)}
          >
            {tab.label}
          </Button>
        );
      })}
    </nav>,
    host,
  );
}
