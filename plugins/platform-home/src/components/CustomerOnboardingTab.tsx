/**
 * CustomerOnboardingTab – legacy onboarding guidance retained only for
 * reference during transition. The route remains intentionally disabled.
 */

import { makeStyles } from '@mui/styles';
import { Button, Chip, Grid, Paper, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';

// ─── What this stage covers ───────────────────────────────────────────────────

const STEPS = [
  {
    label: 'Register Customer Identity',
    detail: 'Customer code, name, business unit, contacts and SSO domain.',
  },
  {
    label: 'Provision Namespace',
    detail:
      'Create dedicated namespace with RBAC, quotas, and network policies.',
  },
  {
    label: 'Configure Environments',
    detail: 'Define dev, UAT, and production environment parameters.',
  },
  {
    label: 'Activate in Platform Registry',
    detail:
      'Register the customer in the CloudHub tenant registry and validate all modules.',
  },
];

const OUTPUTS = [
  'Customer record in Tenant Registry',
  'Namespace with RBAC + quotas',
  'Environment configuration',
  'SSO integration validated',
  'Ready for AKS provisioning (S2)',
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#7C3AED';
const GRADIENT = 'linear-gradient(135deg, #6B21A8 0%, #A855F7 100%)';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3, 4),
    maxWidth: 1200,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2) },
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
  heroTitle: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2 },
  heroSub: { fontSize: '0.875rem', opacity: 0.85, lineHeight: 1.5 },
  launchBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.8rem',
    textTransform: 'none',
    flexShrink: 0,
    background: 'rgba(255,255,255,0.92)',
    color: ACCENT,
    '&:hover': { background: '#FFFFFF' },
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: theme.spacing(1.5),
    marginTop: theme.spacing(3),
  },
  stepCard: {
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    padding: theme.spacing(1.5, 2),
    background: '#FFFFFF',
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#EDE9FE',
    color: ACCENT,
    fontSize: '0.8rem',
    fontWeight: 800,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  stepLabel: { fontWeight: 700, fontSize: '0.9rem', color: '#111827' },
  stepDetail: { fontSize: '0.8125rem', color: '#6B7280', marginTop: 2 },
  outputsPanel: {
    border: `1px solid ${ACCENT}22`,
    borderRadius: 10,
    background: '#FAF5FF',
    padding: theme.spacing(2, 2.5),
  },
  outputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.75),
    '&:last-child': { marginBottom: 0 },
  },
}));

// ─── Component ────────────────────────────────────────────────────────────────

export function CustomerOnboardingTab() {
  const classes = useStyles();
  const navigate = useNavigate();

  return (
    <div className={classes.root}>
      {/* Hero */}
      <div className={classes.heroBanner}>
        <div className={classes.heroBannerRow}>
          <Typography className={classes.heroTitle}>
            Onboard a Customer
          </Typography>
          <Button
            variant="contained"
            size="small"
            className={classes.launchBtn}
            endIcon={<ArrowForwardIcon />}
            onClick={() => navigate('/deployment?stage=customer-overlay')}
          >
            View Deployment Flow
          </Button>
        </div>
        <Typography className={classes.heroSub}>
          Register customer identity, and activate the customer in the CloudHub
          platform registry before AKS provisioning.
        </Typography>
      </div>

      <Grid container spacing={2}>
        {/* Steps */}
        <Grid item xs={12} md={8}>
          <Typography className={classes.sectionTitle}>
            What this stage covers
          </Typography>
          <Grid container spacing={1.5 as any}>
            {STEPS.map((step, i) => (
              <Grid item xs={12} sm={6} key={step.label}>
                <div className={classes.stepCard}>
                  <span className={classes.stepNum}>{i + 1}</span>
                  <div>
                    <Typography className={classes.stepLabel}>
                      {step.label}
                    </Typography>
                    <Typography className={classes.stepDetail}>
                      {step.detail}
                    </Typography>
                  </div>
                </div>
              </Grid>
            ))}
          </Grid>
        </Grid>

        {/* Outputs */}
        <Grid item xs={12} md={4}>
          <Typography className={classes.sectionTitle}>
            Stage outputs
          </Typography>
          <Paper elevation={0} className={classes.outputsPanel}>
            {OUTPUTS.map(o => (
              <div key={o} className={classes.outputRow}>
                <CheckCircleIcon
                  style={{ fontSize: 16, color: ACCENT, flexShrink: 0 }}
                />
                <Typography
                  style={{
                    fontSize: '0.8125rem',
                    color: '#374151',
                    fontWeight: 600,
                  }}
                >
                  {o}
                </Typography>
              </div>
            ))}
            <Chip
              size="small"
              label="Prerequisite for S2"
              style={{
                marginTop: 12,
                background: '#EDE9FE',
                color: '#5B21B6',
                fontWeight: 700,
              }}
            />
          </Paper>
        </Grid>
      </Grid>
    </div>
  );
}
