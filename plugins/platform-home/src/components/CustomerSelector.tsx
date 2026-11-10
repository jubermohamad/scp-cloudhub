import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';

interface CustomerSelectorProps {
  customers: string[];
  loading: boolean;
  value: string;
  error?: string | null;
  helperText?: string;
  onValueChange: (value: string) => void;
}

export function CustomerSelector({
  customers,
  loading,
  value,
  error,
  helperText,
  onValueChange,
}: CustomerSelectorProps): JSX.Element {
  const [inputValue, setInputValue] = useState(value);
  const options = [...customers].sort((left, right) => left.localeCompare(right));

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const validationMessage = useMemo(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = slugify(trimmed);
    if (!normalized) {
      return 'Customer may only contain lowercase letters, numbers, and hyphens.';
    }
    if (!/^[a-z0-9-]+$/.test(normalized)) {
      return 'Customer may only contain lowercase letters, numbers, and hyphens.';
    }
    return null;
  }, [inputValue]);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const commitValue = (next: string) => {
    const normalized = slugify(next);
    onValueChange(normalized);
    setInputValue(normalized);
  };

  return (
    <Box display="flex" gap={1} alignItems="flex-start">
      <Autocomplete
        freeSolo
        options={options}
        value={value}
        inputValue={inputValue}
        loading={loading}
        onInputChange={(_, nextValue) => {
          setInputValue(nextValue);
        }}
        onChange={(_, nextValue) => {
          commitValue(typeof nextValue === 'string' ? nextValue : '');
        }}
        onBlur={() => {
          commitValue(inputValue);
        }}
        isOptionEqualToValue={(option, val) => option === val}
        getOptionLabel={option => (typeof option === 'string' ? option : '')}
        renderInput={params => (
          <TextField
            {...params}
            error={Boolean(error) || Boolean(validationMessage)}
            helperText={error || validationMessage || helperText}
            placeholder={
              loading
                ? 'Loading customers…'
                : options.length > 0
                ? 'Select a customer or type customer identifier'
                : 'e.g. sri, acme-corp (enter customer identifier)'
            }
            variant="outlined"
            size="small"
            fullWidth
          />
        )}
        renderOption={(props, option) => (
          <li {...props} key={option}>
            <Typography variant="body2">{option}</Typography>
          </li>
        )}
        sx={{ flex: 1, minWidth: 0 }}
        ListboxProps={{ style: { maxHeight: 280 } }}
        noOptionsText="No customers found (type to enter a customer)"
      />
    </Box>
  );
}