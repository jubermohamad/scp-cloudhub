import { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import type { DataExportApi } from '../../api';
import { isGuid } from '../../utils';
import { ApiErrorAlert } from '../common/ApiErrorAlert';

interface Props {
  api: DataExportApi;
  clusterId: string;
  onRegistered: () => void;
}

/** Registers the export agent's workload identity against a cluster. */
export function RegisterAgentForm({ api, clusterId, onRegistered }: Props) {
  const [agentName, setAgentName] = useState('');
  const [identitySubject, setIdentitySubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const subject = identitySubject.trim();
  const invalid = Boolean(subject) && !isGuid(subject);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.registerAgent(clusterId, {
        agentName: agentName.trim() || null,
        identitySubject: subject,
      });
      setAgentName('');
      setIdentitySubject('');
      onRegistered();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">Register agent</Typography>
      <Typography variant="caption" color="text.secondary">
        The agent authenticates with its Azure workload identity. Enter the
        Entra object id of that identity; heartbeats from any other identity are
        rejected.
      </Typography>
      <ApiErrorAlert error={error} />
      <TextField
        size="small"
        label="Agent name"
        placeholder="dx-agent-prod-01"
        value={agentName}
        onChange={event => setAgentName(event.target.value)}
      />
      <TextField
        size="small"
        required
        label="Identity subject (Entra object id)"
        placeholder="00000000-0000-0000-0000-000000000000"
        value={identitySubject}
        error={invalid}
        helperText={invalid ? 'Enter a GUID.' : undefined}
        onChange={event => setIdentitySubject(event.target.value)}
        inputProps={{ style: { fontFamily: 'monospace' } }}
      />
      <Box>
        <Button
          variant="contained"
          size="small"
          disabled={busy || !subject || invalid}
          onClick={submit}
        >
          Register agent
        </Button>
      </Box>
    </Stack>
  );
}
