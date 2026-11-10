import { useEffect, useState } from 'react';
import {
  Content,
  Header,
  InfoCard,
  Page,
  Progress,
  WarningPanel,
} from '@backstage/core-components';
import { Box, Button, FormControl, Grid, InputLabel, MenuItem, Select, TextField, Typography, Card, CardActionArea, CardContent, Avatar } from '@mui/material';
import { makeStyles } from '@mui/styles';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  card: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
    borderRadius: theme.shape.borderRadius * 2,
    border: `1px solid ${theme.palette.divider}`,
    background: theme.palette.background.paper,
    '&:hover': {
      transform: 'translateY(-4px)',
      boxShadow: theme.shadows[4],
      borderColor: theme.palette.primary.main,
    },
  },
  cardActionArea: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  cardContent: {
    padding: theme.spacing(3),
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: theme.spacing(2),
  },
  visaAvatar: {
    backgroundColor: '#002244',
    color: '#FFF',
    border: '2px solid #F7B600',
  },
  smbcAvatar: {
    backgroundColor: '#006B3F',
    color: '#FFF',
    border: '2px solid #FFF',
  },
  scotiaAvatar: {
    backgroundColor: '#ED1C24',
    color: '#FFF',
    border: '2px solid #FFF',
  },
  backButton: {
    marginBottom: theme.spacing(3),
  },
  customerBadge: {
    backgroundColor: theme.palette.action.selected,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1, 2),
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
}));

interface Customer {
  id: string;
  name: string;
  description: string;
  industry: string;
  avatarClass: string;
}

const CUSTOMERS: Customer[] = [
  {
    id: 'visa',
    name: 'Visa',
    description: 'Secure global checkout, payment networks and processing.',
    industry: 'Financial Services',
    avatarClass: 'visaAvatar',
  },
  {
    id: 'smbc',
    name: 'SMBC',
    description:
      'Corporate commercial banking, global trade & capital markets.',
    industry: 'Banking Group',
    avatarClass: 'smbcAvatar',
  },
  {
    id: 'scotia',
    name: 'Scotia',
    description: 'International wealth management, personal & public finance.',
    industry: 'Multinational Bank',
    avatarClass: 'scotiaAvatar',
  },
];

export function TenantOverlayManagerPage() {
  const classes = useStyles();
  const { persona } = usePersona();
  const backendFetch = useBackendFetch();
  const isProfessionalServices = persona === 'professional-services';

  const [clusters, setClusters] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [tenantId, setTenantId] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const [overlayVersion, setOverlayVersion] = useState('1.0.0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const response = await backendFetch(
        'deployment-control-plane',
        '/clusters',
      );
      if (response.ok) {
        const body = await response.json();
        setClusters(body.items ?? []);
      }
    };
    void load();
  }, [backendFetch]);

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setTenantId(customerId);
    // Reset output when switching customer
    setResult(null);
    setError(null);
  };

  const handleBackToCustomers = () => {
    setSelectedCustomerId(null);
  };

  const invoke = async (action: 'deploy' | 'promote' | 'rollback') => {
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/overlays/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            clusterId,
            environment,
            overlayVersion,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? `${action} failed`);
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!isProfessionalServices) {
    return (
      <Page themeId="tool">
        <Header
          title="Customer Overlay Manager"
          subtitle="Professional Services capability"
        />
        <Content>
          <WarningPanel title="Access restricted">
            Only professional-services persona can deploy customer overlays.
          </WarningPanel>
        </Content>
      </Page>
    );
  }

  // Find selected customer info
  const selectedCustomerInfo = CUSTOMERS.find(c => c.id === selectedCustomerId);

  return (
    <Page themeId="tool">
      <Header
        title="Customer Overlay Manager"
        subtitle="Layer-3: customer overlay GitOps deployment"
      />
      <Content>
        {loading ? <Progress /> : null}
        {error ? (
          <WarningPanel title="Overlay operation failed">{error}</WarningPanel>
        ) : null}

        {!selectedCustomerId ? (
          <Box>
            <Box mb={4}>
              <Typography variant="h5" gutterBottom>
                Select a Customer
              </Typography>
              <Typography variant="body1" color="textSecondary">
                Choose a customer below to access their custom overlay GitOps
                control plane and trigger target deployments.
              </Typography>
            </Box>

            <Grid container spacing={3}>
              {CUSTOMERS.map(customer => {
                const avatarClass =
                  (classes as any)[customer.avatarClass] || '';
                return (
                  <Grid item xs={12} sm={4} key={customer.id}>
                    <Card
                      className={classes.card}
                      onClick={() => handleSelectCustomer(customer.id)}
                    >
                      <CardActionArea className={classes.cardActionArea}>
                        <CardContent className={classes.cardContent}>
                          <Avatar
                            className={`${classes.avatar} ${avatarClass}`}
                          >
                            {customer.name.substring(0, 2).toUpperCase()}
                          </Avatar>
                          <Typography variant="h6" component="h2" gutterBottom>
                            {customer.name}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="textSecondary"
                            style={{ flexGrow: 1 }}
                          >
                            {customer.description}
                          </Typography>
                          <Box mt={2}>
                            <Typography
                              variant="caption"
                              color="textSecondary"
                              style={{
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                              }}
                            >
                              {customer.industry}
                            </Typography>
                          </Box>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        ) : (
          <Box>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<ArrowBackIcon />}
              className={classes.backButton}
              onClick={handleBackToCustomers}
            >
              Back to Customers
            </Button>

            <Box className={classes.customerBadge}>
              <Typography variant="body1">
                Active Customer: <strong>{selectedCustomerInfo?.name}</strong> (
                {selectedCustomerInfo?.industry})
              </Typography>
            </Box>

            <Grid container spacing={3}>
              <Grid item xs={12} md={7}>
                <InfoCard
                  title={`${selectedCustomerInfo?.name} Overlay Workflow`}
                >
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Customer ID"
                        value={tenantId}
                        disabled
                        helperText="Customer ID is locked based on selection. Go back to change."
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <FormControl fullWidth>
                        <InputLabel id="overlay-cluster-select">
                          Select Target AKS Cluster
                        </InputLabel>
                        <Select
                          labelId="overlay-cluster-select"
                          value={clusterId}
                          onChange={e => setClusterId(e.target.value as string)}
                        >
                          {clusters.map(c => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.clusterName} ({c.environment})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Environment Overlay Namespace/Env"
                        value={environment}
                        onChange={e => setEnvironment(e.target.value)}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Overlay Configuration Version"
                        value={overlayVersion}
                        onChange={e => setOverlayVersion(e.target.value)}
                      />
                    </Grid>
                  </Grid>
                  <Box mt={3} display="flex" style={{ gap: 8 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={() => invoke('deploy')}
                    >
                      Deploy Overlay
                    </Button>
                    <Button
                      variant="outlined"
                      color="primary"
                      onClick={() => invoke('promote')}
                    >
                      Promote overlay
                    </Button>
                    <Button
                      variant="outlined"
                      color="secondary"
                      onClick={() => invoke('rollback')}
                    >
                      Rollback Overlay
                    </Button>
                  </Box>
                </InfoCard>
              </Grid>

              <Grid item xs={12} md={5}>
                <InfoCard title="GitOps Deployment Result">
                  {!result ? (
                    <Typography variant="body2" color="textSecondary">
                      No customer overlay execution started yet.
                    </Typography>
                  ) : (
                    <Box>
                      <Typography variant="body1" style={{ marginBottom: 8 }}>
                        Status:{' '}
                        <strong>{result.record?.deploymentStatus}</strong>
                      </Typography>
                      <Typography
                        variant="body2"
                        color="textSecondary"
                        style={{ marginBottom: 4 }}
                      >
                        Git SHA: {result.commit?.commitSha || 'N/A'}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="textSecondary"
                        style={{ marginBottom: 4 }}
                      >
                        ArgoCD Sync: {result.sync?.status || 'N/A'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Validation details:{' '}
                        {(result.validationIssues ?? []).join(', ') ||
                          'Successful validation'}
                      </Typography>
                    </Box>
                  )}
                </InfoCard>
              </Grid>
            </Grid>
          </Box>
        )}
      </Content>
    </Page>
  );
}
