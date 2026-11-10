/**
 * SendForApprovalButton — Reusable button for deployment approval workflow
 *
 * Integrates with existing backend approval system:
 * - POST /deployments/approvals
 * - GET /deployments/approvals/{id}
 * - Polls for admin decision
 * - Shows approval status
 */

import { useState, useEffect } from 'react';
import {
  Button,
  Box,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { useBackendFetch } from '@internal/plugin-platform-common';

export interface SendForApprovalConfig {
  component: string; // e.g., 'sri-investigation'
  instance: string; // e.g., 'dt-juber-poc'
  helmfile: string; // Generated Helmfile YAML
  config: Record<string, any>; // Deployment config
  notifyEmails?: string[]; // Optional: emails to notify
}

export interface ApprovalStatus {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requesterEmail?: string;
  approverEmail?: string;
  approvedAt?: string;
  rejectedAt?: string;
  reason?: string;
}

interface SendForApprovalButtonProps {
  config: SendForApprovalConfig;
  disabled?: boolean;
  onApprovalSubmitted?: (approvalId: string) => void;
  onApprovalApproved?: () => void;
  onApprovalRejected?: (reason?: string) => void;
}

const useStyles = makeStyles(theme => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  button: {
    textTransform: 'none',
    fontWeight: 600,
  },
  statusBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  pendingBox: {
    backgroundColor: '#FEF3C7',
    border: '1px solid #FBBF24',
  },
  approvedBox: {
    backgroundColor: '#ECFDF5',
    border: '1px solid #10B981',
  },
  rejectedBox: {
    backgroundColor: '#FEF2F2',
    border: '1px solid #DC2626',
  },
  statusText: {
    flex: 1,
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  pendingText: {
    color: '#92400E',
  },
  approvedText: {
    color: '#059669',
  },
  rejectedText: {
    color: '#DC2626',
  },
  previewCode: {
    backgroundColor: '#F3F4F6',
    padding: theme.spacing(1.5),
    borderRadius: 6,
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    maxHeight: 200,
    overflow: 'auto',
    border: '1px solid #E5E7EB',
    color: '#374151',
    lineHeight: 1.4,
  },
}));

/**
 * SendForApprovalButton component
 *
 * Usage:
 * ```tsx
 * <SendForApprovalButton
 *   config={{
 *     component: 'sri-investigation',
 *     instance: 'dt-juber-poc',
 *     helmfile: renderedHelmfile,
 *     config: deploymentConfig,
 *   }}
 *   disabled={!isReady}
 *   onApprovalSubmitted={(id) => console.log('Approval submitted:', id)}
 *   onApprovalApproved={() => console.log('Approved!')}
 *   onApprovalRejected={(reason) => console.log('Rejected:', reason)}
 * />
 * ```
 */
export function SendForApprovalButton({
  config,
  disabled = false,
  onApprovalSubmitted,
  onApprovalApproved,
  onApprovalRejected,
}: SendForApprovalButtonProps): JSX.Element {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll for approval decision
  useEffect(() => {
    if (!pollingActive || !approvalId) {
      return undefined;
    }

    const pollForStatus = async () => {
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          `/deployments/approvals/${approvalId}`,
          {
            method: 'GET',
          },
        );

        if (!response.ok) {
          throw new Error('Failed to check approval status');
        }

        const data: ApprovalStatus = await response.json();
        setApprovalStatus(data);

        if (data.status === 'APPROVED') {
          setPollingActive(false);
          onApprovalApproved?.();
        } else if (data.status === 'REJECTED') {
          setPollingActive(false);
          onApprovalRejected?.(data.reason);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Approval status check failed',
        );
      }
    };

    void pollForStatus();

    const pollIntervalMs = process.env.NODE_ENV === 'test' ? 200 : 15000;
    const interval = setInterval(() => {
      void pollForStatus();
    }, pollIntervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [pollingActive, approvalId, backendFetch, onApprovalApproved, onApprovalRejected]);

  const handleSendForApproval = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/deployments/approvals',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: config.component,
            instance: config.instance,
            helmfile: config.helmfile,
            config: config.config,
            notifyEmails: config.notifyEmails,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || 'Failed to submit for approval',
        );
      }

      const data = await response.json();
      setApprovalId(data.id);
      setApprovalStatus({
        id: data.id,
        status: 'PENDING',
        requesterEmail: data.requesterEmail,
      });
      setPollingActive(true);
      onApprovalSubmitted?.(data.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <HourglassEmptyIcon style={{ color: '#F59E0B' }} />;
      case 'APPROVED':
        return <CheckCircleIcon style={{ color: '#10B981' }} />;
      case 'REJECTED':
        return <ErrorIcon style={{ color: '#DC2626' }} />;
      default:
        return null;
    }
  };

  const getStatusMessage = (status: ApprovalStatus) => {
    switch (status.status) {
      case 'PENDING':
        return `⏳ Waiting for approval from GRP-CloudHub-PlatformAdmin (submitted at ${new Date().toLocaleTimeString()})`;
      case 'APPROVED':
        return `✅ Approved by ${status.approverEmail || 'admin'} — You can now deploy!`;
      case 'REJECTED':
        return `❌ Rejected${status.reason ? `: ${status.reason}` : ''}`;
      default:
        return status.status;
    }
  };

  if (approvalStatus) {
    const statusClass =
      {
        PENDING: classes.pendingBox,
        APPROVED: classes.approvedBox,
        REJECTED: classes.rejectedBox,
      }[approvalStatus.status] || classes.pendingBox;

    const textClass =
      {
        PENDING: classes.pendingText,
        APPROVED: classes.approvedText,
        REJECTED: classes.rejectedText,
      }[approvalStatus.status] || classes.pendingText;

    return (
      <Box className={`${classes.statusBox} ${statusClass}`}>
        {approvalStatus.status === 'PENDING' && (
          <CircularProgress size={20} />
        )}
        {approvalStatus.status !== 'PENDING' &&
          getStatusIcon(approvalStatus.status)}
        <Typography className={`${classes.statusText} ${textClass}`}>
          {getStatusMessage(approvalStatus)}
        </Typography>
        {approvalStatus.status === 'REJECTED' && (
          <Button
            size="small"
            onClick={() => {
              setApprovalId(null);
              setApprovalStatus(null);
              setPollingActive(false);
            }}
          >
            Clear
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box className={classes.container}>
      {error && (
        <Box
          style={{
            padding: '8px 12px',
            backgroundColor: '#FEF2F2',
            borderRadius: 6,
            border: '1px solid #DC2626',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ErrorIcon style={{ color: '#DC2626', fontSize: 18 }} />
          <Typography style={{ color: '#DC2626', fontSize: '0.9rem' }}>
            {error}
          </Typography>
        </Box>
      )}

      <Box style={{ display: 'flex', gap: 8 }}>
        <Button
          onClick={handleSendForApproval}
          disabled={disabled || loading}
          variant="contained"
          color="primary"
          className={classes.button}
          startIcon={
            loading ? <CircularProgress size={18} color="inherit" /> : <SendIcon />
          }
          fullWidth
        >
          {loading ? 'Submitting…' : 'Send For Approval'}
        </Button>

        <Button
          onClick={() => setPreviewOpen(true)}
          disabled={disabled || loading}
          variant="outlined"
          size="small"
          className={classes.button}
        >
          Preview Helmfile
        </Button>
      </Box>

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Helmfile Preview</DialogTitle>
        <DialogContent>
          <Box style={{ marginBottom: 16 }}>
            <Typography variant="body2" color="textSecondary">
              This is the Helmfile that will be submitted for approval:
            </Typography>
          </Box>
          <Box className={classes.previewCode}>
            {config.helmfile}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
