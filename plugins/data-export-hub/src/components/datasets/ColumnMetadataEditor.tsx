import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { parseColumns } from '../../datasetForm';
import type { DatasetColumn } from '../../types';

interface Props {
  columns: DatasetColumn[];
  onChange: (columns: DatasetColumn[]) => void;
}

/** Row editor for column metadata, with a bulk "paste" option for long schemas. */
export function ColumnMetadataEditor({ columns, onChange }: Props) {
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const set = (index: number, patch: Partial<DatasetColumn>) =>
    onChange(
      columns.map((column, i) =>
        i === index ? { ...column, ...patch } : column,
      ),
    );

  return (
    <Stack spacing={1}>
      <TableContainer
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          maxHeight: 360,
        }}
      >
        <Table size="small" stickyHeader aria-label="Column metadata">
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 160 }}>Name</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Type</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Description</TableCell>
              <TableCell padding="checkbox">Nullable</TableCell>
              <TableCell padding="checkbox">PII</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {columns.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">
                    No columns yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {columns.map((column, index) => (
              // Rows have no stable id while being edited.
              // eslint-disable-next-line react/no-array-index-key
              <TableRow key={index}>
                <TableCell>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={column.name}
                    onChange={e => set(index, { name: e.target.value })}
                    inputProps={{
                      'aria-label': `Column ${index + 1} name`,
                      style: { fontFamily: 'monospace' },
                    }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={column.type ?? ''}
                    onChange={e => set(index, { type: e.target.value })}
                    inputProps={{ 'aria-label': `Column ${index + 1} type` }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={column.description ?? ''}
                    onChange={e => set(index, { description: e.target.value })}
                    inputProps={{
                      'aria-label': `Column ${index + 1} description`,
                    }}
                  />
                </TableCell>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={column.nullable ?? false}
                    onChange={(_e, checked) =>
                      set(index, { nullable: checked })
                    }
                    inputProps={{
                      'aria-label': `Column ${index + 1} nullable`,
                    }}
                  />
                </TableCell>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={column.pii ?? false}
                    onChange={(_e, checked) => set(index, { pii: checked })}
                    inputProps={{
                      'aria-label': `Column ${index + 1} contains PII`,
                    }}
                  />
                </TableCell>
                <TableCell padding="checkbox">
                  <Tooltip title="Remove column">
                    <IconButton
                      size="small"
                      aria-label={`Remove column ${index + 1}`}
                      onClick={() =>
                        onChange(columns.filter((_c, i) => i !== index))
                      }
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => onChange([...columns, { name: '' }])}
        >
          Add column
        </Button>
        <Button size="small" onClick={() => setShowBulk(value => !value)}>
          {showBulk ? 'Hide bulk add' : 'Bulk add'}
        </Button>
      </Stack>
      {showBulk && (
        <Box>
          <TextField
            fullWidth
            multiline
            minRows={3}
            size="small"
            label="Paste columns"
            placeholder={'CASE_ID NUMBER - Case key\nSTATUS VARCHAR2(20)'}
            helperText="One per line: NAME [TYPE] [- description]. Appended to the table."
            value={bulk}
            onChange={e => setBulk(e.target.value)}
          />
          <Button
            size="small"
            sx={{ mt: 1 }}
            disabled={!bulk.trim()}
            onClick={() => {
              onChange([...columns, ...parseColumns(bulk)]);
              setBulk('');
              setShowBulk(false);
            }}
          >
            Add pasted columns
          </Button>
        </Box>
      )}
    </Stack>
  );
}
