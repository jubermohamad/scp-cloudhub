import { useCallback, useEffect, useRef, useState } from 'react';
import { Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Box, Paper, Chip, Link } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import {
  useBackendEventStream,
  useBackendFetch,
} from '@internal/plugin-platform-common';
import type {
  GpuInstanceEvent,
  GpuInstanceLogSnapshot,
  GpuInstanceRecord,
} from './types';

const POLL_INTERVAL_MS = 4000;

const useStyles = makeStyles(theme => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    minWidth: 620,
  },
  statusBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
  },
  errorBox: { backgroundColor: '#FEF2F2' },
  errorText: { color: '#DC2626', fontSize: '0.875rem' },
  infoBox: {
    backgroundColor: '#EFF6FF',
    padding: theme.spacing(1.5),
    borderRadius: 8,
  },
  successBox: { backgroundColor: '#ECFDF5' },
  successText: { color: '#059669', fontSize: '0.875rem' },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
  },
  summaryItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  summaryLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryValue: { fontSize: '0.9rem', fontWeight: 500, color: '#111827' },
  codeBlock: {
    margin: 0,
    padding: theme.spacing(1.5),
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    fontSize: '0.75rem',
    lineHeight: 1.5,
    maxHeight: 320,
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre-wrap',
  },
  panelTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: '#6B7280',
  },
  logLine: {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.74rem',
    lineHeight: 1.5,
    paddingBottom: theme.spacing(0.5),
  },
  levelInfo: { color: '#94a3b8' },
  levelSuccess: { color: '#4ade80' },
  levelWarn: { color: '#facc15' },
  levelError: { color: '#f87171' },
}));

interface GpuLogStreamingDialogProps {
  open: boolean;
  instance: GpuInstanceRecord | null;
  onClose: () => void;
}

interface StatusView {
  instanceId: string;
  status: string;
  statusMessage: string | null;
  failureReason: string | null;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  updatedAt: string;
}

function isTerminalStatus(status: string): boolean {
  return ['READY', 'FAILED', 'DELETED', 'DELETE_FAILED'].includes(status);
}

export function GpuLogStreamingDialog({
  open,
  instance,
  onClose,
}: GpuLogStreamingDialogProps): JSX.Element | null {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const openEventStream = useBackendEventStream();

  const [events, setEvents] = useState<GpuInstanceEvent[]>([]);
  const [statusView, setStatusView] = useState<StatusView | null>(null);
  const [snapshot, setSnapshot] = useState<GpuInstanceLogSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const instanceId = instance?.id ?? null;

  useEffect(() => {
    if (open && instance) {
      setStatusView({
        instanceId: instance.id,
        status: instance.status,
        statusMessage: instance.statusMessage,
        failureReason: instance.failureReason,
        workflowRunId: instance.workflowRunId,
        workflowRunUrl: instance.workflowRunUrl,
        updatedAt: instance.updatedAt,
      });
      setEvents([]);
      setSnapshot(null);
      setError(null);
    }
  }, [open, instance]);

  const loadSnapshot = useCallback(async () => {
    if (!instanceId) return;
    setLoadingSnapshot(true);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/gpu-instances/${encodeURIComponent(instanceId)}/logs`,
      );
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error ?? 'Failed to load run logs');
      setSnapshot(body as GpuInstanceLogSnapshot);
    } catch (e) {
      // Snapshot is best-effort; don't surface in the main error banner.
    } finally {
      setLoadingSnapshot(false);
    }
  }, [backendFetch, instanceId]);

  // Read the stream over `fetchApi` rather than `EventSource`: EventSource
  // cannot attach the Backstage identity token, so the guarded backend route
  // answers it with 401. When streaming is unavailable, fall back to polling
  // the status + events endpoints.
  useEffect(() => {
    if (!open || !instanceId) {
      return undefined;
    }

    const abort = new AbortController();
    let stopped = false;
    let pollTimer: number | undefined;

    const mergeEvents = (incoming: GpuInstanceEvent[]) => {
      if (incoming.length === 0) return;
      setEvents(prev => {
        const seen = new Set(prev.map(item => item.id));
        const added = incoming.filter(item => !seen.has(item.id));
        return added.length === 0 ? prev : [...prev, ...added];
      });
    };

    const applyStatus = (parsed: StatusView) => {
      setStatusView(parsed);
      return isTerminalStatus(parsed.status);
    };

    const pollOnce = async (): Promise<boolean> => {
      const [statusResp, eventsResp] = await Promise.all([
        backendFetch(
          'deployment-control-plane',
          `/gpu-instances/${encodeURIComponent(instanceId)}/status`,
        ),
        backendFetch(
          'deployment-control-plane',
          `/gpu-instances/${encodeURIComponent(instanceId)}/events`,
        ),
      ]);

      const eventsBody = await eventsResp.json().catch(() => null);
      if (eventsResp.ok && Array.isArray(eventsBody?.events)) {
        mergeEvents([...(eventsBody.events as GpuInstanceEvent[])].reverse());
      }

      const statusBody = await statusResp.json().catch(() => null);
      if (!statusResp.ok) {
        throw new Error(
          statusBody?.error ?? `Status request failed (${statusResp.status})`,
        );
      }
      const record = statusBody as GpuInstanceRecord;
      return applyStatus({
        instanceId: record.id,
        status: record.status,
        statusMessage: record.statusMessage,
        failureReason: record.failureReason,
        workflowRunId: record.workflowRunId,
        workflowRunUrl: record.workflowRunUrl,
        updatedAt: record.updatedAt,
      });
    };

    const startPolling = () => {
      if (stopped || pollTimer !== undefined) return;
      const tick = async () => {
        if (stopped) return;
        try {
          if (await pollOnce()) {
            stopped = true;
            window.clearInterval(pollTimer);
            pollTimer = undefined;
            void loadSnapshot();
          }
        } catch {
          // transient — the next tick retries
        }
      };
      void tick();
      pollTimer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    };

    const runStream = async () => {
      try {
        await openEventStream({
          pluginId: 'deployment-control-plane',
          path: `/gpu-instances/${encodeURIComponent(instanceId)}/logs/stream`,
          signal: abort.signal,
          onEvent: frame => {
            if (frame.event === 'log') {
              try {
                mergeEvents([JSON.parse(frame.data) as GpuInstanceEvent]);
              } catch {
                // ignore malformed payloads
              }
              return;
            }
            if (frame.event === 'status' || frame.event === 'done') {
              try {
                applyStatus(JSON.parse(frame.data) as StatusView);
              } catch {
                // ignore malformed payloads
              }
              if (frame.event === 'done') {
                stopped = true;
                abort.abort();
                void loadSnapshot();
              }
            }
          },
        });
        if (!stopped) {
          startPolling();
        }
      } catch (e) {
        if (abort.signal.aborted || stopped) {
          return;
        }
        setError(
          `Live log stream unavailable (${
            e instanceof Error ? e.message : String(e)
          }). Falling back to periodic status checks.`,
        );
        startPolling();
      }
    };

    void runStream();
    void loadSnapshot();

    return () => {
      stopped = true;
      abort.abort();
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
      }
    };
  }, [open, instanceId, openEventStream, backendFetch, loadSnapshot]);

  // Poll Terraform Cloud plan/apply logs every few seconds when running so
  // the lower snapshot panel updates even if the SSE only emits events.
  useEffect(() => {
    if (!open || !instanceId || isTerminalStatus(statusView?.status ?? '')) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [open, instanceId, statusView?.status, loadSnapshot]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [events, snapshot]);

  if (!instance) return null;

  const status = statusView?.status ?? instance.status;
  const statusMessage =
    statusView?.statusMessage ?? instance.statusMessage ?? '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Provisioning logs: {instance.name}
      </DialogTitle>
      <DialogContent className={classes.content}>
        <Paper className={classes.statusBox}>
          <StatusIcon status={status} />
          <Box style={{ flex: 1 }}>
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography variant="subtitle1" style={{ fontWeight: 700 }}>
                {instance.name}
              </Typography>
              <Chip
                size="small"
                label={status}
                style={{
                  backgroundColor: statusBackground(status),
                  color: statusForeground(status),
                  fontWeight: 700,
                  fontSize: '0.7rem',
                }}
              />
            </Box>
            <Typography variant="body2" color="textSecondary">
              {statusMessage || 'Waiting for updates...'}
            </Typography>
          </Box>
          {!isTerminalStatus(status) && <CircularProgress size={22} />}
        </Paper>

        <Box className={classes.summaryGrid}>
          <SummaryItem classes={classes} label="VM Name" value={instance.name} />
          <SummaryItem classes={classes} label="GPU SKU" value={instance.gpuSku.toUpperCase()} />
          <SummaryItem classes={classes} label="Region" value={instance.region} />
          <SummaryItem
            classes={classes}
            label="Run ID"
            value={statusView?.workflowRunId ?? instance.workflowRunId ?? '—'}
          />
        </Box>

        {statusView?.failureReason && (
          <Paper className={`${classes.statusBox} ${classes.errorBox}`}>
            <ErrorIcon style={{ color: '#DC2626' }} />
            <Typography className={classes.errorText}>
              {statusView.failureReason}
            </Typography>
          </Paper>
        )}

        {statusView?.workflowRunUrl && (
          <Link
            href={statusView.workflowRunUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Terraform Cloud run ↗
          </Link>
        )}

        {error && (
          <Paper className={`${classes.statusBox} ${classes.errorBox}`}>
            <ErrorIcon style={{ color: '#DC2626' }} />
            <Typography className={classes.errorText}>{error}</Typography>
          </Paper>
        )}

        <Paper className={classes.infoBox} style={{ display: 'block' }}>
          <Typography className={classes.panelTitle} style={{ marginBottom: 8 }}>
            Live activity log
          </Typography>
          <div
            ref={logContainerRef}
            style={{
              maxHeight: 220,
              overflow: 'auto',
            }}
          >
            {events.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Waiting for GPU provisioning activity...
              </Typography>
            ) : (
              events.map(event => (
                <Box key={event.id} className={classes.logLine}>
                  <span style={{ color: '#64748b' }}>
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </span>{' '}
                  <span className={levelClass(classes, event.level)}>
                    [{event.level}]
                  </span>{' '}
                  {event.message}
                </Box>
              ))
            )}
          </div>
        </Paper>

        {snapshot && (
          <Paper className={classes.infoBox} style={{ display: 'block' }}>
            <Typography className={classes.panelTitle} style={{ marginBottom: 8 }}>
              Terraform run logs {loadingSnapshot && <CircularProgress size={14} style={{ marginLeft: 8 }} />}
            </Typography>
            {snapshot.lines.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Terraform logs not available yet.
              </Typography>
            ) : (
              <pre className={classes.codeBlock}>
                {snapshot.lines.join('\n')}
              </pre>
            )}
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary" variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SummaryItem({
  classes,
  label,
  value,
}: {
  classes: ReturnType<typeof useStyles>;
  label: string;
  value: string;
}) {
  return (
    <Box className={classes.summaryItem}>
      <Typography className={classes.summaryLabel}>{label}</Typography>
      <Typography className={classes.summaryValue}>{value}</Typography>
    </Box>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'READY' || status === 'DELETED') {
    return <CheckCircleIcon style={{ color: '#059669' }} />;
  }
  if (status === 'FAILED' || status === 'DELETE_FAILED') {
    return <ErrorIcon style={{ color: '#DC2626' }} />;
  }
  return <CircularProgress size={22} />;
}

function statusBackground(status: string): string {
  if (status === 'READY' || status === 'DELETED') return '#D1FAE5';
  if (status === 'FAILED' || status === 'DELETE_FAILED') return '#FEE2E2';
  if (['STARTING', 'STOPPING', 'PROVISIONING', 'DELETING'].includes(status)) {
    return '#DBEAFE';
  }
  return '#F3F4F6';
}

function statusForeground(status: string): string {
  if (status === 'READY' || status === 'DELETED') return '#065F46';
  if (status === 'FAILED' || status === 'DELETE_FAILED') return '#991B1B';
  if (['STARTING', 'STOPPING', 'PROVISIONING', 'DELETING'].includes(status)) {
    return '#1E40AF';
  }
  return '#374151';
}

function levelClass(
  classes: ReturnType<typeof useStyles>,
  level: GpuInstanceEvent['level'],
): string {
  switch (level) {
    case 'success':
      return classes.levelSuccess;
    case 'warn':
      return classes.levelWarn;
    case 'error':
      return classes.levelError;
    default:
      return classes.levelInfo;
  }
}
