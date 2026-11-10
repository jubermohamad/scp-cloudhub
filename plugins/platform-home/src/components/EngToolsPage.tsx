/**
 * EngToolsPage – Engineering Tools hub with nested secondary navigation.
 *
 * Layout:
 *   ┌──────────────────┬───────────────────────────────────────────────┐
 *   │  Secondary Nav   │  Main Content                                 │
 *   │  (240 px)        │  WelcomeState  OR  ToolForm (+ Review panel)  │
 *   └──────────────────┴───────────────────────────────────────────────┘
 *
 * 10 tools, each with its own typed form. Every form has
 * Review → Submit → Clear action buttons.
 */

import { ChangeEvent, useState } from 'react';
import { makeStyles } from '@mui/styles';
import {
  Button,
  Chip,
  Divider,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { GitHubToolForm } from './GitHubToolForm';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import RouterIcon from '@mui/icons-material/Router';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import BugReportIcon from '@mui/icons-material/BugReport';
import TimelineIcon from '@mui/icons-material/Timeline';
import CodeIcon from '@mui/icons-material/Code';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TuneIcon from '@mui/icons-material/Tune';

// ─── Field / Form types ───────────────────────────────────────────────────────

type FieldType = 'text' | 'email' | 'select' | 'textarea' | 'date';

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  helperText?: string;
  cols?: 4 | 6 | 12;
}

interface ToolDef {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  accent: string;
  fields: FormField[];
}

type FormValues = Record<string, string>;

function emptyValues(tool: ToolDef): FormValues {
  return Object.fromEntries(tool.fields.map(f => [f.id, '']));
}

// ─── Tool definitions (10 tools) ─────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    id: '1password',
    label: '1Password',
    description:
      'Request access to a 1Password vault or shared credential set.',
    icon: VpnKeyIcon,
    accent: '#1E40AF',
    fields: [
      {
        id: 'teamName',
        label: 'Team Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'vaultName',
        label: 'Vault Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'accessLevel',
        label: 'Access Level',
        type: 'select',
        required: true,
        cols: 6,
        options: ['Read', 'Write', 'Admin'],
      },
      {
        id: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        cols: 6,
        options: ['dev', 'staging', 'production'],
      },
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        cols: 6,
        options: ['1 day', '1 week', '1 month', 'Permanent'],
      },
      {
        id: 'justification',
        label: 'Justification',
        type: 'textarea',
        required: true,
        cols: 12,
        helperText: 'Describe the business need for this vault access.',
      },
    ],
  },
  {
    id: 'tailscale',
    label: 'Tailscale (Jumpbox)',
    description:
      'Request temporary jumpbox access via Tailscale for a specific cluster.',
    icon: RouterIcon,
    accent: '#0F766E',
    fields: [
      {
        id: 'clusterName',
        label: 'Cluster Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        cols: 6,
        options: ['dev', 'test', 'staging', 'production'],
      },
      {
        id: 'username',
        label: 'Username / UPN',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'duration',
        label: 'Access Duration',
        type: 'select',
        required: true,
        cols: 6,
        options: ['4 hours', '8 hours', '24 hours', '1 week'],
      },
      {
        id: 'reason',
        label: 'Access Reason',
        type: 'textarea',
        required: true,
        cols: 12,
        helperText: 'Describe the purpose of this jumpbox session.',
      },
    ],
  },
  {
    id: 'ps-onboarding',
    label: 'PS Onboarding',
    description:
      'Initiate Professional Services onboarding for a new customer engagement.',
    icon: AssignmentIndIcon,
    accent: '#7C3AED',
    fields: [
      {
        id: 'customerName',
        label: 'Customer Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'projectName',
        label: 'Project Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'contactEmail',
        label: 'Primary Contact Email',
        type: 'email',
        required: true,
        cols: 6,
      },
      { id: 'accountManager', label: 'Account Manager', type: 'text', cols: 6 },
      {
        id: 'startDate',
        label: 'Engagement Start Date',
        type: 'date',
        cols: 6,
      },
      {
        id: 'environments',
        label: 'Environments',
        type: 'select',
        cols: 6,
        options: ['dev', 'uat', 'production', 'dev + uat', 'all'],
      },
      {
        id: 'notes',
        label: 'Notes',
        type: 'textarea',
        cols: 12,
        helperText: 'Additional engagement details or special requirements.',
      },
    ],
  },
  {
    id: 'cve-scan',
    label: 'CVE Scan Reports (Azure)',
    description:
      'Request a CVE vulnerability scan against Azure resources or container images.',
    icon: BugReportIcon,
    accent: '#B91C1C',
    fields: [
      {
        id: 'subscription',
        label: 'Subscription ID',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'resourceGroup',
        label: 'Resource Group',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'scanType',
        label: 'Scan Type',
        type: 'select',
        required: true,
        cols: 6,
        options: ['Full', 'Incremental', 'Container Images', 'IaC'],
      },
      {
        id: 'severity',
        label: 'Severity Filter',
        type: 'select',
        cols: 6,
        options: [
          'Critical only',
          'High & above',
          'Medium & above',
          'All findings',
        ],
      },
      {
        id: 'schedule',
        label: 'Schedule',
        type: 'select',
        cols: 6,
        options: ['On-demand', 'Daily', 'Weekly'],
      },
      {
        id: 'notifyEmail',
        label: 'Notification Email',
        type: 'email',
        cols: 6,
      },
    ],
  },
  {
    id: 'datadog',
    label: 'DataDog',
    description:
      'Request DataDog dashboard access or monitoring configuration for a service.',
    icon: TimelineIcon,
    accent: '#7E22CE',
    fields: [
      {
        id: 'serviceName',
        label: 'Service / Team Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        cols: 6,
        options: ['dev', 'staging', 'production', 'all'],
      },
      {
        id: 'dashboardType',
        label: 'Dashboard Type',
        type: 'select',
        required: true,
        cols: 6,
        options: ['APM', 'Infrastructure', 'Logs', 'Synthetics', 'Custom'],
      },
      {
        id: 'accessLevel',
        label: 'Access Level',
        type: 'select',
        cols: 6,
        options: ['Read', 'Edit', 'Admin'],
      },
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        cols: 6,
        options: ['1 week', '1 month', '3 months', 'Permanent'],
      },
      {
        id: 'justification',
        label: 'Justification',
        type: 'textarea',
        cols: 12,
      },
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    description:
      'Request repository access, team membership, or organisation permissions.',
    icon: CodeIcon,
    accent: '#1F2937',
    fields: [
      {
        id: 'organisation',
        label: 'Organisation',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'repoName',
        label: 'Repository Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'accessLevel',
        label: 'Access Level',
        type: 'select',
        required: true,
        cols: 6,
        options: ['Read', 'Write', 'Maintain', 'Admin'],
      },
      { id: 'team', label: 'Team Name (optional)', type: 'text', cols: 6 },
      {
        id: 'justification',
        label: 'Justification',
        type: 'textarea',
        required: true,
        cols: 12,
        helperText: 'Describe why this access is needed.',
      },
    ],
  },
  {
    id: 'azure-vdi',
    label: 'Azure VDI',
    description:
      'Request an Azure Virtual Desktop session for remote development or admin work.',
    icon: DesktopWindowsIcon,
    accent: '#0369A1',
    fields: [
      {
        id: 'userEmail',
        label: 'User Email',
        type: 'email',
        required: true,
        cols: 6,
      },
      {
        id: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'vmSize',
        label: 'VM Size',
        type: 'select',
        required: true,
        cols: 6,
        options: [
          'Standard_D2s_v3 (2 vCPU / 8 GB)',
          'Standard_D4s_v3 (4 vCPU / 16 GB)',
          'Standard_D8s_v3 (8 vCPU / 32 GB)',
        ],
      },
      {
        id: 'region',
        label: 'Azure Region',
        type: 'select',
        cols: 6,
        options: ['australiaeast', 'uksouth', 'eastus2', 'westeurope'],
      },
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        cols: 6,
        options: ['1 week', '1 month', '3 months', 'Permanent'],
      },
      {
        id: 'justification',
        label: 'Business Justification',
        type: 'textarea',
        required: true,
        cols: 12,
      },
    ],
  },
  {
    id: 'svn',
    label: 'SVN',
    description:
      'Request access to a Subversion repository path for a user or team.',
    icon: StorageIcon,
    accent: '#92400E',
    fields: [
      {
        id: 'repoPath',
        label: 'Repository Path',
        type: 'text',
        required: true,
        cols: 6,
        helperText: 'e.g. /repos/project/trunk',
      },
      {
        id: 'userOrTeam',
        label: 'User / Team',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'accessLevel',
        label: 'Access Level',
        type: 'select',
        required: true,
        cols: 6,
        options: ['Read', 'Write', 'Admin'],
      },
      { id: 'expiryDate', label: 'Expiry Date', type: 'date', cols: 6 },
      {
        id: 'justification',
        label: 'Justification',
        type: 'textarea',
        cols: 12,
      },
    ],
  },
  {
    id: 'aws-workspace',
    label: 'AWS Workspace',
    description:
      'Provision an AWS WorkSpace for a user in the managed desktop fleet.',
    icon: CloudIcon,
    accent: '#B45309',
    fields: [
      {
        id: 'userEmail',
        label: 'User Email',
        type: 'email',
        required: true,
        cols: 6,
      },
      {
        id: 'awsRegion',
        label: 'AWS Region',
        type: 'select',
        required: true,
        cols: 6,
        options: ['us-east-1', 'ap-southeast-2', 'eu-west-1', 'ap-northeast-1'],
      },
      {
        id: 'bundle',
        label: 'Bundle Type',
        type: 'select',
        required: true,
        cols: 6,
        options: [
          'Value (1 vCPU / 2 GB)',
          'Standard (2 vCPU / 4 GB)',
          'Performance (2 vCPU / 8 GB)',
          'Power (4 vCPU / 16 GB)',
        ],
      },
      {
        id: 'runningMode',
        label: 'Running Mode',
        type: 'select',
        cols: 6,
        options: ['AutoStop', 'AlwaysOn'],
      },
      { id: 'directory', label: 'Directory ID', type: 'text', cols: 6 },
      {
        id: 'justification',
        label: 'Justification',
        type: 'textarea',
        required: true,
        cols: 12,
      },
    ],
  },
  {
    id: 'jenkins',
    label: 'Jenkins (PE - NEST)',
    description:
      'Trigger or configure a Jenkins pipeline job in the Platform Engineering NEST environment.',
    icon: BuildIcon,
    accent: '#D97706',
    fields: [
      {
        id: 'jobName',
        label: 'Job Name',
        type: 'text',
        required: true,
        cols: 6,
        helperText: 'Full job path, e.g. PE-NEST/deploy-service',
      },
      {
        id: 'branch',
        label: 'Repository Branch',
        type: 'text',
        required: true,
        cols: 6,
      },
      {
        id: 'environment',
        label: 'Target Environment',
        type: 'select',
        required: true,
        cols: 6,
        options: ['dev', 'test', 'staging', 'production'],
      },
      {
        id: 'priority',
        label: 'Priority',
        type: 'select',
        cols: 6,
        options: ['Low', 'Medium', 'High', 'Critical'],
      },
      {
        id: 'notifyEmail',
        label: 'Notification Email',
        type: 'email',
        cols: 6,
      },
      {
        id: 'parameters',
        label: 'Job Parameters',
        type: 'textarea',
        cols: 12,
        helperText: 'KEY=value pairs, one per line.',
      },
    ],
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  layout: {
    display: 'flex',
    minHeight: 'calc(100vh - 56px)',
    height: '100%',
  },

  // ── Secondary nav ──
  secondaryNav: {
    width: 248,
    flexShrink: 0,
    borderRight: '1px solid #E5E7EB',
    background: '#F9FAFB',
    display: 'flex',
    flexDirection: 'column',
  },
  navHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2, 2, 1),
  },
  navHeaderLabel: {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  navList: {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: theme.spacing(2),
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    padding: theme.spacing(0.875, 2),
    cursor: 'pointer',
    borderLeft: '3px solid transparent',
    transition: 'background 0.1s, border-color 0.1s',
    '&:hover': { background: '#F3F4F6' },
  },
  navItemActive: {
    borderLeftColor: '#6B21A8',
    background: '#FAF5FF',
    '&:hover': { background: '#FAF5FF' },
  },
  navIndex: {
    fontSize: '0.6rem',
    fontWeight: 800,
    color: '#D1D5DB',
    minWidth: 18,
    textAlign: 'right',
    marginLeft: 'auto',
    letterSpacing: 0.3,
  },
  navLabel: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#374151',
    lineHeight: 1.35,
    flex: 1,
  },
  navLabelActive: {
    color: '#5B21B6',
    fontWeight: 700,
  },

  // ── Main content ──
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: theme.spacing(3, 4),
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2) },
  },

  // ── Hero banner ──
  heroBanner: {
    borderRadius: 12,
    padding: theme.spacing(2.5, 3),
    color: '#FFFFFF',
    marginBottom: theme.spacing(3),
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  heroLeft: { flex: 1, minWidth: 0 },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    fontSize: '0.7rem',
    fontWeight: 700,
    marginBottom: theme.spacing(1),
    border: '1px solid rgba(255,255,255,0.3)',
  },
  heroTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    marginBottom: theme.spacing(0.25),
  },
  heroDesc: { fontSize: '0.875rem', opacity: 0.85, lineHeight: 1.5 },
  heroIcon: { fontSize: 52, opacity: 0.18, flexShrink: 0, alignSelf: 'center' },

  // ── Form card ──
  formCard: {
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    padding: theme.spacing(3),
    background: '#FFFFFF',
  },
  formTitle: {
    fontWeight: 700,
    fontSize: '1rem',
    color: '#111827',
    marginBottom: 4,
  },
  formSub: {
    fontSize: '0.8125rem',
    color: '#6B7280',
    marginBottom: theme.spacing(2.5),
  },
  compactField: {
    '& .MuiInputBase-input': {
      fontSize: '0.8125rem',
      paddingTop: 9,
      paddingBottom: 9,
    },
    '& .MuiInputLabel-root': { fontSize: '0.8125rem' },
    '& .MuiFormHelperText-root': {
      marginTop: 2,
      fontSize: '0.7rem',
      lineHeight: 1.3,
    },
  },

  // ── Review panel ──
  reviewPanel: {
    borderRadius: 10,
    border: '1px solid #C4B5FD',
    background: '#FAF5FF',
    padding: theme.spacing(2, 2.5),
    marginTop: theme.spacing(2.5),
  },
  reviewTitle: {
    fontWeight: 800,
    fontSize: '0.875rem',
    color: '#5B21B6',
    marginBottom: 12,
  },
  reviewRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(0.625),
    '&:last-child': { marginBottom: 0 },
  },
  reviewKey: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#6B7280',
    minWidth: 170,
    flexShrink: 0,
  },
  reviewVal: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#111827',
    wordBreak: 'break-word',
  },

  // ── Actions ──
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    marginTop: theme.spacing(3),
    paddingTop: theme.spacing(2.5),
    borderTop: '1px solid #E5E7EB',
    flexWrap: 'wrap',
  },
  reviewBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    borderColor: '#6B21A8',
    color: '#6B21A8',
    '&:hover': { background: '#FAF5FF', borderColor: '#5B21B6' },
  },
  submitBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    background: '#059669',
    color: '#FFFFFF',
    '&:hover': { background: '#047857' },
    '&:disabled': { background: '#D1D5DB', color: '#9CA3AF' },
  },
  clearBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    color: '#6B7280',
    borderColor: '#D1D5DB',
    '&:hover': { background: '#F3F4F6' },
  },

  // ── Success banner ──
  successBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#DCFCE7',
    border: '1px solid #86EFAC',
    borderRadius: 10,
    padding: '14px 20px',
    marginBottom: theme.spacing(2.5),
  },
  successText: { fontWeight: 700, color: '#065F46', fontSize: '0.875rem' },
}));

// ─── Welcome state ────────────────────────────────────────────────────────────

function WelcomeState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 360,
        gap: 16,
        color: '#6B7280',
      }}
    >
      <TuneIcon style={{ fontSize: 60, opacity: 0.15 }} />
      <Typography
        style={{ fontWeight: 700, fontSize: '1.0625rem', color: '#374151' }}
      >
        Eng. Tools
      </Typography>
      <Typography
        style={{
          fontSize: '0.875rem',
          textAlign: 'center',
          maxWidth: 380,
          lineHeight: 1.6,
        }}
      >
        Select a tool from the panel on the left to open its request form. Every
        form includes Review, Submit, and Clear actions.
      </Typography>
    </div>
  );
}

// ─── Tool form ────────────────────────────────────────────────────────────────

function ToolForm({ tool }: { tool: ToolDef }) {
  const classes = useStyles();
  const [values, setValues] = useState<FormValues>(() => emptyValues(tool));
  const [showReview, setShowReview] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const Icon = tool.icon;

  const onChange = (id: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setValues(prev => ({ ...prev, [id]: e.target.value }));

  const handleClear = () => {
    setValues(emptyValues(tool));
    setShowReview(false);
    setSubmitted(false);
  };

  const handleReview = () => setShowReview(true);

  const handleSubmit = () => {
    setSubmitted(true);
    setShowReview(false);
  };

  const filledFields = tool.fields.filter(f => values[f.id]);

  if (tool.id === 'github') {
    return (
      <GitHubToolForm
        accent={tool.accent}
        heroTitle={tool.label}
        heroDesc={tool.description}
      />
    );
  }

  return (
    <div>
      {/* Hero */}
      <div
        className={classes.heroBanner}
        style={{
          background: `linear-gradient(135deg, ${tool.accent} 0%, ${tool.accent}CC 100%)`,
        }}
      >
        <div className={classes.heroLeft}>
          <div className={classes.heroBadge}>
            <Icon style={{ fontSize: 11 }} />
            Eng. Tools
          </div>
          <Typography className={classes.heroTitle}>{tool.label}</Typography>
          <Typography className={classes.heroDesc}>
            {tool.description}
          </Typography>
        </div>
        <Icon className={classes.heroIcon} />
      </div>

      {/* Submitted confirmation */}
      {submitted && (
        <div className={classes.successBanner}>
          <CheckCircleIcon
            style={{ color: '#059669', fontSize: 20, flexShrink: 0 }}
          />
          <Typography className={classes.successText}>
            Request submitted successfully. You will receive a confirmation
            email shortly.
          </Typography>
        </div>
      )}

      {/* Form */}
      <div className={classes.formCard}>
        <Typography className={classes.formTitle}>
          {tool.label} — Request Form
        </Typography>
        <Typography className={classes.formSub}>
          Complete the fields below. Click <strong>Review</strong> to preview
          before submitting.
        </Typography>

        <Grid container spacing={2}>
          {tool.fields.map(field => (
            <Grid item xs={12} sm={field.cols ?? 6} key={field.id}>
              <TextField
                fullWidth
                select={field.type === 'select'}
                multiline={field.type === 'textarea'}
                rows={field.type === 'textarea' ? 3 : undefined}
                type={
                  field.type === 'select' || field.type === 'textarea'
                    ? undefined
                    : field.type
                }
                label={`${field.label}${field.required ? ' *' : ''}`}
                value={values[field.id] ?? ''}
                onChange={onChange(field.id)}
                helperText={field.helperText}
                variant="outlined"
                size="small"
                margin="none"
                className={classes.compactField}
                InputLabelProps={
                  field.type === 'date' ? { shrink: true } : undefined
                }
              >
                {field.type === 'select' &&
                  field.options?.map(opt => (
                    <MenuItem key={opt} value={opt}>
                      {opt}
                    </MenuItem>
                  ))}
              </TextField>
            </Grid>
          ))}
        </Grid>

        {/* Review panel */}
        {showReview && (
          <div className={classes.reviewPanel}>
            <Typography className={classes.reviewTitle}>
              Review — {tool.label} Request
            </Typography>
            {filledFields.length > 0 ? (
              filledFields.map(field => (
                <div key={field.id} className={classes.reviewRow}>
                  <span className={classes.reviewKey}>{field.label}</span>
                  <span className={classes.reviewVal}>{values[field.id]}</span>
                </div>
              ))
            ) : (
              <Typography style={{ fontSize: '0.8125rem', color: '#9CA3AF' }}>
                No fields filled in yet.
              </Typography>
            )}
          </div>
        )}

        {/* Actions */}
        <div className={classes.actions}>
          <Button
            variant="outlined"
            className={classes.reviewBtn}
            onClick={handleReview}
          >
            Review
          </Button>
          <Button
            variant="contained"
            className={classes.submitBtn}
            onClick={handleSubmit}
            disabled={!showReview}
          >
            Submit
          </Button>
          <Button
            variant="outlined"
            className={classes.clearBtn}
            onClick={handleClear}
          >
            Clear
          </Button>
          {submitted && (
            <Chip
              size="small"
              icon={
                <CheckCircleIcon style={{ color: '#059669', fontSize: 14 }} />
              }
              label="Submitted"
              style={{
                marginLeft: 'auto',
                background: '#DCFCE7',
                color: '#065F46',
                fontWeight: 700,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function EngToolsPage() {
  const classes = useStyles();
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const selected = TOOLS.find(t => t.id === activeTool) ?? null;

  return (
    <div className={classes.layout}>
      {/* ── Secondary sidebar ── */}
      <div className={classes.secondaryNav}>
        <div className={classes.navHeader}>
          <TuneIcon style={{ fontSize: 16, color: '#6B7280' }} />
          <Typography className={classes.navHeaderLabel}>Eng. Tools</Typography>
        </div>
        <Divider />
        <div className={classes.navList}>
          {TOOLS.map((tool, i) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <div
                key={tool.id}
                className={[
                  classes.navItem,
                  active ? classes.navItemActive : '',
                ].join(' ')}
                onClick={() => setActiveTool(tool.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ')
                    setActiveTool(tool.id);
                }}
                aria-pressed={active}
              >
                <Icon
                  style={{
                    fontSize: 16,
                    color: active ? tool.accent : '#9CA3AF',
                    flexShrink: 0,
                  }}
                />
                <Typography
                  className={[
                    classes.navLabel,
                    active ? classes.navLabelActive : '',
                  ].join(' ')}
                >
                  {tool.label}
                </Typography>
                <span className={classes.navIndex}>
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className={classes.content}>
        {selected ? (
          <ToolForm key={selected.id} tool={selected} />
        ) : (
          <WelcomeState />
        )}
      </div>
    </div>
  );
}
