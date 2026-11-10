import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { ProvisionCustomerModal } from './ProvisionCustomerModal';

export function NewAppPage(): JSX.Element {
  const [openProvision, setOpenProvision] = useState(false);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  return (
    <Box sx={{ padding: 3, maxWidth: 1000 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        New App
      </Typography>
      <Typography variant="body1" sx={{ mb: 2 }}>
        Create a new application entry and provision customer environments via the
        1Password flow.
      </Typography>
      <Button variant="contained" onClick={() => setOpenProvision(true)}>
        + New Customer / Env
      </Button>

      <ProvisionCustomerModal
        open={openProvision}
        loading={provisionLoading}
        error={provisionError}
        defaultEnvironment="dev"
        onClose={() => setOpenProvision(false)}
        onProvision={() => {
          // For now, delegate to modal; actual provisioning handled elsewhere by existing flows.
          setProvisionLoading(true);
          setProvisionError(null);
          // Placeholder: consumer will trigger provisioning via backend events.
          setTimeout(() => {
            setProvisionLoading(false);
            setOpenProvision(false);
          }, 800);
        }}
      />
    </Box>
  );
}
