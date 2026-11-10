import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import { DataGrid, DataGridProps, GridValidRowModel } from '@mui/x-data-grid';
import { PAGE_SIZE_OPTIONS } from '../../gridQuery';

type Props<T extends GridValidRowModel> = Omit<DataGridProps<T>, 'rows'> & {
  rows: T[];
  error?: string | null;
  /** Shown when the query returns nothing. */
  emptyMessage: string;
  ariaLabel: string;
};

function EmptyOverlay({ message }: { message: string }) {
  return (
    <Stack height="100%" alignItems="center" justifyContent="center" p={3}>
      <Typography color="text.secondary" textAlign="center">
        {message}
      </Typography>
    </Stack>
  );
}

/**
 * DataGrid with the hub's defaults: server-side paging/sorting/filtering
 * (column filter UI is disabled because filters come from the filter bar),
 * skeleton loading, an empty state, horizontal scrolling on narrow screens
 * and theme-only colours.
 */
export function ServerDataGrid<T extends GridValidRowModel>({
  error,
  emptyMessage,
  ariaLabel,
  sx,
  slots,
  slotProps,
  ...props
}: Props<T>) {
  return (
    <Stack spacing={1}>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={{ width: '100%', overflow: 'hidden' }}>
        <Box sx={{ width: '100%' }}>
          <DataGrid<T>
            aria-label={ariaLabel}
            autoHeight
            density="compact"
            rowHeight={52}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            disableColumnFilter
            disableRowSelectionOnClick
            sortingOrder={['asc', 'desc']}
            slots={{
              noRowsOverlay: () => <EmptyOverlay message={emptyMessage} />,
              noResultsOverlay: () => <EmptyOverlay message={emptyMessage} />,
              ...slots,
            }}
            slotProps={{
              loadingOverlay: {
                variant: 'skeleton',
                noRowsVariant: 'skeleton',
              },
              ...slotProps,
            }}
            sx={[
              {
                border: 0,
                minHeight: 220,
                '& .MuiDataGrid-columnHeaderTitle': {
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  fontSize: '0.72rem',
                  letterSpacing: '0.04em',
                  color: 'text.secondary',
                },
                '& .MuiDataGrid-cell': {
                  display: 'flex',
                  alignItems: 'center',
                },
                '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus':
                  { outline: 'none' },
                '& .dx-row-muted': { color: 'text.secondary' },
              },
              ...(Array.isArray(sx) ? sx : [sx]),
            ]}
            {...props}
          />
        </Box>
      </Paper>
    </Stack>
  );
}
