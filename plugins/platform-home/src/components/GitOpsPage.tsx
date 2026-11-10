/**
 * GitOpsPage - ArgoCD integration for declarative Kubernetes deployments
 * Upcoming feature: GitOps workflow management and configuration
 */

import { useNavigate } from 'react-router-dom';
import { makeStyles } from '@mui/styles';
import {
  Button,
  CardContent,
  Chip,
  Divider,
  Grid,
  Paper,
  Typography,
  Alert,
  AlertTitle,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import GitHubIcon from '@mui/icons-material/GitHub';
import StorageIcon from '@mui/icons-material/Storage';
import TuneIcon from '@mui/icons-material/Tune';
import TimelineIcon from '@mui/icons-material/Timeline';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

interface Feature {
  title: string;
  description: string;
  icon: React.ElementType;
  status: 'planned' | 'in-progress' | 'beta' | 'available';
}

const GITOPS_FEATURES: Feature[] = [
  {
    title: 'ArgoCD Integration',
    description: 'Declarative GitOps workflows for continuous deployment',
    icon: GitHubIcon,
    status: 'planned',
  },
  {
    title: 'Application Sync',
    description: 'Synchronize cluster state with Git repositories',
    icon: StorageIcon,
    status: 'planned',
  },
  {
    title: 'Drift Detection',
    description: 'Monitor and detect configuration drift in deployments',
    icon: TimelineIcon,
    status: 'planned',
  },
  {
    title: 'Policy Management',
    description: 'Define and enforce deployment policies across clusters',
    icon: TuneIcon,
    status: 'planned',
  },
  {
    title: 'Application Topology',
    description: 'Visualize application dependencies and relationships',
    icon: AccountTreeIcon,
    status: 'planned',
  },
  {
    title: 'Audit & Compliance',
    description: 'Track deployment history and audit compliance',
    icon: VerifiedUserIcon,
    status: 'planned',
  },
];

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
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
    position: 'sticky',
    top: theme.spacing(8),
    zIndex: theme.zIndex.appBar - 1,
    padding: theme.spacing(0.75, 0),
    background: 'rgba(255,255,255,0.96)',
    backdropFilter: 'blur(8px)',
  },
  backButton: {
    color: '#6B7280',
    textTransform: 'none',
    fontWeight: 700,
  },
  hero: {
    borderRadius: 12,
    padding: theme.spacing(2.5),
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(2),
    background: 'linear-gradient(135deg, #0D5C3D 0%, #10B981 100%)',
  },
  heroBadge: {
    background: 'rgba(255,255,255,0.16)',
    color: '#FFFFFF',
    border: '1px solid rgba(255,255,255,0.24)',
    fontWeight: 800,
    marginBottom: theme.spacing(0.5),
    letterSpacing: '0.03em',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  subtitle: {
    maxWidth: 980,
    color: 'rgba(255,255,255,0.85)',
    fontSize: '0.875rem',
    lineHeight: 1.5,
  },
  featureGrid: {
    marginTop: theme.spacing(3),
  },
  featureCard: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    transition: 'all 0.2s ease',
    '&:hover': {
      boxShadow: theme.shadows[4],
      borderColor: '#10B981',
    },
  },
  featureHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  featureIcon: {
    color: '#10B981',
    fontSize: '1.75rem',
  },
  featureTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#1F2937',
  },
  featureDescription: {
    fontSize: '0.875rem',
    color: '#6B7280',
    lineHeight: 1.5,
    marginBottom: theme.spacing(1),
    flex: 1,
  },
  statusBadge: {
    marginTop: 'auto',
  },
  statusChip: {
    height: 24,
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  statusPlanned: {
    backgroundColor: '#FEE2E2',
    color: '#DC2626',
  },
  statusInProgress: {
    backgroundColor: '#FEF08A',
    color: '#D97706',
  },
  statusBeta: {
    backgroundColor: '#E0E7FF',
    color: '#4F46E5',
  },
  statusAvailable: {
    backgroundColor: '#DCFCE7',
    color: '#16A34A',
  },
  comingSoonAlert: {
    marginBottom: theme.spacing(2),
    borderRadius: 8,
  },
  section: {
    marginTop: theme.spacing(4),
  },
  sectionTitle: {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#1F2937',
    marginBottom: theme.spacing(2),
  },
}));

const getStatusChipClass = (classes: ReturnType<typeof useStyles>, status: Feature['status']) => {
  switch (status) {
    case 'planned':
      return `${classes.statusChip} ${classes.statusPlanned}`;
    case 'in-progress':
      return `${classes.statusChip} ${classes.statusInProgress}`;
    case 'beta':
      return `${classes.statusChip} ${classes.statusBeta}`;
    case 'available':
      return `${classes.statusChip} ${classes.statusAvailable}`;
    default:
      return classes.statusChip;
  }
};

export const GitOpsPage = () => {
  const navigate = useNavigate();
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <div className={classes.topBar}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          className={classes.backButton}
        >
          Back
        </Button>
      </div>

      <div className={classes.hero}>
        <Chip
          size="small"
          label="UPCOMING FEATURE"
          className={classes.heroBadge}
        />
        <h1 className={classes.title}>GitOps & ArgoCD Integration</h1>
        <p className={classes.subtitle}>
          Declarative Kubernetes deployment management through Git repositories.
          Define, synchronize, and manage application configurations using
          ArgoCD for continuous delivery pipelines.
        </p>
      </div>

      <Alert severity="info" className={classes.comingSoonAlert}>
        <AlertTitle>Coming Soon</AlertTitle>
        GitOps integration is currently under development. These features will
        enable enterprise-grade declarative deployment workflows through Git-based
        configuration management.
      </Alert>

      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Planned Features</h2>
        <Grid container spacing={2} className={classes.featureGrid}>
          {GITOPS_FEATURES.map(feature => {
            const IconComponent = feature.icon;
            return (
              <Grid item xs={12} sm={6} md={4} key={feature.title}>
                <Paper className={classes.featureCard}>
                  <CardContent>
                    <div className={classes.featureHeader}>
                      <IconComponent className={classes.featureIcon} />
                      <div style={{ flex: 1 }}>
                        <div className={classes.featureTitle}>
                          {feature.title}
                        </div>
                      </div>
                    </div>
                    <p className={classes.featureDescription}>
                      {feature.description}
                    </p>
                    <div className={classes.statusBadge}>
                      <Chip
                        size="small"
                        label={
                          feature.status.charAt(0).toUpperCase() +
                          feature.status.slice(1)
                        }
                        className={getStatusChipClass(classes, feature.status)}
                      />
                    </div>
                  </CardContent>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </div>

      <Divider style={{ margin: '2rem 0' }} />

      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>What is GitOps?</h2>
        <Paper style={{ padding: '1.5rem', borderRadius: 8 }}>
          <Typography variant="body2" style={{ lineHeight: 1.7, color: '#4B5563' }}>
            GitOps is a set of practices that leverage Git as the single source of truth for
            declarative infrastructure and application configurations. Key principles include:
          </Typography>
          <ul style={{ marginTop: '1rem', color: '#4B5563' }}>
            <li>
              <strong>Declarative:</strong> Describe your entire infrastructure and application
              configuration in Git repositories
            </li>
            <li>
              <strong>Versioned:</strong> All changes are tracked with full audit history and
              version control
            </li>
            <li>
              <strong>Automated:</strong> Automated deployment and reconciliation between Git state
              and cluster state
            </li>
            <li>
              <strong>Pullback:</strong> Systems continuously synchronize cluster state to match
              Git configurations
            </li>
          </ul>
        </Paper>
      </div>

      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>ArgoCD in CloudHub</h2>
        <Paper style={{ padding: '1.5rem', borderRadius: 8 }}>
          <Typography variant="body2" style={{ lineHeight: 1.7, color: '#4B5563' }}>
            ArgoCD is a declarative, GitOps continuous delivery tool for Kubernetes.
            The CloudHub GitOps integration will provide:
          </Typography>
          <ul style={{ marginTop: '1rem', color: '#4B5563' }}>
            <li>Native ArgoCD application management and monitoring</li>
            <li>Git repository synchronization with drift detection</li>
            <li>Multi-cluster and multi-environment deployment coordination</li>
            <li>Audit trails and compliance tracking for all deployments</li>
            <li>Role-based access control for deployment pipelines</li>
          </ul>
        </Paper>
      </div>

      <div style={{ textAlign: 'center', marginTop: '3rem', paddingBottom: '2rem' }}>
        <Typography variant="body2" color="textSecondary">
          GitOps features are planned for a future release. Check back soon for updates.
        </Typography>
      </div>
    </div>
  );
};
