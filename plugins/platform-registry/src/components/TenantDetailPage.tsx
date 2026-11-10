import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Content,
  ContentHeader,
  Header,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { Breadcrumbs, Grid, Link, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CloudIcon from '@mui/icons-material/Cloud';
import LayersIcon from '@mui/icons-material/Layers';
import DnsIcon from '@mui/icons-material/Dns';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import RocketIcon from '@mui/icons-material/FlightTakeoff';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from '../api';
import type { PlatformDetail } from '../types';
import { StatusChip } from './common/StatusChip';

const useStyles = makeStyles(theme => ({
  breadcrumbs: {
    marginBottom: theme.spacing(2),
  },
  statTile: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    height: '100%',
    borderRadius: theme.shape.borderRadius,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0E7FF',
    color: '#1E3A8A',
  },
  statCount: {
    fontWeight: 700,
    lineHeight: 1.1,
  },
  statLabel: {
    color: theme.palette.text.secondary,
  },
  section: {
    marginTop: theme.spacing(4),
  },
  sectionTitle: {
    fontWeight: 700,
    marginBottom: theme.spacing(1.5),
  },
  tableCard: {
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.shape.borderRadius,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  headerCell: {
    fontWeight: 700,
    color: theme.palette.text.secondary,
    textTransform: 'uppercase',
    fontSize: '0.72rem',
    letterSpacing: '0.04em',
  },
  empty: {
    padding: theme.spacing(3),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  meta: {
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(2),
  },
  noAccess: {
    padding: theme.spacing(4),
    textAlign: 'center',
  },
}));

interface SectionColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

function dash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : '—';
}

export function PlatformDetailPage() {
  const classes = useStyles();
  const { platformId } = useParams<{ platformId: string }>();
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

  const [detail, setDetail] = useState<PlatformDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!canAccess || !platformId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPlatformDetail(platformId)
      .then(d => !cancelled && setDetail(d))
      .catch(err => !cancelled && setError(err as Error))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, platformId, canAccess]);

  const platform = detail?.platform;

  const stats = detail
    ? [
        {
          label: 'Cloud Accounts',
          count: detail.cloudAccounts.length,
          icon: <CloudIcon />,
        },
        {
          label: 'Environments',
          count: detail.environments.length,
          icon: <LayersIcon />,
        },
        { label: 'Clusters', count: detail.clusters.length, icon: <DnsIcon /> },
        {
          label: 'Namespaces',
          count: detail.namespaces.length,
          icon: <ViewModuleIcon />,
        },
        {
          label: 'Deployment Targets',
          count: detail.deploymentTargets.length,
          icon: <GpsFixedIcon />,
        },
        {
          label: 'Deployments',
          count: detail.deployments.length,
          icon: <RocketIcon />,
        },
      ]
    : [];

  function renderSection<T extends { id: string }>(
    title: string,
    rows: T[],
    columns: SectionColumn<T>[],
  ) {
    return (
      <div className={classes.section}>
        <Typography variant="h6" className={classes.sectionTitle}>
          {title}
        </Typography>
        <TableContainer className={classes.tableCard}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map(col => (
                  <TableCell key={col.key} className={classes.headerCell}>
                    {col.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className={classes.empty}>
                    None registered.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(row => (
                  <TableRow key={row.id} hover>
                    {columns.map(col => (
                      <TableCell key={col.key}>{col.render(row)}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    );
  }

  return (
    <Page themeId="tool">
      <Header
        title={platform ? platform.platformName : 'Platform'}
        subtitle={
          platform ? `Platform ${platform.platformCode}` : 'Platform Registry'
        }
        type="Platform Registry"
      />
      <Content>
        <Breadcrumbs className={classes.breadcrumbs}>
          <Link component={RouterLink} to="/platform-registry/platforms">
            Platforms
          </Link>
          <Typography color="textPrimary">
            {platform ? platform.platformName : platformId}
          </Typography>
        </Breadcrumbs>

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
            {error && <ResponseErrorPanel error={error} />}
            {loading && <Progress />}

            {detail && platform && (
              <>
                <ContentHeader title={platform.platformName}>
                  <StatusChip status={platform.status} />
                </ContentHeader>

                <Typography variant="body2" className={classes.meta}>
                  Type: {dash(platform.platformType)} · Owner:{' '}
                  {dash(platform.ownerEmail)}
                </Typography>

                <Grid container spacing={2}>
                  {stats.map(stat => (
                    <Grid item xs={6} sm={4} md={2} key={stat.label}>
                      <Paper className={classes.statTile} elevation={0}>
                        <div className={classes.iconWrap}>{stat.icon}</div>
                        <div>
                          <Typography
                            variant="h5"
                            className={classes.statCount}
                          >
                            {stat.count}
                          </Typography>
                          <Typography
                            variant="caption"
                            className={classes.statLabel}
                          >
                            {stat.label}
                          </Typography>
                        </div>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>

                {renderSection('Cloud Accounts', detail.cloudAccounts, [
                  {
                    key: 'name',
                    label: 'Account Name',
                    render: r => r.accountName,
                  },
                  {
                    key: 'provider',
                    label: 'Provider',
                    render: r => r.cloudProvider,
                  },
                  {
                    key: 'identifier',
                    label: 'Identifier',
                    render: r => dash(r.accountIdentifier),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <StatusChip status={r.status} />,
                  },
                ])}

                {renderSection('Environments', detail.environments, [
                  {
                    key: 'name',
                    label: 'Environment',
                    render: r => r.environmentName,
                  },
                  {
                    key: 'type',
                    label: 'Type',
                    render: r => dash(r.environmentType),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <StatusChip status={r.status} />,
                  },
                ])}

                {renderSection('Clusters', detail.clusters, [
                  { key: 'name', label: 'Cluster', render: r => r.clusterName },
                  { key: 'type', label: 'Type', render: r => r.clusterType },
                  {
                    key: 'provider',
                    label: 'Provider',
                    render: r => r.provider,
                  },
                  {
                    key: 'region',
                    label: 'Region',
                    render: r => dash(r.region),
                  },
                  {
                    key: 'env',
                    label: 'Environment',
                    render: r => dash(r.environmentName),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <StatusChip status={r.status} />,
                  },
                ])}

                {renderSection('Namespaces', detail.namespaces, [
                  {
                    key: 'name',
                    label: 'Namespace',
                    render: r => r.namespaceName,
                  },
                  {
                    key: 'cluster',
                    label: 'Cluster',
                    render: r => dash(r.clusterName),
                  },
                  { key: 'owner', label: 'Owner', render: r => dash(r.owner) },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <StatusChip status={r.status} />,
                  },
                ])}

                {renderSection('Deployment Targets', detail.deploymentTargets, [
                  { key: 'name', label: 'Target', render: r => r.targetName },
                  {
                    key: 'env',
                    label: 'Environment',
                    render: r => dash(r.environmentName),
                  },
                  {
                    key: 'cluster',
                    label: 'Cluster',
                    render: r => dash(r.clusterName),
                  },
                  {
                    key: 'namespace',
                    label: 'Namespace',
                    render: r => dash(r.namespaceName),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <StatusChip status={r.status} />,
                  },
                ])}

                {renderSection('Deployments', detail.deployments, [
                  {
                    key: 'app',
                    label: 'Application',
                    render: r => dash(r.applicationName),
                  },
                  {
                    key: 'target',
                    label: 'Target',
                    render: r => dash(r.targetName),
                  },
                  {
                    key: 'version',
                    label: 'Version',
                    render: r => dash(r.version),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <StatusChip status={r.status} />,
                  },
                ])}
              </>
            )}
          </>
        )}
      </Content>
    </Page>
  );
}
