import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, CircularProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import MemoryIcon from '@mui/icons-material/Memory';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ListAltIcon from '@mui/icons-material/ListAlt';
import { useNavigate } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';
import { GpuInstanceStatusBadge } from './gpu-compute/GpuInstanceStatusBadge';

interface GpuInfrastructureRecord {
  id: string;
  name: string;
  gpuSku: string;
  vmSize: string;
  status: Parameters<typeof GpuInstanceStatusBadge>[0]['status'];
  owner: string;
  createdAt: string;
  workflowRunUrl: string | null;
}

const IN_FLIGHT_STATUSES = new Set([
  'PENDING',
  'VALIDATING',
  'TRIGGERING_WORKFLOW',
  'PROVISIONING',
  'STARTING',
  'STOPPING',
  'DELETING',
]);

const useStyles = makeStyles(theme => ({
  detailCard: {
    marginTop: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    background: '#f8fafc',
  },
  subtitle: {
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5),
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
    flexWrap: 'wrap',
  },
  actions: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  emptyState: {
    borderRadius: 10,
    border: `1px dashed ${theme.palette.divider}`,
    padding: theme.spacing(2),
    marginTop: theme.spacing(2),
    background: '#fff',
  },
}));

export function GpuInfrastructureCard() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<GpuInfrastructureRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error(body?.error ?? 'Failed to load GPU instances');
      }
      setRows(Array.isArray(body?.items) ? body.items : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [backendFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rows],
  );

  useEffect(() => {
    const hasInFlight = sorted.some(item => IN_FLIGHT_STATUSES.has(item.status));
    if (!hasInFlight) return undefined;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [sorted, load]);

  return (
    <Card className={classes.detailCard} elevation={0}>
      <CardContent>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          style={{ gap: 16 }}
        >
          <div>
            <Typography variant="h6" style={{ fontWeight: 700 }}>
              GPU Compute
            </Typography>
            <Typography variant="body2" className={classes.subtitle}>
              Create and track GPU instances using approved Terraform Cloud workflows.
            </Typography>
          </div>
          <Chip
            size="small"
            icon={<MemoryIcon style={{ fontSize: 16 }} />}
            label="Production workflow"
          />
        </Box>

        <div className={classes.actionsRow}>
          <Typography variant="body2" color="textSecondary">
            Instances are provisioned through the central GPU self-service flow.
          </Typography>
          <div className={classes.actions}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddCircleOutlineIcon />}
              onClick={() => navigate('/gpu-compute/create')}
            >
              Create GPU Instance
            </Button>
            <Button
              variant="outlined"
              startIcon={<ListAltIcon />}
              onClick={() => navigate('/gpu-compute')}
            >
              Manage GPU Instances
            </Button>
          </div>
        </div>

        {error && (
          <Typography color="error" style={{ marginTop: 12 }}>
            {error}
          </Typography>
        )}

        {(() => {
          if (loading) {
            return (
              <Box mt={3} textAlign="center" p={2}>
                <CircularProgress size={22} />
              </Box>
            );
          }
          if (sorted.length === 0) {
            return (
              <div className={classes.emptyState}>
                <Typography variant="body2" color="textSecondary">
                  No GPU instances found yet. Start by creating your first GPU instance.
                </Typography>
              </div>
            );
          }
          return (
            <TableContainer component={Paper} elevation={0} style={{ marginTop: 16, borderRadius: 10 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>GPU</TableCell>
                    <TableCell>VM Size</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Owner</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sorted.slice(0, 8).map(row => (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <Typography variant="body2" style={{ fontWeight: 600 }}>
                          {row.name}
                        </Typography>
                      </TableCell>
                      <TableCell>{row.gpuSku.toUpperCase()}</TableCell>
                      <TableCell>{row.vmSize}</TableCell>
                      <TableCell>
                        <GpuInstanceStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>{row.owner}</TableCell>
                      <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          );
        })()}
      </CardContent>
    </Card>
  );
}

export default GpuInfrastructureCard;