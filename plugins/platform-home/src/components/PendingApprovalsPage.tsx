import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ClockIcon from '@mui/icons-material/Schedule';
import { readJsonOrThrow, useBackendFetch } from '@internal/plugin-platform-common';
import type { PortalDeploymentApprovalRecord } from './deploymentPortalTypes';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3, 4),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
  },
  header: {
    marginBottom: theme.spacing(3),
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 700,
    marginBottom: theme.spacing(1),
  },
  subtitle: {
    color: theme.palette.text.secondary,
    fontSize: '0.95rem',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(3),
  },
  statCard: {
    padding: theme.spacing(2),
    borderRadius: 8,
    border: `1px solid ${theme.palette.divider}`,
    textAlign: 'center',
  },
  statNumber: {
    fontSize: '2rem',
    fontWeight: 700,
    color: theme.palette.primary.main,
    marginBottom: theme.spacing(0.5),
  },
  statLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.85rem',
  },
  tableContainer: {
    borderRadius: 8,
    boxShadow: theme.shadows[1],
  },
  emptyState: {
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  statusChip: {
    fontWeight: 600,
  },
  actionCell: {
    display: 'flex',
    gap: theme.spacing(1),
  },
  approveBtn: {
    backgroundColor: '#10b981',
    color: '#fff',
    '&:hover': {
      backgroundColor: '#059669',
    },
  },
  rejectBtn: {
    backgroundColor: '#ef4444',
    color: '#fff',
    '&:hover': {
      backgroundColor: '#dc2626',
    },
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 400,
  },
  dialogTitle: {
    fontWeight: 700,
    marginBottom: theme.spacing(1),
  },
}));

interface PendingDeployment {
  id: string;
  application: string;
  instanceName: string;
  customer: string;
  environment: string;
  cluster: string;
  chartVersion: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PENDING';
}

export function PendingApprovalsPage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();

  const [deployments, setDeployments] = useState<PendingDeployment[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<PortalDeploymentApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<{
    open: boolean;
    deploymentId: string | null;
    action: 'approve' | 'reject';
    note: string;
  }>({
    open: false,
    deploymentId: null,
    action: 'approve',
    note: '',
  });
  const [deciding, setDeciding] = useState(false);

  const loadDeployments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendFetch(
        'deployment-control-plane',
        '/deployments/approvals?status=PENDING',
      );
      if (!res.ok) {
        throw new Error(`Failed to load deployments (${res.status})`);
      }
      const body = await res.json();
      setDeployments((body?.approvals ?? []) as PendingDeployment[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [backendFetch]);

  const loadApprovalHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await backendFetch('deployment-control-plane', '/deployments/approvals');
      if (!res.ok) {
        throw new Error(`Failed to load approval history (${res.status})`);
      }
      const body = await res.json();
      const approvals = Array.isArray(body?.approvals) ? body.approvals : [];
      setApprovalHistory(
        approvals.filter(
          (approval: PortalDeploymentApprovalRecord) => approval.status !== 'PENDING',
        ),
      );
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingHistory(false);
    }
  }, [backendFetch]);

  useEffect(() => {
    void loadDeployments();
    void loadApprovalHistory();

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      void loadDeployments();
      void loadApprovalHistory();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadDeployments, loadApprovalHistory]);

  const handleApproveClick = (deploymentId: string) => {
    setDecisionDialog({
      open: true,
      deploymentId,
      action: 'approve',
      note: '',
    });
  };

  const handleRejectClick = (deploymentId: string) => {
    setDecisionDialog({
      open: true,
      deploymentId,
      action: 'reject',
      note: '',
    });
  };

  const handleDecisionSubmit = async () => {
    if (!decisionDialog.deploymentId) return;

    setDeciding(true);
    try {
      const endpoint =
        decisionDialog.action === 'approve'
          ? `/deployments/approvals/${decisionDialog.deploymentId}/approve`
          : `/deployments/approvals/${decisionDialog.deploymentId}/reject`;

      const res = await backendFetch('deployment-control-plane', endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: decisionDialog.note,
        }),
      });

      await readJsonOrThrow(
        res,
        `${decisionDialog.action === 'approve' ? 'Approval' : 'Rejection'} failed`,
      );

      // Reload deployments
      await loadDeployments();
      setDecisionDialog({ open: false, deploymentId: null, action: 'approve', note: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeciding(false);
    }
  };

  const stats = useMemo(
    () => ({
      total: deployments.length,
      oldestMinutes: deployments.length
        ? Math.floor(
            (Date.now() - new Date(deployments[0]?.requestedAt).getTime()) / 60000,
          )
        : 0,
    }),
    [deployments],
  );

  return (
    <Box className={classes.root}>
      <div className={classes.header}>
        <Typography className={classes.title}>
          🔏 Pending Deployment Approvals
        </Typography>
        <Typography className={classes.subtitle}>
          Review and approve platform deployments pending your decision
        </Typography>
      </div>

      <div className={classes.statsGrid}>
        <Paper className={classes.statCard}>
          <div className={classes.statNumber}>{stats.total}</div>
          <div className={classes.statLabel}>Pending Approvals</div>
        </Paper>
        <Paper className={classes.statCard}>
          <ClockIcon style={{ fontSize: 32, color: '#f59e0b', marginBottom: 8 }} />
          <div className={classes.statLabel}>
            {stats.oldestMinutes > 0
              ? `Oldest: ${stats.oldestMinutes}m ago`
              : 'No pending approvals'}
          </div>
        </Paper>
      </div>

      {loading && (
        <div className={classes.loadingContainer}>
          <CircularProgress />
        </div>
      )}
      {error && !loading && (
        <Card>
          <CardContent>
            <Typography color="error">Error loading deployments: {error}</Typography>
          </CardContent>
        </Card>
      )}
      {!loading && !error && deployments.length === 0 && (
        <Paper className={classes.emptyState}>
          <CheckCircleIcon style={{ fontSize: 48, color: '#10b981', marginBottom: 16 }} />
          <Typography variant="h6">No Pending Approvals</Typography>
          <Typography variant="body2">All deployments are up to date. Great work! ✨</Typography>
        </Paper>
      )}
      {!loading && !error && deployments.length > 0 && (
        <TableContainer className={classes.tableContainer}>
          <Table>
            <TableHead>
              <TableRow style={{ backgroundColor: '#f8fafc' }}>
                <TableCell>
                  <strong>Application</strong>
                </TableCell>
                <TableCell>
                  <strong>Environment</strong>
                </TableCell>
                <TableCell>
                  <strong>Cluster</strong>
                </TableCell>
                <TableCell>
                  <strong>Requested By</strong>
                </TableCell>
                <TableCell>
                  <strong>Requested</strong>
                </TableCell>
                <TableCell>
                  <strong>Chart Version</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>Actions</strong>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {deployments.map(deployment => (
                <TableRow key={deployment.id} hover>
                  <TableCell>
                    <strong>{deployment.application}</strong>
                    <Typography variant="caption" display="block" color="textSecondary">
                      {deployment.instanceName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={deployment.environment} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <code style={{ fontSize: '0.85rem', color: '#666' }}>
                      {deployment.cluster.split('-').slice(-3).join('-')}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{deployment.requestedBy}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {new Date(deployment.requestedAt).toLocaleDateString()}
                    </Typography>
                    <Typography variant="caption" display="block" color="textSecondary">
                      {new Date(deployment.requestedAt).toLocaleTimeString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <code style={{ fontSize: '0.85rem' }}>{deployment.chartVersion}</code>
                  </TableCell>
                  <TableCell align="right">
                    <div className={classes.actionCell}>
                      <Button
                        size="small"
                        variant="contained"
                        className={classes.approveBtn}
                        startIcon={<CheckCircleIcon />}
                        onClick={() => handleApproveClick(deployment.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        className={classes.rejectBtn}
                        startIcon={<CancelIcon />}
                        onClick={() => handleRejectClick(deployment.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box mt={4}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          Approval history
        </Typography>

        {historyError && !loadingHistory && (
          <Card>
            <CardContent>
              <Typography color="error">Error loading approval history: {historyError}</Typography>
            </CardContent>
          </Card>
        )}

        {loadingHistory ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : !historyError && approvalHistory.length === 0 ? (
          <Paper sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            No approval history yet.
          </Paper>
        ) : (
          <TableContainer className={classes.tableContainer}>
            <Table>
              <TableHead>
                <TableRow style={{ backgroundColor: '#f8fafc' }}>
                  <TableCell><strong>Application</strong></TableCell>
                  <TableCell><strong>Environment</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell><strong>Requested By</strong></TableCell>
                  <TableCell><strong>Decision</strong></TableCell>
                  <TableCell><strong>Decided By</strong></TableCell>
                  <TableCell><strong>Decided At</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {approvalHistory.map(record => (
                  <TableRow key={record.id} hover>
                    <TableCell>
                      <strong>{record.application}</strong>
                      <Typography variant="caption" display="block" color="textSecondary">
                        {record.instanceName}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={record.environment} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={record.status}
                        color={record.status === 'APPROVED' ? 'success' : 'error'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{record.requestedBy}</TableCell>
                    <TableCell>{record.status}</TableCell>
                    <TableCell>{record.decidedBy ?? '—'}</TableCell>
                    <TableCell>
                      {record.decidedAt ? new Date(record.decidedAt).toLocaleString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Dialog
        open={decisionDialog.open}
        onClose={() => setDecisionDialog({ ...decisionDialog, open: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle className={classes.dialogTitle}>
          {decisionDialog.action === 'approve' && '✓ Approve Deployment'}
          {decisionDialog.action !== 'approve' && '✕ Reject Deployment'}
        </DialogTitle>
        <DialogContent>
          <Box mt={2}>
            <Typography variant="body2" color="textSecondary">
              {decisionDialog.action === 'approve'
                ? 'This deployment will proceed to the next stage upon approval.'
                : 'The deployment will be cancelled and the requester notified.'}
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Optional note"
              placeholder={
                decisionDialog.action === 'approve'
                  ? 'e.g., "Approved pending SRE review"'
                  : 'e.g., "Waiting for compliance review"' as string
              }
              variant="outlined"
              value={decisionDialog.note}
              onChange={e =>
                setDecisionDialog({ ...decisionDialog, note: e.target.value })
              }
              margin="normal"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDecisionDialog({ ...decisionDialog, open: false })}
            disabled={deciding}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDecisionSubmit}
            variant="contained"
            className={decisionDialog.action === 'approve' ? classes.approveBtn : classes.rejectBtn}
            disabled={deciding}
          >
            {deciding && 'Processing...'}
            {!deciding && decisionDialog.action === 'approve' && 'Approve'}
            {!deciding && decisionDialog.action !== 'approve' && 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default PendingApprovalsPage;
