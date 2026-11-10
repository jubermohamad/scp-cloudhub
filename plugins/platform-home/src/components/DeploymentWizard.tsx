/**
 * DeploymentWizard — multi-step self-service deployment dialog.
 *
 * Flow: collect + validate deployment details → review deployment metadata
 * → submit → track live status and logs over SSE. Execution remains in the
 * scripts pipeline; this component only calls the
 * deployment-control-plane `/deployments*` endpoints.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveDraft, loadDraft, clearDraft } from './deploymentDraftStorage';
import {
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Box,
  Paper,
  Stepper,
  Step,
  StepLabel,
  TextField,
  MenuItem,
  Chip,
  Link,
} from '@mui/material';
import { makeStyles } from '@mui/styles';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ReplayIcon from '@mui/icons-material/Replay';
import {
  calculateIngressTarget,
  useBackendEventStream,
  useBackendFetch,
} from '@internal/plugin-platform-common';
import {
  isTerminalStatus,
  readJson,
  statusStyle,
  PortalApplicationOption,
  PortalDeploymentOptions,
  PortalDeploymentRecord,
  PortalDeploymentDiffStatusView,
  PortalDeploymentStatusView,
  PortalDiscoveredCluster,
  PortalHealthProbeResult,
  PortalHelmfilePreview,
  PortalCommonResPreflightReport,
  PortalSecretProvisionStatusView,
  PortalSecretReadinessReport,
  PortalSecretFieldInfo,
  PortalSecretUpdateResult,
  DeploymentMode,
  DeploymentModeDetection,
  PortalSecretRefFinding,
} from './deploymentPortalTypes';
import {
  getHelmfileConsoleContent,
  mergeDeploymentEvents,
} from './deploymentEventUtils';
import { CustomerSelector } from './CustomerSelector';
import { OnePasswordPrerequisitesCard } from './OnePasswordPrerequisitesCard';
import { SecretReadinessModal } from './SecretReadinessModal';
import { ProvisioningFeedbackModal } from './ProvisioningFeedbackModal';

const CLOUDHUB_SUBSCRIPTION_ID = 'b0799078-b42a-4b59-9e70-22cd09a20ee2';
// Labeled to track the 5-stage CloudHub deployment model (Target & Release
// Configuration / Secret Readiness & Seeding / Diff & Impact Review /
// Approval & Execution Gate / Post-Deploy Verification) even though Diff and
// Approval share one Stepper step — they're one continuous review screen
// gated internally by `reviewPhase`, not two separate navigable steps.
const STEPS = [
  'Target & Release',
  'Secret Readiness',
  'Diff & Approval',
  'Deploy & Verify',
];

// Post-deploy verification: probe the live ingress until it answers 200.
// Pods, cert-manager and DNS can each take a few minutes after helmfile apply.
const HEALTH_POLL_INTERVAL_MS = 5000;
const HEALTH_POLL_TIMEOUT_MS = 10 * 60_000;

export type HealthCheckState = {
  phase: 'idle' | 'checking' | 'healthy' | 'timeout';
  result: PortalHealthProbeResult | null;
};

// Preset releases offered in the entity resolution chart version selector.
// This is a manually curated fallback list — it does not query a chart
// registry — so it should be refreshed as new Investigation Hub releases
// ship. Selecting a version here is written directly into 1Password's
// pipeline_refs section during Auto-Generate Secrets instead of leaving the
// field to default to 'latest'.
const ENTITY_RESOLUTION_CHART_VERSION_PRESETS = [
  '1.415.0',
  '1.411.0',
  '1.408.0',
];
const ENTITY_RESOLUTION_CHART_VERSION_FIELD_SUFFIX =
  'entity_resolution_chart_version';

const DEPLOYMENT_MODE_LABELS: Record<DeploymentMode, string> = {
  FRESH_INSTALL: 'Fresh Install',
  UPGRADE: 'Upgrade',
  ROLLBACK: 'Rollback',
  CONFIGURATION_UPDATE: 'Configuration Update',
};

// Resource kinds whose removal means real data loss, not just a config
// change — flagged as a blocking safety warning before Approve.
const DESTRUCTIVE_REMOVAL_KINDS = new Set([
  'persistentvolumeclaim',
  'persistentvolume',
  'statefulset',
  'secret',
]);

// The helm-diff plugin (github.com/databus23/helm-diff, what `helmfile diff`
// uses under the hood) prints one header line per changed resource in this
// stable, well-documented format:
//   "<namespace>, <name>, <Kind> (<apiVersion>) has been added:"
//   "<namespace>, <name>, <Kind> (<apiVersion>) has been removed:"
//   "<namespace>, <name>, <Kind> (<apiVersion>) has changed:"
// Raw GitHub Actions job logs prefix each line with an ISO timestamp, and
// runLogs() (backend) prefixes it again with "[job-name] ". Both are
// stripped before matching.
const HELM_DIFF_HEADER_RE =
  /^\s*([^,]*),\s*([^,]+),\s*([A-Za-z][\w.]*)\s*(?:\([^)]*\))?\s+has (been added|been removed|changed):?\s*$/i;

const CUSTOMER_NAME_RE = /^[a-z0-9-]+$/;
const PRODUCTION_ENVIRONMENTS = new Set(['prod', 'production']);

export function validateCustomerName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Customer is required.';
  }
  if (!CUSTOMER_NAME_RE.test(trimmed)) {
    return 'Customer may only contain lowercase letters, numbers, and hyphens.';
  }
  return null;
}

interface HelmDiffSummary {
  parsed: boolean;
  added: string[];
  modified: string[];
  removed: string[];
  destructiveRemovals: string[];
}

function cleanDiffLogLine(raw: string): string {
  return (
    raw
      .replace(/^\[[^\]]*\]\s*/, '')
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
  );
}

function parseHelmDiffSummary(events: DeploymentEvent[]): HelmDiffSummary {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const destructiveRemovals: string[] = [];

  for (const event of events) {
    if (event.eventType !== 'diff-log' || !event.note) continue;
    const match = cleanDiffLogLine(event.note).match(HELM_DIFF_HEADER_RE);
    if (!match) continue;
    const [, , name, kind, action] = match;
    const label = `${kind} "${name.trim()}"`;
    if (action.toLowerCase() === 'been added') {
      added.push(label);
    } else if (action.toLowerCase() === 'been removed') {
      removed.push(label);
      if (DESTRUCTIVE_REMOVAL_KINDS.has(kind.trim().toLowerCase())) {
        destructiveRemovals.push(label);
      }
    } else {
      modified.push(label);
    }
  }

  return {
    parsed: added.length + modified.length + removed.length > 0,
    added,
    modified,
    removed,
    destructiveRemovals,
  };
}

// Mirrors the backend's field-name classification in
// onePasswordSecretReadinessService.ts (isPipelineControlField,
// isRandomSecretField, isTlsMaterialField), reimplemented client-side since
// PortalSecretRefFinding carries no category of its own. Checked in this
// order because the substring checks can overlap (e.g. "key" inside
// "client_secret"-shaped names) — pipeline fields first, then secrets, then
// TLS, everything else falls into "Helmfile Tokens (Git)".
const PIPELINE_REF_FIELD_NAMES = new Set([
  'helm_chart_version',
  'helm_chart_values_file_ref',
  'project_overlay_files_ref',
  'project_overlay_branch',
  'deployment_branch',
  'entity_resolution_chart_version',
]);
const RANDOM_SECRET_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'client_secret',
  'jwt',
  'salt',
  'credential',
  'passphrase',
];
const TLS_MATERIAL_SUBSTRINGS = [
  '__base64__',
  'certificate',
  'cert',
  'crt',
  'tls',
  'pem',
  'private_key',
  'key',
];

type SecretFieldCategory = 'pipeline' | 'password' | 'tls' | 'helmfileToken';

function categorizeSecretField(field: string): SecretFieldCategory {
  const normalized = field.toLowerCase();
  const bareField = normalized.slice(normalized.lastIndexOf('__') + 2);
  if (
    PIPELINE_REF_FIELD_NAMES.has(normalized) ||
    PIPELINE_REF_FIELD_NAMES.has(bareField)
  ) {
    return 'pipeline';
  }
  if (RANDOM_SECRET_SUBSTRINGS.some(part => normalized.includes(part))) {
    return 'password';
  }
  if (TLS_MATERIAL_SUBSTRINGS.some(part => normalized.includes(part))) {
    return 'tls';
  }
  return 'helmfileToken';
}

const SECRET_CATEGORY_LABELS: Record<SecretFieldCategory, string> = {
  pipeline: 'Pipeline Refs',
  password: 'Infrastructure Passwords',
  tls: 'Certificates',
  helmfileToken: 'Helmfile Tokens',
};

function findsUnresolvedEntityResolutionChartVersion(
  report: PortalSecretReadinessReport | null,
): boolean {
  if (!report) return false;
  return report.findings.some(
    finding =>
      finding.field
        .toLowerCase()
        .endsWith(ENTITY_RESOLUTION_CHART_VERSION_FIELD_SUFFIX) &&
      ['MISSING', 'EMPTY', 'PLACEHOLDER'].includes(finding.status),
  );
}

// Review-step gate: the Deploy action only unlocks after metadata validation,
// review, and approval.
type ReviewPhase =
  | 'summary'
  | 'diffing'
  | 'diffed'
  | 'generating'
  | 'generated'
  | 'saved'
  | 'review'
  | 'approved';

interface DeploymentWizardProps {
  open: boolean;
  onClose: () => void;
  preselectedApp?: string;
  deploymentLabel?: string;
  initialInstanceName?: string;
  initialClusterName?: string;
  onDeployed?: () => void;
  /** 'dialog' (default) renders inside a MUI Dialog; 'page' renders inline as a full-width page section. */
  mode?: 'dialog' | 'page';
  /** sessionStorage draft key (componentId). Required when mode='page' for draft persistence. */
  draftKey?: string;
}

interface DeploymentEvent {
  id: string;
  eventType: string;
  fromStatus?: string;
  toStatus?: string;
  actor?: string;
  actorRole?: string;
  note?: string;
  createdAt: string;
}

const LIVE_LOG_PANEL_ID = 'deployment-live-log-panel';

interface FormState {
  application: string;
  instanceName: string;
  clusterName: string;
  vault: string;
  customer: string;
  chartVersion: string;
  aiStoreIntegration: boolean;
}

type InstanceOperation = 'update-existing' | 'new-instance';

const EMPTY_FORM: FormState = {
  application: '',
  instanceName: '',
  clusterName: '',
  vault: '',
  customer: '',
  chartVersion: '',
  aiStoreIntegration: false,
};

const useStyles = makeStyles(theme => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    width: '100%',
    minWidth: 0,
    overflowX: 'hidden',
    overflowY: 'auto',
    paddingRight: theme.spacing(1),
    '& a': {
      textDecoration: 'none',
      color: '#464feb',
    },
    [theme.breakpoints.down('sm')]: {
      gap: theme.spacing(1.5),
      paddingRight: theme.spacing(1),
    },
  },
  contentPage: {
    overflowY: 'visible',
    paddingRight: 0,
  },
  stepper: {
    padding: theme.spacing(2, 1, 3),
    overflow: 'visible',
    backgroundColor: 'transparent',
    '& .MuiStep-root': {
      position: 'relative',
      zIndex: 1,
    },
    '& .MuiStepLabel-root': {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 72,
      gap: 0,
    },
    '& .MuiStepLabel-iconContainer': {
      position: 'relative',
      zIndex: 2,
      backgroundColor: '#FFFFFF',
      borderRadius: '50%',
      padding: '6px',
      order: 2,
      marginTop: 8,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    '& .MuiStepLabel-labelContainer': {
      marginBottom: 3,
      textAlign: 'center',
      maxWidth: 145,
      position: 'relative',
      zIndex: 2,
      order: 1,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    '& .MuiStepLabel-label': {
      fontSize: '0.8125rem',
      fontWeight: 500,
      lineHeight: 1.4,
      letterSpacing: '0.01em',
      color: '#6B7280',
      whiteSpace: 'nowrap',
      transition: 'color 0.3s ease',
    },
    '& .MuiStepLabel-label.MuiStepLabel-active': {
      color: '#1F2937',
      fontWeight: 700,
      fontSize: '0.8375rem',
    },
    '& .MuiStepLabel-label.MuiStepLabel-completed': {
      color: '#059669',
      fontWeight: 600,
    },
    '& .MuiStepIcon-root': {
      width: 36,
      height: 36,
      color: '#9CA3AF',
      border: '2px solid #D1D5DB',
      borderRadius: '50%',
      backgroundColor: '#F9FAFB',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '0.875rem',
      fontWeight: 700,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    '& .MuiStepIcon-root.Mui-active': {
      color: '#FFFFFF',
      borderColor: theme.palette.primary.main,
      backgroundColor: theme.palette.primary.main,
      boxShadow:
        '0 0 0 8px rgba(70, 79, 235, 0.1), 0 4px 12px rgba(70, 79, 235, 0.3)',
      transform: 'scale(1.08)',
    },
    '& .MuiStepIcon-root.Mui-completed': {
      color: '#FFFFFF',
      borderColor: '#059669',
      backgroundColor: '#059669',
      boxShadow: '0 2px 8px rgba(5, 150, 105, 0.2)',
    },
    '& .MuiStepConnector-root': {
      display: 'none',
    },
    [theme.breakpoints.down('sm')]: {
      padding: theme.spacing(1.5, 0.5, 2),
      '& .MuiStepLabel-root': {
        minHeight: 60,
      },
      '& .MuiStepLabel-labelContainer': {
        maxWidth: 100,
        marginBottom: 2,
      },
      '& .MuiStepLabel-label': {
        fontSize: '0.75rem',
        whiteSpace: 'normal',
        fontWeight: 500,
      },
      '& .MuiStepLabel-label.MuiStepLabel-active': {
        fontSize: '0.8rem',
        fontWeight: 700,
      },
      '& .MuiStepIcon-root': {
        width: 32,
        height: 32,
        fontSize: '0.8rem',
      },
    },
  },
  statusBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
  },
  errorBox: { backgroundColor: '#FEF2F2' },
  errorText: { color: '#DC2626', fontSize: '0.875rem' },
  infoBox: {
    backgroundColor: '#EFF6FF',
    padding: theme.spacing(1.5),
    borderRadius: 8,
  },
  infoText: { color: '#1e40af', fontSize: '0.8rem' },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(3),
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(280px, 520px))',
    gap: theme.spacing(1.25),
    justifyContent: 'center',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1.5),
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1.25),
    },
  },
  stepOneGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 420px) minmax(260px, 420px) minmax(280px, 380px)',
    gap: theme.spacing(2),
    alignItems: 'start',
    justifyContent: 'center',
    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: 'minmax(240px, 1fr) minmax(240px, 1fr)',
      '& $stepOneStatusColumn': {
        gridColumn: '1 / -1',
      },
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1.25),
      '& $stepOneStatusColumn': {
        gridColumn: '1',
      },
    },
  },
  stepOneColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  stepOneStatusColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
    height: '100%',
  },
  stepOneActions: {
    marginTop: 'auto',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(1),
    [theme.breakpoints.down('sm')]: {
      justifyContent: 'stretch',
      '& > *': {
        flex: 1,
      },
    },
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  formLabel: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    lineHeight: 1.1,
  },
  formHelper: {
    fontSize: '0.72rem',
    color: '#6B7280',
    lineHeight: 1.35,
    minHeight: '1.1em',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
  },
  summaryItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  summaryLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryValue: { fontSize: '0.9rem', fontWeight: 500, color: '#111827' },
  codeBlock: {
    margin: 0,
    padding: theme.spacing(1.5),
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    fontSize: '0.75rem',
    lineHeight: 1.5,
    maxHeight: 320,
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre',
  },
  statusChip: {
    fontWeight: 700,
    fontSize: '0.7rem',
    height: 22,
  },
  stepCard: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    borderRadius: 8,
    border: '1px solid #E5E7EB',
  },
  monoPath: {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.78rem',
    color: '#334155',
    wordBreak: 'break-all',
  },
  reviewLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    alignItems: 'start',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: '1fr',
    },
  },
  reviewLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  reviewRight: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    minWidth: 0,
  },
  panelTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: '#6B7280',
  },
  placeholder: {
    padding: theme.spacing(3),
    borderRadius: 8,
    border: '1px dashed #CBD5E1',
    textAlign: 'center',
    backgroundColor: '#F8FAFC',
  },
  codeBlockTall: {
    margin: 0,
    padding: theme.spacing(1.5),
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    fontSize: '0.72rem',
    lineHeight: 1.5,
    maxHeight: 460,
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre',
  },
  summaryColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.25),
    padding: theme.spacing(2),
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
  },
  phaseList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1.5),
    borderRadius: 8,
    border: '1px solid #E5E7EB',
  },
  phaseItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  phaseText: {
    fontSize: '0.82rem',
    fontWeight: 500,
  },
  summaryTable: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    '& th, & td': {
      border: '1px solid #e6e6e6',
      padding: theme.spacing(1, 1.5),
      fontSize: '0.85rem',
      textAlign: 'left',
    },
    '& th': {
      backgroundColor: '#f5f5f5',
      fontWeight: 600,
      color: '#374151',
      width: '35%',
    },
    '& td': {
      color: '#111827',
      fontWeight: 500,
    },
  },
  resolvedBox: {
    gridColumn: '1 / -1',
    marginTop: theme.spacing(0.25),
    maxWidth: 560,
    width: '100%',
    justifySelf: 'center',
  },
  resolvedCard: {
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    padding: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  resolvedItem: {
    fontSize: '0.84rem',
    color: '#475569',
    lineHeight: 1.4,
    '& strong': {
      color: '#111827',
      fontWeight: 700,
    },
  },
  successBox: { backgroundColor: '#ECFDF5' },
  successText: { color: '#059669', fontSize: '0.875rem' },
  pageRoot: {
    display: 'block',
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 4px rgba(15,23,42,0.08)',
    // overflow: clip gives border-radius visual clipping without creating a BFC
    // or scroll container — keeps the Backstage outer scroll chain intact.
    overflow: 'clip' as 'hidden',
  },
  pageSection: {
    padding: theme.spacing(2),
    '& .MuiDialogContent-root': {
      overflow: 'visible',
      maxHeight: 'none',
      flex: 'none',
      display: 'block',
    },
  },
}));

// Mirrors the backend flow: all user-actionable secrets must be populated,
// but pipeline-controlled refs (helm chart version / branch / overlay refs)
// are considered effectively ready once they are the only remaining blockers.
export function isEffectivelyReady(
  report: PortalSecretReadinessReport | null | undefined,
): boolean {
  if (!report) {
    return false;
  }

  if (report.ready) {
    return true;
  }

  const remainingBlocked = [
    ...(report.missing ?? []),
    ...(report.placeholders ?? []),
  ];

  if (remainingBlocked.length === 0) {
    return false;
  }

  return remainingBlocked.every(finding => isPipelineControlField(finding.field));
}

function isPipelineControlField(field: string): boolean {
  const normalized = (field || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return false;
  }

  const pipelineControlFields = new Set([
    'helm_chart_version',
    'helm_chart_values_file_ref',
    'project_overlay_files_ref',
    'project_overlay_branch',
    'deployment_branch',
    'entity_resolution_chart_version',
  ]);

  if (pipelineControlFields.has(normalized)) {
    return true;
  }

  const doubleSepIdx = normalized.lastIndexOf('__');
  if (doubleSepIdx !== -1) {
    return pipelineControlFields.has(normalized.slice(doubleSepIdx + 2));
  }

  return false;
}

function formatRegionName(region?: string): string {
  if (!region) return '—';
  const clean = region.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map: Record<string, string> = {
    swedencentral: 'Sweden Central',
    francecentral: 'France Central',
    eastus: 'East US',
    eastus2: 'East US 2',
    westus: 'West US',
    westeurope: 'West Europe',
    northeurope: 'North Europe',
    centralindia: 'Central India',
    southcentralus: 'South Central US',
  };
  return map[clean] || region;
}

function toStatusView(
  record: PortalDeploymentRecord,
): PortalDeploymentStatusView {
  return {
    deploymentId: record.id,
    workflowRunId: record.workflowRunId,
    status: record.status,
    currentStep: record.currentStep,
    workflowRunUrl: record.workflowRunUrl,
    statusMessage: record.statusMessage,
    failureReason: record.failureReason,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    commitSha: record.commitSha,
    mode: record.mode,
  };
}

function approvalBadge(
  record: PortalDeploymentRecord | null,
  phase: ReviewPhase,
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | null,
): {
  label: string;
  bg: string;
  fg: string;
} {
  if (record?.status === 'REJECTED' || status === 'REJECTED') {
    return { label: 'Rejected', bg: '#FEF2F2', fg: '#B91C1C' };
  }

  if (
    record?.status === 'PENDING_APPROVAL' ||
    (phase === 'review' && status === 'PENDING')
  ) {
    return { label: 'Pending Approval', bg: '#FEF9C3', fg: '#92400E' };
  }

  if (
    record?.status === 'APPROVED' ||
    record?.status === 'DISPATCHING' ||
    record?.status === 'QUEUED' ||
    record?.status === 'DEPLOYING' ||
    record?.status === 'SUCCEEDED' ||
    record?.status === 'FAILED' ||
    phase === 'approved' ||
    status === 'APPROVED'
  ) {
    return { label: 'Approved', bg: '#ECFDF5', fg: '#047857' };
  }

  if (record?.status === 'PENDING' || phase === 'saved') {
    return { label: 'Saved', bg: '#EFF6FF', fg: '#1D4ED8' };
  }

  return { label: 'Not Saved', bg: '#F3F4F6', fg: '#4B5563' };
}

function diffStatusLabel(status: PortalDeploymentDiffStatusView): string {
  if (status.status === 'completed') {
    return status.conclusion === 'success' ? 'Succeeded' : 'Failed';
  }
  if (status.status === 'in_progress') {
    return 'Running';
  }
  return 'Queued';
}

function diffStatusColors(status: PortalDeploymentDiffStatusView): {
  bg: string;
  fg: string;
} {
  if (status.status === 'completed' && status.conclusion === 'success') {
    return { bg: '#ECFDF5', fg: '#065F46' };
  }
  if (status.status === 'completed') {
    return { bg: '#FEF2F2', fg: '#B91C1C' };
  }
  if (status.status === 'in_progress') {
    return { bg: '#EFF6FF', fg: '#1D4ED8' };
  }
  return { bg: '#FEF9C3', fg: '#92400E' };
}

export function DeploymentWizard({
  open,
  onClose,
  preselectedApp,
  deploymentLabel,
  initialInstanceName,
  initialClusterName,
  onDeployed,
  mode = 'dialog',
  draftKey,
}: DeploymentWizardProps): JSX.Element {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const openEventStream = useBackendEventStream();

  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [options, setOptions] = useState<PortalDeploymentOptions | null>(null);
  const [clusters, setClusters] = useState<PortalDiscoveredCluster[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PortalHelmfilePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<PortalDeploymentRecord | null>(
    null,
  );
  const [statusView, setStatusView] =
    useState<PortalDeploymentStatusView | null>(null);
  const [healthCheck, setHealthCheck] = useState<HealthCheckState>({
    phase: 'idle',
    result: null,
  });
  const [healthCheckAttempt, setHealthCheckAttempt] = useState(0);
  const [deploymentEvents, setDeploymentEvents] = useState<DeploymentEvent[]>(
    [],
  );
  const [reviewPhase, setReviewPhase] = useState<ReviewPhase>('summary');
  const [canApprove, setCanApprove] = useState(false);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<
    'PENDING' | 'APPROVED' | 'REJECTED' | null
  >(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [savingDeployment, setSavingDeployment] = useState(false);
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffStatus, setDiffStatus] =
    useState<PortalDeploymentDiffStatusView | null>(null);
  const [diffEvents, setDiffEvents] = useState<DeploymentEvent[]>([]);
  const [acknowledgedDestructiveDiff, setAcknowledgedDestructiveDiff] =
    useState(false);
  const [secretReport, setSecretReport] =
    useState<PortalSecretReadinessReport | null>(null);
  const [loadingSecretReport, setLoadingSecretReport] = useState(false);
  const [secretReportError, setSecretReportError] = useState<string | null>(
    null,
  );
  const diffSummary = useMemo(
    () => parseHelmDiffSummary(diffEvents),
    [diffEvents],
  );
  const categorizedSecretFindings = useMemo(() => {
    const groups: Record<SecretFieldCategory, PortalSecretRefFinding[]> = {
      pipeline: [],
      password: [],
      tls: [],
      helmfileToken: [],
    };
    for (const finding of secretReport?.findings ?? []) {
      groups[categorizeSecretField(finding.field)].push(finding);
    }
    return groups;
  }, [secretReport]);
  const [entityResolutionChartVersion, setEntityResolutionChartVersion] =
    useState<string>(ENTITY_RESOLUTION_CHART_VERSION_PRESETS[0]);
  const [
    entityResolutionChartVersionMode,
    setEntityResolutionChartVersionMode,
  ] = useState<'preset' | 'custom'>('preset');
  const [modeDetection, setModeDetection] =
    useState<DeploymentModeDetection | null>(null);
  const [loadingModeDetection, setLoadingModeDetection] = useState(false);
  const [modeDetectionError, setModeDetectionError] = useState<string | null>(
    null,
  );
  const [bypassOnePasswordValidation, setBypassOnePasswordValidation] =
    useState(false);
  const [provisioningFeedbackOpen, setProvisioningFeedbackOpen] =
    useState(false);
  const [provisioningReport, setProvisioningReport] =
    useState<PortalSecretProvisionStatusView | null>(null);
  const [provisioningLogs, setProvisioningLogs] = useState<
    Array<{
      step: string;
      status: 'SUCCESS' | 'FAILED' | 'INFO' | 'WARNING';
      detail: string;
      timestamp: string;
    }>
  >([]);
  const [provisioningLoading, setProvisioningLoading] = useState(false);
  const [provisioningError, setProvisioningError] = useState<string | null>(
    null,
  );
  const provisioningStreamAbortRef = useRef<AbortController | null>(null);
  const [fieldsNeedingValues, setFieldsNeedingValues] = useState<
    PortalSecretFieldInfo[]
  >([]);
  const [loadingFields, setLoadingFields] = useState(false);
  void loadingFields;
  const [secretEditorOpen, setSecretEditorOpen] = useState(false);
  const [fieldUpdateValues, setFieldUpdateValues] = useState<
    Record<string, string>
  >({});
  const [updatingFieldReference, setUpdatingFieldReference] = useState<
    string | null
  >(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const deploymentRequestId = useRef<string | null>(null);
  const lastStatusEventRef = useRef<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [customChartVersion, setCustomChartVersion] = useState(false);
  const [instanceOperation, setInstanceOperation] =
    useState<InstanceOperation>('new-instance');

  const selectedApp: PortalApplicationOption | undefined =
    options?.applications.find(a => a.appName === form.application);
  const vaultOptions = options?.vaults ?? [];
  const customerOptions = useMemo(() => {
    return (form.vault && options?.customersByVault?.[form.vault]) || [];
  }, [form.vault, options?.customersByVault]);
  const selectedCluster = clusters.find(
    cluster => cluster.clusterName === form.clusterName,
  );
  const isProductionTarget = PRODUCTION_ENVIRONMENTS.has(
    (selectedCluster?.environment ?? '').toLowerCase(),
  );
  const [knownInstances, setKnownInstances] = useState<string[]>([]);

  useEffect(() => {
    if (!form.application) {
      setKnownInstances([]);
      return undefined;
    }
    let cancelled = false;
    backendFetch(
      'deployment-control-plane',
      `/deployments/instances?application=${encodeURIComponent(form.application)}`,
    )
      .then(async r => {
        if (!r.ok) return;
        const data = await readJson(r);
        if (cancelled) return;
        if (Array.isArray(data?.instances)) {
          const names = data.instances
            .map((inst: any) => String(inst.appInstance ?? ''))
            .filter(Boolean);
          setKnownInstances(Array.from(new Set(names)));
        }
      })
      .catch(() => {
        // Non-fatal
      });
    return () => {
      cancelled = true;
    };
  }, [backendFetch, form.application]);

  useEffect(() => {
    if (instanceOperation !== 'update-existing') {
      return;
    }
    setForm(prev => {
      const trimmed = prev.instanceName.trim();
      if (trimmed && knownInstances.includes(trimmed)) {
        return prev;
      }
      return {
        ...prev,
        instanceName: knownInstances[0] ?? '',
      };
    });
  }, [instanceOperation, knownInstances]);

  useEffect(() => {
    if (selectedApp?.chartVersions?.[0] && !form.chartVersion) {
      setForm(prev => ({
        ...prev,
        chartVersion: prev.chartVersion || selectedApp.chartVersions[0],
      }));
    }
  }, [selectedApp, form.chartVersion]);

  const resetAll = useCallback(() => {
    setActiveStep(0);
    setInstanceOperation('new-instance');
    setCustomChartVersion(false);
    setEntityResolutionChartVersionMode('preset');
    setEntityResolutionChartVersion(
      ENTITY_RESOLUTION_CHART_VERSION_PRESETS[0],
    );
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setPreview(null);
    setPreviewError(null);
    setSubmitError(null);
    setDeployment(null);
    setStatusView(null);
    setDeploymentEvents([]);
    setReviewPhase('summary');
    setApprovalId(null);
    setApprovalStatus(null);
    setApprovalError(null);
    setSavingDeployment(false);
    setDiffBusy(false);
    setDiffError(null);
    setDiffStatus(null);
    setDiffEvents([]);
    setAcknowledgedDestructiveDiff(false);
    setModeDetection(null);
    setModeDetectionError(null);
    setSecretReport(null);
    setSecretReportError(null);
    setBypassOnePasswordValidation(false);
    setFieldsNeedingValues([]);
    setLoadingFields(false);
    setSecretEditorOpen(false);
    setFieldUpdateValues({});
    setUpdatingFieldReference(null);
    provisioningStreamAbortRef.current?.abort();
    provisioningStreamAbortRef.current = null;
    setProvisioningFeedbackOpen(false);
    setProvisioningReport(null);
    setProvisioningLogs([]);
    setProvisioningLoading(false);
    setProvisioningError(null);
    deploymentRequestId.current = null;
    lastStatusEventRef.current = null;
  }, []);

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const optionsResp = await backendFetch(
        'deployment-control-plane',
        '/deployments/options',
      );
      const optionsData = (await readJson(
        optionsResp,
      )) as PortalDeploymentOptions;
      if (!optionsResp.ok) {
        throw new Error(
          (optionsData as any)?.error ?? 'Failed to load deployment options',
        );
      }
      setOptions(optionsData);

      let discovered: PortalDiscoveredCluster[] = [];
      try {
        const clustersResp = await backendFetch(
          'deployment-control-plane',
          `/clusters/deployable?subscriptionId=${CLOUDHUB_SUBSCRIPTION_ID}`,
        );
        const clustersData = await readJson(clustersResp);
        if (!clustersResp.ok) {
          throw new Error(
            clustersData?.error ??
              'Failed to load CloudHub-tagged Kubernetes clusters',
          );
        }
        discovered = Array.isArray(clustersData.clusters)
          ? clustersData.clusters
          : [];
        setClusters(discovered);
      } catch (clusterError) {
        // Silently fail - clusters list is optional, deployment can still proceed
        setClusters([]);
      }

      const app =
        optionsData.applications.find(a => a.appName === preselectedApp) ??
        optionsData.applications[0];
      const slugify = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

      const defaultVault = optionsData.vaults?.[0] ?? '';
      const defaultCustomers = defaultVault
        ? optionsData.customersByVault?.[defaultVault] ?? []
        : [];
      const defaultCustomer = defaultCustomers[0] ?? '';

      setForm(prev => ({
        ...prev,
        application: app?.appName ?? '',
        instanceName: initialInstanceName ?? prev.instanceName,
        clusterName: initialClusterName ?? discovered[0]?.clusterName ?? '',
        vault: defaultVault,
        chartVersion: app?.chartVersions[0] ?? '',
        // store canonical slug for customer
        customer: defaultCustomer ? slugify(defaultCustomer) : '',
      }));

      try {
        const permResp = await backendFetch(
          'deployment-control-plane',
          '/deployments/approvals/permissions',
        );
        const permData = await readJson(permResp);
        setCanApprove(Boolean(permData?.canApprove));
      } catch {
        setCanApprove(false);
      }
    } catch (error) {
      setOptionsError(
        error instanceof Error ? error.message : 'Failed to load options',
      );
    } finally {
      setLoadingOptions(false);
    }
  }, [backendFetch, preselectedApp, initialInstanceName, initialClusterName]);

  useEffect(() => {
    if (mode === 'page') {
      // Page mode: try to restore a saved draft on mount; always load options.
      if (draftKey) {
        const draft = loadDraft(draftKey);
        if (draft) {
          setForm({ ...draft.form, vault: draft.form.vault ?? '' });
          setActiveStep(draft.activeStep);
          setBypassOnePasswordValidation(draft.bypassOnePasswordValidation);
          setInstanceOperation(draft.instanceOperation ?? 'new-instance');
          setDraftRestored(true);
        } else {
          resetAll();
        }
      } else {
        resetAll();
      }
      void loadOptions();
    } else if (open) {
      resetAll();
      void loadOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  useEffect(() => {
    if (isProductionTarget && bypassOnePasswordValidation) {
      setBypassOnePasswordValidation(false);
    }
  }, [isProductionTarget, bypassOnePasswordValidation]);

  useEffect(() => {
    setSecretReport(null);
    setSecretReportError(null);
    setProvisioningReport(null);
    setProvisioningLogs([]);
    setProvisioningError(null);
    setDiffBusy(false);
    setDiffError(null);
    setDiffStatus(null);
    setDiffEvents([]);
  }, [form.application, form.instanceName, form.customer, form.clusterName]);

  // Page mode: persist draft to sessionStorage on every form change
  useEffect(() => {
    if (mode !== 'page' || !draftKey) return;
    const isEmpty =
      activeStep === 0 &&
      form.application === EMPTY_FORM.application &&
      form.instanceName === EMPTY_FORM.instanceName &&
      form.clusterName === EMPTY_FORM.clusterName &&
      form.vault === EMPTY_FORM.vault &&
      form.customer === EMPTY_FORM.customer;
    if (isEmpty) {
      clearDraft(draftKey);
    } else {
      saveDraft(draftKey, {
        form,
        activeStep,
        bypassOnePasswordValidation,
        instanceOperation,
        savedAt: new Date().toISOString(),
      });
    }
  }, [
    mode,
    draftKey,
    form,
    activeStep,
    bypassOnePasswordValidation,
    instanceOperation,
  ]);

  const validateDetails = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!form.application) errors.application = 'Select an application.';
    const name = form.instanceName.trim();
    if (instanceOperation === 'update-existing') {
      if (knownInstances.length === 0) {
        errors.instanceName =
          'No existing app instances were found for this application. Switch to New App Instance.';
      } else if (!name) {
        errors.instanceName = 'Select an existing app instance.';
      } else if (!knownInstances.includes(name)) {
        errors.instanceName = 'Select an existing app instance from the dropdown.';
      }
    } else if (!name) {
      errors.instanceName = 'Instance Name is required.';
    } else if (name.length > 63) {
      errors.instanceName = 'Must be 63 characters or fewer.';
    } else if (!/^[a-z0-9-]+$/.test(name)) {
      errors.instanceName =
        'Instance Name may only contain lowercase letters, numbers, and hyphens.';
    }
    if (!form.clusterName) errors.clusterName = 'Select a target AKS cluster.';
    if (!form.vault) {
      errors.vault = 'Select a 1Password vault.';
    }
    const customerError = validateCustomerName(form.customer);
    if (customerError) errors.customer = customerError;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [
    form.application,
    form.clusterName,
    form.customer,
    form.instanceName,
    form.vault,
    instanceOperation,
    knownInstances,
    vaultOptions.length,
    setFieldErrors,
  ]);

  const detailsReadyForReadiness = Boolean(
    form.application &&
      form.customer &&
      form.clusterName &&
      Boolean(form.vault) &&
      CUSTOMER_NAME_RE.test(form.customer.trim()) &&
      (instanceOperation === 'update-existing'
        ? knownInstances.includes(form.instanceName.trim())
        : /^[a-z0-9-]+$/.test(form.instanceName.trim())) &&
      form.instanceName.trim().length > 0 &&
      form.instanceName.trim().length <= 63,
  );

  const loadPreview = useCallback(async (): Promise<boolean> => {
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        '/deployments/preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deploymentId:
              deploymentRequestId.current ??
              (deploymentRequestId.current = crypto.randomUUID()),
            application: form.application,
            instanceName: form.instanceName.trim(),
            clusterName: form.clusterName,
            subscriptionId:
              selectedCluster?.subscriptionId || CLOUDHUB_SUBSCRIPTION_ID,
            resourceGroup: selectedCluster?.resourceGroup,
            customer: form.customer,
            chartVersion: form.chartVersion,
            aiStoreIntegration: form.aiStoreIntegration,
          }),
        },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Failed to load deployment metadata');
      }
      setPreview(data as PortalHelmfilePreview);
      return true;
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : 'Failed to generate preview',
      );
      return false;
    } finally {
      setLoadingPreview(false);
    }
  }, [backendFetch, form, selectedCluster]);

  const runSecretReadinessCheck = useCallback(
    async (
      forceRefresh = false,
    ): Promise<PortalSecretReadinessReport | null> => {
      setLoadingSecretReport(true);
      setSecretReportError(null);
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          '/deployments/secret-readiness',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              application: form.application,
              instanceName: form.instanceName.trim(),
              customer: form.customer,
              vault: form.vault || undefined,
              clusterName: form.clusterName,
              includePipelineRefs: true,
              forceRefresh,
            }),
          },
        );
        const data = await readJson(resp);
        if (!resp.ok) {
          throw new Error(
            data?.error ?? `1Password readiness check failed (${resp.status})`,
          );
        }
        const report = data as PortalSecretReadinessReport;
        setSecretReport(report);
        return report;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : '1Password readiness check failed';
        setSecretReportError(message);
        setSecretReport(null);
        return null;
      } finally {
        setLoadingSecretReport(false);
      }
    },
    [
      backendFetch,
      form.application,
      form.instanceName,
      form.customer,
      form.vault,
      form.clusterName,
    ],
  );

  const runModeDetection = useCallback(async () => {
    if (!form.application || !form.instanceName.trim() || !form.customer) {
      setModeDetection(null);
      return;
    }
    setLoadingModeDetection(true);
    setModeDetectionError(null);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        '/deployments/detect-mode',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            application: form.application,
            instanceName: form.instanceName.trim(),
            customer: form.customer,
            vault: form.vault || undefined,
            targetChartVersion: form.chartVersion || undefined,
            clusterName: form.clusterName || undefined,
            subscriptionId: selectedCluster?.subscriptionId,
            resourceGroup: selectedCluster?.resourceGroup,
          }),
        },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(
          data?.error ?? `Deployment mode detection failed (${resp.status})`,
        );
      }
      setModeDetection(data as DeploymentModeDetection);
    } catch (error) {
      setModeDetectionError(
        error instanceof Error
          ? error.message
          : 'Deployment mode detection failed',
      );
      setModeDetection(null);
    } finally {
      setLoadingModeDetection(false);
    }
  }, [
    backendFetch,
    form.application,
    form.instanceName,
    form.customer,
    form.vault,
    form.chartVersion,
    form.clusterName,
    selectedCluster?.subscriptionId,
    selectedCluster?.resourceGroup,
  ]);

  const handleNext = async () => {
    if (activeStep === 0) {
      if (!validateDetails()) return;
      void runModeDetection();
      setActiveStep(1);
      return;
    }
    if (activeStep === 1) {
      if (!bypassOnePasswordValidation) {
        const readiness = isEffectivelyReady(secretReport)
          ? secretReport
          : await runSecretReadinessCheck(true);
        if (!isEffectivelyReady(readiness)) {
          setSecretReportError(
            readiness?.summary ??
              '1Password readiness failed. Populate all required secrets before continuing.',
          );
          return;
        }
      }
      await loadPreview();
      setActiveStep(2);
      setReviewPhase('summary');
    }
  };

  const handleValidateOnePassword = async () => {
    if (!validateDetails()) {
      setSecretReportError(
        'Enter application, instance name, customer, and cluster before validating 1Password prerequisites.',
      );
      return;
    }

    const report = await runSecretReadinessCheck(true);
    if (report && !isEffectivelyReady(report)) {
      setSecretEditorOpen(true);
      return;
    }

    setSecretEditorOpen(false);
  };

  const buildCreatePayload = useCallback(
    () => ({
      deploymentId:
        deploymentRequestId.current ??
        (deploymentRequestId.current = crypto.randomUUID()),
      application: form.application,
      instanceName: form.instanceName.trim(),
      clusterName: form.clusterName,
      subscriptionId:
        selectedCluster?.subscriptionId || CLOUDHUB_SUBSCRIPTION_ID,
      resourceGroup: selectedCluster?.resourceGroup,
      customer: form.customer,
      vault: form.vault || undefined,
      chartVersion: form.chartVersion,
      aiStoreIntegration: form.aiStoreIntegration,
      helmfilePath: preview?.path,
      helmfileContent: preview?.content,
    }),
    [
      form.aiStoreIntegration,
      form.application,
      form.chartVersion,
      form.clusterName,
      form.customer,
      form.instanceName,
      form.vault,
      preview?.content,
      preview?.path,
      selectedCluster?.resourceGroup,
      selectedCluster?.subscriptionId,
    ],
  );

  const loadFieldsNeedingValues = useCallback(
    async (forceRefresh = true) => {
      if (!form.application || !form.instanceName || !form.customer) {
        return;
      }

      setLoadingFields(true);
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          `/deployments/secret-fields/${encodeURIComponent(
            form.application,
          )}/${encodeURIComponent(form.instanceName)}/${encodeURIComponent(
            form.customer,
          )}?forceRefresh=${forceRefresh}&vault=${encodeURIComponent(
            form.vault || '',
          )}`,
        );
        const data = await readJson(resp);
        if (resp.ok) {
          setFieldsNeedingValues(data as PortalSecretFieldInfo[]);
        }
      } catch (error) {
        // Silently fail - fields will be empty
      } finally {
        setLoadingFields(false);
      }
    },
    [
      backendFetch,
      form.application,
      form.instanceName,
      form.customer,
      form.vault,
    ],
  );

  const handleTriggerProvisioningFeedback = useCallback(
    async (overrides?: {
      customer?: string;
      instanceName?: string;
      bootstrapCustomerStructure?: boolean;
    }) => {
      const customer = (overrides?.customer ?? form.customer).trim();
      const instanceName = (
        overrides?.instanceName ?? form.instanceName
      ).trim();

      const errors: Record<string, string> = {};
      if (!form.application) errors.application = 'Select an application.';
      if (!instanceName) {
        errors.instanceName = 'Instance Name is required.';
      } else if (instanceName.length > 63) {
        errors.instanceName = 'Must be 63 characters or fewer.';
      } else if (!/^[a-z0-9-]+$/.test(instanceName)) {
        errors.instanceName =
          'Instance Name may only contain lowercase letters, numbers, and hyphens.';
      }
      if (!form.clusterName)
        errors.clusterName = 'Select a target AKS cluster.';
      if (!form.vault) {
        errors.vault = 'Select a 1Password vault.';
      }
      const customerError = validateCustomerName(customer);
      if (customerError) errors.customer = customerError;

      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        setProvisioningFeedbackOpen(true);
        setProvisioningError(
          'Enter application, instance name, customer, and cluster before creating 1Password secrets.',
        );
        return;
      }

      setForm(prev => ({ ...prev, customer, instanceName }));

      provisioningStreamAbortRef.current?.abort();
      const abort = new AbortController();
      provisioningStreamAbortRef.current = abort;

      setProvisioningFeedbackOpen(true);
      setProvisioningLoading(true);
      setProvisioningError(null);
      setProvisioningReport(null);
      setProvisioningLogs([]);

      try {
        await openEventStream({
          pluginId: 'deployment-control-plane',
          path: '/deployments/secret-provision-stream',
          query: {
            application: form.application,
            instanceName,
            customer,
            vault: form.vault || undefined,
            clusterName: form.clusterName || undefined,
            applicationReleaseVersion: form.chartVersion?.trim() || undefined,
            bootstrapCustomerStructure:
              overrides?.bootstrapCustomerStructure === true
                ? 'true'
                : undefined,
            entityResolutionChartVersion:
              entityResolutionChartVersion.trim() || undefined,
          },
          signal: abort.signal,
          onEvent: frame => {
            if (frame.event === 'log') {
              try {
                const parsed = JSON.parse(frame.data);
                setProvisioningLogs(prev => [...prev, parsed]);
              } catch {
                // ignore malformed payloads
              }
              return;
            }
            if (frame.event === 'done') {
              try {
                const parsed = JSON.parse(
                  frame.data,
                ) as PortalSecretProvisionStatusView;
                setProvisioningReport(parsed);
                if (parsed.readiness) {
                  setSecretReport(parsed.readiness);
                  setSecretReportError(null);
                }
                // Refresh fields and readiness after provisioning completes
                void loadFieldsNeedingValues(true);
                void runSecretReadinessCheck(true);
              } catch {
                // ignore malformed payloads
              }
              return;
            }
            if (frame.event === 'error') {
              try {
                const parsed = JSON.parse(frame.data);
                setProvisioningError(parsed?.message ?? 'Provisioning failed');
              } catch {
                setProvisioningError('Provisioning failed');
              }
            }
          },
        });
      } catch (error) {
        if (!abort.signal.aborted) {
          setProvisioningError(
            error instanceof Error
              ? error.message
              : 'Failed to stream provisioning progress',
          );
        }
      } finally {
        setProvisioningLoading(false);
      }
    },
    [
      openEventStream,
      form.application,
      form.instanceName,
      form.customer,
      form.vault,
      vaultOptions.length,
      form.clusterName,
      form.chartVersion,
      entityResolutionChartVersion,
      loadFieldsNeedingValues,
      runSecretReadinessCheck,
    ],
  );

  const handleCustomerChange = useCallback((value: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    setForm(prev => ({ ...prev, customer: normalized }));
  }, []);

  const handleVaultChange = useCallback(
    (value: string) => {
      const slugify = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        const nextCustomers = options?.customersByVault?.[value] ?? [];
      setForm(prev => {
          const currentExists = nextCustomers.some(
          customer => slugify(customer) === prev.customer,
        );
        return {
          ...prev,
          vault: value,
          customer: currentExists
            ? prev.customer
              : nextCustomers[0]
              ? slugify(nextCustomers[0])
            : '',
        };
      });
    },
      [options?.customersByVault],
  );

  useEffect(() => {
    if (
      secretReport &&
      !isEffectivelyReady(secretReport) &&
      (fieldsNeedingValues.length > 0 ||
        (secretReport.missing?.length ?? 0) > 0)
    ) {
      setSecretEditorOpen(true);
    }
    if (isEffectivelyReady(secretReport)) {
      setSecretEditorOpen(false);
    }
  }, [secretReport, fieldsNeedingValues.length]);

  // Keep all network-backed validation explicit and user-driven. Do not trigger
  // secret checks or field reads merely by entering Step 1; users must click
  // the Validate action to perform those checks.

  const handleUpdateFieldValue = useCallback(
    async (field: PortalSecretFieldInfo, value: string) => {
      if (!value) {
        setSecretReportError('Field value cannot be empty');
        return;
      }

      setUpdatingFieldReference(field.reference);
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          '/deployments/secret-fields/update',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              application: form.application,
              instanceName: form.instanceName,
              customer: form.customer,
              vault: field.vault,
              item: field.item,
              section: field.section,
              field: field.field,
              value,
            }),
          },
        );
        const data = await readJson(resp);
        if (resp.ok) {
          const result = data as PortalSecretUpdateResult;
          setSecretReport(result.readiness);
          setFieldUpdateValues(prev => {
            const next = { ...prev };
            delete next[field.reference];
            return next;
          });
          await loadFieldsNeedingValues(true);
        } else {
          setSecretReportError(data?.error ?? 'Failed to update field');
        }
      } catch (error) {
        setSecretReportError(
          error instanceof Error ? error.message : 'Failed to update field',
        );
      } finally {
        setUpdatingFieldReference(null);
      }
    },
    [
      backendFetch,
      form.application,
      form.instanceName,
      form.customer,
      loadFieldsNeedingValues,
    ],
  );

  const ensureDeploymentSaved =
    useCallback(async (): Promise<PortalDeploymentRecord | null> => {
      if (deployment) {
        return deployment;
      }
      if (!preview?.content) {
        setApprovalError('Generate Config before saving the deployment.');
        return null;
      }

      setSavingDeployment(true);
      setApprovalError(null);
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          '/deployments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildCreatePayload()),
          },
        );
        const data = await readJson(resp);
        if (!resp.ok) {
          throw new Error(
            data?.error ??
              `Failed to save deployment configuration (${resp.status})`,
          );
        }
        const record = data as PortalDeploymentRecord;
        setDeployment(record);
        setApprovalId(record.id);
        return record;
      } catch (error) {
        setApprovalError(
          error instanceof Error
            ? error.message
            : 'Failed to save deployment configuration',
        );
        return null;
      } finally {
        setSavingDeployment(false);
      }
    }, [backendFetch, buildCreatePayload, deployment, preview?.content]);

  const handleGenerateConfig = async () => {
    setDiffBusy(false);
    setDiffError(null);
    setDiffStatus(null);
    setDiffEvents([]);
    setReviewPhase('generating');
    const ok = await loadPreview();
    if (ok) {
      void runSecretReadinessCheck(false);
    }
    setReviewPhase(ok ? 'generated' : 'summary');
  };

  const handleRunDiff = async () => {
    setDiffBusy(true);
    setDiffError(null);
    setDiffStatus(null);
    setDiffEvents([]);
    setAcknowledgedDestructiveDiff(false);
    setReviewPhase('diffing');
    try {
      const previewOk = preview?.content ? true : await loadPreview();
      if (!previewOk) {
        setReviewPhase('summary');
        return;
      }

      if (!bypassOnePasswordValidation) {
        const readiness = await runSecretReadinessCheck(true);
        if (!isEffectivelyReady(readiness)) {
          setDiffError(
            readiness?.summary ??
              'Run Diff is blocked until all required 1Password values are present and populated.',
          );
          setReviewPhase('summary');
          return;
        }
      }

      const saved = await ensureDeploymentSaved();
      if (!saved) {
        setReviewPhase('summary');
        return;
      }

      const resp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${saved.id}/diff`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: 'Run Diff requested via CloudHub Wizard',
          }),
        },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? `Run Diff failed (${resp.status})`);
      }

      const status = data as PortalDeploymentDiffStatusView;
      setDiffStatus(status);
      setReviewPhase(status.status === 'completed' ? 'diffed' : 'diffing');
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : 'Run Diff failed');
      setReviewPhase('summary');
    } finally {
      setDiffBusy(false);
    }
  };

  const handleSendForReview = async () => {
    if (!deployment?.id) {
      setApprovalError('Save Config before sending for approval.');
      return;
    }

    if (
      diffBusy ||
      diffStatus?.status !== 'completed' ||
      diffStatus.conclusion !== 'success'
    ) {
      setApprovalError(
        'Run Diff must complete successfully before sending for approval.',
      );
      return;
    }

    const report = await runSecretReadinessCheck(true);
    if (!isEffectivelyReady(report)) {
      setApprovalError(
        report?.summary ??
          'Deployment blocked until all required 1Password values are present and populated.',
      );
      return;
    }

    setApprovalBusy(true);
    setApprovalError(null);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${deployment.id}/send-for-approval`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: 'Submitted for approval via CloudHub Wizard',
          }),
        },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Failed to submit for approval');
      }
      const record = data as PortalDeploymentRecord;
      setApprovalId(record.id);
      setDeployment(record);
      setApprovalStatus('PENDING');
      setReviewPhase('review');
    } catch (error) {
      setApprovalError(
        error instanceof Error
          ? error.message
          : 'Failed to submit for approval',
      );
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleDeploy = async () => {
    if (!deployment?.id) {
      setApprovalError('Save Config and Send For Approval before deploying.');
      return;
    }

    const instanceCheckResp = await backendFetch(
      'deployment-control-plane',
      '/deployments/app-instance-check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application: form.application,
          instanceName: form.instanceName.trim(),
          branch: deployment.branch ?? options?.branch ?? 'main',
        }),
      },
    );
    const instanceCheck = await readJson(instanceCheckResp);
    if (!instanceCheckResp.ok) {
      throw new Error(
        instanceCheck?.error ?? 'Failed to verify app instance directory',
      );
    }
    if (!instanceCheck?.exists) {
      const warning =
        instanceCheck?.message ??
        `App instance '${
          form.application
        }/${form.instanceName.trim()}' does not exist in branch '${
          deployment.branch ?? options?.branch ?? 'main'
        }'. Ensure the instance folder is committed or bootstrapped.`;
      // eslint-disable-next-line no-alert
      const proceed = window.confirm(`${warning}\n\nContinue anyway?`);
      if (!proceed) {
        setApprovalError(warning);
        return;
      }
    }

    try {
      const commonResResp = await backendFetch(
        'deployment-control-plane',
        '/deployments/common-res-preflight',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: selectedCluster?.subscriptionId ?? '',
            resourceGroup: selectedCluster?.resourceGroup ?? '',
            clusterName: deployment.cluster ?? form.clusterName,
            namespace: deployment.namespace ?? undefined,
          }),
        },
      );
      const commonResCheck = (await readJson(
        commonResResp,
      )) as PortalCommonResPreflightReport & { error?: string };
      if (!commonResResp.ok) {
        throw new Error(
          commonResCheck?.error ?? 'Failed to verify common-res readiness',
        );
      }
      if (!commonResCheck.ready) {
        // eslint-disable-next-line no-alert
        const proceed = window.confirm(
          `${commonResCheck.message}\n\nContinue anyway?`,
        );
        if (!proceed) {
          setApprovalError(commonResCheck.message);
          return;
        }
      }
    } catch (error) {
      setApprovalError(
        error instanceof Error
          ? error.message
          : 'Failed to verify common-res readiness',
      );
      return;
    }

    if (!bypassOnePasswordValidation) {
      const report = await runSecretReadinessCheck(true);
      if (!isEffectivelyReady(report)) {
        setApprovalError(
          report?.summary ??
            'Deployment blocked until all required 1Password values are present and populated.',
        );
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);
    setApprovalError(null);
    try {
      const approveResp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${deployment.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: 'Approved & deployed via CloudHub Wizard',
          }),
        },
      );
      const approveData = await readJson(approveResp);
      if (!approveResp.ok) {
        throw new Error(
          approveData?.error ?? `Approval failed (${approveResp.status})`,
        );
      }
      const approvedRecord = approveData as PortalDeploymentRecord;
      setApprovalStatus('APPROVED');
      setDeployment(approvedRecord);
      setStatusView(toStatusView(approvedRecord));
      setStreamNotice(null);
      setActiveStep(3);
      onDeployed?.();
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : 'Deploy failed',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    const idToReject = approvalId ?? deployment?.id;
    if (!idToReject) {
      setApprovalStatus('REJECTED');
      setApprovalError('Deployment request was rejected.');
      return;
    }
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${idToReject}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'Rejected via CloudHub Wizard' }),
        },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Reject failed');
      }
      setApprovalStatus('REJECTED');
      setApprovalError('Deployment request was rejected.');
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : 'Reject failed',
      );
    } finally {
      setApprovalBusy(false);
    }
  };

  // Poll the approval decision while awaiting review so Deploy unlocks when an
  // authorized approver acts (possibly in another session).
  useEffect(() => {
    if (
      reviewPhase !== 'review' ||
      !approvalId ||
      approvalStatus !== 'PENDING'
    ) {
      return undefined;
    }
    const timer = window.setInterval(async () => {
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          `/deployments/${approvalId}`,
        );
        const data = await readJson(resp);
        if (!resp.ok) return;

        const record = data as PortalDeploymentRecord;
        if (
          record.status === 'APPROVED' ||
          record.status === 'DISPATCHING' ||
          record.status === 'QUEUED' ||
          record.status === 'DEPLOYING' ||
          record.status === 'SUCCEEDED' ||
          record.status === 'FAILED'
        ) {
          setApprovalStatus('APPROVED');
          setDeployment(record);
          setReviewPhase('approved');

          if (
            record.status === 'DISPATCHING' ||
            record.status === 'QUEUED' ||
            record.status === 'DEPLOYING' ||
            record.status === 'SUCCEEDED' ||
            record.status === 'FAILED'
          ) {
            setStatusView(toStatusView(record));
            setActiveStep(3);
          }
        } else if (record.status === 'REJECTED') {
          setApprovalStatus('REJECTED');
          setApprovalError('Deployment request was rejected.');
          setReviewPhase('generated');
        } else if (
          record.status === 'PENDING' ||
          record.status === 'PENDING_APPROVAL'
        ) {
          setDeployment(record);
          setApprovalStatus('PENDING');
        }
      } catch {
        // transient — next tick retries
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [reviewPhase, approvalId, approvalStatus, backendFetch]);

  useEffect(() => {
    if (
      activeStep !== 1 ||
      !deployment?.id ||
      !diffStatus ||
      diffStatus.status === 'completed'
    ) {
      return undefined;
    }

    const deploymentId = deployment.id;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      try {
        const [statusResp, eventsResp] = await Promise.all([
          backendFetch(
            'deployment-control-plane',
            `/deployments/${deploymentId}/diff/status`,
          ),
          backendFetch(
            'deployment-control-plane',
            `/deployments/${deploymentId}/events`,
          ),
        ]);

        const statusData = await readJson(statusResp);
        if (!statusResp.ok) {
          throw new Error(
            statusData?.error ??
              `Run Diff status failed (${statusResp.status})`,
          );
        }
        const status = statusData as PortalDeploymentDiffStatusView;
        setDiffStatus(status);
        setDiffError(null);

        const eventsData = await readJson(eventsResp);
        if (eventsResp.ok && Array.isArray(eventsData?.events)) {
          const diffOnly = (eventsData.events as DeploymentEvent[]).filter(
            event => event.eventType.startsWith('diff-'),
          );
          setDiffEvents(prev => mergeDeploymentEvents(prev, diffOnly));
        }

        if (status.status === 'completed') {
          setReviewPhase('diffed');
          stopped = true;
        }
      } catch (error) {
        setDiffError(
          error instanceof Error
            ? error.message
            : 'Run Diff status refresh failed',
        );
      }
    }

    const timer = window.setInterval(() => void tick(), 4000);

    void tick();

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeStep, backendFetch, deployment?.id, diffStatus]);

  const handleRetry = async () => {
    if (!deployment) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${deployment.id}/retry`,
        { method: 'POST' },
      );
      const data = await readJson(resp);
      if (!resp.ok) {
        throw new Error(data?.error ?? `Retry failed (${resp.status})`);
      }
      const record = data as PortalDeploymentRecord;
      setDeployment(record);
      setStatusView({
        deploymentId: record.id,
        workflowRunId: record.workflowRunId,
        status: record.status,
        currentStep: record.currentStep,
        workflowRunUrl: record.workflowRunUrl,
        statusMessage: record.statusMessage,
        failureReason: record.failureReason,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt,
      });
      setDeploymentEvents([]);
      setStreamNotice(null);
      onDeployed?.();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setSubmitting(false);
    }
  };

  // "Rollback" here means re-running the same reviewed create → diff →
  // approve → apply pipeline with the previous chart version, not a direct
  // unreviewed cluster mutation — there's no backend rollback executor today
  // (DeploymentExecutor.rollback() is an explicit stub), so a one-click
  // instant revert would be dishonest about what actually happens. This
  // reuses the version pinned as `currentChartVersion` by mode detection,
  // captured before this deployment's own create() overwrote it.
  const handleStartRollback = () => {
    const previousVersion = modeDetection?.currentChartVersion;
    if (!previousVersion) return;
    setForm(prev => ({ ...prev, chartVersion: previousVersion }));
    setDeployment(null);
    setStatusView(null);
    setDiffStatus(null);
    setDiffEvents([]);
    setDiffError(null);
    setAcknowledgedDestructiveDiff(false);
    setPreview(null);
    setReviewPhase('summary');
    setApprovalId(null);
    setApprovalStatus(null);
    setDeploymentEvents([]);
    setModeDetection(null);
    setActiveStep(0);
  };

  const liveLogPanelRef = useRef<HTMLDivElement | null>(null);

  // Live progress for step 3. The stream is read over `fetchApi` rather than
  // `EventSource` because EventSource cannot send the Backstage identity token
  // and the backend route is guarded by `httpAuth.credentials`. Whenever the
  // stream is unavailable we degrade to polling so the wizard never sits on a
  // stale "Waiting for deployment activity..." panel.
  useEffect(() => {
    const active = activeStep === 3 && deployment !== null;
    if (!active) {
      return undefined;
    }

    const deploymentId = deployment!.id;
    const abort = new AbortController();
    let stopped = false;
    let pollTimer: number | undefined;

    const mergeEvents = (incoming: DeploymentEvent[]) => {
      if (incoming.length === 0) return;
      setDeploymentEvents(prev => mergeDeploymentEvents(prev, incoming));
    };

    const appendStatusTimelineEvent = (parsed: PortalDeploymentStatusView) => {
      const id = `status-${parsed.deploymentId}-${parsed.updatedAt}-${parsed.status}`;
      if (lastStatusEventRef.current === id) {
        return;
      }
      lastStatusEventRef.current = id;
      mergeEvents([
        {
          id,
          eventType: 'status',
          toStatus: parsed.status,
          note: parsed.statusMessage ?? parsed.currentStep,
          createdAt: parsed.updatedAt,
        },
      ]);
    };

    const applyStatus = (parsed: PortalDeploymentStatusView) => {
      setStatusView(parsed);
      appendStatusTimelineEvent(parsed);
      if (parsed.commitSha) {
        setDeployment(prev =>
          prev && prev.commitSha !== parsed.commitSha
            ? { ...prev, commitSha: parsed.commitSha ?? null }
            : prev,
        );
      }
      if (isTerminalStatus(parsed.status)) {
        onDeployed?.();
      }
      return isTerminalStatus(parsed.status);
    };

    const pollOnce = async (): Promise<boolean> => {
      const [statusResp, eventsResp] = await Promise.all([
        backendFetch(
          'deployment-control-plane',
          `/deployments/${deploymentId}/status`,
        ),
        backendFetch(
          'deployment-control-plane',
          `/deployments/${deploymentId}/events`,
        ),
      ]);

      const eventsData = await readJson(eventsResp);
      if (eventsResp.ok && Array.isArray(eventsData?.events)) {
        mergeEvents(eventsData.events as DeploymentEvent[]);
      }

      if (
        eventsResp.ok &&
        Array.isArray(eventsData?.events) &&
        eventsData.events.length > 0
      ) {
        setStreamNotice(null);
      }

      const statusData = await readJson(statusResp);
      if (!statusResp.ok) {
        throw new Error(
          statusData?.error ?? `Status request failed (${statusResp.status})`,
        );
      }
      return applyStatus(statusData as PortalDeploymentStatusView);
    };

    const startPolling = (reason?: string) => {
      if (stopped || pollTimer !== undefined) return;
      if (reason) {
        setStreamNotice(reason);
      }
      const tick = async () => {
        if (stopped) return;
        try {
          const terminal = await pollOnce();
          if (terminal) {
            stopped = true;
            window.clearInterval(pollTimer);
            pollTimer = undefined;
          }
        } catch {
          // transient — the next tick retries
        }
      };
      void tick();
      pollTimer = window.setInterval(() => void tick(), 4000);
    };

    const runStream = async () => {
      try {
        await openEventStream({
          pluginId: 'deployment-control-plane',
          path: `/deployments/${deploymentId}/logs/stream`,
          signal: abort.signal,
          onOpen: () => setStreamNotice(null),
          onEvent: frame => {
            if (frame.event === 'log') {
              try {
                const parsed = JSON.parse(frame.data) as DeploymentEvent;
                if (parsed?.id) {
                  mergeEvents([parsed]);
                  setStreamNotice(null);
                }
              } catch {
                // ignore malformed payloads
              }
              return;
            }
            if (frame.event === 'status' || frame.event === 'done') {
              try {
                applyStatus(
                  JSON.parse(frame.data) as PortalDeploymentStatusView,
                );
              } catch {
                // ignore malformed payloads
              }
              if (frame.event === 'done') {
                stopped = true;
                abort.abort();
              }
              return;
            }
            if (frame.event === 'error') {
              try {
                const message = JSON.parse(frame.data)?.message;
                if (message) setStreamNotice(String(message));
              } catch {
                // ignore malformed payloads
              }
            }
          },
        });

        // The stream closed. If the deployment has not reached a terminal
        // state yet, keep tracking it by polling.
        if (!stopped) {
          startPolling(
            'Live log stream closed; falling back to periodic status checks.',
          );
        }
      } catch (error) {
        if (abort.signal.aborted || stopped) {
          return;
        }
        startPolling(
          `Live log stream unavailable (${
            error instanceof Error ? error.message : String(error)
          }). Falling back to periodic status checks.`,
        );
      }
    };

    void runStream();

    return () => {
      stopped = true;
      abort.abort();
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
      }
    };
  }, [activeStep, deployment, backendFetch, openEventStream, onDeployed]);

  const deploymentId = deployment?.id;
  const deploymentSucceeded = statusView?.status === 'SUCCEEDED';
  useEffect(() => {
    if (activeStep !== 3 || !deploymentId || !deploymentSucceeded) {
      return undefined;
    }
    let stopped = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    setHealthCheck({ phase: 'checking', result: null });

    const tick = async () => {
      if (stopped) return;
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          `/deployments/${deploymentId}/health-check`,
        );
        const data = (await readJson(resp)) as PortalHealthProbeResult | null;
        if (stopped) return;
        if (resp.ok && data) {
          if (data.healthy) {
            stopped = true;
            setHealthCheck({ phase: 'healthy', result: data });
            return;
          }
          setHealthCheck({ phase: 'checking', result: data });
        }
      } catch {
        // transient — the next tick retries
      }
      if (Date.now() - startedAt >= HEALTH_POLL_TIMEOUT_MS) {
        stopped = true;
        setHealthCheck(prev => ({ phase: 'timeout', result: prev.result }));
        return;
      }
      timer = window.setTimeout(() => void tick(), HEALTH_POLL_INTERVAL_MS);
    };
    void tick();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [
    activeStep,
    deploymentId,
    deploymentSucceeded,
    backendFetch,
    healthCheckAttempt,
  ]);

  useEffect(() => {
    if (activeStep !== 3 || deployment === null) {
      return;
    }

    liveLogPanelRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [activeStep, deployment]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const appLabel = deploymentLabel ?? selectedApp?.displayName ?? 'Application';
  const approvalState = approvalBadge(deployment, reviewPhase, approvalStatus);
  const diffSucceeded =
    diffStatus?.status === 'completed' && diffStatus.conclusion === 'success';
  const diffCompletedWithFailure =
    diffStatus?.status === 'completed' && diffStatus.conclusion !== 'success';
  // Same gate the backend applies before Run Diff and deploy.
  const secretsEffectivelyReady = isEffectivelyReady(secretReport);
  const nextDisabled =
    activeStep === 0
      ? loadingOptions || !detailsReadyForReadiness
      : activeStep === 1
      ? loadingSecretReport ||
        loadingOptions ||
        (!secretsEffectivelyReady && !bypassOnePasswordValidation)
      : false;
  // Allow provisioning directly from the main card without a prior validation,
  // as long as the form is filled. The provisioning handler will validate and
  // show errors if needed.
  const canProvisionSecrets = Boolean(
    detailsReadyForReadiness && !secretsEffectivelyReady,
  );
  const onePasswordOptionsError =
    optionsError && /1password|vault/i.test(optionsError)
      ? optionsError
      : null;
  // Capture body as a JSX element (not a component) so React can reconcile it
  // without unmounting across renders. Defining Wrapper inline as a component
  // would create a new type each render, destroying form focus on every keystroke.
  const wizardBody = (
    <>
      {mode !== 'page' && <DialogTitle>Deploy {appLabel}</DialogTitle>}
      <DialogContent
        className={`${classes.content}${
          mode === 'page' ? ` ${classes.pageSection} ${classes.contentPage}` : ''
        }`}
      >
        {draftRestored && (
          <Paper
            elevation={0}
            sx={{
              mb: 2,
              p: 1.5,
              borderRadius: 2,
              border: '1px solid #BFDBFE',
              bgcolor: '#EFF6FF',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <Typography variant="body2" color="primary">
              Draft restored — your previous inputs have been reloaded.
            </Typography>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                resetAll();
                if (draftKey) clearDraft(draftKey);
                setDraftRestored(false);
              }}
            >
              Discard Draft
            </Button>
          </Paper>
        )}
        <Stepper
          activeStep={activeStep}
          alternativeLabel
          className={classes.stepper}
          connector={null}
        >
          {STEPS.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {optionsError && (
          <Paper
            elevation={0}
            className={`${classes.statusBox} ${classes.errorBox}`}
          >
            <ErrorIcon style={{ color: '#DC2626' }} />
            <Typography className={classes.errorText}>
              {optionsError}
            </Typography>
          </Paper>
        )}

        {loadingOptions && (
          <Box className={classes.loadingContainer}>
            <CircularProgress size={24} />
            <Typography variant="body2">Loading deployment options…</Typography>
          </Box>
        )}

        {/* ─── Step 1: Details ─────────────────────────────────────────── */}
        {activeStep === 0 && (
          <Box className={classes.stepOneGrid}>
            <Box className={classes.stepOneColumn}>
              {!preselectedApp && (
                <Box className={classes.formField}>
                  <Typography className={classes.formLabel}>
                    Application
                  </Typography>
                  <TextField
                    select
                    value={form.application}
                    onChange={e => {
                      const next = options?.applications.find(
                        a => a.appName === e.target.value,
                      );
                      setForm(prev => ({
                        ...prev,
                        application: e.target.value,
                        chartVersion: next?.chartVersions[0] ?? '',
                      }));
                    }}
                    error={Boolean(fieldErrors.application)}
                    variant="outlined"
                    size="small"
                    fullWidth
                    inputProps={{ 'aria-label': 'Application' }}
                  >
                    {(options?.applications ?? []).map(app => (
                      <MenuItem key={app.appName} value={app.appName}>
                        {app.displayName}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Typography className={classes.formHelper}>
                    {fieldErrors.application ??
                      'Discovered from the SymphonyFS scripts repo (apps/ and scp/apps/)'}
                  </Typography>
                </Box>
              )}

              <Box className={classes.formField}>
                <Typography className={classes.formLabel}>
                  Target AKS Cluster
                </Typography>
                <TextField
                  select
                  value={form.clusterName}
                  onChange={e =>
                    setForm(prev => ({ ...prev, clusterName: e.target.value }))
                  }
                  error={Boolean(fieldErrors.clusterName)}
                  variant="outlined"
                  size="small"
                  fullWidth
                >
                  {clusters.map(cluster => (
                    <MenuItem
                      key={cluster.clusterName}
                      value={cluster.clusterName}
                    >
                      {cluster.clusterName} · {cluster.region}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography className={classes.formHelper}>
                  {fieldErrors.clusterName ??
                    (selectedCluster?.environment
                      ? `Environment derived from cluster metadata: ${selectedCluster.environment}`
                      : 'Select the AKS cluster for this deployment')}
                </Typography>
              </Box>

              <Box className={classes.formField}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 0.5,
                  }}
                >
                  <Typography className={classes.formLabel}>
                    {selectedApp?.displayName ?? 'Application'} Chart Version
                  </Typography>
                  {(selectedApp?.chartVersions?.length ?? 0) > 0 && (
                    <Link
                      component="button"
                      variant="body2"
                      type="button"
                      onClick={() => setCustomChartVersion(prev => !prev)}
                      sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {customChartVersion
                        ? 'Select from known releases'
                        : 'Enter custom / new version'}
                    </Link>
                  )}
                </Box>
                {!customChartVersion &&
                (selectedApp?.chartVersions?.length ?? 0) > 0 ? (
                  <TextField
                    select
                    value={form.chartVersion}
                    onChange={e =>
                      setForm(prev => ({ ...prev, chartVersion: e.target.value }))
                    }
                    error={Boolean(fieldErrors.chartVersion)}
                    variant="outlined"
                    size="small"
                    fullWidth
                  >
                    {selectedApp?.chartVersions?.map((version, index) => (
                      <MenuItem key={version} value={version}>
                        {version}
                        {index === 0 ? ' — Latest' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <TextField
                    value={form.chartVersion}
                    onChange={e =>
                      setForm(prev => ({ ...prev, chartVersion: e.target.value }))
                    }
                    error={Boolean(fieldErrors.chartVersion)}
                    placeholder={
                      selectedApp?.chartVersions?.[0]
                        ? `e.g. ${selectedApp.chartVersions[0]}`
                        : 'e.g. 2.1.3'
                    }
                    variant="outlined"
                    size="small"
                    fullWidth
                  />
                )}
                <Typography className={classes.formHelper}>
                  {fieldErrors.chartVersion ?? (
                    <>
                      Written to 1Password&apos;s{' '}
                      <code>
                        pipeline_refs/&lt;namespace&gt;__helm_chart_version
                      </code>{' '}
                      when this deployment is approved.
                    </>
                  )}
                </Typography>
              </Box>

              <Box className={classes.formField}>
                <Typography className={classes.formLabel}>Customer</Typography>
                <CustomerSelector
                  customers={customerOptions}
                  loading={loadingOptions}
                  value={form.customer}
                  error={fieldErrors.customer}
                  helperText={
                    fieldErrors.customer ??
                    (customerOptions.length > 0
                      ? 'Search and select an existing customer from 1Password.'
                      : 'No customers found in the selected vault. Verify 1Password data before continuing.')
                  }
                  onValueChange={handleCustomerChange}
                />
              </Box>
            </Box>

            <Box className={classes.stepOneColumn}>
              <Box className={classes.formField}>
                <Typography className={classes.formLabel}>
                  Instance Operation
                </Typography>
                <TextField
                  select
                  value={instanceOperation}
                  onChange={e => {
                    const next = e.target.value as InstanceOperation;
                    setInstanceOperation(next);
                    setForm(prev => ({
                      ...prev,
                      instanceName:
                        next === 'update-existing'
                          ? knownInstances.includes(prev.instanceName.trim())
                            ? prev.instanceName.trim()
                            : knownInstances[0] ?? ''
                          : knownInstances.includes(prev.instanceName.trim())
                          ? ''
                          : prev.instanceName,
                    }));
                  }}
                  variant="outlined"
                  size="small"
                  fullWidth
                >
                  <MenuItem value="update-existing">
                    Update Existing App Instance
                  </MenuItem>
                  <MenuItem value="new-instance">New App Instance</MenuItem>
                </TextField>
              </Box>

              <Box className={classes.formField}>
                <Typography className={classes.formLabel}>
                  Instance Name
                </Typography>
                {instanceOperation === 'update-existing' ? (
                  <TextField
                    select
                    value={form.instanceName}
                    onChange={e =>
                      setForm(prev => ({ ...prev, instanceName: e.target.value }))
                    }
                    error={Boolean(fieldErrors.instanceName)}
                    variant="outlined"
                    size="small"
                    fullWidth
                    disabled={knownInstances.length === 0}
                  >
                    {knownInstances.length === 0 ? (
                      <MenuItem value="" disabled>
                        No existing instances found
                      </MenuItem>
                    ) : (
                      knownInstances.map(inst => (
                        <MenuItem key={inst} value={inst}>
                          {inst}
                        </MenuItem>
                      ))
                    )}
                  </TextField>
                ) : (
                  <TextField
                    value={form.instanceName}
                    onChange={e =>
                      setForm(prev => ({ ...prev, instanceName: e.target.value }))
                    }
                    error={Boolean(fieldErrors.instanceName)}
                    placeholder="e.g. dt-juber-poc"
                    variant="outlined"
                    size="small"
                    fullWidth
                  />
                )}
                <Typography className={classes.formHelper}>
                  {fieldErrors.instanceName ??
                    (instanceOperation === 'update-existing'
                      ? knownInstances.length > 0
                        ? 'Select an existing app instance to update.'
                        : 'No existing app instances found for this application. Switch to New App Instance to create one.'
                      : 'Namespace name · lowercase, numbers, hyphens · ≤ 63 chars')}
                </Typography>
              </Box>

              <Box className={classes.formField}>
                <Typography className={classes.formLabel}>
                  1Password Vault
                </Typography>
                {onePasswordOptionsError && (
                  <Paper
                    elevation={0}
                    className={`${classes.statusBox} ${classes.errorBox}`}
                    sx={{ mb: 0.75 }}
                  >
                    <ErrorIcon style={{ color: '#DC2626' }} />
                    <Typography className={classes.errorText}>
                      {onePasswordOptionsError}
                    </Typography>
                  </Paper>
                )}
                <TextField
                  select
                  value={form.vault}
                  onChange={e => handleVaultChange(e.target.value)}
                  error={Boolean(fieldErrors.vault)}
                  variant="outlined"
                  size="small"
                  fullWidth
                  disabled={vaultOptions.length === 0}
                >
                  {vaultOptions.length === 0 ? (
                    <MenuItem value="" disabled>
                      No 1Password vaults available
                    </MenuItem>
                  ) : (
                    vaultOptions.map(vaultName => (
                      <MenuItem key={vaultName} value={vaultName}>
                        {vaultName}
                      </MenuItem>
                    ))
                  )}
                </TextField>
                <Typography className={classes.formHelper}>
                  {fieldErrors.vault ??
                    (vaultOptions.length > 0
                      ? 'Select the existing 1Password vault to read and write customer secrets.'
                      : 'No vaults were returned by 1Password. Deployment cannot continue until 1Password access is fixed.')}
                </Typography>
              </Box>
            </Box>

            <Box className={classes.stepOneStatusColumn}>
              <Box>
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <Typography className={classes.panelTitle}>
                    Resolved Configuration
                  </Typography>
                  {modeDetection && (
                    <Chip
                      size="small"
                      label={DEPLOYMENT_MODE_LABELS[modeDetection.mode]}
                      style={{
                        backgroundColor: modeDetection.isFreshInstall
                          ? '#EFF6FF'
                          : '#FFFBEB',
                        color: modeDetection.isFreshInstall
                          ? '#1D4ED8'
                          : '#92400E',
                        fontWeight: 700,
                      }}
                    />
                  )}
                </Box>
                {selectedCluster ? (
                  <Paper elevation={0} className={classes.resolvedCard}>
                    <Typography className={classes.resolvedItem}>
                      Namespace: <strong>{form.instanceName.trim() || '—'}</strong>
                    </Typography>
                    <Typography className={classes.resolvedItem}>
                      Region: <strong>{formatRegionName(selectedCluster.region)}</strong>
                    </Typography>
                    <Typography className={classes.resolvedItem}>
                      Environment:{' '}
                      <strong>
                        {selectedCluster.environment
                          ? selectedCluster.environment.toUpperCase()
                          : 'DEV'}
                      </strong>
                    </Typography>
                    <Typography className={classes.resolvedItem}>
                      Application URL:{' '}
                      <strong>
                        {calculateIngressTarget({
                          application: form.application,
                          customer: form.customer,
                          instanceName: form.instanceName,
                          environment: selectedCluster.environment,
                        })?.url ?? '—'}
                      </strong>
                    </Typography>
                  </Paper>
                ) : (
                  <Paper
                    elevation={0}
                    className={`${classes.statusBox} ${classes.infoBox}`}
                  >
                    <Typography className={classes.infoText}>
                      Select a target AKS cluster to resolve configuration
                      metadata.
                    </Typography>
                  </Paper>
                )}
              </Box>

              {mode === 'page' && (
                <Box className={classes.stepOneActions}>
                  <Button
                    onClick={handleClose}
                    disabled={submitting}
                    variant="outlined"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleNext()}
                    disabled={nextDisabled}
                    color="primary"
                    variant="contained"
                  >
                    Next
                  </Button>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* ─── Step 2: 1Password Setup ──────────────────────────────────── */}
        {activeStep === 1 && (
          <Box sx={{ p: 2 }}>
            {(loadingModeDetection || modeDetection || modeDetectionError) && (
              <Paper
                elevation={0}
                sx={{
                  mb: 2,
                  p: 1.5,
                  borderRadius: 2,
                  border: `1px solid ${
                    modeDetection?.isFreshInstall ? '#BFDBFE' : '#FDE68A'
                  }`,
                  bgcolor: modeDetection?.isFreshInstall
                    ? '#EFF6FF'
                    : '#FFFBEB',
                }}
              >
                {loadingModeDetection && !modeDetection ? (
                  <Typography variant="body2">
                    Detecting deployment mode…
                  </Typography>
                ) : modeDetectionError ? (
                  <Typography variant="body2" color="error">
                    Could not detect deployment mode: {modeDetectionError}
                  </Typography>
                ) : modeDetection ? (
                  <>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Detected mode:{' '}
                      {DEPLOYMENT_MODE_LABELS[modeDetection.mode]}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>
                      {modeDetection.currentChartVersion
                        ? `Current version in 1Password: ${
                            modeDetection.currentChartVersion
                          }${
                            modeDetection.targetChartVersion
                              ? ` → target: ${modeDetection.targetChartVersion}`
                              : ''
                          }.`
                        : 'No existing chart version was found in 1Password for this namespace — treating this as a new environment.'}
                      {modeDetection.namespaceExists === true &&
                        ' The Kubernetes namespace already exists on the target cluster.'}
                      {modeDetection.namespaceExists === false &&
                        ' The Kubernetes namespace does not exist yet on the target cluster.'}
                    </Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                      {modeDetection.requiredSteps.map(step => (
                        <li key={step}>
                          <Typography variant="body2">{step}</Typography>
                        </li>
                      ))}
                    </Box>
                  </>
                ) : null}
              </Paper>
            )}
            {findsUnresolvedEntityResolutionChartVersion(secretReport) && (
              <Box className={classes.formField} sx={{ mb: 2 }}>
                <Typography className={classes.formLabel}>
                  Entity Resolution Chart Version
                </Typography>
                {entityResolutionChartVersionMode === 'preset' ? (
                  <TextField
                    select
                    value={entityResolutionChartVersion}
                    onChange={e =>
                      setEntityResolutionChartVersion(e.target.value)
                    }
                    variant="outlined"
                    size="small"
                    fullWidth
                  >
                    {ENTITY_RESOLUTION_CHART_VERSION_PRESETS.map(
                      (version, index) => (
                        <MenuItem key={version} value={version}>
                          {version}
                          {index === 0 ? ' — Latest' : ''}
                        </MenuItem>
                      ),
                    )}
                  </TextField>
                ) : (
                  <TextField
                    value={entityResolutionChartVersion}
                    onChange={e =>
                      setEntityResolutionChartVersion(e.target.value)
                    }
                    placeholder="e.g. 1.416.0-rc1"
                    variant="outlined"
                    size="small"
                    fullWidth
                  />
                )}
                <Typography className={classes.formHelper}>
                  Written to 1Password's{' '}
                  <code>
                    pipeline_refs/&lt;namespace&gt;__entity_resolution_chart_version
                  </code>{' '}
                  when you click Auto-Generate Secrets below, instead of the
                  'latest' placeholder.{' '}
                  <Link
                    component="button"
                    variant="body2"
                    onClick={() =>
                      setEntityResolutionChartVersionMode(prevMode =>
                        prevMode === 'preset' ? 'custom' : 'preset',
                      )
                    }
                  >
                    {entityResolutionChartVersionMode === 'preset'
                      ? 'Use a custom version'
                      : 'Use a preset version'}
                  </Link>
                </Typography>
              </Box>
            )}
            {secretReport && secretReport.findings.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography className={classes.formLabel} sx={{ mb: 1 }}>
                  Secret Readiness by Category
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      sm: 'repeat(2, 1fr)',
                    },
                    gap: 1,
                  }}
                >
                  {(
                    Object.keys(SECRET_CATEGORY_LABELS) as SecretFieldCategory[]
                  ).map(category => {
                    const items = categorizedSecretFindings[category];
                    if (items.length === 0) return null;
                    const blocked = items.filter(
                      item => item.status !== 'READY',
                    );
                    const ready = blocked.length === 0;
                    // pipeline_refs fields are deliberately left unset until
                    // deploy/approval time (syncPipelineRefs writes them
                    // then) — a non-READY status here is expected, not a
                    // problem, so it gets a neutral label instead of a
                    // "pending" warning.
                    const chipLabel =
                      category === 'pipeline'
                        ? ready
                          ? 'Seeded'
                          : 'Set at deploy time'
                        : ready
                        ? 'Ready'
                        : `${blocked.length} pending`;
                    const chipColors =
                      category === 'pipeline' && !ready
                        ? { bg: '#EFF6FF', fg: '#1D4ED8' }
                        : ready
                        ? { bg: '#DCFCE7', fg: '#166534' }
                        : { bg: '#FEF3C7', fg: '#92400E' };
                    return (
                      <Paper
                        key={category}
                        elevation={0}
                        sx={{
                          p: 1.25,
                          borderRadius: 2,
                          border: `1px solid ${
                            ready || category === 'pipeline'
                              ? '#BBF7D0'
                              : '#FDE68A'
                          }`,
                          bgcolor:
                            ready || category === 'pipeline'
                              ? '#F0FDF4'
                              : '#FFFBEB',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {SECRET_CATEGORY_LABELS[category]}
                          </Typography>
                          <Chip
                            size="small"
                            label={chipLabel}
                            style={{
                              backgroundColor: chipColors.bg,
                              color: chipColors.fg,
                              fontWeight: 700,
                            }}
                          />
                        </Box>
                        <Typography variant="caption" color="textSecondary">
                          {items.length} field{items.length === 1 ? '' : 's'}{' '}
                          tracked
                        </Typography>
                      </Paper>
                    );
                  })}
                </Box>
              </Box>
            )}
            <OnePasswordPrerequisitesCard
              customer={form.customer}
              loading={loadingSecretReport}
              report={secretReport}
              error={secretReportError}
              effectivelyReady={secretsEffectivelyReady}
              provisionBusy={provisioningLoading}
              provisionInFlight={false}
              validateDisabled={
                loadingSecretReport || loadingOptions || provisioningLoading
              }
              provisionDisabled={
                loadingOptions ||
                loadingSecretReport ||
                provisioningLoading ||
                !detailsReadyForReadiness ||
                !canProvisionSecrets
              }
              bypassValidation={
                isProductionTarget || !canApprove
                  ? false
                  : bypassOnePasswordValidation
              }
              onBypassValidationChange={checked => {
                if (!isProductionTarget && canApprove) {
                  setBypassOnePasswordValidation(checked);
                }
              }}
              onValidate={() => void handleValidateOnePassword()}
              onProvision={() => void handleTriggerProvisioningFeedback()}
              onOpenEditor={() => setSecretEditorOpen(true)}
              onProceedToNext={() => void handleNext()}
            />
          </Box>
        )}

        {/* ─── Step 3: Review & approve ────────────────────────────────── */}
        {activeStep === 2 && (
          <Box>
            {/* Workflow guide — shown until diff succeeds */}
            {!diffSucceeded && (
              <Paper
                elevation={0}
                sx={{
                  mb: 2,
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid #BFDBFE',
                  bgcolor: '#EFF6FF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
                  >
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: diffSucceeded ? '#059669' : '#2563EB',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                          fontWeight: 600,
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, color: '#1E3A8A' }}
                    >
                      Run Diff
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ color: '#6B7280' }}>
                    →
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      opacity: diffSucceeded ? 1 : 0.45,
                    }}
                  >
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: '#6B7280',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      2
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, color: '#374151' }}
                    >
                      Send For Approval
                    </Typography>
                  </Box>
                </Box>
                <Typography
                  variant="caption"
                  sx={{ color: '#6B7280', ml: 'auto' }}
                >
                  Run Diff validates secrets, saves your config, and unlocks
                  approval.
                </Typography>
              </Paper>
            )}
            <Box className={classes.reviewLayout}>
              <Box className={classes.reviewLeft}>
                <Typography
                  className={classes.panelTitle}
                  style={{ marginBottom: 6 }}
                >
                  Deployment Definition
                </Typography>

                {loadingPreview && (
                  <Box className={classes.loadingContainer}>
                    <CircularProgress size={22} />
                    <Typography variant="body2">
                      Looking up Helmfile &amp; metadata…
                    </Typography>
                  </Box>
                )}

                {previewError && (
                  <Paper
                    elevation={0}
                    className={`${classes.statusBox} ${classes.errorBox}`}
                  >
                    <ErrorIcon style={{ color: '#DC2626' }} />
                    <Typography className={classes.errorText}>
                      {previewError}
                    </Typography>
                  </Paper>
                )}

                {preview && !loadingPreview && (
                  <>
                    <Box style={{ marginBottom: 8 }}>
                      <Chip
                        size="small"
                        label={
                          preview.instanceStatus === 'NEW'
                            ? '✨ New Instance (Auto-create in scripts)'
                            : '✓ Existing Instance'
                        }
                        style={{
                          backgroundColor:
                            preview.instanceStatus === 'NEW'
                              ? '#EFF6FF'
                              : '#ECFDF5',
                          color:
                            preview.instanceStatus === 'NEW'
                              ? '#1D4ED8'
                              : '#047857',
                          fontWeight: 600,
                        }}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      className={classes.monoPath}
                      style={{ display: 'block', marginBottom: 8 }}
                    >
                      {preview.path}
                    </Typography>
                    <Box
                      component="pre"
                      className={classes.codeBlock}
                      style={{
                        maxHeight: 360,
                        whiteSpace: 'pre-wrap',
                        overflow: 'auto',
                      }}
                    >
                      {preview.content}
                    </Box>
                  </>
                )}
              </Box>

              <Box className={classes.reviewRight}>
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <Typography className={classes.panelTitle}>
                    Deployment Summary
                  </Typography>
                  <Chip
                    size="small"
                    className={classes.statusChip}
                    label={`Approval: ${approvalState.label}`}
                    style={{
                      backgroundColor: approvalState.bg,
                      color: approvalState.fg,
                      fontWeight: 700,
                    }}
                  />
                </Box>
                <table className={classes.summaryTable}>
                  <tbody>
                    <tr>
                      <th>Application</th>
                      <td>{appLabel}</td>
                    </tr>
                    <tr>
                      <th>Instance</th>
                      <td>{form.instanceName.trim()}</td>
                    </tr>
                    <tr>
                      <th>Customer</th>
                      <td>{form.customer}</td>
                    </tr>
                    <tr>
                      <th>Cluster</th>
                      <td>{form.clusterName}</td>
                    </tr>
                    <tr>
                      <th>Namespace</th>
                      <td>{preview?.namespace ?? form.instanceName.trim()}</td>
                    </tr>
                    <tr>
                      <th>Region</th>
                      <td>{formatRegionName(selectedCluster?.region)}</td>
                    </tr>
                    {selectedCluster?.resourceGroup ? (
                      <tr>
                        <th>Resource Group</th>
                        <td>{selectedCluster.resourceGroup}</td>
                      </tr>
                    ) : null}
                    {form.chartVersion ? (
                      <tr>
                        <th>Chart Version</th>
                        <td>{form.chartVersion}</td>
                      </tr>
                    ) : null}
                    <tr>
                      <th>Deployment Definition</th>
                      <td
                        style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                      >
                        {preview?.path ??
                          `apps/${
                            form.application
                          }/${form.instanceName.trim()}/helmfile.yaml`}
                      </td>
                    </tr>
                    <tr>
                      <th>Source Branch</th>
                      <td>{options?.branch ?? 'main'}</td>
                    </tr>
                    <tr>
                      <th>Deployment Source</th>
                      <td>CloudHub Native (SymphonyFS/scripts)</td>
                    </tr>
                    {deployment?.createdBy ? (
                      <tr>
                        <th>Requested By</th>
                        <td>{deployment?.createdBy}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>

                <Box style={{ marginTop: 12 }}>
                  <Typography
                    className={classes.panelTitle}
                    style={{ marginBottom: 8 }}
                  >
                    1Password-backed Diff
                  </Typography>

                  {!diffStatus && !diffBusy && (
                    <Paper
                      elevation={0}
                      className={`${classes.statusBox} ${classes.infoBox}`}
                    >
                      <Typography className={classes.infoText}>
                        Run Diff to re-check the deployment state in
                        actionValidation mode. Send For Approval stays locked
                        until this run succeeds.
                      </Typography>
                    </Paper>
                  )}

                  {diffBusy && (
                    <Box
                      className={classes.loadingContainer}
                      style={{ padding: 12 }}
                    >
                      <CircularProgress size={18} />
                      <Typography variant="body2">
                        Dispatching Run Diff…
                      </Typography>
                    </Box>
                  )}

                  {diffError && (
                    <Paper
                      elevation={0}
                      className={`${classes.statusBox} ${classes.errorBox}`}
                      style={{ marginTop: 8 }}
                    >
                      <ErrorIcon style={{ color: '#DC2626' }} />
                      <Typography className={classes.errorText}>
                        {diffError}
                      </Typography>
                    </Paper>
                  )}

                  {diffStatus && (
                    <Paper
                      elevation={0}
                      className={`${classes.statusBox} ${classes.infoBox}`}
                      style={{ display: 'block' }}
                    >
                      <Box
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginBottom: 8,
                        }}
                      >
                        <Typography variant="body2" style={{ fontWeight: 700 }}>
                          Run ID:{' '}
                          {diffStatus.workflowRunId ?? 'Pending correlation'}
                        </Typography>
                        <Chip
                          size="small"
                          label={diffStatusLabel(diffStatus)}
                          style={{
                            backgroundColor: diffStatusColors(diffStatus).bg,
                            color: diffStatusColors(diffStatus).fg,
                            fontWeight: 700,
                          }}
                        />
                      </Box>

                      <Typography variant="body2" style={{ color: '#1F2937' }}>
                        {diffStatus.statusMessage ?? diffStatus.currentStep}
                      </Typography>

                      {diffStatus.correlationMessage && (
                        <Typography
                          variant="body2"
                          style={{ color: '#6B7280', marginTop: 6 }}
                        >
                          Correlation: {diffStatus.correlationMessage}
                        </Typography>
                      )}

                      {diffStatus.failureReason && (
                        <Typography
                          variant="body2"
                          style={{ color: '#B91C1C', marginTop: 6 }}
                        >
                          {diffStatus.failureReason}
                        </Typography>
                      )}

                      {diffStatus.workflowRunUrl && (
                        <Box style={{ marginTop: 8 }}>
                          <Link
                            href={diffStatus.workflowRunUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View diff workflow run ↗
                          </Link>
                        </Box>
                      )}

                      {diffSummary.parsed && (
                        <Box style={{ marginTop: 10 }}>
                          <Box
                            style={{
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                              marginBottom:
                                diffSummary.destructiveRemovals.length > 0
                                  ? 8
                                  : 0,
                            }}
                          >
                            <Chip
                              size="small"
                              label={`+ ${diffSummary.added.length} added`}
                              style={{
                                backgroundColor: '#ECFDF5',
                                color: '#047857',
                                fontWeight: 600,
                              }}
                            />
                            <Chip
                              size="small"
                              label={`~ ${diffSummary.modified.length} modified`}
                              style={{
                                backgroundColor: '#EFF6FF',
                                color: '#1D4ED8',
                                fontWeight: 600,
                              }}
                            />
                            <Chip
                              size="small"
                              label={`- ${diffSummary.removed.length} removed`}
                              style={{
                                backgroundColor:
                                  diffSummary.removed.length > 0
                                    ? '#FEF2F2'
                                    : '#F3F4F6',
                                color:
                                  diffSummary.removed.length > 0
                                    ? '#B91C1C'
                                    : '#6B7280',
                                fontWeight: 600,
                              }}
                            />
                          </Box>
                          {diffSummary.destructiveRemovals.length > 0 && (
                            <Paper
                              elevation={0}
                              style={{
                                padding: 10,
                                borderRadius: 8,
                                border: '1px solid #FECACA',
                                backgroundColor: '#FEF2F2',
                              }}
                            >
                              <Typography
                                variant="body2"
                                style={{
                                  fontWeight: 700,
                                  color: '#B91C1C',
                                  marginBottom: 4,
                                }}
                              >
                                ⚠ Destructive changes detected
                              </Typography>
                              <Typography
                                variant="body2"
                                style={{ color: '#7F1D1D', marginBottom: 6 }}
                              >
                                This diff removes stateful resources. Data on
                                these resources will be lost if applied:
                              </Typography>
                              <Box
                                component="ul"
                                style={{ margin: 0, paddingLeft: 18 }}
                              >
                                {diffSummary.destructiveRemovals.map(item => (
                                  <li key={item}>
                                    <Typography
                                      variant="body2"
                                      style={{ color: '#7F1D1D' }}
                                    >
                                      {item}
                                    </Typography>
                                  </li>
                                ))}
                              </Box>
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 6,
                                  marginTop: 8,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={acknowledgedDestructiveDiff}
                                  onChange={e =>
                                    setAcknowledgedDestructiveDiff(
                                      e.target.checked,
                                    )
                                  }
                                  style={{ marginTop: 2 }}
                                />
                                <Typography
                                  variant="body2"
                                  style={{ color: '#7F1D1D' }}
                                >
                                  I have reviewed the removals above and confirm
                                  this deployment should proceed.
                                </Typography>
                              </label>
                            </Paper>
                          )}
                        </Box>
                      )}

                      <Box
                        component="div"
                        style={{
                          marginTop: 10,
                          maxHeight: 180,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: '0.74rem',
                          lineHeight: 1.45,
                        }}
                      >
                        {diffEvents.length === 0 ? (
                          <Typography variant="body2" color="textSecondary">
                            Waiting for diff activity...
                          </Typography>
                        ) : (
                          diffEvents.map(event => (
                            <Box key={event.id} style={{ marginBottom: 6 }}>
                              <div style={{ color: '#64748b' }}>
                                {new Date(event.createdAt).toLocaleTimeString()}{' '}
                                [{event.eventType}]
                              </div>
                              <div>{event.note ?? event.eventType}</div>
                            </Box>
                          ))
                        )}
                      </Box>
                    </Paper>
                  )}
                </Box>

                {approvalError && (
                  <Paper
                    elevation={0}
                    className={`${classes.statusBox} ${classes.errorBox}`}
                    style={{ marginTop: 12 }}
                  >
                    <ErrorIcon style={{ color: '#DC2626' }} />
                    <Typography className={classes.errorText}>
                      {approvalError}
                    </Typography>
                  </Paper>
                )}

                {reviewPhase === 'review' && (
                  <Box className={classes.infoBox} style={{ marginTop: 12 }}>
                    <Typography className={classes.infoText}>
                      Submitted for review &amp; approval. Only members of{' '}
                      <strong>GRP-CloudHub-PlatformAdmin</strong> can approve.
                    </Typography>
                  </Box>
                )}

                {reviewPhase === 'saved' && (
                  <Box className={classes.infoBox} style={{ marginTop: 12 }}>
                    <Typography className={classes.infoText}>
                      Configuration saved to PostgreSQL. Send for approval to
                      continue.
                    </Typography>
                  </Box>
                )}

                {reviewPhase === 'diffed' && (
                  <Box className={classes.infoBox} style={{ marginTop: 12 }}>
                    <Typography className={classes.infoText}>
                      {diffSucceeded
                        ? '1Password-backed diff completed successfully. You can now send this request for approval.'
                        : diffCompletedWithFailure
                        ? '1Password-backed diff completed with failures. Fix the issues and run diff again before approval.'
                        : 'Diff run is in progress. Review logs while the workflow continues.'}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        )}

        {/* ─── Step 4: Deploy & track ──────────────────────────────────── */}
        {activeStep === 3 && deployment && statusView && (
          <>
            <Box className={classes.stepCard}>
              <StatusIcon status={statusView.status} />
              <Box style={{ flex: 1 }}>
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography variant="subtitle1" style={{ fontWeight: 700 }}>
                    {deployment.deploymentName}
                  </Typography>
                  <Chip
                    size="small"
                    className={classes.statusChip}
                    label={statusStyle(statusView.status).label}
                    style={{
                      backgroundColor: statusStyle(statusView.status).bg,
                      color: statusStyle(statusView.status).fg,
                    }}
                  />
                  <Chip
                    size="small"
                    className={classes.statusChip}
                    label={`Approval: ${approvalState.label}`}
                    style={{
                      backgroundColor: approvalState.bg,
                      color: approvalState.fg,
                      fontWeight: 700,
                    }}
                  />
                </Box>
                <Typography variant="body2" color="textSecondary">
                  {statusView.currentStep}
                </Typography>
              </Box>
              {!isTerminalStatus(statusView.status) && (
                <CircularProgress size={22} />
              )}
            </Box>

            <Box className={classes.summaryGrid}>
              <SummaryItem
                classes={classes}
                label="Namespace"
                value={deployment.namespace}
              />
              <SummaryItem
                classes={classes}
                label="Execution Run ID"
                value={statusView.workflowRunId ?? '—'}
              />
              <SummaryItem
                classes={classes}
                label="Mode"
                value={deployment.mode}
              />
              <SummaryItem
                classes={classes}
                label="Helmfile"
                value={deployment.helmfilePath}
              />
              <SummaryItem
                classes={classes}
                label="Commit"
                value={deployment.commitSha?.slice(0, 12) ?? '—'}
              />
            </Box>

            {statusView.failureReason && (
              <Paper
                elevation={0}
                className={`${classes.statusBox} ${classes.errorBox}`}
              >
                <ErrorIcon style={{ color: '#DC2626' }} />
                <Typography className={classes.errorText}>
                  {statusView.failureReason}
                </Typography>
              </Paper>
            )}

            {statusView.workflowRunUrl && (
              <Link
                href={statusView.workflowRunUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View execution run ↗
              </Link>
            )}

            <Paper
              elevation={0}
              className={`${classes.statusBox} ${classes.infoBox}`}
              style={{ display: 'block' }}
              id={LIVE_LOG_PANEL_ID}
              ref={liveLogPanelRef}
            >
              <Typography
                className={classes.panelTitle}
                style={{ marginBottom: 8 }}
              >
                Live deployment log
              </Typography>
              {streamNotice && (
                <Typography
                  variant="body2"
                  style={{ color: '#B45309', marginBottom: 8 }}
                >
                  {streamNotice}
                </Typography>
              )}
              <Box
                component="div"
                style={{
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.74rem',
                  lineHeight: 1.5,
                  maxHeight: 220,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  marginBottom: 12,
                }}
              >
                {deploymentEvents.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    Waiting for deployment activity...
                  </Typography>
                ) : (
                  deploymentEvents.map(event => (
                    <Box key={event.id} style={{ marginBottom: 6 }}>
                      <div style={{ color: '#64748b' }}>
                        {new Date(event.createdAt).toLocaleTimeString()}{' '}
                        {event.toStatus ? `[${event.toStatus}]` : ''}
                      </div>
                      <div>{event.note ?? event.eventType}</div>
                    </Box>
                  ))
                )}
              </Box>
              <Typography
                className={classes.panelTitle}
                style={{ marginBottom: 6 }}
              >
                Helmfile definition
              </Typography>
              <Box
                component="pre"
                className={classes.codeBlock}
                style={{ maxHeight: 220, whiteSpace: 'pre-wrap' }}
              >
                {getHelmfileConsoleContent(
                  preview?.content,
                  deployment?.helmfileContent,
                )}
              </Box>
            </Paper>

            {statusView.status === 'SUCCEEDED' && (
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid #BBF7D0',
                  bgcolor: '#F0FDF4',
                }}
              >
                <Typography className={classes.panelTitle} sx={{ mb: 1 }}>
                  Post-Deployment Verification
                </Typography>

                <ApplicationHealthPanel
                  applicationUrl={
                    statusView.applicationUrl ??
                    calculateIngressTarget({
                      application: deployment.application,
                      customer: deployment.customer,
                      instanceName: deployment.instanceName,
                      environment: deployment.environment,
                    })?.url ??
                    null
                  }
                  healthCheck={healthCheck}
                  onRetry={() => setHealthCheckAttempt(attempt => attempt + 1)}
                />

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                    Verification commands
                  </Typography>
                  {[
                    `kubectl get pods,pvc -n ${deployment.namespace}`,
                    `kubectl create job --from=cronjob/${deployment.application}-update-views manual-update-views-$(date +%s) -n ${deployment.namespace}`,
                  ].map(command => (
                    <Box
                      key={command}
                      component="pre"
                      className={classes.codeBlock}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 1,
                        whiteSpace: 'pre-wrap',
                        mb: 1,
                      }}
                    >
                      <span>{command}</span>
                      <Button
                        size="small"
                        onClick={() => {
                          void navigator.clipboard?.writeText(command);
                        }}
                      >
                        Copy
                      </Button>
                    </Box>
                  ))}
                  <Typography variant="caption" color="textSecondary">
                    The update-views job only applies to upgrades of apps with
                    that cronjob defined — skip it for a fresh install.
                  </Typography>
                </Box>

                {modeDetection?.currentChartVersion &&
                  modeDetection.currentChartVersion !==
                    deployment.chartVersion && (
                    <Box>
                      <Button
                        onClick={handleStartRollback}
                        variant="outlined"
                        color="secondary"
                        startIcon={<ReplayIcon />}
                      >
                        Roll back to {modeDetection.currentChartVersion}
                      </Button>
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        sx={{ display: 'block', mt: 0.5 }}
                      >
                        Starts a new reviewed deployment pinned to the previous
                        version — goes through Diff and Approval again, it does
                        not revert the cluster directly.
                      </Typography>
                    </Box>
                  )}
              </Paper>
            )}

            {submitError && (
              <Paper
                elevation={0}
                className={`${classes.statusBox} ${classes.errorBox}`}
              >
                <ErrorIcon style={{ color: '#DC2626' }} />
                <Typography className={classes.errorText}>
                  {submitError}
                </Typography>
              </Paper>
            )}
          </>
        )}

        {/* ─── Global modals (rendered outside step blocks, portalled by MUI) ── */}
        <SecretReadinessModal
          open={secretEditorOpen}
          customer={form.customer}
          loading={loadingSecretReport}
          report={secretReport}
          error={secretReportError}
          effectivelyReady={secretsEffectivelyReady}
          provisionDisabled={
            loadingSecretReport || provisioningLoading || !canProvisionSecrets
          }
          fields={fieldsNeedingValues}
          fieldValues={fieldUpdateValues}
          updatingFieldReference={updatingFieldReference}
          onFieldValueChange={(reference, value) => {
            setFieldUpdateValues(prev => ({
              ...prev,
              [reference]: value,
            }));
          }}
          onSaveField={async (field, value) => {
            await handleUpdateFieldValue(field, value);
          }}
          onRevalidate={() => void runSecretReadinessCheck(true)}
          onProvision={() => {
            setSecretEditorOpen(false);
            void handleTriggerProvisioningFeedback();
          }}
          onOpenChange={setSecretEditorOpen}
          suggestedValueFor={field => {
            const name = field.field.toLowerCase();
            if (name.endsWith('__entity_resolution_chart_version')) {
              return (
                entityResolutionChartVersion.trim() ||
                form.chartVersion?.trim() ||
                undefined
              );
            }
            if (name.endsWith('__helm_chart_version')) {
              return form.chartVersion?.trim() || undefined;
            }
            if (name.endsWith('__project_overlay_files_ref')) {
              return 'main';
            }
            return undefined;
          }}
        />

        <ProvisioningFeedbackModal
          open={provisioningFeedbackOpen}
          isLoading={provisioningLoading}
          logs={provisioningLogs}
          report={provisioningReport}
          error={provisioningError}
          onClose={() => {
            provisioningStreamAbortRef.current?.abort();
            setProvisioningFeedbackOpen(false);
          }}
          onOpenSecretEditor={() => setSecretEditorOpen(true)}
          onProceedToDeploy={() => {
            setProvisioningFeedbackOpen(false);
            void (async () => {
              await loadPreview();
              setActiveStep(2);
              setReviewPhase('summary');
            })();
          }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={submitting} variant="outlined">
          {activeStep === 3 ? 'Close' : 'Cancel'}
        </Button>

        {/* Step 1: Deployment Details — Next */}
        {activeStep === 0 && mode !== 'page' && (
          <Button
            onClick={() => void handleNext()}
            disabled={nextDisabled}
            color="primary"
            variant="contained"
          >
            Next
          </Button>
        )}

        {/* Step 2: 1Password Setup — Back + Next */}
        {activeStep === 1 && (
          <>
            <Button
              onClick={() => setActiveStep(0)}
              disabled={loadingSecretReport}
            >
              Back
            </Button>
            <Button
              onClick={() => void handleNext()}
              disabled={nextDisabled}
              color="primary"
              variant="contained"
            >
              {loadingSecretReport ? 'Checking secrets…' : 'Next'}
            </Button>
          </>
        )}

        {/* Step 3: Review & Approve */}
        {activeStep === 2 && (
          <>
            <Button
              onClick={() => setActiveStep(1)}
              disabled={submitting || approvalBusy || loadingPreview}
            >
              Back
            </Button>

            {/* Regenerate fallback — only visible if preview failed to load */}
            {!preview?.content && !loadingPreview && (
              <Button
                onClick={() => void handleGenerateConfig()}
                disabled={submitting || approvalBusy || loadingPreview}
                variant="outlined"
              >
                {loadingPreview ? 'Loading…' : 'Load Config'}
              </Button>
            )}

            <Button
              onClick={() => void handleRunDiff()}
              disabled={
                submitting ||
                approvalBusy ||
                savingDeployment ||
                loadingPreview ||
                loadingSecretReport ||
                diffBusy
              }
              color={diffSucceeded ? 'inherit' : 'primary'}
              variant={diffSucceeded ? 'outlined' : 'contained'}
              startIcon={
                diffBusy ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {diffBusy || reviewPhase === 'diffing'
                ? 'Running Diff…'
                : diffSucceeded
                ? 'Re-run Diff'
                : 'Run Diff'}
            </Button>

            <Button
              onClick={() => void handleSendForReview()}
              disabled={
                submitting ||
                approvalBusy ||
                savingDeployment ||
                diffBusy ||
                loadingSecretReport ||
                loadingPreview ||
                !deployment ||
                !secretReport?.ready ||
                !diffSucceeded ||
                reviewPhase === 'review'
              }
              color="primary"
              variant="contained"
              size="large"
              style={{ minWidth: 220, fontWeight: 700 }}
              startIcon={
                approvalBusy ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  <CloudUploadIcon />
                )
              }
            >
              {approvalBusy
                ? 'Submitting…'
                : reviewPhase === 'review'
                ? 'Awaiting Approval…'
                : 'Send For Approval'}
            </Button>

            {canApprove && reviewPhase === 'review' && approvalId && (
              <Button
                onClick={() => void handleReject()}
                disabled={submitting || approvalBusy}
                color="secondary"
                variant="outlined"
              >
                Reject
              </Button>
            )}

            {canApprove && reviewPhase === 'review' && approvalId && (
              <Button
                onClick={() => void handleDeploy()}
                disabled={
                  submitting ||
                  approvalBusy ||
                  loadingPreview ||
                  loadingSecretReport ||
                  !secretReport?.ready ||
                  (diffSummary.destructiveRemovals.length > 0 &&
                    !acknowledgedDestructiveDiff)
                }
                color="primary"
                variant="contained"
                size="large"
                style={{ minWidth: 160, fontWeight: 700 }}
                startIcon={
                  submitting || approvalBusy ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    <CheckCircleIcon />
                  )
                }
              >
                {submitting || approvalBusy ? 'Deploying…' : 'Deploy'}
              </Button>
            )}
          </>
        )}

        {/* Step 4: Deploy & Track */}
        {activeStep === 3 && statusView && statusView.status === 'FAILED' && (
          <Button
            onClick={handleRetry}
            disabled={submitting}
            color="primary"
            variant="contained"
            startIcon={
              submitting ? <CircularProgress size={18} /> : <ReplayIcon />
            }
          >
            Retry
          </Button>
        )}
      </DialogActions>
    </>
  );
  if (mode === 'page') {
    return <div className={classes.pageRoot}>{wizardBody}</div>;
  }
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        style: {
          maxHeight: '90vh',
          width: 'min(1200px, calc(100vw - 24px))',
          margin: 12,
        },
      }}
    >
      {wizardBody}
    </Dialog>
  );
}

function SummaryItem({
  classes,
  label,
  value,
}: {
  classes: ReturnType<typeof useStyles>;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <Box className={classes.summaryItem}>
      <Typography className={classes.summaryLabel}>{label}</Typography>
      <Typography className={classes.summaryValue}>{value}</Typography>
    </Box>
  );
}

function StatusIcon({
  status,
}: {
  status: PortalDeploymentStatusView['status'];
}): JSX.Element {
  if (status === 'SUCCEEDED') {
    return <CheckCircleIcon style={{ color: '#059669' }} />;
  }
  if (status === 'FAILED') {
    return <ErrorIcon style={{ color: '#DC2626' }} />;
  }
  return <CloudUploadIcon style={{ color: '#2563EB' }} />;
}

export function ApplicationHealthPanel(props: {
  applicationUrl: string | null;
  healthCheck: HealthCheckState;
  onRetry: () => void;
}) {
  const { applicationUrl, healthCheck, onRetry } = props;
  if (!applicationUrl) {
    return null;
  }
  const lastAttempt = healthCheck.result?.attempts.at(-1);
  const lastAttemptLabel = lastAttempt
    ? `${lastAttempt.path} → ${lastAttempt.statusCode ?? lastAttempt.error}`
    : null;

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Live endpoint
      </Typography>
      {healthCheck.phase === 'healthy' ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="contained"
            color="success"
            href={applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open application ↗
          </Button>
          <Typography variant="body2" color="text.secondary">
            Healthy via {healthCheck.result?.healthyPath}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {healthCheck.phase !== 'timeout' && <CircularProgress size={16} />}
            <Typography variant="body2">
              {healthCheck.phase === 'timeout'
                ? 'The application did not report healthy within 10 minutes.'
                : 'Waiting for the application to report healthy…'}
            </Typography>
            {healthCheck.phase === 'timeout' && (
              <Button size="small" onClick={onRetry}>
                Check again
              </Button>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div">
            <Link
              href={applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {applicationUrl}
            </Link>
            {lastAttemptLabel && ` · last probe ${lastAttemptLabel}`}
          </Typography>
        </>
      )}
    </Box>
  );
}
