import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import StorageIcon from '@mui/icons-material/Storage';
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
  configured: boolean;
}

interface TestVmRecord {
  id: string;
  name: string;
  vmSize: string;
  status: string;
  owner: string;
  monthlyUsd: number;
  mode: 'simulated' | 'terraform-cloud';
}

const useStyles = makeStyles(theme => ({
  detailCard: {
    marginTop: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    background: '#f8fafc',
  },
}));

export function TestVmCard() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [options, setOptions] = useState<TestVmOptions | null>(null);
  const [rows, setRows] = useState<TestVmRecord[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      try {
        const [optRes, listRes] = await Promise.all([
          backendFetch('deployment-control-plane', '/test-vms/options'),
          backendFetch('deployment-control-plane', '/test-vms'),
        ]);
        if (optRes.ok) setOptions(await optRes.json());
        if (listRes.ok) {
          const body = await listRes.json();
          setRows((body?.instances ?? []) as TestVmRecord[]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [backendFetch],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!active) return;
        await load();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => void (active = false);
  }, [load]);

  const nameError =
    name && !/^[a-z0-9-]{3,63}$/.test(name)
      ? 'Lowercase letters, numbers and hyphens only (3-63 chars)'
      : null;

  const createVm = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await backendFetch('deployment-control-plane', '/test-vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Create failed (${res.status})`);
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

  const defaultSize = options?.sizes?.[0];

  return (
    <Card className={classes.detailCard} elevation={0} style={{ marginTop: 20 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" style={{ gap: 16 }}>
          <div>
            <Typography variant="h6" style={{ fontWeight: 700 }}>Create Test VM</Typography>
            <Typography variant="body2" color="textSecondary">
              {defaultSize
                ? `One-click ${defaultSize.vmSize} (${defaultSize.vcpus} vCPU, ${defaultSize.memoryGb} GiB) — about $${defaultSize.hourlyUsd.toFixed(4)}/hour, $${defaultSize.monthlyUsd.toFixed(2)}/month if left running.`
                : 'Loading test VM options...'}
            </Typography>
          </div>
          {defaultSize && (
            <Chip
              size="small"
              icon={<StorageIcon style={{ fontSize: 16 }} />}
              label={`${defaultSize.vmSize} · $${defaultSize.monthlyUsd.toFixed(2)}/mo`}
            />
          )}
        </Box>

        {error && <Typography color="error">{error}</Typography>}
        {notice && <Typography variant="body2" color="textSecondary">{notice}</Typography>}

        {options && !options.configured ? (
          <Box
            style={{
              borderRadius: 10,
              border: '1px dashed #d0d0d0',
              padding: '16px',
              marginTop: 12,
              background: '#fff',
            }}
          >
            <Typography color="error" style={{ fontWeight: 600 }}>
              Configuration Required
            </Typography>
            <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
              Test VM provisioning is not configured. Contact your Platform Admin to set up:
            </Typography>
            <Typography variant="body2" color="textSecondary" style={{ marginTop: 4, marginLeft: 8 }}>
              • <code>cloudhub.networks.testvm</code> configuration in environment variables
            </Typography>
            <Typography variant="body2" color="textSecondary" style={{ marginTop: 2, marginLeft: 8 }}>
              • Terraform Cloud credentials (if using Terraform Cloud)
            </Typography>
          </Box>
        ) : (
          <Box
            display="flex"
            alignItems="flex-start"
            mt={2}
            mb={2}
            flexWrap="wrap"
            style={{ gap: 16 }}
          >
            <TextField
              size="small"
              variant="outlined"
              label="VM name"
              placeholder="vm-test-001"
              value={name}
              onChange={e => setName(e.target.value.toLowerCase())}
              error={!!nameError}
              helperText={nameError ?? ' '}
              disabled={creating}
            />
            <Button
              variant="contained"
              color="primary"
              disabled={!name || !!nameError || creating}
              onClick={createVm}
            >
              {creating ? 'Creating...' : 'Create Test VM'}
            </Button>
          </Box>
        )}

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
                    <TableCell><Chip size="small" label={row.status} /></TableCell>
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
      </CardContent>
    </Card>
  );
}

export default TestVmCard;
