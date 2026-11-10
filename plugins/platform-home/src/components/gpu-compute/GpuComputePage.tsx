import { useCallback, useEffect, useMemo, useState } from 'react';
import { Typography, Paper, Button, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';

import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LaunchIcon from '@mui/icons-material/Launch';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useNavigate } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { GpuInstanceRecord } from './types';
import { GpuInstanceStatusBadge } from './GpuInstanceStatusBadge';
import { GpuLogStreamingDialog } from './GpuLogStreamingDialog';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1500,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(3),
  },
  title: {
    fontSize: '1.7rem',
    fontWeight: 700,
  },
  subtitle: {
    marginTop: theme.spacing(0.5),
    color: '#6B7280',
  },
  tablePaper: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    overflow: 'hidden',
  },
  empty: {
    padding: theme.spacing(6),
    textAlign: 'center',
  },
  actions: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
}));

export function GpuComputePage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submittingDelete, setSubmittingDelete] = useState<string | null>(
    null,
  );
  const [submittingPower, setSubmittingPower] = useState<string | null>(null);
  const [items, setItems] = useState<GpuInstanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logInstance, setLogInstance] = useState<GpuInstanceRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/gpu-instances',
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to load GPU instances');
      }
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [backendFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hasInFlight = items.some(item =>
      ['STARTING', 'STOPPING', 'PROVISIONING', 'DELETING'].includes(item.status),
    );
    if (!hasInFlight) return undefined;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [items, load]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items],
  );

  const handleDelete = async (id: string) => {
    setSubmittingDelete(id);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/gpu-instances/${encodeURIComponent(id)}/delete`,
        { method: 'POST' },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to delete GPU instance');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingDelete(null);
    }
  };

  const handlePowerAction = async (id: string, action: 'start' | 'stop') => {
    setSubmittingPower(id);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/gpu-instances/${encodeURIComponent(id)}/${action}`,
        { method: 'POST' },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? `Failed to ${action} GPU instance`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingPower(null);
    }
  };

  let tableContent: JSX.Element;
  if (loading) {
    tableContent = (
      <div className={classes.empty}>
        <CircularProgress size={28} />
        <Typography
          variant="body2"
          color="textSecondary"
          style={{ marginTop: 10 }}
        >
          Loading GPU instances...
        </Typography>
      </div>
    );
  } else if (sorted.length === 0) {
    tableContent = (
      <div className={classes.empty}>
        <Typography variant="h6" style={{ fontWeight: 700, marginBottom: 8 }}>
          No GPU instances yet
        </Typography>
        <Typography
          variant="body2"
          color="textSecondary"
          style={{ marginBottom: 16 }}
        >
          Request your first GPU VM from the approved catalog.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => navigate('/gpu-compute/create')}
        >
          Create GPU Instance
        </Button>
      </div>
    );
  } else {
    tableContent = (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>VM Name</TableCell>
            <TableCell>GPU SKU</TableCell>
            <TableCell>Region</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell>Expires</TableCell>
            <TableCell>Created</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map(item => (
            <TableRow key={item.id} hover>
              <TableCell>
                <Typography variant="body2" style={{ fontWeight: 600 }}>
                  {item.name}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {item.vmSize}
                </Typography>
              </TableCell>
              <TableCell>{item.gpuSku.toUpperCase()}</TableCell>
              <TableCell>{item.region}</TableCell>
              <TableCell>
                <GpuInstanceStatusBadge status={item.status} />
              </TableCell>
              <TableCell>{item.owner}</TableCell>
              <TableCell>
                {item.expiresAt
                  ? new Date(item.expiresAt).toLocaleDateString()
                  : 'No expiry'}
              </TableCell>
              <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
              <TableCell align="right">
                <div className={classes.actions}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => setLogInstance(item)}
                  >
                    Logs
                  </Button>
                  {item.workflowRunUrl && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<LaunchIcon />}
                      href={item.workflowRunUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Workflow
                    </Button>
                  )}
                  {(item.status === 'STOPPED' || item.status === 'START_FAILED') && (
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      startIcon={<PlayArrowIcon />}
                      disabled={submittingPower === item.id}
                      onClick={() => handlePowerAction(item.id, 'start')}
                    >
                      {submittingPower === item.id ? 'Starting...' : 'Start'}
                    </Button>
                  )}
                  {(item.status === 'READY' || item.status === 'STOP_FAILED') && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<StopIcon />}
                      disabled={submittingPower === item.id}
                      onClick={() => handlePowerAction(item.id, 'stop')}
                    >
                      {submittingPower === item.id ? 'Stopping...' : 'Stop'}
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    startIcon={<DeleteOutlineIcon />}
                    disabled={
                      submittingDelete === item.id ||
                      item.status === 'DELETING' ||
                      item.status === 'DELETED'
                    }
                    onClick={() => handleDelete(item.id)}
                  >
                    {submittingDelete === item.id ? 'Deleting...' : 'Delete'}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className={classes.root}>
      <div className={classes.header}>
        <div>
          <Typography className={classes.title}>GPU Compute</Typography>
          <Typography className={classes.subtitle}>
            Self-service GPU VM provisioning backed by the approved
            azure-ai-research-vm Terraform module. All instances are created
            in the platform-owned rg-gpu-sdc resource group.
          </Typography>
        </div>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/gpu-compute/create')}
        >
          Create GPU Instance
        </Button>
      </div>
      {error && (
        <Typography color="error" style={{ marginBottom: 16 }}>
          {error}
        </Typography>
      )}
      <Paper className={classes.tablePaper}>{tableContent}</Paper>

      <GpuLogStreamingDialog
        open={logInstance !== null}
        instance={logInstance}
        onClose={() => setLogInstance(null)}
      />
    </div>
  );
}
