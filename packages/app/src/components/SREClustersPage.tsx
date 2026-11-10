import { useEffect, useState } from 'react';
import {
  Typography,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Collapse,
  Box,
  Tooltip,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import StorageIcon from '@mui/icons-material/Storage';
import AppsIcon from '@mui/icons-material/Apps';
import BusinessIcon from '@mui/icons-material/Business';
import { PersonaGuard } from './PersonaGuard';
import { OperationsTabs } from './OperationsTabs';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeployedApp {
  name: string;
  version: string;
  namespace: string;
  syncStatus: 'Synced' | 'OutOfSync' | 'Unknown';
}

interface ClusterRow {
  id: string;
  name: string;
  environment: 'production' | 'staging' | 'development';
  region: string;
  customer: string;
  k8sVersion: string;
  nodeCount: number;
  status: 'healthy' | 'degraded' | 'unknown';
  apps: DeployedApp[];
  lastChecked: string;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1600,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.between('lg', 'xl')]: { padding: theme.spacing(2.5) },
    [theme.breakpoints.up('xl')]: { padding: theme.spacing(4) },
  },
  readOnlyBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1.5),
    borderRadius: 6,
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(0,0,0,0.04)',
    border: `1px solid ${
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.1)'
        : 'rgba(0,0,0,0.1)'
    }`,
    marginBottom: theme.spacing(3),
    width: 'fit-content',
  },
  lockIcon: {
    fontSize: 14,
    color: theme.palette.text.secondary,
  },
  readOnlyText: {
    fontSize: '0.72rem',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
  },
  pageTitle: {
    marginBottom: theme.spacing(0.5),
  },
  pageSubtitle: {
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(3),
    fontSize: '0.875rem',
  },
  kpiCard: {
    borderRadius: 8,
    height: '100%',
  },
  kpiContent: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5, 2),
    '&:last-child': { paddingBottom: theme.spacing(1.5) },
  },
  kpiIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  kpiValue: {
    fontSize: '1.6rem',
    lineHeight: 1,
    [theme.breakpoints.up('xl')]: { fontSize: '2rem' },
  },
  kpiLabel: {
    fontSize: '0.72rem',
    color: theme.palette.text.secondary,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  sectionTitle: {
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(1.5),
  },
  tableContainer: {
    borderRadius: 8,
    overflowX: 'auto',
  },
  tableHeader: {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? theme.palette.grey[800]
        : theme.palette.grey[50],
    '& th': {
      fontSize: '0.75rem',
      letterSpacing: 0.3,
      textTransform: 'uppercase',
      color: theme.palette.text.secondary,
      borderBottom: `2px solid ${theme.palette.divider}`,
    },
  },
  expandRow: {
    '& > td': { borderBottom: 'none' },
  },
  appsSubTable: {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.03)'
        : 'rgba(0,0,0,0.01)',
    '& td': {
      fontSize: '0.8rem',
      paddingTop: theme.spacing(0.75),
      paddingBottom: theme.spacing(0.75),
    },
  },
  appsSubHeader: {
    '& th': {
      fontSize: '0.7rem',
      color: theme.palette.text.disabled,
      letterSpacing: 0.3,
      paddingTop: theme.spacing(0.5),
      paddingBottom: theme.spacing(0.5),
    },
  },
  monoText: {
    fontFamily: 'monospace',
    fontSize: '0.8rem',
  },
  // Status chips
  chipHealthy: {
    backgroundColor: '#e8f5e9',
    color: '#1b5e20',
    height: 22,
    fontSize: '0.7rem',
  },
  chipDegraded: {
    backgroundColor: '#fff3e0',
    color: '#e65100',
    height: 22,
    fontSize: '0.7rem',
  },
  chipUnknown: {
    backgroundColor: theme.palette.grey[100],
    color: theme.palette.text.secondary,
    height: 22,
    fontSize: '0.7rem',
  },
  // Env chips
  chipProd: {
    backgroundColor: '#fce4ec',
    color: '#880e4f',
    height: 20,
    fontSize: '0.65rem',
  },
  chipStaging: {
    backgroundColor: '#e3f2fd',
    color: '#0d47a1',
    height: 20,
    fontSize: '0.65rem',
  },
  chipDev: {
    backgroundColor: '#f3e5f5',
    color: '#4a148c',
    height: 20,
    fontSize: '0.65rem',
  },
  // Sync status
  syncSynced: { color: '#2e7d32', fontSize: '0.75rem' },
  syncOutOfSync: { color: '#e65100', fontSize: '0.75rem' },
  syncUnknown: { color: theme.palette.text.disabled, fontSize: '0.75rem' },
}));

// ─── Helper sub-components ────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ClusterRow['status'] }) {
  if (status === 'healthy')
    return (
      <CheckCircleOutlineIcon style={{ color: '#2e7d32', fontSize: 18 }} />
    );
  if (status === 'degraded')
    return <ErrorOutlineIcon style={{ color: '#e65100', fontSize: 18 }} />;
  return <HelpOutlineIcon style={{ color: '#9e9e9e', fontSize: 18 }} />;
}

function EnvChip({
  env,
  classes,
}: {
  env: ClusterRow['environment'];
  classes: ReturnType<typeof useStyles>;
}) {
  const map = {
    production: { cls: classes.chipProd, label: 'prod' },
    staging: { cls: classes.chipStaging, label: 'staging' },
    development: { cls: classes.chipDev, label: 'dev' },
  };
  const { cls, label } = map[env];
  return <Chip label={label} className={cls} />;
}

function SyncBadge({
  status,
  classes,
}: {
  status: DeployedApp['syncStatus'];
  classes: ReturnType<typeof useStyles>;
}) {
  if (status === 'Synced')
    return <span className={classes.syncSynced}>● Synced</span>;
  if (status === 'OutOfSync')
    return <span className={classes.syncOutOfSync}>● Out of Sync</span>;
  return <span className={classes.syncUnknown}>● Unknown</span>;
}

// ─── Expandable cluster row ────────────────────────────────────────────────────

function ClusterTableRow({
  cluster,
  classes,
}: {
  cluster: ClusterRow;
  classes: ReturnType<typeof useStyles>;
}) {
  const [open, setOpen] = useState(false);

  let statusChipClass: string;
  if (cluster.status === 'healthy') {
    statusChipClass = classes.chipHealthy;
  } else if (cluster.status === 'degraded') {
    statusChipClass = classes.chipDegraded;
  } else {
    statusChipClass = classes.chipUnknown;
  }

  return (
    <>
      <TableRow hover className={open ? classes.expandRow : undefined}>
        {/* Expand toggle */}
        <TableCell padding="checkbox">
          <Tooltip
            title={
              open ? 'Hide apps' : `Show ${cluster.apps.length} deployed app(s)`
            }
          >
            <IconButton size="small" onClick={() => setOpen(o => !o)}>
              {open ? (
                <KeyboardArrowUpIcon fontSize="small" />
              ) : (
                <KeyboardArrowDownIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </TableCell>

        <TableCell>
          <Box display="flex" alignItems="center" sx={{ gap: 0.75 }}>
            <StatusIcon status={cluster.status} />
            <Typography className={classes.monoText}>{cluster.name}</Typography>
          </Box>
        </TableCell>

        <TableCell>
          <EnvChip env={cluster.environment} classes={classes} />
        </TableCell>

        <TableCell>{cluster.region}</TableCell>

        <TableCell>
          <Box display="flex" alignItems="center" sx={{ gap: 0.75 }}>
            <BusinessIcon style={{ fontSize: 14, opacity: 0.5 }} />
            {cluster.customer}
          </Box>
        </TableCell>

        <TableCell>
          <Typography className={classes.monoText}>
            v{cluster.k8sVersion}
          </Typography>
        </TableCell>

        <TableCell align="center">{cluster.nodeCount}</TableCell>

        <TableCell>
          <Chip
            label={
              cluster.status.charAt(0).toUpperCase() + cluster.status.slice(1)
            }
            className={statusChipClass}
          />
        </TableCell>

        <TableCell align="center">
          <Chip
            label={cluster.apps.length}
            size="small"
            style={{ background: 'transparent' }}
          />
        </TableCell>

        <TableCell style={{ color: '#9e9e9e', fontSize: '0.75rem' }}>
          {cluster.lastChecked}
        </TableCell>
      </TableRow>

      {/* Expanded apps row */}
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={10}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box margin={1} marginLeft={5}>
              <Table size="small" className={classes.appsSubTable}>
                <TableHead className={classes.appsSubHeader}>
                  <TableRow>
                    <TableCell>App Name</TableCell>
                    <TableCell>Version</TableCell>
                    <TableCell>Namespace</TableCell>
                    <TableCell>ArgoCD Sync</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cluster.apps.map(app => (
                    <TableRow key={app.name}>
                      <TableCell>
                        <Typography className={classes.monoText}>
                          {app.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          className={classes.monoText}
                          style={{ color: '#6e6e6e' }}
                        >
                          {app.version}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          className={classes.monoText}
                          style={{ opacity: 0.7 }}
                        >
                          {app.namespace}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <SyncBadge status={app.syncStatus} classes={classes} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function SREClustersContent() {
  const classes = useStyles();
  const { persona } = usePersona();
  const backendFetch = useBackendFetch();
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    backendFetch('platform-registry', '/clusters/onboarded?pageSize=200')
      .then(async response => {
        if (!response.ok) throw new Error(`Platform Registry returned HTTP ${response.status}`);
        return (await response.json()) as { items?: Array<Record<string, any>> };
      })
      .then(body => {
        if (cancelled) return;
        setClusters((body.items ?? []).map(cluster => ({
          id: String(cluster.id),
          name: String(cluster.clusterName ?? 'Unknown cluster'),
          environment: String(cluster.environmentName ?? 'development').toLowerCase() === 'prod' ? 'production' : String(cluster.environmentName ?? 'development').toLowerCase() === 'staging' ? 'staging' : 'development',
          region: String(cluster.region ?? 'Unknown'),
          customer: String(cluster.platformName ?? 'CloudHub'),
          k8sVersion: String(cluster.kubernetesVersion ?? 'Unknown'),
          nodeCount: 0,
          status: cluster.status === 'error' ? 'degraded' : cluster.status === 'active' ? 'healthy' : 'unknown',
          apps: [],
          lastChecked: 'Just now',
        })));
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [backendFetch, persona]);

  const totalEnvs = clusters.length;
  const healthy = clusters.filter(c => c.status === 'healthy').length;
  const degraded = clusters.filter(
    c => c.status === 'degraded',
  ).length;
  const totalApps = clusters.reduce(
    (acc, c) => acc + c.apps.length,
    0,
  );
  const customers = new Set(clusters.map(c => c.customer)).size;

  const kpis = [
    {
      label: 'Total Environments',
      value: totalEnvs,
      icon: <StorageIcon style={{ color: '#1565c0' }} />,
      bg: 'rgba(21,101,192,0.08)',
    },
    {
      label: 'Healthy',
      value: healthy,
      icon: <CheckCircleOutlineIcon style={{ color: '#2e7d32' }} />,
      bg: 'rgba(46,125,50,0.08)',
    },
    {
      label: 'Degraded',
      value: degraded,
      icon: <ErrorOutlineIcon style={{ color: '#e65100' }} />,
      bg: 'rgba(230,81,0,0.08)',
    },
    {
      label: 'Deployed Apps',
      value: totalApps,
      icon: <AppsIcon style={{ color: '#6a1b9a' }} />,
      bg: 'rgba(106,27,154,0.08)',
    },
    {
      label: 'Customers',
      value: customers,
      icon: <BusinessIcon style={{ color: '#00695c' }} />,
      bg: 'rgba(0,105,92,0.08)',
    },
  ];

  return (
    <div className={classes.root}>
      <OperationsTabs />

      {/* Read-only badge */}
      <div className={classes.readOnlyBanner}>
        <LockOutlinedIcon className={classes.lockIcon} />
        <Typography className={classes.readOnlyText}>
          Read-Only Access
        </Typography>
      </div>

      <Typography variant="h4" className={classes.pageTitle}>
        Environment Health Overview
      </Typography>
      <Typography className={classes.pageSubtitle}>
        Real-time view of all AKS environments, deployed applications, and
        customer alignment.
      </Typography>

      {/* KPI row */}
      <Grid container spacing={2}>
        {kpis.map(kpi => (
          <Grid item xs={6} sm={4} md key={kpi.label}>
            <Card className={classes.kpiCard} elevation={1}>
              <CardContent className={classes.kpiContent}>
                <div
                  className={classes.kpiIconBox}
                  style={{ backgroundColor: kpi.bg }}
                >
                  {kpi.icon}
                </div>
                <div>
                  <Typography className={classes.kpiValue}>
                    {kpi.value}
                  </Typography>
                  <Typography className={classes.kpiLabel}>
                    {kpi.label}
                  </Typography>
                </div>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Environment table */}
      <Typography variant="h6" className={classes.sectionTitle}>
        All Kubernetes Clusters
      </Typography>

      {error && <Typography color="error">Unable to load Platform Registry clusters: {error}</Typography>}

      <TableContainer
        component={Paper}
        className={classes.tableContainer}
        elevation={1}
      >
        <Table size="small">
          <TableHead className={classes.tableHeader}>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Environment</TableCell>
              <TableCell>Tier</TableCell>
              <TableCell>Region</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>K8s</TableCell>
              <TableCell align="center">Nodes</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Apps</TableCell>
              <TableCell>Last Checked</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={10} align="center">Loading clusters from Platform Registry...</TableCell></TableRow>
            ) : clusters.length === 0 ? (
              <TableRow><TableCell colSpan={10} align="center">No clusters found in Platform Registry.</TableCell></TableRow>
            ) : clusters.map(env => (
              <ClusterTableRow key={env.id} cluster={env} classes={classes} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

// ─── Exported page (RBAC guarded) ────────────────────────────────────────────

export function SREClustersPage() {
  return (
    <PersonaGuard
      allowed={['cloudhub-platform', 'sre']}
      resource="Environment Health Overview"
    >
      <SREClustersContent />
    </PersonaGuard>
  );
}
