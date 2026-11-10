import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

const CUSTOMER_CODE_RE = /^[a-z0-9-]+$/;

export function validateCustomerCode(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Customer code is required.';
  }
  if (!CUSTOMER_CODE_RE.test(trimmed)) {
    return 'Customer code may only contain lowercase letters, numbers, and hyphens.';
  }
  return null;
}

interface ProvisionCustomerModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  defaultEnvironment: string;
  onClose: () => void;
  onProvision: (input: { customerCode: string; environment: string }) => void;
}

export function ProvisionCustomerModal({
  open,
  loading,
  error,
  defaultEnvironment,
  onClose,
  onProvision,
}: ProvisionCustomerModalProps): JSX.Element | null {
  const [customerCode, setCustomerCode] = useState('');
  const [environment, setEnvironment] = useState(defaultEnvironment);
  const customerCodeError = validateCustomerCode(customerCode);

  useEffect(() => {
    if (!open) {
      setCustomerCode('');
      setEnvironment(defaultEnvironment);
    }
  }, [defaultEnvironment, open]);

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Onboard New Customer / Env</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Create a new customer code and boot the 1Password secret provisioning flow in place.
        </Typography>

        {error ? (
          <Typography
            variant="body2"
            sx={{
              mb: 2,
              p: 1.5,
              borderRadius: 1,
              bgcolor: '#FEF2F2',
              color: '#B91C1C',
              border: '1px solid #FECACA',
            }}
          >
            {error}
          </Typography>
        ) : null}

        <TextField
          label="Customer Code"
          value={customerCode}
          onChange={event => setCustomerCode(event.target.value)}
          placeholder="e.g. cust-demo"
          size="small"
          fullWidth
          margin="normal"
          disabled={loading}
          error={Boolean(customerCodeError)}
          helperText={
            customerCodeError ??
            'Use lowercase letters, numbers, and hyphens only.'
          }
        />

        <TextField
          select
          label="Environment"
          value={environment}
          onChange={event => setEnvironment(event.target.value)}
          size="small"
          fullWidth
          margin="normal"
          disabled={loading}
        >
          {['dev', 'qa', 'uat', 'prod'].map(option => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            const customerError = validateCustomerCode(customerCode);
            if (customerError) {
              return;
            }
            onProvision({ customerCode: customerCode.trim(), environment });
          }}
          disabled={loading || !!customerCodeError || customerCode.trim().length === 0}
        >
          {loading ? 'Provisioning…' : 'Provision'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}