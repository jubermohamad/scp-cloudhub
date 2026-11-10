/**
 * PlatformPipelinePage — The Three-Stage Code-to-Production Pipeline
 *
 * This is the canonical view of the SymphonyAI platform journey:
 *
 *   Stage 1 ─ Create AKS Cluster       (Platform Team)
 *   Stage 2 ─ Deploy Applications      (Platform Team, via Helm / Helmfile)
 *   Stage 3 ─ Customer Overlay         (Professional Services)
 *
 * Each stage card shows: who owns it, what templates are available,
 * prerequisite dependencies, and a direct CTA to launch the relevant workflow.
 */

import { Typography, Card, CardContent, Button, Divider, Paper, Tooltip } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useNavigate } from 'react-router-dom';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StorageIcon from '@mui/icons-material/Storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PeopleIcon from '@mui/icons-material/People';
import LockIcon from '@mui/icons-material/Lock';
import BuildIcon from '@mui/icons-material/Build';
import { usePersona } from '@internal/plugin-platform-common';

// ─── Stage definitions ────────────────────────────────────────────────────────

interface StageAction {
  label: string;
  route: string;
  primary?: boolean;
}

interface StageDefinition {
  id: number;
  title: string;
  subtitle: string;
  owner: string;
  ownerPersonas: string[];
  description: string;
  Icon: React.ElementType;
  gradient: string;
  accentColor: string;
  lightBg: string;
  capabilities: string[];
  actions: StageAction[];
  prerequisite: string | null;
  detailRoute: string;
}

const STAGES: StageDefinition[] = [
  {
    id: 1,
    title: 'Create AKS Cluster',
    subtitle: 'Infrastructure Provisioning',
    owner: 'Platform Team',
    ownerPersonas: ['cloudhub-platform'],
    description: '',
    Icon: StorageIcon,
    gradient: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
    accentColor: '#1d4ed8',
    lightBg: '#eff6ff',
    capabilities: [
      'Terraform cluster provisioning',
      'Cluster catalog registration',
      'Scale & upgrade workflows',
    ],
    actions: [
      { label: 'Create New Cluster', route: '/create/aks', primary: true },
      { label: 'Modify / Scale Cluster', route: '/create/aks' },
      {
        label: 'View All Provision Workflows',
        route: '/workflows?category=provision',
      },
    ],
    prerequisite: null,
    detailRoute: '/deployment/stage/1',
  },
  {
    id: 2,
    title: 'Deploy Applications',
    subtitle: 'Helm-Based Platform Deployment',
    owner: 'Platform Team',
    ownerPersonas: ['cloudhub-platform'],
    description: '',
    Icon: CloudUploadIcon,
    gradient: 'linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)',
    accentColor: '#2563EB',
    lightBg: '#EFF6FF',
    capabilities: [
      'Service Deployment Wizard',
      'Golden Helmfile templates',
      'Multi-environment promotion',
    ],
    actions: [
      {
        label: 'Launch Deployment Wizard',
        route: '/create/templates/default/service-deployment-wizard',
        primary: true,
      },
      {
        label: 'Deploy Microservice',
        route: '/create/templates/default/deploy-app-mock',
      },
      {
        label: 'View All Deploy Workflows',
        route: '/workflows?category=deploy',
      },
    ],
    prerequisite: 'Requires an AKS cluster from Stage 1',
    detailRoute: '/deployment/stage/2',
  },
  {
    id: 3,
    title: 'Customer Overlay',
    subtitle: 'Customer-Specific Configuration',
    owner: 'Professional Services',
    ownerPersonas: ['professional-services', 'cloudhub-platform'],
    description: '',
    Icon: PeopleIcon,
    gradient: 'linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)',
    accentColor: '#0D9488',
    lightBg: '#F0FDFA',
    capabilities: [
      'Overlay Helmfile generation',
      'Customer config injection',
      'Kubernetes environment registry',
    ],
    actions: [
      {
        label: 'Generate Customer Overlay',
        route: '/create/templates/default/service-deployment-wizard',
        primary: true,
      },
      { label: 'Kubernetes Registry', route: '/tenant-environment-registry' },
    ],
    prerequisite: 'Requires deployed baseline from Stage 2',
    detailRoute: '/deployment/stage/3',
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1600,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.between('lg', 'xl')]: { padding: theme.spacing(3) },
    [theme.breakpoints.up('xl')]: { padding: theme.spacing(5) },
  },

  // Page header
  pageHeader: {
    marginBottom: theme.spacing(4),
  },
  pageTitle: {
    fontSize: '2.125rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: theme.spacing(0.5),
    [theme.breakpoints.between('lg', 'xl')]: { fontSize: '1.75rem' },
    [theme.breakpoints.up('xl')]: { fontSize: '2.5rem' },
  },
  pageSubtitle: {
    fontSize: '1.125rem',
    color: '#6B7280',
    marginBottom: theme.spacing(2.5),
    [theme.breakpoints.up('xl')]: { fontSize: '1.25rem' },
  },

  stagesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: theme.spacing(3),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: '1fr',
    },
  },

  // Stage cards
  stageCard: {
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    transition: 'box-shadow 0.2s',
    background: '#FFFFFF',
    height: '100%',
    minHeight: 'fit-content',
    '&:hover': {
      boxShadow: '0 10px 28px rgba(15, 23, 42, 0.1)',
    },
  },
  stageHeader: {
    width: '100%',
    padding: theme.spacing(2.5),
    color: '#FFFFFF',
    flexShrink: 0,
  },
  stageNumberBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.25)',
    fontSize: '0.875rem',
    fontWeight: 700,
    marginBottom: theme.spacing(1.25),
    color: '#FFFFFF',
  },
  stageIconRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1.25),
  },
  stageTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: theme.spacing(0.5),
    [theme.breakpoints.between('lg', 'xl')]: { fontSize: '1.25rem' },
    [theme.breakpoints.up('xl')]: { fontSize: '1.875rem' },
  },
  stageSubtitle: {
    fontSize: '1rem',
    opacity: 0.85,
    marginBottom: theme.spacing(1.25),
  },
  ownerPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 12px',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    fontSize: '0.875rem',
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.3)',
  },

  // Card body
  stageBody: {
    padding: theme.spacing(2.5),
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  description: {
    fontSize: '1rem',
    color: '#374151',
    lineHeight: 1.7,
    marginBottom: theme.spacing(2.5),
  },
  prerequisiteBox: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1, 1.5),
    borderRadius: 6,
    backgroundColor: '#FFFBEB',
    border: '1px solid #FDE68A',
    marginBottom: theme.spacing(2.5),
    fontSize: '0.9375rem',
    color: '#92400E',
  },
  capabilitiesTitle: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#9CA3AF',
    marginBottom: theme.spacing(1.25),
  },
  capabilitiesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.875),
    marginBottom: theme.spacing(2.5),
    flex: 1,
  },
  capabilityItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.875),
    fontSize: '0.9375rem',
    color: '#374151',
  },
  capabilityCheck: {
    fontSize: 18,
    flexShrink: 0,
  },

  // Action buttons area
  stageActions: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing(1.25),
    paddingTop: theme.spacing(2.5),
    borderTop: '1px solid #F3F4F6',
    '& .MuiButton-root': {
      width: 'auto',
    },
    [theme.breakpoints.down('sm')]: {
      flexDirection: 'column',
      '& .MuiButton-root': {
        width: '100%',
      },
    },
  },
  primaryBtn: {
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '1rem',
    textTransform: 'none',
    padding: theme.spacing(1, 2.5),
  },
  secondaryBtn: {
    borderRadius: 6,
    fontWeight: 500,
    fontSize: '0.9375rem',
    textTransform: 'none',
    padding: theme.spacing(0.75, 2),
    color: '#374151',
    borderColor: '#D1D5DB',
  },

  // Summary row at bottom
  summarySection: {
    marginTop: theme.spacing(5),
  },
  summaryTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: '#111827',
    marginBottom: theme.spacing(2),
  },
  summaryCard: {
    padding: theme.spacing(2.5),
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    boxShadow: 'none',
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(1.5),
    '&:last-child': { marginBottom: 0 },
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginTop: 6,
    flexShrink: 0,
  },
  summaryText: {
    fontSize: '0.9375rem',
    color: '#374151',
    lineHeight: 1.6,
  },
  summaryLabel: {
    fontWeight: 600,
    color: '#111827',
  },
}));

// ─── Stage Card ───────────────────────────────────────────────────────────────

function StageCard({
  stage,
  accessible,
}: {
  stage: StageDefinition;
  accessible: boolean;
}) {
  const classes = useStyles();
  const navigate = useNavigate();

  return (
    <Card className={classes.stageCard} elevation={0}>
      {/* Coloured header */}
      <div
        className={classes.stageHeader}
        style={{ background: stage.gradient }}
      >
        <div className={classes.stageNumberBadge}>{stage.id}</div>
        <div className={classes.stageIconRow}>
          <div>
            <Typography className={classes.stageTitle}>
              {stage.title}
            </Typography>
            <Typography className={classes.stageSubtitle}>
              {stage.subtitle}
            </Typography>
          </div>
          <stage.Icon style={{ fontSize: 38, opacity: 0.7 }} />
        </div>
        <span className={classes.ownerPill}>
          <BuildIcon style={{ fontSize: 11 }} />
          {stage.owner}
        </span>
      </div>

      {/* Body */}
      <CardContent className={classes.stageBody}>
        {stage.description && (
          <Typography className={classes.description}>
            {stage.description}
          </Typography>
        )}

        {stage.prerequisite && (
          <div className={classes.prerequisiteBox}>
            <LockIcon style={{ fontSize: 14 }} />
            {stage.prerequisite}
          </div>
        )}

        <Typography className={classes.capabilitiesTitle}>
          Capabilities
        </Typography>
        <div className={classes.capabilitiesList}>
          {stage.capabilities.map(cap => (
            <div key={cap} className={classes.capabilityItem}>
              <CheckCircleIcon
                className={classes.capabilityCheck}
                style={{ color: stage.accentColor }}
              />
              {cap}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className={classes.stageActions}>
          {stage.actions.map(action =>
            action.primary ? (
              <Tooltip
                key={action.label}
                title={
                  !accessible
                    ? 'Your current persona does not have access to this stage'
                    : ''
                }
              >
                <span>
                  <Button
                    variant="contained"
                    fullWidth
                    className={classes.primaryBtn}
                    style={
                      accessible
                        ? { backgroundColor: stage.accentColor, color: '#fff' }
                        : {}
                    }
                    disabled={!accessible}
                    onClick={() => navigate(action.route)}
                  >
                    {action.label}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                key={action.label}
                variant="outlined"
                fullWidth
                className={classes.secondaryBtn}
                onClick={() => navigate(action.route)}
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PlatformPipelinePage() {
  const classes = useStyles();
  const { persona } = usePersona();

  const isAccessible = (stage: StageDefinition) =>
    stage.ownerPersonas.includes(persona);

  return (
    <div className={classes.root}>
      {/* Page header */}
      <div className={classes.pageHeader}>
        <Typography className={classes.pageTitle}>
          Deployment Control
        </Typography>
        <Typography className={classes.pageSubtitle}>
          Three-stage release flow from infrastructure provisioning to customer
          deployment.
        </Typography>
      </div>

      {/* Three-column stage grid */}
      <div className={classes.stagesGrid}>
        {STAGES.filter(stage => isAccessible(stage)).map(stage => (
          <StageCard
            key={stage.id}
            stage={stage}
            accessible={isAccessible(stage)}
          />
        ))}
      </div>

      {/* Responsibility matrix summary */}
      <div className={classes.summarySection}>
        <Typography className={classes.summaryTitle}>
          Ownership & Responsibilities
        </Typography>
        <Paper className={classes.summaryCard} elevation={0}>
          <div className={classes.summaryRow}>
            <div
              className={classes.summaryDot}
              style={{ backgroundColor: '#6B21A8' }}
            />
            <Typography className={classes.summaryText}>
              <span className={classes.summaryLabel}>
                Stage 1 — Platform Team:{' '}
              </span>
              Cluster creation via Terraform — generates tfvars, submits PRs to
              the CloudHub repo, and drives GitHub Actions apply.
            </Typography>
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <div className={classes.summaryRow}>
            <div
              className={classes.summaryDot}
              style={{ backgroundColor: '#2563EB' }}
            />
            <Typography className={classes.summaryText}>
              <span className={classes.summaryLabel}>
                Stage 2 — Platform Team:{' '}
              </span>
              Owns golden Helmfile templates and the Service Deployment Wizard.
              Deploys via PR-based GitOps — PS teams cannot modify golden
              templates.
            </Typography>
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <div className={classes.summaryRow}>
            <div
              className={classes.summaryDot}
              style={{ backgroundColor: '#0D9488' }}
            />
            <Typography className={classes.summaryText}>
              <span className={classes.summaryLabel}>
                Stage 3 — Professional Services:{' '}
              </span>
              Tenant overlays for branding, config, and routing — layered on the
              platform baseline without modifying golden templates.
            </Typography>
          </div>
        </Paper>
      </div>
    </div>
  );
}
