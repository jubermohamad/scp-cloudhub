import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Grid,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAsync, useInterval } from '../../hooks';
import { destinationTypeLabel } from '../../destinationFields';
import { hubPaths } from '../../routes';
import {
  formatBytes,
  formatCompact,
  formatCount,
  formatDateTime,
  startOfTodayIso,
} from '../../utils';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { KpiCard } from '../common/KpiCard';
import { BreakdownItem, CountBreakdown } from './CountBreakdown';
import { QueueDepthChart } from './QueueDepthChart';
import { TopTable } from './TopTable';
import { Widget } from './Widget';

const REFRESH_MS = 60_000;

export function DashboardPage() {
  return (
    <HubLayout
      label="Dashboard"
      title="Data Export Dashboard"
      subtitle="Monitor export operations, data delivery, and connected infrastructure."
      showSectionTabs={false}
    >
      <DashboardContent />
    </HubLayout>
  );
}

function executionsLink(params: Record<string, string>): string {
  return `${hubPaths.executions}?${new URLSearchParams(params).toString()}`;
}

function DashboardContent() {
  const { api } = useHub();
  const dashboard = useAsync(() => api.dashboard(), [api]);
  useInterval(() => dashboard.reload({ silent: true }), REFRESH_MS);

  const d = dashboard.data;
  const k = d?.kpis;
  const loading = dashboard.loading && !d;
  const today = startOfTodayIso();

  const kpis: Array<{
    label: string;
    value: number | string | undefined;
    caption?: string;
    tone?: 'success' | 'error' | 'info' | 'warning';
    to?: string;
  }> = [
    {
      label: 'Healthy Clusters',
      value: k ? `${k.healthyClusters} / ${k.registeredClusters}` : undefined,
      caption: 'healthy / registered',
      tone:
        k && k.registeredClusters > 0
          ? k.healthyClusters === k.registeredClusters
            ? 'success'
            : 'warning'
          : undefined,
      to: hubPaths.clusters,
    },
    {
      label: 'Connected Agents',
      value: k?.connectedAgents,
      caption: k
        ? `of ${k.registeredAgents.toLocaleString()} registered`
        : undefined,
      to: hubPaths.agents,
    },
    {
      label: 'Configured Exports',
      value: k?.configuredExports,
      to: hubPaths.exports,
    },
    {
      label: 'Running Exports',
      value: k?.runningExports,
      tone: 'info',
      to: executionsLink({ status: 'RUNNING' }),
    },
    {
      label: 'Queued Jobs',
      value: k?.queuedJobs,
      tone: k && k.queuedJobs > 0 ? 'warning' : undefined,
      to: executionsLink({ status: 'QUEUED' }),
    },
    {
      label: 'Completed Jobs Today',
      value: k?.completedJobsToday,
      tone: 'success',
      to: executionsLink({ status: 'COMPLETED', from: today }),
    },
    {
      label: 'Failed Jobs Today',
      value: k?.failedJobsToday,
      tone: k && k.failedJobsToday > 0 ? 'error' : undefined,
      to: executionsLink({ status: 'FAILED', from: today }),
    },
    {
      label: 'Datasets Published',
      value: k?.datasetsPublished,
      to: hubPaths.datasets,
    },
    {
      label: 'Destinations Configured',
      value: k?.destinationsConfigured,
      to: hubPaths.destinations,
    },
    {
      label: 'Data Exported Today',
      value: k ? formatBytes(k.bytesExportedToday) : undefined,
      caption: k ? `${formatCompact(k.rowsExportedToday)} rows` : undefined,
    },
  ];

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={1}
      >
        <Typography variant="body2" color="text.secondary">
          {d
            ? `Updated ${formatDateTime(
                d.generatedAt,
              )} · refreshes every minute`
            : 'Operational overview of clusters, agents and export jobs.'}
        </Typography>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={() => dashboard.reload()}
          disabled={dashboard.loading}
        >
          Refresh
        </Button>
      </Stack>

      {dashboard.error && (
        <Alert severity="error">
          Unable to load the dashboard: {dashboard.error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {kpis.map(kpi => (
          <Grid item xs={12} sm={6} md={4} lg={12 / 5} key={kpi.label}>
            <KpiCard {...kpi} loading={loading} />
          </Grid>
        ))}
      </Grid>

      {d && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6} lg={4}>
            <Widget title="Cluster Health" subheader="From agent heartbeat age">
              <CountBreakdown
                items={(
                  [
                    {
                      label: 'Healthy',
                      value: d.clusterHealth.HEALTHY,
                      tone: 'success',
                    },
                    {
                      label: 'Warning',
                      value: d.clusterHealth.WARNING,
                      tone: 'warning',
                    },
                    {
                      label: 'Critical',
                      value: d.clusterHealth.CRITICAL,
                      tone: 'error',
                    },
                    {
                      label: 'Offline',
                      value: d.clusterHealth.OFFLINE,
                      tone: 'default',
                    },
                  ] as BreakdownItem[]
                ).map(item => ({
                  ...item,
                  to: `${hubPaths.clusters}?status=${item.label.toUpperCase()}`,
                }))}
              />
            </Widget>
          </Grid>
          <Grid item xs={12} md={6} lg={4}>
            <Widget title="Execution Activity" subheader="Jobs created today">
              <CountBreakdown
                items={[
                  {
                    label: 'Completed',
                    value: d.executionActivity.COMPLETED,
                    tone: 'success',
                    to: executionsLink({ status: 'COMPLETED', from: today }),
                  },
                  {
                    label: 'Running',
                    value: d.executionActivity.RUNNING,
                    tone: 'info',
                    to: executionsLink({ status: 'RUNNING', from: today }),
                  },
                  {
                    label: 'Queued',
                    value: d.executionActivity.QUEUED,
                    tone: 'warning',
                    to: executionsLink({ status: 'QUEUED', from: today }),
                  },
                  {
                    label: 'Failed',
                    value: d.executionActivity.FAILED,
                    tone: 'error',
                    to: executionsLink({ status: 'FAILED', from: today }),
                  },
                ]}
              />
            </Widget>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Widget title="Queue Depth" subheader="Queued jobs, last 24 hours">
              <QueueDepthChart samples={d.queueDepth} />
            </Widget>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Widget
              title="Top Datasets"
              subheader={`Last ${d.windowDays} days`}
            >
              <TopTable
                ariaLabel="Top datasets"
                rows={d.topDatasets}
                rowKey={row => row.id}
                empty="No dataset executions yet."
                columns={[
                  {
                    label: 'Dataset',
                    render: row => (
                      <Box minWidth={0}>
                        <Link
                          component={RouterLink}
                          to={hubPaths.datasetDetail(row.id)}
                          underline="hover"
                        >
                          {row.displayName}
                        </Link>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {row.datasetId}
                        </Typography>
                      </Box>
                    ),
                  },
                  {
                    label: 'Executions',
                    numeric: true,
                    render: row => formatCount(row.executionCount),
                  },
                  {
                    label: 'Rows',
                    numeric: true,
                    render: row => formatCompact(row.rowsExported),
                  },
                ]}
              />
            </Widget>
          </Grid>
          <Grid item xs={12} md={6} lg={4}>
            <Widget title="Top Tenants" subheader={`Last ${d.windowDays} days`}>
              <TopTable
                ariaLabel="Top tenants"
                rows={d.topTenants}
                rowKey={row => row.tenantId}
                empty="No tenant exports yet."
                columns={[
                  {
                    label: 'Tenant',
                    render: row => (
                      <Link
                        component={RouterLink}
                        to={`${hubPaths.exports}?tenantId=${encodeURIComponent(
                          row.tenantId,
                        )}`}
                        underline="hover"
                      >
                        {row.tenantId}
                      </Link>
                    ),
                  },
                  {
                    label: 'Exports',
                    numeric: true,
                    render: row => formatCount(row.exports),
                  },
                  {
                    label: 'Data Exported',
                    numeric: true,
                    render: row => formatBytes(row.bytesExported),
                  },
                ]}
              />
            </Widget>
          </Grid>
          <Grid item xs={12} md={6} lg={4}>
            <Widget
              title="Top Destinations"
              subheader={`Last ${d.windowDays} days`}
            >
              <TopTable
                ariaLabel="Top destinations"
                rows={d.topDestinations}
                rowKey={row => row.id}
                empty="No files delivered yet."
                columns={[
                  {
                    label: 'Destination',
                    render: row => (
                      <Box minWidth={0}>
                        {row.name}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          {destinationTypeLabel(row.type)}
                        </Typography>
                      </Box>
                    ),
                  },
                  {
                    label: 'Files Delivered',
                    numeric: true,
                    render: row => formatCount(row.filesDelivered),
                  },
                ]}
              />
            </Widget>
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}
