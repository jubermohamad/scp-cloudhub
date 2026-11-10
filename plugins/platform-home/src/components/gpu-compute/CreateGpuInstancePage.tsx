import { useCallback, useEffect, useMemo, useState } from 'react';
import { Typography, Paper, Grid, TextField, MenuItem, Box, Button, CircularProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type {
  CreateGpuInstanceFormState,
  GpuComputeOptions,
  GpuQuotaCheckResult,
  GpuNetworkSubnet,
  GpuInstanceRecord,
} from './types';
import { GpuLogStreamingDialog } from './GpuLogStreamingDialog';

const NAME_RE = /^[a-z0-9-]{3,63}$/;

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1180,
    margin: '0 auto',
  },
  backLink: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginBottom: theme.spacing(2),
    color: '#6B7280',
    textTransform: 'none',
  },
  title: {
    fontSize: '1.6rem',
    fontWeight: 700,
    marginBottom: theme.spacing(0.5),
  },
  subtitle: {
    color: '#6B7280',
    marginBottom: theme.spacing(3),
  },
  board: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: theme.spacing(3),
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    // Vertical rules only once the columns sit side by side.
    [theme.breakpoints.up('md')]: {
      borderRight: `1px solid ${theme.palette.divider}`,
      '&:last-child': {
        borderRight: 'none',
      },
    },
    [theme.breakpoints.down('sm')]: {
      borderBottom: `1px solid ${theme.palette.divider}`,
      '&:last-child': {
        borderBottom: 'none',
      },
    },
  },
  columnHeader: {
    backgroundColor: '#F3F4F6',
    borderBottom: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1.5, 2),
  },
  columnTitle: {
    fontWeight: 700,
    fontSize: '0.8125rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#374151',
  },
  columnBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2.5),
    padding: theme.spacing(3, 2),
    flexGrow: 1,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1.5),
  },
  quotaOk: {
    color: '#166534',
  },
  quotaBad: {
    color: '#991B1B',
  },
}));

const INITIAL_STATE: CreateGpuInstanceFormState = {
  name: '',
  gpuSku: '',
  region: '',
  subscriptionId: '',
  vnetName: '',
  subnetName: '',
  owner: '',
  businessJustification: '',
  leaseDuration: '30d',
};

export function CreateGpuInstancePage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const navigate = useNavigate();

  const [options, setOptions] = useState<GpuComputeOptions | null>(null);
  const [form, setForm] = useState<CreateGpuInstanceFormState>(INITIAL_STATE);
  const [quota, setQuota] = useState<GpuQuotaCheckResult | null>(null);
  const [subnets, setSubnets] = useState<GpuNetworkSubnet[]>([]);
  const [vnets, setVnets] = useState<GpuComputeOptions['onboardedVnets']>([]);
  const [checkingQuota, setCheckingQuota] = useState(false);
  const [loadingVnets, setLoadingVnets] = useState(false);
  const [loadingSubnets, setLoadingSubnets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInstance, setCreatedInstance] = useState<GpuInstanceRecord | null>(null);
  const [showLogDialog, setShowLogDialog] = useState(false);

  const set = useCallback(
    <K extends keyof CreateGpuInstanceFormState>(
      key: K,
      value: CreateGpuInstanceFormState[K],
    ) => {
      setForm(prev => ({ ...prev, [key]: value }));
      setQuota(null);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          '/gpu-instances/options',
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? 'Failed to load GPU options');
        }
        if (!cancelled) setOptions(body);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendFetch]);

  useEffect(() => {
    if (!form.gpuSku) {
      setVnets([]);
      setLoadingVnets(false);
      set('vnetName', '');
      set('subscriptionId', '');
      set('region', '');
      set('subnetName', '');
      return undefined;
    }

    let cancelled = false;
    setLoadingVnets(true);
    (async () => {
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          `/gpu-instances/vnets?gpuSku=${encodeURIComponent(form.gpuSku)}`,
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Failed to load VNets');
        if (!cancelled) {
          const items = body.items ?? [];
          setVnets(items);
          if (
            form.vnetName &&
            !items.some((item: { vnetName: string }) => item.vnetName === form.vnetName)
          ) {
            set('vnetName', '');
            set('subscriptionId', '');
            set('region', '');
            set('subnetName', '');
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingVnets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendFetch, form.gpuSku, set, form.vnetName]);

  useEffect(() => {
    if (!form.gpuSku || !form.subscriptionId || !form.vnetName || !form.region) {
      setSubnets([]);
      setLoadingSubnets(false);
      return undefined;
    }
    let cancelled = false;
    setLoadingSubnets(true);
    (async () => {
      try {
        const query = new URLSearchParams({
          gpuSku: form.gpuSku,
          subscriptionId: form.subscriptionId,
          vnetName: form.vnetName,
          region: form.region,
        });
        const response = await backendFetch(
          'deployment-control-plane',
          `/gpu-instances/network-options?${query}`,
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? 'Failed to load subnets');
        if (!cancelled) setSubnets(body.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingSubnets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    backendFetch,
    form.gpuSku,
    form.subscriptionId,
    form.vnetName,
    form.region,
  ]);

  const vnetHelperText = () => {
    if (!form.gpuSku) {
      return 'Select GPU SKU to load approved VNets';
    }
    if (loadingVnets) {
      return 'Loading approved VNets...';
    }
    if (!vnets.length) {
      return 'No approved VNets found for this GPU SKU. Ask Cloud Platform to configure cloudhub.networks profile for this SKU.';
    }
    return 'Only platform-onboarded VNets are shown';
  };

  const subnetHelperText = () => {
    if (!form.vnetName) {
      return 'Select Approved VNet to load subnets';
    }
    if (loadingSubnets) {
      return 'Loading eligible subnets...';
    }
    return 'Only subnets with capacity and no delegation/reservation are shown';
  };

  const nameError = useMemo(() => {
    if (!form.name) return null;
    return NAME_RE.test(form.name)
      ? null
      : 'Must be lowercase letters, numbers, hyphens only (3-63 chars)';
  }, [form.name]);

  const checkQuota = async () => {
    if (!form.gpuSku || !form.region) return;
    setCheckingQuota(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/gpu-instances/quota-check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gpuSku: form.gpuSku, region: form.region }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Quota check failed');
      }
      setQuota(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingQuota(false);
    }
  };

  const selectedVnet = vnets.find(vnet => vnet.vnetName === form.vnetName);
  const selectedSubnet = subnets.find(
    subnet => subnet.name === form.subnetName,
  );
  const canSubmit =
    !!form.name &&
    !nameError &&
    !!form.gpuSku &&
    !!form.region &&
    !!form.subscriptionId &&
    !!form.vnetName &&
    !!form.subnetName &&
    !!form.owner &&
    !!form.businessJustification &&
    !!form.leaseDuration &&
    !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/gpu-instances',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to create GPU instance');
      }
      setCreatedInstance(body as GpuInstanceRecord);
      setShowLogDialog(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogDialogClose = () => {
    setShowLogDialog(false);
    navigate('/gpu-compute');
  };

  if (!options) {
    return (
      <Box className={classes.root} textAlign="center" p={6}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <div className={classes.root}>
      <Button
        className={classes.backLink}
        onClick={() => navigate('/gpu-compute')}
        startIcon={<ArrowBackIcon fontSize="small" />}
      >
        Back to GPU Compute
      </Button>
      <Typography className={classes.title}>Create GPU Instance</Typography>
      <Typography className={classes.subtitle}>
        Provisions a VM from the approved azure-ai-research-vm Terraform module
        ({options.terraformRepository}@{options.terraformBranch}) into the
        platform-owned {options.resourceGroup} resource group.
      </Typography>

      {error && (
        <Typography color="error" style={{ marginBottom: 16 }}>
          {error}
        </Typography>
      )}

      <Paper className={classes.board} variant="outlined">
        <Grid container>
          <Grid item xs={12} md={4} className={classes.column}>
            <div className={classes.columnHeader}>
              <Typography className={classes.columnTitle}>
                Basic Details
              </Typography>
            </div>
            <div className={classes.columnBody}>
              <TextField
                fullWidth
                label="VM Name"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                error={!!nameError}
                helperText={nameError ?? 'e.g. gpu-team-a-001'}
              />
              <TextField
                fullWidth
                label="Owner"
                value={form.owner}
                onChange={e => set('owner', e.target.value)}
                helperText="Requestor email or team alias"
              />
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Business Justification"
                value={form.businessJustification}
                onChange={e => set('businessJustification', e.target.value)}
              />
            </div>
          </Grid>

          <Grid item xs={12} md={4} className={classes.column}>
            <div className={classes.columnHeader}>
              <Typography className={classes.columnTitle}>
                GPU Configuration
              </Typography>
            </div>
            <div className={classes.columnBody}>
              <TextField
                select
                fullWidth
                label="GPU SKU"
                value={form.gpuSku}
                onChange={e => set('gpuSku', e.target.value as any)}
              >
                {options.skus.map(sku => (
                  <MenuItem key={sku.id} value={sku.id}>
                    {sku.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                label="Region"
                value={form.region}
                InputProps={{ readOnly: true }}
                helperText="Auto-populated from selected Approved VNet"
              />
              <div>
                <Button
                  variant="outlined"
                  disabled={!form.gpuSku || !form.region || checkingQuota}
                  onClick={checkQuota}
                >
                  {checkingQuota ? 'Checking quota...' : 'Check GPU Quota'}
                </Button>
                {quota && (
                  <Typography
                    variant="body2"
                    className={
                      quota.sufficient ? classes.quotaOk : classes.quotaBad
                    }
                    style={{ marginTop: 8 }}
                  >
                    {quota.message}
                  </Typography>
                )}
              </div>
            </div>
          </Grid>

          <Grid item xs={12} md={4} className={classes.column}>
            <div className={classes.columnHeader}>
              <Typography className={classes.columnTitle}>
                Networking and Governance
              </Typography>
            </div>
            <div className={classes.columnBody}>
              <TextField
                select
                fullWidth
                required
                label="Approved VNet"
                value={form.vnetName}
                onChange={e => {
                  const vnet = vnets.find(
                    item => item.vnetName === e.target.value,
                  );
                  set('vnetName', e.target.value);
                  set('subscriptionId', vnet?.subscriptionId ?? '');
                  set('region', vnet?.region ?? '');
                  set('subnetName', '');
                }}
                disabled={!form.gpuSku || loadingVnets || !vnets.length}
                helperText={vnetHelperText()}
              >
                {vnets.map(vnet => (
                  <MenuItem
                    key={`${vnet.subscriptionId}:${vnet.vnetName}`}
                    value={vnet.vnetName}
                  >
                    {vnet.vnetName} | {vnet.region}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                required
                label="Subnet"
                value={form.subnetName}
                onChange={e => set('subnetName', e.target.value)}
                disabled={!form.vnetName || loadingSubnets || !subnets.length}
                helperText={subnetHelperText()}
              >
                {subnets.map(subnet => (
                  <MenuItem key={subnet.name} value={subnet.name}>
                    {subnet.name} | {subnet.addressRange} | Available IPs:{' '}
                    {subnet.availableIpAddresses}
                    {subnet.lowCapacity ? ' | Low IP Capacity' : ''}
                  </MenuItem>
                ))}
              </TextField>
              {selectedSubnet && (
                <Box
                  style={{
                    background: '#F9FAFB',
                    border: '1px solid #E5E7EB',
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <Typography variant="body2" style={{ fontWeight: 600 }}>
                    Selected Subnet Details
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    CIDR: {selectedSubnet.addressRange}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Available IPs: {selectedSubnet.availableIpAddresses}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Used / Total: {selectedSubnet.usedAddresses} /{' '}
                    {selectedSubnet.totalAddresses}
                  </Typography>
                </Box>
              )}
              <TextField
                select
                fullWidth
                label="Lease Duration"
                value={form.leaseDuration}
                onChange={e => set('leaseDuration', e.target.value)}
              >
                {options.leaseDurations.map(duration => (
                  <MenuItem key={duration} value={duration}>
                    {duration}
                  </MenuItem>
                ))}
              </TextField>
            </div>
          </Grid>
        </Grid>
      </Paper>

      {selectedVnet && selectedSubnet && (
        <Paper variant="outlined" style={{ padding: 16, marginBottom: 24 }}>
          <Typography variant="subtitle1" style={{ fontWeight: 700 }}>
            Review
          </Typography>
          <Typography variant="body2">
            VM Name: {form.name || 'Not set'}
          </Typography>
          <Typography variant="body2">
            GPU SKU:{' '}
            {options.skus.find(sku => sku.id === form.gpuSku)?.label ||
              'Not set'}
          </Typography>
          <Typography variant="body2">
            Deployment Resource Group: {options.resourceGroup}
          </Typography>
          <Typography variant="body2">VNet: {selectedVnet.vnetName}</Typography>
          <Typography variant="body2">Subnet: {selectedSubnet.name}</Typography>
          <Typography variant="body2">
            Subnet CIDR: {selectedSubnet.addressRange}
          </Typography>
          <Typography variant="body2">
            Available IPs: {selectedSubnet.availableIpAddresses}
          </Typography>
        </Paper>
      )}

      <div className={classes.actions}>
        <Button onClick={() => navigate('/gpu-compute')}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? 'Creating...' : 'Create GPU Instance'}
        </Button>
      </div>

      <GpuLogStreamingDialog
        open={showLogDialog}
        instance={createdInstance}
        onClose={handleLogDialogClose}
      />
    </div>
  );
}
