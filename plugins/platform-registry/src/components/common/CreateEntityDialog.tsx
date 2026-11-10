import { useMemo, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, ListItemText, MenuItem, Select, TextField, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import type { FieldOption, ReferenceKey } from './useReferenceData';

export type FieldType = 'text' | 'select' | 'reference' | 'multiselect';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  referenceKey?: ReferenceKey;
  helperText?: string;
}

const useStyles = makeStyles(theme => ({
  field: {
    marginBottom: theme.spacing(2),
  },
  error: {
    color: theme.palette.error.main,
    marginTop: theme.spacing(1),
  },
}));

interface CreateEntityDialogProps {
  open: boolean;
  title: string;
  fields: FieldDef[];
  referenceData: Record<string, FieldOption[]>;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}

export function CreateEntityDialog(props: CreateEntityDialogProps) {
  const {
    open,
    title,
    fields,
    referenceData,
    submitting,
    error,
    onClose,
    onSubmit,
  } = props;
  const classes = useStyles();
  const [values, setValues] = useState<Record<string, unknown>>({});

  const optionsFor = (field: FieldDef): FieldOption[] => {
    if (field.type === 'reference' && field.referenceKey) {
      return referenceData[field.referenceKey] ?? [];
    }
    return field.options ?? [];
  };

  const missingRequired = useMemo(
    () =>
      fields
        .filter(f => f.required)
        .some(f => {
          const v = values[f.name];
          if (f.type === 'multiselect')
            return !Array.isArray(v) || v.length === 0;
          return v === undefined || v === null || v === '';
        }),
    [fields, values],
  );

  const setValue = (name: string, value: unknown) =>
    setValues(prev => ({ ...prev, [name]: value }));

  const handleSubmit = () => {
    // Drop empty optional strings so the backend stores nulls.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === '' || v === undefined) continue;
      cleaned[k] = v;
    }
    onSubmit(cleaned);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {fields.map(field => {
          if (field.type === 'text') {
            return (
              <TextField
                key={field.name}
                className={classes.field}
                label={field.label}
                required={field.required}
                fullWidth
                variant="outlined"
                size="small"
                helperText={field.helperText}
                value={(values[field.name] as string) ?? ''}
                onChange={e => setValue(field.name, e.target.value)}
              />
            );
          }

          if (field.type === 'multiselect') {
            const selected = (values[field.name] as string[]) ?? [];
            return (
              <FormControl
                key={field.name}
                className={classes.field}
                fullWidth
                variant="outlined"
                size="small"
              >
                <InputLabel>{field.label}</InputLabel>
                <Select
                  multiple
                  label={field.label}
                  value={selected}
                  renderValue={vals => (vals as string[]).join(', ')}
                  onChange={e =>
                    setValue(field.name, e.target.value as string[])
                  }
                >
                  {optionsFor(field).map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>
                      <Checkbox checked={selected.indexOf(opt.value) > -1} />
                      <ListItemText primary={opt.label} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            );
          }

          // select / reference
          return (
            <FormControl
              key={field.name}
              className={classes.field}
              fullWidth
              variant="outlined"
              size="small"
              required={field.required}
            >
              <InputLabel>{field.label}</InputLabel>
              <Select
                label={field.label}
                value={(values[field.name] as string) ?? ''}
                onChange={e => setValue(field.name, e.target.value)}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {optionsFor(field).map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          );
        })}

        {error && (
          <Typography variant="body2" className={classes.error}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          color="primary"
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || missingRequired}
        >
          {submitting ? 'Saving…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
