import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Content,
  Header,
  InfoCard,
  Page,
  Progress,
  ResponseErrorPanel,
  WarningPanel,
} from '@backstage/core-components';
import { Box, Button, Chip, FormControl, Grid, InputLabel, LinearProgress, MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography, Checkbox } from '@mui/material';
import { makeStyles } from '@mui/styles';

import RefreshIcon from '@mui/icons-material/Refresh';
import PublishIcon from '@mui/icons-material/Publish';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createTenantRegistryApi } from '../api';
import type {
  CloudProvider,
  ClusterInventoryItem,
  DiscoveredCluster,
  Tenant,
  TenantDetail,
} from '../types';

const useStyles = makeStyles(theme => ({
  sectionTitle: {
    marginBottom: theme.spacing(1),
  },
  cardActions: {
    marginTop: theme.spacing(2),
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  filterRow: {
    marginBottom: theme.spacing(1),
  },
  issueChip: {
    marginRight: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  },
  statusOk: {
    color: theme.palette.success.main,
    fontWeight: 600,
  },
  statusFailed: {
    color: theme.palette.error.main,
    fontWeight: 600,
  },
}));

const ENV_OPTIONS = ['dev', 'qa', 'uat', 'test', 'stage', 'prod'];
const REGION_OPTIONS = [
  'eastus',
  'westus',
  'centralus',
  'westeurope',
  'eastasia',
];
const CLOUD_PROVIDERS: CloudProvider[] = ['Azure', 'AWS', 'GCP', 'On-Prem'];

export function TenantEnvironmentRegistryPage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const { persona } = usePersona();
  const canAccess =
    persona === 'cloudhub-platform' ||
    persona === 'professional-services' ||
    persona === 'app-engineering' ||
    persona === 'sre';
  const isReadOnly = persona === 'sre';
  const tenantRegistryApi = useMemo(
    () => createTenantRegistryApi(backendFetch, persona),
    [backendFetch, persona],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busyLabel, setBusyLabel] = useState('');

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantTotal, setTenantTotal] = useState(0);
  const [tenantDetail, setTenantDetail] = useState<TenantDetail | null>(null);
  const [inventory, setInventory] = useState<ClusterInventoryItem[]>([]);

  const [tenantName, setTenantName] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [tenantCloudProvider, setTenantCloudProvider] =
    useState<CloudProvider>('Azure');
  const [tenantSubscriptionId, setTenantSubscriptionId] = useState('');
  const [tenantRegions, setTenantRegions] = useState<string[]>([]);
  const [tenantEnvironments, setTenantEnvironments] = useState<string[]>([
    'dev',
    'prod',
  ]);

  const [selectedTenantId, setSelectedTenantId] = useState('');

  const [discoverProvider, setDiscoverProvider] =
    useState<CloudProvider>('Azure');
  const [discoverSubscriptionId, setDiscoverSubscriptionId] = useState('');
  const [discoverResourceGroup, setDiscoverResourceGroup] = useState('');
  const [discoverRegion, setDiscoverRegion] = useState('');
  const [discoverEnvironment, setDiscoverEnvironment] = useState('');
  const [discovered, setDiscovered] = useState<DiscoveredCluster[]>([]);
  const [selectedClusters, setSelectedClusters] = useState<string[]>([]);
  const [onboardingProgress, setOnboardingProgress] = useState<number | null>(
    null,
  );

  const [tenantPage, setTenantPage] = useState(0);
  const [tenantRowsPerPage, setTenantRowsPerPage] = useState(5);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantSortBy, setTenantSortBy] = useState('createdAt');
  const [tenantSortOrder, setTenantSortOrder] = useState<'asc' | 'desc'>(
    'desc',
  );
  const [clusterPage, setClusterPage] = useState(0);
  const [clusterRowsPerPage, setClusterRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');

  const filteredDiscovered = useMemo(() => {
    const lower = search.toLowerCase();
    return discovered.filter(
      d =>
        d.clusterName.toLowerCase().includes(lower) ||
        d.resourceGroup.toLowerCase().includes(lower) ||
        (d.environment ?? '').toLowerCase().includes(lower),
    );
  }, [discovered, search]);

  const discoveredSlice = useMemo(
    () =>
      filteredDiscovered.slice(
        clusterPage * clusterRowsPerPage,
        clusterPage * clusterRowsPerPage + clusterRowsPerPage,
      ),
    [filteredDiscovered, clusterPage, clusterRowsPerPage],
  );

  const loadTenants = useCallback(async () => {
    setError(null);
    setLoading(true);
    setBusyLabel('Loading tenants');
    try {
      const tenantResp = await tenantRegistryApi.getTenants({
        page: tenantPage,
        pageSize: tenantRowsPerPage,
        search: tenantSearch,
        sortBy: tenantSortBy,
        sortOrder: tenantSortOrder,
      });
      setTenants(tenantResp.items);
      setTenantTotal(tenantResp.total);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
      setBusyLabel('');
    }
  }, [
    tenantPage,
    tenantRowsPerPage,
    tenantSearch,
    tenantSortBy,
    tenantSortOrder,
    tenantRegistryApi,
  ]);

  const loadInventory = useCallback(async () => {
    try {
      const clusterResp = await tenantRegistryApi.getClusters({
        page: 0,
        pageSize: 200,
      });
      setInventory(clusterResp.items);
    } catch {
      // Do not block tenant loading if inventory fetch fails.
    }
  }, [tenantRegistryApi]);

  useEffect(() => {
    if (!canAccess) {
      return;
    }
    void loadTenants();
  }, [canAccess, loadTenants]);

  useEffect(() => {
    if (!canAccess) {
      return;
    }
    void loadInventory();
  }, [canAccess, loadInventory]);

  const onCreateTenant = async () => {
    if (isReadOnly) {
      setError(new Error('Professional Services users have read-only access.'));
      return;
    }

    if (
      !tenantName ||
      !tenantSubscriptionId ||
      tenantEnvironments.length === 0
    ) {
      setError(
        new Error(
          'Tenant Name, Subscription ID, and Environments are required.',
        ),
      );
      return;
    }

    setError(null);
    setLoading(true);
    setBusyLabel('Creating tenant');
    try {
      const created = await tenantRegistryApi.createTenant({
        tenantName,
        businessUnit,
        cloudProvider: tenantCloudProvider,
        subscriptionId: tenantSubscriptionId,
        regions: tenantRegions,
        environments: tenantEnvironments,
      });
      setTenants(prev => [created, ...prev]);
      setSelectedTenantId(created.id);
      setTenantName('');
      setBusinessUnit('');
      setTenantRegions([]);
      setTenantEnvironments(['dev', 'prod']);
      await loadTenants();
      await loadInventory();
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
      setBusyLabel('');
    }
  };

  const onDiscover = async () => {
    if (!discoverSubscriptionId) {
      setError(new Error('Subscription ID is required for discovery.'));
      return;
    }

    setError(null);
    setLoading(true);
    setBusyLabel('Discovering existing AKS clusters from Azure');
    try {
      const response = await tenantRegistryApi.discoverClusters({
        cloudProvider: discoverProvider,
        subscriptionId: discoverSubscriptionId,
        resourceGroup: discoverResourceGroup,
        region: discoverRegion,
        environment: discoverEnvironment,
      });
      setDiscovered(response.items);
      setSelectedClusters([]);
      setClusterPage(0);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
      setBusyLabel('');
    }
  };

  const onLoadTenantDetail = async (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setError(null);
    setLoading(true);
    setBusyLabel('Loading tenant detail');
    try {
      const detail = await tenantRegistryApi.getTenant(tenantId);
      setTenantDetail(detail);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
      setBusyLabel('');
    }
  };

  const toggleCluster = (name: string) => {
    setSelectedClusters(prev =>
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name],
    );
  };

  const toggleAllClusters = () => {
    if (selectedClusters.length === filteredDiscovered.length) {
      setSelectedClusters([]);
      return;
    }
    setSelectedClusters(filteredDiscovered.map(c => c.clusterName));
  };

  const onOnboardSelected = async () => {
    if (isReadOnly) {
      setError(new Error('Professional Services users have read-only access.'));
      return;
    }

    if (!selectedTenantId) {
      setError(new Error('Select a tenant before onboarding clusters.'));
      return;
    }
    if (selectedClusters.length === 0) {
      setError(new Error('Select one or more clusters for onboarding.'));
      return;
    }

    setError(null);
    setLoading(true);
    setBusyLabel('Onboarding selected clusters');
    setOnboardingProgress(10);
    try {
      setOnboardingProgress(40);
      await tenantRegistryApi.onboardClusters({
        tenantId: selectedTenantId,
        cloudProvider: discoverProvider,
        selectedClusterNames: selectedClusters,
        discoveredClusters: discovered,
      });
      setOnboardingProgress(80);
      await loadTenants();
      await loadInventory();
      if (selectedTenantId) {
        const detail = await tenantRegistryApi.getTenant(selectedTenantId);
        setTenantDetail(detail);
      }
      setOnboardingProgress(100);
      setSelectedClusters([]);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
      setBusyLabel('');
      setTimeout(() => setOnboardingProgress(null), 800);
    }
  };

  if (!canAccess) {
    return (
      <Page themeId="tool">
        <Header
          title="Kubernetes Environment Registry"
          subtitle="Restricted capability"
        />
        <Content>
          <WarningPanel title="Access restricted">
            Kubernetes Environment Registry is available only to platform-admin
            users.
          </WarningPanel>
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header
        title="Kubernetes Environment Registry"
        subtitle="Platform-managed Kubernetes inventory and governance"
      />
      <Content>
        {isReadOnly ? (
          <Box mb={2}>
            <WarningPanel title="Read-only access">
              Professional Services users can view tenants, environments, and
              discovered clusters but cannot create tenants or onboard clusters.
            </WarningPanel>
          </Box>
        ) : null}
        {loading && <Progress />}
        {onboardingProgress !== null && (
          <Box mb={2}>
            <Typography variant="body2">
              Onboarding progress: {onboardingProgress}%
            </Typography>
            <LinearProgress variant="determinate" value={onboardingProgress} />
          </Box>
        )}
        {busyLabel ? (
          <Typography variant="caption">{busyLabel}</Typography>
        ) : null}
        {error ? <ResponseErrorPanel error={error} /> : null}

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <InfoCard
              title="Tenant Creation"
              subheader="Register a new tenant and associate it with a cloud subscription, regions, and environments. Once created, you can discover and onboard Kubernetes clusters under this tenant."
            >
              <Typography variant="h6" className={classes.sectionTitle}>
                Create Tenant
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Tenant Name"
                    value={tenantName}
                    onChange={e => setTenantName(e.target.value)}
                    required
                    disabled={isReadOnly}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Business Unit"
                    value={businessUnit}
                    onChange={e => setBusinessUnit(e.target.value)}
                    disabled={isReadOnly}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="cloud-provider-label">
                      Cloud Provider
                    </InputLabel>
                    <Select
                      labelId="cloud-provider-label"
                      value={tenantCloudProvider}
                      onChange={e =>
                        setTenantCloudProvider(e.target.value as CloudProvider)
                      }
                      disabled={isReadOnly}
                    >
                      {CLOUD_PROVIDERS.map(provider => (
                        <MenuItem key={provider} value={provider}>
                          {provider}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Subscription ID"
                    value={tenantSubscriptionId}
                    onChange={e => setTenantSubscriptionId(e.target.value)}
                    required
                    disabled={isReadOnly}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="regions-label">Regions</InputLabel>
                    <Select
                      labelId="regions-label"
                      multiple
                      value={tenantRegions}
                      onChange={e =>
                        setTenantRegions(e.target.value as string[])
                      }
                      disabled={isReadOnly}
                      renderValue={selected =>
                        (selected as string[]).join(', ')
                      }
                    >
                      {REGION_OPTIONS.map(region => (
                        <MenuItem key={region} value={region}>
                          {region}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="env-label">Environments</InputLabel>
                    <Select
                      labelId="env-label"
                      multiple
                      value={tenantEnvironments}
                      onChange={e =>
                        setTenantEnvironments(e.target.value as string[])
                      }
                      disabled={isReadOnly}
                      renderValue={selected =>
                        (selected as string[]).join(', ')
                      }
                    >
                      {ENV_OPTIONS.map(env => (
                        <MenuItem key={env} value={env}>
                          {env}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <div className={classes.cardActions}>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<AddCircleOutlineIcon />}
                  onClick={onCreateTenant}
                >
                  Create Tenant
                </Button>
              </div>
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <InfoCard title="Tenant List">
              <Box mb={1} display="flex" alignItems="center">
                <TextField
                  label="Search tenants"
                  size="small"
                  variant="outlined"
                  value={tenantSearch}
                  onChange={e => {
                    setTenantSearch(e.target.value);
                    setTenantPage(0);
                  }}
                  style={{ marginRight: 8 }}
                />
                <FormControl
                  size="small"
                  variant="outlined"
                  style={{ marginRight: 8 }}
                >
                  <InputLabel id="tenant-sort-by-label">Sort By</InputLabel>
                  <Select
                    labelId="tenant-sort-by-label"
                    value={tenantSortBy}
                    onChange={e => setTenantSortBy(e.target.value as string)}
                  >
                    <MenuItem value="createdAt">Created</MenuItem>
                    <MenuItem value="tenantName">Tenant Name</MenuItem>
                    <MenuItem value="cloudProvider">Cloud</MenuItem>
                    <MenuItem value="subscriptionId">Subscription</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" variant="outlined">
                  <InputLabel id="tenant-sort-order-label">Order</InputLabel>
                  <Select
                    labelId="tenant-sort-order-label"
                    value={tenantSortOrder}
                    onChange={e =>
                      setTenantSortOrder(e.target.value as 'asc' | 'desc')
                    }
                  >
                    <MenuItem value="desc">Desc</MenuItem>
                    <MenuItem value="asc">Asc</MenuItem>
                  </Select>
                </FormControl>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tenant</TableCell>
                      <TableCell>Cloud</TableCell>
                      <TableCell>Subscription</TableCell>
                      <TableCell>Clusters</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tenants.map(tenant => {
                      const tenantClusterCount =
                        tenant.clusterCount ??
                        inventory.filter(c => c.tenantId === tenant.id).length;
                      return (
                        <TableRow
                          key={tenant.id}
                          hover
                          selected={selectedTenantId === tenant.id}
                          onClick={() => onLoadTenantDetail(tenant.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <TableCell>{tenant.tenantName}</TableCell>
                          <TableCell>{tenant.cloudProvider}</TableCell>
                          <TableCell>{tenant.subscriptionId}</TableCell>
                          <TableCell>{tenantClusterCount}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={tenantTotal}
                page={tenantPage}
                rowsPerPageOptions={[5, 10, 25, 50]}
                onPageChange={(_e, nextPage) => setTenantPage(nextPage)}
                rowsPerPage={tenantRowsPerPage}
                onRowsPerPageChange={e => {
                  setTenantRowsPerPage(parseInt(e.target.value, 10));
                  setTenantPage(0);
                }}
              />
            </InfoCard>
          </Grid>

          <Grid item xs={12}>
            <InfoCard title="Cluster Discovery">
              <Grid container spacing={2} className={classes.filterRow}>
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth>
                    <InputLabel id="discover-cloud-provider-label">
                      Cloud
                    </InputLabel>
                    <Select
                      labelId="discover-cloud-provider-label"
                      value={discoverProvider}
                      onChange={e =>
                        setDiscoverProvider(e.target.value as CloudProvider)
                      }
                    >
                      {CLOUD_PROVIDERS.map(provider => (
                        <MenuItem key={provider} value={provider}>
                          {provider}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    label="Subscription ID"
                    value={discoverSubscriptionId}
                    onChange={e => setDiscoverSubscriptionId(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    fullWidth
                    label="Resource Group"
                    value={discoverResourceGroup}
                    onChange={e => setDiscoverResourceGroup(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    fullWidth
                    label="Region"
                    value={discoverRegion}
                    onChange={e => setDiscoverRegion(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    fullWidth
                    label="Environment"
                    value={discoverEnvironment}
                    onChange={e => setDiscoverEnvironment(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={1}>
                  <Button
                    variant="contained"
                    color="primary"
                    fullWidth
                    startIcon={<RefreshIcon />}
                    onClick={onDiscover}
                  >
                    Scan
                  </Button>
                </Grid>
              </Grid>

              {discoverProvider !== 'Azure' ? (
                <WarningPanel title="Provider not yet enabled">
                  Multi-cloud provider abstraction is ready, but only Azure
                  implementation is active in this release.
                </WarningPanel>
              ) : null}

              <Box
                mb={1}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
              >
                <TextField
                  label="Search discovered clusters"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  size="small"
                  variant="outlined"
                />
                <div className={classes.cardActions}>
                  <Button variant="outlined" onClick={toggleAllClusters}>
                    Select All
                  </Button>
                  <Button
                    variant="contained"
                    color="secondary"
                    startIcon={<PublishIcon />}
                    onClick={onOnboardSelected}
                    disabled={isReadOnly}
                  >
                    Onboard Selected ({selectedClusters.length})
                  </Button>
                </div>
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell>Cluster Name</TableCell>
                      <TableCell>Resource Group</TableCell>
                      <TableCell>Region</TableCell>
                      <TableCell>K8s Version</TableCell>
                      <TableCell>Node Pools</TableCell>
                      <TableCell>Environment</TableCell>
                      <TableCell>State</TableCell>
                      <TableCell>Validation</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {discoveredSlice.map(cluster => {
                      const valid = cluster.validation.issues.length === 0;
                      return (
                        <TableRow key={cluster.clusterName} hover>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedClusters.includes(
                                cluster.clusterName,
                              )}
                              onChange={() =>
                                toggleCluster(cluster.clusterName)
                              }
                              color="primary"
                              disabled={isReadOnly}
                            />
                          </TableCell>
                          <TableCell>{cluster.clusterName}</TableCell>
                          <TableCell>{cluster.resourceGroup}</TableCell>
                          <TableCell>{cluster.region}</TableCell>
                          <TableCell>{cluster.kubernetesVersion}</TableCell>
                          <TableCell>{cluster.nodePoolCount}</TableCell>
                          <TableCell>
                            {cluster.environment ?? 'unknown'}
                          </TableCell>
                          <TableCell>{cluster.provisioningState}</TableCell>
                          <TableCell>
                            <Typography
                              className={
                                valid ? classes.statusOk : classes.statusFailed
                              }
                            >
                              {valid ? 'PASS' : 'FAIL'}
                            </Typography>
                            {!valid &&
                              cluster.validation.issues.map(issue => (
                                <Chip
                                  key={`${cluster.clusterName}-${issue}`}
                                  label={issue}
                                  size="small"
                                  className={classes.issueChip}
                                />
                              ))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={filteredDiscovered.length}
                page={clusterPage}
                rowsPerPageOptions={[10, 25, 50, 100]}
                onPageChange={(_e, nextPage) => setClusterPage(nextPage)}
                rowsPerPage={clusterRowsPerPage}
                onRowsPerPageChange={e => {
                  setClusterRowsPerPage(parseInt(e.target.value, 10));
                  setClusterPage(0);
                }}
              />
            </InfoCard>
          </Grid>

          <Grid item xs={12}>
            <InfoCard title="Tenant Detail">
              {!tenantDetail ? (
                <Typography variant="body2">
                  Select a tenant to view clusters, environments, and node pool
                  inventory.
                </Typography>
              ) : (
                <>
                  <Typography variant="h6">
                    {tenantDetail.tenantName}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Business Unit: {tenantDetail.businessUnit || 'N/A'} |
                    Subscription: {tenantDetail.subscriptionId} | Cloud:{' '}
                    {tenantDetail.cloudProvider}
                  </Typography>
                  <Box mt={2}>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Cluster</TableCell>
                            <TableCell>Environment</TableCell>
                            <TableCell>Region</TableCell>
                            <TableCell>K8s Version</TableCell>
                            <TableCell>Provisioning</TableCell>
                            <TableCell>Onboarded</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {tenantDetail.clusters.map(cluster => (
                            <TableRow key={cluster.id}>
                              <TableCell>{cluster.clusterName}</TableCell>
                              <TableCell>
                                {cluster.environment ?? 'unknown'}
                              </TableCell>
                              <TableCell>{cluster.region}</TableCell>
                              <TableCell>{cluster.kubernetesVersion}</TableCell>
                              <TableCell>{cluster.provisioningState}</TableCell>
                              <TableCell>
                                {cluster.onboarded ? 'Yes' : 'No'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                </>
              )}
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
}
