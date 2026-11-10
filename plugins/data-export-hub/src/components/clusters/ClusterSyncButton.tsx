import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { Link as RouterLink } from 'react-router-dom';
import type { DataExportApi } from '../../api';
import type { ClusterSyncResult } from '../../types';
import { errorMessage, formatDateTime } from '../../utils';
import { KpiCard } from '../common/KpiCard';

/** "Sync from Platform Registry" button plus the dialog that shows its result. */
export function ClusterSyncButton({
  api,
  onSynced,
  variant = 'outlined',
}: {
  api: DataExportApi;
  onSynced?: (result: ClusterSyncResult) => void;
  variant?: 'outlined' | 'contained';
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClusterSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const registryEmpty = result?.skipped.some(
    item => item.clusterName === '*',
  );

  async function sync() {
    setBusy(true);
    setError(null);
    setResult(null);
    setOpen(true);
    try {
      const outcome = await api.syncClusters();
      setResult(outcome);
      onSynced?.(outcome);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        startIcon={<SyncIcon />}
        onClick={sync}
        disabled={busy}
        sx={{ flexShrink: 0 }}
      >
        {busy ? 'Syncing…' : 'Sync from Platform Registry'}
      </Button>
      <Dialog
        open={open}
        onClose={busy ? undefined : () => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="dx-sync-title"
      >
        <DialogTitle id="dx-sync-title">Platform Registry sync</DialogTitle>
        <DialogContent>
          {busy && (
            <Typography color="text.secondary">
              Reading clusters from Platform Registry…
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {result && (
            <>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Ran {formatDateTime(result.ranAt)}
              </Typography>
              {registryEmpty && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Platform Registry has no active clusters to sync. Ensure
                  clusters are discoverable in Platform Registry and retry.
                  <Button
                    component={RouterLink}
                    to="/platform-registry/clusters"
                    size="small"
                    sx={{ ml: 1 }}
                  >
                    Open Platform Registry
                  </Button>
                </Alert>
              )}
              <Grid container spacing={1.5}>
                {(
                  [
                    ['Created', result.created],
                    ['Updated', result.updated],
                    ['Retired', result.retired],
                    ['Restored', result.restored],
                  ] as const
                ).map(([label, value]) => (
                  <Grid item xs={6} sm={3} key={label}>
                    <KpiCard label={label} value={value} />
                  </Grid>
                ))}
              </Grid>
              {result.skipped.filter(item => item.clusterName !== '*').length > 0 && (
                <>
                  <Typography variant="subtitle2" mt={2}>
                    Skipped ({result.skipped.filter(item => item.clusterName !== '*').length})
                  </Typography>
                  <List dense>
                    {result.skipped.filter(item => item.clusterName !== '*').map(item => (
                      <ListItem key={item.clusterName} disableGutters>
                        <ListItemText
                          primary={item.clusterName}
                          secondary={item.reason}
                          primaryTypographyProps={{
                            sx: { fontFamily: 'monospace' },
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
