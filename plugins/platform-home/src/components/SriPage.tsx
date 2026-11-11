import { useState, useEffect, useMemo } from 'react';
import { Typography, Grid, Card, CardContent, CardActionArea, Breadcrumbs, Link as MuiLink, Chip, Button, CircularProgress, Paper, Box, Divider, TextField } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { createPlatformRegistryApi } from './platformRegistryClient';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import LayersIcon from '@mui/icons-material/Layers';
import PeopleIcon from '@mui/icons-material/People';
import StorageIcon from '@mui/icons-material/Storage';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import ExtensionIcon from '@mui/icons-material/Extension';
import SecurityIcon from '@mui/icons-material/Security';
import GavelIcon from '@mui/icons-material/Gavel';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DataUsageIcon from '@mui/icons-material/DataUsage';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import {
  SRI_COMPONENTS,
  type SriComponentDefinition,
  useBackendFetch,
} from '@internal/plugin-platform-common';

interface PipelineState {
  runId: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  htmlUrl?: string;
}

const SRI_CARD_ICONS: Record<string, React.ElementType> = {
  'common-res': LayersIcon,
  'ai-store': StorageIcon,
  'netreveal-v96': CloudQueueIcon,
  'sri-investigation': FindInPageIcon,
  flows: AccountTreeIcon,
  'sensaai-sanctions': GavelIcon,
  'sri-detection': SecurityIcon,
  'hybrid-manager': FolderSharedIcon,
  'sri-data': DataUsageIcon,
  'sri-agents': ExtensionIcon,
  netreveal: PeopleIcon,
};

function getSriCardIcon(componentId: string): React.ElementType {
  return SRI_CARD_ICONS[componentId] ?? StorageIcon;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
    color: '#fff',
    marginBottom: theme.spacing(4),
    background:
      'linear-gradient(135deg, #1a237e 0%, #283593 50%, #1565c0 100%)',
  },
  heroEyebrow: {
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: 2,
    opacity: 0.8,
    marginBottom: theme.spacing(0.5),
  },
  heroTitle: {
    fontSize: '1.8rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  heroSubtitle: {
    fontSize: '0.95rem',
    opacity: 0.85,
    marginTop: theme.spacing(1),
    maxWidth: 560,
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: '#fff',
    opacity: 0.8,
    textDecoration: 'none',
    fontSize: '0.85rem',
    marginBottom: theme.spacing(1.5),
    '&:hover': { opacity: 1, textDecoration: 'underline' },
  },
  sectionTitle: {
    fontSize: '1.05rem',
    marginBottom: theme.spacing(2),
    color: theme.palette.text.secondary,
  },
  card: {
    height: 170,
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
    transition: 'box-shadow 0.2s, transform 0.15s',
    overflow: 'hidden',
    '&:hover': {
      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
      transform: 'translateY(-2px)',
    },
    [theme.breakpoints.down('sm')]: { height: 170 },
  },
  cardSelected: {
    border: `2px solid ${theme.palette.primary.main}`,
    boxShadow: theme.shadows[4],
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
    padding: theme.spacing(2, 2, 1.25),
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
  cardIcon: {
    fontSize: '2.1rem',
    color: '#6B7280',
    marginBottom: theme.spacing(0.25),
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
  cardTitle: {
    fontSize: '1.05rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  cardFooter: {
    padding: theme.spacing(0.75, 2, 1),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  deployLabel: {
    fontSize: '0.78rem',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.palette.primary.main,
    fontWeight: 600,
  },
  paper: {
    padding: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: 'none',
  },
  successHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    color: theme.palette.success.main,
    marginBottom: theme.spacing(2),
  },
  successMessage: {
    marginBottom: theme.spacing(3),
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: theme.spacing(1.5, 0),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  detailLabel: {
    fontWeight: 600,
    color: theme.palette.text.secondary,
    fontSize: '0.875rem',
  },
  detailValue: {
    fontFamily: 'monospace',
    fontWeight: 500,
    fontSize: '0.875rem',
  },
  errorBox: {
    padding: theme.spacing(2),
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  workflowBox: {
    backgroundColor: '#EFF6FF',
    border: '1px solid #BFDBFE',
    borderRadius: 8,
    padding: theme.spacing(2.5),
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(3),
  },
  workflowStep: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(1.5),
    '&:last-child': {
      marginBottom: 0,
    },
  },
  workflowStepNum: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    backgroundColor: '#2563EB',
    color: '#FFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 2,
  },
  workflowStepNumActive: {
    backgroundColor: '#10B981',
  },
  logConsole: {
    marginTop: theme.spacing(2),
    borderRadius: 8,
    border: '1px solid #1F2937',
    background: '#030712',
    overflow: 'hidden',
  },
  logConsoleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(1, 1.5),
    background: '#111827',
    color: '#E5E7EB',
    fontSize: '0.78rem',
    fontWeight: 600,
  },
  logConsoleBody: {
    margin: 0,
    padding: theme.spacing(1.5),
    minHeight: 180,
    maxHeight: 420,
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    lineHeight: 1.5,
    color: '#E5E7EB',
    whiteSpace: 'pre-wrap',
  },
}));

// ─── Page ────────────────────────────────────────────────────────────────────

export function SriPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const registryApi = useMemo(
    () => createPlatformRegistryApi(backendFetch),
    [backendFetch],
  );
  const [selectedService, setSelectedService] =
    useState<SriComponentDefinition | null>(null);
  const [clusters, setClusters] = useState<any[]>([]);
  const [selectedClusterName, setSelectedClusterName] = useState<string>('');
  const [discovering, setDiscovering] = useState(false);
  const [appInstance, setAppInstance] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appInstanceError =
    appInstance.trim().length === 0 ? 'App instance is required' : '';

  const handleDiscoverClusters = async () => {
    setDiscovering(true);
    setError(null);
    setSelectedClusterName('');
    try {
      const accounts = await registryApi.listCloudAccounts({ pageSize: 200 });
      const azureAccounts = accounts.items.filter(account => account.cloudProvider === 'AZURE');
      const results = await Promise.allSettled(azureAccounts.map(account => registryApi.discoverClusters(account.id, 'AZURE')));
      const items = results.filter(settledResult => settledResult.status === 'fulfilled').flatMap(settledResult => settledResult.value.items);
      setClusters(items);
      if (!items.length) setError('No tagged AKS clusters are available in the Platform Registry');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setClusters([]);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (!pipeline?.runId) return undefined;

    let cancelled = false;

    const poll = async () => {
      try {
        const [statusResp, logsResp] = await Promise.all([
          backendFetch(
            'deployment-control-plane',
            `/pipelines/runs/${encodeURIComponent(pipeline.runId)}`,
          ),
          backendFetch(
            'deployment-control-plane',
            `/pipelines/runs/${encodeURIComponent(pipeline.runId)}/logs`,
          ),
        ]);

        if (cancelled) return;

        if (statusResp.ok) {
          const statusBody = await statusResp.json();
          setPipeline(prev =>
            prev
              ? {
                  ...prev,
                  status: statusBody.status ?? prev.status,
                  conclusion: statusBody.conclusion ?? prev.conclusion,
                  htmlUrl: statusBody.htmlUrl ?? prev.htmlUrl,
                }
              : prev,
          );
        }

        if (logsResp.ok) {
          const logsBody = await logsResp.json();
          setPipelineLogs(Array.isArray(logsBody.lines) ? logsBody.lines : []);
        }
      } catch (e) {
        if (!cancelled) {
          // Failed to poll pipeline data, will retry on next interval
        }
      } finally {
        if (!cancelled) {
          setPipelineLoading(false);
        }
      }
    };

    setPipelineLoading(true);
    void poll();

    const id = window.setInterval(() => {
      const finished = pipeline.status === 'completed';
      if (!finished) {
        void poll();
      }
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [backendFetch, pipeline?.runId, pipeline?.status]);

  const handleDeploy = async () => {
    const selectedCluster = clusters.find(
      cluster => cluster.clusterName === selectedClusterName,
    );
    if (
      !selectedService ||
      !selectedCluster ||
      !selectedCluster.accountScope ||
      !selectedCluster.resourceGroup ||
      !appInstance.trim()
    )
      return;
    if (
      !selectedService.deployment.supported ||
      !selectedService.deployment.application
    ) {
      setError('Deployment is not yet available for this component');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/pipelines/sri/deploy',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentId: selectedService.id,
            application: selectedService.deployment.application,
            clusterName: selectedClusterName,
            subscriptionId: selectedCluster.accountScope,
            resourceGroup: selectedCluster.resourceGroup,
            cloudProvider: 'Azure',
            appInstance: appInstance.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Deployment failed');
      }
      setResult(body);
      setPipeline({
        runId: String(body.pipeline?.runId ?? ''),
        status: body.pipeline?.status ?? 'queued',
        conclusion: body.pipeline?.conclusion ?? null,
        htmlUrl: body.pipeline?.htmlUrl,
      });
      setPipelineLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSelectedService(null);
    setSelectedClusterName('');
    setClusters([]);
    setAppInstance('');
    setResult(null);
    setPipeline(null);
    setPipelineLogs([]);
    setError(null);
  };

  const handleSelectService = (svc: SriComponentDefinition) => {
    if (!svc.deployment.supported) {
      return;
    }
    setSelectedService(svc);
    // Default app instance to the mapped application so every card deploys its
    // corresponding service end-to-end without additional manual entry.
    setAppInstance(svc.deployment.application ?? '');
    setSelectedClusterName('');
    setResult(null);
    setPipeline(null);
    setPipelineLogs([]);
    setError(null);
  };

  const selectedCluster = clusters.find(
    c => c.clusterName === selectedClusterName,
  );

  return (
    <div className={classes.root}>
      <Breadcrumbs className={classes.breadcrumbs}>
        <MuiLink component={RouterLink} to="/">
          Platform Home
        </MuiLink>
        <Typography color="textPrimary">SRI</Typography>
      </Breadcrumbs>

      <div className={classes.hero}>
        <RouterLink to="/" className={classes.backLink}>
          <ArrowBackIcon fontSize="small" /> Platform Home
        </RouterLink>
        <Typography className={classes.heroEyebrow}>
          SymphonyAI Risk Intelligence
        </Typography>
        <Typography className={classes.heroTitle}>
          SRI — Deploy to AKS
        </Typography>
        <Typography className={classes.heroSubtitle}>
          {selectedService
            ? `Deploying ${selectedService.title} application suite to a verified AKS environment.`
            : 'Select a component to trigger the fixed Deploy App workflow onto an existing AKS cluster.'}
        </Typography>
      </div>

      {/* eslint-disable-next-line no-nested-ternary */}
      {result ? (
        // ─── SUCCESS VIEW ───────────────────────────────────────────────────
        <Paper className={classes.paper} elevation={0}>
          <div className={classes.successHeader}>
            <CheckCircleIcon fontSize="large" />
            <Typography variant="h5" style={{ fontWeight: 700 }}>
              Deployment Triggered Successfully!
            </Typography>
          </div>

          <Typography variant="body1" className={classes.successMessage}>
            Great news! The GitOps deployment pipeline has been generated and
            triggered for your <strong>{selectedService?.title}</strong>{' '}
            deployment.
          </Typography>

          <Divider style={{ margin: '16px 0 24px' }} />

          <Typography
            variant="h6"
            style={{ fontWeight: 605, marginBottom: 12 }}
          >
            Deployment & Verification Run Status
          </Typography>

          <div style={{ marginBottom: 24 }}>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>Component</span>
              <span
                className={classes.detailValue}
                style={{ fontFamily: 'sans-serif', fontWeight: 600 }}
              >
                {selectedService?.title} ({selectedService?.tag})
              </span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>GitHub Application</span>
              <span
                className={classes.detailValue}
                style={{ fontFamily: 'sans-serif', fontWeight: 600 }}
              >
                {selectedService?.deployment.application}
              </span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>Deployment Workflow</span>
              <span
                className={classes.detailValue}
                style={{ fontFamily: 'sans-serif', fontWeight: 600 }}
              >
                {selectedService?.deployment.workflow}
              </span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>Target AKS Cluster</span>
              <span
                className={classes.detailValue}
                style={{ fontFamily: 'sans-serif', fontWeight: 600 }}
              >
                {selectedCluster?.clusterName} (Environment:{' '}
                {selectedCluster?.environment})
              </span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>Component ID</span>
              <span className={classes.detailValue}>{selectedService?.id}</span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>GitHub Actions Run ID</span>
              <span className={classes.detailValue}>
                {pipeline?.runId || 'N/A'}
              </span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>Deployment Status</span>
              <span
                className={classes.detailValue}
                style={{ color: '#059669', fontWeight: 700 }}
              >
                {pipeline?.status ||
                  result.record?.deploymentStatus ||
                  'queued'}
              </span>
            </div>
            <div className={classes.detailRow}>
              <span className={classes.detailLabel}>Pipeline Conclusion</span>
              <span
                className={classes.detailValue}
                style={{ color: '#059669', fontWeight: 700 }}
              >
                {pipeline?.conclusion || 'running'}
              </span>
            </div>
          </div>

          {pipeline?.htmlUrl && (
            <Box mb={4}>
              <Button
                variant="outlined"
                color="primary"
                href={pipeline.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GitHub Actions Run
              </Button>
            </Box>
          )}

          <div className={classes.logConsole}>
            <div className={classes.logConsoleHeader}>
              <span>Pipeline Log Console</span>
              <span>
                {pipelineLoading ? 'Refreshing...' : 'Live'}
                {pipeline?.status ? ` • ${pipeline.status}` : ''}
              </span>
            </div>
            <pre className={classes.logConsoleBody}>
              {(pipelineLogs.length
                ? pipelineLogs
                : ['Waiting for logs...']
              ).join('\n')}
            </pre>
          </div>

          <div className={classes.workflowBox}>
            <Typography
              variant="subtitle1"
              style={{ fontWeight: 700, marginBottom: 12, color: '#1E3A8A' }}
            >
              Three-Stage Enterprise Deployment Workflow Alignment
            </Typography>
            <div className={classes.workflowStep}>
              <div
                className={`${classes.workflowStepNum} ${classes.workflowStepNumActive}`}
              >
                ✓
              </div>
              <div>
                <Typography variant="body2" style={{ fontWeight: 600 }}>
                  Stage 1 — Provision AKS Cluster (Platform Team)
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  display="block"
                >
                  Verified AKS environment "{selectedCluster?.clusterName}" was
                  provisioned and registered in Kubernetes Environment Registry.
                </Typography>
              </div>
            </div>
            <div className={classes.workflowStep}>
              <div
                className={`${classes.workflowStepNum} ${classes.workflowStepNumActive}`}
              >
                ✓
              </div>
              <div>
                <Typography
                  variant="body2"
                  style={{ fontWeight: 600, color: '#059669' }}
                >
                  Stage 2 — Deploy SRI Component (Platform Team)
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  display="block"
                >
                  SymphonyAI Risk Intelligence {selectedService?.title} base platform
                  service deployed successfully to target environment.
                </Typography>
              </div>
            </div>
            <div className={classes.workflowStep}>
              <div className={classes.workflowStepNum}>3</div>
              <div>
                <Typography variant="body2" style={{ fontWeight: 600 }}>
                  Stage 3 — Deploy Customer Overlay (Professional Services)
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  display="block"
                >
                  The active base service is now ready for deployment of
                  customer-specific tenant configurations and customization.
                </Typography>
              </div>
            </div>
          </div>

          <Box display="flex" style={{ gap: 16 }}>
            <Button variant="contained" color="primary" onClick={handleReset}>
              Deploy Another SRI Service
            </Button>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => navigate('/deployment/stage/3')}
            >
              Proceed to Customer Overlays (Stage 3)
            </Button>
          </Box>
        </Paper>
      ) : selectedService ? (
        // ─── STEP 2: SELECT CLUSTER VIEW ──────────────────────────────────────
        <Paper className={classes.paper} elevation={0}>
          <Button
            variant="text"
            startIcon={<ArrowBackIcon />}
            onClick={handleReset}
            style={{ marginBottom: 20 }}
          >
            Back to Services List
          </Button>

          <Typography variant="h5" style={{ fontWeight: 700, marginBottom: 8 }}>
            Deploy {selectedService.title} — Select Target Cluster
          </Typography>
          <Typography
            variant="body2"
            color="textSecondary"
            style={{ marginBottom: 24 }}
          >
            Select a tagged AKS cluster from the Platform Registry, then choose
            it as the deployment target.
          </Typography>

          {error && (
            <div className={classes.errorBox}>
              <ErrorIcon />
              <Typography variant="body2">{error}</Typography>
            </div>
          )}

          <Typography
            variant="subtitle2"
            style={{ fontWeight: 600, color: '#374151', marginBottom: 12 }}
          >
            PLATFORM REGISTRY CLUSTERS
          </Typography>

          <Typography variant="body2" color="textSecondary" style={{ marginBottom: 12 }}>
            Azure AKS clusters tagged cloudhub-enabled and cloudhub-onboarded.
          </Typography>

          <Button
            variant="outlined"
            color="primary"
            onClick={handleDiscoverClusters}
            disabled={discovering}
            style={{ marginBottom: 20 }}
          >
            {discovering ? 'Refreshing Registry...' : 'Refresh Clusters'}
          </Button>

          <Typography
            variant="subtitle2"
            style={{ fontWeight: 600, color: '#374151', marginBottom: 12 }}
          >
            AVAILABLE TAGGED AKS CLUSTERS
          </Typography>

          <div style={{ marginBottom: 16 }}>
            <Typography
              variant="subtitle2"
              style={{ fontWeight: 600, color: '#374151', marginBottom: 8 }}
            >
              TARGET APP INSTANCE (LOCKED)
            </Typography>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              value={appInstance}
              placeholder="Auto-filled from selected service"
              error={Boolean(appInstanceError) && appInstance.length > 0}
              helperText={
                appInstance.trim().length
                  ? 'Automatically mapped from selected SRI component (strict mode)'
                  : 'Select a deployable SRI component to populate this value'
              }
              InputProps={{
                readOnly: true,
              }}
            />
          </div>

          {clusters.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <Typography variant="body1" color="textSecondary" gutterBottom>
                No tagged AKS clusters are available in the Platform Registry.
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Verify that your portal identity has Azure read access and that
                the cluster has both CloudHub onboarding tags.
              </Typography>
            </div>
          ) : (
            <Grid container spacing={2}>
              {clusters.map(cluster => {
                const isSelected = selectedClusterName === cluster.clusterName;
                return (
                  <Grid
                    item
                    xs={12}
                    sm={6}
                    md={4}
                    key={`${cluster.subscriptionId}:${cluster.resourceGroup}:${cluster.clusterName}`}
                  >
                    <Card
                      className={`${classes.card} ${
                        isSelected ? classes.cardSelected : ''
                      }`}
                      elevation={0}
                      onClick={() =>
                        setSelectedClusterName(cluster.clusterName)
                      }
                    >
                      <CardActionArea style={{ padding: 20, display: 'block' }}>
                        <Box
                          display="flex"
                          alignItems="center"
                          justifyContent="space-between"
                          mb={1.5}
                        >
                          <Typography
                            variant="h6"
                            style={{
                              fontWeight: 700,
                              fontSize: '1.05rem',
                              color: '#1E293B',
                            }}
                          >
                            {cluster.clusterName}
                          </Typography>
                          <Chip
                            label={cluster.environment || 'dev'}
                            size="small"
                            style={{
                              backgroundColor:
                                cluster.environment === 'prod'
                                  ? '#FEE2E2'
                                  : '#EFF6FF',
                              color:
                                cluster.environment === 'prod'
                                  ? '#991B1B'
                                  : '#1E40AF',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              fontSize: '0.65rem',
                            }}
                          />
                        </Box>
                        <Divider style={{ margin: '8px 0 12px' }} />
                        <Typography
                          variant="body2"
                          style={{
                            marginBottom: 4,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#64748B' }}>Region:</span>
                          <span style={{ fontWeight: 500, color: '#334155' }}>
                            {cluster.region || 'Unknown'}
                          </span>
                        </Typography>
                        <Typography
                          variant="body2"
                          style={{
                            marginBottom: 4,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#64748B' }}>
                            Resource Group:
                          </span>
                          <span style={{ fontWeight: 500, color: '#334155' }}>
                            {cluster.resourceGroup || 'N/A'}
                          </span>
                        </Typography>
                        <Typography
                          variant="body2"
                          style={{
                            marginBottom: 4,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#64748B' }}>
                            Kubernetes Version:
                          </span>
                          <span style={{ fontWeight: 500, color: '#334155' }}>
                            {cluster.kubernetesVersion || 'N/A'}
                          </span>
                        </Typography>
                        <Typography
                          variant="body2"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#64748B' }}>Status:</span>
                          <span
                            style={{
                              fontWeight: 620,
                              color:
                                cluster.status === 'Failed'
                                  ? '#DC2626'
                                  : '#16A34A',
                            }}
                          >
                            {cluster.status || 'Active'}
                          </span>
                        </Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}

          <Box mt={4} display="flex" alignItems="center" style={{ gap: 16 }}>
            <Button
              variant="contained"
              color="primary"
              size="large"
              disabled={
                loading ||
                !selectedClusterName ||
                !appInstance.trim() ||
                !selectedService.deployment.supported ||
                !selectedService.deployment.application
              }
              startIcon={
                loading ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  <CloudUploadIcon />
                )
              }
              onClick={handleDeploy}
            >
              {loading ? 'Initiating Deploy...' : 'Proceed with Deployment'}
            </Button>
            <Button variant="text" onClick={handleReset}>
              Cancel
            </Button>
          </Box>
        </Paper>
      ) : (
        // ─── STEP 1: SELECT SERVICE VIEW (GRID) ──────────────────────────────
        <>
          <Typography className={classes.sectionTitle}>
            {SRI_COMPONENTS.length} SymphonyAI Risk Intelligence components available
            to deploy
          </Typography>

          <Grid container spacing={2}>
            {SRI_COMPONENTS.map(svc => {
              const CardIcon = getSriCardIcon(svc.id);
              return (
              <Grid item xs={12} sm={6} md={4} key={svc.id}>
                <Card className={classes.card} elevation={0}>
                  <CardActionArea
                    className={classes.cardArea}
                    onClick={() => handleSelectService(svc)}
                    disabled={!svc.deployment.supported}
                  >
                    <div className={classes.cardStripe} />
                    <div className={classes.cardBody}>
                      <CardIcon className={classes.cardIcon} />
                      <div className={classes.cardHeader}>
                        <Typography className={classes.cardTitle}>
                          {svc.title}
                        </Typography>
                      </div>
                    </div>
                    <CardContent className={classes.cardFooter}>
                      <span className={classes.deployLabel}>
                        <CloudUploadIcon style={{ fontSize: 14 }} />
                        {svc.deployment.supported ? 'Deploy' : 'Coming Soon'}
                      </span>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
              );
            })}
          </Grid>
        </>
      )}
    </div>
  );
}
