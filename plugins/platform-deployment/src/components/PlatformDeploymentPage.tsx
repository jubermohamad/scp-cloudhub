import { useEffect, useState } from 'react';
import {
  Content,
  Header,
  InfoCard,
  Page,
  Progress,
  WarningPanel,
} from '@backstage/core-components';
import {
  Box,
  Button,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';

export function PlatformDeploymentPage() {
  const { persona } = usePersona();
  const backendFetch = useBackendFetch();
  const isPlatformEngineer = persona === 'cloudhub-platform';

  const [clusters, setClusters] = useState<any[]>([]);
  const [clusterId, setClusterId] = useState('');
  const [platformVersion, setPlatformVersion] = useState('9.6.0');
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

  const deploy = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/platform/deploy',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clusterId, platformVersion }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Platform deployment failed');
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
          title="Platform Deployment Manager"
          subtitle="Platform Engineer capability"
        />
        <Content>
          <WarningPanel title="Access restricted">
            Only platform-engineer persona can deploy NetReveal platform stack.
          </WarningPanel>
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header
        title="Platform Deployment Manager"
        subtitle="Layer-2: NetReveal base stack deployment orchestration"
      />
      <Content>
        {loading ? <Progress /> : null}
        {error ? (
          <WarningPanel title="Deployment failed">{error}</WarningPanel>
        ) : null}

        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <InfoCard title="Deploy Platform Stack">
              <Typography variant="body2" color="textSecondary">
                Deployment sequence: common-res | nr-infra-common |
                edb-netrevealv96
              </Typography>
              <Box mt={2}>
                <FormControl fullWidth>
                  <InputLabel id="cluster-select">Target Cluster</InputLabel>
                  <Select
                    labelId="cluster-select"
                    value={clusterId}
                    onChange={e => setClusterId(e.target.value as string)}
                  >
                    {clusters.map(c => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.clusterName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              <Box mt={2}>
                <TextField
                  fullWidth
                  label="Platform Version"
                  value={platformVersion}
                  onChange={e => setPlatformVersion(e.target.value)}
                />
              </Box>
              <Box mt={2}>
                <Button variant="contained" color="primary" onClick={deploy}>
                  Generate GitOps + Trigger ArgoCD Sync
                </Button>
              </Box>
            </InfoCard>
          </Grid>

          <Grid item xs={12} md={5}>
            <InfoCard title="Deployment Status">
              {!result ? (
                <Typography variant="body2" color="textSecondary">
                  No deployment started yet.
                </Typography>
              ) : (
                <Box>
                  <Typography variant="body2">
                    Status: {result.record?.deploymentStatus}
                  </Typography>
                  <Typography variant="body2">
                    Commit: {result.commit?.commitSha}
                  </Typography>
                  <Typography variant="body2">
                    Sync: {result.sync?.status}
                  </Typography>
                  <Typography variant="body2">
                    Health checks:{' '}
                    {Object.values(result.prerequisites ?? {}).every(Boolean)
                      ? 'Passed'
                      : 'Warning'}
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
