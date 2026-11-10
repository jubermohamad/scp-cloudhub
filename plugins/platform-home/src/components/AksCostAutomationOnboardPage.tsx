import { useState } from 'react';
import { Typography, Grid, TextField, MenuItem, Button, Paper, CircularProgress, Breadcrumbs, Link as MuiLink, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';

// ─── Types ────────────────────────────────────────────────────────────────────

type ValidationItem = {
  label: string;
  status: 'pending' | 'ok' | 'fail';
  reason?: string;
};

type RbacAssignmentResult = {
  assigned: boolean;
  alreadyExisted: boolean;
  skipped: boolean;
  error: string | null;
};

type PageState = 'form' | 'activating' | 'success' | 'error';

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 960,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.between('lg', 'xl')]: { padding: theme.spacing(3) },
    [theme.breakpoints.up('xl')]: { padding: theme.spacing(5) },
  },
  breadcrumbs: {
    marginBottom: theme.spacing(2),
    fontSize: '0.85rem',
  },
  hero: {
    borderRadius: 14,
    padding: theme.spacing(3, 4),
    background: 'linear-gradient(135deg, #107c10 0%, #54b054 100%)',
    color: '#fff',
    marginBottom: theme.spacing(4),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  heroIcon: {
    fontSize: 40,
    opacity: 0.9,
  },
  heroTitle: {
    fontSize: '1.6rem',
    fontWeight: 600,
  },
  heroSubtitle: {
    fontSize: '0.9rem',
    opacity: 0.88,
    marginTop: theme.spacing(0.5),
  },
  section: {
    marginBottom: theme.spacing(3),
  },
  sectionPaper: {
    padding: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: '0.95rem',
    marginBottom: theme.spacing(2),
    color: theme.palette.text.primary,
  },
  validationRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  validationLabel: {
    fontSize: '0.875rem',
    color: theme.palette.text.secondary,
  },
  checkOk: {
    color: '#107c10',
    fontSize: 18,
  },
  checkFail: {
    color: theme.palette.error.main,
    fontSize: 18,
  },
  checkPending: {
    color: theme.palette.text.disabled,
    fontSize: 18,
  },
  ctaButton: {
    marginTop: theme.spacing(1),
    padding: theme.spacing(1.25, 4),
    borderRadius: 8,
    fontWeight: 600,
    fontSize: '0.95rem',
    background: 'linear-gradient(135deg, #107c10 0%, #54b054 100%)',
    color: '#fff',
    '&:hover': {
      background: 'linear-gradient(135deg, #0a5f0a 0%, #3d8f3d 100%)',
    },
    '&:disabled': {
      opacity: 0.5,
    },
  },
  successPanel: {
    padding: theme.spacing(4),
    borderRadius: 14,
    border: `2px solid #107c10`,
    textAlign: 'center',
  },
  successIcon: {
    fontSize: 64,
    color: '#107c10',
    marginBottom: theme.spacing(2),
  },
  successTitle: {
    fontWeight: 700,
    fontSize: '1.3rem',
    color: '#107c10',
    marginBottom: theme.spacing(1),
  },
  successBody: {
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(3),
  },
  errorPanel: {
    padding: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.error.main}`,
    backgroundColor: `${theme.palette.error.light}22`,
    marginTop: theme.spacing(2),
  },
  rbacInfoBox: {
    padding: theme.spacing(2, 2.5),
    borderRadius: 10,
    background: '#EFF6FF',
    border: '1px solid #BFDBFE',
    marginBottom: theme.spacing(1.5),
  },
  rbacResultBox: {
    marginTop: theme.spacing(2.5),
    padding: theme.spacing(2),
    borderRadius: 10,
    border: `1px solid ${theme.palette.divider}`,
    textAlign: 'left' as const,
  },
}));

const INITIAL_VALIDATION_ITEMS: ValidationItem[] = [
  { label: 'Cluster exists', status: 'pending' },
  { label: 'Environment allowed (Dev / QA only)', status: 'pending' },
  { label: 'System node pool found', status: 'pending' },
  { label: 'User node pool found', status: 'pending' },
  { label: 'System node pool lifecycle eligible', status: 'pending' },
  { label: 'AKS auth mode supported', status: 'pending' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRbacMessage(rbacAssignment: RbacAssignmentResult): string {
  if (rbacAssignment.alreadyExisted) {
    return 'Azure Kubernetes Service Cluster User Role was already assigned — no change needed.';
  }
  return 'Azure Kubernetes Service Cluster User Role granted to the backend service principal. Pod/node map fetch is now enabled.';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AksCostAutomationOnboardPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  // Form state
  const [clusterName, setClusterName] = useState('');
  const [resourceGroup, setResourceGroup] = useState('');
  const [environment, setEnvironment] = useState<'dev' | 'qa' | ''>('');

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationDone, setValidationDone] = useState(false);
  const [validationItems, setValidationItems] = useState<ValidationItem[]>(
    INITIAL_VALIDATION_ITEMS,
  );

  // Submission state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pageState, setPageState] = useState<PageState>('form');
  const [errorMessage, setErrorMessage] = useState('');
  const [activatedCluster, setActivatedCluster] = useState('');
  const [rbacAssignment, setRbacAssignment] =
    useState<RbacAssignmentResult | null>(null);

  // ─── Validation ─────────────────────────────────────────────────────────────

  const handleValidate = async () => {
    if (!clusterName.trim() || !environment) return;

    setPageState('form');
    setErrorMessage('');
    setValidating(true);
    setValidationDone(false);
    setValidationItems(INITIAL_VALIDATION_ITEMS);

    try {
      const params = new URLSearchParams({
        clusterName: clusterName.trim(),
        environment,
        ...(resourceGroup.trim() && { resourceGroup: resourceGroup.trim() }),
      });
      const res = await backendFetch(
        'cost-automation',
        `/azure/aks/validate?${params}`,
      );

      if (res.ok) {
        const data: {
          checks: { label: string; passed: boolean; reason?: string }[];
        } = await res.json();
        setValidationItems(
          data.checks.map(c => ({
            label: c.label,
            status: c.passed ? 'ok' : 'fail',
            reason: c.reason,
          })),
        );
        setValidationDone(true);
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setErrorMessage(
          body.message || body.error || `Validation failed (HTTP ${res.status}).`,
        );
        setPageState('error');
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to contact the validation service.',
      );
      setPageState('error');
    } finally {
      setValidating(false);
    }
  };

  // ─── Submission ─────────────────────────────────────────────────────────────

  const hasBlockingValidationFailure =
    validationDone &&
    validationItems.some(
      v => v.status === 'fail' && v.label !== 'User node pool found',
    );

  const canActivate = validationDone && !hasBlockingValidationFailure;

  const handleActivate = async () => {
    setPageState('activating');
    setErrorMessage('');

    try {
      const res = await backendFetch('cost-automation', '/azure/aks/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterName: clusterName.trim(),
          environment,
          ...(resourceGroup.trim() && { resourceGroup: resourceGroup.trim() }),
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setActivatedCluster(clusterName);
        setRbacAssignment(
          (data as { rbacAssignment?: RbacAssignmentResult }).rbacAssignment ??
            null,
        );
        setPageState('success');
      } else {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(
          (body as { message?: string }).message ||
            `Server returned ${res.status}`,
        );
        setPageState('error');
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Network error — please retry.',
      );
      setPageState('error');
    }
  };

  // ─── Success panel ───────────────────────────────────────────────────────────

  if (pageState === 'success') {
    return (
      <div className={classes.root}>
        <Paper className={classes.successPanel} elevation={0}>
          <CheckCircleIcon className={classes.successIcon} />
          <Typography className={classes.successTitle}>
            AKS Cost Savings Activated
          </Typography>
          <Typography className={classes.successBody}>
            Cluster <strong>{activatedCluster}</strong> is now managed by the
            Cost Automation Engine. Automated start/stop scheduling will be
            configured in the next step.
          </Typography>

          {/* RBAC assignment result */}
          {rbacAssignment && (
            <div className={classes.rbacResultBox}>
              <Typography
                variant="subtitle2"
                style={{ fontWeight: 600, marginBottom: 8 }}
              >
                RBAC Assignment
              </Typography>
              <div
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
              >
                {/* eslint-disable-next-line no-nested-ternary */}
                {rbacAssignment.skipped ? (
                  <>
                    <CheckCircleIcon
                      style={{
                        color: '#999',
                        fontSize: 18,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <Typography variant="body2" color="textSecondary">
                      Skipped — <code>AZURE_OBJECT_ID</code> is not configured
                      on the backend. Assign the role manually or set the env
                      var and re-onboard.
                    </Typography>
                  </>
                ) : rbacAssignment.assigned ? (
                  <>
                    <CheckCircleIcon
                      style={{
                        color: '#107c10',
                        fontSize: 18,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <Typography variant="body2" style={{ color: '#107c10' }}>
                      {getRbacMessage(rbacAssignment)}
                    </Typography>
                  </>
                ) : (
                  <>
                    <CancelIcon
                      style={{
                        color: '#c62828',
                        fontSize: 18,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <Typography variant="body2" color="error">
                      RBAC assignment failed: {rbacAssignment.error}. The
                      cluster is onboarded but pod/node map fetch may not work
                      until the role is granted manually.
                    </Typography>
                  </>
                )}
              </div>
            </div>
          )}
          <Grid container spacing={2} justifyContent="center">
            <Grid item>
              <Button
                variant="outlined"
                color="primary"
                onClick={() =>
                  navigate(
                    '/cost-optimization/azure/aks-cost-automation/managed',
                  )
                }
              >
                View Managed Clusters
              </Button>
            </Grid>
            <Grid item>
              <Button
                variant="contained"
                color="primary"
                disabled
                title="Coming soon — Phase 2"
              >
                Configure Schedules
              </Button>
            </Grid>
          </Grid>
        </Paper>
      </div>
    );
  }

  // ─── Main form ───────────────────────────────────────────────────────────────

  return (
    <div className={classes.root}>
      {/* Breadcrumb */}
      <Breadcrumbs className={classes.breadcrumbs}>
        <MuiLink component={RouterLink} to="/">
          Platform Home
        </MuiLink>
        <MuiLink component={RouterLink} to="/cost-optimization">
          Cost Optimization
        </MuiLink>
        <MuiLink component={RouterLink} to="/cost-optimization/azure">
          Azure
        </MuiLink>
        <Typography color="textPrimary">
          AKS Cost Automation – Onboard
        </Typography>
      </Breadcrumbs>

      {/* Hero */}
      <div className={classes.hero}>
        <TrendingDownIcon className={classes.heroIcon} />
        <div>
          <Typography className={classes.heroTitle}>
            AKS Cost Automation – Onboarding
          </Typography>
          <Typography className={classes.heroSubtitle}>
            Onboard a non-production cluster to automated start/stop and node
            downsizing. Dev &amp; QA clusters only.
          </Typography>
        </div>
      </div>

      {/* Section 1 – Cluster Details */}
      <div className={classes.section}>
        <Paper className={classes.sectionPaper} elevation={0}>
          <Typography className={classes.sectionTitle}>
            1 — Cluster Details
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={8}>
              <TextField
                label="AKS Cluster Name"
                placeholder="e.g. aks-cloudhub-dev-itn-freetier-visaedb-app"
                value={clusterName}
                onChange={e => {
                  setClusterName(e.target.value);
                  setValidationDone(false);
                  setPageState('form');
                  setErrorMessage('');
                }}
                fullWidth
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Environment"
                value={environment}
                onChange={e => {
                  setEnvironment(e.target.value as 'dev' | 'qa');
                  setValidationDone(false);
                  setPageState('form');
                  setErrorMessage('');
                }}
                select
                fullWidth
                variant="outlined"
                size="small"
              >
                <MenuItem value="dev">Dev</MenuItem>
                <MenuItem value="qa">QA</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Resource Group"
                placeholder="e.g. rg-aks-dev-westeurope"
                value={resourceGroup}
                onChange={e => {
                  setResourceGroup(e.target.value);
                  setValidationDone(false);
                  setPageState('form');
                  setErrorMessage('');
                }}
                fullWidth
                variant="outlined"
                size="small"
                helperText="Optional — auto-detected from subscription if left blank."
              />
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="outlined"
                color="primary"
                onClick={handleValidate}
                disabled={!clusterName.trim() || !environment || validating}
                startIcon={
                  validating ? <CircularProgress size={16} /> : undefined
                }
              >
                {validating ? 'Validating…' : 'Validate Cluster'}
              </Button>
            </Grid>
          </Grid>
        </Paper>
      </div>

      {/* Section 2 – Validation Status */}
      <div className={classes.section}>
        <Paper className={classes.sectionPaper} elevation={0}>
          <Typography className={classes.sectionTitle}>
            2 — Validation Status
          </Typography>
          {validationItems.map(item => (
            <div className={classes.validationRow} key={item.label}>
              {item.status === 'ok' && (
                <CheckCircleIcon className={classes.checkOk} />
              )}
              {item.status === 'fail' && (
                <CancelIcon className={classes.checkFail} />
              )}
              {item.status === 'pending' && (
                <CheckCircleIcon className={classes.checkPending} />
              )}
              <div>
                <Typography className={classes.validationLabel}>
                  {item.label}
                </Typography>
                {item.status === 'fail' && item.reason && (
                  <Typography
                    variant="caption"
                    style={{ color: '#c62828', display: 'block', marginTop: 1 }}
                  >
                    {item.reason}
                  </Typography>
                )}
              </div>
            </div>
          ))}
          {!validationDone && (
            <Typography
              variant="caption"
              color="textSecondary"
              style={{ marginTop: 8, display: 'block' }}
            >
              Fill in cluster details above and click Validate Cluster.
            </Typography>
          )}
        </Paper>
      </div>

      {/* Section 3 – RBAC Setup */}
      {canActivate && (
        <div className={classes.section}>
          <Paper className={classes.sectionPaper} elevation={0}>
            <Typography className={classes.sectionTitle}>
              3 — RBAC Setup
            </Typography>
            <div className={classes.rbacInfoBox}>
              <Typography
                variant="body2"
                style={{ fontWeight: 600, marginBottom: 4 }}
              >
                What happens during activation
              </Typography>
              <Typography variant="body2" color="textSecondary">
                The platform will assign the{' '}
                <strong>Azure Kubernetes Service Cluster User Role</strong> to
                the backend service principal on this cluster. This is required
                for pod/node map retrieval (Load Node Map). The assignment is
                idempotent — if already granted, it is left unchanged.
              </Typography>
            </div>
            <div className={classes.validationRow} style={{ marginBottom: 0 }}>
              <CheckCircleIcon className={classes.checkPending} />
              <Typography className={classes.validationLabel}>
                Azure Kubernetes Service Cluster User Role → Backend SP (will
                apply on activation)
              </Typography>
            </div>
          </Paper>
        </div>
      )}

      {/* Error banner */}
      {pageState === 'error' && (
        <div className={classes.errorPanel}>
          <Typography variant="body2" color="error">
            <strong>Unable to continue:</strong> {errorMessage}
          </Typography>
          <Button
            size="small"
            color="primary"
            onClick={() => setPageState('form')}
            style={{ marginTop: 8 }}
          >
            Try again
          </Button>
        </div>
      )}

      {/* CTA */}
      <Button
        className={classes.ctaButton}
        variant="contained"
        onClick={() => setConfirmOpen(true)}
        disabled={!canActivate || pageState === 'activating'}
        startIcon={
          pageState === 'activating' ? (
            <CircularProgress size={18} style={{ color: '#fff' }} />
          ) : undefined
        }
      >
        {pageState === 'activating' ? 'Activating…' : 'Activate Cost Savings'}
      </Button>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Onboarding</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Onboard <strong>{clusterName.trim()}</strong> (
            {environment.toUpperCase()}) to AKS Cost Automation?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmOpen(false)}
            disabled={pageState === 'activating'}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            variant="contained"
            onClick={async () => {
              setConfirmOpen(false);
              await handleActivate();
            }}
            disabled={pageState === 'activating'}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
