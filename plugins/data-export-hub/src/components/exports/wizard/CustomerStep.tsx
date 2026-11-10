import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Grid,
  Radio,
  Stack,
  Typography,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { StepProps } from './types';

interface CustomerItem {
  customerName: string;
  customerId?: string;
  platformCode?: string;
}

export function CustomerStep({ form, update }: StepProps) {
  const backendFetch = useBackendFetch();
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    backendFetch('platform-registry', '/customers')
      .then(async res => {
        if (!res.ok) {
          throw new Error(
            `Platform Registry request failed with HTTP ${res.status}`,
          );
        }
        const data = await res.json();
        return Array.isArray(data) ? (data as CustomerItem[]) : [];
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : 'Unable to load customers from Platform Registry.',
          );
        }
        return [] as CustomerItem[];
      })
      .then(list => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) =>
          (a.customerName || '').localeCompare(b.customerName || '', undefined, {
            sensitivity: 'base',
          }),
        );
        setCustomers(sorted);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backendFetch]);

  const handleSelect = (c: CustomerItem) => {
    const slug = (c.platformCode || c.customerName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    update({
      customerName: c.customerName,
      tenantId: slug,
      clusterId: '',
      clusterLabel: '',
    });
  };

  if (loading) {
    return (
      <Stack alignItems="center" py={4}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary" mt={1}>
          Loading customers from Platform Registry…
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Select the NetReveal SaaS customer for this export.
      </Typography>

      {loadError && (
        <Alert severity="warning" variant="outlined">
          Unable to refresh customers from Platform Registry: {loadError}
        </Alert>
      )}

      {customers.length === 0 && (
        <Alert severity="info" variant="outlined">
          No customers were returned by Platform Registry. Register customers in
          Platform Registry first.
        </Alert>
      )}

      <Grid container spacing={2}>
        {customers.map(c => {
          const slug = (c.platformCode || c.customerName)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          const isSelected = form.tenantId === slug;
          return (
            <Grid item xs={12} sm={6} key={slug}>
              <Card
                variant="outlined"
                sx={{
                  borderColor: isSelected ? 'primary.main' : 'divider',
                  bgcolor: isSelected ? 'action.selected' : 'background.paper',
                  borderWidth: isSelected ? 2 : 1,
                  borderRadius: 2,
                }}
              >
                <CardActionArea onClick={() => handleSelect(c)}>
                  <CardContent
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      py: 1.5,
                    }}
                  >
                    <Radio checked={isSelected} value={slug} />
                    <BusinessIcon color={isSelected ? 'primary' : 'action'} />
                    <Stack>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {c.customerName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Tenant ID: {slug}
                      </Typography>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Stack>
  );
}
