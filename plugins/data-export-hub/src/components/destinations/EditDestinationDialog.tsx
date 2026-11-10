import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { DataExportApi } from '../../api';
import type { Destination } from '../../types';
import { ApiErrorAlert } from '../common/ApiErrorAlert';

interface Props {
  destination: Destination | null;
  api: DataExportApi;
  onClose: () => void;
  onSaved: (destination: Destination) => void;
}

/** Name and owner are editable; connection settings are fixed after creation. */
export function EditDestinationDialog({
  destination,
  api,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    if (!destination) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateDestination(destination.id, {
        name: name.trim(),
        owner: owner.trim() || null,
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
      open={Boolean(destination)}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="edit-destination-title"
      TransitionProps={{
        onEnter: () => {
          setName(destination?.name ?? '');
          setOwner(destination?.owner ?? '');
          setError(null);
        },
      }}
    >
      <DialogTitle id="edit-destination-title">Edit destination</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={1}>
          <ApiErrorAlert error={error} />
          <TextField
            label="Name"
            size="small"
            required
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <TextField
            label="Owner"
            size="small"
            value={owner}
            onChange={event => setOwner(event.target.value)}
          />
          <Typography variant="caption" color="text.secondary">
            Connection settings are fixed after creation. Create a new
            destination to change them, then point exports at it.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!name.trim() || saving}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
