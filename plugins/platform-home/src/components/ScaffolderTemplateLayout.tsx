/**
 * ScaffolderTemplateLayout – Reusable workflow UI wrapper for all scaffolder templates.
 *
 * Provides consistent, professional workflow UX across resource creation and deployment templates.
 * Features:
 *   - Hero banner with gradient and title
 *   - Configuration section with form fields
 *   - Action buttons (Review, Update, Create, Cancel)
 *   - Progress visualization
 *   - Status indicators
 *
 * Usage:
 *   Wrap your template parameters section with this layout component to get consistent workflow styling/UX.
 */

import { ReactNode } from 'react';
import { makeStyles } from '@mui/styles';
import { Paper, Typography, Button, Chip, Tooltip } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import CancelIcon from '@mui/icons-material/Cancel';

export interface ScaffolderTemplateLayoutProps {
  /** Template title (e.g., "Create Kubernetes Cluster") */
  title: string;
  /** Template subtitle/description */
  subtitle: string;
  /** Owning team/group */
  owner: string;
  /** Gradient background for hero banner (e.g., 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)') */
  gradient: string;
  /** Form/configuration children */
  children: ReactNode;
  /** Configuration section title (default: "Configuration") */
  configTitle?: string;
  /** Action button handlers */
  onReview?: () => void;
  onUpdate?: () => void;
  onCreate?: () => void;
  onCancel?: () => void;
  /** Disable action buttons (e.g., during form validation) */
  actionsDisabled?: boolean;
  /** Show action buttons or not */
  showActions?: boolean;
  /** Custom action button labels */
  reviewLabel?: string;
  updateLabel?: string;
  createLabel?: string;
  cancelLabel?: string;
  /** Optional prerequisite warning text */
  prerequisite?: string;
}

const useStyles = makeStyles(theme => ({
  root: {
    width: '100%',
  },
  wfLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    width: '100%',
  },
  heroBanner: {
    padding: theme.spacing(4, 5),
    color: '#FFFFFF',
    borderRadius: '0px',
  },
  heroTitle: {
    fontSize: '1.875rem',
    fontWeight: 700,
    marginBottom: theme.spacing(0.5),
  },
  heroSub: {
    fontSize: '1rem',
    fontWeight: 400,
    opacity: 0.95,
    marginBottom: theme.spacing(1),
  },
  heroOwner: {
    display: 'inline-block',
    fontSize: '0.875rem',
    fontWeight: 600,
    opacity: 0.9,
    paddingTop: theme.spacing(1),
  },
  prereqBox: {
    backgroundColor: '#FEF3C7',
    borderLeft: '4px solid #FBBF24',
    padding: theme.spacing(1.5, 2),
    marginBottom: 0,
    fontSize: '0.9rem',
    color: '#78350F',
  },
  workflowShell: {
    borderRadius: '0px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    padding: theme.spacing(3, 4),
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(3),
    paddingBottom: theme.spacing(2),
    borderBottom: '1px solid #E5E7EB',
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  statusTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#111827',
  },
  statusPct: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#2563EB',
  },
  statusRight: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  simColumns: {
    width: '100%',
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    padding: theme.spacing(2.5),
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    marginBottom: theme.spacing(2),
  },
  requestTitle: {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: theme.spacing(1.5),
  },
  requestBody: {
    marginBottom: theme.spacing(2),
  },
  compactField: {
    marginBottom: theme.spacing(0.5),
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(1.5),
    borderTop: '1px solid #F3F4F6',
    marginTop: theme.spacing(0.5),
    flexWrap: 'wrap',
  },
  primaryBtn: {
    backgroundColor: '#2563EB',
    color: '#FFFFFF',
    fontWeight: 600,
    textTransform: 'none',
    borderRadius: 6,
    '&:hover': {
      backgroundColor: '#1D4ED8',
    },
    '&:disabled': {
      backgroundColor: '#E5E7EB',
      color: '#9CA3AF',
    },
  },
  secondaryBtn: {
    color: '#374151',
    borderColor: '#D1D5DB',
    fontWeight: 600,
    textTransform: 'none',
    borderRadius: 6,
    '&:hover': {
      backgroundColor: '#F9FAFB',
    },
  },
}));

export function ScaffolderTemplateLayout({
  title,
  subtitle,
  owner,
  gradient,
  children,
  configTitle = 'Configuration',
  onReview,
  onUpdate,
  onCreate,
  onCancel,
  actionsDisabled = false,
  showActions = true,
  reviewLabel = 'Review',
  updateLabel = 'Update',
  createLabel = 'Create',
  cancelLabel = 'Cancel',
  prerequisite,
}: ScaffolderTemplateLayoutProps) {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <div className={classes.wfLayout}>
        {/* Hero Banner */}
        <div className={classes.heroBanner} style={{ background: gradient }}>
          <Typography className={classes.heroTitle}>{title}</Typography>
          <Typography className={classes.heroSub}>{subtitle}</Typography>
          <span className={classes.heroOwner}>{owner}</span>
        </div>

        {/* Prerequisite warning (if any) */}
        {prerequisite && (
          <div className={classes.prereqBox}>⚠ {prerequisite}</div>
        )}

        {/* Configuration Form Section */}
        <Paper className={classes.workflowShell} elevation={0}>
          <div className={classes.statusBar}>
            <div className={classes.statusLeft}>
              <Chip
                label="Configuration"
                size="small"
                style={{
                  background: '#F3F4F6',
                  color: '#374151',
                  fontWeight: 600,
                }}
              />
              <Typography className={classes.statusTitle}>
                {configTitle}
              </Typography>
            </div>
          </div>

          <form
            className={classes.simColumns}
            onSubmit={e => e.preventDefault()}
          >
            <Paper className={classes.requestCard} elevation={0}>
              <Typography className={classes.requestTitle}>
                {configTitle}
              </Typography>
              <div className={classes.requestBody}>{children}</div>

              {/* Action Buttons */}
              {showActions && (
                <div className={classes.actionRow}>
                  {onReview && (
                    <Tooltip title="Review and generate plan">
                      <span>
                        <Button
                          variant="outlined"
                          className={classes.secondaryBtn}
                          startIcon={<VisibilityIcon />}
                          disabled={actionsDisabled}
                          onClick={onReview}
                        >
                          {reviewLabel}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  {onUpdate && (
                    <Tooltip title="Update configuration">
                      <span>
                        <Button
                          variant="outlined"
                          className={classes.secondaryBtn}
                          startIcon={<RefreshIcon />}
                          disabled={actionsDisabled}
                          onClick={onUpdate}
                        >
                          {updateLabel}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  {onCreate && (
                    <Tooltip title="Submit for creation">
                      <span>
                        <Button
                          variant="contained"
                          className={classes.primaryBtn}
                          startIcon={<AddCircleIcon />}
                          disabled={actionsDisabled}
                          onClick={onCreate}
                        >
                          {createLabel}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  {onCancel && (
                    <Button
                      variant="outlined"
                      className={classes.secondaryBtn}
                      startIcon={<CancelIcon />}
                      disabled={actionsDisabled}
                      onClick={onCancel}
                    >
                      {cancelLabel}
                    </Button>
                  )}
                </div>
              )}
            </Paper>
          </form>
        </Paper>
      </div>
    </div>
  );
}
