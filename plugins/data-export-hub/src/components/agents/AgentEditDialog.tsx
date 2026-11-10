import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import type { DataExportApi } from '../../api';
import type { Agent } from '../../types';
import { isGuid } from '../../utils';
import { ApiErrorAlert } from '../common/ApiErrorAlert';

interface Props {
  agent: Agent | null;
  api: DataExportApi;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

export function AgentEditDialog({ agent, api, onClose, onSaved }: Props) {
  const [agentName, setAgentName] = useState('');
  const [identitySubject, setIdentitySubject] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const subject = identitySubject.trim();
  const invalid = !isGuid(subject);
  const identityChanged = agent !== null && subject !== agent.identitySubject;

  async function save() {
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateAgent(agent.id, {
        agentName: agentName.trim() || null,
        identitySubject: subject,
      });
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
      open={Boolean(agent)}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="agent-edit-title"
      TransitionProps={{
        onEnter: () => {
          setAgentName(agent?.agentName ?? '');
          setIdentitySubject(agent?.identitySubject ?? '');
          setError(null);
        },
      }}
    >
      <DialogTitle id="agent-edit-title">Edit agent</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={1}>
          <ApiErrorAlert error={error} />
          <TextField
            size="small"
            label="Agent name"
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
          />
          <TextField
            size="small"
            required
            label="Identity subject (Entra object id)"
            value={identitySubject}
            error={Boolean(subject) && invalid}
            helperText={
              Boolean(subject) && invalid ? 'Enter a GUID.' : undefined
            }
            onChange={e => setIdentitySubject(e.target.value)}
            inputProps={{ style: { fontFamily: 'monospace' } }}
          />
          {identityChanged && (
            <Alert severity="warning">
              After saving, the agent is only accepted when it authenticates
              with the new identity. Update the agent’s workload identity first.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={saving || invalid}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
