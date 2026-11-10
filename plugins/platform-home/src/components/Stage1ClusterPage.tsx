/**
 * Stage 1: Create AKS Cluster
 * Owner: Platform Team
 *
 * This page is the detailed view for Stage 1 of the SymphonyAI
 * Code-to-Production pipeline. It surfaces all cluster provisioning
 * and lifecycle workflows along with contextual guidance.
 */

import { Typography, Grid, Card, CardContent, CardActions, Button, Chip, Paper } from '@mui/material';
import { makeStyles } from '@mui/styles';

import {
  Content,
  Header,
  Page,
  WarningPanel,
} from '@backstage/core-components';
import { useNavigate } from 'react-router-dom';
import StorageIcon from '@mui/icons-material/Storage';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { usePersona } from '@internal/plugin-platform-common';

// ─── Workflow entries for Stage 1 ─────────────────────────────────────────────

interface StageWorkflow {
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** Navigation target for the launch button — null means coming soon */
  href: string | null;
  isPrimary?: boolean;
}

const STAGE1_WORKFLOWS: StageWorkflow[] = [
  {
    id: 'create-cluster',
    title: 'Create AKS Cluster',
    description:
      'Provision a new AKS cluster through the approved Terraform workflow.',
    tags: ['terraform', 'aks', 'networking', 'rbac', 'catalog'],
    href: '/create/aks',
    isPrimary: true,
  },
  {
    id: 'modify-cluster',
    title: 'Modify / Scale / Upgrade Cluster',
    description: 'Update node pools, VM SKUs, or Kubernetes version.',
    tags: ['terraform', 'aks', 'scaling', 'upgrade'],
    href: '/create/aks',
  },
  {
    id: 'create-namespace',
    title: 'Create Namespace',
    description: 'Create a namespace with platform RBAC and quota defaults.',
    tags: ['namespace', 'rbac', 'quotas', 'network-policy'],
    href: null,
  },
];

// ─── Platform tools for Stage 1 ──────────────────────────────────────────────

const PLATFORM_TOOLS = [
  {
    label: 'Kubernetes Environment Registry',
    route: '/tenant-environment-registry',
    description: 'View all provisioned AKS clusters and tenant environments',
  },
  {
    label: 'Environment Health',
    route: '/sre/clusters',
    description: 'Monitor cluster health and pipeline status',
  },
  {
    label: 'All Provision Workflows',
    route: '/workflows?category=provision',
    description: 'Full workflow catalog',
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#6B21A8';
const ACCENT_LIGHT = '#F5F3FF';
const GRADIENT = 'linear-gradient(135deg, #4C1480 0%, #6B21A8 100%)';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1440,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.between('lg', 'xl')]: { padding: theme.spacing(3) },
    [theme.breakpoints.up('xl')]: { padding: theme.spacing(5) },
  },

  // Back + breadcrumb
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
    marginBottom: theme.spacing(2.5),
  },
  backRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    cursor: 'pointer',
    color: '#6B7280',
    fontSize: '0.875rem',
    '&:hover': { color: ACCENT },
  },

  // Hero banner
  heroBanner: {
    borderRadius: 12,
    background: GRADIENT,
    color: '#FFFFFF',
    padding: theme.spacing(3.5, 4),
    marginBottom: theme.spacing(4),
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
  },
  heroLeft: {
    flex: 1,
    minWidth: 280,
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    fontSize: '0.75rem',
    fontWeight: 600,
    marginBottom: theme.spacing(1.5),
    border: '1px solid rgba(255,255,255,0.3)',
  },
  heroTitle: {
    fontSize: '1.625rem',
    fontWeight: 700,
    marginBottom: theme.spacing(0.5),
    [theme.breakpoints.between('lg', 'xl')]: { fontSize: '1.375rem' },
    [theme.breakpoints.up('xl')]: { fontSize: '2rem' },
  },
  heroSubtitle: {
    fontSize: '0.9375rem',
    opacity: 0.85,
    lineHeight: 1.5,
    maxWidth: 640,
    [theme.breakpoints.up('xl')]: { fontSize: '1.0625rem', maxWidth: 760 },
  },
  heroPipelineRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(2),
    flexWrap: 'wrap',
  },
  heroPipelineStep: {
    padding: '4px 12px',
    borderRadius: 8,
    fontSize: '0.75rem',
    fontWeight: 600,
    backgroundColor: 'rgba(255,255,255,0.2)',
    border: '1px solid rgba(255,255,255,0.35)',
  },
  heroPipelineStepActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    color: ACCENT,
  },
  heroIcon: {
    fontSize: 60,
    opacity: 0.2,
    alignSelf: 'center',
  },

  // Section headings
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111827',
    marginBottom: theme.spacing(2),
    marginTop: theme.spacing(3.5),
  },

  // Workflow cards
  workflowCard: {
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    display: 'flex',
    flexDirection: 'row',
    transition: 'box-shadow 0.18s, border-color 0.18s',
    background: '#FFFFFF',
    '&:hover': {
      boxShadow: '0 4px 16px rgba(107,33,168,0.12)',
      borderColor: '#DDD6FE',
    },
    [theme.breakpoints.down('sm')]: { flexDirection: 'column' },
  },
  workflowCardPrimary: {
    borderColor: '#DDD6FE',
    borderWidth: 2,
  },
  primaryBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    backgroundColor: ACCENT_LIGHT,
    color: ACCENT,
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    marginBottom: theme.spacing(0.75),
    border: `1px solid #DDD6FE`,
  },
  workflowTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111827',
    marginBottom: theme.spacing(0.5),
  },
  workflowDescription: {
    fontSize: '0.8125rem',
    color: '#6B7280',
    lineHeight: 1.6,
    flex: 1,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: theme.spacing(1.5),
  },
  tag: {
    height: 20,
    fontSize: '0.68rem',
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
    border: 'none',
  },
  cardActionRow: {
    padding: theme.spacing(1.5, 2),
    borderTop: '1px solid #F3F4F6',
  },
  launchBtn: {
    borderRadius: 6,
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.8125rem',
  },

  // How it works
  howItWorksCard: {
    padding: theme.spacing(3),
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    boxShadow: 'none',
  },
  stepRow: {
    display: 'flex',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    '&:last-child': { marginBottom: 0 },
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    backgroundColor: ACCENT_LIGHT,
    color: ACCENT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8125rem',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 2,
  },
  stepText: {
    fontSize: '0.875rem',
    color: '#374151',
    lineHeight: 1.6,
  },
  stepLabel: {
    fontWeight: 600,
    color: '#111827',
    display: 'block',
    marginBottom: 2,
  },

  // Tools panel
  toolsCard: {
    padding: theme.spacing(2.5),
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    boxShadow: 'none',
  },
  toolItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1, 0),
    borderBottom: '1px solid #F3F4F6',
    '&:last-child': { borderBottom: 0 },
  },
  toolLabel: {
    fontWeight: 600,
    fontSize: '0.875rem',
    color: '#111827',
  },
  toolDesc: {
    fontSize: '0.8rem',
    color: '#9CA3AF',
  },
  nextStageBox: {
    marginTop: theme.spacing(4),
    padding: theme.spacing(2.5),
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    border: '1px solid #BFDBFE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
  },
  nextStageText: {
    fontSize: '0.9375rem',
    color: '#1E40AF',
    fontWeight: 600,
  },
  nextStageSubText: {
    fontSize: '0.8125rem',
    color: '#3B82F6',
    marginTop: 2,
  },
}));

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Stage1ClusterPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const { persona } = usePersona();

  if (persona !== 'cloudhub-platform') {
    return (
      <Page themeId="tool">
        <Header
          title="Stage 1: Create AKS Cluster"
          subtitle="Platform Team capability"
        />
        <Content>
          <WarningPanel title="Access restricted">
            Stage 1 is available only to the Platform Team persona.
          </WarningPanel>
        </Content>
      </Page>
    );
  }

  return (
    <div className={classes.root}>
      <div className={classes.topBar}>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
        <div
          className={classes.backRow}
          onClick={() => navigate('/deployment')}
        >
          <ArrowBackIcon style={{ fontSize: 16 }} />
          Back to Pipeline Overview
        </div>
      </div>

      {/* Hero banner */}
      <div className={classes.heroBanner}>
        <div className={classes.heroLeft}>
          <div className={classes.heroBadge}>
            <StorageIcon style={{ fontSize: 12 }} />
            Stage 1 of 3 · Platform Team
          </div>
          <Typography className={classes.heroTitle}>
            Create AKS Cluster
          </Typography>
          <Typography className={classes.heroSubtitle}>
            Provision and manage Azure Kubernetes Service clusters using
            Terraform. Every cluster created here becomes the foundation for
            Stages 2 and 3.
          </Typography>
          <div className={classes.heroPipelineRow}>
            <span
              className={`${classes.heroPipelineStep} ${classes.heroPipelineStepActive}`}
            >
              ① AKS Cluster
            </span>
            <ArrowForwardIcon style={{ fontSize: 14, opacity: 0.6 }} />
            <span className={classes.heroPipelineStep}>② Deploy Apps</span>
            <ArrowForwardIcon style={{ fontSize: 14, opacity: 0.6 }} />
            <span className={classes.heroPipelineStep}>③ Customer Overlay</span>
          </div>
        </div>
        <StorageIcon className={classes.heroIcon} />
      </div>

      {/* Workflow cards */}
      <Typography className={classes.sectionTitle}>
        Cluster Workflows
      </Typography>
      <Grid container spacing={2}>
        {STAGE1_WORKFLOWS.map(wf => (
          <Grid item xs={12} key={wf.id}>
            <Card
              className={`${classes.workflowCard} ${
                wf.isPrimary ? classes.workflowCardPrimary : ''
              }`}
              elevation={0}
            >
              <CardContent
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              >
                {wf.isPrimary && (
                  <span className={classes.primaryBadge}>PRIMARY WORKFLOW</span>
                )}
                <Typography className={classes.workflowTitle}>
                  {wf.title}
                </Typography>
                <Typography className={classes.workflowDescription}>
                  {wf.description}
                </Typography>
                <div className={classes.tagRow}>
                  {wf.tags.map(t => (
                    <Chip
                      key={t}
                      label={t}
                      size="small"
                      className={classes.tag}
                    />
                  ))}
                </div>
              </CardContent>
              <CardActions
                className={classes.cardActionRow}
                style={{ minWidth: 180, justifyContent: 'flex-end' }}
              >
                {wf.href ? (
                  <Button
                    variant={wf.isPrimary ? 'contained' : 'outlined'}
                    size="small"
                    className={classes.launchBtn}
                    style={
                      wf.isPrimary
                        ? { backgroundColor: ACCENT, color: '#fff' }
                        : {}
                    }
                    startIcon={<PlayArrowIcon />}
                    onClick={() => navigate(wf.href!)}
                  >
                    Launch Workflow
                  </Button>
                ) : (
                  <Chip
                    label="Coming soon"
                    size="small"
                    style={{ backgroundColor: '#F3F4F6', color: '#9CA3AF' }}
                  />
                )}
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* How it works */}
      <Typography className={classes.sectionTitle}>
        How Stage 1 Works
      </Typography>
      <Paper className={classes.howItWorksCard} elevation={0}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            {[
              {
                n: 1,
                label: 'Fill the cluster form',
                text: 'Enter cluster, region, node, version, and network inputs.',
              },
              {
                n: 2,
                label: 'Generate tfvars',
                text: 'Backstage renders the approved Terraform variables.',
              },
              {
                n: 3,
                label: 'Review PR',
                text: 'The generated infrastructure PR is ready for review.',
              },
            ].map(s => (
              <div key={s.n} className={classes.stepRow}>
                <div className={classes.stepNum}>{s.n}</div>
                <Typography className={classes.stepText}>
                  <span className={classes.stepLabel}>{s.label}</span>
                  {s.text}
                </Typography>
              </div>
            ))}
          </Grid>
          <Grid item xs={12} md={6}>
            {[
              {
                n: 4,
                label: 'Pipeline runs',
                text: 'Merge triggers the Terraform plan/apply workflow.',
              },
              {
                n: 5,
                label: 'Register cluster',
                text: 'The environment appears in the platform registry.',
              },
              {
                n: 6,
                label: 'Ready for Stage 2',
                text: 'Application deployment can start.',
              },
            ].map(s => (
              <div key={s.n} className={classes.stepRow}>
                <div className={classes.stepNum}>{s.n}</div>
                <Typography className={classes.stepText}>
                  <span className={classes.stepLabel}>{s.label}</span>
                  {s.text}
                </Typography>
              </div>
            ))}
          </Grid>
        </Grid>
      </Paper>

      {/* Platform tools */}
      <Typography className={classes.sectionTitle}>
        Related Platform Tools
      </Typography>
      <Paper className={classes.toolsCard} elevation={0}>
        {PLATFORM_TOOLS.map(tool => (
          <div key={tool.route} className={classes.toolItem}>
            <div>
              <Typography className={classes.toolLabel}>
                {tool.label}
              </Typography>
              <Typography className={classes.toolDesc}>
                {tool.description}
              </Typography>
            </div>
            <Button
              size="small"
              variant="text"
              style={{ color: ACCENT, textTransform: 'none', fontWeight: 600 }}
              endIcon={<ArrowForwardIcon style={{ fontSize: 14 }} />}
              onClick={() => navigate(tool.route)}
            >
              Open
            </Button>
          </div>
        ))}
      </Paper>

      {/* Next stage CTA */}
      <div className={classes.nextStageBox}>
        <div>
          <Typography className={classes.nextStageText}>
            Ready to deploy applications?
          </Typography>
          <Typography className={classes.nextStageSubText}>
            Once your cluster is provisioned, move to Stage 2 — Deploy
            Applications using Helm.
          </Typography>
        </div>
        <Button
          variant="contained"
          style={{
            backgroundColor: '#2563EB',
            color: '#fff',
            borderRadius: 6,
            textTransform: 'none',
            fontWeight: 600,
          }}
          endIcon={<ArrowForwardIcon />}
          onClick={() => navigate('/deployment/stage/2')}
        >
          Go to Stage 2
        </Button>
      </div>
    </div>
  );
}
