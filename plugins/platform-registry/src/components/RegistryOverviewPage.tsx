import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Content,
  ContentHeader,
  Header,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { Card, CardActionArea, CardContent, Grid, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import BusinessIcon from '@mui/icons-material/Business';
import CloudIcon from '@mui/icons-material/Cloud';
import LayersIcon from '@mui/icons-material/Layers';
import DnsIcon from '@mui/icons-material/Dns';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import AppsIcon from '@mui/icons-material/Apps';
import RocketIcon from '@mui/icons-material/FlightTakeoff';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from '../api';
import type { RegistrySummary } from '../types';

const useStyles = makeStyles(theme => ({
  intro: {
    marginBottom: theme.spacing(3),
    color: theme.palette.text.secondary,
    maxWidth: 880,
  },
  card: {
    height: '100%',
    borderRadius: theme.shape.borderRadius,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardInner: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0E7FF',
    color: '#1E3A8A',
  },
  count: {
    fontWeight: 700,
    lineHeight: 1.1,
  },
  label: {
    color: theme.palette.text.secondary,
  },
  noAccess: {
    padding: theme.spacing(4),
    textAlign: 'center',
  },
}));

interface Tile {
  key: keyof RegistrySummary;
  label: string;
  to: string;
  icon: JSX.Element;
}

const TILES: Tile[] = [
  {
    key: 'platforms',
    label: 'Platforms',
    to: '/platform-registry/platforms',
    icon: <BusinessIcon />,
  },
  {
    key: 'cloudAccounts',
    label: 'Cloud Accounts',
    to: '/platform-registry/cloud-accounts',
    icon: <CloudIcon />,
  },
  {
    key: 'environments',
    label: 'Environments',
    to: '/platform-registry/clusters',
    icon: <LayersIcon />,
  },
  {
    key: 'clusters',
    label: 'Clusters',
    to: '/platform-registry/clusters',
    icon: <DnsIcon />,
  },
  {
    key: 'namespaces',
    label: 'Namespaces',
    to: '/platform-registry/namespaces',
    icon: <ViewModuleIcon />,
  },
  {
    key: 'deploymentTargets',
    label: 'Deployment Targets',
    to: '/platform-registry/deployment-targets',
    icon: <GpsFixedIcon />,
  },
  {
    key: 'applications',
    label: 'Applications',
    to: '/platform-registry/applications',
    icon: <AppsIcon />,
  },
  {
    key: 'deployments',
    label: 'Deployments',
    to: '/platform-registry/deployment-targets',
    icon: <RocketIcon />,
  },
];

export function RegistryOverviewPage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const { persona } = usePersona();

  const canAccess =
    persona === 'cloudhub-platform' ||
    persona === 'professional-services' ||
    persona === 'app-engineering' ||
    persona === 'sre';

  const api = useMemo(
    () => createPlatformRegistryApi(backendFetch, persona),
    [backendFetch, persona],
  );

  const [summary, setSummary] = useState<RegistrySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!canAccess) {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getSummary()
      .then(s => !cancelled && setSummary(s))
      .catch(err => !cancelled && setError(err as Error))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, canAccess]);

  return (
    <Page themeId="tool">
      <Header
        title="Platform Registry"
        subtitle="Authoritative inventory of platforms, accounts, clusters and deployments"
        type="Configuration Management"
      />
      <Content>
        <ContentHeader title="Overview" />
        {!canAccess ? (
          <div className={classes.noAccess}>
            <Typography variant="h6">Access restricted</Typography>
            <Typography color="textSecondary">
              The Platform Registry is available to platform administrators and
              professional services personas.
            </Typography>
          </div>
        ) : (
          <>
            <Typography variant="body1" className={classes.intro}>
              The Platform Registry is the single source of truth for the
              CloudHub estate. It records every platform, cloud account,
              environment, cluster, namespace, deployment target and application
              across all supported clouds.
            </Typography>

            {error && <ResponseErrorPanel error={error} />}
            {loading && <Progress />}

            {summary && (
              <Grid container spacing={3}>
                {TILES.map(tile => (
                  <Grid item xs={12} sm={6} md={3} key={tile.label}>
                    <Card className={classes.card}>
                      <CardActionArea component={RouterLink} to={tile.to}>
                        <CardContent className={classes.cardInner}>
                          <div className={classes.iconWrap}>{tile.icon}</div>
                          <div>
                            <Typography variant="h4" className={classes.count}>
                              {summary[tile.key]}
                            </Typography>
                            <Typography
                              variant="body2"
                              className={classes.label}
                            >
                              {tile.label}
                            </Typography>
                          </div>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </>
        )}
      </Content>
    </Page>
  );
}
