import {
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useApiHolder, microsoftAuthApiRef } from '@backstage/core-plugin-api';
import StorageIcon from '@mui/icons-material/Storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import BarChartIcon from '@mui/icons-material/BarChart';
import MemoryIcon from '@mui/icons-material/Memory';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import BuildIcon from '@mui/icons-material/Build';
import TimelineIcon from '@mui/icons-material/Timeline';
import { getFirstName, usePersona } from '@internal/plugin-platform-common';
import { CloudProvidersSection } from './CloudProvidersSection';
import { PendingApprovalsWidget } from './PendingApprovalsWidget';

interface DashboardAction {
  title: string;
  description: string;
  Icon: React.ElementType;
  href: string;
  color: string;
}

interface SummaryCard {
  key: string;
  label: string;
  value: string;
}

const DASHBOARD_ACTIONS: DashboardAction[] = [
  {
    title: 'GPU Compute',
    description: 'Create AI/ML workloads',
    Icon: MemoryIcon,
    href: '/gpu-compute/create',
    color: '#0F766E',
  },
  {
    title: 'Infrastructure',
    description: 'Create foundational cloud resources',
    Icon: StorageIcon,
    href: '/infrastructure',
    color: '#EA580C',
  },
  {
    title: 'Create Test VM',
    description: 'Launch a low-cost test VM',
    Icon: StorageIcon,
    href: '/infrastructure/test-vm/create',
    color: '#EA580C',
  },
  {
    title: 'Deployment',
    description: 'Create clusters and infrastructure',
    Icon: CloudUploadIcon,
    href: '/deployment',
    color: '#2563EB',
  },
  {
    title: 'Platform Registry',
    description: 'Manage platform assets',
    Icon: FolderSharedIcon,
    href: '/platform-registry',
    color: '#C2410C',
  },
];

const PLATFORM_SERVICES: DashboardAction[] = [
  {
    title: 'Azure',
    description: 'Cloud infrastructure',
    Icon: CloudQueueIcon,
    href: '/cloud/azure',
    color: '#0078D4',
  },
  {
    title: 'GPU Compute',
    description: 'AI/ML workloads',
    Icon: MemoryIcon,
    href: '/gpu-compute',
    color: '#0F766E',
  },
  {
    title: 'Observability',
    description: 'Monitor live systems',
    Icon: TimelineIcon,
    href: '/workflows?category=observe',
    color: '#2563EB',
  },
  {
    title: 'Diagnostics',
    description: 'Inspect platform health',
    Icon: NetworkCheckIcon,
    href: '/operations/k8s-health-check',
    color: '#9333EA',
  },
  {
    title: 'Deployment',
    description: 'Run platform workflows',
    Icon: BuildIcon,
    href: '/deployment',
    color: '#0891B2',
  },
  {
    title: 'Cost Management',
    description: 'Track cloud spend',
    Icon: BarChartIcon,
    href: '/cost-optimization',
    color: '#EA580C',
  },
];

const RESOURCE_SUMMARY: SummaryCard[] = [
  { key: 'gpu', label: 'GPU Instances', value: '0' },
  { key: 'clusters', label: 'AKS Clusters', value: '0' },
  { key: 'applications', label: 'Applications', value: '0' },
  { key: 'namespaces', label: 'Namespaces', value: '0' },
];

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1600,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  dashboardHero: {
    padding: theme.spacing(2, 2.5),
    marginBottom: theme.spacing(2.5),
    borderRadius: 10,
    color: '#FFFFFF',
    background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)',
  },
  dashboardEyebrow: {
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    opacity: 0.8,
    marginBottom: theme.spacing(0.75),
  },
  dashboardTitle: {
    fontSize: '1.75rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  dashboardSubtitle: {
    maxWidth: 680,
    marginTop: theme.spacing(0.75),
    fontSize: '0.8125rem',
    opacity: 0.9,
    lineHeight: 1.5,
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: theme.spacing(2),
    color: '#111827',
  },
  resourceGrid: {
    marginBottom: theme.spacing(3),
  },
  resourceCard: {
    border: '1px solid #D1D5DB',
    borderRadius: 8,
  },
  resourceValue: {
    fontSize: '1.6rem',
    fontWeight: 700,
    color: '#111827',
  },
  resourceLabel: {
    fontSize: '0.8rem',
    color: '#6B7280',
  },
  activityCard: {
    border: '1px solid #D1D5DB',
    borderRadius: 8,
    marginBottom: theme.spacing(3),
  },
  healthCard: {
    border: '1px solid #D1D5DB',
    borderRadius: 8,
  },
  healthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: theme.spacing(2),
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  dashboardCard: {
    height: 210,
    backgroundColor: '#FFFFFF',
    border: '1px solid #D1D5DB',
    borderRadius: 18,
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
      transform: 'translateY(-2px)',
    },
  },
  dashboardCardArea: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  dashboardCardContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1.75, 2, 1.25),
  },
  dashboardCardIcon: {
    color: '#111827',
    fontSize: '1.8rem',
    marginBottom: theme.spacing(0.5),
  },
  dashboardCardTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1.25,
  },
  dashboardCardDescription: {
    fontSize: '0.8125rem',
    color: '#6B7280',
    lineHeight: 1.45,
  },
}));

export function PlatformHomePage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const { identity } = usePersona();
  const apiHolder = useApiHolder();
  const [profileFirstName, setProfileFirstName] = useState<string | null>(null);
  const userName = profileFirstName || getFirstName(identity);
  const environment = 'dev';

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
          if (!mounted || !profile) return;
          const displayName = profile.displayName?.trim();
          const email = profile.email?.trim();
          if (displayName && !['cloudhub-platform', 'cloudhub', 'user', 'unknown'].includes(displayName.toLowerCase())) {
            setProfileFirstName(displayName.split(/\s+/)[0]);
          } else if (email) {
            const localPart = email.split('@')[0].trim();
            if (!['cloudhub-platform', 'cloudhub', 'user', 'unknown'].includes(localPart.toLowerCase())) {
              setProfileFirstName(localPart.split(/[._\s-]+/)[0]);
            } else {
              setProfileFirstName(null);
            }
          } else {
            setProfileFirstName(null);
          }
        })
        .catch(() => undefined);
    };

    fetchProfile();

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiHolder]);

  return (
    <div className={classes.root}>
      <section className={classes.dashboardHero}>
        <Typography className={classes.dashboardEyebrow}>
          CloudHub Platform Portal
        </Typography>
        <Typography className={classes.dashboardTitle}>
          {userName}, Welcome to CloudHub
        </Typography>
        <Typography className={classes.dashboardSubtitle}>
          Self-service cloud platform for infrastructure, GPU compute,
          Kubernetes, and platform operations.
        </Typography>
      </section>

      <Grid container spacing={2} style={{ marginBottom: 24 }}>
        <Grid item xs={12} md={6}>
          <PendingApprovalsWidget />
        </Grid>
      </Grid>

      <CloudProvidersSection />

      <DashboardCardSection
        classes={classes}
        title="Quick Actions"
        cards={DASHBOARD_ACTIONS}
        navigate={navigate}
      />

      <Typography className={classes.sectionTitle}>My Resources</Typography>
      <Grid container spacing={2} className={classes.resourceGrid}>
        {RESOURCE_SUMMARY.map(card => (
          <Grid item xs={12} sm={6} md={3} key={card.key}>
            <Card className={classes.resourceCard} elevation={0}>
              <CardContent>
                <Typography className={classes.resourceValue}>
                  {card.value}
                </Typography>
                <Typography className={classes.resourceLabel}>
                  {card.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography className={classes.sectionTitle}>Recent Activity</Typography>
      <Card className={classes.activityCard} elevation={0}>
        <CardContent>
          <Typography color="textSecondary">No recent activity found.</Typography>
        </CardContent>
      </Card>

      <Typography className={classes.sectionTitle}>Platform Services</Typography>
      <DashboardCardSection
        classes={classes}
        cards={PLATFORM_SERVICES}
        navigate={navigate}
      />

      <Typography className={classes.sectionTitle}>Platform Health</Typography>
      <Card className={classes.healthCard} elevation={0}>
        <CardContent className={classes.healthGrid}>
          <HealthItem label="Frontend" value="Healthy" />
          <HealthItem label="Backend" value="Healthy" />
          <HealthItem label="Version" value="0.1.5" />
          <HealthItem label="Environment" value={environment} />
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardCardSection({
  classes,
  title,
  cards,
  navigate,
}: {
  classes: ReturnType<typeof useStyles>;
  title?: string;
  cards: DashboardAction[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <>
      {title && <Typography className={classes.sectionTitle}>{title}</Typography>}
      <Grid container spacing={2} style={{ marginBottom: 24 }}>
        {cards.map(card => (
          <Grid item xs={12} sm={6} md={3} key={card.title}>
            <Card className={classes.dashboardCard} elevation={0}>
              <CardActionArea
                onClick={() => navigate(card.href)}
                className={classes.dashboardCardArea}
              >
                <CardContent className={classes.dashboardCardContent}>
                  <card.Icon className={classes.dashboardCardIcon} />
                  <Typography className={classes.dashboardCardTitle}>
                    {card.title}
                  </Typography>
                  <Typography className={classes.dashboardCardDescription}>
                    {card.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}

function HealthItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography variant="caption" color="textSecondary">
        {label}
      </Typography>
      <Typography className="cloudhub-health-value">{value}</Typography>
    </div>
  );
}
