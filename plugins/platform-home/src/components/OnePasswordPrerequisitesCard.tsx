import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import type {
  PortalFilePlaceholderFinding,
  PortalSecretReadinessReport,
  PortalSecretRefFinding,
} from './deploymentPortalTypes';

interface OnePasswordPrerequisitesCardProps {
  customer: string;
  loading: boolean;
  report: PortalSecretReadinessReport | null;
  error: string | null;
  /**
   * True once every field the user can act on is populated. May be true
   * even when report.ready is false, if the only outstanding items are
   * chart-version/branch fields that get set automatically at deploy time.
   */
  effectivelyReady: boolean;
  provisionBusy: boolean;
  provisionInFlight: boolean;
  validateDisabled: boolean;
  provisionDisabled: boolean;
  bypassValidation: boolean;
  onBypassValidationChange: (checked: boolean) => void;
  onValidate: () => void;
  onProvision: () => void;
  onOpenEditor?: () => void;
  /** Advances the wizard to the next step. Omit where there's no "next". */
  onProceedToNext?: () => void;
}

const useStyles = makeStyles({
  root: {
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFAFB 100%)',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  titleBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    fontWeight: 800,
    color: '#111827',
  },
  subtitle: {
    color: '#6B7280',
    fontSize: '0.82rem',
  },
  statusCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    border: '1px solid transparent',
  },
  successCard: {
    background: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  warningCard: {
    background: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  errorCard: {
    background: '#FEF2F2',
    borderColor: '#FECACA',
  },
  infoCard: {
    background: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  statusText: {
    fontWeight: 800,
    fontSize: '0.95rem',
  },
  statusSubtext: {
    marginTop: 4,
    fontSize: '0.82rem',
    lineHeight: 1.45,
  },
  tallyRow: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  tallyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.82rem',
    fontWeight: 700,
  },
  nextStepBox: {
    marginTop: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 12,
  },
  helperRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tableWrap: {
    marginTop: 14,
    borderRadius: 10,
    overflowX: 'auto',
    border: '1px solid #E5E7EB',
  },
  table: {
    minWidth: 860,
    tableLayout: 'fixed',
  },
  slNoCell: {
    width: '5%',
    color: '#9CA3AF',
    fontSize: '0.78rem',
    fontWeight: 600,
    textAlign: 'center' as const,
  },
  tableHeadCell: {
    fontSize: '0.72rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#6B7280',
    background: '#F9FAFB',
    whiteSpace: 'nowrap',
  },
  tableCell: {
    verticalAlign: 'top',
    fontSize: '0.82rem',
  },
  fieldName: {
    fontWeight: 700,
    color: '#111827',
    fontFamily: 'monospace',
    fontSize: '0.78rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sectionText: {
    color: '#6B7280',
    fontSize: '0.74rem',
    marginTop: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  categoryText: {
    fontSize: '0.78rem',
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  statusBadge: {
    fontWeight: 800,
    fontSize: '0.72rem',
  },
  rowMessage: {
    color: '#6B7280',
    fontSize: '0.74rem',
    marginTop: 3,
    lineHeight: 1.35,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noRows: {
    padding: 14,
    color: '#6B7280',
    fontSize: '0.82rem',
  },
});

type FieldCategory = 'Password / Token' | 'Certificate / Key' | 'Chart Version / Ref';

function categorize(field: string): FieldCategory {
  const lower = field.toLowerCase();
  if (
    lower.includes('cert') ||
    lower.includes('.pem') ||
    lower.includes('base64') ||
    lower.includes('private_key') ||
    (lower.includes('key') && !lower.includes('api_key'))
  ) {
    return 'Certificate / Key';
  }
  if (
    lower.endsWith('_version') ||
    lower.endsWith('_branch') ||
    lower.endsWith('_ref')
  ) {
    return 'Chart Version / Ref';
  }
  return 'Password / Token';
}

const CATEGORY_ICON: Record<FieldCategory, string> = {
  'Password / Token': '',
  'Certificate / Key': '',
  'Chart Version / Ref': '',
};


export function OnePasswordPrerequisitesCard(
  props: OnePasswordPrerequisitesCardProps,
) {
  const classes = useStyles();
  const customer = props.customer.trim();

  const findings = props.report?.findings ?? [];
  const filePlaceholders = props.report?.filePlaceholders ?? [];
  const readyCount = findings.filter(f => f.status === 'READY').length;
  const needsValueCount =
    findings.filter(f => f.status === 'PLACEHOLDER' || f.status === 'EMPTY').length +
    filePlaceholders.length;
  const missingCount = findings.filter(
    f => f.status === 'MISSING' || f.status === 'ERROR',
  ).length;
  const totalCount = findings.length + filePlaceholders.length;
  const fullyReady = Boolean(props.report?.ready);

  let bannerClass = classes.infoCard;
  let bannerTone = '#1D4ED8';
  let bannerTitle = 'Validation complete.';
  let bannerDetail = props.report?.summary ?? '';

  if (fullyReady) {
    bannerClass = classes.successCard;
    bannerTone = '#065F46';
    bannerTitle = '🟢 All required secrets are present and populated.';
    bannerDetail = 'This customer is fully ready — nothing else to do here.';
  } else if (props.effectivelyReady) {
    bannerClass = classes.successCard;
    bannerTone = '#065F46';
    bannerTitle = '🟢 All secrets you need to set are ready.';
    bannerDetail =
      'The remaining field(s) track this app\'s chart version/branch and are set automatically when the deployment is approved — no action needed.';
  } else if (totalCount > 0) {
    bannerClass = classes.warningCard;
    bannerTone = '#92400E';
    bannerTitle = '⚠️ Secrets incomplete — action required before deployment.';
    bannerDetail =
      'This action only fills truly missing secrets. Existing placeholders and manual entries are kept as-is until you update them explicitly.';
  }

  let provisionLabel = 'Generate, Save & Validate';
  if (props.provisionBusy) {
    provisionLabel = 'Generating & saving…';
  } else if (props.provisionInFlight) {
    provisionLabel = 'Writing & validating…';
  } else if (props.report && props.effectivelyReady) {
    provisionLabel = '✓ All Secrets Populated';
  }

  return (
    <Paper elevation={0} className={classes.root}>
      <Box className={classes.headerRow}>
        <Box className={classes.titleBlock}>
          <Typography variant="subtitle1" className={classes.title}>
            1Password Prerequisites
          </Typography>
          <Typography className={classes.subtitle}>
            Generate missing values, save them to 1Password, and validate the read-back before moving to review.
          </Typography>
        </Box>

        <Box className={classes.actionsRow}>
          <Button
            variant="outlined"
            size="small"
            onClick={props.onValidate}
            disabled={props.validateDisabled}
          >
            {props.loading ? 'Validating…' : 'Validate'}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={props.onProvision}
            disabled={props.provisionDisabled}
          >
            {provisionLabel}
          </Button>
          {props.onOpenEditor && !props.effectivelyReady ? (
            <Button
              variant="contained"
              size="small"
              onClick={props.onOpenEditor}
              style={{
                background: 'linear-gradient(135deg, #B45309 0%, #A16207 100%)',
                color: 'white',
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: 8,
                boxShadow: '0 4px 10px rgba(180, 83, 9, 0.22)',
                padding: '7px 12px',
              }}
            >
              Enter values manually
            </Button>
          ) : null}
        </Box>
      </Box>

      {props.loading && !props.report && (
        <Paper elevation={0} className={`${classes.statusCard} ${classes.infoCard}`}>
          <CircularProgress size={18} />
          <Box>
            <Typography className={classes.statusText} style={{ color: '#1D4ED8' }}>
              Validating 1Password credentials across vault Customers...
            </Typography>
            <Typography className={classes.statusSubtext} style={{ color: '#1D4ED8' }}>
              This checks the rendered overrides, pipeline refs, and existing
              1Password entries for {customer || 'the selected customer'}.
            </Typography>
          </Box>
        </Paper>
      )}

      {props.error && (
        <Paper elevation={0} className={`${classes.statusCard} ${classes.errorCard}`}>
          <Typography className={classes.statusText} style={{ color: '#B91C1C' }}>
            Validation error
          </Typography>
          <Typography className={classes.statusSubtext} style={{ color: '#B91C1C' }}>
            {props.error}
          </Typography>
        </Paper>
      )}

      {props.report && !props.loading && (
        <Paper elevation={0} className={`${classes.statusCard} ${bannerClass}`}>
          <Box style={{ width: '100%' }}>
            <Typography className={classes.statusText} style={{ color: bannerTone }}>
              {bannerTitle}
            </Typography>
            <Typography className={classes.statusSubtext} style={{ color: bannerTone }}>
              {bannerDetail}
            </Typography>

            {totalCount > 0 && (
              <Box className={classes.tallyRow}>
                <Box className={classes.tallyItem} style={{ color: '#065F46' }}>
                  🟢 {readyCount} Ready
                </Box>
                <Box className={classes.tallyItem} style={{ color: '#92400E' }}>
                  🟡 {needsValueCount} Needs a value (UPDATE_ME)
                </Box>
                <Box className={classes.tallyItem} style={{ color: '#B91C1C' }}>
                  🔴 {missingCount} Not in 1Password
                </Box>
              </Box>
            )}

            {(fullyReady || props.effectivelyReady) && props.onProceedToNext && (
              <Box className={classes.nextStepBox}>
                <Typography style={{ fontSize: '0.82rem', color: bannerTone }}>
                  👉 Next: review the deployment diff before submitting it for approval.
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  onClick={props.onProceedToNext}
                  style={{ backgroundColor: '#2563EB', color: 'white' }}
                >
                  Review Diff &amp; Approval →
                </Button>
              </Box>
            )}
          </Box>
        </Paper>
      )}

      <Box className={classes.helperRow}>
        <FormControlLabel
          control={
            <Checkbox
              checked={props.bypassValidation}
              onChange={(_, checked) => props.onBypassValidationChange(checked)}
              size="small"
            />
          }
          label="Bypass 1Password validation (Manifests / Dry-run only)"
        />
        <Typography className={classes.subtitle}>
          Next stays disabled until every field you're responsible for is
          populated (chart version/branch fields are set automatically at
          deploy time).
        </Typography>
      </Box>

      {props.report && (
        <Box>
          {/* Removed decorative icon/section cards per UX request — no traces remain. */}

          <Box className={classes.tableWrap} style={{ marginTop: 12 }}>
            <Table size="small" className={classes.table}>
              <TableHead>
                <TableRow>
                  <TableCell className={classes.tableHeadCell} style={{ width: '5%', textAlign: 'center' }}>
                    #
                  </TableCell>
                  <TableCell className={classes.tableHeadCell} style={{ width: '38%' }}>
                    Field
                  </TableCell>
                  <TableCell className={classes.tableHeadCell} style={{ width: '22%' }}>
                    Category
                  </TableCell>
                  <TableCell className={classes.tableHeadCell} style={{ width: '12%' }}>
                    Status
                  </TableCell>
                  <TableCell className={classes.tableHeadCell} style={{ width: '23%' }}>
                    Action
                  </TableCell>
                </TableRow>
              </TableHead>
                      <TableBody>
                        {['Chart Version / Ref', 'Certificate / Key', 'Password / Token'].map(cat => {
                          const rows = findings.filter(f => categorize(f.field) === cat as any);
                          return rows.map((finding, index) => (
                            <ReadinessRow
                              key={`${finding.normalizedReference}-${cat}-${index}`}
                              rowIndex={index + 1}
                              finding={finding}
                              onCopyRef={async () => {
                                await copyToClipboard(finding.normalizedReference);
                              }}
                            />
                          ));
                        })}

                {filePlaceholders.map((placeholder, index) => (
                  <PlaceholderRow
                    key={`${placeholder.path}-${placeholder.line}-${index}`}
                    rowIndex={findings.length + index + 1}
                    placeholder={placeholder}
                    onCopyRef={async () => {
                      await copyToClipboard(placeholder.token);
                    }}
                  />
                ))}

                {findings.length === 0 && filePlaceholders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className={classes.noRows}>
                      No references were discovered in the rendered files.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

interface RowProps {
  rowIndex: number;
  finding: PortalSecretRefFinding;
  onCopyRef: () => Promise<void>;
}

function ReadinessRow({ rowIndex, finding, onCopyRef }: RowProps) {
  const classes = useStyles();
  let statusLabel = 'Error';
  let badgeBg = '#FEE2E2';
  let badgeColor = '#B91C1C';
  let actionText = 'Review manually';

  const category = categorize(finding.field);
  const isPipelineField = category === 'Chart Version / Ref';

  if (finding.status === 'READY') {
    statusLabel = '🟢 Ready';
    badgeBg = '#ECFDF5';
    badgeColor = '#065F46';
    actionText = 'None — ready for deployment';
  } else if (finding.status === 'MISSING') {
    statusLabel = '🔴 Missing';
    badgeBg = '#FEE2E2';
    badgeColor = '#B91C1C';
    actionText = isPipelineField
      ? 'None — set automatically at deploy time'
      : 'Auto-generate or enter manually';
  } else if (finding.status === 'PLACEHOLDER') {
    statusLabel = '🟡 UPDATE_ME';
    badgeBg = '#FDE68A';
    badgeColor = '#92400E';
    actionText = isPipelineField
      ? 'None — set automatically at deploy time'
      : category === 'Certificate / Key'
        ? 'Upload the file manually'
        : 'Auto-generate or enter manually';
  } else if (finding.status === 'EMPTY') {
    statusLabel = '🔴 Empty';
    badgeBg = '#FEE2E2';
    badgeColor = '#B91C1C';
    actionText = 'Enter a value manually';
  }

  return (
    <TableRow>
      <TableCell className={classes.slNoCell}>{rowIndex}</TableCell>
      <TableCell className={classes.tableCell}>
        <Tooltip title={finding.field}>
          <Box className={classes.fieldName}>{finding.field}</Box>
        </Tooltip>
        <Tooltip title={`${finding.vault}/${finding.item}`}>
          <Box className={classes.sectionText}>
            {finding.vault}/{finding.item}
            {finding.section ? ` · ${finding.section}` : ''}
          </Box>
        </Tooltip>
      </TableCell>
      <TableCell className={classes.tableCell}>
        <Box className={classes.categoryText}>
          {CATEGORY_ICON[category]} {category}
        </Box>
      </TableCell>
      <TableCell className={classes.tableCell}>
        <Chip
          size="small"
          label={statusLabel}
          className={classes.statusBadge}
          style={{ backgroundColor: badgeBg, color: badgeColor, fontWeight: 800 }}
        />
      </TableCell>
      <TableCell className={classes.tableCell}>
        <Tooltip title={finding.message || actionText}>
          <Box className={classes.rowMessage}>{actionText}</Box>
        </Tooltip>
        <Button size="small" variant="text" onClick={() => void onCopyRef()} style={{ padding: 0, marginTop: 2 }}>
          Copy ref
        </Button>
      </TableCell>
    </TableRow>
  );
}

interface PlaceholderRowProps {
  rowIndex: number;
  placeholder: PortalFilePlaceholderFinding;
  onCopyRef: () => Promise<void>;
}

function PlaceholderRow({ rowIndex, placeholder, onCopyRef }: PlaceholderRowProps) {
  const classes = useStyles();
  return (
    <TableRow>
      <TableCell className={classes.slNoCell}>{rowIndex}</TableCell>
      <TableCell className={classes.tableCell}>
        <Tooltip title={placeholder.token}>
          <Box className={classes.fieldName}>{placeholder.token}</Box>
        </Tooltip>
        <Tooltip title={`${placeholder.path}:${placeholder.line}`}>
          <Box className={classes.sectionText}>
            {placeholder.path}:{placeholder.line}
          </Box>
        </Tooltip>
      </TableCell>
      <TableCell className={classes.tableCell}>
        <Box className={classes.categoryText}>📄 File placeholder</Box>
      </TableCell>
      <TableCell className={classes.tableCell}>
        <Chip
          size="small"
          label="🟡 UPDATE_ME"
          className={classes.statusBadge}
          style={{ backgroundColor: '#FDE68A', color: '#92400E', fontWeight: 800 }}
        />
      </TableCell>
      <TableCell className={classes.tableCell}>
        <Box className={classes.rowMessage}>Replace the UPDATE_ME token in the file.</Box>
        <Button size="small" variant="text" onClick={() => void onCopyRef()} style={{ padding: 0, marginTop: 2 }}>
          Copy token
        </Button>
      </TableCell>
    </TableRow>
  );
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Ignore clipboard failures in restricted browsers.
  }
}
