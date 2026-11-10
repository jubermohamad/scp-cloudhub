/**
 * CommonResDeployPage – Deploy the shared `common-res` Helm chart.
 *
 * `common-res` is a shared Helm chart that installs core Kubernetes
 * infrastructure (operators, controllers and shared cluster services) that all
 * SAI applications (NetReveal, SensaAI for Sanctions, Investigation Hub, Flows)
 * depend on.
 *
 * Flow:
 *   1. Select which common-res components to deploy (checklist).
 *   2. Select the target AKS cluster (tag-filtered for CloudHub eligibility).
 *   3. Provide an application instance name.
 *   4. Deploy — dispatches the shared GitHub Actions pipeline.
 */

import { useEffect, useState } from 'react';
import { Typography, Grid, Button, Box, Paper, Checkbox, FormControlLabel, Table, TableBody, TableCell, TableHead, TableRow, Radio, TextField, CircularProgress, Chip, Divider } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import LayersIcon from '@mui/icons-material/Layers';
import {
  useBackendFetch,
  getSriComponent,
  COMMON_RES_COMPONENTS,
  COMMON_RES_COMPONENT_CATEGORIES,
  buildDefaultCommonResSelection,
} from '@internal/plugin-platform-common';

interface CommonResDeployPageProps {
  isTab?: boolean;
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

// The common-res component id used to resolve the deployment pipeline in the
// SRI deployment catalog (see plugins/platform-common/src/sriDeploymentCatalog.ts).
const COMMON_RES_COMPONENT_ID = 'common-res';

// CloudHub subscription ID for cluster discovery.
const CLOUDHUB_SUBSCRIPTION_ID = 'b0799078-b42a-4b59-9e70-22cd09a20ee2';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
  },
  infoBanner: {
    display: 'flex',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    borderRadius: 10,
    background: 'linear-gradient(135deg, #ecfeff 0%, #f0fdfa 100%)',
    border: '1px solid #99f6e4',
    marginBottom: theme.spacing(3),
  },
  infoIcon: {
    color: '#0d9488',
    fontSize: '2rem',
  },
  infoTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#0f766e',
  },
  infoText: {
    fontSize: '0.85rem',
    color: '#115e59',
    lineHeight: 1.5,
  },
  sectionTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(1),
  },
  panel: {
    padding: theme.spacing(2.5),
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    height: '100%',
    boxSizing: 'border-box',
  },
  categoryLabel: {
    fontSize: '0.72rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#0d9488',
    marginTop: theme.spacing(1.5),
    marginBottom: theme.spacing(0.5),
  },
  componentRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 0),
  },
  componentName: {
    fontSize: '0.875rem',
    fontWeight: 600,
  },
  componentDesc: {
    fontSize: '0.78rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.4,
  },
  selectionActions: {
    display: 'flex',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  linkButton: {
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.78rem',
  },
  button: {
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
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
    backgroundColor: '#F0FDFA',
    borderLeft: '3px solid #0d9488',
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
  },
  statusBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
    marginTop: theme.spacing(2),
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
  fieldSpacing: {
    marginTop: theme.spacing(2),
  },
  selectedSummary: {
    marginTop: theme.spacing(2),
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  },
  summaryChip: {
    backgroundColor: '#CCFBF1',
    color: '#0f766e',
    fontWeight: 600,
  },
  deployBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: theme.spacing(3),
  },
}));

export function CommonResDeployPage({
  isTab: _isTab = false,
}: CommonResDeployPageProps): JSX.Element {
  const classes = useStyles();
  const backendFetch = useBackendFetch();

  const [selectedComponents, setSelectedComponents] = useState<
    Record<string, boolean>
  >(buildDefaultCommonResSelection);

  const [clusters, setClusters] = useState<DiscoveredCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] =
    useState<DiscoveredCluster | null>(null);

  const [appInstance, setAppInstance] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchClusters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleComponent = (id: string) => {
    setSelectedComponents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const setAll = (value: boolean) => {
    setSelectedComponents(
      COMMON_RES_COMPONENTS.reduce<Record<string, boolean>>(
        (acc, component) => {
          acc[component.id] = value;
          return acc;
        },
        {},
      ),
    );
  };

  const selectedIds = COMMON_RES_COMPONENTS.filter(
    component => selectedComponents[component.id],
  ).map(component => component.id);

  const handleDeploy = async () => {
    if (!selectedCluster) {
      setDeployError('Please select a target cluster');
      return;
    }
    if (selectedIds.length === 0) {
      setDeployError('Please select at least one component to deploy');
      return;
    }
    const trimmedInstance = appInstance.trim();
    if (!trimmedInstance) {
      setDeployError('Please provide an application instance name');
      return;
    }

    const component = getSriComponent(COMMON_RES_COMPONENT_ID);
    if (!component || !component.deployment.supported) {
      setDeployError('common-res deployment is not available');
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setDeploySuccess(false);

    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/pipelines/sri/deploy',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentId: COMMON_RES_COMPONENT_ID,
            application: component.deployment.application,
            clusterName: selectedCluster.clusterName,
            subscriptionId: selectedCluster.subscriptionId,
            resourceGroup: selectedCluster.resourceGroup,
            cloudProvider: 'Azure',
            appInstance: trimmedInstance,
            components: selectedIds,
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

      setDeploySuccess(true);
    } catch (error) {
      setDeployError(
        error instanceof Error ? error.message : 'Deployment failed',
      );
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Box className={classes.root}>
      {/* Info banner */}
      <Paper elevation={0} className={classes.infoBanner}>
        <LayersIcon className={classes.infoIcon} />
        <Box>
          <Typography className={classes.infoTitle}>
            common-res — Shared Cluster Infrastructure
          </Typography>
          <Typography className={classes.infoText}>
            A shared Helm chart that deploys core Kubernetes infrastructure
            (operators, controllers and shared resources) into its own
            namespace. All SAI applications — NetReveal, SensaAI for Sanctions,
            Investigation Hub and Flows — depend on it.
          </Typography>
        </Box>
      </Paper>

      <Grid container spacing={3}>
        {/* Component selection */}
        <Grid item xs={12} md={6}>
          <Paper elevation={0} className={classes.panel}>
            <Typography className={classes.sectionTitle}>
              Select Components to Deploy
            </Typography>
            <Box className={classes.selectionActions}>
              <Button
                size="small"
                color="primary"
                className={classes.linkButton}
                onClick={() => setAll(true)}
                disabled={deploying}
              >
                Select all
              </Button>
              <Button
                size="small"
                className={classes.linkButton}
                onClick={() => setAll(false)}
                disabled={deploying}
              >
                Clear all
              </Button>
            </Box>

            {COMMON_RES_COMPONENT_CATEGORIES.map(category => (
              <Box key={category}>
                <Typography className={classes.categoryLabel}>
                  {category}
                </Typography>
                {COMMON_RES_COMPONENTS.filter(
                  component => component.category === category,
                ).map(component => (
                  <Box key={component.id} className={classes.componentRow}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={Boolean(selectedComponents[component.id])}
                          onChange={() => toggleComponent(component.id)}
                          disabled={deploying}
                          style={{ color: '#0d9488' }}
                        />
                      }
                      label={
                        <Box>
                          <Typography className={classes.componentName}>
                            {component.name}
                          </Typography>
                          <Typography className={classes.componentDesc}>
                            {component.description}
                          </Typography>
                        </Box>
                      }
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Paper>
        </Grid>

        {/* Deployment target */}
        <Grid item xs={12} md={6}>
          <Paper elevation={0} className={classes.panel}>
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
                      onClick={() => setSelectedCluster(cluster)}
                    >
                      <TableCell padding="checkbox">
                        <Radio
                          checked={
                            selectedCluster?.clusterName === cluster.clusterName
                          }
                          size="small"
                          style={{ color: '#0d9488' }}
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

            <TextField
              className={classes.fieldSpacing}
              label="Application Instance"
              value={appInstance}
              onChange={event => setAppInstance(event.target.value)}
              placeholder="e.g. common-res-sri-test"
              helperText="Unique instance name passed to the deployment pipeline"
              variant="outlined"
              size="small"
              fullWidth
              disabled={deploying}
            />

            <Divider className={classes.fieldSpacing} />

            <Box className={classes.selectedSummary}>
              <Typography variant="caption" style={{ width: '100%' }}>
                {selectedIds.length} component
                {selectedIds.length === 1 ? '' : 's'} selected
              </Typography>
              {selectedIds.map(id => (
                <Chip
                  key={id}
                  size="small"
                  label={id}
                  className={classes.summaryChip}
                />
              ))}
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {deploySuccess && (
        <Paper
          elevation={0}
          className={`${classes.statusBox} ${classes.successBox}`}
        >
          <CheckCircleIcon style={{ color: '#059669', marginTop: 2 }} />
          <Typography className={classes.successText}>
            ✓ common-res deployment workflow triggered successfully on{' '}
            {selectedCluster?.clusterName}. You can monitor progress on the
            GitHub Actions page.
          </Typography>
        </Paper>
      )}

      {deployError && (
        <Paper
          elevation={0}
          className={`${classes.statusBox} ${classes.errorBox}`}
        >
          <ErrorIcon style={{ color: '#DC2626', marginTop: 2 }} />
          <Typography className={classes.errorText}>{deployError}</Typography>
        </Paper>
      )}

      <Box className={classes.deployBar}>
        <Button
          variant="contained"
          color="primary"
          className={classes.button}
          startIcon={
            deploying ? <CircularProgress size={20} /> : <CloudUploadIcon />
          }
          onClick={handleDeploy}
          disabled={
            deploying ||
            loadingClusters ||
            !selectedCluster ||
            selectedIds.length === 0 ||
            !appInstance.trim()
          }
        >
          {deploying ? 'Deploying...' : 'Deploy common-res'}
        </Button>
      </Box>
    </Box>
  );
}
