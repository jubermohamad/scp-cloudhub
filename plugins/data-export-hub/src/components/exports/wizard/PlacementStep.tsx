import { MenuItem, Stack, TextField } from '@mui/material';
import { useAsync } from '../../../hooks';
import { ENVIRONMENT_LABELS, optionsFrom } from '../../../labels';
import type { Environment } from '../../../types';
import { HealthChip } from '../../common/StatusChip';
import type { StepProps } from './types';

const ENVIRONMENTS = optionsFrom(ENVIRONMENT_LABELS);

/** Name, environment, tenant, registered cluster and namespace. */
export function PlacementStep({
  form,
  update,
  api,
  tenantOptions,
}: StepProps & { tenantOptions: string[] }) {
  const clusters = useAsync(
    () =>
      form.tenantId
        ? api.listClusters({
            tenantId: form.tenantId,
            environment: form.environment,
            pageSize: 100,
            sortBy: 'clusterName',
            sortOrder: 'asc',
          })
        : Promise.resolve(undefined),
    [api, form.tenantId, form.environment],
  );
  const available = clusters.data?.items ?? [];
  // Keep the saved cluster selectable while the list loads (edit mode).
  const showSaved =
    form.clusterId && !available.some(cluster => cluster.id === form.clusterId);

  return (
    <Stack spacing={2}>
      <TextField
        label="Export name"
        required
        size="small"
        value={form.name}
        onChange={e => update({ name: e.target.value })}
        inputProps={{ maxLength: 120 }}
      />
      <TextField
        select
        label="Environment"
        size="small"
        value={form.environment}
        onChange={e =>
          update({
            environment: e.target.value as Environment,
            clusterId: '',
            clusterLabel: '',
          })
        }
      >
        {ENVIRONMENTS.map(option => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Tenant"
        required
        size="small"
        value={form.tenantId}
        onChange={e =>
          update({
            tenantId: e.target.value,
            clusterId: '',
            clusterLabel: '',
            destinationId: '',
            destinationLabel: '',
          })
        }
        helperText={
          tenantOptions.length === 0
            ? 'You do not administer any tenant.'
            : 'Tenants you administer.'
        }
      >
        {tenantOptions.map(option => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Cluster"
        required
        size="small"
        value={form.clusterId}
        disabled={!form.tenantId}
        onChange={e => {
          const cluster = available.find(item => item.id === e.target.value);
          update({
            clusterId: e.target.value,
            clusterLabel: cluster?.clusterName ?? '',
          });
        }}
        error={Boolean(clusters.error)}
        helperText={
          clusters.error
            ? `Unable to load clusters: ${clusters.error}`
            : clusters.loading && form.tenantId
            ? 'Loading clusters…'
            : form.tenantId && available.length === 0
            ? `No ${
                ENVIRONMENT_LABELS[form.environment]
              } cluster is registered for ${
                form.tenantId
              }. Ask a platform admin to register one.`
            : 'Only active clusters registered for this tenant and environment are listed.'
        }
      >
        {showSaved && (
          <MenuItem value={form.clusterId}>
            {form.clusterLabel || form.clusterId}
          </MenuItem>
        )}
        {available.map(cluster => (
          <MenuItem key={cluster.id} value={cluster.id}>
            <Stack direction="row" spacing={1} alignItems="center" width="100%">
              <span>
                {cluster.clusterName}
                {cluster.region ? ` · ${cluster.region}` : ''}
              </span>
              <span style={{ flex: 1 }} />
              <HealthChip health={cluster.health} />
            </Stack>
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Namespace"
        size="small"
        value={form.namespace}
        placeholder="netreveal"
        helperText="Optional. Kubernetes namespace the agent reads from."
        onChange={e => update({ namespace: e.target.value })}
      />
    </Stack>
  );
}
