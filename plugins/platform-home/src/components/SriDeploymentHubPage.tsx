/**
 * SriDeploymentHubPage
 *
 * Shared SRI deployment experience used by both `/sri` and
 * `/deployment?stage=sri`.
 *
 * Every SRI card launches the same DeploymentWizard workflow, including:
 * - server-side Helmfile rendering
 * - preview + validation
 * - approval submission / polling
 * - deploy + live status tracking
 */

import { useEffect, useMemo, useState } from 'react';
import { Typography, Grid, Card, CardContent, CardActionArea, Link as MuiLink, Paper, Box, CircularProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { Link as RouterLink, useNavigate } from 'react-router-dom';
import LayersIcon from '@mui/icons-material/Layers';
import PeopleIcon from '@mui/icons-material/People';
import StorageIcon from '@mui/icons-material/Storage';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import ExtensionIcon from '@mui/icons-material/Extension';
import SecurityIcon from '@mui/icons-material/Security';
import GavelIcon from '@mui/icons-material/Gavel';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DataUsageIcon from '@mui/icons-material/DataUsage';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import BuildIcon from '@mui/icons-material/Build';
import {
  SRI_COMPONENTS,
  type SriComponentDefinition,
  useBackendFetch,
} from '@internal/plugin-platform-common';
import { DeploymentHistory } from './DeploymentHistory';
import type { PortalApplicationOption, PortalDeploymentOptions } from './deploymentPortalTypes';

interface SriDeploymentHubPageProps {
  isTab?: boolean;
  variant?: 'sri' | 'common-resources' | 'netreveal';
}

interface SriCardMeta {
  icon: React.ElementType;
  accent: string;
}

const SRI_CARD_META: Record<string, SriCardMeta> = {
  'common-res': { icon: LayersIcon, accent: '#0F766E' },
  'ai-store': { icon: StorageIcon, accent: '#667EEA' },
  'netreveal-v96': { icon: CloudQueueIcon, accent: '#1565C0' },
  'sri-investigation': { icon: FindInPageIcon, accent: '#6A1B9A' },
  flows: { icon: AccountTreeIcon, accent: '#00838F' },
  'sensaai-sanctions': { icon: GavelIcon, accent: '#C62828' },
  'sri-detection': { icon: SecurityIcon, accent: '#EF6C00' },
  'hybrid-manager': { icon: FolderSharedIcon, accent: '#2E7D32' },
  'sri-data': { icon: DataUsageIcon, accent: '#455A64' },
  'sri-agents': { icon: ExtensionIcon, accent: '#AD1457' },
  netreveal: { icon: PeopleIcon, accent: '#3949AB' },
};

const SHORT_CARD_LABELS: Record<string, string> = {
  'common-res': 'Foundational platform infrastructure and shared services supporting all deployments.',
  'ai-store': 'Central repository for storing, versioning, and deploying AI/ML models.',
  'netreveal-v96': 'Containerized, cloud-native release of the core financial crime suite.',
  'sri-investigation': 'AI-native investigative workspace for triaging and resolving risk alerts.',
  flows: 'Workflow orchestration engine managing end-to-end data pipelines and tasks.',
  'sensaai-sanctions': 'Machine-learning triage layer that eliminates false positives in sanctions screening.',
  'sri-detection': 'Real-time analytics engine running hybrid rule- and ML-based detection models.',
  'hybrid-manager': 'Unified control plane for managing distributed PostgreSQL database clusters.',
  'sri-data': 'Ingestion, validation, and entity-resolution backbone for enterprise data.',
  'sri-agents': 'Autonomous AI co-pilots that automate evidence gathering and narrative writing.',
  netreveal: 'Enterprise platform for AML, anti-fraud, and watchlist compliance management.',
};

const VARIANT_APP_ORDER: Record<
  NonNullable<SriDeploymentHubPageProps['variant']>,
  string[]
> = {
  sri: [
    'invhub',
    'detectionhub',
    'flows',
    'ai-store',
    'sensaai-sanctions',
  ],
  'common-resources': [
    'hybrid-manager',
    'velero',
    'tailscale',
    'datadog',
    'dxv',
  ],
  netreveal: ['netrevealv96', 'netreveal', 'netrevealv95'],
};

const VARIANT_COPY: Record<
  NonNullable<SriDeploymentHubPageProps['variant']>,
  {
    breadcrumb: string;
    heroTitle: string;
    heroSubtitle: string;
    sectionTitle: string;
    sectionSub: string;
  }
> = {
  sri: {
    breadcrumb: 'SRI',
    heroTitle: 'Deploy SRI',
    heroSubtitle:
      'Deploy the SRI product applications through the approval-capable shared deployment workflow.',
    sectionTitle: 'SRI Catalog',
    sectionSub:
      'Each card below maps to a supported SRI application in the dynamic-runners deploy pipeline.',
  },
  'common-resources': {
    breadcrumb: 'Common Resources',
    heroTitle: 'Common Resources',
    heroSubtitle:
      'Deploy shared platform resources and operators that support workloads across clusters.',
    sectionTitle: 'Shared Platform Catalog',
    sectionSub:
      'Cards below are common platform resources supported by the dynamic-runners deploy pipeline.',
  },
  netreveal: {
    breadcrumb: 'Deploy NetReveal',
    heroTitle: 'Deploy NetReveal',
    heroSubtitle:
      'Deploy NetReveal platform versions through the same audited approval and execution workflow.',
    sectionTitle: 'NetReveal Catalog',
    sectionSub:
      'Select the NetReveal application version to deploy using the dynamic-runners pipeline.',
  },
};

const VARIANT_BADGE_LABEL: Record<
  NonNullable<SriDeploymentHubPageProps['variant']>,
  string
> = {
  sri: 'SRI Application',
  'common-resources': 'Common Resource',
  netreveal: 'NetReveal Application',
};

function getCardMeta(componentId: string): SriCardMeta {
  return SRI_CARD_META[componentId] ?? {
    icon: BuildIcon,
    accent: '#1D4ED8',
  };
}

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(1.5, 4, 3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: {
      padding: theme.spacing(1, 2, 2),
    },
  },
  hero: {
    borderRadius: 12,
    padding: theme.spacing(2.5),
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(2),
    background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)',
  },
  heroMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(0.25),
    color: '#fff',
    opacity: 0.9,
    fontSize: '0.75rem',
  },
  heroMetaLink: {
    color: '#fff',
    textDecoration: 'none',
    fontWeight: 500,
    '&:hover': { textDecoration: 'underline' },
  },
  heroMetaCurrent: {
    color: '#fff',
    fontWeight: 600,
  },
  heroEyebrow: {
    color: '#fff',
    fontSize: '0.72rem',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: 700,
    opacity: 0.9,
    margin: 0,
  },
  heroTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    lineHeight: 1.2,
    margin: 0,
  },
  heroSubtitle: {
    color: '#fff',
    fontSize: '0.875rem',
    opacity: 0.85,
    margin: 0,
    maxWidth: 760,
  },
  sectionTitle: {
    fontSize: '1rem',
    margin: theme.spacing(0, 0, 0.5),
    color: theme.palette.text.primary,
    fontWeight: 700,
  },
  sectionSub: {
    fontSize: '0.875rem',
    color: theme.palette.text.secondary,
    margin: theme.spacing(0, 0, 2),
    lineHeight: 1.5,
  },
  card: {
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
  cardDisabled: {
    opacity: 0.55,
  },
  cardArea: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  cardBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1.75, 2, 1.25),
  },
  cardIcon: {
    color: '#111827',
    fontSize: '1.8rem',
    marginBottom: theme.spacing(0.5),
  },
  cardMeta: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    gap: 0,
    flex: 1,
  },
  cardTitle: {
    fontSize: '1.15rem',
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1.25,
    margin: 0,
  },
  cardLabel: {
    fontSize: '0.78rem',
    color: '#6B7280',
    lineHeight: 1.45,
    marginTop: theme.spacing(0.5),
  },
  sectionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 20,
    boxSizing: 'border-box',
    padding: theme.spacing(0.25, 0.75),
    borderRadius: 999,
    backgroundColor: '#F3E8FF',
    color: '#6B21A8',
    fontSize: '0.68rem',
    fontWeight: 700,
    lineHeight: 1,
    marginTop: theme.spacing(0.75),
  },
  cardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(1),
    flexWrap: 'wrap',
  },
  cardActionLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 20,
    boxSizing: 'border-box',
    padding: theme.spacing(0.25, 0.75),
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
    fontSize: '0.68rem',
    fontWeight: 700,
    lineHeight: 1,
  },
  cardFooter: {
    display: 'none',
  },
  deployLabel: {
    display: 'none',
  },
  disabledLabel: {
    display: 'none',
  },
  workflowBox: {
    backgroundColor: '#EFF6FF',
    border: '1px solid #BFDBFE',
    borderRadius: 10,
    padding: theme.spacing(2),
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(3),
  },
  workflowStep: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(1.25),
    '&:last-child': {
      marginBottom: 0,
    },
  },
  workflowStepNum: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    backgroundColor: '#2563EB',
    color: '#FFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 2,
  },
  workflowStepNumActive: {
    backgroundColor: '#10B981',
  },
}));

export function SriDeploymentHubPage({
  isTab: _isTab = false,
  variant = 'sri',
}: SriDeploymentHubPageProps) {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const [pipelineApps, setPipelineApps] = useState<PortalApplicationOption[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const copy = VARIANT_COPY[variant];
  const sectionBadgeLabel = VARIANT_BADGE_LABEL[variant];
  const appOrder = VARIANT_APP_ORDER[variant];
  const appOrderIndex = useMemo(
    () => new Map(appOrder.map((name, index) => [name, index])),
    [appOrder],
  );

  const componentByApp = useMemo(() => {
    const map = new Map<string, SriComponentDefinition>();
    for (const component of SRI_COMPONENTS) {
      const app = component.deployment.application?.trim();
      if (!app || map.has(app)) continue;
      map.set(app, component);
    }
    return map;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadApps = async () => {
      setLoadingApps(true);
      setAppsError(null);
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          '/deployments/options',
        );
        const body = (await response.json()) as PortalDeploymentOptions & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to load pipeline applications');
        }
        if (!cancelled) {
          const apps = Array.isArray(body.applications) ? body.applications : [];
          setPipelineApps(
            [...apps].sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            ),
          );
        }
      } catch (error) {
        if (!cancelled) {
          setAppsError(
            error instanceof Error
              ? error.message
              : 'Failed to load pipeline applications',
          );
          setPipelineApps([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingApps(false);
        }
      }
    };

    void loadApps();
    return () => {
      cancelled = true;
    };
  }, [backendFetch]);

  const handleSelect = (application: string) => {
    navigate(`/sri/deploy/${encodeURIComponent(application)}`);
  };

  const filteredApps = useMemo(() => {
    const allowed = new Set(appOrder);
    return pipelineApps
      .filter(app => allowed.has(app.appName))
      .sort((left, right) => {
        const leftIndex = appOrderIndex.get(left.appName) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = appOrderIndex.get(right.appName) ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }
        return left.displayName.localeCompare(right.displayName);
      });
  }, [pipelineApps, appOrder, appOrderIndex]);

  const cardTitle = (app: PortalApplicationOption): string => {
    if (variant === 'sri' && app.appName === 'flows') {
      return 'Deploy SRI Data';
    }
    const linkedComponent = componentByApp.get(app.appName);
    return linkedComponent?.title ?? app.displayName;
  };

  return (
    <div className={classes.root}>
      <div className={classes.hero}>
        <Box className={classes.heroMeta}>
          <MuiLink component={RouterLink} to="/" className={classes.heroMetaLink}>
            Platform Home
          </MuiLink>
          <Typography component="span" className={classes.heroMetaCurrent}>/</Typography>
          <Typography component="span" className={classes.heroMetaCurrent}>{copy.breadcrumb}</Typography>
        </Box>
        <Typography variant="overline" className={classes.heroEyebrow}>
          Sensa Risk Intelligence
        </Typography>
        <Typography variant="h4" className={classes.heroTitle}>
          {copy.heroTitle}
        </Typography>
        <Typography variant="body2" className={classes.heroSubtitle}>
          {copy.heroSubtitle}
        </Typography>
      </div>

      <Typography variant="h6" className={classes.sectionTitle}>{copy.sectionTitle}</Typography>
      <Typography variant="body2" className={classes.sectionSub}>
        {copy.sectionSub}
      </Typography>

      {loadingApps && (
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="textSecondary">
            Loading applications from pipeline catalog...
          </Typography>
        </Box>
      )}

      {appsError && (
        <Paper elevation={0} className={classes.workflowBox}>
          <Typography variant="subtitle2" color="error" style={{ fontWeight: 700 }}>
            Unable to load deployment applications
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {appsError}
          </Typography>
        </Paper>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3} lg={3} key="sri-provisioner">
          <Card className={classes.card}>
            <CardActionArea
              className={classes.cardArea}
              onClick={() =>
                window.open(
                  'https://sri-provisioner.invhub.fseng.net/',
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              <CardContent className={classes.cardBody}>
                <BuildIcon className={classes.cardIcon} style={{ color: '#111827' }} />
                <Box className={classes.cardMeta}>
                  <Typography className={classes.cardTitle}>SRI Provisioner</Typography>
                  <Typography className={classes.cardLabel}>
                    Provision SRI environments and services
                  </Typography>
                  <Typography component="span" className={classes.sectionBadge}>
                    {sectionBadgeLabel}
                  </Typography>
                  <Box className={classes.cardActions} aria-label="Available actions">
                    <Typography component="span" className={classes.cardActionLabel}>
                      Open
                    </Typography>
                    <Typography component="span" className={classes.cardActionLabel}>
                      Provision
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>

        {filteredApps.map(application => {
          const linkedComponent = componentByApp.get(application.appName);
          const meta = getCardMeta(linkedComponent?.id ?? application.appName);
          const Icon = meta.icon;
          const shortLabel =
            (linkedComponent && SHORT_CARD_LABELS[linkedComponent.id]) ||
            linkedComponent?.subtitle ||
            application.description ||
            `Deploy ${application.displayName} via dynamic runners pipeline.`;
          return (
            <Grid item xs={12} sm={6} md={3} lg={3} key={application.appName}>
              <Card className={classes.card}>
                <CardActionArea
                  className={classes.cardArea}
                  onClick={() => handleSelect(application.appName)}
                >
                  <CardContent className={classes.cardBody}>
                    <Icon className={classes.cardIcon} style={{ color: '#111827' }} />
                    <Box className={classes.cardMeta}>
                      <Typography className={classes.cardTitle}>{cardTitle(application)}</Typography>
                      <Typography className={classes.cardLabel}>{shortLabel}</Typography>
                      <Typography component="span" className={classes.sectionBadge}>
                        {sectionBadgeLabel}
                      </Typography>
                      <Box className={classes.cardActions} aria-label="Available actions">
                        <Typography component="span" className={classes.cardActionLabel}>
                          Deploy
                        </Typography>
                        <Typography component="span" className={classes.cardActionLabel}>
                          Update
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {!loadingApps && !appsError && filteredApps.length === 0 && (
        <Paper elevation={0} className={classes.workflowBox}>
          <Typography variant="subtitle2" color="textSecondary" style={{ fontWeight: 700 }}>
            No supported applications found for this catalog section.
          </Typography>
        </Paper>
      )}

      <Paper elevation={0} className={classes.workflowBox}>
        <Typography variant="subtitle1" style={{ fontWeight: 700, marginBottom: 12, color: '#1E3A8A' }}>
          Shared Deployment Workflow
        </Typography>
        <div className={classes.workflowStep}>
          <div className={`${classes.workflowStepNum} ${classes.workflowStepNumActive}`}>1</div>
          <div>
            <Typography variant="body2" style={{ fontWeight: 600 }}>
              Select any application card
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block">
              Cards are generated from the same deploy pipeline application catalog.
            </Typography>
          </div>
        </div>
        <div className={classes.workflowStep}>
          <div className={`${classes.workflowStepNum} ${classes.workflowStepNumActive}`}>2</div>
          <div>
            <Typography variant="body2" style={{ fontWeight: 600 }}>
              Generate, validate, and send for approval
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block">
              The wizard renders Helmfiles server-side and uses the existing approval flow.
            </Typography>
          </div>
        </div>
        <div className={classes.workflowStep}>
          <div className={classes.workflowStepNum}>3</div>
          <div>
            <Typography variant="body2" style={{ fontWeight: 600 }}>
              Deploy and track
            </Typography>
            <Typography variant="caption" color="textSecondary" display="block">
              The approved deployment continues through the same backend workflow as the rest of the
              deployment hub.
            </Typography>
          </div>
        </div>
      </Paper>

      <DeploymentHistory refreshSignal={0} />
    </div>
  );
}
