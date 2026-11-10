/**
 * DeploymentHistory — audit trail + live status for portal deployments.
 *
 * Lists deployments created through the wizard and polls active ones every 15s
 * (syncing each non-terminal deployment against its GitHub Actions run). Exposes
 * per-row workflow logs and retry for failed deployments.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Typography, Box, Paper, Button, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Chip, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip, Link } from '@mui/material';
import { makeStyles } from '@mui/styles';

import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import DescriptionIcon from '@mui/icons-material/Description';
import ErrorIcon from '@mui/icons-material/Error';
import { useBackendFetch } from '@internal/plugin-platform-common';
import {
  isTerminalStatus,
  readJson,
  statusStyle,
  type PortalDeploymentApprovalRecord,
  type PortalDeploymentRecord,
} from './deploymentPortalTypes';

const POLL_INTERVAL_MS = 15000;
const HISTORY_RETRY_BASE_DELAY_MS = 5000;
const HISTORY_RETRY_MAX_DELAY_MS = 30000;
const HISTORY_RETRY_LIMIT = 6;

const RETRYABLE_HISTORY_STATUSES = new Set([401, 404, 408, 429, 500, 502, 503, 504]);

interface DeploymentHistoryProps {
  refreshSignal?: number;
}

const useStyles = makeStyles(theme => ({
  root: {
    marginTop: theme.spacing(3),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1.5),
  },
  title: {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: theme.palette.text.primary,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  autoBadge: {
    fontSize: '0.7rem',
    color: theme.palette.text.secondary,
  },
  tablePaper: {
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    backgroundColor: '#F3F4F6',
  },
  sectionTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(1),
  },
  headerCell: {
    fontWeight: 700,
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: '#6B7280',
  },
  statusChip: {
    fontWeight: 700,
    fontSize: '0.7rem',
    height: 22,
  },
  approvalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  emptyState: {
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  mono: {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.78rem',
  },
  errorBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    marginBottom: theme.spacing(1.5),
  },
  errorText: { color: '#DC2626', fontSize: '0.85rem' },
  logsBlock: {
    margin: 0,
    padding: theme.spacing(1.5),
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    fontSize: '0.72rem',
    lineHeight: 1.5,
    maxHeight: 420,
    minWidth: 560,
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre-wrap',
  },
}));

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function DeploymentHistory({
  refreshSignal,
}: DeploymentHistoryProps): JSX.Element {
  const classes = useStyles();
  const backendFetch = useBackendFetch();

  const [deployments, setDeployments] = useState<PortalDeploymentRecord[]>([]);
  const [approvals, setApprovals] = useState<PortalDeploymentApprovalRecord[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<PortalDeploymentApprovalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [loadingApprovalHistory, setLoadingApprovalHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [canApprove, setCanApprove] = useState(false);

  const [logsFor, setLogsFor] = useState<PortalDeploymentRecord | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const retryTimerRef = useRef<number | undefined>(undefined);
  const retryAttemptRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== undefined) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
  }, []);

  const queueRetry = useCallback(() => {
    if (retryAttemptRef.current >= HISTORY_RETRY_LIMIT) {
      setError('Deployment history is still unavailable. Please refresh the page.');
      setNotice(null);
      return;
    }

    clearRetryTimer();
    const delay = Math.min(
      HISTORY_RETRY_BASE_DELAY_MS * 2 ** retryAttemptRef.current,
      HISTORY_RETRY_MAX_DELAY_MS,
    );
    retryAttemptRef.current += 1;
    retryTimerRef.current = window.setTimeout(() => {
      void refreshRef.current();
    }, delay);
    setNotice('Deployment history is temporarily unavailable after a redeploy. Retrying...');
  }, [clearRetryTimer]);

  const fetchList = useCallback(async () => {
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        '/deployments',
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        const message = data?.error ?? 'Failed to load deployments';
        if (RETRYABLE_HISTORY_STATUSES.has(resp.status)) {
          setError(null);
          queueRetry();
          return;
        }
        throw new Error(message);
      }
      setDeployments(Array.isArray(data.deployments) ? data.deployments : []);
      setError(null);
      setNotice(null);
      retryAttemptRef.current = 0;
      clearRetryTimer();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load deployments';
      setError(message);
      setNotice(null);
    }
  }, [backendFetch, clearRetryTimer, queueRetry]);

  const fetchApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        '/deployments/approvals?status=PENDING',
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Failed to load approvals');
      }
      setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      setCanApprove(Boolean(data.canApprove));
      setApprovalError(null);
    } catch (err) {
      setApprovals([]);
      setCanApprove(false);
      setApprovalError(
        err instanceof Error ? err.message : 'Failed to load approvals',
      );
    } finally {
      setLoadingApprovals(false);
    }
  }, [backendFetch]);

  const fetchApprovalHistory = useCallback(async () => {
    setLoadingApprovalHistory(true);
    try {
      const resp = await backendFetch('deployment-control-plane', '/deployments/approvals');
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Failed to load approval history');
      }
      setApprovalHistory(Array.isArray(data.approvals) ? data.approvals : []);
      setApprovalError(null);
    } catch (err) {
      setApprovalHistory([]);
      setApprovalError(
        err instanceof Error ? err.message : 'Failed to load approval history',
      );
    } finally {
      setLoadingApprovalHistory(false);
    }
  }, [backendFetch]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchList(), fetchApprovals(), fetchApprovalHistory()]);
    setLoading(false);
  }, [fetchApprovalHistory, fetchApprovals, fetchList]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    void refresh();
    return () => {
      clearRetryTimer();
    };
  }, [clearRetryTimer, refresh, refreshSignal]);

  // Poll: sync each active deployment's status, then refresh the list.
  const pollRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const active = deployments.filter(d => !isTerminalStatus(d.status));
    if (pollRef.current !== undefined) {
      window.clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    if (active.length === 0) {
      return undefined;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        await Promise.all(
          active.map(d =>
            backendFetch(
              'deployment-control-plane',
              `/deployments/${d.id}/status`,
            ).catch(() => undefined),
          ),
        );
        await fetchList();
      } catch {
        // transient — next tick retries
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== undefined) {
        window.clearInterval(pollRef.current);
        pollRef.current = undefined;
      }
    };
  }, [deployments, backendFetch, fetchList]);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${id}/retry`,
        { method: 'POST' },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Retry failed');
      }
      await fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const handleApprovalDecision = async (
    id: string,
    decision: 'approve' | 'reject',
  ) => {
    setApprovalBusyId(id);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/deployments/approvals/${id}/${decision}`,
        { method: 'POST' },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? `${decision} failed`);
      }
      await refresh();
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : `${decision} failed`);
    } finally {
      setApprovalBusyId(null);
    }
  };

  const openLogs = async (record: PortalDeploymentRecord) => {
    setLogsFor(record);
    setLogLines([]);
    if (!record.workflowRunId) return;
    setLoadingLogs(true);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/pipelines/runs/${record.workflowRunId}/logs`,
      );
      const data = await readJson(resp);
      setLogLines(Array.isArray(data.lines) ? data.lines : []);
    } catch {
      setLogLines(['Failed to load logs.']);
    } finally {
      setLoadingLogs(false);
    }
  };

  const hasActive = deployments.some(d => !isTerminalStatus(d.status));
  const hasPendingApprovals = approvals.length > 0;
  const historicalApprovals = approvalHistory.filter(
    record => record.status !== 'PENDING',
  );

  const renderLogsBody = () => {
    if (loadingLogs) {
      return (
        <Box
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: 24,
          }}
        >
          <CircularProgress size={22} />
          <Typography variant="body2">Loading logs…</Typography>
        </Box>
      );
    }
    if (logsFor && !logsFor.workflowRunId) {
      return (
        <Typography variant="body2" color="textSecondary">
          No workflow run is associated with this deployment yet.
        </Typography>
      );
    }
    return <pre className={classes.logsBlock}>{logLines.join('\n')}</pre>;
  };

  const renderApprovals = () => (
    <Box style={{ marginBottom: 24 }}>
      <Typography className={classes.sectionTitle}>Pending approvals</Typography>
      <Paper elevation={0} className={classes.tablePaper}>
        <Table size="small">
          <TableHead>
            <TableRow className={classes.tableHeaderRow}>
              <TableCell className={classes.headerCell}>Deployment ID</TableCell>
              <TableCell className={classes.headerCell}>Application</TableCell>
              <TableCell className={classes.headerCell}>Environment</TableCell>
              <TableCell className={classes.headerCell}>Cluster</TableCell>
              <TableCell className={classes.headerCell}>Requested By</TableCell>
              <TableCell className={classes.headerCell}>Requested</TableCell>
              <TableCell className={classes.headerCell}>Status</TableCell>
              <TableCell className={classes.headerCell} align="right">
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loadingApprovals && approvals.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className={classes.emptyState}>
                  Loading approvals…
                </TableCell>
              </TableRow>
            )}
            {!loadingApprovals && approvals.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className={classes.emptyState}>
                  No pending approvals.
                </TableCell>
              </TableRow>
            )}
            {approvals.map(record => (
              <TableRow key={record.id}>
                <TableCell className={classes.mono}>{record.deploymentId ?? '—'}</TableCell>
                <TableCell>
                  <Typography variant="body2" style={{ fontWeight: 600 }}>
                    {record.application}
                  </Typography>
                  <Typography variant="caption" color="textSecondary" className={classes.mono}>
                    {record.instanceName}
                  </Typography>
                </TableCell>
                <TableCell>{record.environment}</TableCell>
                <TableCell className={classes.mono}>{record.cluster}</TableCell>
                <TableCell className={classes.mono}>{record.requestedBy}</TableCell>
                <TableCell>{formatTime(record.requestedAt)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    className={classes.statusChip}
                    label={record.status}
                    style={{ backgroundColor: '#FEF3C7', color: '#B45309' }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Box className={classes.approvalActions}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!canApprove || approvalBusyId === record.id}
                      onClick={() => void handleApprovalDecision(record.id, 'reject')}
                    >
                      Reject
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="primary"
                      disabled={!canApprove || approvalBusyId === record.id}
                      onClick={() => void handleApprovalDecision(record.id, 'approve')}
                    >
                      {approvalBusyId === record.id ? 'Working…' : 'Approve'}
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );

  const renderApprovalHistory = () => (
    <Box style={{ marginBottom: 24 }}>
      <Typography className={classes.sectionTitle}>Approval history</Typography>
      <Paper elevation={0} className={classes.tablePaper}>
        <Table size="small">
          <TableHead>
            <TableRow className={classes.tableHeaderRow}>
              <TableCell className={classes.headerCell}>Deployment ID</TableCell>
              <TableCell className={classes.headerCell}>Application</TableCell>
              <TableCell className={classes.headerCell}>Environment</TableCell>
              <TableCell className={classes.headerCell}>Requested By</TableCell>
              <TableCell className={classes.headerCell}>Requested</TableCell>
              <TableCell className={classes.headerCell}>Decided By</TableCell>
              <TableCell className={classes.headerCell}>Decided</TableCell>
              <TableCell className={classes.headerCell}>Status</TableCell>
              <TableCell className={classes.headerCell}>Note</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loadingApprovalHistory && historicalApprovals.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className={classes.emptyState}>
                  Loading approval history…
                </TableCell>
              </TableRow>
            )}
            {!loadingApprovalHistory && historicalApprovals.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className={classes.emptyState}>
                  No completed approvals yet.
                </TableCell>
              </TableRow>
            )}
            {historicalApprovals.map(record => (
              <TableRow key={record.id}>
                <TableCell className={classes.mono}>{record.deploymentId ?? '—'}</TableCell>
                <TableCell>
                  <Typography variant="body2" style={{ fontWeight: 600 }}>
                    {record.application}
                  </Typography>
                  <Typography variant="caption" color="textSecondary" className={classes.mono}>
                    {record.instanceName}
                  </Typography>
                </TableCell>
                <TableCell>{record.environment}</TableCell>
                <TableCell className={classes.mono}>{record.requestedBy}</TableCell>
                <TableCell>{formatTime(record.requestedAt)}</TableCell>
                <TableCell className={classes.mono}>{record.decidedBy ?? '—'}</TableCell>
                <TableCell>{formatTime(record.decidedAt)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    className={classes.statusChip}
                    label={record.status}
                    style={{
                      backgroundColor: record.status === 'APPROVED' ? '#ECFDF5' : '#FEF2F2',
                      color: record.status === 'APPROVED' ? '#059669' : '#DC2626',
                    }}
                  />
                </TableCell>
                <TableCell>{record.decisionNote ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );

  return (
    <Box className={classes.root}>
      <Box className={classes.header}>
        <Typography className={classes.title}>Deployment History</Typography>
        <Box className={classes.headerActions}>
          {hasActive && (
            <Typography className={classes.autoBadge}>
              Auto-refresh every 15s
            </Typography>
          )}
          <Button
            size="small"
            startIcon={
              loading ? <CircularProgress size={16} /> : <RefreshIcon />
            }
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {notice && !error && (
        <Box className={classes.errorBox} style={{ backgroundColor: '#EFF6FF' }}>
          <ErrorIcon style={{ color: '#2563EB' }} />
          <Typography className={classes.errorText} style={{ color: '#1D4ED8' }}>
            {notice}
          </Typography>
        </Box>
      )}

      {error && (
        <Box className={classes.errorBox}>
          <ErrorIcon style={{ color: '#DC2626' }} />
          <Typography className={classes.errorText}>{error}</Typography>
        </Box>
      )}

      {approvalError && (
        <Box className={classes.errorBox}>
          <ErrorIcon style={{ color: '#DC2626' }} />
          <Typography className={classes.errorText}>{approvalError}</Typography>
        </Box>
      )}

      {(hasPendingApprovals || loadingApprovals) && renderApprovals()}
      {(historicalApprovals.length > 0 || loadingApprovalHistory) && renderApprovalHistory()}

      <Paper elevation={0} className={classes.tablePaper}>
        <Table size="small">
          <TableHead>
            <TableRow className={classes.tableHeaderRow}>
              <TableCell className={classes.headerCell}>Deployment</TableCell>
              <TableCell className={classes.headerCell}>Application</TableCell>
              <TableCell className={classes.headerCell}>Environment</TableCell>
              <TableCell className={classes.headerCell}>Namespace</TableCell>
              <TableCell className={classes.headerCell}>Run ID</TableCell>
              <TableCell className={classes.headerCell}>Status</TableCell>
              <TableCell className={classes.headerCell}>Started</TableCell>
              <TableCell className={classes.headerCell}>Completed</TableCell>
              <TableCell className={classes.headerCell} align="right">
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {deployments.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className={classes.emptyState}>
                  No deployments yet. Use a Deploy card above to launch one.
                </TableCell>
              </TableRow>
            )}
            {deployments.map(record => {
              const style = statusStyle(record.status);
              return (
                <TableRow key={record.id}>
                  <TableCell>
                    <Typography variant="body2" style={{ fontWeight: 600 }}>
                      {record.deploymentName}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      className={classes.mono}
                    >
                      {record.instanceName}
                    </Typography>
                  </TableCell>
                  <TableCell>{record.application}</TableCell>
                  <TableCell>{record.environment}</TableCell>
                  <TableCell className={classes.mono}>
                    {record.namespace}
                  </TableCell>
                  <TableCell className={classes.mono}>
                    {record.workflowRunUrl ? (
                      <Link
                        href={record.workflowRunUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {record.workflowRunId}
                      </Link>
                    ) : (
                      record.workflowRunId ?? '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      className={classes.statusChip}
                      label={style.label}
                      style={{ backgroundColor: style.bg, color: style.fg }}
                    />
                  </TableCell>
                  <TableCell>{formatTime(record.startedAt)}</TableCell>
                  <TableCell>{formatTime(record.completedAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="View workflow logs">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => void openLogs(record)}
                          disabled={!record.workflowRunId}
                        >
                          <DescriptionIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    {record.status === 'FAILED' && (
                      <Tooltip title="Retry deployment">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => void handleRetry(record.id)}
                            disabled={retryingId === record.id}
                          >
                            {retryingId === record.id ? (
                              <CircularProgress size={16} />
                            ) : (
                              <ReplayIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog
        open={Boolean(logsFor)}
        onClose={() => setLogsFor(null)}
        maxWidth="md"
      >
        <DialogTitle>Workflow logs — {logsFor?.deploymentName}</DialogTitle>
        <DialogContent>{renderLogsBody()}</DialogContent>
        <DialogActions>
          <Button onClick={() => setLogsFor(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
