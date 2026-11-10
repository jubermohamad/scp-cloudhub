/**
 * DeploymentPage – six-tab Code-to-Production lifecycle hub.
 *
 * Tabs:
 *   Onboarding, AKS, common services, SRI, NetReveal, and customer overlay.
 *
 * The route /create/aks remains untouched and independent.
 */

import { makeStyles } from '@mui/styles';
import { Paper, Tab, Tabs, Typography } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PeopleIcon from '@mui/icons-material/People';
import AppsIcon from '@mui/icons-material/Apps';
import LayersIcon from '@mui/icons-material/Layers';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate, useLocation } from 'react-router-dom';
import { AksWorkflowPage } from './AksWorkflowPage';
import { Stage2DeployPage } from './Stage2DeployPage';
import { Stage3OverlayPage } from './Stage3OverlayPage';
import { DeploymentHistory } from './DeploymentHistory';
import { SriDeploymentHubPage } from './SriDeploymentHubPage';
import { CommonResDeployPage } from './CommonResDeployPage';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId =
  | 'aks'
  | 'common-res'
  | 'sri'
  | 'netreveal'
  | 'customer-overlay'
  | 'deployment-history';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
  color?: string;
}

const TABS: TabDef[] = [
  { id: 'aks', label: 'Create AKS', icon: StorageIcon, color: '#0891B2' },
  {
    id: 'common-res',
    label: 'Deploy common-res',
    icon: LayersIcon,
    color: '#0D9488',
  },
  { id: 'sri', label: 'Deploy SRI', icon: AppsIcon, color: '#7C3AED' },
  {
    id: 'netreveal',
    label: 'Deploy NetReveal',
    icon: CloudUploadIcon,
    color: '#0EA5E9',
  },
  {
    id: 'customer-overlay',
    label: 'Deploy Customer Overlay',
    icon: PeopleIcon,
    color: '#059669',
  },
  {
    id: 'deployment-history',
    label: 'Deployment History',
    icon: HistoryIcon,
    color: '#6B7280',
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  tabsBar: {
    borderBottom: '1px solid #E5E7EB',
    marginBottom: 0,
    background: '#FAFAFA',
    borderRadius: '8px 8px 0 0',
  },
  tab: {
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
    minWidth: 'auto',
    padding: theme.spacing(1.5, 2),
    transition: 'all 0.2s ease',
    '&.Mui-selected': {
      color: '#1d4ed8',
      fontWeight: 700,
    },
    '&:hover': {
      backgroundColor: 'rgba(29, 78, 216, 0.04)',
    },
  },
  stageBadge: {
    display: 'inline-block',
    fontSize: '0.6rem',
    fontWeight: 800,
    padding: '1px 6px',
    borderRadius: 999,
    background: '#DBEAFE',
    color: '#1e3a8a',
    marginRight: theme.spacing(0.75),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    verticalAlign: 'middle',
  },
  tabPanel: {
    borderRadius: '0 0 8px 8px',
    border: '1px solid #E5E7EB',
    borderTop: 'none',
    background: '#FFFFFF',
    overflow: 'visible',
  },
}));

// ─── Component ────────────────────────────────────────────────────────────────

export function DeploymentPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedStage = new URLSearchParams(location.search).get('stage');
  const legacyStages: Record<string, TabId> = {
    s1: 'aks',
    s2: 'aks',
    s3: 'sri',
    s4: 'netreveal',
    s5: 'customer-overlay',
  };
  const activeTab =
    legacyStages[requestedStage ?? ''] ??
    (TABS.some(tab => tab.id === requestedStage)
      ? (requestedStage as TabId)
      : 'aks');

  const handleTabChange = (_e: React.ChangeEvent<{}>, tab: TabId) => {
    navigate(`/deployment?stage=${tab}`, { replace: true });
  };

  return (
    <div className={classes.root}>
      {/* Hero */}
      <div className={classes.heroBanner}>
        <Typography className={classes.heroTitle}>
          Deployment Lifecycle
        </Typography>
        <Typography className={classes.heroSub}>
          End-to-end Code-to-Production workflow: AKS provisioning → application
          deployment → customer overlay activation.
        </Typography>
      </div>

      {/* Tab bar */}
      <Paper elevation={0}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          className={classes.tabsBar}
          indicatorColor="primary"
          textColor="primary"
        >
          {TABS.map(t => (
            <Tab
              key={t.id}
              value={t.id}
              className={classes.tab}
              label={t.label}
            />
          ))}
        </Tabs>

        <div className={classes.tabPanel}>
          {activeTab === 'aks' && <AksWorkflowPage isTab />}
          {activeTab === 'common-res' && <CommonResDeployPage isTab />}
          {activeTab === 'sri' && <SriDeploymentHubPage isTab />}
          {activeTab === 'netreveal' && <Stage2DeployPage isTab />}
          {activeTab === 'customer-overlay' && <Stage3OverlayPage isTab />}
          {activeTab === 'deployment-history' && <DeploymentHistory />}
        </div>
      </Paper>
    </div>
  );
}
