import { useState } from 'react';
import {
  Content,
  Header,
  InfoCard,
  Page,
  Progress,
  WarningPanel,
} from '@backstage/core-components';
import { Box, Button, Grid, TextField, Typography } from '@mui/material';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';

export function InfrastructureProvisioningPage() {
  const { persona } = usePersona();
  const backendFetch = useBackendFetch();
  const isPlatformEngineer = persona === 'cloudhub-platform';

  const [clusterName, setClusterName] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [region, setRegion] = useState('eastus');
  const [environment, setEnvironment] = useState('dev');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/infrastructure/provision',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusterName,
            subscriptionId,
            region,
            environment,
            nodePools: [
              {
                name: 'system',
                vmSize: 'Standard_D4s_v5',
                nodeCount: 3,
                mode: 'System',
              },
              {
                name: 'user',
                vmSize: 'Standard_D8s_v5',
                nodeCount: 4,
                mode: 'User',
              },
            ],
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Provisioning orchestration failed');
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!isPlatformEngineer) {
    return (
      <Page themeId="tool">
        <Header
          title="Infrastructure Provisioning"
          subtitle="Platform Engineer capability"
        />
        <Content>
          <WarningPanel title="Access restricted">
            Only platform-engineer persona can provision AKS infrastructure.
          </WarningPanel>
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header
        title="Infrastructure Provisioning"
        subtitle="Layer-1: GitOps infrastructure orchestration"
      />
      <Content>
        {loading ? <Progress /> : null}
        {error ? (
          <WarningPanel title="Provisioning request failed">
            {error}
          </WarningPanel>
        ) : null}
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <InfoCard title="Provision AKS Infrastructure">
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Cluster Name"
                    value={clusterName}
                    onChange={e => setClusterName(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Subscription ID"
                    value={subscriptionId}
                    onChange={e => setSubscriptionId(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Region"
                    value={region}
                    onChange={e => setRegion(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Environment"
                    value={environment}
                    onChange={e => setEnvironment(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Button variant="contained" color="primary" onClick={submit}>
                    Generate GitOps + Trigger Pipeline
                  </Button>
                </Grid>
              </Grid>
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={5}>
            <InfoCard title="Execution Result">
              {!result ? (
                <Typography variant="body2" color="textSecondary">
                  No run yet.
                </Typography>
              ) : (
                <Box>
                  <Typography variant="body2">
                    Accepted: {String(result.accepted)}
                  </Typography>
                  <Typography variant="body2">
                    Commit: {result.commit?.commitSha}
                  </Typography>
                  <Typography variant="body2">
                    Pipeline: {result.commit?.pipelineUrl}
                  </Typography>
                  <Typography variant="body2">
                    Mode: {result.commit?.mode}
                  </Typography>
                </Box>
              )}
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
}
