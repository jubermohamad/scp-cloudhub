/**
 * SRI Deploy Page – application deploy cards backed by the CloudHub Deployment
 * Portal wizard.
 *
 * Clicking Deploy on any card (AIStore, DetectionHub, SRI AML, or Other
 * application for anything discovered in the scripts repo) opens the
 * multi-step DeploymentWizard, which renders a Helmfile server-side, commits it
 * to the deployment branch, dispatches deploy-helmfile.yml, and
 * tracks live status. Past deployments are listed in the DeploymentHistory
 * panel below the cards.
 */

import { useState } from 'react';
import { Typography, Grid, Card, CardContent, CardActionArea, Button, Box, Dialog, DialogTitle, DialogContent, DialogActions, Chip, Checkbox, FormControlLabel, TextField, MenuItem, CircularProgress, Paper, Divider } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import StorageIcon from '@mui/icons-material/Storage';
import SecurityIcon from '@mui/icons-material/Security';
import AppsIcon from '@mui/icons-material/Apps';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { DeploymentWizard } from './DeploymentWizard';
import { DeploymentHistory } from './DeploymentHistory';
import {
  getSriComponent,
  useBackendFetch,
} from '@internal/plugin-platform-common';
import type { PortalDiscoveredCluster } from './deploymentPortalTypes';

const CLOUDHUB_SUBSCRIPTION_ID = 'b0799078-b42a-4b59-9e70-22cd09a20ee2';
const INSTANCE_NAME_RE = /^[a-z0-9-]+$/;

interface SriDeployPageProps {
  isTab?: boolean;
}

interface DeployCard {
  key: string;
  appName: string;
  title: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  kind: 'direct' | 'component-picker' | 'multi-module' | 'discovered';
}

interface DeploymentChoice {
  componentId: string;
  appName: string;
  title: string;
  description: string;
}

const SRI_DEPLOYMENT_CHOICES: DeploymentChoice[] = [
  'sri-data',
  'sri-detection',
  'sri-investigation',
  'sri-agents',
].reduce<DeploymentChoice[]>((choices, componentId) => {
  const component = getSriComponent(componentId);
  const appName = component?.deployment.application;
  if (!component || !appName) {
    return choices;
  }
  choices.push({
    componentId: component.id,
    appName,
    title: component.title,
    description: component.description,
  });
  return choices;
}, []);

const DEPLOY_CARDS: DeployCard[] = [
  {
    key: 'ai-store',
    appName: 'ai-store',
    title: 'AIStore',
    description:
      'Deploy AIStore application for data storage and retrieval operations across your Kubernetes clusters.',
    icon: StorageIcon,
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    kind: 'direct',
  },
  {
    key: 'detectionhub',
    appName: 'detectionhub',
    title: 'DetectionHub',
    description:
      'Deploy DetectionHub for anomaly detection and threat intelligence across your infrastructure.',
    icon: CloudUploadIcon,
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    kind: 'component-picker',
  },
  {
    key: 'sri-aml',
    appName: 'sri-aml',
    title: 'SRI AML',
    description:
      'Deploy the SRI AML suite by choosing SRI Data, SRI Detection, SRI Investigation, or SRI Agent.',
    icon: SecurityIcon,
    gradient: 'linear-gradient(135deg, #b71c1c 0%, #7f1d1d 100%)',
    kind: 'multi-module',
  },
  {
    key: 'discovered',
    appName: '',
    title: 'Other application',
    description:
      'Deploy any application discovered in the SymphonyFS scripts repo (apps/ and scp/apps/). Pick the application in the wizard.',
    icon: AppsIcon,
    gradient: 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)',
    kind: 'discovered',
  },
];

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
  },
  sectionTitle: {
    fontSize: '1.05rem',
    marginBottom: theme.spacing(2),
    color: theme.palette.text.secondary,
    fontWeight: 600,
  },
  card: {
    height: 238,
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
      transform: 'translateY(-2px)',
    },
    [theme.breakpoints.down('sm')]: { height: 230 },
  },
  cardArea: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  cardStripe: {
    display: 'none',
  },
  cardBody: {
    padding: theme.spacing(2.5, 2.5, 1.5),
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  cardIcon: {
    fontSize: '2.7rem',
    color: '#6B7280',
    marginBottom: theme.spacing(0.75),
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
    marginTop: 'auto',
    paddingTop: theme.spacing(1.5),
  },
  button: {
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
    borderRadius: 5,
    boxShadow: '0 2px 4px rgba(30, 64, 175, 0.25)',
  },
  moduleRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    borderRadius: 8,
    border: `1px solid ${theme.palette.divider}`,
  },
  moduleHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
  moduleActionRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: theme.spacing(1),
    alignItems: 'start',
  },
  moduleInput: {
    minWidth: 0,
  },
  moduleButton: {
    marginTop: theme.spacing(0.25),
    whiteSpace: 'nowrap',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
  },
  moduleName: { fontSize: '0.9rem', fontWeight: 700 },
  moduleDesc: {
    fontSize: '0.78rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.4,
  },
  amlStatusBox: {
    marginTop: theme.spacing(1),
    padding: theme.spacing(1.5),
    borderRadius: 8,
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
  },
  amlErrorText: { color: '#DC2626', fontSize: '0.85rem' },
}));

export function SriDeployPage({
  isTab: _isTab = false,
}: SriDeployPageProps): JSX.Element {
  const classes = useStyles();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardApp, setWizardApp] = useState<string | undefined>(undefined);
  const [wizardLabel, setWizardLabel] = useState<string | undefined>(undefined);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<string | undefined>();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [wizardInstanceName, setWizardInstanceName] = useState<
    string | undefined
  >();
  const [wizardCluster, setWizardCluster] = useState<string | undefined>();

  const backendFetch = useBackendFetch();

  const [amlOpen, setAmlOpen] = useState(false);
  const [amlSelected, setAmlSelected] = useState<Record<string, boolean>>(() =>
    SRI_DEPLOYMENT_CHOICES.reduce<Record<string, boolean>>((acc, choice) => {
      acc[choice.componentId] = true;
      return acc;
    }, {}),
  );
  const [amlInstances, setAmlInstances] = useState<Record<string, string>>({});
  const [amlInstanceErrors, setAmlInstanceErrors] = useState<
    Record<string, string>
  >({});
  const [amlClusters, setAmlClusters] = useState<PortalDiscoveredCluster[]>([]);
  const [amlLoadingClusters, setAmlLoadingClusters] = useState(false);
  const [amlClusterError, setAmlClusterError] = useState<string | null>(null);
  const [amlCluster, setAmlCluster] = useState('');
  const [amlDeployed, setAmlDeployed] = useState<Record<string, boolean>>({});
  const [activeAmlModule, setActiveAmlModule] = useState<string | undefined>();

  const openWizard = (
    appName: string | undefined,
    label?: string,
    instanceName?: string,
    clusterName?: string,
    moduleId?: string,
  ) => {
    setWizardApp(appName);
    setWizardLabel(label);
    setWizardInstanceName(instanceName);
    setWizardCluster(clusterName);
    setActiveAmlModule(moduleId);
    setWizardOpen(true);
  };

  const openComponentPicker = (source: string) => {
    setPickerSource(source);
    setComponentPickerOpen(true);
  };

  const handleComponentChoice = (choice: DeploymentChoice) => {
    setComponentPickerOpen(false);
    setPickerSource(undefined);
    openWizard(choice.appName, choice.title);
  };

  const fetchAmlClusters = async () => {
    setAmlLoadingClusters(true);
    setAmlClusterError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/clusters/deployable?subscriptionId=${CLOUDHUB_SUBSCRIPTION_ID}`,
      );
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to fetch clusters');
      }
      const discovered: PortalDiscoveredCluster[] = Array.isArray(data.clusters)
        ? data.clusters
        : [];
      setAmlClusters(discovered);
      setAmlCluster(prev => prev || discovered[0]?.clusterName || '');
      if (discovered.length === 0) {
        setAmlClusterError(
          'No CloudHub-eligible clusters found. Please onboard clusters in the Cluster Registry.',
        );
      }
    } catch (error) {
      setAmlClusterError(
        error instanceof Error ? error.message : 'Failed to fetch clusters',
      );
      setAmlClusters([]);
    } finally {
      setAmlLoadingClusters(false);
    }
  };

  const openAmlDialog = () => {
    setAmlDeployed({});
    setAmlInstanceErrors({});
    setAmlOpen(true);
    void fetchAmlClusters();
  };

  const handleCardClick = (card: DeployCard) => {
    if (card.kind === 'direct') {
      openWizard(card.appName, card.title);
    } else if (card.kind === 'discovered') {
      openWizard(undefined);
    } else if (card.kind === 'multi-module') {
      openAmlDialog();
    } else {
      openComponentPicker(card.title);
    }
  };

  const toggleAmlModule = (componentId: string) => {
    setAmlSelected(prev => ({ ...prev, [componentId]: !prev[componentId] }));
  };

  const setAmlInstance = (componentId: string, value: string) => {
    setAmlInstances(prev => ({ ...prev, [componentId]: value }));
    setAmlInstanceErrors(prev => {
      if (!prev[componentId]) return prev;
      const next = { ...prev };
      delete next[componentId];
      return next;
    });
  };

  const validateInstanceName = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Instance Name is required.';
    if (trimmed.length > 63) return 'Must be 63 characters or fewer.';
    if (!INSTANCE_NAME_RE.test(trimmed)) {
      return 'Instance Name may only contain lowercase letters, numbers, and hyphens.';
    }
    return null;
  };

  const launchModuleWizard = (choice: DeploymentChoice) => {
    const name = amlInstances[choice.componentId] ?? '';
    const error = validateInstanceName(name);
    if (error) {
      setAmlInstanceErrors(prev => ({ ...prev, [choice.componentId]: error }));
      return;
    }
    if (!amlCluster) {
      setAmlClusterError('Select a target AKS cluster first.');
      return;
    }
    openWizard(
      choice.appName,
      choice.title,
      name.trim(),
      amlCluster,
      choice.componentId,
    );
  };

  const handleWizardDeployed = () => {
    setRefreshSignal(signal => signal + 1);
    if (activeAmlModule) {
      setAmlDeployed(prev => ({ ...prev, [activeAmlModule]: true }));
    }
  };

  return (
    <Box className={classes.root}>
      <Typography className={classes.sectionTitle}>
        Select an application to deploy
      </Typography>

      <Grid container spacing={3}>
        {DEPLOY_CARDS.map(card => {
          const Icon = card.icon;
          return (
            <Grid item xs={12} sm={6} md={4} key={card.key}>
              <Card className={classes.card}>
                <CardActionArea
                  className={classes.cardArea}
                  onClick={() => handleCardClick(card)}
                >
                  <Box
                    className={classes.cardStripe}
                    style={{ background: card.gradient }}
                  />
                  <CardContent className={classes.cardBody}>
                    <Icon className={classes.cardIcon} />
                    <Typography className={classes.cardTitle}>
                      {card.title}
                    </Typography>
                    <Typography className={classes.cardDescription}>
                      {card.description}
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
          );
        })}
      </Grid>

      <DeploymentHistory refreshSignal={refreshSignal} />

      <DeploymentWizard
        open={wizardOpen}
        preselectedApp={wizardApp}
        deploymentLabel={wizardLabel}
        initialInstanceName={wizardInstanceName}
        initialClusterName={wizardCluster}
        onClose={() => setWizardOpen(false)}
        onDeployed={handleWizardDeployed}
      />

      <Dialog
        open={componentPickerOpen}
        onClose={() => setComponentPickerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Select SRI component</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" sx={{ gap: 1.5 }}>
            <Typography variant="body2" color="textSecondary">
              {pickerSource === 'DetectionHub'
                ? 'Choose the component to deploy from DetectionHub.'
                : 'Choose the SRI component to deploy.'}
            </Typography>
            <Grid container spacing={2}>
              {SRI_DEPLOYMENT_CHOICES.map(choice => (
                <Grid item xs={12} sm={6} key={choice.componentId}>
                  <Card variant="outlined" style={{ height: '100%' }}>
                    <CardActionArea
                      style={{ height: '100%', alignItems: 'flex-start' }}
                      onClick={() => handleComponentChoice(choice)}
                    >
                      <CardContent>
                        <Box display="flex" flexDirection="column" sx={{ gap: 1 }}>
                          <Chip
                            label={choice.componentId}
                            size="small"
                            variant="outlined"
                          />
                          <Typography variant="h6">{choice.title}</Typography>
                          <Typography variant="body2" color="textSecondary">
                            {choice.description}
                          </Typography>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComponentPickerOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={amlOpen}
        onClose={() => setAmlOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Deploy SRI AML modules</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" sx={{ gap: 2 }}>
            <Typography variant="body2" color="textSecondary">
              Select the SRI AML modules to deploy. Each module takes its own
              application instance name and runs through its own review &amp;
              approval gate, targeting the AKS cluster below.
            </Typography>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Target AKS Cluster
              </Typography>
              {amlLoadingClusters ? (
                <Box display="flex" alignItems="center" sx={{ gap: 1 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2">
                    Fetching CloudHub-eligible clusters…
                  </Typography>
                </Box>
              ) : (
                <TextField
                  select
                  fullWidth
                  size="small"
                  variant="outlined"
                  value={amlCluster}
                  onChange={e => setAmlCluster(e.target.value)}
                  disabled={amlClusters.length === 0}
                  helperText={
                    amlClusters.length === 0
                      ? 'No CloudHub-eligible clusters found'
                      : 'All selected modules deploy to this cluster'
                  }
                >
                  {amlClusters.map(cluster => (
                    <MenuItem
                      key={cluster.clusterName}
                      value={cluster.clusterName}
                    >
                      {cluster.clusterName} · {cluster.region}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {amlClusterError && (
                <Paper elevation={0} className={classes.amlStatusBox}>
                  <ErrorIcon style={{ color: '#DC2626' }} />
                  <Typography className={classes.amlErrorText}>
                    {amlClusterError}
                  </Typography>
                </Paper>
              )}
            </Box>

            <Divider />

            {SRI_DEPLOYMENT_CHOICES.map(choice => {
              const checked = Boolean(amlSelected[choice.componentId]);
              const deployed = Boolean(amlDeployed[choice.componentId]);
              const instanceError = amlInstanceErrors[choice.componentId];
              return (
                <Box key={choice.componentId} className={classes.moduleRow}>
                  <Box className={classes.moduleHeader}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={checked}
                          onChange={() => toggleAmlModule(choice.componentId)}
                          style={{ color: '#b71c1c' }}
                        />
                      }
                      label={
                        <Box>
                          <Typography className={classes.moduleName}>
                            {choice.title}
                          </Typography>
                          <Typography className={classes.moduleDesc}>
                            {choice.description}
                          </Typography>
                        </Box>
                      }
                    />
                    {deployed && (
                      <Chip
                        size="small"
                        icon={
                          <CheckCircleIcon style={{ color: '#059669' }} />
                        }
                        label="Deployed"
                        style={{
                          backgroundColor: '#ECFDF5',
                          color: '#059669',
                        }}
                      />
                    )}
                  </Box>

                  {checked && (
                    <Box className={classes.moduleActionRow}>
                      <TextField
                        className={classes.moduleInput}
                        label="Application instance name"
                        value={amlInstances[choice.componentId] ?? ''}
                        onChange={e =>
                          setAmlInstance(choice.componentId, e.target.value)
                        }
                        placeholder={`e.g. ${choice.componentId}-test`}
                        error={Boolean(instanceError)}
                        helperText={
                          instanceError ??
                          'Unique instance name for this module'
                        }
                        variant="outlined"
                        size="small"
                        fullWidth
                      />
                      <Button
                        className={classes.moduleButton}
                        variant="contained"
                        color="primary"
                        startIcon={<CloudUploadIcon />}
                        disabled={amlClusters.length === 0 || !amlCluster}
                        onClick={() => launchModuleWizard(choice)}
                      >
                        {deployed ? 'Redeploy' : 'Deploy'}
                      </Button>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAmlOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
