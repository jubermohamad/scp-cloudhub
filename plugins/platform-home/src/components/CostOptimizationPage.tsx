import { Typography, Grid, Card, CardContent, CardActionArea, Tabs, Tab, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, IconButton, TextField } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import StorageIcon from '@mui/icons-material/Storage';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import MemoryIcon from '@mui/icons-material/Memory';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { GpuInstanceRecord } from './gpu-compute/types';
import { GpuInstanceStatusBadge } from './gpu-compute/GpuInstanceStatusBadge';

// ─── Tool definitions ────────────────────────────────────────────────────────

interface CostTool {
  id: string;
  title: string;
  description: string;
  secondaryText?: string;
  Icon: React.ElementType;
  gradient: string;
  href: string;
}

type CloudProvider = 'azure' | 'aws' | 'gcp';

interface VmRecord {
  provider: CloudProvider;
  vmName: string;
  resourceGroupName: string;
  instanceType: string;
  uptime: string;
  currentState: 'Running' | 'Stopped';
  costPerMonth: number;
}

interface AksClusterCostNodePool {
  name: string;
  mode: 'System' | 'User';
  vmSize: string;
  nodeCount: number;
  hourlyRateUsd: number;
  monthlyCostUsd: number;
  costModel: 'catalog' | 'default';
}

interface AksClusterCostRecord {
  clusterName: string;
  resourceGroup: string;
  location: string;
  powerState: 'Running' | 'Stopped' | 'Unknown';
  monthlyCostUsd: number;
  nodePools: AksClusterCostNodePool[];
  unavailableReason?: string;
}

interface AksClusterCostResponse {
  totalMonthlyCostUsd: number;
  clusterCount: number;
  fetchedAt?: string;
  model?: {
    note?: string;
    defaultVmHourlyRateUsd?: number;
    usedDefaultRateForUnknownVmSize?: boolean;
  };
  clusters: AksClusterCostRecord[];
}

interface AksClusterCostCache {
  rows: AksClusterCostRecord[];
  totalMonthlyCostUsd: number;
  clusterCount: number;
  note?: string;
  defaultVmHourlyRateUsd?: number;
  usedDefaultRateForUnknownVmSize: boolean;
  fetchedAt?: string;
}

const AKS_COST_CACHE_KEY = 'platform-home:azure-aks-cost-cache:v1';

const AZURE_COST_TOOLS: CostTool[] = [
  {
    id: 'aks-cost-automation-onboard',
    title: 'AKS Cost Automation – Onboard',
    description:
      'Onboard a non-production AKS cluster to automated start/stop scheduling and node pool downsizing.',
    secondaryText: 'Dev & QA clusters only.',
    Icon: TrendingDownIcon,
    gradient: 'linear-gradient(135deg, #107c10 0%, #54b054 100%)',
    href: '/cost-optimization/azure/aks-cost-automation/onboard',
  },
  {
    id: 'aks-lifecycle-manager',
    title: 'AKS Lifecycle Manager',
    description:
      'Start, stop, and right-size managed non-production clusters. Preview changes with dry-run before applying.',
    Icon: ListAltIcon,
    gradient: 'linear-gradient(135deg, #005a9e 0%, #0078d4 100%)',
    href: '/cost-optimization/azure/aks-cost-automation/managed',
  },
];

const AWS_COST_TOOLS: CostTool[] = [
  {
    id: 'eks-cost-automation',
    title: 'EKS Cost Automation',
    description:
      'Coming soon — automated cost optimization for Amazon Elastic Kubernetes Service clusters.',
    Icon: TrendingDownIcon,
    gradient: 'linear-gradient(135deg, #232f3e 0%, #ff9900 100%)',
    href: '#',
  },
];

const GCP_COST_TOOLS: CostTool[] = [
  {
    id: 'gke-cost-automation',
    title: 'GKE Cost Automation',
    description:
      'Coming soon — automated cost optimization for Google Kubernetes Engine clusters.',
    Icon: TrendingDownIcon,
    gradient: 'linear-gradient(135deg, #1f2937 0%, #4285f4 100%)',
    href: '#',
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1600,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.between('lg', 'xl')]: { padding: theme.spacing(3) },
    [theme.breakpoints.up('xl')]: { padding: theme.spacing(5) },
  },
  heroSection: {
    marginBottom: theme.spacing(4),
  },
  heroTitle: {
    fontSize: '2rem',
    marginBottom: theme.spacing(0.5),
    [theme.breakpoints.between('lg', 'xl')]: { fontSize: '1.75rem' },
    [theme.breakpoints.up('xl')]: { fontSize: '2.5rem' },
  },
  heroSubtitle: {
    color: theme.palette.text.secondary,
    fontSize: '1rem',
    marginBottom: theme.spacing(3),
  },
  tabsContainer: {
    marginBottom: theme.spacing(3),
    borderBottom: `2px solid ${theme.palette.divider}`,
  },
  tabs: {
    '& .MuiTabs-indicator': {
      height: 3,
      borderRadius: '3px 3px 0 0',
      background: 'linear-gradient(90deg, #1E3A8A 0%, #1E40AF 100%)',
    },
  },
  tab: {
    textTransform: 'none',
    fontSize: '1rem',
    fontWeight: 600,
    color: theme.palette.text.secondary,
    '&.Mui-selected': {
      color: '#1E3A8A',
    },
    minWidth: 120,
  },
  tabContent: {
    marginTop: theme.spacing(2),
  },
  azureSectionTabsContainer: {
    marginBottom: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  azureSectionTabs: {
    '& .MuiTabs-indicator': {
      height: 2,
      backgroundColor: '#0f766e',
    },
  },
  azureSectionTab: {
    textTransform: 'none',
    fontSize: '0.95rem',
    fontWeight: 600,
    minHeight: 44,
    minWidth: 160,
    '&.Mui-selected': {
      color: '#0f766e',
    },
  },
  toolCard: {
    height: '100%',
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: theme.shadows[8],
      transform: 'translateY(-2px)',
    },
  },
  cardArea: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  cardHeader: {
    padding: theme.spacing(2),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: '#fff',
  },
  toolTitle: {
    fontSize: '1rem',
    lineHeight: 1.3,
    fontWeight: 600,
  },
  toolDescription: {
    fontSize: '0.84rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.5,
  },
  sectionTitle: {
    fontSize: '1.05rem',
    marginBottom: theme.spacing(2),
    fontWeight: 600,
  },
  vmCard: {
    marginBottom: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
  },
  vmHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(1),
  },
  vmSubText: {
    fontSize: '0.82rem',
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1.5),
  },
  vmScopeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1.5),
    flexWrap: 'wrap',
  },
  vmScopeInput: {
    minWidth: 280,
  },
  vmTable: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 10,
  },
  vmActionButton: {
    minWidth: 90,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '0.8rem',
  },
  vmError: {
    color: theme.palette.error.main,
    fontSize: '0.85rem',
  },
  summaryBar: {
    marginBottom: theme.spacing(1.5),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  },
  summaryCost: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#0f766e',
  },
  subtleText: {
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
  },
  expandCell: {
    width: 44,
    paddingLeft: 4,
    paddingRight: 4,
  },
  detailWrapCell: {
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: '#f8fafc',
  },
  detailInner: {
    padding: theme.spacing(1.5),
  },
  detailTable: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    overflow: 'hidden',
  },
  detailHeading: {
    fontSize: '0.8rem',
    fontWeight: 600,
    marginBottom: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  unavailableText: {
    fontSize: '0.78rem',
    color: theme.palette.error.dark,
  },
}));

function VmStopStartCard({ provider }: { provider: CloudProvider }) {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VmRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingVm, setActingVm] = useState<string | null>(null);
  const [canControl, setCanControl] = useState(false);
  const defaultAzureResourceGroup = provider === 'azure' ? 'rg-gpu-sdc' : '';
  const [resourceGroupScope, setResourceGroupScope] = useState(
    defaultAzureResourceGroup,
  );
  const [resourceGroupInput, setResourceGroupInput] = useState(
    defaultAzureResourceGroup,
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await backendFetch(
          'cost-automation',
          '/cloud/vms/permissions',
        );
        const body = await res.json();
        if (active) setCanControl(res.ok && Boolean(body?.authorized));
      } catch {
        if (active) setCanControl(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [backendFetch]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const scopeQuery =
          provider === 'azure' && resourceGroupScope.trim()
            ? `&resourceGroup=${encodeURIComponent(resourceGroupScope.trim())}`
            : '';
        const res = await backendFetch(
          'cost-automation',
          `/cloud/vms?provider=${provider}${scopeQuery}`,
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? `Failed to load VMs (${res.status})`);
        }
        if (!active) return;
        setRows((data?.vms ?? []) as VmRecord[]);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [backendFetch, provider, resourceGroupScope]);

  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => a.vmName.localeCompare(b.vmName)),
    [rows],
  );

  const runAction = async (row: VmRecord) => {
    const action = row.currentState === 'Running' ? 'stop' : 'start';
    setActingVm(row.vmName);
    setError(null);
    try {
      const scopeQuery =
        provider === 'azure' && resourceGroupScope.trim()
          ? `?resourceGroup=${encodeURIComponent(resourceGroupScope.trim())}`
          : '';
      const res = await backendFetch(
        'cost-automation',
        `/cloud/vms/${encodeURIComponent(provider)}/${encodeURIComponent(
          row.vmName,
        )}/action${scopeQuery}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ?? `Failed to ${action} VM (${res.status})`,
        );
      }
      const updated = data?.vm as VmRecord;
      setRows(prev =>
        prev.map(vm => (vm.vmName === updated.vmName ? updated : vm)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingVm(null);
    }
  };

  const applyResourceGroupScope = () => {
    setResourceGroupScope(resourceGroupInput.trim());
  };

  const clearResourceGroupScope = () => {
    setResourceGroupInput('');
    setResourceGroupScope('');
  };

  return (
    <Card className={classes.vmCard} elevation={0}>
      <CardContent>
        <div className={classes.vmHeader}>
          <Typography
            className={classes.sectionTitle}
            style={{ marginBottom: 0 }}
          >
            VM Stop/Start
          </Typography>
          <Chip
            size="small"
            icon={<StorageIcon style={{ fontSize: 16 }} />}
            label={provider.toUpperCase()}
          />
        </div>
        <Typography className={classes.vmSubText}>
          Manage standalone virtual machines.{' '}
          {canControl
            ? 'Start/stop is authorized for your account.'
            : 'Start/stop requires membership of the VM operators Entra group.'}
        </Typography>

        {provider === 'azure' && (
          <div className={classes.vmScopeRow}>
            <TextField
              label="Resource Group"
              size="small"
              variant="outlined"
              className={classes.vmScopeInput}
              value={resourceGroupInput}
              onChange={event => setResourceGroupInput(event.target.value)}
              placeholder="e.g. rg-gpu-sdc"
              helperText="When set, CloudHub lists and manages all VMs in this resource group."
            />
            <Button
              size="small"
              variant="outlined"
              onClick={applyResourceGroupScope}
              disabled={
                loading ||
                resourceGroupInput.trim() === resourceGroupScope.trim()
              }
            >
              Apply Scope
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={clearResourceGroupScope}
              disabled={loading || (!resourceGroupInput && !resourceGroupScope)}
            >
              Clear
            </Button>
            <Typography className={classes.subtleText}>
              Active scope: {resourceGroupScope || 'All env=dev VMs'}
            </Typography>
          </div>
        )}

        {error && <Typography className={classes.vmError}>{error}</Typography>}

        {loading ? (
          <Box display="flex" alignItems="center" py={2} sx={{ gap: 1.25 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="textSecondary">
              Loading virtual machines...
            </Typography>
          </Box>
        ) : (
          <TableContainer
            component={Paper}
            elevation={0}
            className={classes.vmTable}
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>VM Name</TableCell>
                  <TableCell>RG Name</TableCell>
                  <TableCell>Instance Type</TableCell>
                  <TableCell>Uptime</TableCell>
                  <TableCell>Current State</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Cost/Month</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orderedRows.map(row => {
                  const running = row.currentState === 'Running';
                  const busy = actingVm === row.vmName;
                  return (
                    <TableRow key={`${row.provider}:${row.vmName}`}>
                      <TableCell className={classes.mono}>
                        {row.vmName}
                      </TableCell>
                      <TableCell>{row.resourceGroupName}</TableCell>
                      <TableCell>{row.instanceType}</TableCell>
                      <TableCell>{row.uptime}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={row.currentState}
                          style={getVmStateStyle(row.currentState)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          variant="contained"
                          color={running ? 'secondary' : 'primary'}
                          className={classes.vmActionButton}
                          disabled={busy || !canControl}
                          startIcon={running ? <StopIcon /> : <PlayArrowIcon />}
                          onClick={() => runAction(row)}
                        >
                          {getVmButtonLabel(busy, running)}
                        </Button>
                      </TableCell>
                      <TableCell>${row.costPerMonth}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

const IN_FLIGHT_GPU_STATUSES = new Set([
  'PROVISIONING',
  'STARTING',
  'STOPPING',
  'DELETING',
]);

function GpuInstancesCostCard() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<GpuInstanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      setError(null);
      try {
        const res = await backendFetch(
          'deployment-control-plane',
          '/gpu-instances',
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? `Failed to load GPU instances (${res.status})`);
        }
        const items = (data?.items ?? []) as GpuInstanceRecord[];
        setRows(items.filter(item => item.status !== 'DELETED'));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [backendFetch],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await backendFetch(
          'deployment-control-plane',
          '/gpu-instances/permissions',
        );
        const body = await res.json();
        if (active) setAuthorized(res.ok && Boolean(body.authorized));
      } catch {
        if (active) setAuthorized(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [backendFetch]);

  useEffect(() => {
    if (authorized) void load();
  }, [authorized, load]);

  useEffect(() => {
    if (!authorized) return undefined;
    const hasInFlight = rows.some(row => IN_FLIGHT_GPU_STATUSES.has(row.status));
    if (!hasInFlight) return undefined;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [authorized, rows, load]);

  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  const runPowerAction = async (row: GpuInstanceRecord, action: 'start' | 'stop') => {
    setActingId(row.id);
    setError(null);
    try {
      const res = await backendFetch(
        'deployment-control-plane',
        `/gpu-instances/${encodeURIComponent(row.id)}/${action}`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed to ${action} GPU instance (${res.status})`);
      }
      setRows(prev => prev.map(item => (item.id === row.id ? data : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  // Not a member of the configured GPU Entra ID group — hide the section
  // entirely rather than showing an empty/errored card.
  if (authorized === false) return null;

  return (
    <Card className={classes.vmCard} elevation={0}>
      <CardContent>
        <div className={classes.vmHeader}>
          <Typography className={classes.sectionTitle} style={{ marginBottom: 0 }}>
            GPU Instances
          </Typography>
          <Chip
            size="small"
            icon={<MemoryIcon style={{ fontSize: 16 }} />}
            label="rg-gpu-sdc"
          />
        </div>
        <Typography className={classes.vmSubText}>
          Stop idle GPU VMs to pause compute billing, and start them again
          when work resumes. Deleting an instance is managed from{' '}
          <strong>GPU Compute</strong>.
        </Typography>

        {error && <Typography className={classes.vmError}>{error}</Typography>}

        {(() => {
          if (authorized === null || loading) {
            return (
              <Box display="flex" alignItems="center" py={2} sx={{ gap: 1.25 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="textSecondary">
                  Loading GPU instances...
                </Typography>
              </Box>
            );
          }
          if (orderedRows.length === 0) {
            return (
              <Typography variant="body2" color="textSecondary">
                No GPU instances requested yet.
              </Typography>
            );
          }
          return (
          <TableContainer component={Paper} elevation={0} className={classes.vmTable}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>VM Name</TableCell>
                  <TableCell>GPU SKU</TableCell>
                  <TableCell>Region</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orderedRows.map(row => {
                  const busy = actingId === row.id;
                  const canStart =
                    row.status === 'STOPPED' || row.status === 'START_FAILED';
                  const canStop =
                    row.status === 'READY' || row.status === 'STOP_FAILED';
                  return (
                    <TableRow key={row.id}>
                      <TableCell className={classes.mono}>{row.name}</TableCell>
                      <TableCell>{row.gpuSku.toUpperCase()}</TableCell>
                      <TableCell>{row.region}</TableCell>
                      <TableCell>
                        <GpuInstanceStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>{row.owner}</TableCell>
                      <TableCell>
                        {(canStart || canStop) && (
                          <Button
                            size="small"
                            variant="contained"
                            color={canStop ? 'secondary' : 'primary'}
                            className={classes.vmActionButton}
                            disabled={busy}
                            startIcon={canStop ? <StopIcon /> : <PlayArrowIcon />}
                            onClick={() =>
                              runPowerAction(row, canStop ? 'stop' : 'start')
                            }
                          >
                            {gpuPowerButtonLabel(busy, canStop)}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function AksClusterCostCard({ provider }: { provider: CloudProvider }) {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AksClusterCostRecord[]>([]);
  const [totalMonthlyCostUsd, setTotalMonthlyCostUsd] = useState(0);
  const [clusterCount, setClusterCount] = useState(0);
  const [note, setNote] = useState<string | undefined>();
  const [fetchedAt, setFetchedAt] = useState<string | undefined>();
  const [, setDefaultVmHourlyRateUsd] = useState<number | undefined>();
  const [, setUsedDefaultRateForUnknownVmSize] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(
    new Set(),
  );

  const readCachedAksCost = () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(AKS_COST_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as AksClusterCostCache;
      setRows(Array.isArray(cached.rows) ? cached.rows : []);
      setTotalMonthlyCostUsd(Number(cached.totalMonthlyCostUsd ?? 0));
      setClusterCount(Number(cached.clusterCount ?? 0));
      setNote(cached.note);
      setDefaultVmHourlyRateUsd(cached.defaultVmHourlyRateUsd);
      setUsedDefaultRateForUnknownVmSize(
        Boolean(cached.usedDefaultRateForUnknownVmSize),
      );
      setFetchedAt(cached.fetchedAt);
    } catch {
      window.localStorage.removeItem(AKS_COST_CACHE_KEY);
    }
  };

  const writeCachedAksCost = (cache: AksClusterCostCache) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AKS_COST_CACHE_KEY, JSON.stringify(cache));
  };

  const refreshAksCost = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendFetch('cost-automation', '/azure/aks/cost');
      const data = (await res.json()) as AksClusterCostResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          data?.error ?? `Failed to load AKS cluster costs (${res.status})`,
        );
      }

      const nextRows = data.clusters ?? [];
      const nextTotal = data.totalMonthlyCostUsd ?? 0;
      const nextCount = data.clusterCount ?? 0;
      const nextNote = data.model?.note;
      const nextDefaultVmHourlyRateUsd = data.model?.defaultVmHourlyRateUsd;
      const nextUsedDefaultRateForUnknownVmSize = Boolean(
        data.model?.usedDefaultRateForUnknownVmSize,
      );
      const nextFetchedAt = data.fetchedAt ?? new Date().toISOString();

      setRows(nextRows);
      setTotalMonthlyCostUsd(nextTotal);
      setClusterCount(nextCount);
      setNote(nextNote);
      setDefaultVmHourlyRateUsd(nextDefaultVmHourlyRateUsd);
      setUsedDefaultRateForUnknownVmSize(nextUsedDefaultRateForUnknownVmSize);
      setFetchedAt(nextFetchedAt);

      writeCachedAksCost({
        rows: nextRows,
        totalMonthlyCostUsd: nextTotal,
        clusterCount: nextCount,
        note: nextNote,
        defaultVmHourlyRateUsd: nextDefaultVmHourlyRateUsd,
        usedDefaultRateForUnknownVmSize: nextUsedDefaultRateForUnknownVmSize,
        fetchedAt: nextFetchedAt,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (provider !== 'azure') {
      setLoading(false);
      return undefined;
    }

    readCachedAksCost();
    return undefined;
  }, [provider]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd),
    [rows],
  );

  const toggleRow = (clusterKey: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterKey)) {
        next.delete(clusterKey);
      } else {
        next.add(clusterKey);
      }
      return next;
    });
  };

  const renderAksCostBody = () => {
    if (loading) {
      return (
        <Box display="flex" alignItems="center" sx={{ gap: 1.25 }} py={2}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="textSecondary">
            Refreshing AKS cluster costs...
          </Typography>
        </Box>
      );
    }

    if (rows.length === 0) {
      return (
        <Typography variant="body2" color="textSecondary">
          No cached AKS cost data is available yet. Click Refresh to run a
          live Azure cost query.
        </Typography>
      );
    }

    return (
      <>
        <div className={classes.summaryBar}>
          <Typography variant="body2" color="textSecondary">
            {clusterCount} cluster{clusterCount === 1 ? '' : 's'}
          </Typography>
          <Typography className={classes.summaryCost}>
            $
            {totalMonthlyCostUsd.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            /month
          </Typography>
        </div>
        <Typography className={classes.subtleText}>
          Last refreshed: {fetchedAt ? new Date(fetchedAt).toLocaleString() : 'Unknown'}
        </Typography>
        {note && <Typography className={classes.subtleText}>{note}</Typography>}

        <TableContainer
          component={Paper}
          elevation={0}
          className={classes.vmTable}
          style={{ marginTop: 12 }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell className={classes.expandCell} />
                <TableCell>Cluster</TableCell>
                <TableCell>Resource Group</TableCell>
                <TableCell>Region</TableCell>
                <TableCell>Power</TableCell>
                <TableCell>Node Pools</TableCell>
                <TableCell>Top VM Sizes</TableCell>
                <TableCell>Estimated Cost/Month</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedRows.map(row => {
                const clusterKey = `${row.clusterName}:${row.resourceGroup}`;
                const expanded = expandedClusters.has(clusterKey);
                const topVmSizes = row.nodePools
                  .slice()
                  .sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd)
                  .slice(0, 2)
                  .map(pool => pool.vmSize)
                  .join(', ');
                return (
                  <Fragment key={clusterKey}>
                    <TableRow>
                      <TableCell className={classes.expandCell}>
                        <IconButton
                          size="small"
                          aria-label={
                            expanded
                              ? 'Collapse node pool details'
                              : 'Expand node pool details'
                          }
                          onClick={() => toggleRow(clusterKey)}
                        >
                          {expanded ? (
                            <KeyboardArrowUpIcon fontSize="small" />
                          ) : (
                            <KeyboardArrowDownIcon fontSize="small" />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell>{row.clusterName}</TableCell>
                      <TableCell>{row.resourceGroup}</TableCell>
                      <TableCell>{row.location}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={row.powerState}
                          color={row.powerState === 'Running' ? 'primary' : 'default'}
                        />
                      </TableCell>
                      <TableCell>{row.nodePools.length}</TableCell>
                      <TableCell>{topVmSizes || '—'}</TableCell>
                      <TableCell>
                        ${row.monthlyCostUsd.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={7} style={{ paddingTop: 0 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Node Pool</TableCell>
                                <TableCell>VM Size</TableCell>
                                <TableCell>Node Count</TableCell>
                                <TableCell>Hourly / Node</TableCell>
                                <TableCell>Estimated Monthly</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {row.nodePools.map(pool => (
                                <TableRow key={`${clusterKey}:${pool.name}`}>
                                  <TableCell>{pool.name}</TableCell>
                                  <TableCell>{pool.vmSize}</TableCell>
                                  <TableCell>{pool.nodeCount}</TableCell>
                                  <TableCell>
                                    ${pool.hourlyRateUsd.toFixed(4)}
                                  </TableCell>
                                  <TableCell>
                                    ${pool.monthlyCostUsd.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </>
    );
  };

  if (provider !== 'azure') {
    return (
      <Card className={classes.vmCard} elevation={0}>
        <CardContent>
          <div className={classes.vmHeader}>
            <Typography
              className={classes.sectionTitle}
              style={{ marginBottom: 0 }}
            >
              Cluster Cost
            </Typography>
            <Chip
              size="small"
              icon={<MonetizationOnIcon style={{ fontSize: 16 }} />}
              label={provider.toUpperCase()}
            />
          </div>
          <Typography className={classes.vmSubText}>
            Cluster cost calculation for this cloud provider tab is planned and
            will be enabled in a future iteration.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={classes.vmCard} elevation={0}>
      <CardContent>
        <div className={classes.vmHeader}>
          <Typography
            className={classes.sectionTitle}
            style={{ marginBottom: 0 }}
          >
            AKS Cluster Cost
          </Typography>
          <Box display="flex" alignItems="center" sx={{ gap: 1 }}>
            <Chip
              size="small"
              icon={<MonetizationOnIcon style={{ fontSize: 16 }} />}
              label="AZURE"
            />
            <Button
              size="small"
              variant="outlined"
              color="primary"
              onClick={() => void refreshAksCost()}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Box>
        </div>
        <Typography className={classes.vmSubText}>
          Estimated monthly AKS node compute cost by cluster and node pool.
          Data is loaded from the latest saved snapshot until you refresh.
        </Typography>

        {error && <Typography className={classes.vmError}>{error}</Typography>}

        {renderAksCostBody()}
      </CardContent>
    </Card>
  );
}
// ─── Helpers ──────────────────────────────────────────────────────────

function getVmStateStyle(currentState: 'Running' | 'Stopped') {
  return currentState === 'Running'
    ? { backgroundColor: '#e8f5e9', color: '#1b5e20' }
    : { backgroundColor: '#f3f4f6', color: '#374151' };
}

function getVmButtonLabel(busy: boolean, running: boolean): string {
  if (busy) return 'Working...';
  return running ? 'Stop' : 'Start';
}

function gpuPowerButtonLabel(busy: boolean, canStop: boolean): string {
  if (busy) return canStop ? 'Stopping...' : 'Starting...';
  return canStop ? 'Stop' : 'Start';
}
// ─── Tab Panel Component ──────────────────────────────────────────────────────

function TabPanel(props: any) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`cost-tabpanel-${index}`}
      aria-labelledby={`cost-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CostOptimizationPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedAzureSectionTab, setSelectedAzureSectionTab] = useState(0);

  const handleTabChange = (_event: React.ChangeEvent<{}>, newValue: number) => {
    setSelectedTab(newValue);
  };

  const handleAzureSectionTabChange = (
    _event: React.ChangeEvent<{}>,
    newValue: number,
  ) => {
    setSelectedAzureSectionTab(newValue);
  };

  const renderToolsGrid = (tools: CostTool[]) => (
    <Grid container spacing={3}>
      {tools.map(tool => (
        <Grid item xs={12} sm={6} md={4} lg={3} key={tool.id}>
          <Card className={classes.toolCard} elevation={0}>
            <CardActionArea
              className={classes.cardArea}
              onClick={() => tool.href !== '#' && navigate(tool.href)}
              style={{ cursor: tool.href === '#' ? 'default' : 'pointer' }}
            >
              <div className={classes.cardHeader}>
                <div
                  className={classes.iconBox}
                  style={{ background: tool.gradient }}
                >
                  <tool.Icon style={{ fontSize: 26 }} />
                </div>
                <Typography className={classes.toolTitle}>
                  {tool.title}
                </Typography>
              </div>
              <CardContent>
                <Typography className={classes.toolDescription}>
                  {tool.description}
                </Typography>
                {tool.secondaryText && (
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    style={{ marginTop: 4, display: 'block' }}
                  >
                    {tool.secondaryText}
                  </Typography>
                )}
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );

  return (
    <div className={classes.root}>
      {/* Hero */}
      <div className={classes.heroSection}>
        <Typography variant="h4" className={classes.heroTitle}>
          Cost Optimization
        </Typography>
        <Typography className={classes.heroSubtitle}>
          Automate and govern cloud spend — schedule cluster start/stop,
          right-size node pools, and track savings across providers.
        </Typography>
      </div>

      {/* Tabs */}
      <div className={classes.tabsContainer}>
        <Tabs
          className={classes.tabs}
          value={selectedTab}
          onChange={handleTabChange}
          aria-label="cloud providers"
        >
          <Tab
            className={classes.tab}
            label="Azure"
            id="cost-tab-0"
            aria-controls="cost-tabpanel-0"
          />
          <Tab
            className={classes.tab}
            label="AWS"
            id="cost-tab-1"
            aria-controls="cost-tabpanel-1"
          />
          <Tab
            className={classes.tab}
            label="GCP"
            id="cost-tab-2"
            aria-controls="cost-tabpanel-2"
          />
        </Tabs>
      </div>

      {/* Tab Content */}
      <TabPanel value={selectedTab} index={0} className={classes.tabContent}>
        <div className={classes.azureSectionTabsContainer}>
          <Tabs
            className={classes.azureSectionTabs}
            value={selectedAzureSectionTab}
            onChange={handleAzureSectionTabChange}
            variant="scrollable"
            scrollButtons="auto"
            aria-label="azure cost optimization sections"
          >
            <Tab
              className={classes.azureSectionTab}
              label="AKS Cluster Cost"
              id="azure-section-tab-0"
              aria-controls="azure-section-tabpanel-0"
            />
            <Tab
              className={classes.azureSectionTab}
              label="GPU Instances"
              id="azure-section-tab-1"
              aria-controls="azure-section-tabpanel-1"
            />
            <Tab
              className={classes.azureSectionTab}
              label="VM Stop/Start"
              id="azure-section-tab-2"
              aria-controls="azure-section-tabpanel-2"
            />
          </Tabs>
        </div>

        <TabPanel value={selectedAzureSectionTab} index={0} id="azure-section-tabpanel-0" aria-labelledby="azure-section-tab-0">
          <AksClusterCostCard provider="azure" />
        </TabPanel>
        <TabPanel value={selectedAzureSectionTab} index={1} id="azure-section-tabpanel-1" aria-labelledby="azure-section-tab-1">
          <GpuInstancesCostCard />
        </TabPanel>
        <TabPanel value={selectedAzureSectionTab} index={2} id="azure-section-tabpanel-2" aria-labelledby="azure-section-tab-2">
          <VmStopStartCard provider="azure" />
        </TabPanel>

        <Typography className={classes.sectionTitle}>
          Available tools
        </Typography>
        {renderToolsGrid(AZURE_COST_TOOLS)}
      </TabPanel>

      <TabPanel value={selectedTab} index={1} className={classes.tabContent}>
        <AksClusterCostCard provider="aws" />
        <VmStopStartCard provider="aws" />
        <Typography className={classes.sectionTitle}>
          Available tools
        </Typography>
        {renderToolsGrid(AWS_COST_TOOLS)}
      </TabPanel>

      <TabPanel value={selectedTab} index={2} className={classes.tabContent}>
        <AksClusterCostCard provider="gcp" />
        <VmStopStartCard provider="gcp" />
        <Typography className={classes.sectionTitle}>
          Available tools
        </Typography>
        {renderToolsGrid(GCP_COST_TOOLS)}
      </TabPanel>
    </div>
  );
}
