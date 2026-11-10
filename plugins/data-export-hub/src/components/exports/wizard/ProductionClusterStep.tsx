import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Radio,
  Stack,
  Typography,
} from '@mui/material';
import LanIcon from '@mui/icons-material/Lan';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { StepProps } from './types';

interface ClusterOption {
  id: string;
  clusterName: string;
  environment: string;
  status?: string;
  active?: boolean;
  customerName?: string;
  customerTag?: string;
  envTag?: string;
  region?: string | null;
  resourceGroup?: string | null;
  postgresReportingService?: string | null;
  postgresReportingNamespace?: string | null;
}

export function ProductionClusterStep({ form, update, api }: StepProps) {
  const backendFetch = useBackendFetch();
  const [clusters, setClusters] = useState<ClusterOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const customer = form.tenantId || form.customerName || 'metrobank';
    const loadFromRegistry = backendFetch(
      'platform-registry',
      `/customers/${encodeURIComponent(customer)}/clusters?environment=PROD`,
    )
      .then(async res => {
        if (!res.ok) return [];
        const list = (await res.json()) as ClusterOption[];
        const target = (form.tenantId || form.customerName || '')
          .trim()
          .toLowerCase();
        const targetCompact = target.replace(/\s+/g, '');

        return list.filter(item => {
          const status = String(item.status ?? '').trim().toLowerCase();
          const isActive =
            status ? status === 'active' : item.active !== false;
          if (!isActive) return false;

          const env = (
            item.envTag ||
            item.environment ||
            'PROD'
          )
            .trim()
            .toUpperCase();
          const isProd = env === 'PROD' || env.startsWith('PRODUCTION');
          if (!target) return isProd;

          const customerValues = [
            item.customerTag,
            item.customerName,
          ]
            .map(v => (v || '').trim().toLowerCase())
            .filter(Boolean);
          const matchesCustomer = customerValues.some(
            value => value === target || value.replace(/\s+/g, '') === targetCompact,
          );

          return isProd && matchesCustomer;
        });
      })
      .catch(() => []);

    const loadFromHub = api
      .listClusters({ tenantId: form.tenantId })
      .then(page =>
        page.items
          .filter(
            c =>
              !c.isRetired &&
              (c.environment === 'PRODUCTION' ||
                (c.environment as string) === 'PROD'),
          )
          .map(c => ({
            id: c.id,
            clusterName: c.clusterName,
            environment: 'PROD',
            region: c.region,
            resourceGroup: c.resourceGroup,
          })),
      )
      .catch(() => []);

    Promise.all([loadFromRegistry, loadFromHub]).then(([regList, hubList]) => {
      if (cancelled) return;
      const combined = new Map<string, ClusterOption>();
      for (const c of hubList) {
        combined.set(c.clusterName, c);
      }
      for (const c of regList) {
        combined.set(c.clusterName, {
          id: c.id || c.clusterName,
          clusterName: c.clusterName,
          environment: c.environment || 'PROD',
          status: c.status,
          active: c.active,
          customerName: c.customerName,
          customerTag: c.customerTag,
          envTag: c.envTag,
          region: c.region,
          resourceGroup: c.resourceGroup,
          postgresReportingService: c.postgresReportingService,
          postgresReportingNamespace: c.postgresReportingNamespace,
        });
      }
      setClusters(Array.from(combined.values()));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [backendFetch, form.tenantId, form.customerName, api]);

  const handleSelect = (c: ClusterOption) => {
    update({
      clusterId: c.id,
      clusterLabel: c.clusterName,
      environment: 'PRODUCTION',
      namespace: c.postgresReportingNamespace || 'nrod',
    });
  };

  if (loading) {
    return (
      <Stack alignItems="center" py={4}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary" mt={1}>
          Loading production AKS clusters for {form.customerName}…
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          Select a verified production AKS cluster (filtered by environment =
          PROD).
        </Typography>
        <Chip
          icon={<VerifiedUserIcon />}
          label="environment: PROD only"
          size="small"
          color="primary"
          variant="outlined"
        />
      </Stack>

      <Alert severity="info" variant="outlined">
        Data Export agents connect <strong>only</strong> to the read-only{' '}
        <code>postgres-ro</code> replica endpoint. Writer/primary connections
        are strictly prohibited.
      </Alert>

      {clusters.length === 0 && (
        <Alert severity="warning" variant="outlined">
          No production clusters registered.
        </Alert>
      )}

      <Grid container spacing={2}>
        {clusters.map(c => {
          const isSelected = form.clusterId === c.id;
          return (
            <Grid item xs={12} key={c.clusterName}>
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
                      gap: 2,
                      py: 1.5,
                    }}
                  >
                    <Radio checked={isSelected} value={c.id} />
                    <LanIcon color={isSelected ? 'primary' : 'action'} />
                    <Stack flex={1}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography
                          variant="subtitle2"
                          fontWeight={700}
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {c.clusterName}
                        </Typography>
                        <Chip
                          label="PROD"
                          size="small"
                          color="success"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                        {c.region && (
                          <Chip
                            label={c.region}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        PostgreSQL Endpoint:{' '}
                        <code>
                          {c.postgresReportingService || 'postgres-ro'}.
                          {c.postgresReportingNamespace || 'nrod'}.svc:5432
                        </code>{' '}
                        (Read-Only Enforced)
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
