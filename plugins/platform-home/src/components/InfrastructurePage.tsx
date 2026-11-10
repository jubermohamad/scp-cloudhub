import { Box, Card, CardActionArea, Chip, Grid, Tab, Tabs, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import StorageIcon from '@mui/icons-material/Storage';
import LayersIcon from '@mui/icons-material/Layers';
import LockIcon from '@mui/icons-material/Lock';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import MemoryIcon from '@mui/icons-material/Memory';
import AzureFoundationResourceCard from './AzureFoundationResourceCard';

const PROVIDER_ORDER = ['azure'] as const;
type ProviderId = (typeof PROVIDER_ORDER)[number];

interface InfrastructureResource {
  id: string;
  title: string;
  description: string;
  secondaryText: string;
  actionLabel: string;
  Icon: React.ElementType;
  gradient: string;
}

const PROVIDER_META: Record<
  ProviderId,
  { name: string; summary: string; gradient: string }
> = {
  azure: {
    name: 'Azure',
    summary: 'Foundational Azure resource creation for dev and test workloads.',
    gradient: 'linear-gradient(135deg, #0078D4 0%, #50e6ff 100%)',
  },
};

const RESOURCES: Record<ProviderId, InfrastructureResource[]> = {
  azure: [
    {
      id: 'test-vm',
      title: 'Create Test VM',
      description: 'Launch a low-cost Azure VM for validation and smoke testing.',
      secondaryText: 'D1 / B1 style baseline instance',
      actionLabel: 'VM',
      Icon: StorageIcon,
      gradient: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)',
    },
    {
      id: 'gpu-instance',
      title: 'GPU Compute',
      description:
        'Provision GPU instances for AI/ML workloads using approved networking and quotas.',
      secondaryText: 'Accelerated compute',
      actionLabel: 'GPU',
      Icon: MemoryIcon,
      gradient: 'linear-gradient(135deg, #0369a1 0%, #38bdf8 100%)',
    },
    {
      id: 'vnet-subnet',
      title: 'VNet / Subnet',
      description: 'Create a secure network foundation with segmentation and routing.',
      secondaryText: 'Private networking',
      actionLabel: 'Network',
      Icon: LayersIcon,
      gradient: 'linear-gradient(135deg, #0f766e 0%, #2dd4bf 100%)',
    },
    {
      id: 'key-vault',
      title: 'Secrets Vault',
      description: 'Store secrets, keys, and certificates for app and platform use.',
      secondaryText: 'Secrets management',
      actionLabel: 'Secrets',
      Icon: LockIcon,
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
    },
    {
      id: 'storage-account',
      title: 'Storage Account',
      description: 'Provision blob, file, or data storage for application workloads.',
      secondaryText: 'Durable storage',
      actionLabel: 'Storage',
      Icon: StorageIcon,
      gradient: 'linear-gradient(135deg, #0f172a 0%, #475569 100%)',
    },
    {
      id: 'resource-group',
      title: 'Resource Group',
      description: 'Create a logical Azure container for related platform resources.',
      secondaryText: 'Lifecycle boundary',
      actionLabel: 'Group',
      Icon: FolderSharedIcon,
      gradient: 'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)',
    },
  ],
};



const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3, 4, 4),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  hero: {
    borderRadius: 14,
    padding: theme.spacing(2.5),
    marginBottom: theme.spacing(3),
    color: '#fff',
    boxShadow: theme.shadows[2],
  },
  heroTitle: {
    fontSize: '2rem',
    fontWeight: 700,
    lineHeight: 1.15,
  },
  heroSubtitle: {
    opacity: 0.9,
    fontSize: '0.96rem',
    marginTop: theme.spacing(1),
    maxWidth: 760,
  },
  tabsContainer: {
    marginBottom: theme.spacing(3),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  tab: {
    textTransform: 'none',
    fontWeight: 600,
    minWidth: 120,
  },
  sectionLabel: {
    fontSize: '1.1rem',
    fontWeight: 700,
    marginBottom: theme.spacing(2),
  },
  resourceCard: {
    height: '100%',
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: theme.shadows[8],
      transform: 'translateY(-2px)',
    },
  },
  resourceCardSelected: {
    height: '100%',
    borderRadius: 12,
    border: `2px solid #2563eb`,
    boxShadow: '0 0 0 1px rgba(37,99,235,0.12)',
    background: '#f8fbff',
  },
  cardArea: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: theme.spacing(1.25),
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1.5),
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    flexShrink: 0,
  },
  title: {
    fontSize: '0.98rem',
    fontWeight: 700,
    lineHeight: 1.3,
  },
  description: {
    fontSize: '0.82rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.55,
    marginTop: theme.spacing(0.75),
  },
  detailCard: {
    marginTop: theme.spacing(3),
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    background: '#f8fafc',
  },
  blankState: {
    borderRadius: 10,
    border: `1px dashed ${theme.palette.divider}`,
    padding: theme.spacing(2),
    color: theme.palette.text.secondary,
    background: '#fafafa',
  },
}));

interface ResourceDetailCardProps {
  selectedResource: InfrastructureResource;
}

function ResourceDetailCard({ selectedResource }: ResourceDetailCardProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (selectedResource.id === 'test-vm') {
      navigate('/infrastructure/test-vm/create');
      return;
    }
    if (selectedResource.id === 'gpu-instance') {
      navigate('/gpu-compute/create');
    }
  }, [navigate, selectedResource.id]);

  if (
    selectedResource.id === 'test-vm' ||
    selectedResource.id === 'gpu-instance'
  ) {
    return null;
  }

  return (
    <AzureFoundationResourceCard
      resourceType={selectedResource.id as
        | 'resource-group'
        | 'vnet-subnet'
        | 'key-vault'
        | 'storage-account'}
      title={selectedResource.title}
      description={selectedResource.description}
    />
  );
}

export function InfrastructurePage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const location = useLocation();

  const initialProvider = useMemo<ProviderId>(() => {
    const providerFromQuery = new URLSearchParams(location.search).get('provider');
    return providerFromQuery && PROVIDER_ORDER.includes(providerFromQuery as ProviderId)
      ? (providerFromQuery as ProviderId)
      : 'azure';
  }, [location.search]);

  const initialResourceId = useMemo<string>(() => {
    const resourceFromQuery = new URLSearchParams(location.search).get('resource');
    const providerResources = RESOURCES[initialProvider] ?? [];

    return providerResources.some(resource => resource.id === resourceFromQuery)
      ? (resourceFromQuery as string)
      : '';
  }, [initialProvider, location.search]);

  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(initialProvider);
  const [selectedResourceId, setSelectedResourceId] = useState<string>(initialResourceId);

  useEffect(() => {
    setSelectedProvider(initialProvider);
    setSelectedResourceId(initialResourceId);
  }, [initialProvider, initialResourceId]);

    const providerMeta = PROVIDER_META[selectedProvider];
  const resources = RESOURCES[selectedProvider];
  const selectedResource =
    resources.find(resource => resource.id === selectedResourceId) ?? undefined;

  const handleTabChange = (_event: unknown, value: ProviderId) => {
    setSelectedProvider(value);
    navigate({ pathname: '/infrastructure', search: `?provider=${value}` });
  };

  return (
    <div className={classes.root}>
      <div className={classes.hero} style={{ background: providerMeta.gradient }}>
        <Typography className={classes.heroTitle}>Infrastructure</Typography>
        <Typography className={classes.heroSubtitle}>
          {providerMeta.summary} Use this workspace to provision the foundational platform
          building blocks required before application deployment.
        </Typography>
      </div>

      <div className={classes.tabsContainer}>
        <Tabs
          value={selectedProvider}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          aria-label="Infrastructure provider tabs"
        >
          <Tab className={classes.tab} value="azure" label="Azure" />
        </Tabs>
      </div>

      <Typography className={classes.sectionLabel}>Available foundation resources</Typography>
      <Grid container spacing={2}>
        {resources.map(resource => {
          const isSelected = selectedResource?.id === resource.id;
          return (
            <Grid item xs={12} sm={6} md={4} lg={3} key={resource.id}>
              <Card
                className={isSelected ? classes.resourceCardSelected : classes.resourceCard}
                elevation={0}
              >
                <CardActionArea
                  className={classes.cardArea}
                  onClick={() => {
                    if (resource.id === 'test-vm') {
                      navigate('/infrastructure/test-vm/create');
                      return;
                    }
                    if (resource.id === 'gpu-instance') {
                      navigate('/gpu-compute/create');
                      return;
                    }
                    setSelectedResourceId(resource.id);
                    navigate({
                      pathname: '/infrastructure',
                      search: `?provider=${selectedProvider}&resource=${resource.id}`,
                    });
                  }}
                >
                  <div className={classes.cardHeader}>
                    <div
                      className={classes.iconBox}
                      style={{ background: resource.gradient }}
                    >
                      <resource.Icon fontSize="small" />
                    </div>
                    <Chip size="small" label={resource.actionLabel} />
                  </div>
                  <Typography className={classes.title}>{resource.title}</Typography>
                  <Typography className={classes.description}>{resource.description}</Typography>
                  {resource.secondaryText && (
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      style={{ marginTop: 8, display: 'block' }}
                    >
                      {resource.secondaryText}
                    </Typography>
                  )}
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {selectedResource ? (
        <ResourceDetailCard selectedResource={selectedResource} />
      ) : (
        <Box className={classes.blankState} mt={3}>
          Select a foundation resource to open its create form.
        </Box>
      )}
    </div>
  );
}
