import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Content,
  ContentHeader,
  Header,
  Page,
  Progress,
  ResponseErrorPanel,
  SupportButton,
} from '@backstage/core-components';
import { Box, Button, IconButton, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from '../../api';
import type { ListResult } from '../../types';
import { CreateEntityDialog, FieldDef } from './CreateEntityDialog';
import { InlineAlert } from './InlineAlert';
import { ReferenceKey, useReferenceData } from './useReferenceData';

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
  empty: {
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  noAccess: {
    padding: theme.spacing(4),
    textAlign: 'center',
  },
  actionsCell: {
    width: 64,
    textAlign: 'right',
  },
}));

export interface ColumnDef<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

type Api = ReturnType<typeof createPlatformRegistryApi>;

interface RegistryListPageProps<T> {
  title: string;
  subtitle: string;
  pageType: string;
  columns: ColumnDef<T>[];
  fetcher: (
    api: Api,
    args: { page: number; pageSize: number; search?: string },
  ) => Promise<ListResult<T>>;
  searchPlaceholder?: string;
  /** Field definitions for the "Create" dialog. Omit to disable creation. */
  createFields?: FieldDef[];
  createLabel?: string;
  onCreate?: (api: Api, values: Record<string, unknown>) => Promise<unknown>;
  onDelete?: (api: Api, id: string) => Promise<void>;
  /** Reference lists to preload for select fields in the create dialog. */
  referenceKeys?: ReferenceKey[];
  /** Hide the create button even when create fields/handler exist. */
  hideCreateButton?: boolean;
  /** Show a manual refresh button that reloads latest data from backend. */
  showRefreshButton?: boolean;
  /** Optional label for the refresh action button. */
  refreshLabel?: string;
  /** Page-specific explanation when the live inventory is empty. */
  emptyMessage?: string;
  extraTabs?: ReactNode;
}

export function RegistryListPage<T extends { id: string }>(
  props: RegistryListPageProps<T>,
) {
  const {
    title,
    subtitle,
    pageType,
    columns,
    fetcher,
    searchPlaceholder,
    createFields,
    createLabel,
    onCreate,
    onDelete,
    referenceKeys = [],
    hideCreateButton = false,
    showRefreshButton = false,
    refreshLabel = 'Refresh',
    emptyMessage = 'No records found.',
    extraTabs,
  } = props;
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

  const [rows, setRows] = useState<T[]>([]);
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
  const [toast, setToast] = useState<string | null>(null);

  const { data: referenceData, reload: reloadReferences } = useReferenceData(
    api,
    referenceKeys,
  );

  const showActions = canWrite && !!onDelete;
  const canCreate = !hideCreateButton && canWrite && !!createFields && !!onCreate;

  const load = useCallback(() => {
    if (!canAccess) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(api, { page, pageSize, search: search || undefined })
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
  }, [api, page, pageSize, search, canAccess, fetcher, refreshKey]);

  useEffect(() => load(), [load]);

  const handleOpenCreate = () => {
    setSubmitError(null);
    if (referenceKeys.length > 0) reloadReferences();
    setDialogOpen(true);
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!onCreate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onCreate(api, values);
      setDialogOpen(false);
      setToast('Created successfully');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    try {
      await onDelete(api, id);
      setToast('Deleted');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError(err as Error);
    }
  };

  const colCount = columns.length + (showActions ? 1 : 0);

  return (
    <Page themeId="tool">
      <Header title={title} subtitle={subtitle} type="" />
      <Content>
        {extraTabs}

        <ContentHeader title={pageType}>
          <SupportButton>
            Authoritative inventory of platform resources.
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
                label={searchPlaceholder ?? 'Search'}
                variant="outlined"
                size="small"
                value={search}
                onChange={e => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
              />
              {showRefreshButton && (
                <Button
                  color="primary"
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => setRefreshKey(k => k + 1)}
                >
                  {refreshLabel}
                </Button>
              )}
              {canCreate && (
                <Button
                  color="primary"
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={handleOpenCreate}
                >
                  {createLabel ?? `New ${pageType.replace(/s$/, '')}`}
                </Button>
              )}
            </div>

            {error && <ResponseErrorPanel error={error} />}
            {loading && <Progress />}

            {!loading && !error && (
              <TableContainer className={classes.tableCard}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {columns.map(col => (
                        <TableCell key={col.key} className={classes.headerCell}>
                          {col.label}
                        </TableCell>
                      ))}
                      {showActions && (
                        <TableCell className={classes.headerCell} align="right">
                          Actions
                        </TableCell>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colCount} className={classes.empty}>
                          {emptyMessage}
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map(row => (
                        <TableRow key={row.id} hover>
                          {columns.map(col => (
                            <TableCell key={col.key}>
                              {col.render(row)}
                            </TableCell>
                          ))}
                          {showActions && (
                            <TableCell className={classes.actionsCell}>
                              <Tooltip title="Delete">
                                <IconButton
                                  size="small"
                                  onClick={() => handleDelete(row.id)}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          )}
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

            {!canWrite && (
              <Box mt={2}>
                <Typography variant="caption" color="textSecondary">
                  You have read-only access. Create and delete actions require
                  the platform administrator persona.
                </Typography>
              </Box>
            )}
          </>
        )}

        {canCreate && createFields && (
          <CreateEntityDialog
            open={dialogOpen}
            title={createLabel ?? `New ${pageType.replace(/s$/, '')}`}
            fields={createFields}
            referenceData={referenceData}
            submitting={submitting}
            error={submitError}
            onClose={() => setDialogOpen(false)}
            onSubmit={handleSubmit}
          />
        )}

        <Snackbar
          open={!!toast}
          autoHideDuration={3000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <div>
            <InlineAlert severity="success">{toast}</InlineAlert>
          </div>
        </Snackbar>
      </Content>
    </Page>
  );
}
