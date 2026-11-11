import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { makeStyles } from '@mui/styles';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SearchIcon from '@mui/icons-material/Search';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import { useApiHolder, microsoftAuthApiRef } from '@backstage/core-plugin-api';
import {
  getFirstName,
  PERSONAS,
  usePersona,
} from '@internal/plugin-platform-common';
import { UserSettingsPage } from '@internal/plugin-platform-home';

const useStyles = makeStyles(theme => ({
  header: {
    position: 'fixed',
    top: 0,
    left: 'var(--cloudhub-global-sidebar-width, 256px)',
    right: 0,
    height: 'var(--cloudhub-global-header-height, 60px)',
    zIndex: 1300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'nowrap',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0, 2),
    background: 'transparent',
    borderBottom: 'none',
    boxShadow: 'none',
    pointerEvents: 'none' as const,
    overflow: 'hidden',
    maxWidth: '100%',
    [theme.breakpoints.down('sm')]: {
      left: 0,
      padding: theme.spacing(0, 1),
      height: 'auto',
      minHeight: 'var(--cloudhub-global-header-height, 60px)',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      overflow: 'hidden',
    },
  },

  // Left
  brand: {
    display: 'none',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    cursor: 'pointer',
    userSelect: 'none' as const,
    flexShrink: 0,
    borderRadius: 8,
    padding: theme.spacing(0.5, 1),
    margin: theme.spacing(0, -1),
    transition: 'background 0.15s',
    '&:hover': { background: '#F3F4F6' },
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#FFFFFF',
    fontSize: '0.75rem',
    fontWeight: 800,
    flexShrink: 0,
    letterSpacing: '0.01em',
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
    minWidth: 0,
    [theme.breakpoints.down('xs')]: { display: 'none' },
  },
  brandName: {
    color: '#111827',
    fontSize: '0.94rem',
    fontWeight: 700,
    lineHeight: 1.15,
    margin: 0,
  },
  brandSub: {
    color: '#4B5563',
    fontSize: '0.78rem',
    fontWeight: 500,
    lineHeight: 1.2,
    margin: 0,
    whiteSpace: 'nowrap' as const,
  },

  navTabs: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginRight: 0,
    pointerEvents: 'auto' as const,
    [theme.breakpoints.down('md')]: {
      display: 'none',
    },
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
    backgroundColor: 'transparent',
    fontWeight: 600,
    boxShadow: 'inset 0 -2px 0 #2563EB',
  },
  searchButton: {
    textTransform: 'none',
    minWidth: 0,
    padding: theme.spacing(0.5, 1),
    borderRadius: 6,
    color: '#4B5563',
    border: '1px solid #E5E7EB',
    background: '#FFFFFF',
    fontWeight: 600,
    fontSize: theme.typography.pxToRem(13),
    '&:hover': { background: '#F9FAFB', borderColor: '#D1D5DB' },
    [theme.breakpoints.down('sm')]: {
      padding: theme.spacing(0.5),
      '& span': { display: 'none' },
    },
  },

  // Center spacer
  spacer: { display: 'none' },

  // Right
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    flexShrink: 0,
    flexWrap: 'nowrap',
    pointerEvents: 'auto' as const,
    minWidth: 0,
    maxWidth: '100%',
    [theme.breakpoints.down('sm')]: {
      gap: theme.spacing(0.5),
      width: '100%',
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
  },
  userBtn: {
    textTransform: 'none',
    minWidth: 0,
    flex: '0 1 auto',
    padding: theme.spacing(0.5, 1),
    borderRadius: 8,
    color: '#374151',
    border: '1px solid #E5E7EB',
    background: '#FFFFFF',
    fontWeight: 600,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(14),
    lineHeight: 1.4,
    maxWidth: 'clamp(110px, 18vw, 220px)',
    justifyContent: 'flex-start',
    '& .MuiButton-startIcon': {
      marginRight: 6,
      flexShrink: 0,
    },
    '&:hover': {
      backgroundColor: '#F9FAFB',
      borderColor: '#D1D5DB',
    },
    [theme.breakpoints.down('sm')]: {
      maxWidth: 120,
      padding: theme.spacing(0.5, 0.75),
    },
  },
  versionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    border: '1px solid #D1D5DB',
    background: '#F8FAFC',
    color: '#1D4ED8',
    fontWeight: 700,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(12),
    lineHeight: 1.2,
    padding: theme.spacing(0.5, 1),
    whiteSpace: 'nowrap' as const,
    [theme.breakpoints.down('sm')]: {
      display: 'none',
    },
  },
  userBtnText: {
    display: 'inline-block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
    minWidth: 0,
    [theme.breakpoints.down('sm')]: {
      maxWidth: 88,
    },
  },
  profileMenuMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(13),
    lineHeight: 1.4,
    color: '#6B7280',
  },
  profileMenuAction: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(14),
    lineHeight: 1.4,
  },
  personaMenuHeader: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(12),
    lineHeight: 1.4,
    color: '#1E40AF',
    fontWeight: 600,
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  personaMenuItem: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.pxToRem(13),
    lineHeight: 1.4,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  personaColorDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  identityLabel: {
    display: 'block',
    fontFamily: theme.typography.fontFamily,
    color: '#9CA3AF',
    fontSize: theme.typography.pxToRem(11),
    lineHeight: 1.4,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  identityValue: {
    fontFamily: theme.typography.fontFamily,
    color: '#374151',
    fontSize: theme.typography.pxToRem(12),
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
}));

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard(?:\/|$)/, 'Data Export Dashboard'],
  [/^\/data-export-hub/, 'Data Export Hub'],
  [/^\/deployment$/, 'Deployment'],
  [/^\/deployment\?stage=s3/, 'Deploy SRI'],
  [/^\/deployment\?stage=s4/, 'Deploy NetReveal'],
  [/^\/deployment\/stage\/1/, 'AKS Cluster'],
  [/^\/deployment\/stage\/2/, 'Deploy Applications'],
  [/^\/deployment\/stage\/3/, 'Customer Overlay'],
  [/^\/create\/templates\//, 'Workflow Wizard'],
  [/^\/platform-registry/, 'Platform Registry'],
  [/^\/data-export-hub\/exports/, 'Data Export Hub · Exports'],
  [/^\/data-export-hub\/datasets/, 'Data Export Hub · Datasets'],
  [/^\/data-export-hub\/destinations/, 'Data Export Hub · Destinations'],
  [/^\/data-export-hub\/executions/, 'Data Export Hub · Executions'],
  [/^\/data-export-hub\/clusters/, 'Data Export Hub · Clusters'],
  [/^\/data-export-hub\/agents/, 'Data Export Hub · Agents'],
  [/^\/data-export-hub\/administration/, 'Data Export Hub · Administration'],
  [/^\/data-export-hub/, 'Data Export Hub'],
  [/^\/tenant-environment-registry/, 'Platform Registry'],
  [
    /^\/cost-optimization\/azure\/aks-cost-automation\/onboard/,
    'AKS Cost Automation Onboarding',
  ],
  [
    /^\/cost-optimization\/azure\/aks-cost-automation\/managed/,
    'AKS Lifecycle Manager',
  ],
  [/^\/cost-optimization\/azure/, 'Azure Cost Optimization'],
  [/^\/cost-optimization/, 'Cost Management'],
  [/^\/cloud\/azure/, 'Azure'],
  [/^\/cloud\//, 'Cloud Provider'],
  [/^\/gpu-compute/, 'GPU Compute'],
  [/^\/sri/, 'SymphonyAI Risk Intelligence'],
  [/^\/eng-tools/, 'Eng. Tools'],
  [/^\/sre\/clusters/, 'Environment Health'],
  [/^\/operations\/k8s-health-check/, 'Kubernetes Health'],
  [/^\/documentation/, 'Documentation'],
  [/^\/api-docs/, 'CloudHub API Explorer'],
  [/^\/search/, 'CloudHub Search'],
  [/^\/admin-settings/, 'Admin Settings'],
  [/^\/workflows/, 'Workflows'],
  [/^\/catalog/, 'Catalog'],
  [/^\/settings/, 'Settings'],
];

type HeaderTab = { label: string; path: string; match: RegExp };

const STATIC_HEADER_TABS: HeaderTab[] = [
  { label: 'Cloud', path: '/cloud/azure', match: /^\/cloud/ },
  { label: 'Documentation', path: '/documentation', match: /^\/documentation/ },
];

function getDeploymentHeaderTab(pathname: string): HeaderTab {
  if (/^\/deployment\/stage\/1/.test(pathname)) {
    return {
      label: 'AKS Cluster',
      path: '/deployment/stage/1',
      match: /^\/deployment\/stage\/1/,
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

function getPageTitle(pathname: string) {
  return (
    ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Workspace'
  );
}

// Removed unused `formatPersona` helper (unused -> TS6133).

function getProfileFirstName(
  profile: { displayName?: string; email?: string } | null | undefined,
) {
  const displayName = profile?.displayName?.trim();
  if (
    displayName &&
    !['cloudhub-platform', 'cloudhub', 'user', 'unknown'].includes(
      displayName.toLowerCase(),
    )
  ) {
    return displayName.split(/\s+/)[0];
  }
  const email = profile?.email?.trim();
  if (email) {
    const localPart = email.split('@')[0];
    if (
      !['cloudhub-platform', 'cloudhub', 'user', 'unknown'].includes(
        localPart.toLowerCase(),
      )
    ) {
      return localPart.split(/[._\s-]+/)[0] || null;
    }
  }
  return null;
}

function formatVersionLabel(version: string) {
  const trimmed = version.trim();
  if (!trimmed) return 'unknown';
  return trimmed;
}

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
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

  return pathname;
}

function styleGeneratedPageTitle() {
  const candidates = Array.from(
    document.querySelectorAll(
      'main h1, main h2, main h3, main a, main span, main p, main [class*="MuiTypography"], header h1, header h2, header h3, header a, header span, header p, header [class*="MuiTypography"]',
    ),
  ).filter(element => {
    const text = element.textContent?.trim().toLowerCase();
    return text === 'platform-home' || text === 'platform-registry';
  });

  candidates.forEach(candidate => {
    let node: HTMLElement | null = candidate as HTMLElement;
    while (node?.parentElement) {
      const parentElement: HTMLElement = node.parentElement;
      const rect = parentElement.getBoundingClientRect();
      const text = parentElement.textContent?.trim().toLowerCase();
      if (
        (text?.includes('platform-home') ||
          text?.includes('platform-registry')) &&
        rect.height >= 20 &&
        rect.height <= 140
      ) {
        parentElement.classList.add('cloudhub-backstage-generated-title-row');
        break;
      }
      node = parentElement;
    }
  });
}

export function GlobalHeader() {
  const classes = useStyles();
  const pathname = usePathname();
  // Non-throwing lookup: sign-out must never crash the whole app if this
  // provider isn't wired (for example when edge auth is the sole gate).
  const apiHolder = useApiHolder();
  const authApi = apiHolder.get(microsoftAuthApiRef);

  const { identity, persona } = usePersona();
  const userRole =
    PERSONAS.find(item => item.id === persona)?.label ?? 'Unassigned';
  const [profileFirstName, setProfileFirstName] = useState<string | null>(null);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deployedVersion, setDeployedVersion] = useState<string>('unknown');
  const [signingOut, setSigningOut] = useState(false);
  const [identityLoading, setIdentityLoading] = useState(true);
  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);
  const staticHeaderTabs = useMemo(() => STATIC_HEADER_TABS, []);
  const headerTabs = useMemo(
    () => [getDeploymentHeaderTab(pathname), ...staticHeaderTabs],
    [pathname, staticHeaderTabs],
  );
  // formattedPersona unused intentionally; compute inline where needed if required.
  const userDisplay = profileFirstName || getFirstName(identity);

  // Track identity loading state
  useEffect(() => {
    // Wait a bit for identity to resolve, then mark as not loading
    const timeout = setTimeout(() => {
      setIdentityLoading(false);
    }, 2000);

    // If identity is available, immediately mark as loaded
    if (identity?.userEntityRef) {
      setIdentityLoading(false);
      clearTimeout(timeout);
    }

    return () => clearTimeout(timeout);
  }, [identity]);

  useEffect(() => {
    let mounted = true;
    let retryCount = 0;
    const maxRetries = 15;
    const retryDelayMs = 500;
    let timeoutId: NodeJS.Timeout | undefined;

    const fetchProfile = () => {
      const currentAuthApi = apiHolder.get(microsoftAuthApiRef);

      if (!currentAuthApi) {
        // Retry if auth API not yet available
        if (retryCount < maxRetries) {
          retryCount += 1;
          timeoutId = setTimeout(fetchProfile, retryDelayMs);
        }
        return;
      }

      currentAuthApi
        .getProfile()
        .then(profile => {
          if (mounted) setProfileFirstName(getProfileFirstName(profile));
        })
        .catch(() => {
          if (mounted) setProfileFirstName(null);
        });
    };

    fetchProfile();

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiHolder]);

  useEffect(() => {
    styleGeneratedPageTitle();
    const observer = new MutationObserver(styleGeneratedPageTitle);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    let mounted = true;

    fetch('/__cloudhub_version', { cache: 'no-store' })
      .then(response => (response.ok ? response.text() : 'unknown'))
      .then(value => {
        if (mounted) {
          setDeployedVersion(formatVersionLabel(value));
        }
      })
      .catch(() => {
        if (mounted) {
          setDeployedVersion('unknown');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (/^\/login(?:\/|$)/.test(pathname)) {
    return null;
  }

  const goTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleSignOut = async () => {
    setProfileAnchor(null);
    setSigningOut(true);
    try {
      if (
        authApi &&
        'logout' in authApi &&
        typeof (authApi as any).logout === 'function'
      ) {
        await (authApi as any).logout();
      } else if (authApi) {
        await authApi.signOut();
      }
    } catch {
      // Even if provider logout fails, clear local state and route to login.
    } finally {
      sessionStorage.removeItem('cloudhub:post-login-redirect');
      window.location.assign('/login');
    }
  };

  return (
    <header className={classes.header} role="banner">
      {/* LEFT — logo mark + brand name + subtitle */}
      <div
        className={classes.brand}
        onClick={() => goTo('/')}
        role="link"
        tabIndex={0}
        aria-label="SymphonyAI Cloud Platform home"
        onKeyDown={e => e.key === 'Enter' && goTo('/')}
      >
        <div className={classes.logoMark}>SC</div>
        <div className={classes.brandText}>
          <span className={classes.brandName}>SymphonyAI Cloud Platform</span>
          <span className={classes.brandSub}>{pageTitle}</span>
        </div>
      </div>

      {/* CENTER — spacer */}
      <div className={classes.spacer} />

      {/* RIGHT — top tabs + icon actions */}
      <div className={classes.actions}>
        <Button
          className={classes.searchButton}
          startIcon={<SearchIcon style={{ fontSize: 17 }} />}
          onClick={() => goTo('/search')}
          aria-label="Search CloudHub"
        >
          <span>Search</span>
        </Button>
        <nav className={classes.navTabs} aria-label="Global navigation tabs">
          {headerTabs.map(tab => {
            const active = tab.match.test(pathname);
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
        </nav>

        <Button
          className={classes.userBtn}
          aria-label="User menu"
          onClick={e =>
            setProfileAnchor(prev => (prev ? null : e.currentTarget))
          }
          aria-controls="cloudhub-profile-menu"
          aria-haspopup="true"
          startIcon={<PersonOutlineIcon style={{ fontSize: 18 }} />}
        >
          <span className={classes.userBtnText}>{userDisplay}</span>
        </Button>

        <Menu
          id="cloudhub-profile-menu"
          anchorEl={profileAnchor}
          keepMounted
          open={Boolean(profileAnchor)}
          onClose={() => setProfileAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{
            style: {
              minWidth: 260,
              marginTop: 4,
              borderRadius: 8,
              border: '1px solid #E5E7EB',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            },
          }}
        >
          {/* Identity Information */}
          <div style={{ padding: '12px 16px' }}>
            <Typography className={classes.identityLabel}>Identity</Typography>
            <Typography className={classes.identityValue}>
              {!identityLoading
                ? identity?.userEntityRef ||
                  identity?.displayName ||
                  identity?.email ||
                  'No identity assigned'
                : 'Loading...'}
            </Typography>
            <Typography className={classes.identityLabel}>
              Role: {userRole}
            </Typography>
          </div>

          {/* Version Badge */}
          <MenuItem disabled className={classes.profileMenuMeta}>
            CloudHub: {deployedVersion}
          </MenuItem>

          <Divider />

          {/* Actions */}
          <MenuItem
            className={classes.profileMenuAction}
            onClick={() => {
              setProfileAnchor(null);
              setSettingsOpen(true);
            }}
          >
            <AccountCircleIcon
              fontSize="small"
              style={{ marginRight: 10, color: '#6B7280' }}
            />
            Profile and settings
          </MenuItem>
          <MenuItem
            className={classes.profileMenuAction}
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <ExitToAppIcon
              fontSize="small"
              style={{ marginRight: 10, color: '#6B7280' }}
            />
            {signingOut ? 'Signing out...' : 'Sign out'}
          </MenuItem>
        </Menu>
      </div>

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="md"
        fullWidth
        aria-labelledby="user-settings-dialog-title"
      >
        <DialogTitle id="user-settings-dialog-title" sx={{ m: 0, p: 2, pr: 6 }}>
          User Settings
          <IconButton
            aria-label="Close"
            onClick={() => setSettingsOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: theme => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <UserSettingsPage />
        </DialogContent>
      </Dialog>
    </header>
  );
}
