import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Content,
  ContentHeader,
  Header,
  Page,
  Progress,
  ResponseErrorPanel,
  SupportButton,
} from '@backstage/core-components';
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Menu, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from '../api';
import type { Deployment, DeploymentEvent, DeploymentStatus } from '../types';
import { StatusChip } from './common/StatusChip';
import { CreateEntityDialog, FieldDef } from './common/CreateEntityDialog';
import { InlineAlert } from './common/InlineAlert';
import { useReferenceData } from './common/useReferenceData';

const NEXT_STATUSES: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending: ['in_progress', 'failed'],
  in_progress: ['active', 'failed'],
  active: [],
  failed: ['in_progress'],
  superseded: [],
  rolled_back: [],
};

const STATUS_LABEL: Record<DeploymentStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  active: 'Active',
  failed: 'Failed',
  superseded: 'Superseded',
  rolled_back: 'Rolled Back',
};

const createFields: FieldDef[] = [
  {
    name: 'deploymentTargetId',
    label: 'Deployment Target',
    type: 'reference',
    required: true,
    referenceKey: 'deploymentTargets',
  },
  {
    name: 'applicationId',
    label: 'Application',
    type: 'reference',
    required: true,
    referenceKey: 'applications',
  },
  { name: 'version', label: 'Version', type: 'text' },
  { name: 'deployedBy', label: 'Deployed By', type: 'text' },
];

const useStyles = makeStyles(theme => ({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
  },
  search: {
    minWidth: 320,
  },
  tableCard: {
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.shape.borderRadius,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  headerCell: {
    fontWeight: 700,
    color: theme.palette.text.secondary,
    textTransform: 'uppercase',
    fontSize: '0.72rem',
    letterSpacing: '0.04em',
  },
  actionsCell: {
    width: 140,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  noAccess: {
    padding: theme.spacing(4),
    textAlign: 'center',
  },
}));

function renderHistoryContent(
  eventsLoading: boolean,
  events: DeploymentEvent[],
) {
  if (eventsLoading) {
    return <Progress />;
  }
  if (events.length === 0) {
    return <Typography color="textSecondary">No events recorded.</Typography>;
  }
  return (
    <List dense>
      {events.map(ev => (
        <ListItem key={ev.id} disableGutters>
          <ListItemText
            primary={
              ev.fromStatus
                ? `${ev.fromStatus.replace(/_/g, ' ')} → ${ev.toStatus.replace(
                    /_/g,
                    ' ',
                  )}`
                : ev.toStatus.replace(/_/g, ' ')
            }
            secondary={`${new Date(ev.createdAt).toLocaleString()}${
              ev.actor ? ` · ${ev.actor}` : ''
            }${ev.note ? ` · ${ev.note}` : ''}`}
          />
        </ListItem>
      ))}
    </List>
  );
}

export function DeploymentsPage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const { persona } = usePersona();
  const canAccess =
    persona === 'cloudhub-platform' ||
    persona === 'professional-services' ||
    persona === 'app-engineering' ||
    persona === 'sre';
  const canWrite = persona === 'cloudhub-platform';

  const api = useMemo(
    () => createPlatformRegistryApi(backendFetch, persona),
    [backendFetch, persona],
  );

  const { data: referenceData, reload: reloadReferences } = useReferenceData(
    api,
    ['deploymentTargets', 'applications'],
  );

  const [rows, setRows] = useState<Deployment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuRow, setMenuRow] = useState<Deployment | null>(null);

  const [historyFor, setHistoryFor] = useState<Deployment | null>(null);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const load = useCallback(() => {
    if (!canAccess) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listDeployments({ page, pageSize, search: search || undefined })
      .then(result => {
        if (cancelled) return;
        setRows(result.items);
        setTotal(result.total);
      })
      .catch(err => {
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, page, pageSize, search, canAccess, refreshKey]);

  useEffect(() => load(), [load]);

  const refresh = () => setRefreshKey(k => k + 1);

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.createDeployment(values);
      setDialogOpen(false);
      refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTransition = (row: Deployment, status: DeploymentStatus) => {
    setMenuAnchor(null);
    runAction(() =>
      api.transitionDeployment(row.id, { status, actor: persona }),
    );
  };

  const handleRollback = (row: Deployment) =>
    runAction(() => api.rollbackDeployment(row.id, { actor: persona }));

  const openHistory = async (row: Deployment) => {
    setHistoryFor(row);
    setEvents([]);
    setEventsLoading(true);
    try {
      const result = await api.listDeploymentEvents(row.id);
      setEvents(result.items);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setEventsLoading(false);
    }
  };

  const renderActions = (row: Deployment) => {
    const next = NEXT_STATUSES[row.status] ?? [];
    const canRollback = row.status === 'active' || row.status === 'failed';
    return (
      <>
        {next.length > 0 && (
          <Tooltip title="Advance">
            <IconButton
              size="small"
              onClick={e => {
                setMenuAnchor(e.currentTarget);
                setMenuRow(row);
              }}
            >
              <PlayArrowIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {canRollback && (
          <Tooltip title="Roll back">
            <IconButton size="small" onClick={() => handleRollback(row)}>
              <ReplayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="History">
          <IconButton size="small" onClick={() => openHistory(row)}>
            <HistoryIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    );
  };

  return (
    <Page themeId="tool">
      <Header
        title="Platform Registry"
        subtitle="Deployments"
        type="Platform Registry"
      />
      <Content>
        <ContentHeader title="Deployments">
          <SupportButton>
            Track application deployments and their lifecycle across targets.
          </SupportButton>
        </ContentHeader>

        {!canAccess ? (
          <div className={classes.noAccess}>
            <Typography variant="h6">Access restricted</Typography>
            <Typography color="textSecondary">
              The Platform Registry is available to platform administrators and
              professional services personas.
            </Typography>
          </div>
        ) : (
          <>
            <div className={classes.toolbar}>
              <TextField
                className={classes.search}
                label="Search deployments"
                variant="outlined"
                size="small"
                value={search}
                onChange={e => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
              />
              {canWrite && (
                <Button
                  color="primary"
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    setSubmitError(null);
                    reloadReferences();
                    setDialogOpen(true);
                  }}
                >
                  New Deployment
                </Button>
              )}
            </div>

            {actionError && (
              <Box mb={2}>
                <InlineAlert severity="error">{actionError}</InlineAlert>
              </Box>
            )}
            {error && <ResponseErrorPanel error={error} />}
            {loading && <Progress />}

            {!loading && !error && (
              <TableContainer className={classes.tableCard}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell className={classes.headerCell}>
                        Application
                      </TableCell>
                      <TableCell className={classes.headerCell}>
                        Target
                      </TableCell>
                      <TableCell className={classes.headerCell}>
                        Version
                      </TableCell>
                      <TableCell className={classes.headerCell}>
                        Status
                      </TableCell>
                      <TableCell className={classes.headerCell}>
                        Deployed By
                      </TableCell>
                      <TableCell className={classes.headerCell}>
                        Deployed At
                      </TableCell>
                      <TableCell className={classes.headerCell} align="right">
                        Actions
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className={classes.empty}>
                          No deployments found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map(row => (
                        <TableRow key={row.id} hover>
                          <TableCell>{row.applicationName ?? '—'}</TableCell>
                          <TableCell>{row.targetName ?? '—'}</TableCell>
                          <TableCell>{row.version ?? '—'}</TableCell>
                          <TableCell>
                            <StatusChip status={row.status} />
                          </TableCell>
                          <TableCell>{row.deployedBy ?? '—'}</TableCell>
                          <TableCell>
                            {new Date(row.deployedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className={classes.actionsCell}>
                            {canWrite ? (
                              renderActions(row)
                            ) : (
                              <Tooltip title="History">
                                <IconButton
                                  size="small"
                                  onClick={() => openHistory(row)}
                                >
                                  <HistoryIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <TablePagination
                  component="div"
                  count={total}
                  page={page}
                  onPageChange={(_e, newPage) => setPage(newPage)}
                  rowsPerPage={pageSize}
                  onRowsPerPageChange={e => {
                    setPageSize(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[10, 25, 50, 100]}
                />
              </TableContainer>
            )}
          </>
        )}

        <Menu
          anchorEl={menuAnchor}
          open={!!menuAnchor}
          onClose={() => setMenuAnchor(null)}
        >
          {menuRow &&
            (NEXT_STATUSES[menuRow.status] ?? []).map(status => (
              <MenuItem
                key={status}
                onClick={() => handleTransition(menuRow, status)}
              >
                Move to {STATUS_LABEL[status]}
              </MenuItem>
            ))}
        </Menu>

        <CreateEntityDialog
          open={dialogOpen}
          title="New Deployment"
          fields={createFields}
          referenceData={referenceData}
          submitting={submitting}
          error={submitError}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCreate}
        />

        <Dialog
          open={!!historyFor}
          onClose={() => setHistoryFor(null)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            Deployment history
            {historyFor?.applicationName
              ? ` — ${historyFor.applicationName}`
              : ''}
          </DialogTitle>
          <DialogContent>
            {renderHistoryContent(eventsLoading, events)}
          </DialogContent>
        </Dialog>
      </Content>
    </Page>
  );
}
