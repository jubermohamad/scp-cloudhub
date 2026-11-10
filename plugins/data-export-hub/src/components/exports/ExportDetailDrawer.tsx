import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  Chip,
  Divider,
  Grid,
  Link,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { destinationTypeLabel } from '../../destinationFields';
import { useAsync } from '../../hooks';
import {
  COMPRESSION_LABELS,
  ENVIRONMENT_LABELS,
  EXPORT_MODE_LABELS,
  FORMAT_LABELS,
  labelFor,
  SCHEDULE_LABELS,
  WATERMARK_STRATEGY_LABELS,
} from '../../labels';
import { hubPaths } from '../../routes';
import type { ExportProfile } from '../../types';
import { formatDateTime } from '../../utils';
import { DetailDrawer } from '../common/DetailDrawer';
import { DetailField } from '../common/DetailField';
import { useHub } from '../common/HubContext';
import { EnabledChip, JobStatusChip } from '../common/StatusChip';

export function executionsForExportPath(
  profile: Pick<ExportProfile, 'id' | 'name'>,
) {
  return `${hubPaths.executions}?${new URLSearchParams({
    exportId: profile.id,
    exportName: profile.name,
  }).toString()}`;
}

export function ExportDetailDrawer({
  profile,
  onClose,
}: {
  profile: ExportProfile | null;
  onClose: () => void;
}) {
  const { api } = useHub();
  const recent = useAsync(
    () =>
      profile
        ? api.listJobs({
            exportId: profile.id,
            pageSize: 5,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          })
        : Promise.resolve(undefined),
    [api, profile?.id],
  );

  return (
    <DetailDrawer
      open={Boolean(profile)}
      onClose={onClose}
      title={profile?.name ?? 'Export'}
      subtitle={
        profile && (
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <EnabledChip enabled={profile.enabled} />
            <span>
              {profile.tenantId} · {ENVIRONMENT_LABELS[profile.environment]}
            </span>
          </Stack>
        )
      }
    >
      {profile && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <DetailField label="Customer">{profile.customerName || profile.tenantId}</DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Export Package">{profile.packageName || profile.packageCode || 'Standard Package'}</DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Tenant">{profile.tenantId}</DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Owner">{profile.ownerId}</DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Created By">{profile.createdBy}</DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Created">
                {formatDateTime(profile.createdAt)}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Next run (UTC schedule)">
                {formatDateTime(profile.nextRunAt)}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Last run">
                {profile.lastRunAt ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{formatDateTime(profile.lastRunAt)}</span>
                    {profile.lastRunStatus && (
                      <JobStatusChip status={profile.lastRunStatus} />
                    )}
                  </Stack>
                ) : (
                  'Never run'
                )}
              </DetailField>
            </Grid>
            <Grid item xs={12}>
              <DetailField label="Placement">
                {profile.clusterName}
                {profile.namespace ? ` · ${profile.namespace}` : ''}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Schedule">
                {SCHEDULE_LABELS[profile.schedule]}
                <Typography
                  variant="caption"
                  display="block"
                  sx={{ fontFamily: 'monospace' }}
                >
                  {profile.cronExpression}
                </Typography>
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Mode">
                {labelFor(EXPORT_MODE_LABELS, profile.exportMode)}
                {profile.exportMode === 'INCREMENTAL' &&
                  profile.watermarkStrategy && (
                    <Typography
                      variant="caption"
                      display="block"
                      color="text.secondary"
                    >
                      {WATERMARK_STRATEGY_LABELS[profile.watermarkStrategy]}
                    </Typography>
                  )}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Format">
                {labelFor(FORMAT_LABELS, profile.fileFormat)} ·{' '}
                {labelFor(COMPRESSION_LABELS, profile.compression)}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Retention">
                {profile.retentionDays === null
                  ? 'None'
                  : `${profile.retentionDays} days`}
              </DetailField>
            </Grid>
            <Grid item xs={12}>
              <DetailField label="Destination">
                {profile.destinationName ?? profile.destinationId}
                {profile.destinationType &&
                  ` · ${destinationTypeLabel(profile.destinationType)}`}
              </DetailField>
            </Grid>
            <Grid item xs={12}>
              <DetailField label="Last updated">
                {formatDateTime(profile.updatedAt)}
              </DetailField>
            </Grid>
          </Grid>

          <Divider />
          <Typography variant="subtitle2">
            Datasets ({profile.datasets.length})
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {profile.datasets.map(dataset => (
              <Chip
                key={dataset.id}
                size="small"
                variant="outlined"
                label={dataset.datasetId}
                title={dataset.displayName}
                component={RouterLink}
                to={hubPaths.datasetDetail(dataset.id)}
                clickable
              />
            ))}
          </Stack>

          <Divider />
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="subtitle2">Recent executions</Typography>
            <Link
              component={RouterLink}
              to={executionsForExportPath(profile)}
              underline="hover"
              variant="body2"
            >
              View all executions
            </Link>
          </Stack>
          {recent.error && <Alert severity="error">{recent.error}</Alert>}
          {recent.loading && !recent.data ? (
            <Skeleton variant="rectangular" height={120} />
          ) : recent.data?.items.length ? (
            <List dense disablePadding>
              {recent.data.items.map(job => (
                <ListItem
                  key={job.id}
                  disableGutters
                  secondaryAction={<JobStatusChip status={job.status} />}
                >
                  <ListItemText
                    primary={job.datasetDisplayName}
                    secondary={formatDateTime(job.createdAt)}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No executions yet.
            </Typography>
          )}
          <Button
            variant="outlined"
            component={RouterLink}
            to={executionsForExportPath(profile)}
          >
            Open execution history
          </Button>
        </>
      )}
    </DetailDrawer>
  );
}
