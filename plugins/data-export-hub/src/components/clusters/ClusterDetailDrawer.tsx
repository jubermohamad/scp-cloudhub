import { Link as RouterLink } from 'react-router-dom';
import { useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Grid,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useAsync } from '../../hooks';
import { ENVIRONMENT_LABELS } from '../../labels';
import { hubPaths } from '../../routes';
import type { Cluster } from '../../types';
import { formatDateTime, formatRelative } from '../../utils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DetailDrawer } from '../common/DetailDrawer';
import { DetailField } from '../common/DetailField';
import { useHub } from '../common/HubContext';
import { HealthChip, StatusChip } from '../common/StatusChip';
import { useActionRunner } from '../common/useActionRunner';
import type { ToastSeverity } from '../common/useToast';
import { ClusterFormDialog } from './ClusterFormDialog';
import { RegisterAgentForm } from './RegisterAgentForm';

export const MANAGED_CLUSTER_EXPLANATION =
  'This cluster is synchronised from Platform Registry, which is the source of truth for its name, tenant, environment and lifecycle. It is read-only here; change it in Platform Registry and run a sync. Local edits would be overwritten by the next sync.';

interface Props {
  clusterId: string | null;
  onClose: () => void;
  onChanged: () => void;
  showToast: (severity: ToastSeverity, message: string) => void;
}

export function ClusterDetailDrawer({
  clusterId,
  onClose,
  onChanged,
  showToast,
}: Props) {
  const { api, isPlatformAdmin, filterOptions } = useHub();
  const detail = useAsync(
    () => (clusterId ? api.getCluster(clusterId) : Promise.resolve(undefined)),
    [api, clusterId],
  );
  const { busyKey, run } = useActionRunner(showToast);
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const cluster =
    detail.data && detail.data.id === clusterId ? detail.data : undefined;
  const managed = Boolean(cluster?.platformRegistryId);
  const canEdit = isPlatformAdmin && cluster && !managed;

  const refresh = () => {
    detail.reload({ silent: true });
    onChanged();
  };

  const toggleRetired = async (target: Cluster) => {
    await run(
      target.id,
      () =>
        target.isRetired
          ? api.restoreCluster(target.id)
          : api.retireCluster(target.id),
      `${target.isRetired ? 'Restored' : 'Retired'} ${target.clusterName}`,
    );
    setRetiring(false);
    refresh();
  };

  return (
    <DetailDrawer
      open={Boolean(clusterId)}
      onClose={onClose}
      title={
        <span style={{ fontFamily: 'monospace' }}>
          {cluster?.clusterName ?? 'Cluster'}
        </span>
      }
      subtitle={
        cluster && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            mt={0.5}
            flexWrap="wrap"
            useFlexGap
          >
            <HealthChip health={cluster.health} />
            {managed && (
              <StatusChip
                label="Platform Registry"
                tone="info"
                variant="outlined"
              />
            )}
            {cluster.isRetired && <StatusChip label="Retired" tone="default" />}
            <span>
              {cluster.tenantId} · {ENVIRONMENT_LABELS[cluster.environment]}
              {cluster.region ? ` · ${cluster.region}` : ''}
            </span>
          </Stack>
        )
      }
    >
      {detail.error && <Alert severity="error">{detail.error}</Alert>}
      {!cluster && detail.loading && (
        <Skeleton variant="rectangular" height={240} />
      )}
      {cluster && (
        <>
          {managed && (
            <Alert severity="info">{MANAGED_CLUSTER_EXPLANATION}</Alert>
          )}

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <DetailField label="Last heartbeat">
                {cluster.lastHeartbeat
                  ? `${formatRelative(cluster.lastHeartbeat)} (${formatDateTime(
                      cluster.lastHeartbeat,
                    )})`
                  : 'Never'}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Agent version">
                {cluster.agentVersion}
              </DetailField>
            </Grid>
            <Grid item xs={12}>
              <DetailField label="Subscription" mono>
                {cluster.subscriptionId}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Resource group">
                {cluster.resourceGroup}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Registered">
                {formatDateTime(cluster.createdAt)}
              </DetailField>
            </Grid>
            {managed && (
              <>
                <Grid item xs={6}>
                  <DetailField label="Platform Registry id" mono>
                    {cluster.platformRegistryId}
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Last synced">
                    {formatDateTime(cluster.lastSyncedAt)}
                  </DetailField>
                </Grid>
              </>
            )}
            {cluster.isRetired && (
              <Grid item xs={6}>
                <DetailField label="Retired">
                  {formatDateTime(cluster.retiredAt)}
                </DetailField>
              </Grid>
            )}
            <Grid item xs={6}>
              <DetailField label="Updated">
                {formatDateTime(cluster.updatedAt)}
              </DetailField>
            </Grid>
          </Grid>

          {canEdit && (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setEditing(true)}
              >
                Edit cluster
              </Button>
              <Button
                variant="outlined"
                size="small"
                color={cluster.isRetired ? 'primary' : 'warning'}
                disabled={busyKey !== null}
                onClick={() =>
                  cluster.isRetired ? toggleRetired(cluster) : setRetiring(true)
                }
              >
                {cluster.isRetired ? 'Restore cluster' : 'Retire cluster'}
              </Button>
            </Stack>
          )}

          <Divider />
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="subtitle2">
              Agents ({cluster.agents.length})
            </Typography>
            <Link
              component={RouterLink}
              to={`${hubPaths.agents}?clusterId=${encodeURIComponent(
                cluster.id,
              )}`}
              underline="hover"
              variant="body2"
            >
              Open in Agents
            </Link>
          </Stack>
          {cluster.agents.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No export agent registered. Exports targeting this cluster stay
              queued until an agent is registered and sends heartbeats.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {cluster.agents.map(agent => (
                <Paper key={agent.id} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    spacing={1}
                  >
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {agent.agentName ?? 'Unnamed agent'}
                      {agent.agentVersion ? ` · v${agent.agentVersion}` : ''}
                    </Typography>
                    <HealthChip health={agent.health} />
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ fontFamily: 'monospace' }}
                  >
                    {agent.identitySubject}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    Last seen {formatRelative(agent.lastSeen)} · reported{' '}
                    {agent.reportedStatus.toLowerCase()}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          )}

          {isPlatformAdmin && !cluster.isRetired && (
            <>
              <Divider />
              <RegisterAgentForm
                api={api}
                clusterId={cluster.id}
                onRegistered={() => {
                  showToast('success', 'Agent registered');
                  refresh();
                }}
              />
            </>
          )}

          <ClusterFormDialog
            open={editing}
            api={api}
            cluster={cluster}
            tenantSuggestions={filterOptions.tenants}
            onClose={() => setEditing(false)}
            onSaved={saved => {
              showToast('success', `Saved ${saved.clusterName}`);
              refresh();
            }}
          />
          <ConfirmDialog
            open={retiring}
            title="Retire cluster?"
            confirmLabel="Retire"
            destructive
            busy={busyKey !== null}
            onClose={() => setRetiring(false)}
            onConfirm={() => toggleRetired(cluster)}
          >
            {cluster.clusterName} will no longer be offered for new exports.
            Clusters are never deleted; you can restore it later.
          </ConfirmDialog>
        </>
      )}
    </DetailDrawer>
  );
}
