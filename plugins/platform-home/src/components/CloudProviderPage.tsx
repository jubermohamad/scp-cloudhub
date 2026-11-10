import { Typography, Grid, Card, CardContent, CardActionArea, Breadcrumbs, Link as MuiLink, Tabs, Tab, Chip, CircularProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LayersIcon from '@mui/icons-material/Layers';
import MemoryIcon from '@mui/icons-material/Memory';
import StorageIcon from '@mui/icons-material/Storage';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PublicIcon from '@mui/icons-material/Public';
import { useBackendFetch } from '@internal/plugin-platform-common';
import { CLOUD_PROVIDERS } from './CloudProvidersSection';

// ─── Resource Options per Provider ──────────────────────────────────────────

interface ResourceOption {
  id: string;
  title: string;
  description: string;
  secondaryText?: string;
  Icon: React.ElementType;
  gradient: string;
  href: string;
}

type ProviderResources = Record<string, ResourceOption[]>;

interface DiscoveredCluster {
  clusterName: string;
  region: string;
  resourceGroup: string;
  kubernetesVersion: string;
  nodePools: number;
  environment: string;
  tags: Record<string, string>;
  status: string;
  subscriptionId: string;
}

const CLOUDHUB_SUBSCRIPTION_ID = 'b0799078-b42a-4b59-9e70-22cd09a20ee2';

const RESOURCES: ProviderResources = {
  aws: [],
  azure: [
    {
      id: 'aks-cluster',
      title: 'Kubernetes Cluster (AKS)',
      description:
        'Provision an Azure AKS cluster. Renders a tfvars file, opens a PR in the CloudHub repo, and triggers Terraform plan/apply.',
      Icon: CloudQueueIcon,
      gradient: 'linear-gradient(135deg, #0078d4 0%, #50e6ff 100%)',
      href: '/create/aks',
    },
    {
      id: 'aks-namespace',
      title: 'Kubernetes Namespace',
      description:
        'Create an isolated namespace on an existing AKS cluster with RBAC and resource quotas.',
      Icon: LayersIcon,
      gradient: 'linear-gradient(135deg, #50e6ff 0%, #00b7c3 100%)',
      href: '/create/templates/default/azure-aks-namespace',
    },
    {
      id: 'gpu-compute',
      title: 'GPU Compute',
      description:
        'Provision and manage GPU instances for AI workloads, including lifecycle controls and quota-aware validation.',
      Icon: MemoryIcon,
      gradient: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
      href: '/gpu-compute',
    },
    {
      id: 'test-vm-create',
      title: 'Test VM Create',
      description:
        'Create low-cost Azure test VMs through the self-service flow backed by Terraform Cloud automation.',
      secondaryText: 'Opens the Test VM create form.',
      Icon: StorageIcon,
      gradient: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)',
      href: '/infrastructure/test-vm/create',
    },
  ],
  gcp: [],
  'on-prem': [],
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(1.5, 4, 3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(1, 2, 2) },
  },
  breadcrumbs: {
    marginBottom: theme.spacing(2),
    fontSize: '0.85rem',
  },
  hero: {
    borderRadius: 12,
    padding: theme.spacing(2.5),
    color: '#fff',
    marginBottom: theme.spacing(2),
  },
  heroTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
  },
  heroSubtitle: {
    fontSize: '0.875rem',
    opacity: 0.85,
    marginTop: theme.spacing(0.5),
  },
  sectionTitle: {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: theme.spacing(2),
  },
  tabsContainer: {
    marginBottom: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  tabs: {
    '& .MuiTabs-indicator': {
      height: 3,
      borderRadius: '3px 3px 0 0',
      background: provider => (provider as any)?.gradient ?? '#0078d4',
    },
  },
  tab: {
    textTransform: 'none',
    fontWeight: 600,
    minWidth: 110,
  },
  clusterCard: {
    height: '100%',
    borderRadius: 10,
    border: `1px solid ${theme.palette.divider}`,
  },
  clusterHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
    gap: theme.spacing(1),
  },
  clusterTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
  },
  clusterMeta: {
    fontSize: '0.82rem',
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(0.5),
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(1.25),
  },
  emptyState: {
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: 10,
    padding: theme.spacing(2),
    color: theme.palette.text.secondary,
    fontSize: '0.9rem',
    background: '#FAFAFA',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1),
  },
  resourceCard: {
    height: '100%',
    borderRadius: 10,
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
  resourceTitle: {
    fontSize: '1rem',
    lineHeight: 1.3,
    fontWeight: 600,
  },
  resourceDescription: {
    fontSize: '0.84rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.5,
  },
  notFound: {
    padding: theme.spacing(4),
    textAlign: 'center',
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
}));

// ─── Page ────────────────────────────────────────────────────────────────────

export function CloudProviderPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const { providerId } = useParams<{ providerId: string }>();

  const providerOrder = ['azure', 'aws', 'gcp', 'on-prem'];
  const validProvider = providerId && providerOrder.includes(providerId);
  const [selectedProviderId, setSelectedProviderId] = useState(
    validProvider ? providerId : 'azure',
  );

  const [azureClusters, setAzureClusters] = useState<DiscoveredCluster[]>([]);
  const [azureLoading, setAzureLoading] = useState(false);
  const [azureError, setAzureError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedProviderId(validProvider ? (providerId as string) : 'azure');
  }, [providerId, validProvider]);

  useEffect(() => {
    if (selectedProviderId !== 'azure') {
      return;
    }

    const fetchAzureClusters = async () => {
      setAzureLoading(true);
      setAzureError(null);
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          `/clusters/deployable?subscriptionId=${CLOUDHUB_SUBSCRIPTION_ID}`,
        );
        const rawBody = await response.text();
        const data = rawBody ? JSON.parse(rawBody) : {};
        if (!response.ok) {
          throw new Error(data.error ?? 'Failed to fetch Azure clusters');
        }
        const clusters = Array.isArray(data.clusters) ? data.clusters : [];
        setAzureClusters(clusters);
      } catch (error) {
        setAzureError(
          error instanceof Error
            ? error.message
            : 'Failed to fetch Azure clusters',
        );
        setAzureClusters([]);
      } finally {
        setAzureLoading(false);
      }
    };

    void fetchAzureClusters();
  }, [backendFetch, selectedProviderId]);

  const provider =
    CLOUD_PROVIDERS.find(p => p.id === selectedProviderId) ?? CLOUD_PROVIDERS[0];
  const resources = RESOURCES[selectedProviderId] ?? [];

  return (
    <div className={classes.root}>
      <Breadcrumbs className={classes.breadcrumbs}>
        <MuiLink component={RouterLink} to="/">
          Platform Home
        </MuiLink>
        <Typography color="textPrimary">{provider.name}</Typography>
      </Breadcrumbs>

      <div className={classes.hero} style={{ background: provider.gradient }}>
        <RouterLink to="/" className={classes.backLink}>
          <ArrowBackIcon fontSize="small" /> All providers
        </RouterLink>
        <Typography className={classes.heroTitle}>
          {provider.name} — {provider.tagline}
        </Typography>
        <Typography className={classes.heroSubtitle}>
          {provider.id === 'azure'
            ? 'Live Azure inventory sourced from CloudHub onboarded cluster tags.'
            : 'Provider tab is enabled, but live cluster inventory is not wired yet.'}
        </Typography>
      </div>

      <div className={classes.tabsContainer}>
        <Tabs
          className={classes.tabs}
          value={selectedProviderId}
          onChange={(_, value) => {
            setSelectedProviderId(value);
            navigate(`/cloud/${value}`);
          }}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Cloud provider tabs"
        >
          <Tab className={classes.tab} value="azure" label="Azure" />
          <Tab className={classes.tab} value="aws" label="AWS" />
          <Tab className={classes.tab} value="gcp" label="GCP" />
          <Tab className={classes.tab} value="on-prem" label="On-Prem" />
        </Tabs>
      </div>

      {selectedProviderId === 'azure' ? (
        <>
          <Typography className={classes.sectionTitle}>
            Onboarded Azure AKS Clusters
          </Typography>
          <Typography className={classes.resourceDescription}>
            Showing clusters discovered through tag-based eligibility where
            cloudhub-enabled=true and cloudhub-onboarded=true.
          </Typography>

          {azureLoading && (
            <div className={classes.loadingRow}>
              <CircularProgress size={18} />
              <span>Loading Azure clusters...</span>
            </div>
          )}

          {azureError && (
            <div className={classes.emptyState}>
              Failed to load Azure clusters: {azureError}
            </div>
          )}

          {!azureLoading && !azureError && azureClusters.length === 0 && (
            <div className={classes.emptyState}>
              No Azure AKS clusters matched the required CloudHub tags.
            </div>
          )}

          {!azureLoading && !azureError && azureClusters.length > 0 && (
            <Grid container spacing={3} style={{ marginBottom: 16 }}>
              {azureClusters.map(cluster => (
                <Grid item xs={12} sm={6} md={4} key={cluster.clusterName}>
                  <Card className={classes.clusterCard} elevation={0}>
                    <CardContent>
                      <div className={classes.clusterHeader}>
                        <Typography className={classes.clusterTitle}>
                          {cluster.clusterName}
                        </Typography>
                        <Chip
                          size="small"
                          icon={<PublicIcon style={{ fontSize: 14 }} />}
                          label={cluster.environment || 'n/a'}
                        />
                      </div>
                      <Typography className={classes.clusterMeta}>
                        Resource Group: {cluster.resourceGroup}
                      </Typography>
                      <Typography className={classes.clusterMeta}>
                        Region: {cluster.region} | K8s: {cluster.kubernetesVersion}
                      </Typography>
                      <Typography className={classes.clusterMeta}>
                        Node Pools: {cluster.nodePools} | Status: {cluster.status}
                      </Typography>
                      <div className={classes.tagRow}>
                        <Chip
                          size="small"
                          label={`cloudhub-enabled=${cluster.tags?.['cloudhub-enabled'] ?? 'n/a'}`}
                        />
                        <Chip
                          size="small"
                          label={`cloudhub-onboarded=${cluster.tags?.['cloudhub-onboarded'] ?? 'n/a'}`}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      ) : (
        <div className={classes.emptyState}>
          Live cluster inventory for {provider.name} is not available yet.
        </div>
      )}

      {resources.length > 0 && (
        <>
          <Typography className={classes.sectionTitle}>Available resources</Typography>
          <Grid container spacing={3}>
            {resources.map(resource => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={resource.id}>
                <Card className={classes.resourceCard} elevation={0}>
                  <CardActionArea
                    className={classes.cardArea}
                    onClick={() => navigate(resource.href)}
                  >
                    <div className={classes.cardHeader}>
                      <div
                        className={classes.iconBox}
                        style={{ background: resource.gradient }}
                      >
                        <resource.Icon style={{ fontSize: 26 }} />
                      </div>
                      <Typography className={classes.resourceTitle}>
                        {resource.title}
                      </Typography>
                    </div>
                    <CardContent>
                      <Typography className={classes.resourceDescription}>
                        {resource.description}
                      </Typography>
                      {resource.secondaryText && (
                        <Typography
                          variant="caption"
                          color="textSecondary"
                          style={{ marginTop: 4, display: 'block' }}
                        >
                          {resource.secondaryText}
                        </Typography>
                      )}
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </div>
  );
}
