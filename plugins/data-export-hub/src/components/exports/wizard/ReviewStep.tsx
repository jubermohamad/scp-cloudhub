import { Divider, Paper, Stack, Typography } from '@mui/material';
import type { DataExportApi } from '../../../api';
import {
  retentionDaysFrom,
  scheduleSummary,
  WizardForm,
} from '../../../exportWizardModel';
import { useAsync } from '../../../hooks';
import {
  SCHEDULE_LABELS,
} from '../../../labels';

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }} alignItems="flex-start">
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 200, fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word', fontWeight: 500 }}>
        {value || '—'}
      </Typography>
    </Stack>
  );
}

export function ReviewStep({
  form,
  api,
}: {
  form: WizardForm;
  api: DataExportApi;
}) {
  const runtime = useAsync(() => api.runtimeConfig(), [api]);
  const retention = retentionDaysFrom(form);
  const storage = runtime.data?.storage;
  const storageLabel = storage?.accountName || 'configured-storage-account';
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Review the NetReveal export configuration below before creating the
        export profile.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <ReviewRow
            label="Customer"
            value={`${form.customerName || form.tenantId} (${form.tenantId})`}
          />
          <ReviewRow
            label="Production AKS Cluster"
            value={`${form.clusterLabel || form.clusterId} (PROD)`}
          />
          <ReviewRow
            label="Export Package"
            value={`${form.packageName || form.packageCodes.join(', ') || form.packageCode}`}
          />
          <ReviewRow
            label="Schedule"
            value={scheduleSummary(form, SCHEDULE_LABELS)}
          />
          <Divider sx={{ my: 0.5 }} />
          <ReviewRow
            label="Output Format"
            value="TSV files packaged in export.zip + manifest.json + checksums.sha256"
          />
          <ReviewRow
            label="Azure Storage Destination"
            value={`Container "${form.tenantId}" in ${storageLabel}`}
          />
          <ReviewRow
            label="Storage Account Resource ID"
            value={
              storage?.resourceId ||
              'Not configured (set CLOUDHUB_DATA_EXPORT_STORAGE_ACCOUNT_RESOURCE_ID)'
            }
          />
          <ReviewRow
            label="Storage Access Client ID"
            value={
              storage?.clientId ||
              'Not configured (set CLOUDHUB_DATA_EXPORT_STORAGE_CLIENT_ID)'
            }
          />
          <ReviewRow
            label="Storage Output Path"
            value={`/exports/yyyy/mm/dd/${form.packageCodes.length > 1 ? 'multi-package' : form.packageCode || 'package'}/export.zip`}
          />
          <ReviewRow
            label="Database Source"
            value={`postgres-ro.${form.namespace || 'nrod'}.svc:5432 (Transaction Read-Only Guardrails Enforced)`}
          />
          <ReviewRow
            label="Retention"
            value={retention === null ? 'None' : `${retention} days`}
          />
        </Stack>
      </Paper>
    </Stack>
  );
}
