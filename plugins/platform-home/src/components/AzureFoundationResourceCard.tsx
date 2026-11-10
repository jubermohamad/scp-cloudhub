import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useBackendFetch } from '@internal/plugin-platform-common';

type AzureFoundationResourceType =
  | 'resource-group'
  | 'vnet-subnet'
  | 'key-vault'
  | 'storage-account';

interface AzureFoundationResourceRecord {
  id: string;
  resourceType: AzureFoundationResourceType;
  name: string;
  modulePath: string;
  terraformRepository: string;
  terraformBranch: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  mode: 'simulated' | 'terraform-cloud';
  status: 'PENDING' | 'PROVISIONING' | 'READY' | 'FAILED';
  statusMessage: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface Props {
  resourceType: AzureFoundationResourceType;
  title: string;
  description: string;
}

const useStyles = makeStyles(theme => ({
  detailCard: {
    marginTop: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    background: '#f8fafc',
  },
  section: {
    marginTop: theme.spacing(2),
  },
}));

function defaultsFor(
  resourceType: AzureFoundationResourceType,
): Record<string, string> {
  switch (resourceType) {
    case 'resource-group':
      return {
        region: 'swedencentral',
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        tenantId: 'all',
      };
    case 'vnet-subnet':
      return {
        resourceGroupName: '',
        location: 'swedencentral',
        vnetName: '',
        subnetName: '',
        addressSpace: '10.0.0.0/16',
        subnetAddressPrefixes: '10.0.1.0/24',
        serviceEndpoints: 'Microsoft.Storage',
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        tenantId: 'all',
      };
    case 'key-vault':
      return {
        resourceGroupName: '',
        location: 'swedencentral',
        privateEndpointSubnetId: '',
        privateDnsZoneIds: 'privatelink.vaultcore.azure.net',
        aadTenantId: '',
        namingTenantId: 'all',
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
      };
    case 'storage-account':
      return {
        resourceGroupName: '',
        location: 'swedencentral',
        accountTier: 'Standard',
        accountReplicationType: 'LRS',
        env: 'dev',
        regionCode: 'sdc',
        tenancy: 'st',
        tenantId: 'all',
      };
    default:
      return {};
  }
}

export function AzureFoundationResourceCard(props: Props) {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [instances, setInstances] = useState<AzureFoundationResourceRecord[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      const res = await backendFetch('deployment-control-plane', '/azure-foundation/requests');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to load foundation requests');
      }
      const body = await res.json();
      const rows = (body?.instances ?? []) as AzureFoundationResourceRecord[];
      setInstances(rows.filter(r => r.resourceType === props.resourceType));
    },
    [backendFetch, props.resourceType],
  );

  useEffect(() => {
    setFields(defaultsFor(props.resourceType));
    setName('');
    setError(null);
    setNotice(null);
  }, [props.resourceType]);

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

  const setField = (key: string, value: string) =>
    setFields(prev => ({ ...prev, [key]: value }));

  const create = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await backendFetch(
        'deployment-control-plane',
        '/azure-foundation/requests',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceType: props.resourceType,
            name,
            properties: fields,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Create failed (${res.status})`);
      }
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const refreshStatus = async (id: string) => {
    setActingId(id);
    setError(null);
    try {
      const res = await backendFetch(
        'deployment-control-plane',
        `/azure-foundation/requests/${encodeURIComponent(id)}/status`,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Refresh failed (${res.status})`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  const canCreate = !!name && !creating;

  return (
    <Card className={classes.detailCard} elevation={0}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" style={{ gap: 16 }}>
          <div>
            <Typography variant="h6" style={{ fontWeight: 700 }}>{props.title}</Typography>
            <Typography variant="body2" color="textSecondary">
              {props.description}
            </Typography>
          </div>
          <Chip size="small" label="Azure Terraform Module" />
        </Box>

        {error && (
          <Typography color="error" className={classes.section}>
            {error}
          </Typography>
        )}
        {notice && (
          <Typography variant="body2" color="textSecondary" className={classes.section}>
            {notice}
          </Typography>
        )}

        <Grid container spacing={2} className={classes.section}>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              variant="outlined"
              label="Request name"
              value={name}
              onChange={e => setName(e.target.value.toLowerCase())}
              helperText="Lowercase letters, numbers and hyphens only"
            />
          </Grid>

          {props.resourceType === 'resource-group' && (
            <>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Region" value={fields.region ?? ''} onChange={e => setField('region', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Environment" value={fields.env ?? ''} onChange={e => setField('env', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Region code" value={fields.regionCode ?? ''} onChange={e => setField('regionCode', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Tenancy" value={fields.tenancy ?? ''} onChange={e => setField('tenancy', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Tenant ID" value={fields.tenantId ?? ''} onChange={e => setField('tenantId', e.target.value)} />
              </Grid>
            </>
          )}

          {props.resourceType === 'vnet-subnet' && (
            <>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Resource group" value={fields.resourceGroupName ?? ''} onChange={e => setField('resourceGroupName', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Location" value={fields.location ?? ''} onChange={e => setField('location', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="VNet name" value={fields.vnetName ?? ''} onChange={e => setField('vnetName', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Subnet name" value={fields.subnetName ?? ''} onChange={e => setField('subnetName', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Address space (comma-separated)" value={fields.addressSpace ?? ''} onChange={e => setField('addressSpace', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Subnet prefixes (comma-separated)" value={fields.subnetAddressPrefixes ?? ''} onChange={e => setField('subnetAddressPrefixes', e.target.value)} />
              </Grid>
            </>
          )}

          {props.resourceType === 'key-vault' && (
            <>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Resource group" value={fields.resourceGroupName ?? ''} onChange={e => setField('resourceGroupName', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Location" value={fields.location ?? ''} onChange={e => setField('location', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="AAD Tenant ID" value={fields.aadTenantId ?? ''} onChange={e => setField('aadTenantId', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth size="small" variant="outlined" label="Private endpoint subnet ID" value={fields.privateEndpointSubnetId ?? ''} onChange={e => setField('privateEndpointSubnetId', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth size="small" variant="outlined" label="Private DNS zone IDs (comma-separated)" value={fields.privateDnsZoneIds ?? ''} onChange={e => setField('privateDnsZoneIds', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Environment" value={fields.env ?? ''} onChange={e => setField('env', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Region code" value={fields.regionCode ?? ''} onChange={e => setField('regionCode', e.target.value)} />
              </Grid>
            </>
          )}

          {props.resourceType === 'storage-account' && (
            <>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Resource group" value={fields.resourceGroupName ?? ''} onChange={e => setField('resourceGroupName', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Location" value={fields.location ?? ''} onChange={e => setField('location', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" variant="outlined" label="Replication type" value={fields.accountReplicationType ?? ''} onChange={e => setField('accountReplicationType', e.target.value)} />
              </Grid>
            </>
          )}
        </Grid>

        <Box className={classes.section}>
          <Button variant="contained" color="primary" disabled={!canCreate} onClick={create}>
            {creating ? 'Creating...' : 'Create resource'}
          </Button>
        </Box>

        {instances.length > 0 && (
          <TableContainer component={Paper} elevation={0} className={classes.section}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Module</TableCell>
                  <TableCell>Run</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {instances.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.status} />
                    </TableCell>
                    <TableCell>{row.modulePath}</TableCell>
                    <TableCell>
                      {row.workflowRunUrl ? (
                        <a href={row.workflowRunUrl} target="_blank" rel="noreferrer">
                          Open run
                        </a>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={actingId === row.id}
                        onClick={() => refreshStatus(row.id)}
                      >
                        {actingId === row.id ? 'Refreshing...' : 'Refresh'}
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

export default AzureFoundationResourceCard;
