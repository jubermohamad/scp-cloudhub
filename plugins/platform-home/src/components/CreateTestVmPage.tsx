import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import StorageIcon from '@mui/icons-material/Storage';
import { useNavigate } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';

interface TestVmSizeOption {
  id: string;
  label: string;
  vmSize: string;
  vcpus: number;
  memoryGb: number;
  hourlyUsd: number;
  monthlyUsd: number;
}

interface TestVmOptions {
  sizes: TestVmSizeOption[];
  defaultSize: string;
  resourceGroup: string;
  region: string;
  environment: string;
  subnetId: string;
  terraformRepository?: string;
  terraformBranch?: string;
  configured: boolean;
}

interface TestVmRecord {
  id: string;
  name: string;
  vmSize: string;
  status: string;
  owner: string;
  monthlyUsd: number;
  failureReason?: string | null;
  workflowRunUrl?: string | null;
}

const NAME_RE = /^[a-z0-9-]{3,63}$/;

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 960,
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
  formCard: {
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    marginBottom: theme.spacing(3),
  },
  meta: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: theme.spacing(1.5),
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  metaItem: {
    background: '#f8fafc',
    borderRadius: 8,
    padding: theme.spacing(1.25),
  },
  metaLabel: {
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#6B7280',
  },
  metaValue: {
    fontSize: '0.9rem',
    fontWeight: 600,
    marginTop: 4,
    wordBreak: 'break-all',
  },
}));

export function CreateTestVmPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const [options, setOptions] = useState<TestVmOptions | null>(null);
  const [rows, setRows] = useState<TestVmRecord[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      const [optRes, listRes] = await Promise.all([
        backendFetch('deployment-control-plane', '/test-vms/options'),
        backendFetch('deployment-control-plane', '/test-vms'),
      ]);
      if (optRes.ok) setOptions(await optRes.json());
      else {
        const body = await optRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to load options (${optRes.status})`);
      }
      if (listRes.ok) {
        const body = await listRes.json();
        setRows((body?.instances ?? []) as TestVmRecord[]);
      }
    },
    [backendFetch],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const nameError =
    name && !NAME_RE.test(name)
      ? 'Lowercase letters, numbers and hyphens only (3-63 chars)'
      : null;

  const createVm = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await backendFetch('deployment-control-plane', '/test-vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Create failed (${res.status})`);
      }
      if (body?.status === 'FAILED') {
        throw new Error(body?.failureReason ?? 'Terraform provisioning failed');
      }
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const deleteVm = async (row: TestVmRecord) => {
    setActingId(row.id);
    setError(null);
    try {
      const res = await backendFetch(
        'deployment-control-plane',
        `/test-vms/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Delete failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  const defaultSize = options?.sizes?.find(s => s.vmSize === options.defaultSize)
    ?? options?.sizes?.[0];

  return (
    <div className={classes.root}>
      <Button
        className={classes.backLink}
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/infrastructure?provider=azure')}
      >
        Back to Infrastructure
      </Button>
      <Typography className={classes.title}>Create Test VM</Typography>
      <Typography className={classes.subtitle}>
        Provisions a private Linux VM through Terraform module
        {' '}
        <code>azure-linux-virtual-machine</code>
        {' '}
        in SymphonySensa/scp-azure-terraform-modules. Only the VM name is required.
      </Typography>

      <Card className={classes.formCard} elevation={0}>
        <CardContent>
          {error && (
            <Typography color="error" style={{ marginBottom: 12 }}>
              {error}
            </Typography>
          )}

          {options && !options.configured ? (
            <Typography color="error">
              Test VM provisioning is not configured. Set CLOUDHUB_NETWORKS_JSON
              (testvm profile) and Terraform Cloud credentials.
            </Typography>
          ) : (
            <>
              <Box display="flex" alignItems="flex-start" flexWrap="wrap" style={{ gap: 16 }}>
                <TextField
                  required
                  size="small"
                  variant="outlined"
                  label="VM name"
                  placeholder="vm-test-001"
                  value={name}
                  onChange={e => setName(e.target.value.toLowerCase())}
                  error={!!nameError}
                  helperText={nameError ?? 'Mandatory. Lowercase letters, numbers, hyphens.'}
                  disabled={creating}
                />
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!name || !!nameError || creating || !options}
                  onClick={createVm}
                  startIcon={<StorageIcon />}
                >
                  {creating ? 'Creating...' : 'Create Test VM'}
                </Button>
              </Box>

              <div className={classes.meta}>
                <div className={classes.metaItem}>
                  <Typography className={classes.metaLabel}>Size</Typography>
                  <Typography className={classes.metaValue}>
                    {defaultSize?.vmSize ?? 'Standard_B1s'}
                  </Typography>
                </div>
                <div className={classes.metaItem}>
                  <Typography className={classes.metaLabel}>Resource group</Typography>
                  <Typography className={classes.metaValue}>
                    {options?.resourceGroup ?? 'rg-cloudhub'}
                  </Typography>
                </div>
                <div className={classes.metaItem}>
                  <Typography className={classes.metaLabel}>Region</Typography>
                  <Typography className={classes.metaValue}>
                    {options?.region ?? 'swedencentral'}
                  </Typography>
                </div>
                <div className={classes.metaItem}>
                  <Typography className={classes.metaLabel}>Module</Typography>
                  <Typography className={classes.metaValue}>
                    azure-linux-virtual-machine
                  </Typography>
                </div>
              </div>

              {defaultSize && (
                <Chip
                  size="small"
                  icon={<StorageIcon style={{ fontSize: 16 }} />}
                  label={`${defaultSize.vmSize} · $${defaultSize.monthlyUsd.toFixed(2)}/mo`}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <TableContainer component={Paper} elevation={0} style={{ borderRadius: 10 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>VM Name</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Est. Cost</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.vmSize}</TableCell>
                  <TableCell>${Number(row.monthlyUsd).toFixed(2)}/mo</TableCell>
                  <TableCell>
                    <Chip size="small" label={row.status} />
                    {row.failureReason && (
                      <Typography variant="caption" color="error" display="block">
                        {row.failureReason}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={actingId === row.id || row.status === 'DELETING' || row.status === 'DELETED'}
                      onClick={() => deleteVm(row)}
                    >
                      {actingId === row.id ? 'Deleting...' : 'Delete'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}

export default CreateTestVmPage;
