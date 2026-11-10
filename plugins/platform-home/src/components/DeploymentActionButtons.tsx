/**
 * DeploymentActionButtons — Reusable button set for all deployment workflows.
 *
 * Provides a consistent, neat form of action buttons across all deployment
 * pages: Validate, Update, Generate Config, Cancel, Deploy.
 *
 * This component handles the UI state and button transitions, delegating
 * actual work to caller-supplied callbacks.
 */

import { useState } from 'react';
import { Button, Box, CircularProgress, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, LinearProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PublishIcon from '@mui/icons-material/Publish';
import RefreshIcon from '@mui/icons-material/Refresh';
import BuildIcon from '@mui/icons-material/Build';

export type DeploymentPhase =
  | 'idle'           // Initial state, awaiting user action
  | 'validating'     // Validate in progress
  | 'validated'      // Validation passed
  | 'validation-failed' // Validation failed, ready to retry
  | 'generating'     // Generate Config in progress
  | 'generated'      // Config generated, ready to review or update
  | 'updating'       // Update in progress
  | 'updated'        // Update completed, ready to deploy
  | 'deploying'      // Deploy in progress
  | 'deployed'       // Deploy completed successfully
  | 'deploy-failed'; // Deploy failed, ready to retry

export interface DeploymentActionCallbacks {
  onValidate: () => Promise<void>;
  onGenerateConfig: () => Promise<void>;
  onUpdate: () => Promise<void>;
  onDeploy: () => Promise<void>;
  onCancel: () => void;
}

interface DeploymentActionButtonsProps {
  phase: DeploymentPhase;
  callbacks: DeploymentActionCallbacks;
  disabled?: boolean;
  error?: string | null;
  successMessage?: string | null;
  showProgress?: boolean;
}

const useStyles = makeStyles(theme => ({
  container: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    padding: theme.spacing(2),
    backgroundColor: '#FAFBFC',
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    alignItems: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  successContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    border: '1px solid #10B981',
    width: '100%',
  },
  successText: {
    color: '#059669',
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    border: '1px solid #DC2626',
    width: '100%',
  },
  errorText: {
    color: '#DC2626',
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  progressBar: {
    width: '100%',
    height: 4,
  },
  phaseBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    color: '#6B7280',
    letterSpacing: 0.4,
  },
  phaseSuccess: {
    backgroundColor: '#ECFDF5',
    color: '#059669',
  },
  phaseError: {
    backgroundColor: '#FEF2F2',
    color: '#DC2626',
  },
  button: {
    textTransform: 'none',
    fontWeight: 600,
  },
}));

/**
 * DeploymentActionButtons component
 *
 * Usage:
 * ```tsx
 * <DeploymentActionButtons
 *   phase={deploymentPhase}
 *   callbacks={{
 *     onValidate: async () => { ... },
 *     onGenerateConfig: async () => { ... },
 *     onUpdate: async () => { ... },
 *     onDeploy: async () => { ... },
 *     onCancel: () => { ... },
 *   }}
 *   error={errorMessage}
 *   successMessage={successMsg}
 * />
 * ```
 */
export function DeploymentActionButtons({
  phase,
  callbacks,
  disabled = false,
  error = null,
  successMessage = null,
  showProgress = false,
}: DeploymentActionButtonsProps): JSX.Element {
  const classes = useStyles();
  const [confirmDialog, setConfirmDialog] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const isLoading = [
    'validating',
    'generating',
    'updating',
    'deploying',
  ].includes(phase);

  // Determine which buttons are visible and enabled based on current phase
  // Validates: idle, validation-failed (retry), generated (revalidate), updated (revalidate)
  const canValidate = ['idle', 'validation-failed', 'generated', 'updated'].includes(
    phase,
  );
  // Generate Config: idle (initial), validated (ready), deploy-failed (regenerate from scratch)
  const canGenerateConfig = ['idle', 'validated', 'deploy-failed'].includes(
    phase,
  );
  // Update: generated (edit), updated (re-edit), deploy-failed (fix and retry)
  const canUpdate = ['generated', 'updated', 'deploy-failed'].includes(phase);
  // Deploy: updated (normal path), generated (shortcut), deploy-failed (retry)
  const canDeploy = ['updated', 'generated', 'deploy-failed'].includes(phase);
  // Cancel: anytime except mid-operation (deploying) or after success (deployed)
  const canCancel = !['deploying', 'deployed'].includes(phase);

  const handleAction = async (
    action: keyof DeploymentActionCallbacks,
  ) => {
    try {
      setConfirmDialog(null);
      setWorking(true);
      await callbacks[action]();
    } finally {
      setWorking(false);
    }
  };

  const getPhaseBadgeClass = () => {
    if (['validated', 'generated', 'updated', 'deployed'].includes(phase)) {
      return `${classes.phaseBadge} ${classes.phaseSuccess}`;
    }
    if (['validation-failed', 'deploy-failed'].includes(phase)) {
      return `${classes.phaseBadge} ${classes.phaseError}`;
    }
    return classes.phaseBadge;
  };

  return (
    <>
      <Box className={classes.container}>
        {/* Show error message if present */}
        {error && (
          <Box className={classes.errorContainer}>
            <ErrorIcon style={{ color: '#DC2626' }} />
            <span className={classes.errorText}>{error}</span>
          </Box>
        )}

        {/* Show success message if present */}
        {successMessage && !error && (
          <Box className={classes.successContainer}>
            <CheckCircleIcon style={{ color: '#10B981' }} />
            <span className={classes.successText}>{successMessage}</span>
          </Box>
        )}

        {/* Show progress bar during operations */}
        {showProgress && isLoading && (
          <LinearProgress className={classes.progressBar} />
        )}

        {/* Phase badge and action buttons */}
        <Box
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            width: '100%',
            justifyContent: 'space-between',
          }}
        >
          <span className={getPhaseBadgeClass()}>
            {phase.replace('-', ' ').toUpperCase()}
          </span>

          <Box className={classes.buttonGroup}>
            {/* Validate Button */}
            {canValidate && (
              <Button
                onClick={() => handleAction('onValidate')}
                disabled={disabled || isLoading || working}
                variant={phase === 'idle' ? 'outlined' : 'outlined'}
                size="small"
                className={classes.button}
                startIcon={
                  phase === 'validating' ? (
                    <CircularProgress size={18} />
                  ) : (
                    <CheckCircleIcon />
                  )
                }
              >
                Validate
              </Button>
            )}

            {/* Update Button */}
            {canUpdate && (
              <Button
                onClick={() => handleAction('onUpdate')}
                disabled={disabled || isLoading || working}
                variant="outlined"
                size="small"
                className={classes.button}
                startIcon={
                  phase === 'updating' ? (
                    <CircularProgress size={18} />
                  ) : (
                    <RefreshIcon />
                  )
                }
              >
                Update
              </Button>
            )}

            {/* Generate Config Button */}
            {canGenerateConfig && (
              <Button
                onClick={() => handleAction('onGenerateConfig')}
                disabled={disabled || isLoading || working}
                variant="outlined"
                size="small"
                className={classes.button}
                startIcon={
                  phase === 'generating' ? (
                    <CircularProgress size={18} />
                  ) : (
                    <BuildIcon />
                  )
                }
              >
                Generate Config
              </Button>
            )}

            {/* Cancel Button */}
            {canCancel && (
              <Button
                onClick={() => {
                  if (phase !== 'idle') {
                    setConfirmDialog('cancel');
                  } else {
                    callbacks.onCancel();
                  }
                }}
                disabled={disabled || isLoading || working}
                size="small"
                className={classes.button}
              >
                Cancel
              </Button>
            )}

            {/* Deploy Button */}
            {canDeploy && (
              <Button
                onClick={() => setConfirmDialog('deploy')}
                disabled={disabled || isLoading || working}
                color="primary"
                variant="contained"
                size="small"
                className={classes.button}
                startIcon={
                  phase === 'deploying' ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <PublishIcon />
                  )
                }
              >
                {phase === 'deploying' ? 'Deploying…' : 'Deploy'}
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      {/* Confirm Dialog for Deploy */}
      <Dialog
        open={confirmDialog === 'deploy'}
        onClose={() => setConfirmDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm Deployment</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to deploy this configuration? This action will
            apply changes to your Kubernetes cluster.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmDialog(null)}
            disabled={working}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleAction('onDeploy')}
            disabled={working}
            color="primary"
            variant="contained"
            startIcon={
              working ? <CircularProgress size={18} color="inherit" /> : undefined
            }
          >
            {working ? 'Deploying…' : 'Confirm & Deploy'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Dialog for Cancel */}
      <Dialog
        open={confirmDialog === 'cancel'}
        onClose={() => setConfirmDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Cancel Deployment</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to cancel? Any unsaved changes will be lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>
            Continue
          </Button>
          <Button
            onClick={() => {
              setConfirmDialog(null);
              callbacks.onCancel();
            }}
            color="primary"
          >
            Cancel Deployment
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
