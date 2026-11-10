import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import type {
  PortalSecretFieldInfo,
  PortalSecretFieldType,
  PortalSecretReadinessReport,
  PortalSecretRefFinding,
} from './deploymentPortalTypes';

interface SecretReadinessModalProps {
  open: boolean;
  customer: string;
  loading: boolean;
  report: PortalSecretReadinessReport | null;
  error: string | null;
  /** True once every field the user can act on is populated (see DeploymentWizard's isEffectivelyReady). */
  effectivelyReady?: boolean;
  /** Disables Auto-Generate once there's nothing left it can do. */
  provisionDisabled?: boolean;
  fields: PortalSecretFieldInfo[];
  fieldValues: Record<string, string>;
  updatingFieldReference: string | null;
  onFieldValueChange: (reference: string, value: string) => void;
  onSaveField: (field: PortalSecretFieldInfo, value: string) => Promise<void>;
  onRevalidate: () => void;
  onProvision: () => void;
  onOpenChange: (open: boolean) => void;
  /** Prefill for a field the user hasn't typed into yet (e.g. the selected chart version). */
  suggestedValueFor?: (field: PortalSecretFieldInfo) => string | undefined;
}

const STATUS_STYLE: Record<
  PortalSecretFieldInfo['status'],
  { bg: string; fg: string }
> = {
  READY: { bg: '#ECFDF5', fg: '#065F46' },
  MISSING: { bg: '#FEF3C7', fg: '#92400E' },
  PLACEHOLDER: { bg: '#FDE68A', fg: '#92400E' },
  EMPTY: { bg: '#FEE2E2', fg: '#B91C1C' },
  ERROR: { bg: '#FEE2E2', fg: '#B91C1C' },
};

function inferFieldType(fieldName: string): PortalSecretFieldType {
  const lower = fieldName.toLowerCase();
  if (
    lower.endsWith('_chart_version') ||
    lower.endsWith('chart_version') ||
    lower.endsWith('_version') ||
    lower.endsWith('_branch') ||
    lower.endsWith('_ref')
  ) {
    return 'pipeline_ref';
  }
  if (lower.includes('cert') || lower.includes('__base64__') || lower.includes('base64')) {
    return 'certificate';
  }
  if (lower.includes('.key') || (lower.includes('key') && !lower.includes('api_key') && !lower.includes('apikey'))) {
    return 'key';
  }
  if (
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('api_key') ||
    lower.includes('apikey')
  ) {
    return 'password';
  }
  return 'other';
}

function findingToFieldInfo(finding: PortalSecretRefFinding): PortalSecretFieldInfo {
  return { ...finding, type: inferFieldType(finding.field) };
}

export function SecretReadinessModal({
  open,
  customer,
  loading,
  report,
  error,
  effectivelyReady = false,
  provisionDisabled = false,
  fields,
  fieldValues,
  updatingFieldReference,
  onFieldValueChange,
  onSaveField,
  onRevalidate,
  onProvision,
  onOpenChange,
  suggestedValueFor,
}: SecretReadinessModalProps) {
  // Merge the API-returned fields (exist in 1Password but need values)
  // with report.missing (references that don't exist in 1Password at all).
  // Both must be surfaced so the user can act on them in the manual editor.
  const allActionableFields = useMemo<PortalSecretFieldInfo[]>(() => {
    const knownRefs = new Set(fields.map(f => f.reference));
    const missingAsFields: PortalSecretFieldInfo[] = (report?.missing ?? [])
      .filter(m => !knownRefs.has(m.reference) && m.status !== 'READY')
      .map(findingToFieldInfo);
    return [...missingAsFields, ...fields].filter(f => f.status !== 'READY');
  }, [fields, report]);

  if (!open) {
    return null;
  }

  const title = effectivelyReady
    ? '1Password Readiness Setup'
    : 'Fix 1Password Readiness';

  const summary = report?.ready
    ? 'Ready. All secrets are populated in 1Password.'
    : (report?.summary ?? 'Validate and update 1Password secrets.');

  const valueFor = (field: PortalSecretFieldInfo): string =>
    fieldValues[field.reference] ?? suggestedValueFor?.(field) ?? '';

  const savePendingChanges = async () => {
    const pendingEntries = allActionableFields.filter(field => {
      const value = (fieldValues[field.reference] ?? '').trim();
      return value.length > 0;
    });

    for (const field of pendingEntries) {
      const value = fieldValues[field.reference] ?? valueFor(field);
      await onSaveField(field, value);
    }
  };

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} maxWidth="xl" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
          <Box>
            <Typography variant="h6" fontWeight={800}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Vault: Customers | Customer: {customer || 'unknown'}
            </Typography>
          </Box>
          {report ? (
            <Chip
              label={effectivelyReady ? 'Ready' : 'Blocked'}
              color={effectivelyReady ? 'success' : 'warning'}
              variant="outlined"
            />
          ) : null}
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: '#FAFAFB', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
        <Paper
          elevation={0}
          sx={{
            mb: 2,
            p: 2,
            borderRadius: 2,
            border: '1px solid #E5E7EB',
            bgcolor: '#FFFFFF',
          }}
        >
          <Typography fontWeight={700} color={effectivelyReady ? '#065F46' : '#92400E'}>
            {summary}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: '#6B7280' }}>
            {effectivelyReady
              ? 'The deployment can continue.'
              : 'Enter values that cannot be generated below, then save them to 1Password and validate. Use Generate, Save & Validate for fields CloudHub can create automatically.'}
          </Typography>
        </Paper>

        {error ? (
          <Paper
            elevation={0}
            sx={{
              mb: 2,
              p: 2,
              borderRadius: 2,
              border: '1px solid #FECACA',
              bgcolor: '#FEF2F2',
            }}
          >
            <Typography fontWeight={700} color="#B91C1C">
              Validation error
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: '#B91C1C' }}>
              {error}
            </Typography>
          </Paper>
        ) : null}

        <Box display="flex" flexDirection="column" gap={2}>
          {allActionableFields.length === 0 ? (
            <Paper
              elevation={0}
              sx={{
                p: 2,
                borderRadius: 2,
                border: '1px solid #E5E7EB',
                bgcolor: '#FFFFFF',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {report
                  ? 'All required secrets are present in 1Password.'
                  : 'Run "Validate" first to load the list of required secrets.'}
              </Typography>
            </Paper>
          ) : (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                borderRadius: 2,
                border: '1px solid #E5E7EB',
                backgroundColor: '#FFFFFF',
                overflowX: 'auto',
                overflowY: 'visible',
              }}
            >
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: '1150px' }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#F3F4F6', borderBottom: '2px solid #E5E7EB' }}>
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        color: '#374151',
                        padding: '12px 16px',
                        width: '180px',
                      }}
                    >
                      Field Name
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        color: '#374151',
                        padding: '12px 16px',
                        width: '90px',
                      }}
                    >
                      Status
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        color: '#374151',
                        padding: '12px 16px',
                        width: '100px',
                      }}
                    >
                      Type
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        color: '#374151',
                        padding: '12px 16px',
                        width: '240px',
                      }}
                    >
                      Description
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        color: '#374151',
                        padding: '12px 16px',
                        width: '300px',
                      }}
                    >
                      Value / Input
                    </TableCell>
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        color: '#374151',
                        padding: '12px 16px',
                        width: '85px',
                      }}
                    >
                      Action
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allActionableFields.map((field) => {
                    const style = STATUS_STYLE[field.status] ?? STATUS_STYLE.ERROR;
                    const isPipelineRef = field.type === 'pipeline_ref';
                    const isSecretField =
                      field.type === 'certificate' ||
                      field.type === 'key' ||
                      field.type === 'base64';
                    const value = valueFor(field);
                    const isBusy = updatingFieldReference === field.reference;

                    return (
                      <TableRow
                        key={field.reference}
                        sx={{
                          borderBottom: '1px solid #E5E7EB',
                          '&:hover': { backgroundColor: '#FAFAFB' },
                          verticalAlign: 'top',
                        }}
                      >
                        <TableCell
                          sx={{
                            padding: '12px 16px',
                            wordBreak: 'break-word',
                            maxWidth: '200px',
                          }}
                        >
                          <Box>
                            <Typography fontFamily="monospace" fontWeight={700} variant="body2">
                              {field.field}
                            </Typography>
                            {field.section && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                {field.section}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, wordBreak: 'break-all' }}>
                              {field.reference}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell
                          sx={{
                            padding: '12px 16px',
                            wordBreak: 'break-word',
                            maxWidth: '150px',
                          }}
                        >
                          <Chip
                            size="small"
                            label={field.status}
                            variant="outlined"
                            sx={{
                              bgcolor: style.bg,
                              color: style.fg,
                              borderColor: style.fg,
                              fontWeight: 700,
                            }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            padding: '12px 16px',
                            wordBreak: 'break-word',
                            maxWidth: '120px',
                          }}
                        >
                          {isPipelineRef && (
                            <Chip
                              size="small"
                              label="version/ref"
                              sx={{
                                fontSize: '0.68rem',
                                bgcolor: '#EFF6FF',
                                color: '#1D4ED8',
                                border: '1px solid #BFDBFE',
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell
                          sx={{
                            padding: '12px 16px',
                            wordBreak: 'break-word',
                            width: '240px',
                          }}
                        >
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
                            {field.message || (isPipelineRef ? 'Version, branch, or commit SHA' : 'Enter secret value')}
                          </Typography>
                        </TableCell>
                        <TableCell
                          sx={{
                            padding: '12px 16px',
                            width: '300px',
                          }}
                        >
                          <Box display="flex" flexDirection="column" gap={0.5}>
                            {isPipelineRef ? (
                              <TextField
                                value={value}
                                onChange={event =>
                                  onFieldValueChange(field.reference, event.target.value)
                                }
                                placeholder="e.g. 2.0.14"
                                size="small"
                                fullWidth
                                InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
                              />
                            ) : isSecretField ? (
                              <TextField
                                value={value}
                                onChange={event =>
                                  onFieldValueChange(field.reference, event.target.value)
                                }
                                placeholder="Base64 content"
                                size="small"
                                fullWidth
                                multiline
                                minRows={1}
                                maxRows={2}
                                InputProps={{
                                  sx: { fontFamily: 'monospace', fontSize: '0.7rem' },
                                }}
                              />
                            ) : (
                              <TextField
                                value={value}
                                onChange={event =>
                                  onFieldValueChange(field.reference, event.target.value)
                                }
                                placeholder="Enter value"
                                size="small"
                                fullWidth
                                multiline
                                minRows={1}
                                maxRows={2}
                                InputProps={{
                                  sx: { fontFamily: 'monospace', fontSize: '0.7rem' },
                                }}
                              />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            padding: '12px 16px',
                            maxWidth: '100px',
                          }}
                        >
                          <Button
                            size="small"
                            variant="contained"
                            disabled={isBusy || !value.trim()}
                            onClick={() => void onSaveField(field, value)}
                            sx={{ fontSize: '0.75rem' }}
                          >
                            {isBusy ? '…' : 'Save'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Button variant="outlined" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="outlined"
            onClick={onProvision}
            disabled={loading || provisionDisabled}
          >
            {effectivelyReady
              ? '✓ All Secrets Populated'
              : 'Generate, Save & Validate'}
          </Button>
        </Box>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Button
            variant="contained"
            onClick={async () => {
              await savePendingChanges();
              await onRevalidate();
            }}
            disabled={loading}
          >
            {loading ? 'Validating…' : 'Save & Validate'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
