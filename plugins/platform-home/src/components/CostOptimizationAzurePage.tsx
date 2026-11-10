import { Typography, Grid, Card, CardContent, CardActionArea, Breadcrumbs, Link as MuiLink, Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, IconButton, Collapse } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { useBackendFetch } from '@internal/plugin-platform-common';

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
  model?: {
    note?: string;
    defaultVmHourlyRateUsd?: number;
    usedDefaultRateForUnknownVmSize?: boolean;
  };
  clusters: AksClusterCostRecord[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getNodePoolContent(
  row: AksClusterCostRecord,
  classes: ReturnType<typeof useStyles>,
) {
  if (row.unavailableReason) {
    return (
      <Typography className={classes.unavailableText}>
        Cost detail unavailable: {row.unavailableReason}
      </Typography>
    );
  }
  if (row.nodePools.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        No node pool cost details were returned for this cluster.
      </Typography>
    );
  }
  return null;
}

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
  breadcrumbs: {
    marginBottom: theme.spacing(2),
    fontSize: '0.85rem',
  },
  hero: {
    borderRadius: 14,
    padding: theme.spacing(3, 4),
    background: 'linear-gradient(135deg, #0078d4 0%, #50e6ff 100%)',
    color: '#fff',
    marginBottom: theme.spacing(4),
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: '#fff',
    opacity: 0.85,
    textDecoration: 'none',
    fontSize: '0.85rem',
    marginBottom: theme.spacing(1),
    '&:hover': { opacity: 1, textDecoration: 'underline' },
  },
  heroTitle: {
    fontSize: '1.8rem',
    fontWeight: 600,
  },
  heroSubtitle: {
    fontSize: '0.95rem',
    opacity: 0.9,
    marginTop: theme.spacing(0.5),
  },
  sectionTitle: {
    fontSize: '1.05rem',
    marginBottom: theme.spacing(2),
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
  costCard: {
    marginBottom: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
  },
  sectionTitleStrong: {
    fontSize: '1.05rem',
    fontWeight: 600,
    marginBottom: theme.spacing(1),
  },
  subText: {
    fontSize: '0.82rem',
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1.5),
  },
  costSummaryRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  },
  totalCost: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#0f766e',
  },
  noteText: {
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
    marginTop: theme.spacing(0.75),
  },
  tableWrap: {
    marginTop: theme.spacing(1.5),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 10,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '0.8rem',
  },
  errorText: {
    color: theme.palette.error.main,
    fontSize: '0.85rem',
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function AksClusterCostCard() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AksClusterCostRecord[]>([]);
  const [totalMonthlyCostUsd, setTotalMonthlyCostUsd] = useState(0);
  const [clusterCount, setClusterCount] = useState(0);
  const [note, setNote] = useState<string | undefined>();
  const [defaultVmHourlyRateUsd, setDefaultVmHourlyRateUsd] = useState<
    number | undefined
  >();
  const [usedDefaultRateForUnknownVmSize, setUsedDefaultRateForUnknownVmSize] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
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
        if (!active) return;
        setRows(data.clusters ?? []);
        setTotalMonthlyCostUsd(data.totalMonthlyCostUsd ?? 0);
        setClusterCount(data.clusterCount ?? 0);
        setNote(data.model?.note);
        setDefaultVmHourlyRateUsd(data.model?.defaultVmHourlyRateUsd);
        setUsedDefaultRateForUnknownVmSize(
          Boolean(data.model?.usedDefaultRateForUnknownVmSize),
        );
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
  }, [backendFetch]);

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

  return (
    <Card className={classes.costCard} elevation={0}>
      <CardContent>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          sx={{ gap: 1.25 }}
          mb={1}
        >
          <Typography className={classes.sectionTitleStrong}>
            AKS Cluster Cost
          </Typography>
          <Chip
            size="small"
            icon={<MonetizationOnIcon style={{ fontSize: 16 }} />}
            label="AZURE"
          />
        </Box>
        <Typography className={classes.subText}>
          Estimated monthly AKS node compute cost by cluster and node pool.
        </Typography>

        {error && (
          <Typography className={classes.errorText}>{error}</Typography>
        )}

        {loading ? (
          <Box display="flex" alignItems="center" py={2} sx={{ gap: 1.25 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="textSecondary">
              Calculating AKS cluster costs...
            </Typography>
          </Box>
        ) : (
          <>
            <div className={classes.costSummaryRow}>
              <Typography variant="body2" color="textSecondary">
                {clusterCount} cluster{clusterCount === 1 ? '' : 's'}
              </Typography>
              <Typography className={classes.totalCost}>
                $
                {totalMonthlyCostUsd.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                /month
              </Typography>
            </div>
            {note && (
              <Typography className={classes.noteText}>{note}</Typography>
            )}

            <TableContainer
              component={Paper}
              elevation={0}
              className={classes.tableWrap}
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
                          <TableCell className={classes.mono}>
                            {row.clusterName}
                          </TableCell>
                          <TableCell>{row.resourceGroup}</TableCell>
                          <TableCell>{row.location}</TableCell>
                          <TableCell>{row.powerState}</TableCell>
                          <TableCell>{row.nodePools.length}</TableCell>
                          <TableCell>{topVmSizes || '-'}</TableCell>
                          <TableCell>
                            $
                            {row.monthlyCostUsd.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className={classes.detailWrapCell}
                          >
                            <Collapse
                              in={expanded}
                              timeout="auto"
                              unmountOnExit
                            >
                              <div className={classes.detailInner}>
                                {getNodePoolContent(row, classes) || (
                                  <>
                                    <Typography
                                      className={classes.detailHeading}
                                    >
                                      Node Pool Breakdown
                                    </Typography>
                                    <TableContainer
                                      component={Paper}
                                      elevation={0}
                                      className={classes.detailTable}
                                    >
                                      <Table size="small">
                                        <TableHead>
                                          <TableRow>
                                            <TableCell>Node Pool</TableCell>
                                            <TableCell>Mode</TableCell>
                                            <TableCell>VM Size</TableCell>
                                            <TableCell>Node Count</TableCell>
                                            <TableCell>
                                              Hourly Rate (USD)
                                            </TableCell>
                                            <TableCell>Cost Model</TableCell>
                                            <TableCell>
                                              Estimated Cost/Month
                                            </TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {row.nodePools
                                            .slice()
                                            .sort(
                                              (a, b) =>
                                                b.monthlyCostUsd -
                                                a.monthlyCostUsd,
                                            )
                                            .map(pool => (
                                              <TableRow
                                                key={`${clusterKey}:${pool.name}`}
                                              >
                                                <TableCell
                                                  className={classes.mono}
                                                >
                                                  {pool.name}
                                                </TableCell>
                                                <TableCell>
                                                  {pool.mode}
                                                </TableCell>
                                                <TableCell>
                                                  {pool.vmSize}
                                                </TableCell>
                                                <TableCell>
                                                  {pool.nodeCount}
                                                </TableCell>
                                                <TableCell>
                                                  $
                                                  {pool.hourlyRateUsd.toLocaleString(
                                                    undefined,
                                                    {
                                                      minimumFractionDigits: 3,
                                                      maximumFractionDigits: 3,
                                                    },
                                                  )}
                                                </TableCell>
                                                <TableCell>
                                                  {pool.costModel === 'catalog'
                                                    ? 'Catalog'
                                                    : 'Default'}
                                                </TableCell>
                                                <TableCell>
                                                  $
                                                  {pool.monthlyCostUsd.toLocaleString(
                                                    undefined,
                                                    {
                                                      minimumFractionDigits: 2,
                                                      maximumFractionDigits: 2,
                                                    },
                                                  )}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                        </TableBody>
                                      </Table>
                                    </TableContainer>
                                  </>
                                )}
                              </div>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography className={classes.noteText}>
              Pricing legend: Catalog = VM size matched known hourly pricing.
              Default = fallback hourly rate used when VM size is not in the
              catalog.
              {typeof defaultVmHourlyRateUsd === 'number'
                ? ` Current default fallback: $${defaultVmHourlyRateUsd.toFixed(
                    3,
                  )}/hour.`
                : ''}
              {usedDefaultRateForUnknownVmSize
                ? ' At least one node pool in this result is using the default fallback rate.'
                : ' No node pools in this result are currently using the default fallback rate.'}
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CostOptimizationAzurePage() {
  const classes = useStyles();
  const navigate = useNavigate();

  return (
    <div className={classes.root}>
      <Breadcrumbs className={classes.breadcrumbs}>
        <MuiLink component={RouterLink} to="/">
          Platform Home
        </MuiLink>
        <MuiLink component={RouterLink} to="/cost-optimization">
          Cost Optimization
        </MuiLink>
        <Typography color="textPrimary">Azure</Typography>
      </Breadcrumbs>

      <div className={classes.hero}>
        <RouterLink to="/cost-optimization" className={classes.backLink}>
          <ArrowBackIcon fontSize="small" /> All providers
        </RouterLink>
        <Typography className={classes.heroTitle}>
          Azure — Cost Optimization
        </Typography>
        <Typography className={classes.heroSubtitle}>
          Automated lifecycle management and cost savings for Azure Kubernetes
          Service clusters.
        </Typography>
      </div>

      <AksClusterCostCard />

      <Typography className={classes.sectionTitle}>Available tools</Typography>
      <Grid container spacing={3}>
        {AZURE_COST_TOOLS.map(tool => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={tool.id}>
            <Card className={classes.toolCard} elevation={0}>
              <CardActionArea
                className={classes.cardArea}
                onClick={() => navigate(tool.href)}
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
    </div>
  );
}
