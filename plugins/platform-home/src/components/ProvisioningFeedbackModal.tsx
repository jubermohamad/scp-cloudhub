import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import type { PortalSecretProvisionStatusView } from './deploymentPortalTypes';

const useStyles = makeStyles(theme => ({
  root: {
    '& .MuiDialog-paper': {
      maxWidth: 800,
      width: '100%',
    },
  },
  dialogTitle: {
    backgroundColor: '#F3F4F6',
    borderBottom: '1px solid #E5E7EB',
    paddingBottom: 12,
  },
  loadingHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1, 0, 2),
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    border: '1px solid #FCA5A5',
    borderRadius: 8,
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  successBox: {
    backgroundColor: '#DCFCE7',
    border: '1px solid #86EFAC',
    borderRadius: 8,
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  warningBox: {
    backgroundColor: '#FEF08A',
    border: '1px solid #FBBF24',
    borderRadius: 8,
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  metricCard: {
    textAlign: 'center',
    padding: theme.spacing(2),
    borderRadius: 8,
    border: '1px solid #E5E7EB',
  },
  metricValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginTop: theme.spacing(1),
  },
  liveLog: {
    backgroundColor: '#1F2937',
    color: '#E5E7EB',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    padding: theme.spacing(1.5),
    borderRadius: 4,
    maxHeight: 260,
    overflowY: 'auto',
    marginTop: theme.spacing(1),
  },
  logEntry: {
    display: 'flex',
    gap: theme.spacing(1),
    marginBottom: 4,
    '&.success': { color: '#10B981' },
    '&.failed': { color: '#EF4444' },
    '&.warning': { color: '#FBBF24' },
    '&.info': { color: '#60A5FA' },
  },
  logTimestamp: {
    color: '#6B7280',
    minWidth: '70px',
    flexShrink: 0,
  },
  logStep: {
    fontWeight: 600,
    minWidth: '80px',
    flexShrink: 0,
  },
  verifiedRow: {
    '&.verified': { color: '#166534' },
    '&.unverified': { color: '#92400E' },
  },
}));

interface ExecutionLog {
  step: string;
  status: 'SUCCESS' | 'FAILED' | 'INFO' | 'WARNING';
  detail: string;
  timestamp: string;
}

interface ProvisioningFeedbackModalProps {
  open: boolean;
  isLoading: boolean;
  logs: ExecutionLog[];
  report: PortalSecretProvisionStatusView | null;
  error: string | null;
  onClose: () => void;
  onOpenSecretEditor?: (customer: string, section: string) => void;
  onProceedToDeploy?: () => void;
}

function logClass(status: ExecutionLog['status']): string {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED') return 'failed';
  if (status === 'WARNING') return 'warning';
  return 'info';
}

export function ProvisioningFeedbackModal({
  open,
  isLoading,
  logs,
  report,
  error,
  onClose,
  onOpenSecretEditor,
  onProceedToDeploy,
}: ProvisioningFeedbackModalProps): JSX.Element {
  const classes = useStyles();
  const [showVerification, setShowVerification] = useState(true);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  const readiness = report?.readiness ?? null;
  const totalFields = readiness?.referencesDiscovered ?? 0;
  const missingFieldsRemaining = readiness?.missing.length ?? 0;
  const placeholdersRemaining = readiness?.placeholders.length ?? 0;
  const base64CertsNeeded = readiness?.filePlaceholders.length ?? 0;
  const actionRequiredCount = missingFieldsRemaining + placeholdersRemaining;
  const verifiedFields = report?.verifiedFields ?? [];
  const generatedCount = verifiedFields.length || report?.fieldsGenerated.length || 0;
  const allVerified = verifiedFields.length > 0 && verifiedFields.every(f => f.verified);
  const someUnverified = verifiedFields.some(f => !f.verified);

  return (
    <Dialog
      open={open}
      onClose={isLoading ? () => {} : onClose}
      className={classes.root}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle className={classes.dialogTitle}>
        <div>
          <Typography style={{ fontWeight: 700, fontSize: '1rem' }}>
            1Password Secret Provisioning
          </Typography>
          {report?.customer && (
            <Typography style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>
              Customer: {report.customer}
              {report.application ? ` (${report.application}/${report.instanceName})` : ''}
            </Typography>
          )}
        </div>
      </DialogTitle>

      <DialogContent style={{ paddingTop: 16 }}>
        {isLoading && (
          <Box className={classes.loadingHeader}>
            <CircularProgress size={28} />
            <Box>
              <Typography style={{ fontWeight: 600 }}>
                Provisioning secrets in 1Password…
              </Typography>
              <Typography style={{ fontSize: '0.8rem', color: '#666' }}>
                Generating and writing each field to 1Password, then reading it
                back to confirm — this can take a few seconds per field.
              </Typography>
            </Box>
          </Box>
        )}

        {/* LIVE / FINAL LOG — always visible once something has streamed */}
        {logs.length > 0 && (
          <Box className={classes.liveLog}>
            {logs.map((log, idx) => (
              <Box key={idx} className={`${classes.logEntry} ${logClass(log.status)}`}>
                <span className={classes.logTimestamp}>
                  [{log.timestamp.split('T')[1]?.slice(0, 8) || ''}]
                </span>
                <span className={classes.logStep}>[{log.step}]</span>
                <span>{log.detail}</span>
              </Box>
            ))}
            <div ref={logEndRef} />
          </Box>
        )}

        {/* ERROR STATE */}
        {error && !isLoading && (
          <Box className={classes.errorBox} style={{ marginTop: 16 }}>
            <Typography style={{ fontWeight: 700, color: '#991B1B', marginBottom: 8 }}>
              ⚠️ Provisioning Failed
            </Typography>
            <Typography style={{ fontSize: '0.85rem', color: '#7F1D1D', fontFamily: 'monospace' }}>
              {error}
            </Typography>
          </Box>
        )}

        {/* COMPLETED REPORT */}
        {report && !isLoading && (
          <>
            <Grid container spacing={2} style={{ marginTop: 16, marginBottom: 16 }}>
              <Grid item xs={6}>
                <Paper className={classes.metricCard} style={{ backgroundColor: '#EFF6FF' }}>
                  <Typography style={{ fontSize: '0.75rem', color: '#0C4A6E', fontWeight: 600 }}>
                    Total Fields
                  </Typography>
                  <Typography className={classes.metricValue} style={{ color: '#0C4A6E' }}>
                    {totalFields}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper className={classes.metricCard} style={{ backgroundColor: '#F0FDF4' }}>
                  <Typography style={{ fontSize: '0.75rem', color: '#15803D', fontWeight: 600 }}>
                    Generated & Verified
                  </Typography>
                  <Typography className={classes.metricValue} style={{ color: '#15803D' }}>
                    {verifiedFields.filter(f => f.verified).length}/{generatedCount}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper className={classes.metricCard} style={{ backgroundColor: '#FEFCE8' }}>
                  <Typography style={{ fontSize: '0.75rem', color: '#854D0E', fontWeight: 600 }}>
                    Needs Upload
                  </Typography>
                  <Typography className={classes.metricValue} style={{ color: '#854D0E' }}>
                    {base64CertsNeeded}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper className={classes.metricCard} style={{ backgroundColor: '#F3E8FF' }}>
                  <Typography style={{ fontSize: '0.75rem', color: '#6B21A8', fontWeight: 600 }}>
                    Action Required
                  </Typography>
                  <Typography className={classes.metricValue} style={{ color: '#6B21A8' }}>
                    {actionRequiredCount}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {base64CertsNeeded > 0 && (
              <Box className={classes.warningBox}>
                <Typography style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400E' }}>
                  📋 Certificate & Key Upload Required
                </Typography>
                <Typography style={{ fontSize: '0.8rem', color: '#B45309', marginTop: 8 }}>
                  {base64CertsNeeded} certificate/key field(s) need a manual upload. These values
                  cannot be auto-generated.
                </Typography>
                {onOpenSecretEditor && report.customer && report.application && (
                  <Button
                    onClick={() => onOpenSecretEditor(report.customer, report.application)}
                    style={{
                      marginTop: 12,
                      background: 'linear-gradient(135deg, #B45309 0%, #A16207 100%)',
                      color: 'white',
                      fontWeight: 700,
                      textTransform: 'none',
                      fontSize: '0.82rem',
                      borderRadius: 8,
                      boxShadow: '0 4px 10px rgba(180, 83, 9, 0.25)',
                      padding: '8px 14px',
                    }}
                    variant="contained"
                    size="small"
                  >
                    Enter manual values
                  </Button>
                )}
              </Box>
            )}

            {actionRequiredCount > 0 && (
              <Box className={classes.warningBox}>
                <Typography style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400E' }}>
                  ⚠️ Manual secret action still required
                </Typography>
                <Typography style={{ fontSize: '0.8rem', color: '#B45309', marginTop: 8 }}>
                  {actionRequiredCount} field(s) remain blocked because they are missing, empty,
                  or still placeholder values. Review them before deployment.
                </Typography>
              </Box>
            )}

            {someUnverified && (
              <Box className={classes.warningBox}>
                <Typography style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400E' }}>
                  ⚠️ Some fields did not verify after writing
                </Typography>
                <Typography style={{ fontSize: '0.8rem', color: '#B45309', marginTop: 8 }}>
                  The write call succeeded but the post-write read-back from 1Password
                  did not confirm every field — see the table below and review manually.
                </Typography>
              </Box>
            )}

            {allVerified && (
              <Box className={classes.successBox}>
                <Typography style={{ fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>
                  🟢 Verified: every generated secret was confirmed in 1Password
                </Typography>
                <Typography style={{ fontSize: '0.8rem', color: '#15803D', marginTop: 8 }}>
                  Each field below was re-read directly from 1Password (cache bypassed)
                  after the write — this is not an assumption, it's a confirmed read-back.
                </Typography>
              </Box>
            )}

            {/* VERIFIED-IN-1PASSWORD PROOF TABLE */}
            {verifiedFields.length > 0 && (
              <Box style={{ marginTop: 16 }}>
                <Button
                  fullWidth
                  onClick={() => setShowVerification(!showVerification)}
                  style={{
                    justifyContent: 'space-between',
                    backgroundColor: '#F3F4F6',
                    color: '#4B5563',
                    textTransform: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    padding: '8px 12px',
                  }}
                >
                  <span>Verified in 1Password ({verifiedFields.length} field(s))</span>
                  <span>{showVerification ? '▲' : '▼'}</span>
                </Button>
                {showVerification && (
                  <Table size="small" style={{ marginTop: 8 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell style={{ fontWeight: 600, fontSize: '0.75rem' }}>Field</TableCell>
                        <TableCell style={{ fontWeight: 600, fontSize: '0.75rem' }}>Location</TableCell>
                        <TableCell style={{ fontWeight: 600, fontSize: '0.75rem' }}>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {verifiedFields.map((field, idx) => (
                        <TableRow key={idx}>
                          <TableCell style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>
                            {field.field}
                          </TableCell>
                          <TableCell style={{ fontSize: '0.72rem', color: '#666' }}>
                            {field.vault}/{field.item}/{field.section}
                          </TableCell>
                          <TableCell
                            className={`${classes.verifiedRow} ${field.verified ? 'verified' : 'unverified'}`}
                            style={{ fontSize: '0.78rem', fontWeight: 600 }}
                          >
                            {field.verified ? '✅ Verified' : `⚠️ ${field.status}`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            )}
          </>
        )}

        {!isLoading && !report && !error && logs.length === 0 && (
          <Typography style={{ color: '#666', textAlign: 'center' }}>
            Ready to provision. Click start to begin.
          </Typography>
        )}
      </DialogContent>

      <Divider />

      <DialogActions style={{ padding: 12 }}>
        <Button
          onClick={onClose}
          disabled={isLoading}
          style={{ textTransform: 'none', color: '#4B5563' }}
        >
          {isLoading ? 'Processing…' : 'Close'}
        </Button>
        {report && !isLoading && onProceedToDeploy && (
          <Button
            onClick={onProceedToDeploy}
            variant="contained"
            style={{ textTransform: 'none', backgroundColor: '#2563EB', color: 'white' }}
          >
            Proceed to Step 2
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
