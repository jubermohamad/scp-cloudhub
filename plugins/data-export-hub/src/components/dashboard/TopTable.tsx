import { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

export interface TopColumn<T> {
  label: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

/** Small ranked table for dashboard widgets (not a paged grid). */
export function TopTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  ariaLabel,
}: {
  rows: T[];
  columns: TopColumn<T>[];
  rowKey: (row: T) => string;
  empty: string;
  ariaLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  return (
    <TableContainer>
      <Table size="small" aria-label={ariaLabel}>
        <TableHead>
          <TableRow>
            {columns.map(column => (
              <TableCell
                key={column.label}
                align={column.numeric ? 'right' : 'left'}
              >
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => (
            <TableRow key={rowKey(row)}>
              {columns.map(column => (
                <TableCell
                  key={column.label}
                  align={column.numeric ? 'right' : 'left'}
                  sx={
                    column.numeric
                      ? { fontVariantNumeric: 'tabular-nums' }
                      : undefined
                  }
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
