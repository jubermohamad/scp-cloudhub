import { useState } from 'react';
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import type { DataExportApi } from '../../api';
import { ENVIRONMENT_LABELS, optionsFrom } from '../../labels';
import type {
  Cluster,
  ClusterDetail,
  ClusterInput,
  Environment,
} from '../../types';
import { ApiErrorAlert } from '../common/ApiErrorAlert';

interface Props {
  open: boolean;
  api: DataExportApi;
  /** Edits this cluster when set (unmanaged clusters only). */
  cluster?: Cluster;
  tenantSuggestions: string[];
  onClose: () => void;
  onSaved: (cluster: ClusterDetail) => void;
}

const EMPTY: ClusterInput = {
  clusterName: '',
  subscriptionId: null,
  resourceGroup: null,
  environment: 'PRODUCTION',
  region: null,
  tenantId: '',
};

const TENANT_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function clusterFormProblem(form: ClusterInput): string | null {
  if (!form.clusterName.trim()) return 'Enter the cluster name.';
  const tenant = form.tenantId.trim().toLowerCase();
  if (!tenant) return 'Enter the tenant.';
  if (!TENANT_PATTERN.test(tenant))
    return 'Tenant must be a lower-case slug, e.g. visa.';
  return null;
}

export function ClusterFormDialog({
  open,
  api,
  cluster,
  tenantSuggestions,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<ClusterInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problem = clusterFormProblem(form);
  const set = (patch: Partial<ClusterInput>) =>
    setForm(current => ({ ...current, ...patch }));
  const optional = (value: string) => (value.trim() ? value.trim() : null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: ClusterInput = {
        ...form,
        clusterName: form.clusterName.trim(),
        tenantId: form.tenantId.trim().toLowerCase(),
        region: optional(form.region ?? ''),
        subscriptionId: optional(form.subscriptionId ?? ''),
        resourceGroup: optional(form.resourceGroup ?? ''),
      };
      const saved = cluster
        ? await api.updateCluster(cluster.id, body)
        : await api.createCluster(body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="cluster-form-title"
      TransitionProps={{
        onEnter: () => {
          setError(null);
          setForm(
            cluster
              ? {
                  clusterName: cluster.clusterName,
                  subscriptionId: cluster.subscriptionId,
                  resourceGroup: cluster.resourceGroup,
                  environment: cluster.environment,
                  region: cluster.region,
                  tenantId: cluster.tenantId,
                }
              : EMPTY,
          );
        },
      }}
    >
      <DialogTitle id="cluster-form-title">
        {cluster ? 'Edit cluster' : 'Register cluster'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={1}>
          <ApiErrorAlert error={error} />
          <TextField
            label="Cluster name"
            required
            size="small"
            value={form.clusterName}
            onChange={e => set({ clusterName: e.target.value })}
          />
          <Autocomplete
            freeSolo
            options={tenantSuggestions}
            inputValue={form.tenantId}
            onInputChange={(_e, value) => set({ tenantId: value })}
            renderInput={params => (
              <TextField
                {...params}
                label="Tenant"
                required
                size="small"
                helperText="Lower-case tenant slug, e.g. visa. Must match the tenant's Entra group names."
              />
            )}
          />
          <TextField
            select
            label="Environment"
            size="small"
            value={form.environment}
            onChange={e => set({ environment: e.target.value as Environment })}
          >
            {optionsFrom(ENVIRONMENT_LABELS).map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Region"
            size="small"
            placeholder="westeurope"
            value={form.region ?? ''}
            onChange={e => set({ region: e.target.value })}
          />
          <TextField
            label="Subscription ID"
            size="small"
            value={form.subscriptionId ?? ''}
            onChange={e => set({ subscriptionId: e.target.value })}
          />
          <TextField
            label="Resource group"
            size="small"
            value={form.resourceGroup ?? ''}
            onChange={e => set({ resourceGroup: e.target.value })}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || Boolean(problem)}
        >
          {saving ? 'Saving…' : cluster ? 'Save changes' : 'Register'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
