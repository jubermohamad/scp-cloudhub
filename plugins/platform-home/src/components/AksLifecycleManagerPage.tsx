import { useState, useEffect, useCallback, useRef } from 'react';
import { Typography, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Button, Switch, FormControlLabel, Tooltip, Breadcrumbs, Link as MuiLink, CircularProgress, Accordion, AccordionSummary, AccordionDetails, Divider, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, IconButton, TextField, Select, MenuItem, InputLabel, FormControl } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  useBackendFetch,
  type LifecycleAction,
  type LifecycleActionResult,
  type NodePoolActionResult,
  type NodeWithPods,
  type OnboardedCluster,
  type ClusterSchedule,
} from '@internal/plugin-platform-common';

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  breadcrumbs: { marginBottom: theme.spacing(2), fontSize: '0.85rem' },
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
  heroIcon: { fontSize: 40, opacity: 0.9 },
  heroTitle: { fontSize: '1.6rem', fontWeight: 600 },
  heroSubtitle: {
    fontSize: '0.9rem',
    opacity: 0.88,
    marginTop: theme.spacing(0.5),
  },
  section: { marginBottom: theme.spacing(3) },
  sectionTitle: {
    fontWeight: 600,
    fontSize: '1rem',
    marginBottom: theme.spacing(2),
  },
  workspaceGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 1fr)',
    gap: theme.spacing(2),
    alignItems: 'start',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: '1fr',
    },
  },
  clusterColumn: {
    minWidth: 0,
  },
  consolePanel: {
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    position: 'sticky',
    top: theme.spacing(2),
    maxHeight: 'calc(100vh - 140px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    [theme.breakpoints.down('md')]: {
      position: 'static',
      maxHeight: 460,
    },
  },
  consoleHeader: {
    padding: theme.spacing(1.25, 1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    background: '#F8FAFC',
  },
  consoleTitle: {
    fontWeight: 700,
    fontSize: '0.92rem',
  },
  consoleBody: {
    flex: 1,
    overflowY: 'auto',
    background: '#0B1220',
    padding: theme.spacing(1.25),
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
  },
  consoleLine: {
    color: '#E5E7EB',
    fontSize: '0.78rem',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    marginBottom: theme.spacing(0.4),
  },
  consoleLineInfo: { color: '#93C5FD' },
  consoleLineSuccess: { color: '#86EFAC' },
  consoleLineError: { color: '#FCA5A5' },
  consoleLineWarn: { color: '#FCD34D' },
  consoleTimestamp: { color: '#94A3B8' },
  consoleEmpty: {
    color: '#94A3B8',
    fontSize: '0.78rem',
  },
  clusterCard: {
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    background: '#F3F4F6',
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
    position: 'relative',
  },
  refreshCornerBtn: {
    position: 'absolute',
    top: theme.spacing(1),
    right: theme.spacing(1),
  },
  clusterHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  clusterIdentity: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
  },
  clusterLabel: {
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
  },
  clusterName: { fontSize: '1.1rem', fontWeight: 700 },
  clusterResourceGroup: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: theme.palette.text.primary,
  },
  chipRow: { display: 'flex', gap: theme.spacing(1), flexWrap: 'wrap' },
  capabilityChip: {
    color: '#111827',
    borderColor: 'rgba(17, 24, 39, 0.3)',
    '&:hover': {
      color: '#111827',
      background: '#E5E7EB',
    },
  },
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    marginTop: theme.spacing(1.25),
    paddingTop: theme.spacing(1.25),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  dryRunToggle: { marginLeft: 'auto' },
  actionBtn: { borderRadius: 8, fontWeight: 600, minWidth: 110 },
  startBtn: {
    background: '#107c10',
    color: '#fff',
    '&:hover': { background: '#0a5f0a', color: '#fff' },
  },
  stopBtn: {
    background: theme.palette.error.main,
    color: '#fff',
    '&:hover': { background: theme.palette.error.dark, color: '#fff' },
  },
  downsizeBtn: {
    background: '#005a9e',
    color: '#fff',
    '&:hover': { background: '#004080', color: '#fff' },
  },
  inlineCardActionBtn: {
    color: '#0F172A',
    '&:hover': {
      color: '#0F172A',
      background: '#E5E7EB',
    },
  },
  dryRunBadge: {
    background: '#fff3cd',
    color: '#856404',
    border: '1px solid #ffc107',
    borderRadius: 6,
    padding: theme.spacing(0.5, 1.5),
    fontSize: '0.78rem',
    fontWeight: 600,
    display: 'inline-block',
  },
  offboardBtn: {
    borderRadius: 8,
    fontWeight: 600,
    minWidth: 110,
    color: theme.palette.error.main,
    borderColor: theme.palette.error.main,
    '&:hover': {
      background: `${theme.palette.error.light}22`,
      borderColor: theme.palette.error.dark,
    },
  },
  scheduleBtn: {
    borderRadius: 8,
    fontWeight: 600,
    minWidth: 140,
    color: '#f59e0b',
    borderColor: '#f59e0b',
    '&:hover': {
      background: 'rgba(245,158,11,0.12)',
      borderColor: '#d97706',
      color: '#d97706',
    },
  },
  scheduleChip: {
    background: 'rgba(245,158,11,0.15)',
    color: '#f59e0b',
    border: '1px solid rgba(245,158,11,0.45)',
    fontWeight: 600,
    fontSize: '0.72rem',
  },
  resultPanel: {
    marginTop: theme.spacing(2),
    borderRadius: 10,
    padding: theme.spacing(2),
    border: `1px solid ${theme.palette.divider}`,
    background: theme.palette.background.default,
  },
  resultSummary: { fontWeight: 600, marginBottom: theme.spacing(1) },
  tableHead: { background: theme.palette.action.hover },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(6),
    color: theme.palette.text.secondary,
  },
  nodeAccordion: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: '8px !important',
    marginBottom: theme.spacing(1),
    '&:before': { display: 'none' },
  },
  nodeAccordionSummary: { borderRadius: 8 },
  podRow: { '&:nth-of-type(odd)': { background: theme.palette.action.hover } },
}));

type ConsoleLevel = 'info' | 'success' | 'error' | 'warn';

type ConsoleEntry = {
  id: number;
  ts: string;
  level: ConsoleLevel;
  message: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStateColor(state: string) {
  if (state === 'Running') return '#107c10';
  if (state === 'Stopped') return '#a00';
  return '#666';
}

function PowerStateChip({ state }: { state: string }) {
  const color = getStateColor(state);
  return (
    <Chip
      size="small"
      label={state}
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        fontWeight: 600,
      }}
    />
  );
}

function NodeStatusIcon({ status }: { status: NodeWithPods['status'] }) {
  if (status === 'Ready')
    return <CheckCircleIcon style={{ color: '#107c10', fontSize: 18 }} />;
  if (status === 'NotReady')
    return <ErrorIcon style={{ color: '#a00', fontSize: 18 }} />;
  return <HelpOutlineIcon style={{ color: '#666', fontSize: 18 }} />;
}

function renderApplyStatus(isDryRun: boolean, isApplied: boolean) {
  if (isDryRun) {
    return <span style={{ color: '#856404' }}>Planned</span>;
  }
  if (isApplied) {
    return <CheckCircleIcon style={{ color: '#107c10', fontSize: 16 }} />;
  }
  return '–';
}

function getConsoleLevelClass(
  level: ConsoleLevel,
  classes: Record<string, string>,
) {
  if (level === 'success') return classes.consoleLineSuccess;
  if (level === 'error') return classes.consoleLineError;
  if (level === 'warn') return classes.consoleLineWarn;
  return classes.consoleLineInfo;
}

// ─── Node/Pod expansion panel ─────────────────────────────────────────────────

function NodePodPanel({ node }: { node: NodeWithPods }) {
  const classes = useStyles();
  return (
    <Accordion className={classes.nodeAccordion} elevation={0}>
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        className={classes.nodeAccordionSummary}
      >
        <Grid container alignItems="center" spacing={1}>
          <Grid item>
            <NodeStatusIcon status={node.status} />
          </Grid>
          <Grid item xs>
            <Typography variant="body2" style={{ fontWeight: 600 }}>
              {node.nodeName}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              Pool: {node.nodePool} · {node.instanceType} · {node.region}
            </Typography>
          </Grid>
          <Grid item>
            <Chip size="small" label={`${node.totalPods} pods`} />
          </Grid>
          <Grid item>
            <Typography
              variant="caption"
              color="textSecondary"
              style={{ marginRight: 8 }}
            >
              CPU: {node.allocatableCpu} · Mem: {node.allocatableMemory}
            </Typography>
          </Grid>
        </Grid>
      </AccordionSummary>
      <AccordionDetails style={{ padding: 0 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Namespace</TableCell>
                <TableCell>Pod</TableCell>
                <TableCell>Phase</TableCell>
                <TableCell>Containers</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {node.pods.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography variant="caption" color="textSecondary">
                      No pods
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                node.pods.map((pod: NodeWithPods['pods'][number]) => (
                  <TableRow
                    key={`${pod.namespace}/${pod.name}`}
                    className={classes.podRow}
                  >
                    <TableCell>
                      <Typography variant="caption">{pod.namespace}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{pod.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={pod.phase}
                        style={{
                          background:
                            pod.phase === 'Running' ? '#e6f4ea' : '#fce8e6',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {pod.containers.length}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </AccordionDetails>
    </Accordion>
  );
}

// ─── Action result panel ──────────────────────────────────────────────────────

function ActionResultPanel({
  result,
  onDismiss,
}: {
  result: LifecycleActionResult;
  onDismiss: () => void;
}) {
  const classes = useStyles();
  return (
    <div className={classes.resultPanel}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <Typography className={classes.resultSummary}>
          {result.dryRun && (
            <span className={classes.dryRunBadge}>DRY RUN&nbsp;</span>
          )}{' '}
          {result.summary}
        </Typography>
        <Button size="small" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <TableContainer>
        <Table size="small">
          <TableHead className={classes.tableHead}>
            <TableRow>
              <TableCell>Node Pool</TableCell>
              <TableCell>Action</TableCell>
              <TableCell align="right">Before</TableCell>
              <TableCell align="right">After</TableCell>
              <TableCell>Applied</TableCell>
              <TableCell>Note</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.nodePools.map((p: NodePoolActionResult) => (
              <TableRow key={p.nodePoolName}>
                <TableCell>{p.nodePoolName}</TableCell>
                <TableCell>{p.action}</TableCell>
                <TableCell align="right">{p.previousCount}</TableCell>
                <TableCell align="right">{p.targetCount}</TableCell>
                <TableCell>
                  {renderApplyStatus(result.dryRun, p.applied)}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="textSecondary">
                    {p.reason ?? '–'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

// ─── Cluster card ─────────────────────────────────────────────────────────────

function ClusterCard({
  cluster,
  onOffboard,
  onLog,
}: {
  cluster: OnboardedCluster;
  onOffboard: () => void;
  onLog: (level: ConsoleLevel, message: string) => void;
}) {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<LifecycleActionResult | null>(null);
  const [nodes, setNodes] = useState<NodeWithPods[] | null>(null);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [powerState, setPowerState] = useState<
    'Running' | 'Stopped' | 'Unknown'
  >(cluster.powerState ?? 'Unknown');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [rbacFixing, setRbacFixing] = useState(false);
  const [confirmOffboard, setConfirmOffboard] = useState(false);
  const [offboarding, setOffboarding] = useState(false);

  // Schedule state
  const [schedule, setSchedule] = useState<ClusterSchedule | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [formTimezone, setFormTimezone] = useState('UTC');
  const [formStopDay, setFormStopDay] = useState<string>(''); // '' = none, '0'-'6' for Sun-Sat
  const [formStopTime, setFormStopTime] = useState('');
  const [formStartDay, setFormStartDay] = useState<string>('');
  const [formStartTime, setFormStartTime] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [clearingSchedule, setClearingSchedule] = useState(false);

  const canStart = !busy && powerState === 'Stopped';
  const canStop = !busy && powerState === 'Running';
  const canDownsize = !busy && powerState === 'Running';

  const loadNodes = useCallback(async () => {
    setError(null);
    setErrorCode(null);
    setLoadingNodes(true);
    onLog('info', `[${cluster.clusterName}] Loading node map`);
    try {
      const params = new URLSearchParams({
        subscriptionId: cluster.subscriptionId,
        resourceGroup: cluster.resourceGroup,
      });
      const r = await backendFetch(
        'cost-automation',
        `/azure/aks/${encodeURIComponent(cluster.clusterName)}/pods?${params}`,
      );
      if (r.ok) {
        const data = await r.json();
        setNodes(data.nodes ?? []);
        onLog(
          'success',
          `[${cluster.clusterName}] Node map loaded (${
            (data.nodes ?? []).length
          } nodes)`,
        );
      } else {
        const body = await r.json().catch(() => ({}));
        const parsed = body as {
          error?: string;
          details?: string;
          guidance?: string;
          code?: string;
        };
        const base =
          parsed.error ?? `Node map request failed (HTTP ${r.status})`;
        const msg = parsed.guidance ? `${base} ${parsed.guidance}` : base;
        setError(msg);
        setErrorCode(parsed.code ?? null);
        onLog(
          'error',
          `[${cluster.clusterName}] ${msg}${
            parsed.code ? ` [${parsed.code}]` : ''
          }`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load node map';
      setError(msg);
      onLog('error', `[${cluster.clusterName}] ${msg}`);
    } finally {
      setLoadingNodes(false);
    }
  }, [
    cluster.clusterName,
    cluster.resourceGroup,
    cluster.subscriptionId,
    onLog,
    backendFetch,
  ]);

  const refreshPowerState = useCallback(async () => {
    setRefreshing(true);
    onLog('info', `[${cluster.clusterName}] Refreshing power state`);
    try {
      const r = await backendFetch(
        'cost-automation',
        `/azure/aks/${encodeURIComponent(cluster.clusterName)}/powerstate`,
      );
      if (r.ok) {
        const data: { powerState: 'Running' | 'Stopped' | 'Unknown' } =
          await r.json();
        setPowerState(data.powerState ?? 'Unknown');
        onLog(
          'success',
          `[${cluster.clusterName}] Power state is ${
            data.powerState ?? 'Unknown'
          }`,
        );
      } else {
        onLog(
          'warn',
          `[${cluster.clusterName}] Power state refresh failed (HTTP ${r.status})`,
        );
      }
    } catch {
      onLog('warn', `[${cluster.clusterName}] Power state refresh failed`);
    } finally {
      setRefreshing(false);
    }
  }, [cluster.clusterName, onLog, backendFetch]);

  // Load current schedule once on mount.
  useEffect(() => {
    backendFetch(
      'cost-automation',
      `/azure/aks/${encodeURIComponent(cluster.clusterName)}/schedule`,
    )
      .then(r => (r.ok ? r.json() : null))
      .then((data: ClusterSchedule | null) => setSchedule(data))
      .catch(() => {});
  }, [cluster.clusterName, backendFetch]);

  const openScheduleDialog = useCallback(() => {
    setFormTimezone(schedule?.timezone ?? 'UTC');
    setFormStopDay(
      schedule?.stop?.dayOfWeek !== null &&
        schedule?.stop?.dayOfWeek !== undefined
        ? String(schedule.stop.dayOfWeek)
        : '',
    );
    setFormStopTime(schedule?.stop?.time ?? '');
    setFormStartDay(
      schedule?.start?.dayOfWeek !== null &&
        schedule?.start?.dayOfWeek !== undefined
        ? String(schedule.start.dayOfWeek)
        : '',
    );
    setFormStartTime(schedule?.start?.time ?? '');
    setFormEnabled(schedule?.enabled ?? true);
    setScheduleDialogOpen(true);
  }, [schedule]);

  const handleSaveSchedule = useCallback(async () => {
    setSavingSchedule(true);
    onLog('info', `[${cluster.clusterName}] Saving schedule`);
    try {
      const r = await backendFetch(
        'cost-automation',
        `/azure/aks/${encodeURIComponent(cluster.clusterName)}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timezone: formTimezone,
            stop:
              formStopDay !== ''
                ? { dayOfWeek: parseInt(formStopDay, 10), time: formStopTime }
                : null,
            start:
              formStartDay !== ''
                ? { dayOfWeek: parseInt(formStartDay, 10), time: formStartTime }
                : null,
            enabled: formEnabled,
          }),
        },
      );
      if (r.ok) {
        const data: { schedule: ClusterSchedule } = await r.json();
        setSchedule(data.schedule);
        setScheduleDialogOpen(false);
        onLog('success', `[${cluster.clusterName}] Schedule saved`);
      } else {
        const body = await r.json().catch(() => ({}));
        const msg =
          (body as { error?: string }).error ??
          `Failed to save schedule (HTTP ${r.status})`;
        setError(msg);
        onLog('error', `[${cluster.clusterName}] ${msg}`);
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Network error — please retry.';
      setError(msg);
      onLog('error', `[${cluster.clusterName}] ${msg}`);
    } finally {
      setSavingSchedule(false);
    }
  }, [
    cluster.clusterName,
    formTimezone,
    formStopDay,
    formStopTime,
    formStartDay,
    formStartTime,
    formEnabled,
    onLog,
    backendFetch,
  ]);

  const handleClearSchedule = useCallback(async () => {
    setClearingSchedule(true);
    onLog('info', `[${cluster.clusterName}] Clearing schedule`);
    try {
      const r = await backendFetch(
        'cost-automation',
        `/azure/aks/${encodeURIComponent(cluster.clusterName)}/schedule`,
        { method: 'DELETE' },
      );
      if (r.ok || r.status === 404) {
        setSchedule(null);
        setScheduleDialogOpen(false);
        onLog('success', `[${cluster.clusterName}] Schedule cleared`);
      } else {
        onLog(
          'warn',
          `[${cluster.clusterName}] Failed to clear schedule (HTTP ${r.status})`,
        );
      }
    } catch {
      onLog('warn', `[${cluster.clusterName}] Failed to clear schedule`);
    } finally {
      setClearingSchedule(false);
    }
  }, [cluster.clusterName, onLog, backendFetch]);

  const handleOffboard = useCallback(async () => {
    setOffboarding(true);
    setError(null);
    onLog('info', `[${cluster.clusterName}] Offboard requested`);
    try {
      const r = await backendFetch(
        'cost-automation',
        `/azure/aks/${encodeURIComponent(cluster.clusterName)}/offboard`,
        { method: 'DELETE' },
      );
      if (r.ok) {
        onLog(
          'success',
          `[${cluster.clusterName}] Offboarded from lifecycle management`,
        );
        onOffboard();
      } else {
        const body = await r.json().catch(() => ({}));
        const msg =
          (body as { error?: string }).error ??
          `Offboard failed (HTTP ${r.status})`;
        setError(msg);
        onLog('error', `[${cluster.clusterName}] ${msg}`);
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Network error — please retry.';
      setError(msg);
      onLog('error', `[${cluster.clusterName}] ${msg}`);
    } finally {
      setOffboarding(false);
      setConfirmOffboard(false);
    }
  }, [cluster.clusterName, onLog, onOffboard, backendFetch]);

  const fixRbac = useCallback(async () => {
    setRbacFixing(true);
    onLog(
      'info',
      `[${cluster.clusterName}] Assigning AKS Cluster User Role via platform SPN`,
    );
    try {
      const r = await backendFetch(
        'cost-automation',
        `/azure/aks/${encodeURIComponent(cluster.clusterName)}/rbac-setup`,
        { method: 'POST' },
      );
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        const data = body as { message?: string; alreadyExisted?: boolean };
        const msg = data.message ?? 'RBAC role assigned.';
        setError(null);
        setErrorCode(null);
        onLog(
          'success',
          `[${cluster.clusterName}] ${msg} You can now Load Node Map.`,
        );
      } else {
        const data = body as { error?: string; details?: string };
        const msg = data.error ?? `RBAC assignment failed (HTTP ${r.status})`;
        setError(msg);
        setErrorCode('RBAC_SETUP_FAILED');
        onLog('error', `[${cluster.clusterName}] ${msg}`);
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Network error — please retry.';
      setError(msg);
      onLog('error', `[${cluster.clusterName}] ${msg}`);
    } finally {
      setRbacFixing(false);
    }
  }, [cluster.clusterName, onLog, backendFetch]);

  const triggerAction = useCallback(
    async (action: LifecycleAction) => {
      setBusy(true);
      setResult(null);
      setError(null);
      setErrorCode(null);
      onLog(
        'info',
        `[${cluster.clusterName}] ${action.toUpperCase()} triggered (${
          dryRun ? 'dry run' : 'live'
        })`,
      );
      try {
        const r = await backendFetch(
          'cost-automation',
          `/azure/aks/${encodeURIComponent(cluster.clusterName)}/lifecycle`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              dryRun,
              target: {
                clusterName: cluster.clusterName,
                resourceGroup: cluster.resourceGroup,
                subscriptionId: cluster.subscriptionId,
              },
            }),
          },
        );
        if (!r.ok) {
          const errBody = await r
            .json()
            .catch(() => ({ error: `HTTP ${r.status}` }));
          const msg =
            (errBody as { error?: string }).error ??
            `Request failed (HTTP ${r.status})`;
          setError(msg);
          onLog('error', `[${cluster.clusterName}] ${msg}`);
          return;
        }
        const data: LifecycleActionResult = await r.json();
        setResult(data);
        onLog('success', `[${cluster.clusterName}] ${data.summary}`);
        // After a live action the cluster is transitioning — refresh to get actual state
        if (!data.dryRun) {
          setPowerState('Unknown');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to reach backend';
        setError(msg);
        onLog('error', `[${cluster.clusterName}] ${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [cluster, dryRun, onLog, backendFetch],
  );

  return (
    <Paper className={classes.clusterCard} elevation={0}>
      {/* Refresh icon — top-right corner of the card */}
      <Tooltip title="Refresh power state from Azure">
        <IconButton
          size="small"
          className={classes.refreshCornerBtn}
          onClick={refreshPowerState}
          disabled={busy || refreshing}
        >
          {refreshing ? (
            <CircularProgress size={16} />
          ) : (
            <RefreshIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>

      {/* Header row */}
      <div className={classes.clusterHeader}>
        <div className={classes.clusterIdentity}>
          <Typography className={classes.clusterLabel}>Cluster Name</Typography>
          <Typography className={classes.clusterName}>
            {cluster.clusterName}
          </Typography>
          <Typography className={classes.clusterLabel}>RG Name</Typography>
          <Typography className={classes.clusterResourceGroup}>
            {cluster.resourceGroup}
          </Typography>
        </div>
        <div className={classes.chipRow}>
          <Chip size="small" label={cluster.environment.toUpperCase()} />
          <PowerStateChip state={powerState} />
          {schedule &&
            (() => {
              const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              const tzAbbr = (() => {
                try {
                  return (
                    new Intl.DateTimeFormat('en', {
                      timeZone: schedule.timezone,
                      timeZoneName: 'short',
                    })
                      .formatToParts(new Date())
                      .find(p => p.type === 'timeZoneName')?.value ??
                    schedule.timezone
                  );
                } catch {
                  return schedule.timezone;
                }
              })();
              const parts = [
                schedule.stop
                  ? `${DAY[schedule.stop.dayOfWeek]}  ${schedule.stop.time}`
                  : null,
                schedule.start
                  ? `${DAY[schedule.start.dayOfWeek]} ${schedule.start.time}`
                  : null,
              ]
                .filter(Boolean)
                .join(' → ');
              const chipLabel = schedule.enabled
                ? `${parts} ${tzAbbr}`
                : 'Schedule off';
              const tipText = schedule.enabled
                ? `Stop: ${
                    schedule.stop
                      ? `${DAY[schedule.stop.dayOfWeek]}  ${schedule.stop.time}`
                      : '\u2014'
                  }, ` +
                  `Start: ${
                    schedule.start
                      ? `${DAY[schedule.start.dayOfWeek]} ${
                          schedule.start.time
                        }`
                      : '\u2014'
                  } (${schedule.timezone})`
                : `Schedule saved but disabled (${schedule.timezone})`;
              return (
                <Tooltip title={tipText}>
                  <Chip
                    size="small"
                    icon={<ScheduleIcon style={{ fontSize: 14 }} />}
                    label={chipLabel}
                    className={classes.scheduleChip}
                  />
                </Tooltip>
              );
            })()}
          {cluster.capabilities.map((c: string) => (
            <Chip
              key={c}
              size="small"
              label={c}
              variant="outlined"
              className={classes.capabilityChip}
            />
          ))}
        </div>
      </div>

      {/* Node/Pod map */}
      <div style={{ marginBottom: 8 }}>
        <Button
          className={classes.inlineCardActionBtn}
          size="small"
          startIcon={
            loadingNodes ? <CircularProgress size={14} /> : <RefreshIcon />
          }
          onClick={loadNodes}
          disabled={loadingNodes}
        >
          {nodes === null ? 'Load Node Map' : 'Refresh Node Map'}
        </Button>
      </div>

      {nodes !== null && (
        <div style={{ marginBottom: 12 }}>
          {nodes.length === 0 ? (
            <Typography variant="caption" color="textSecondary">
              No nodes found.
            </Typography>
          ) : (
            nodes.map(n => <NodePodPanel key={n.nodeName} node={n} />)
          )}
        </div>
      )}

      {/* Action result */}
      {result && (
        <ActionResultPanel result={result} onDismiss={() => setResult(null)} />
      )}

      {/* Error banner */}
      {error && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: '#fce8e6',
            border: '1px solid #f5c6c6',
            borderRadius: 6,
            color: '#a00',
            fontSize: '0.85rem',
          }}
        >
          {error}
          {errorCode === 'AKS_CREDENTIALS_RBAC_MISSING' && (
            <Button
              size="small"
              variant="contained"
              style={{
                marginLeft: 8,
                background: '#1976d2',
                color: '#fff',
                fontSize: '0.75rem',
              }}
              startIcon={
                rbacFixing ? (
                  <CircularProgress size={12} style={{ color: '#fff' }} />
                ) : undefined
              }
              onClick={fixRbac}
              disabled={rbacFixing}
            >
              Fix RBAC
            </Button>
          )}
          <Button
            size="small"
            style={{ marginLeft: 8 }}
            onClick={() => {
              setError(null);
              setErrorCode(null);
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Action bar */}
      <div className={classes.actionBar}>
        <Tooltip title="Start all user node pools">
          <span>
            <Button
              className={`${classes.actionBtn} ${classes.startBtn}`}
              variant="contained"
              startIcon={
                busy ? (
                  <CircularProgress size={16} style={{ color: '#fff' }} />
                ) : (
                  <PlayArrowIcon />
                )
              }
              onClick={() => triggerAction('start')}
              disabled={!canStart}
            >
              Start
            </Button>
          </span>
        </Tooltip>

        <Tooltip title="Stop all user node pools (scale to 0)">
          <span>
            <Button
              className={`${classes.actionBtn} ${classes.stopBtn}`}
              variant="contained"
              startIcon={
                busy ? (
                  <CircularProgress size={16} style={{ color: '#fff' }} />
                ) : (
                  <StopIcon />
                )
              }
              onClick={() => triggerAction('stop')}
              disabled={!canStop}
            >
              Stop
            </Button>
          </span>
        </Tooltip>

        <Tooltip title="Downsize user node pools to minimum count">
          <span>
            <Button
              className={`${classes.actionBtn} ${classes.downsizeBtn}`}
              variant="contained"
              startIcon={
                busy ? (
                  <CircularProgress size={16} style={{ color: '#fff' }} />
                ) : (
                  <TrendingDownIcon />
                )
              }
              onClick={() => triggerAction('downsize')}
              disabled={!canDownsize}
            >
              Downsize
            </Button>
          </span>
        </Tooltip>

        <Tooltip title="Schedule a daily recurring stop and/or start time (UTC)">
          <Button
            className={classes.scheduleBtn}
            variant="outlined"
            startIcon={<ScheduleIcon />}
            onClick={openScheduleDialog}
            disabled={busy}
          >
            Schedule Stop/Start
          </Button>
        </Tooltip>

        <FormControlLabel
          className={classes.dryRunToggle}
          control={
            <Switch
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              color="primary"
              size="small"
            />
          }
          label={
            <Typography variant="caption">
              {dryRun ? (
                <span className={classes.dryRunBadge}>DRY RUN</span>
              ) : (
                'Live mode'
              )}
            </Typography>
          }
        />

        <Tooltip title="Remove this cluster from cost automation management">
          <span>
            <Button
              className={classes.offboardBtn}
              variant="outlined"
              startIcon={
                offboarding ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <DeleteOutlineIcon />
                )
              }
              onClick={() => setConfirmOffboard(true)}
              disabled={busy || offboarding}
            >
              Offboard
            </Button>
          </span>
        </Tooltip>
      </div>

      {/* Offboard confirmation dialog */}
      <Dialog
        open={confirmOffboard}
        onClose={() => setConfirmOffboard(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Offboard cluster?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>{cluster.clusterName}</strong> will be removed from the Cost
            Automation Engine. The cluster itself will <em>not</em> be stopped
            or deleted — only its management registration is removed. You can
            re-onboard it at any time.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmOffboard(false)}
            disabled={offboarding}
          >
            Cancel
          </Button>
          <Button
            onClick={handleOffboard}
            disabled={offboarding}
            style={{ color: '#a00', fontWeight: 600 }}
            startIcon={
              offboarding ? (
                <CircularProgress size={14} color="inherit" />
              ) : undefined
            }
          >
            {offboarding ? 'Offboarding…' : 'Confirm Offboard'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Schedule dialog */}
      <Dialog
        open={scheduleDialogOpen}
        onClose={() => setScheduleDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ScheduleIcon style={{ color: '#5c3d99' }} />
            Schedule Stop / Start
          </div>
        </DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            color="textSecondary"
            style={{ marginBottom: 16 }}
          >
            Configure a weekly recurring stop/start for{' '}
            <strong>{cluster.clusterName}</strong>. Times are in the selected
            timezone. Leave a day blank to skip that action. Schedules are
            executed by an Azure Function — Backstage stores configuration only.
          </Typography>

          {/* Timezone */}
          <FormControl
            variant="outlined"
            size="small"
            fullWidth
            style={{ marginBottom: 20 }}
          >
            <InputLabel>Timezone</InputLabel>
            <Select
              label="Timezone"
              value={formTimezone}
              onChange={e => setFormTimezone(e.target.value as string)}
            >
              {[
                'UTC',
                'Europe/London',
                'Europe/Paris',
                'Europe/Amsterdam',
                'Asia/Kolkata',
                'Asia/Singapore',
                'Asia/Tokyo',
                'America/New_York',
                'America/Chicago',
                'America/Los_Angeles',
                'Australia/Sydney',
              ].map(tz => (
                <MenuItem key={tz} value={tz}>
                  {tz}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Stop row */}
          <Typography
            variant="subtitle2"
            style={{ marginBottom: 6, fontWeight: 600 }}
          >
            Stop schedule
          </Typography>
          <Grid container spacing={2} style={{ marginBottom: 16 }}>
            <Grid item xs={12} sm={6}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel>Day of week</InputLabel>
                <Select
                  label="Day of week"
                  value={formStopDay}
                  onChange={e => setFormStopDay(e.target.value as string)}
                >
                  <MenuItem value="">
                    <em>None (disabled)</em>
                  </MenuItem>
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((d, i) => (
                    <MenuItem key={i} value={String(i)}>
                      {d}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Time (local)"
                type="time"
                value={formStopTime}
                onChange={e => setFormStopTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
                variant="outlined"
                size="small"
                fullWidth
                disabled={formStopDay === ''}
              />
            </Grid>
          </Grid>

          {/* Start row */}
          <Typography
            variant="subtitle2"
            style={{ marginBottom: 6, fontWeight: 600 }}
          >
            Start schedule
          </Typography>
          <Grid container spacing={2} style={{ marginBottom: 12 }}>
            <Grid item xs={12} sm={6}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel>Day of week</InputLabel>
                <Select
                  label="Day of week"
                  value={formStartDay}
                  onChange={e => setFormStartDay(e.target.value as string)}
                >
                  <MenuItem value="">
                    <em>None (disabled)</em>
                  </MenuItem>
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((d, i) => (
                    <MenuItem key={i} value={String(i)}>
                      {d}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Time (local)"
                type="time"
                value={formStartTime}
                onChange={e => setFormStartTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
                variant="outlined"
                size="small"
                fullWidth
                disabled={formStartDay === ''}
              />
            </Grid>
          </Grid>

          <FormControlLabel
            control={
              <Switch
                checked={formEnabled}
                onChange={e => setFormEnabled(e.target.checked)}
                color="primary"
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                {formEnabled
                  ? 'Schedule enabled (Azure Function will execute)'
                  : 'Schedule disabled (saved but not executed)'}
              </Typography>
            }
          />
        </DialogContent>
        <DialogActions
          style={{ justifyContent: 'space-between', padding: '8px 16px 16px' }}
        >
          <Button
            onClick={handleClearSchedule}
            disabled={savingSchedule || clearingSchedule || !schedule}
            startIcon={
              clearingSchedule ? <CircularProgress size={14} /> : undefined
            }
            style={{ color: '#a00' }}
          >
            Clear Schedule
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => setScheduleDialogOpen(false)}
              disabled={savingSchedule}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSaveSchedule}
              disabled={savingSchedule}
              startIcon={
                savingSchedule ? (
                  <CircularProgress size={14} style={{ color: '#fff' }} />
                ) : (
                  <ScheduleIcon />
                )
              }
              style={{ background: '#5c3d99', color: '#fff' }}
            >
              {savingSchedule ? 'Saving…' : 'Save Schedule'}
            </Button>
          </div>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

// ─── Clusters view ────────────────────────────────────────────────────────────

interface ClustersViewProps {
  loading: boolean;
  clusters: OnboardedCluster[];
  navigate: ReturnType<typeof useNavigate>;
  classes: Record<string, string>;
  loadClusters: () => void;
  pushLog: (level: ConsoleLevel, message: string) => void;
}

function renderClustersView({
  loading,
  clusters,
  navigate,
  classes,
  loadClusters,
  pushLog,
}: ClustersViewProps) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <CircularProgress />
      </div>
    );
  }
  if (clusters.length === 0) {
    return (
      <div className={classes.emptyState}>
        <TrendingDownIcon style={{ fontSize: 48, opacity: 0.3 }} />
        <Typography variant="h6" style={{ marginTop: 12 }}>
          No managed clusters yet
        </Typography>
        <Typography variant="body2" style={{ marginTop: 4, marginBottom: 16 }}>
          Onboard a dev or QA cluster to get started.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => navigate('/cloud/azure/aks-cost-automation/onboard')}
        >
          Activate AKS Cost Savings
        </Button>
      </div>
    );
  }
  return (
    <>
      {clusters.map(c => (
        <ClusterCard
          key={c.clusterName}
          cluster={c}
          onOffboard={loadClusters}
          onLog={pushLog}
        />
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AksLifecycleManagerPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const [clusters, setClusters] = useState<OnboardedCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);

  const pushLog = useCallback((level: ConsoleLevel, message: string) => {
    const now = new Date();
    const ts = now.toLocaleTimeString('en-GB', { hour12: false });
    setConsoleEntries(prev => [
      ...prev,
      {
        id: now.getTime() + Math.floor(Math.random() * 1000),
        ts,
        level,
        message,
      },
    ]);
  }, []);

  useEffect(() => {
    if (!consoleBodyRef.current) return;
    consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
  }, [consoleEntries]);

  const loadClusters = useCallback(async () => {
    setLoading(true);
    pushLog('info', 'Refreshing managed cluster inventory');
    try {
      const r = await backendFetch('cost-automation', '/azure/aks/managed');
      if (r.ok) {
        const data = await r.json();
        setClusters(data.clusters ?? []);
        pushLog(
          'success',
          `Loaded ${(data.clusters ?? []).length} managed cluster(s)`,
        );
      } else {
        pushLog('warn', `Managed cluster refresh failed (HTTP ${r.status})`);
      }
    } catch {
      pushLog('error', 'Managed cluster refresh failed');
    } finally {
      setLoading(false);
    }
  }, [pushLog, backendFetch]);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

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
        <Typography color="textPrimary">AKS Lifecycle Manager</Typography>
      </Breadcrumbs>

      {/* Hero */}
      <div className={classes.hero}>
        <TrendingDownIcon className={classes.heroIcon} />
        <div>
          <Typography className={classes.heroTitle}>
            AKS Lifecycle Manager
          </Typography>
          <Typography className={classes.heroSubtitle}>
            Start, stop, and downsize managed non-production clusters. Toggle
            dry-run to preview changes before applying.
          </Typography>
        </div>
      </div>

      {/* Summary row */}
      <Grid container spacing={2} className={classes.section}>
        <Grid item xs={12} sm={4}>
          <Paper
            elevation={0}
            style={{
              padding: 16,
              borderRadius: 10,
              border: '1px solid',
              borderColor: 'rgba(0,0,0,0.12)',
              textAlign: 'center',
              background: '#F3F4F6',
            }}
          >
            <Typography
              variant="h4"
              style={{ fontWeight: 700, color: '#107c10' }}
            >
              {loading ? '–' : clusters.length}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              Managed Clusters
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper
            elevation={0}
            style={{
              padding: 16,
              borderRadius: 10,
              border: '1px solid',
              borderColor: 'rgba(0,0,0,0.12)',
              textAlign: 'center',
              background: '#F3F4F6',
            }}
          >
            <Typography variant="h4" style={{ fontWeight: 700 }}>
              {loading
                ? '–'
                : clusters.filter(c => c.environment === 'dev').length}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              Dev Clusters
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper
            elevation={0}
            style={{
              padding: 16,
              borderRadius: 10,
              border: '1px solid',
              borderColor: 'rgba(0,0,0,0.12)',
              textAlign: 'center',
              background: '#F3F4F6',
            }}
          >
            <Typography variant="h4" style={{ fontWeight: 700 }}>
              {loading
                ? '–'
                : clusters.filter(c => c.environment === 'qa').length}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              QA Clusters
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <div className={classes.workspaceGrid}>
        <div className={classes.clusterColumn}>
          {/* Clusters */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Typography className={classes.sectionTitle}>
              Managed Clusters
            </Typography>
            <Button
              size="small"
              startIcon={
                loading ? <CircularProgress size={14} /> : <RefreshIcon />
              }
              onClick={loadClusters}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>

          {renderClustersView({
            loading,
            clusters,
            navigate,
            classes,
            loadClusters,
            pushLog,
          })}
        </div>

        <Paper className={classes.consolePanel} elevation={0}>
          <div className={classes.consoleHeader}>
            <Typography className={classes.consoleTitle}>
              Live Action Console
            </Typography>
            <Button
              size="small"
              onClick={() => setConsoleEntries([])}
              disabled={consoleEntries.length === 0}
            >
              Clear
            </Button>
          </div>
          <div className={classes.consoleBody} ref={consoleBodyRef}>
            {consoleEntries.length === 0 ? (
              <Typography className={classes.consoleEmpty}>
                Trigger start, stop, downsize, schedule, offboard, or refresh
                actions to stream events here.
              </Typography>
            ) : (
              consoleEntries.map(entry => {
                const levelClass = getConsoleLevelClass(entry.level, classes);
                return (
                  <div
                    key={entry.id}
                    className={`${classes.consoleLine} ${levelClass}`}
                  >
                    <span className={classes.consoleTimestamp}>
                      [{entry.ts}]
                    </span>{' '}
                    {entry.message}
                  </div>
                );
              })
            )}
          </div>
        </Paper>
      </div>
    </div>
  );
}
