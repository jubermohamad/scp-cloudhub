import { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { DEFAULT_SORT, SORTABLE } from '../../gridQuery';
import type { AuditEvent } from '../../types';
import { useServerGrid } from '../../useServerGrid';
import { formatDateTime, prettyJson } from '../../utils';
import { CodeBlock } from '../common/CodeBlock';
import { DetailField } from '../common/DetailField';
import { EntityFilterBar } from '../common/EntityFilterBar';
import { useHub } from '../common/HubContext';
import { ServerDataGrid } from '../common/ServerDataGrid';

/** One-line preview of an audit event's details for the grid cell. */
export function auditDetailsPreview(details: Record<string, unknown>): string {
  const entries = Object.entries(details ?? {});
  if (entries.length === 0) return '—';
  return entries
    .map(
      ([key, value]) =>
        `${key}=${
          typeof value === 'object' ? JSON.stringify(value) : String(value)
        }`,
    )
    .join(', ');
}

export function AuditLogGrid() {
  const { api, filterOptions } = useHub();
  const grid = useServerGrid<AuditEvent>(query => api.listAudit(query), {
    allowedSort: SORTABLE.audit,
    defaultSort: DEFAULT_SORT.audit,
  });
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const columns = useMemo<GridColDef<AuditEvent>[]>(
    () => [
      {
        field: 'occurredAt',
        headerName: 'Time',
        minWidth: 180,
        valueFormatter: (value: string) => formatDateTime(value),
      },
      { field: 'actor', headerName: 'Actor', minWidth: 180, flex: 1 },
      {
        field: 'action',
        headerName: 'Action',
        minWidth: 160,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap>
            {row.action}
          </Typography>
        ),
      },
      {
        field: 'entityType',
        headerName: 'Entity',
        minWidth: 180,
        sortable: false,
        renderCell: ({ row }) => (
          <Stack minWidth={0} lineHeight={1.2}>
            <Typography variant="body2" noWrap>
              {row.entityType}
            </Typography>
            {row.entityId && (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ fontFamily: 'monospace' }}
              >
                {row.entityId}
              </Typography>
            )}
          </Stack>
        ),
      },
      {
        field: 'tenantId',
        headerName: 'Tenant',
        minWidth: 110,
        sortable: false,
        valueFormatter: (value: string | null) => value ?? '—',
      },
      {
        field: 'details',
        headerName: 'Details',
        minWidth: 260,
        flex: 1.5,
        sortable: false,
        renderCell: ({ row }) => (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            minWidth={0}
            width="100%"
          >
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ flex: 1, minWidth: 0 }}
            >
              {auditDetailsPreview(row.details)}
            </Typography>
            <Button
              size="small"
              onClick={() => setSelected(row)}
              sx={{ flexShrink: 0 }}
            >
              Expand
            </Button>
          </Stack>
        ),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <EntityFilterBar
        filters={grid.filters}
        onFilterChange={grid.setFilter}
        onClear={grid.clearFilters}
        show={['tenant', 'dateRange']}
        options={filterOptions}
        search={{
          value: grid.searchInput,
          onChange: grid.setSearchInput,
          placeholder: 'Actor, action or entity',
        }}
        extra={[
          {
            key: 'entityType',
            label: 'Entity type',
            placeholder: 'e.g. EXPORT',
          },
        ]}
      />
      <ServerDataGrid<AuditEvent>
        ariaLabel="Audit log"
        columns={columns}
        {...grid.gridProps}
        error={grid.error}
        emptyMessage="No audit events match these filters."
        onRowDoubleClick={({ row }) => setSelected(row)}
      />
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="dx-audit-title"
      >
        <DialogTitle id="dx-audit-title">Audit event</DialogTitle>
        <DialogContent>
          {selected && (
            <Stack spacing={1.5}>
              <DetailField label="Time">
                {formatDateTime(selected.occurredAt)}
              </DetailField>
              <DetailField label="Actor">{selected.actor}</DetailField>
              <DetailField label="Action" mono>
                {selected.action}
              </DetailField>
              <DetailField label="Entity">
                {selected.entityType}
                {selected.entityId ? ` · ${selected.entityId}` : ''}
              </DetailField>
              <DetailField label="Tenant">{selected.tenantId}</DetailField>
              <CodeBlock ariaLabel="Event details">
                {prettyJson(selected.details) || '{}'}
              </CodeBlock>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
