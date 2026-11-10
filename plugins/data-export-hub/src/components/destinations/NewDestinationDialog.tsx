import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { DataExportApi } from '../../api';
import {
  CREATABLE_DESTINATION_TYPES,
  destinationConfigProblems,
  destinationTypeLabel,
  initialDestinationConfig,
  normaliseDestinationConfig,
} from '../../destinationFields';
import type {
  Destination,
  DestinationTestResult,
  DestinationType,
} from '../../types';
import { ApiErrorAlert } from '../common/ApiErrorAlert';
import { DestinationConfigFields } from './DestinationConfigFields';

interface Props {
  open: boolean;
  api: DataExportApi;
  onClose: () => void;
  onCreated: (destination: Destination) => void;
  /** Tenants the caller administers. */
  tenantOptions: string[];
  /** Platform admins may create shared destinations that every tenant can use. */
  allowShared: boolean;
}

const SHARED = '__shared__';

export function NewDestinationDialog({
  open,
  api,
  onClose,
  onCreated,
  tenantOptions,
  allowShared,
}: Props) {
  const defaultTenant = allowShared ? SHARED : tenantOptions[0] ?? '';
  const [type, setType] = useState<DestinationType>('ADLS_GEN2');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [tenantId, setTenantId] = useState<string>(defaultTenant);
  const [values, setValues] = useState<Record<string, string>>(
    initialDestinationConfig('ADLS_GEN2'),
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DestinationTestResult | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);

  const problems = destinationConfigProblems(type, values);
  const tenantValid = tenantId === SHARED ? allowShared : Boolean(tenantId);
  const problem = !name.trim()
    ? 'Enter a name.'
    : !tenantValid
    ? 'Choose a tenant.'
    : problems[0] ?? null;

  function reset() {
    setType('ADLS_GEN2');
    setName('');
    setOwner('');
    setTenantId(defaultTenant);
    setValues(initialDestinationConfig('ADLS_GEN2'));
    setTestResult(null);
    setError(null);
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(
        await api.testDestination({
          type,
          configuration: normaliseDestinationConfig(type, values),
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const created = await api.createDestination({
        type,
        name: name.trim(),
        configuration: normaliseDestinationConfig(type, values),
        owner: owner.trim() || null,
        tenantId: tenantId === SHARED ? null : tenantId,
      });
      onCreated(created);
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
      aria-labelledby="new-destination-title"
      TransitionProps={{ onEnter: reset }}
    >
      <DialogTitle id="new-destination-title">New destination</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={1}>
          <ApiErrorAlert error={error} />
          <TextField
            label="Name"
            required
            size="small"
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <TextField
            select
            label="Tenant"
            size="small"
            value={tenantId}
            onChange={event => setTenantId(event.target.value)}
            helperText={
              tenantId === SHARED
                ? 'Shared destinations can be used by every tenant; files are still written under tenant/<tenant>/.'
                : 'Only this tenant’s exports can use it.'
            }
          >
            {allowShared && (
              <MenuItem value={SHARED}>Shared (all tenants)</MenuItem>
            )}
            {tenantOptions.map(option => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Type"
            size="small"
            value={type}
            onChange={event => {
              const next = event.target.value as DestinationType;
              setType(next);
              setValues(initialDestinationConfig(next));
              setTestResult(null);
            }}
          >
            {CREATABLE_DESTINATION_TYPES.map(option => (
              <MenuItem key={option} value={option}>
                {destinationTypeLabel(option)}
              </MenuItem>
            ))}
          </TextField>
          <DestinationConfigFields
            type={type}
            values={values}
            onChange={next => {
              setValues(next);
              setTestResult(null);
            }}
            disabled={saving}
          />
          <TextField
            label="Owner"
            size="small"
            value={owner}
            placeholder="team or contact"
            onChange={event => setOwner(event.target.value)}
          />
          {testResult && (
            <Alert
              severity={
                testResult.status === 'HEALTHY'
                  ? 'success'
                  : testResult.status === 'DEGRADED'
                  ? 'warning'
                  : 'error'
              }
            >
              {testResult.message}
            </Alert>
          )}
          {problem && (
            <Typography variant="caption" color="text.secondary">
              {problem}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={test}
          disabled={Boolean(problems.length) || testing || saving}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button onClick={onClose} disabled={saving} sx={{ ml: 'auto' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={Boolean(problem) || saving}
        >
          {saving ? 'Saving…' : 'Create destination'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
