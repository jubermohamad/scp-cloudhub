/**
 * SriAmlDeployPage – "SRI AML" deploy card + orchestrated multi-module deploy
 * dialog.
 *
 * SRI AML is composed of four independently deployable modules, each backed
 * by its own Helm chart and dedicated CI pipeline. Every module is dispatched through the shared
 * `deploy-helmfile.yml` GitHub Actions workflow via the existing
 * `/pipelines/sri/deploy` endpoint — only the `appName` input differs per
 * module. Clicking "Deploy" orchestrates the selected modules by dispatching
 * their pipelines one after another and tracking each module's outcome.
 */

import { useState } from 'react';
import { Typography, Grid, Card, CardContent, CardActionArea, Button, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Box, Paper, Radio, Checkbox, FormControlLabel, TextField, Divider, Chip, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { makeStyles } from '@mui/styles';

import SecurityIcon from '@mui/icons-material/Security';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import {
  useBackendFetch,
  getSriComponent,
} from '@internal/plugin-platform-common';

interface AmlModuleDef {
  componentId: string;
  title: string;
  role: string;
  helmChartRepo: string;
  ciPipeline: string;
}

const AML_MODULES: AmlModuleDef[] = [
  {
    componentId: 'sri-data',
    title: 'SRI Data',
    role: 'Batch data ingestion, validation, and preparation on the Eureka platform',
    helmChartRepo: 'Part of Eureka/Flows charts',
    ciPipeline: 'GitHub Actions',
  },
  {
    componentId: 'sri-detection',
    title: 'SRI Detection',
    role: 'AI and rule-based model management, inference, and decisioning',
    helmChartRepo: 'dethub-helm (chart: symphonyfs/detectionhub)',
    ciPipeline: 'GitHub Actions / Azure DevOps',
  },
  {
    componentId: 'sri-investigation',
    title: 'SRI Investigation',
    role: 'Case management, queues, and investigator workflows',
    helmChartRepo: 'SymphonySensa/invhub-helm',
    ciPipeline: 'GitHub Actions (sri-gh-workflows)',
  },
  {
    componentId: 'sri-agents',
    title: 'SRI Agent',
    role: 'Autonomous AI agents (Transaction Monitoring Manager, copilots)',
    helmChartRepo: 'Separate chart (SRI Agent namespace)',
    ciPipeline: 'GitHub Actions',
  },
];

const CLOUDHUB_SUBSCRIPTION_ID = 'b0799078-b42a-4b59-9e70-22cd09a20ee2';

const EMPTY_MODULE_INSTANCES = AML_MODULES.reduce<Record<string, string>>(
  (acc, mod) => {
    acc[mod.componentId] = '';
    return acc;
  },
  {},
);

interface ClusterNamespace {
  name: string;
  status: string;
  createdAt: string | null;
}

interface DiscoveredCluster {
  clusterName: string;
  region: string;
  resourceGroup: string;
  kubernetesVersion: string;
  nodePools: number;
  environment: string;
  status: string;
  subscriptionId: string;
  tags: Record<string, string>;
}

type ModuleRunStatus = 'pending' | 'deploying' | 'success' | 'error';

interface ModuleRunResult {
  status: ModuleRunStatus;
  message?: string;
  htmlUrl?: string;
}

const useStyles = makeStyles(theme => ({
  card: {
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
  },
  cardStripe: {
    height: 6,
    flexShrink: 0,
    background: 'linear-gradient(135deg, #b71c1c 0%, #7f1d1d 100%)',
  },
  cardBody: {
    padding: theme.spacing(2.5),
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  cardIcon: {
    fontSize: '2.5rem',
    color: '#6B7280',
    marginBottom: theme.spacing(0.5),
  },
  cardTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  cardDescription: {
    fontSize: '0.85rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.5,
    flex: 1,
  },
  cardAction: {
    marginTop: theme.spacing(1.5),
  },
  button: {
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
  },
  dialogContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    minWidth: 560,
  },
  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#1f2937',
  },
  moduleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 0),
  },
  moduleName: {
    fontSize: '0.875rem',
    fontWeight: 600,
  },
  moduleDesc: {
    fontSize: '0.78rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.4,
  },
  clusterTable: {
    marginTop: theme.spacing(1),
  },
  clusterTableHeader: {
    backgroundColor: '#F3F4F6',
  },
  clusterRow: {
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: '#F9FAFB',
    },
  },
  selectedRow: {
    backgroundColor: '#FEF2F2',
    borderLeft: '3px solid #b71c1c',
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
  },
  namespaceChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(0.5),
  },
  statusBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
  },
  successBox: {
    backgroundColor: '#ECFDF5',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
  },
  successText: {
    color: '#059669',
    fontSize: '0.875rem',
  },
  errorText: {
    color: '#DC2626',
    fontSize: '0.875rem',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 0),
  },
  resultLabel: {
    fontSize: '0.85rem',
    fontWeight: 600,
    minWidth: 140,
  },
  resultMessage: {
    fontSize: '0.78rem',
    color: theme.palette.text.secondary,
  },
}));

export function SriAmlDeployPage(): JSX.Element {
  const classes = useStyles();
  const backendFetch = useBackendFetch();

  const [open, setOpen] = useState(false);
  const [selectedModules, setSelectedModules] = useState<
    Record<string, boolean>
  >({
    'sri-data': true,
    'sri-detection': true,
    'sri-investigation': true,
    'sri-agents': true,
  });
  const [selectedCluster, setSelectedCluster] =
    useState<DiscoveredCluster | null>(null);
  const [clusters, setClusters] = useState<DiscoveredCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);

  const [namespaces, setNamespaces] = useState<ClusterNamespace[]>([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [namespaceError, setNamespaceError] = useState<string | null>(null);

  const [moduleInstances, setModuleInstances] = useState<Record<string, string>>(
    EMPTY_MODULE_INSTANCES,
  );
  const [moduleInstanceErrors, setModuleInstanceErrors] = useState<
    Record<string, string>
  >({});
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [moduleResults, setModuleResults] = useState<
    Record<string, ModuleRunResult>
  >({});

  const fetchClusters = async () => {
    setLoadingClusters(true);
    setClusterError(null);
    try {
      const query = new URLSearchParams({
        subscriptionId: CLOUDHUB_SUBSCRIPTION_ID,
      });
      const response = await backendFetch(
        'deployment-control-plane',
        `/clusters/deployable?${query.toString()}`,
      );
      const rawBody = await response.text();
      const data = rawBody ? JSON.parse(rawBody) : {};

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to fetch clusters');
      }

      const discovered = Array.isArray(data.clusters) ? data.clusters : [];
      setClusters(discovered);
      if (discovered.length === 0) {
        setClusterError(
          'No CloudHub-eligible clusters found. Please onboard clusters in the Cluster Registry.',
        );
      }
    } catch (error) {
      setClusterError(
        error instanceof Error ? error.message : 'Failed to fetch clusters',
      );
      setClusters([]);
    } finally {
      setLoadingClusters(false);
    }
  };

  const handleCardClick = async () => {
    setOpen(true);
    await fetchClusters();
  };

  const fetchNamespaces = async (cluster: DiscoveredCluster) => {
    setLoadingNamespaces(true);
    setNamespaceError(null);
    setNamespaces([]);
    try {
      const query = new URLSearchParams({
        subscriptionId: cluster.subscriptionId,
        resourceGroup: cluster.resourceGroup,
        clusterName: cluster.clusterName,
      });
      const response = await backendFetch(
        'deployment-control-plane',
        `/clusters/namespaces?${query.toString()}`,
      );
      const rawBody = await response.text();
      const data = rawBody ? JSON.parse(rawBody) : {};

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to fetch namespaces');
      }

      setNamespaces(Array.isArray(data.namespaces) ? data.namespaces : []);
    } catch (error) {
      setNamespaceError(
        error instanceof Error ? error.message : 'Failed to fetch namespaces',
      );
    } finally {
      setLoadingNamespaces(false);
    }
  };

  const handleClusterSelect = (cluster: DiscoveredCluster) => {
    setSelectedCluster(cluster);
    void fetchNamespaces(cluster);
  };

  const handleClose = () => {
    if (deploying) return;
    setOpen(false);
    setSelectedCluster(null);
    setClusters([]);
    setNamespaces([]);
    setNamespaceError(null);
    setModuleInstances(EMPTY_MODULE_INSTANCES);
    setModuleInstanceErrors({});
    setDeployError(null);
    setModuleResults({});
  };

  const toggleModule = (id: string) => {
    setSelectedModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleModuleInstanceChange = (componentId: string, value: string) => {
    setModuleInstances(prev => ({ ...prev, [componentId]: value }));
    setModuleInstanceErrors(prev => {
      if (!prev[componentId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[componentId];
      return next;
    });
  };

  const validateModuleInstance = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Instance Name is required.';
    }
    if (trimmed.length > 63) {
      return 'Must be 63 characters or fewer.';
    }
    if (!/^[a-z0-9-]+$/.test(trimmed)) {
      return 'Instance Name may only contain lowercase letters, numbers, and hyphens.';
    }
    return null;
  };

  const selectedList = AML_MODULES.filter(
    mod => selectedModules[mod.componentId],
  );

  const handleDeploy = async () => {
    if (!selectedCluster) {
      setDeployError('Please select a target cluster');
      return;
    }
    if (selectedList.length === 0) {
      setDeployError('Please select at least one module to deploy');
      return;
    }

    const nextErrors = selectedList.reduce<Record<string, string>>((acc, mod) => {
      const error = validateModuleInstance(moduleInstances[mod.componentId] ?? '');
      if (error) {
        acc[mod.componentId] = error;
      }
      return acc;
    }, {});
    setModuleInstanceErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setDeployError('Please provide a valid application instance name for each selected module');
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setModuleResults(
      selectedList.reduce<Record<string, ModuleRunResult>>((acc, mod) => {
        acc[mod.componentId] = { status: 'pending' };
        return acc;
      }, {}),
    );

    let hadFailure = false;

    // Orchestrate: dispatch each selected module's dedicated pipeline in
    // sequence, recording the outcome of each before moving to the next.
    for (const mod of selectedList) {
      setModuleResults(prev => ({
        ...prev,
        [mod.componentId]: { status: 'deploying' },
      }));

      const component = getSriComponent(mod.componentId);
      if (
        !component ||
        !component.deployment.supported ||
        !component.deployment.application
      ) {
        hadFailure = true;
        setModuleResults(prev => ({
          ...prev,
          [mod.componentId]: {
            status: 'error',
            message: 'Deployment is not yet available for this module',
          },
        }));
        continue;
      }

      try {
        const appInstanceForModule =
          moduleInstances[mod.componentId]?.trim() ?? '';
        const response = await backendFetch(
          'deployment-control-plane',
          '/pipelines/sri/deploy',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              componentId: mod.componentId,
              application: component.deployment.application,
              clusterName: selectedCluster.clusterName,
              subscriptionId: selectedCluster.subscriptionId,
              resourceGroup: selectedCluster.resourceGroup,
              cloudProvider: 'Azure',
              appInstance: appInstanceForModule,
            }),
          },
        );

        const rawBody = await response.text();
        const data = rawBody ? JSON.parse(rawBody) : {};

        if (!response.ok) {
          throw new Error(
            data.error ?? `Deployment failed (status ${response.status})`,
          );
        }

        setModuleResults(prev => ({
          ...prev,
          [mod.componentId]: {
            status: 'success',
            htmlUrl: data.pipeline?.htmlUrl,
          },
        }));
      } catch (error) {
        hadFailure = true;
        setModuleResults(prev => ({
          ...prev,
          [mod.componentId]: {
            status: 'error',
            message:
              error instanceof Error ? error.message : 'Deployment failed',
          },
        }));
      }
    }

    setDeploying(false);
    if (hadFailure) {
      setDeployError(
        'One or more modules failed to trigger. See details below.',
      );
    }
  };

  const hasResults = Object.keys(moduleResults).length > 0;

  return (
    <>
      <Grid item xs={12} sm={6} md={4}>
        <Card className={classes.card}>
          <CardActionArea
            className={classes.cardArea}
            onClick={handleCardClick}
          >
            <Box className={classes.cardStripe} />
            <CardContent className={classes.cardBody}>
              <SecurityIcon className={classes.cardIcon} />
              <Typography className={classes.cardTitle}>SRI AML</Typography>
              <Typography className={classes.cardDescription}>
                Deploy the SRI AML suite — Data, Detection, Investigation, and
                Agent modules — each via its own dedicated pipeline.
              </Typography>
              <Box className={classes.cardAction}>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  className={classes.button}
                  startIcon={<CloudUploadIcon />}
                >
                  Deploy
                </Button>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>Deploy SRI AML</DialogTitle>
        <DialogContent className={classes.dialogContent}>
          {deployError && (
            <Paper
              elevation={0}
              className={`${classes.statusBox} ${classes.errorBox}`}
            >
              <ErrorIcon style={{ color: '#DC2626', marginTop: 2 }} />
              <Typography className={classes.errorText}>
                {deployError}
              </Typography>
            </Paper>
          )}

          <Typography className={classes.sectionTitle}>
            Select Modules to Deploy
          </Typography>
          {AML_MODULES.map(mod => (
            <Box key={mod.componentId} className={classes.moduleRow}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={Boolean(selectedModules[mod.componentId])}
                    onChange={() => toggleModule(mod.componentId)}
                    disabled={deploying}
                    style={{ color: '#b71c1c' }}
                  />
                }
                label={
                  <Box>
                    <Typography className={classes.moduleName}>
                      {mod.title}
                    </Typography>
                    <Typography className={classes.moduleDesc}>
                      {mod.role}
                    </Typography>
                  </Box>
                }
              />
              {selectedModules[mod.componentId] && (
                <Box style={{ marginLeft: 36, marginTop: 8, width: '100%' }}>
                  <TextField
                    label="Application Instance Name"
                    value={moduleInstances[mod.componentId] ?? ''}
                    onChange={event =>
                      handleModuleInstanceChange(
                        mod.componentId,
                        event.target.value,
                      )
                    }
                    placeholder={`e.g. ${mod.componentId}-test`}
                    helperText={
                      moduleInstanceErrors[mod.componentId] ??
                      'Unique instance name for this module'
                    }
                    error={Boolean(moduleInstanceErrors[mod.componentId])}
                    variant="outlined"
                    size="small"
                    fullWidth
                    disabled={deploying}
                  />
                </Box>
              )}
            </Box>
          ))}

          <Divider />
          <Divider />
          <Typography className={classes.sectionTitle}>
            Target AKS Cluster
          </Typography>

          {loadingClusters && (
            <Box className={classes.loadingContainer}>
              <CircularProgress size={22} />
              <Typography variant="body2">
                Fetching CloudHub-eligible clusters...
              </Typography>
            </Box>
          )}

          {clusterError && !loadingClusters && (
            <Paper
              elevation={0}
              className={`${classes.statusBox} ${classes.errorBox}`}
            >
              <ErrorIcon style={{ color: '#DC2626' }} />
              <Typography className={classes.errorText}>
                {clusterError}
              </Typography>
            </Paper>
          )}

          {!loadingClusters && clusters.length > 0 && (
            <Table className={classes.clusterTable} size="small">
              <TableHead>
                <TableRow className={classes.clusterTableHeader}>
                  <TableCell padding="checkbox" style={{ width: '40px' }} />
                  <TableCell style={{ fontWeight: 600 }}>
                    Cluster Name
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Region</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Env</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {clusters.map(cluster => (
                  <TableRow
                    key={`${cluster.subscriptionId}-${cluster.resourceGroup}-${cluster.clusterName}`}
                    className={`${classes.clusterRow} ${
                      selectedCluster?.clusterName === cluster.clusterName
                        ? classes.selectedRow
                        : ''
                    }`}
                    onClick={() => !deploying && handleClusterSelect(cluster)}
                  >
                    <TableCell padding="checkbox">
                      <Radio
                        checked={
                          selectedCluster?.clusterName === cluster.clusterName
                        }
                        size="small"
                        style={{ color: '#b71c1c' }}
                      />
                    </TableCell>
                    <TableCell>{cluster.clusterName}</TableCell>
                    <TableCell>{cluster.region}</TableCell>
                    <TableCell>{cluster.environment}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {selectedCluster && (
            <Box>
              <Typography
                className={classes.sectionTitle}
                style={{ marginTop: 8 }}
              >
                Existing Namespaces on {selectedCluster.clusterName}
              </Typography>

              {loadingNamespaces && (
                <Box className={classes.loadingContainer}>
                  <CircularProgress size={20} />
                  <Typography variant="body2">
                    Fetching namespaces...
                  </Typography>
                </Box>
              )}

              {namespaceError && !loadingNamespaces && (
                <Paper
                  elevation={0}
                  className={`${classes.statusBox} ${classes.errorBox}`}
                >
                  <ErrorIcon style={{ color: '#DC2626' }} />
                  <Typography className={classes.errorText}>
                    {namespaceError}
                  </Typography>
                </Paper>
              )}

              {!loadingNamespaces &&
                !namespaceError &&
                namespaces.length === 0 && (
                  <Typography variant="body2" color="textSecondary">
                    No namespaces found on this cluster.
                  </Typography>
                )}

              {!loadingNamespaces && namespaces.length > 0 && (
                <Box className={classes.namespaceChips}>
                  {namespaces.map(ns => (
                    <Chip key={ns.name} size="small" label={ns.name} />
                  ))}
                </Box>
              )}
            </Box>
          )}

          {hasResults && (
            <>
              <Divider />
              <Typography className={classes.sectionTitle}>
                Deployment Progress
              </Typography>
              {selectedList.map(mod => {
                const result = moduleResults[mod.componentId];
                return (
                  <Box key={mod.componentId} className={classes.resultRow}>
                    {result?.status === 'success' && (
                      <CheckCircleIcon style={{ color: '#059669' }} />
                    )}
                    {result?.status === 'error' && (
                      <ErrorIcon style={{ color: '#DC2626' }} />
                    )}
                    {(result?.status === 'deploying' ||
                      result?.status === 'pending') && (
                      <CircularProgress size={18} />
                    )}
                    <Typography className={classes.resultLabel}>
                      {mod.title}
                    </Typography>
                    <Typography className={classes.resultMessage}>
                      {result?.status === 'success' &&
                        'Pipeline triggered successfully'}
                      {result?.status === 'error' && result.message}
                      {result?.status === 'deploying' &&
                        'Triggering pipeline...'}
                      {result?.status === 'pending' && 'Queued'}
                    </Typography>
                  </Box>
                );
              })}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={deploying} variant="outlined">
            Close
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={
              deploying ||
              loadingClusters ||
              !selectedCluster ||
              selectedList.length === 0 ||
              selectedList.some(mod => {
                const error = validateModuleInstance(
                  moduleInstances[mod.componentId] ?? '',
                );
                return Boolean(error);
              })
            }
            color="primary"
            variant="contained"
            startIcon={
              deploying ? <CircularProgress size={20} /> : <CloudUploadIcon />
            }
          >
            {deploying
              ? 'Deploying...'
              : `Deploy ${selectedList.length} Module${
                  selectedList.length === 1 ? '' : 's'
                }`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
