/**
 * Stage 3: Customer Overlay
 * Owner: Professional Services
 *
 * Deploy customer-specific overlay configurations into the provisioned
 * AKS cluster on top of the platform baseline deployed in Stage 2.
 */

import { Typography, Grid, Card, CardContent, CardActions, Button, Chip, Paper } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useNavigate } from 'react-router-dom';
import PeopleIcon from '@mui/icons-material/People';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

// ─── Workflow entries ─────────────────────────────────────────────────────────

interface StageWorkflow {
  id: string;
  title: string;
  description: string;
  tags: string[];
  templateName: string | null;
  isPrimary?: boolean;
}

const STAGE3_WORKFLOWS: StageWorkflow[] = [
  {
    id: 'overlay-helmfile',
    title: 'Deploy Customer Overlay',
    description:
      'Generate and deploy tenant configuration on top of the platform baseline.',
    tags: ['helmfile', 'overlay', 'tenant', 'pr-based'],
    templateName: 'service-deployment-wizard',
    isPrimary: true,
  },
  {
    id: 'tenant-registry',
    title: 'All Onboarded Customers',
    description: 'View all tenant environments, cluster status, and ownership.',
    tags: ['registry', 'tenant', 'environments', 'status'],
    templateName: null,
  },
  {
    id: 'onboard-customer',
    title: 'Onboard New Customer',
    description: 'Register customer identity, environments, and contacts.',
    tags: ['onboarding', 'registry', 'tenant', 'namespace'],
    templateName: null,
  },
];

// ─── Overlay model description ────────────────────────────────────────────────

const OVERLAY_MODEL = [
  {
    layer: 'Platform Baseline (Stage 2)',
    description:
      'Golden Helmfile templates — owned by Platform Team. Never modified by PS.',
    color: '#2563EB',
    bg: '#EFF6FF',
    border: '#BFDBFE',
    icon: '🔒',
  },
  {
    layer: 'Customer Overlay (Stage 3)',
    description:
      'Tenant-specific configuration injected by Professional Services via overlay Helmfiles.',
    color: '#0D9488',
    bg: '#F0FDFA',
    border: '#99F6E4',
    icon: '🎯',
  },
];

// ─── Platform tools ───────────────────────────────────────────────────────────

const PLATFORM_TOOLS = [
  {
    label: 'Kubernetes Environment Registry',
    route: '/tenant-environment-registry',
    description: 'View all tenant environments',
  },
  {
    label: 'Customer Overlay Manager',
    route: '/tenant-overlay-manager',
    description: 'Manage active overlays',
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#0D9488';
const ACCENT_LIGHT = '#F0FDFA';
const GRADIENT = 'linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2) },
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
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
    marginBottom: theme.spacing(2.5),
  },
  heroBanner: {
    borderRadius: 12,
    background: GRADIENT,
    color: '#FFFFFF',
    padding: theme.spacing(2, 2.5),
    marginBottom: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  heroBannerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1.5),
    flexWrap: 'wrap' as const,
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 8px',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    fontSize: '0.7rem',
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.3)',
    flexShrink: 0,
  },
  heroTitle: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2 },
  heroSubtitle: { fontSize: '0.875rem', opacity: 0.85, lineHeight: 1.5 },
  heroPipelineRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(0.5),
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
  heroIcon: { fontSize: 60, opacity: 0.2, alignSelf: 'center' },

  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111827',
    marginBottom: theme.spacing(2),
    marginTop: theme.spacing(3.5),
  },

  workflowCard: {
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    display: 'flex',
    flexDirection: 'row',
    transition: 'box-shadow 0.18s, border-color 0.18s',
    background: '#FFFFFF',
    '&:hover': {
      boxShadow: '0 4px 16px rgba(13,148,136,0.12)',
      borderColor: '#99F6E4',
    },
    [theme.breakpoints.down('sm')]: { flexDirection: 'column' },
  },
  workflowCardPrimary: { borderColor: '#99F6E4', borderWidth: 2 },
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
    border: '1px solid #99F6E4',
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

  // Overlay model
  overlayModelCard: {
    padding: theme.spacing(2),
    borderRadius: 8,
    border: '1px solid',
    marginBottom: theme.spacing(1.5),
    '&:last-child': { marginBottom: 0 },
  },
  overlayLayerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
  },
  overlayLayerTitle: { fontWeight: 600, fontSize: '0.875rem' },
  overlayLayerDesc: {
    fontSize: '0.8125rem',
    color: '#6B7280',
    lineHeight: 1.5,
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
  stepText: { fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 },
  stepLabel: {
    fontWeight: 600,
    color: '#111827',
    display: 'block',
    marginBottom: 2,
  },

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
  toolLabel: { fontWeight: 600, fontSize: '0.875rem', color: '#111827' },
  toolDesc: { fontSize: '0.8rem', color: '#9CA3AF' },

  prevStageBox: {
    padding: theme.spacing(2.5),
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    border: '1px solid #BFDBFE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    marginTop: theme.spacing(4),
  },
  completeBadge: {
    marginTop: theme.spacing(3),
    padding: theme.spacing(3),
    borderRadius: 12,
    background: 'linear-gradient(135deg, #F5F3FF 0%, #F0FDFA 100%)',
    border: '1px solid #E5E7EB',
    textAlign: 'center' as const,
  },
}));

// ─── Page ─────────────────────────────────────────────────────────────────────

export interface Stage3OverlayPageProps {
  isTab?: boolean;
}

export function Stage3OverlayPage({ isTab = false }: Stage3OverlayPageProps) {
  const classes = useStyles();
  const navigate = useNavigate();

  return (
    <div className={classes.root}>
      {!isTab && (
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
      )}

      {/* Hero */}
      <div className={classes.heroBanner}>
        <div className={classes.heroBannerRow}>
          <Typography className={classes.heroTitle}>
            Customer Overlay
          </Typography>
          <span className={classes.heroBadge}>
            <PeopleIcon style={{ fontSize: 11 }} />
            &nbsp;Stage 3 of 3 · Professional Services
          </span>
        </div>
        <Typography className={classes.heroSubtitle}>
          Layer customer-specific configurations on top of the platform
          baseline. Professional Services uses overlay Helmfiles to inject
          tenant customisations without modifying the platform's golden
          templates.
        </Typography>
        <div className={classes.heroPipelineRow}>
          <span className={classes.heroPipelineStep}>① AKS Cluster</span>
          <ArrowForwardIcon style={{ fontSize: 14, opacity: 0.6 }} />
          <span className={classes.heroPipelineStep}>② Deploy Apps</span>
          <ArrowForwardIcon style={{ fontSize: 14, opacity: 0.6 }} />
          <span
            className={`${classes.heroPipelineStep} ${classes.heroPipelineStepActive}`}
          >
            ③ Customer Overlay
          </span>
        </div>
      </div>

      {/* Overlay model */}
      <Typography className={classes.sectionTitle}>
        Layered Deployment Model
      </Typography>
      <Paper
        style={{
          padding: 20,
          borderRadius: 10,
          border: '1px solid #E5E7EB',
          boxShadow: 'none',
          marginBottom: 4,
        }}
        elevation={0}
      >
        <Typography
          variant="body2"
          style={{ color: '#6B7280', marginBottom: 16 }}
        >
          Customer-specific configuration stays separate from platform-owned
          templates.
        </Typography>
        {OVERLAY_MODEL.map(layer => (
          <div
            key={layer.layer}
            className={classes.overlayModelCard}
            style={{ backgroundColor: layer.bg, borderColor: layer.border }}
          >
            <div className={classes.overlayLayerHeader}>
              <span style={{ fontSize: 16 }}>{layer.icon}</span>
              <Typography
                className={classes.overlayLayerTitle}
                style={{ color: layer.color }}
              >
                {layer.layer}
              </Typography>
            </div>
            <Typography className={classes.overlayLayerDesc}>
              {layer.description}
            </Typography>
          </div>
        ))}
      </Paper>

      {/* Workflow cards */}
      <Typography className={classes.sectionTitle}>
        Customer Overlay Workflows
      </Typography>
      <Grid container spacing={2}>
        {STAGE3_WORKFLOWS.map(wf => (
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
                {wf.templateName ? (
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
                    onClick={() =>
                      navigate(`/create/templates/default/${wf.templateName}`)
                    }
                  >
                    Launch
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    size="small"
                    className={classes.launchBtn}
                    onClick={() => {
                      const routes: Record<string, string> = {
                        'onboard-customer': '/deployment?stage=customer-overlay',
                        'tenant-registry': '/tenant-environment-registry',
                      };
                      navigate(routes[wf.id] || '/');
                    }}
                  >
                    Open
                  </Button>
                )}
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* How it works */}
      <Typography className={classes.sectionTitle}>
        How Stage 3 Works
      </Typography>
      <Paper className={classes.howItWorksCard} elevation={0}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            {[
              {
                n: 1,
                label: 'Select customer',
                text: 'Choose customer and target environment.',
              },
              {
                n: 2,
                label: 'Define overlay',
                text: 'Set branding, flags, routing, and overrides.',
              },
              {
                n: 3,
                label: 'Generate Helmfile',
                text: 'Create a tenant-scoped overlay.',
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
                label: 'Review PR',
                text: 'Confirm platform templates are unchanged.',
              },
              {
                n: 5,
                label: 'Apply overlay',
                text: 'Run Helm against the customer namespace.',
              },
              {
                n: 6,
                label: 'Handoff',
                text: 'Environment is registered and ready.',
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

      {/* Related tools */}
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

      {/* Prev stage + completion badge */}
      <div className={classes.prevStageBox}>
        <div>
          <Typography
            style={{ fontSize: '0.9375rem', color: '#1E40AF', fontWeight: 600 }}
          >
            Need to deploy the baseline first?
          </Typography>
          <Typography
            style={{ fontSize: '0.8125rem', color: '#3B82F6', marginTop: 2 }}
          >
            Stage 2 — Deploy Applications sets up the platform baseline this
            overlay extends.
          </Typography>
        </div>
        <Button
          variant="outlined"
          style={{
            borderColor: '#2563EB',
            color: '#2563EB',
            borderRadius: 6,
            textTransform: 'none',
            fontWeight: 600,
          }}
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/deployment/stage/2')}
        >
          Go to Stage 2
        </Button>
      </div>

      <div className={classes.completeBadge}>
        <VerifiedUserIcon
          style={{ fontSize: 36, color: ACCENT, marginBottom: 8 }}
        />
        <Typography
          style={{
            fontWeight: 700,
            fontSize: '1rem',
            color: '#111827',
            marginBottom: 4,
          }}
        >
          Pipeline Complete
        </Typography>
        <Typography style={{ fontSize: '0.875rem', color: '#6B7280' }}>
          When Stage 3 is done, the customer's environment is fully provisioned,
          deployed, and configured — ready for production handoff.
        </Typography>
      </div>
    </div>
  );
}
