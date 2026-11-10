import { useCallback, useEffect, useMemo, useState } from 'react';
import { Typography, Paper, Button, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress, Box } from '@mui/material';
import { makeStyles } from '@mui/styles';

import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LaunchIcon from '@mui/icons-material/Launch';
import { useNavigate } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { DeveloperEnvironmentRecord } from './types';
import { DeveloperEnvironmentStatusBadge } from './DeveloperEnvironmentStatusBadge';

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

export function WorkspacePage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submittingDelete, setSubmittingDelete] = useState<string | null>(null);
  const [items, setItems] = useState<DeveloperEnvironmentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/workspaces',
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to load developer environments');
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
        `/workspaces/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to delete developer environment');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingDelete(null);
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
          Loading developer environments...
        </Typography>
      </div>
    );
  } else if (sorted.length === 0) {
    tableContent = (
      <div className={classes.empty}>
        <Typography variant="h6" style={{ fontWeight: 700, marginBottom: 8 }}>
          No workspaces yet
        </Typography>
        <Typography
          variant="body2"
          color="textSecondary"
          style={{ marginBottom: 16 }}
        >
          Create your first standardized Cloud Development Workspace.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => navigate('/workspaces/create')}
        >
          New Workspace
        </Button>
      </div>
    );
  } else {
    tableContent = (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Workspace</TableCell>
            <TableCell>SRI Component</TableCell>
            <TableCell>Development Profile</TableCell>
            <TableCell>Mode</TableCell>
            <TableCell>Runtime Target</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell>Created</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map(item => (
            <TableRow key={item.id} hover>
              <TableCell>
                <Typography variant="body2" style={{ fontWeight: 600 }}>
                  {item.displayName}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {item.name}
                </Typography>
              </TableCell>
              <TableCell>{item.componentDisplayName}</TableCell>
              <TableCell>
                {item.developmentProfileId}:{item.developmentProfileVersion}
              </TableCell>
              <TableCell>{item.environmentType}</TableCell>
              <TableCell>
                {item.clusterName}
                <Typography
                  variant="caption"
                  color="textSecondary"
                  display="block"
                >
                  {item.namespace}
                </Typography>
              </TableCell>
              <TableCell>
                <DeveloperEnvironmentStatusBadge status={item.status} />
              </TableCell>
              <TableCell>{item.ownerTeam}</TableCell>
              <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
              <TableCell align="right">
                <div className={classes.actions}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => navigate(`/workspaces/${item.id}`)}
                  >
                    View
                  </Button>
                  {item.latestDeploymentId && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<LaunchIcon />}
                      onClick={() =>
                        navigate(
                          `/workspaces/${item.id}/deployments/${item.latestDeploymentId}`,
                        )
                      }
                    >
                      Latest Deployment
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    startIcon={<DeleteOutlineIcon />}
                    disabled={submittingDelete === item.id}
                    onClick={() => void handleDelete(item.id)}
                  >
                    Delete
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
          <Typography className={classes.title}>My Workspaces</Typography>
          <Typography className={classes.subtitle}>
            Create and manage Cloud Development Workspaces for SRI applications.
          </Typography>
        </div>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/workspaces/create')}
        >
          New Workspace
        </Button>
      </div>

      {error && (
        <Box
          mb={2}
          p={2}
          style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8 }}
        >
          {error}
        </Box>
      )}

      <Paper className={classes.tablePaper} elevation={0}>
        {tableContent}
      </Paper>
    </div>
  );
}

export const DeveloperEnvironmentPage = WorkspacePage;
