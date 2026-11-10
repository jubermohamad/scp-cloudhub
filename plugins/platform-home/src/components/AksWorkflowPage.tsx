/**
 * AksWorkflowPage – AKS cluster creation as a guided, multi-step wizard.
 *
 * The portal generates tfvars and workspace registration entries that match the
 * previous cloudhub-infra-as-code manual workflow (now consolidated into this repo).
 *
 * The flow is:
 *   Profile → Configure → Review (plan only) → Submit (tfvars + workspace PR) → Approval → Provision
 *
 * GitHub operations are executed by the backend provisioning service.
 */

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  ChangeEvent,
  CSSProperties,
  Fragment,
  ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { makeStyles } from '@mui/styles';
import {
  Typography,
  Button,
  TextField,
  MenuItem,
  Chip,
  Tooltip,
  Switch,
  FormControlLabel,
  useMediaQuery,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tabs,
  Tab,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import StorageIcon from '@mui/icons-material/Storage';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ReplayIcon from '@mui/icons-material/Replay';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  AKS_ENVIRONMENTS,
  AKS_FLAVOR_POOLS,
  AKS_STANDARD_SUBSCRIPTION_ID,
  AKS_TENANCIES,
  AKS_UNSUPPORTED_PROFILES,
  AZURE_REGION_SHORTNAMES,
  deriveAksNames,
  deriveAksSubnets,
  readJsonOrThrow,
  readJsonResponse,
  renderAksValuesFile,
  useBackendEventStream,
  useBackendFetch,
  validateAksClusterRequest,
  type AksClusterRequest,
  type AksDerivedNames,
  type AksDerivedSubnets,
  type AksNodePool,
  type AksNodeSizeFlavor,
  type AksReadinessStatus,
  type ExecutionEvent,
} from '@internal/plugin-platform-common';
import {
  createInitialAksWizardForm,
  toAksClusterRequest,
  type AksWizardForm,
} from './aksWizardRequest';
import {
  GATES_BLOCKING_MESSAGE,
  TRACKING_NOT_CONFIGURED,
  executionHeadline,
  executionStages,
  freshnessBanner,
  lastVerifiedAt,
  parseGateReport,
  resumeErrorMessage,
  resumePhaseForStatus,
  shouldPollExecution,
  type ExecutionStage,
  type ExecutionView,
  type GateStatus,
  type Severity,
  type SubmissionGateReport,
} from './aksExecutionView';

// ─── Types ──────────────────────────────────────────────────────────────────

type RunState = 'draft' | 'running' | 'completed' | 'cancelled' | 'failed';
type StepStatus = 'pending' | 'running' | 'done';

interface AksStep {
  id: string;
  label: string;
  tool: string;
  detail: string;
  durationMs: number;
}

/** Wizard form state; see aksWizardRequest.ts for the canonical mapping. */
type AksFormData = AksWizardForm;

// ─── Tier model ───────────────────────────────────────────────────────────────

type NodeSizeFlavor = AksNodeSizeFlavor;

interface NodeSizeFlavorMeta {
  label: string;
  nodeSize: string;
  description: string;
  accent: string;
}

/** Display metadata; the pools themselves come from AKS_FLAVOR_POOLS. */
const NODE_SIZE_FLAVORS: Record<NodeSizeFlavor, NodeSizeFlavorMeta> = {
  small: {
    label: 'Small',
    nodeSize: AKS_FLAVOR_POOLS.small.userPool.vmSize,
    description: 'Lightweight compute for development and early validation.',
    accent: '#0EA5E9',
  },
  medium: {
    label: 'Medium',
    nodeSize: AKS_FLAVOR_POOLS.medium.userPool.vmSize,
    description: 'Balanced compute for regular team workloads.',
    accent: '#22C55E',
  },
  large: {
    label: 'Large',
    nodeSize: AKS_FLAVOR_POOLS.large.userPool.vmSize,
    description: 'Higher-capacity compute for demanding workloads.',
    accent: '#A855F7',
  },
};
const NODE_SIZE_FLAVOR_ORDER: NodeSizeFlavor[] = ['small', 'medium', 'large'];

/** Azure region names accepted by the standard root, alphabetically. */
const REGION_NAMES = Object.keys(AZURE_REGION_SHORTNAMES).sort();
const regionText = (location: string) =>
  AZURE_REGION_SHORTNAMES[location]
    ? `${location} (${AZURE_REGION_SHORTNAMES[location]})`
    : location;

const TENANCY_LABELS: Record<string, string> = {
  st: 'Single-tenant',
  mt: 'Multi-tenant',
};

/** provider.tf of the standard root fixes the subscription. */
const AKS_SUBSCRIPTION_LABEL = `Azure Sensa Engineering (${AKS_STANDARD_SUBSCRIPTION_ID})`;

const NOT_ESTIMATED = 'Not estimated yet';
const UNSUPPORTED_PROFILE_TEXT =
  'Multi-region (paired clusters) not yet supported';

interface ProfileMeta {
  id: string;
  label: string;
  tagline: string;
  multiRegion: boolean;
  approvals: string[];
  accent: string;
}

const PROFILE_META: Record<string, ProfileMeta> = {
  'free-tier': {
    id: 'free-tier',
    label: 'Free Tier',
    tagline: 'Ideal for early validation and lightweight business use cases.',
    multiRegion: false,
    approvals: ['Platform Team'],
    accent: '#0EA5E9',
  },
  'dev-tier': {
    id: 'dev-tier',
    label: 'Dev Tier',
    tagline: 'Balanced profile for day-to-day development and team testing.',
    multiRegion: false,
    approvals: ['Platform Team'],
    accent: '#22C55E',
  },
  'single-region': {
    id: 'single-region',
    label: 'Single Region',
    tagline: 'Production-ready deployment in one region for focused delivery.',
    multiRegion: false,
    approvals: ['Platform Team'],
    accent: '#6366F1',
  },
  'active-passive': {
    id: 'active-passive',
    label: 'Multi-Region Active/Passive',
    tagline:
      'Primary and standby regions for stronger continuity and recovery.',
    multiRegion: true,
    approvals: ['Platform Team', 'Cloud Architect'],
    accent: '#A855F7',
  },
  'active-active': {
    id: 'active-active',
    label: 'Multi-Region Active/Active',
    tagline:
      'Dual active regions for high availability and resilient operations.',
    multiRegion: true,
    approvals: ['Platform Team', 'Cloud Architect', 'Operations'],
    accent: '#EC4899',
  },
};

const PROFILE_ORDER = [
  'free-tier',
  'dev-tier',
  'single-region',
  'active-passive',
  'active-active',
];

const isUnsupportedProfile = (profile: string) =>
  AKS_UNSUPPORTED_PROFILES.includes(profile);
const isSpotAllowed = (env: string) => env !== 'prd' && env !== 'ppd';

/** Configure-tab membership of each field, used to jump to the first error. */
const TAB0_FIELDS = [
  'customer',
  'businessUnit',
  'owner',
  'costCentre',
  'changeTicket',
  'clusterProfile',
  'env',
  'tenancy',
  'tenantId',
  'name',
];
const TAB1_FIELDS = [
  'location',
  'kubernetesVersion',
  'addressSpace',
  'systemPool',
  'userPool',
];

const formatPool = (p: AksNodePool) =>
  `${p.vmSize} · ${p.minCount}–${p.maxCount} nodes${
    p.priority === 'Spot' ? ' (Spot)' : ''
  }`;

/** Response of POST /plan (validation + preview, no Terraform run). */
interface PlanPreview {
  valid?: boolean;
  fieldErrors?: Record<string, string>;
  errors?: string[];
  warnings?: string[];
  names?: AksDerivedNames;
  subnets?: AksDerivedSubnets;
  subscriptionId?: string;
  repository?: string;
  valuesFile?: string;
  error?: string;
  /** Mandatory submission preflight gates (present when the request is valid). */
  gates?: SubmissionGateReport;
}

/** Poll interval for the read-only execution refresh endpoint. */
const EXECUTION_POLL_MS = 20000;

const NOTICE_COLORS: Record<
  Severity,
  { background: string; border: string; color: string }
> = {
  success: { background: '#F0FDF4', border: '#86EFAC', color: '#166534' },
  info: { background: '#EFF6FF', border: '#BFDBFE', color: '#1E40AF' },
  warning: { background: '#FFFBEB', border: '#FCD34D', color: '#92400E' },
  error: { background: '#FEF2F2', border: '#FCA5A5', color: '#991B1B' },
};

const GATE_CHIP_COLORS: Record<
  GateStatus,
  { background: string; color: string }
> = {
  passed: { background: '#DCFCE7', color: '#166534' },
  failed: { background: '#FEE2E2', color: '#991B1B' },
  unverified: { background: '#FEF3C7', color: '#92400E' },
};

const STAGE_STATE_STYLE: Record<
  ExecutionStage['state'],
  { dot: string; color: string; symbol: string }
> = {
  pending: { dot: '#E5E7EB', color: '#6B7280', symbol: '' },
  active: { dot: '#BFDBFE', color: '#1D4ED8', symbol: '…' },
  action: { dot: '#BFDBFE', color: '#1D4ED8', symbol: '!' },
  done: { dot: '#059669', color: '#FFFFFF', symbol: '✓' },
  warning: { dot: '#F59E0B', color: '#FFFFFF', symbol: '!' },
  error: { dot: '#DC2626', color: '#FFFFFF', symbol: '✕' },
};

// ─── Wizard phases ────────────────────────────────────────────────────────────

const WIZARD_PHASES = [
  'configure',
  'review',
  'approval',
  'pull_request',
  'provision',
] as const;
type WizardPhase = (typeof WIZARD_PHASES)[number];

// GitHub username: 1-39 chars, alphanumeric or single internal hyphens.
const GITHUB_USERNAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

/** CloudHub business approval stage returned by the provisioning backend. */
type ApprovalStage = {
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  approver?: string;
  decidedAt?: string;
};
const PHASE_LABELS: Record<WizardPhase, string> = {
  configure: 'Configure',
  review: 'Review',
  approval: 'Platform Approval',
  pull_request: 'Pull Request',
  provision: 'Provision & Configure',
};

const ts = () => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
};

// ─── Provisioning stages (display only; progress comes from the backend) ──────

function buildProvisionSteps(
  request: AksClusterRequest,
  names: AksDerivedNames,
): AksStep[] {
  const ws = names.workspaceName;
  return [
    {
      id: 'p-1',
      label: 'Validate',
      tool: 'render_tfvars.py',
      durationMs: 1200,
      detail: `PR merged — values file ${names.valuesFilePath} for ${ws}.`,
    },
    {
      id: 'p-2',
      label: 'Terraform Init',
      tool: 'terraform init',
      durationMs: 1400,
      detail: `Initialising backend + provider plugins for ${ws}.`,
    },
    {
      id: 'p-3',
      label: 'Terraform Plan',
      tool: 'terraform plan',
      durationMs: 1600,
      detail:
        'The Terraform plan is produced by Terraform Cloud after the infrastructure PR merges.',
    },
    {
      id: 'p-4',
      label: 'Resource Group',
      tool: 'terraform apply',
      durationMs: 1500,
      detail: `Resource group ${names.resourceGroupName} in ${request.location}.`,
    },
    {
      id: 'p-5',
      label: 'Networking',
      tool: 'terraform apply',
      durationMs: 1700,
      detail: `VNet ${names.vnetName} (${
        request.addressSpace || 'address space not set'
      }) and derived subnets.`,
    },
    {
      id: 'p-6',
      label: 'Identity & RBAC',
      tool: 'terraform apply',
      durationMs: 1500,
      detail: `Managed identity + kubelet identity and role assignments.`,
    },
    {
      id: 'p-7',
      label: 'AKS Cluster',
      tool: 'terraform apply',
      durationMs: 1800,
      detail: `Cluster ${names.clusterName} (k8s ${request.kubernetesVersion}).`,
    },
    {
      id: 'p-8',
      label: 'Validation',
      tool: 'Health Check Suite',
      durationMs: 1500,
      detail: `AKS API reachable, nodes Ready, CoreDNS + CNI healthy.`,
    },
    {
      id: 'p-9',
      label: 'Register',
      tool: 'CloudHub Inventory',
      durationMs: 1300,
      detail: `Register cluster metadata in the platform inventory.`,
    },
    {
      id: 'p-10',
      label: 'GitOps Bootstrap',
      tool: 'ArgoCD',
      durationMs: 1700,
      detail: `Bootstrap ArgoCD, External Secrets, Cert Manager, Ingress, Monitoring.`,
    },
    {
      id: 'p-11',
      label: 'Cluster Ready',
      tool: 'CloudHub',
      durationMs: 1200,
      detail: `Cluster ${ws} registered in the platform catalog.`,
    },
  ];
}

function buildProvisionLog(
  steps: AksStep[],
  currentIdx: number,
  stepPct: number,
  runState: RunState,
  clusterName: string,
): string[] {
  const lines: string[] = [];
  lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(
    `[${ts()}] GitHub Actions Pipeline  cluster=${
      clusterName || 'cloudhub-dev'
    }  state=${runState.toUpperCase()}`,
  );
  lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push('');
  steps.forEach((step, i) => {
    const st: StepStatus = getStepStatus(runState, currentIdx, i);
    if (st === 'done') {
      lines.push(
        `[${ts()}] ✓  DONE     [${String(i + 1).padStart(2, '0')}] ${
          step.label
        }`,
      );
      lines.push(`[${ts()}]    output : ${step.detail}`);
      lines.push('');
    } else if (st === 'running') {
      lines.push(
        `[${ts()}] ▶  RUNNING  [${String(i + 1).padStart(2, '0')}] ${
          step.label
        }  (${stepPct}%)`,
      );
      lines.push(`[${ts()}]    stream : ${step.detail}`);
    }
  });
  if (runState === 'completed') {
    lines.push('');
    lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`[${ts()}] ✅  PROVISIONING COMPLETE — cluster Ready.`);
    lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  } else if (runState === 'cancelled') {
    lines.push('');
    lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`[${ts()}] ⛔  PROVISIONING CANCELLED BY USER.`);
    lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  } else if (runState === 'failed') {
    lines.push('');
    lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`[${ts()}] ❌  PROVISIONING FAILED.`);
    lines.push(`[${ts()}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
  return lines;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StepIcon({ status, label }: { status: StepStatus; label: string }) {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        flexShrink: 0,
        border: `2px solid ${getStepIconBorderColor(status)}`,
        background: getStepIconBg(status),
        color: getStepIconTextColor(status),
        fontSize: '0.62rem',
        fontWeight: 800,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </span>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(1.25, 4, 3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 'calc(100vh - 64px)',
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(1, 2, 2) },
  },
  tabRoot: {
    padding: 0,
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 0,
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column',
  },
  modalPaper: {
    height: 'min(900px, 94vh)',
    maxHeight: '94vh',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  },
  modalTitleBar: {
    padding: theme.spacing(1.5, 2.5),
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitleLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
  },
  modalIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: 'linear-gradient(135deg, #6B21A8 0%, #4C1480 100%)',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 10px rgba(107, 33, 168, 0.25)',
  },
  modalTitleText: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: '#111827',
    lineHeight: 1.2,
  },
  modalSubtitleText: {
    fontSize: '0.78rem',
    color: '#6B7280',
    marginTop: 2,
  },
  modalTitleRight: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
  },
  modalStepperBar: {
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    padding: theme.spacing(0.5, 2.5),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 42,
  },
  stepperNodeCompact: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  stepperDotCompact: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.72rem',
    fontWeight: 800,
    flexShrink: 0,
  },
  stepperNameCompact: {
    fontSize: '0.78rem',
    fontWeight: 700,
  },
  stepperConnCompact: {
    flex: 1,
    height: 2,
    borderRadius: 999,
    margin: theme.spacing(0, 1),
    minWidth: 16,
  },
  modalContent: {
    flex: 1,
    padding: theme.spacing(2, 2.5),
    overflowY: 'auto',
    backgroundColor: '#F8FAFC',
  },
  modalFooter: {
    padding: theme.spacing(1.25, 2.5),
    backgroundColor: '#FFFFFF',
    borderTop: '1px solid #E5E7EB',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1.5),
  },
  configSubTabs: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    minHeight: 38,
    marginBottom: theme.spacing(1.25),
    '& .MuiTab-root': {
      minHeight: 38,
      padding: '6px 14px',
      fontSize: '0.78rem',
      fontWeight: 700,
      textTransform: 'none',
    },
  },
  configTabPanel: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    padding: theme.spacing(1.75),
  },
  configFieldsGrid2Col: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  inspectorPanel: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    padding: theme.spacing(1.25),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
    position: 'sticky',
    top: 0,
  },
  clusterNameBox: {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.69rem',
    fontWeight: 700,
    backgroundColor: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 6,
    padding: '3px 7px',
    color: '#0F172A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    wordBreak: 'break-all',
    minHeight: 30,
  },
  mainActionBanner: {
    border: '1px solid #E5E7EB',
    borderRadius: 14,
    padding: theme.spacing(2.25, 3),
    backgroundColor: '#FFFFFF',
    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.04)',
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(3),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2.5),
    [theme.breakpoints.down('sm')]: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
  },
  mainActionLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  hubPrimaryBtn: {
    borderRadius: 8,
    fontWeight: 700,
    fontSize: '0.925rem',
    textTransform: 'none',
    padding: '10px 22px',
    background: 'linear-gradient(135deg, #6B21A8 0%, #4C1480 100%)',
    color: '#FFFFFF',
    boxShadow: '0 4px 14px rgba(107, 33, 168, 0.3)',
    whiteSpace: 'nowrap',
    '&:hover': {
      background: 'linear-gradient(135deg, #581C87 0%, #3B0764 100%)',
    },
  },
  heroBanner: {
    borderRadius: 12,
    padding: theme.spacing(2.5),
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(1.5),
    background: 'linear-gradient(135deg, #4C1480 0%, #6B21A8 100%)',
  },
  heroBannerInTab: {
    borderRadius: 0,
    marginBottom: 0,
  },
  heroTitle: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2 },
  heroSub: { fontSize: '0.875rem', opacity: 0.85 },
  heroOwner: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    fontSize: '0.75rem',
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.3)',
    width: 'fit-content',
    marginTop: theme.spacing(0.5),
  },
  workflowShell: {
    border: '1px solid #E5E7EB',
    borderTop: 'none',
    borderRadius: 12,
    background: '#FFFFFF',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  workflowShellInTab: {
    border: 'none',
    borderTop: 'none',
    borderRadius: 0,
  },
  workflowShellScrollable: {
    flex: 1,
    minHeight: 0,
    overflow: 'visible',
  },

  configureLayout: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  configureColumns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    columnGap: 10,
    alignItems: 'start',
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
      rowGap: 12,
    },
  },
  configureMain: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 4,
    paddingBottom: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
    [theme.breakpoints.down('sm')]: {
      paddingLeft: 0,
      paddingRight: 0,
    },
  },
  configureSummarySidebar: {
    position: 'sticky',
    top: theme.spacing(3),
    alignSelf: 'start',
    maxHeight: 'calc(100vh - 96px)',
    overflow: 'auto',
  },

  // Top stepper
  stepper: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: theme.spacing(2.5),
    position: 'relative',
    background: '#FFFFFF',
    padding: theme.spacing(0.5, 0, 0.75),
  },
  stepperConfigureOffset: {
    marginLeft: 0,
  },
  stepNode: { display: 'flex', alignItems: 'center' },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.78rem',
    fontWeight: 800,
    flexShrink: 0,
  },
  stepName: {
    fontSize: '0.8rem',
    fontWeight: 700,
    marginLeft: theme.spacing(1),
  },
  stepConn: {
    width: 36,
    height: 3,
    borderRadius: 999,
    margin: theme.spacing(0, 1.25),
  },

  // Generic panel
  panel: {
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    background: '#FFFFFF',
    padding: theme.spacing(2),
  },
  panelTitle: {
    fontWeight: 800,
    fontSize: '1.0625rem',
    color: '#111827',
    marginBottom: theme.spacing(0.5),
  },
  panelSub: {
    fontSize: '0.8125rem',
    color: '#6B7280',
    marginBottom: theme.spacing(2),
  },
  sectionLabel: {
    fontSize: '0.72rem',
    fontWeight: 800,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    margin: theme.spacing(1.5, 0, 0.25),
  },
  compactField: {
    '& .MuiInputBase-input': {
      fontSize: '0.8125rem',
      paddingTop: 7,
      paddingBottom: 7,
    },
    '& .MuiInputLabel-root': { fontSize: '0.8125rem' },
    '& .MuiFormHelperText-root': {
      marginTop: 1,
      fontSize: '0.68rem',
      lineHeight: 1.15,
      minHeight: 12,
    },
  },
  lockedNodeBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#F3F4F6',
    border: '1px solid #E5E7EB',
    borderRadius: 6,
    padding: theme.spacing(0.75, 1),
    marginTop: 4,
  },

  // Profile cards
  profileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0.5, 0.25, 1.5),
    marginBottom: theme.spacing(1),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  profileCard: {
    border: '2px solid #E5E7EB',
    borderRadius: 12,
    padding: theme.spacing(2),
    cursor: 'pointer',
    background: '#FFFFFF',
    transition: 'all .15s',
    position: 'relative',
    boxSizing: 'border-box',
    minHeight: 166,
    display: 'flex',
    flexDirection: 'column',
    '&:hover': {
      borderColor: '#A78BFA',
      boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
    },
  },
  profileCardActive: {
    borderColor: '#6B21A8',
    background: '#FAF5FF',
    boxShadow: '0 6px 16px rgba(107,33,168,0.18)',
  },
  profileLabel: { fontWeight: 800, fontSize: '1rem', color: '#111827' },
  profileTag: {
    fontSize: '0.78rem',
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 1.35,
  },
  profileBadge: {
    display: 'inline-block',
    marginTop: 12,
    alignSelf: 'flex-start',
    fontSize: '0.66rem',
    fontWeight: 800,
    padding: '3px 9px',
    borderRadius: 999,
    background: '#EDE9FE',
    color: '#5B21B6',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  profileDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    position: 'absolute',
    top: 16,
    right: 16,
  },
  flavorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },

  // Review
  reviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: theme.spacing(1.75),
    marginTop: theme.spacing(1),
  },
  reviewItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  reviewKey: {
    fontSize: '0.66rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: '#6B7280',
  },
  reviewVal: { fontSize: '0.9375rem', fontWeight: 700, color: '#111827' },
  statRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: theme.spacing(1.25),
    margin: theme.spacing(2, 0),
  },
  statCard: {
    borderRadius: 10,
    padding: theme.spacing(1.5),
    textAlign: 'center',
    border: '1px solid #E5E7EB',
  },
  statNum: { fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 },
  statLabel: {
    fontSize: '0.66rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    color: '#6B7280',
    marginTop: 2,
  },

  // Approval
  approvalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1.5, 1.75),
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    marginBottom: theme.spacing(1.25),
  },
  approvalName: { fontWeight: 700, fontSize: '0.9375rem', color: '#111827' },

  // Terminal
  terminalCard: {
    border: '1px solid #1F2937',
    borderRadius: 10,
    overflow: 'hidden',
    background: '#0B1220',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 280,
    marginTop: theme.spacing(2),
  },
  terminalHead: {
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0, 1.5),
    background: '#111827',
    color: '#9CA3AF',
    fontSize: '0.72rem',
    fontWeight: 700,
    borderBottom: '1px solid #1F2937',
  },
  terminalBody: {
    flex: 1,
    overflowY: 'auto',
    padding: theme.spacing(1.25),
    maxHeight: 340,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    scrollbarWidth: 'thin',
    scrollbarColor: '#4B5563 transparent',
    '&::-webkit-scrollbar': {
      width: 6,
    },
    '&::-webkit-scrollbar-thumb': {
      background: '#4B5563',
      borderRadius: 999,
    },
    '&::-webkit-scrollbar-track': {
      background: 'transparent',
    },
  },
  terminalLine: {
    color: '#E5E7EB',
    fontSize: '0.74rem',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },

  // Progress stages
  stagesCard: {
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    background: '#FFFFFF',
    padding: theme.spacing(1.5, 2),
    marginTop: theme.spacing(2),
  },
  stagesHead: {
    fontSize: '0.8rem',
    fontWeight: 800,
    color: '#111827',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  stagesMeta: {
    fontSize: '0.75rem',
    color: '#6B7280',
    fontWeight: 700,
    marginBottom: theme.spacing(1.25),
  },
  stagesBody: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflowX: 'auto',
    paddingBottom: theme.spacing(0.5),
    width: '100%',
    position: 'relative',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 14,
      right: 14,
      top: 12,
      height: 3,
      borderRadius: 999,
      background: '#E5E7EB',
      zIndex: 0,
    },
  },
  stageStep: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: '1 1 0',
    minWidth: 64,
    padding: theme.spacing(0.5, 0.25),
    borderRadius: 6,
    position: 'relative',
    zIndex: 1,
  },
  stageStepRunning: { background: '#EFF6FF' },
  stageStepDone: { background: '#F0FDF4' },
  stageIconRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minWidth: 0,
    gap: 4,
    marginBottom: theme.spacing(0.75),
  },
  stageConnector: {
    flex: '1 1 auto',
    minWidth: 10,
    height: 3,
    borderRadius: 999,
    background: '#E5E7EB',
  },
  stageConnectorGhost: { visibility: 'hidden' },
  stageConnectorDone: { background: '#2563EB' },
  stageLabel: {
    fontSize: '0.68rem',
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1.2,
    textAlign: 'center',
    width: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    [theme.breakpoints.down('xs')]: {
      whiteSpace: 'normal',
      textOverflow: 'clip',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
    },
  },

  // Nav buttons
  wizardActions: {
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2.5),
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  configureActionBar: {
    marginTop: theme.spacing(2),
    padding: theme.spacing(0.65, 0.85),
    borderTop: '1px solid #E5E7EB',
    borderRadius: 8,
    background: '#FFFFFF',
    width: '100%',
    position: 'static',
    zIndex: 1,
    boxShadow: 'none',
  },
  configureActionHint: {
    fontSize: '0.74rem',
    color: '#6B7280',
    fontWeight: 600,
    marginBottom: theme.spacing(0.75),
  },
  configureActionButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    alignItems: 'center',
    width: '100%',
    [theme.breakpoints.down('sm')]: {
      justifyContent: 'stretch',
      '& button': {
        width: '100%',
        justifyContent: 'center',
      },
    },
  },
  configureActionPrimaryGroup: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  configureActionFinalGroup: {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  adminColumns: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    alignItems: 'center',
    [theme.breakpoints.down('sm')]: {
      alignItems: 'stretch',
    },
  },
  adminSectionBox: {
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    padding: theme.spacing(1.75),
    background: '#FFFFFF',
    marginTop: theme.spacing(1.5),
  },
  adminActionsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: theme.spacing(0.75),
    [theme.breakpoints.down('sm')]: {
      justifyContent: 'stretch',
      '& button': {
        width: '100%',
      },
    },
  },
  adminPanel: {
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    padding: theme.spacing(0.65, 0.85),
    background: '#FAFAFA',
  },
  adminPanelTitle: {
    fontSize: '0.7rem',
    fontWeight: 800,
    color: '#5B21B6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing(0.45),
  },
  customerBox: {
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    padding: theme.spacing(0.75, 0.85),
    background: '#FFFFFF',
  },
  configureContextGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
    alignItems: 'stretch',
    marginTop: theme.spacing(0.5),
  },
  configureContextCol: {
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    background: '#FFFFFF',
    padding: theme.spacing(2),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  configureSectionBanner: {
    background: 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%)',
    color: '#FFFFFF',
    padding: theme.spacing(1, 1.5),
    borderRadius: 10,
    marginBottom: theme.spacing(1.25),
    boxShadow: '0 8px 18px rgba(37, 99, 235, 0.18)',
  },
  configureSectionBannerTitle: {
    fontSize: '0.8rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    lineHeight: 1.2,
  },
  configureContextColTitle: {
    fontSize: '0.8rem',
    fontWeight: 800,
    color: '#4B5563',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing(0.75),
  },
  configureContextSectionTitle: {
    fontSize: '0.7rem',
    fontWeight: 800,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
    marginTop: theme.spacing(1.25),
    marginBottom: theme.spacing(0.5),
  },
  configureFieldStack: {
    display: 'grid',
    gap: theme.spacing(0.75),
  },
  customerThreeCols: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    columnGap: theme.spacing(2),
    alignItems: 'start',
    rowGap: theme.spacing(0.75),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: '1fr',
      rowGap: theme.spacing(0.75),
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  customerCol: {
    paddingLeft: theme.spacing(0.25),
    paddingRight: theme.spacing(0.25),
    [theme.breakpoints.down('md')]: {
      paddingLeft: 0,
      paddingRight: 0,
      paddingBottom: theme.spacing(0.25),
      marginBottom: theme.spacing(0.25),
    },
  },
  contextColTitle: {
    fontSize: '0.7rem',
    fontWeight: 800,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    marginBottom: theme.spacing(0.3),
    padding: theme.spacing(0.45, 0.6),
    border: '1px solid #D1D5DB',
    borderRadius: 6,
    background: '#F9FAFB',
  },
  contextFieldStack: {
    display: 'grid',
    gap: theme.spacing(0.25),
    borderTop: '1px solid #D1D5DB',
    paddingTop: theme.spacing(0.4),
    '& > div': {
      width: '88%',
      marginLeft: 'auto',
      marginRight: 'auto',
    },
    [theme.breakpoints.down('md')]: {
      '& > div': {
        width: '100%',
      },
    },
  },
  rgModeRow: {
    display: 'flex',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(0.25),
    marginBottom: theme.spacing(0.25),
    flexWrap: 'wrap',
  },
  adminInlineInput: {
    flex: '1 1 260px',
  },
  adminChipWrap: {
    marginTop: theme.spacing(0.5),
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 24,
  },
  compactThreeCol: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: theme.spacing(0.75),
    alignItems: 'start',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  span2: {
    gridColumn: 'span 2',
    [theme.breakpoints.down('md')]: {
      gridColumn: 'span 2',
    },
    [theme.breakpoints.down('sm')]: {
      gridColumn: 'span 1',
    },
  },
  span3: {
    gridColumn: '1 / -1',
  },
  advancedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: theme.spacing(1),
    alignItems: 'start',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  advancedAccordion: {
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    background: '#FFFFFF',
    '&:before': { display: 'none' },
  },
  advancedAccordionSummary: {
    borderRadius: 12,
    minHeight: 56,
    '& .MuiAccordionSummary-content': {
      margin: 0,
      alignItems: 'center',
    },
  },
  advancedAccordionDetails: {
    display: 'block',
    padding: theme.spacing(0, 2, 2),
  },
  infraBox: {
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    padding: theme.spacing(1.5),
    background: '#FFFFFF',
  },
  infraGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: theme.spacing(0.5),
    alignItems: 'stretch',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  infraCol: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 1,
  },
  infraColTitle: {
    fontSize: '0.72rem',
    fontWeight: 800,
    color: '#4B5563',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing(0.25),
  },
  infraReadOnly: {
    minHeight: 36,
    border: '1px solid #D1D5DB',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0.55, 0.85),
    background: '#F9FAFB',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#111827',
  },
  summaryPanel: {
    border: '1px solid #E5E7EB',
    borderRadius: 14,
    background: '#F8FAFC',
    padding: theme.spacing(1.75),
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
  },
  summaryTitle: {
    fontSize: '0.85rem',
    fontWeight: 800,
    color: '#111827',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing(1.25),
  },
  summaryStack: {
    display: 'grid',
    gap: theme.spacing(1.1),
  },
  summaryItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  summaryLabel: {
    fontSize: '0.7rem',
    fontWeight: 800,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  summaryValue: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1.35,
  },
  summaryValueAccent: {
    fontSize: '1rem',
    fontWeight: 800,
    color: '#1D4ED8',
  },
  summaryHint: {
    marginTop: theme.spacing(1.25),
    fontSize: '0.75rem',
    color: '#6B7280',
  },
  nodeGroup: {
    marginTop: theme.spacing(0.25),
    '& .MuiFormGroup-root': {
      rowGap: 2,
    },
  },
  nodeOption: {
    marginRight: theme.spacing(1.5),
    marginBottom: theme.spacing(0.25),
    alignItems: 'flex-start',
    paddingTop: 2,
  },
  primaryBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    background: '#6B21A8',
    color: '#FFFFFF',
    '&:hover': { background: '#581C87' },
    '&:disabled': { background: '#D1D5DB', color: '#6B7280' },
  },
  submitBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    background: '#059669',
    color: '#FFFFFF',
    '&:hover': { background: '#047857' },
    '&:disabled': { background: '#D1D5DB', color: '#6B7280' },
  },
  secondaryBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    color: '#374151',
    borderColor: '#D1D5DB',
    '&:hover': {
      backgroundColor: '#E5E7EB',
      borderColor: '#9CA3AF',
      color: '#111827',
    },
  },
  spacer: { flex: 1 },

  // Ready card
  readyCard: {
    borderRadius: 12,
    padding: theme.spacing(3),
    marginTop: theme.spacing(2),
    background: 'linear-gradient(135deg, #065F46 0%, #059669 100%)',
    color: '#FFFFFF',
  },
  readyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: theme.spacing(1.75),
    marginTop: theme.spacing(2),
  },
  readyKey: {
    fontSize: '0.66rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    opacity: 0.8,
  },
  readyVal: { fontSize: '0.9375rem', fontWeight: 700, wordBreak: 'break-all' },
  yamlBlock: {
    margin: theme.spacing(1, 0, 0),
    padding: theme.spacing(1.5),
    background: '#0B1220',
    color: '#E5E7EB',
    borderRadius: 8,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.74rem',
    lineHeight: 1.5,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
}));

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_FORM: AksFormData = createInitialAksWizardForm('small');

// ─── Helper Functions (extracted from nested ternaries) ────────────────────────

/**
 * Map step status to step object
 */
function getStepStatus(
  runState: string,
  currentIdx: number,
  stepIdx: number,
): 'done' | 'running' | 'pending' {
  if (runState === 'completed' || stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx && runState === 'running') return 'running';
  return 'pending';
}

/**
 * Get tailscale status message
 */
function getTailscaleStatusMessage(
  accessError: string | null | undefined,
  clusterReady: boolean,
  accessStatus: string | null | undefined,
): string {
  if (accessError) return `⚠️ ${accessError}`;
  if (clusterReady) {
    return '✅ Tailscale access granted and bootstrap complete — jumpbox SSH is available to cluster administrators.';
  }
  if (accessStatus === 'Waiting Approval') {
    return '⏳ Tailscale PR opened — waiting for approval and merge before bootstrap begins.';
  }
  if (accessStatus === 'Merged') {
    return '✅ Tailscale policy PR merged — the tailnet repository applies the ACL. Cluster bootstrap is not yet tracked by CloudHub.';
  }
  return 'Waiting for the Tailscale policy PR to be opened…';
}

/**
 * Get registry update status message
 */
function getRegistryStatusMessage(
  registryStatus: string | null | undefined,
): string {
  if (registryStatus === 'done') {
    return '✅ Platform Registry updated — cluster registered.';
  }
  if (registryStatus === 'failed') {
    return '⚠️ Registry update failed — cluster will appear on next discovery cycle.';
  }
  return '⏳ Updating Platform Registry…';
}

/**
 * Get bootstrap status message
 */
function getBootstrapStatusMessage(
  bootstrapStatus: string | null | undefined,
): string {
  if (bootstrapStatus === 'done') {
    return '✅ Platform bootstrap complete — ArgoCD, External Secrets, Ingress, Monitoring initialized.';
  }
  return '⏳ Running platform bootstrap…';
}

/**
 * Get StepIcon background color
 */
function getStepIconBg(status: 'done' | 'running' | 'pending'): string {
  if (status === 'done') return '#2563EB';
  if (status === 'running') return '#DBEAFE';
  return '#FFFFFF';
}

/**
 * Get StepIcon text color
 */
function getStepIconTextColor(status: 'done' | 'running' | 'pending'): string {
  if (status === 'pending') return '#9CA3AF';
  if (status === 'running') return '#1D4ED8';
  return '#FFFFFF';
}

/**
 * Get StepIcon border color
 */
function getStepIconBorderColor(
  status: 'done' | 'running' | 'pending',
): string {
  if (status === 'pending') return '#9CA3AF';
  return '#2563EB';
}

/**
 * Get phase stepper dot background color
 */
function getPhaseStepperDotBg(done: boolean, active: boolean): string {
  if (done) return '#6B21A8';
  if (active) return '#EDE9FE';
  return '#FFFFFF';
}

/**
 * Get phase stepper dot text color
 */
function getPhaseStepperDotColor(done: boolean, active: boolean): string {
  if (done) return '#FFFFFF';
  if (active) return '#6B21A8';
  return '#9CA3AF';
}

/**
 * Get phase stepper dot border color
 */
function getPhaseStepperDotBorder(done: boolean, active: boolean): string {
  if (done || active) return '#6B21A8';
  return '#D1D5DB';
}

/**
 * Get phase step name color
 */
function getPhaseStepNameColor(done: boolean, active: boolean): string {
  if (active) return '#111827';
  if (done) return '#6B21A8';
  return '#9CA3AF';
}

/**
 * Get phase stepper connector background color
 */
function getPhaseStepperConnBg(done: boolean): string {
  if (done) return '#6B21A8';
  return '#E5E7EB';
}

/**
 * Get approval dot background color based on approval status
 */
function getApprovalDotBg(approved: boolean, isRejected: boolean): string {
  if (approved) return '#059669';
  if (isRejected) return '#DC2626';
  return '#FFFFFF';
}

/**
 * Get approval dot text color
 */
function getApprovalDotColor(approved: boolean, isRejected: boolean): string {
  if (approved || isRejected) return '#FFFFFF';
  return '#9CA3AF';
}

/**
 * Get approval dot border color
 */
function getApprovalDotBorder(approved: boolean, isRejected: boolean): string {
  if (approved) return '#059669';
  if (isRejected) return '#DC2626';
  return '#D1D5DB';
}

/**
 * Get approval dot icon/label
 */
function getApprovalDotLabel(
  approved: boolean,
  isRejected: boolean,
  index: number,
): string | number {
  if (approved) return '✓';
  if (isRejected) return '✕';
  return index + 1;
}

/**
 * Determine provision step status
 */
function getProvisionStepStatus(
  runState: string,
  i: number,
  currentIdx: number,
): string {
  if (runState === 'completed' || i < currentIdx) return 'done';
  if (i === currentIdx && runState === 'running') return 'running';
  return 'pending';
}

/**
 * Get access status chip colors
 */
function getAccessStatusColors(accessStatus: string | null | undefined): {
  background: string;
  color: string;
} {
  if (accessStatus === 'Applied')
    return { background: '#DCFCE7', color: '#166534' };
  if (accessStatus === 'Failed')
    return { background: '#FEE2E2', color: '#991B1B' };
  return { background: '#E0E7FF', color: '#3730A3' };
}

/**
 * Get cancel deployment button label
 */
function getCancelDeploymentLabel(
  runState: string,
  cancelDeployBusy: boolean,
): string {
  if (runState === 'cancelled') return 'Deployment Cancelled';
  if (cancelDeployBusy) return 'Cancelling...';
  return 'Cancel Deployment';
}

/**
 * Get registry status box colors
 */
function getRegistryStatusBoxColors(
  registryStatus: string | null | undefined,
): { background: string; border: string; color: string } {
  if (registryStatus === 'done')
    return { background: '#F0FDF4', border: '#86EFAC', color: '#166534' };
  if (registryStatus === 'failed')
    return { background: '#FEF2F2', border: '#FECACA', color: '#991B1B' };
  return { background: '#F9FAFB', border: '#E5E7EB', color: '#6B7280' };
}

/**
 * Get bootstrap status box colors
 */
function getBootstrapStatusBoxColors(
  bootstrapStatus: string | null | undefined,
): { background: string; border: string; color: string } {
  if (bootstrapStatus === 'done')
    return { background: '#F0FDF4', border: '#86EFAC', color: '#166534' };
  return { background: '#F9FAFB', border: '#E5E7EB', color: '#6B7280' };
}

/**
 * Get provision status description message
 */
function getProvisionStatusMessage(
  runState: string,
  overallPct: number,
): string {
  if (runState === 'completed')
    return 'GitHub Actions applied the Terraform plan, validated the cluster, and bootstrapped GitOps.';
  if (runState === 'failed')
    return 'Provisioning failed before completion. Check the error details and GitHub Actions permissions.';
  if (runState === 'cancelled')
    return 'Provisioning was cancelled. You can adjust config and deploy again.';
  if (runState === 'draft')
    return 'Infrastructure PR merged. CloudHub observes the Terraform Cloud execution read-only below; core-services deployment and validation are not yet tracked.';
  return `GitHub Actions pipeline running terraform apply — ${overallPct}% complete.`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface AksWorkflowPageProps {
  isTab?: boolean;
}

export function AksWorkflowPage({ isTab = false }: AksWorkflowPageProps) {
  const classes = useStyles();
  const theme = useTheme();
  const isDesktopSummary = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();

  const [phase, setPhase] = useState<WizardPhase>('configure');
  const [form, setForm] = useState<AksFormData>(INITIAL_FORM);
  const [profileDialog, setProfileDialog] = useState<string | null>(null);
  const [flavorDialog, setFlavorDialog] = useState<NodeSizeFlavor | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [planLogs, setPlanLogs] = useState<string[]>([]);
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);

  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitLogs, setSubmitLogs] = useState<string[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prNumber, setPrNumber] = useState<number | null>(null);
  const [workflowRunUrl, setWorkflowRunUrl] = useState<string | null>(null);
  const [prMerged, setPrMerged] = useState<boolean>(false);
  const [registryStatus, setRegistryStatus] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<string | null>(null);
  const [generatedYaml, setGeneratedYaml] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState<boolean>(false);
  const [planErrors, setPlanErrors] = useState<string[]>([]);
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);
  /** idle → validating (POST /plan in flight) → completed | failed */
  const [planStatus, setPlanStatus] = useState<
    'idle' | 'validating' | 'completed' | 'failed'
  >('idle');
  const [submitBusy, setSubmitBusy] = useState<boolean>(false);
  const submitInFlightRef = useRef<boolean>(false);
  /** Names persisted by the backend on submit (authoritative after submit). */
  const [submittedNames, setSubmittedNames] = useState<{
    clusterName?: string;
    jumpboxName?: string;
  } | null>(null);

  const [approvalChain, setApprovalChain] = useState<ApprovalStage[]>([]);
  const [approvalBusy, setApprovalBusy] = useState<boolean>(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [gitBranchBusy, setGitBranchBusy] = useState<boolean>(false);

  // Pull Request phase state
  const [branchName, setBranchName] = useState<string | null>(null);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [prCreateBusy, setPrCreateBusy] = useState<boolean>(false);
  const [prCreateError, setPrCreateError] = useState<string | null>(null);

  const [runState, setRunState] = useState<RunState>('draft');
  const [cancelDeployBusy, setCancelDeployBusy] = useState<boolean>(false);
  const [deployPreflightBusy, setDeployPreflightBusy] =
    useState<boolean>(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [stepPct, setStepPct] = useState(0);
  const [apiEndpoint, setApiEndpoint] = useState('');

  const termRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cluster administrators — GitHub usernames granted Tailscale jumpbox access.
  const [clusterAdmins, setClusterAdmins] = useState<string[]>([]);
  const [adminInput, setAdminInput] = useState('');

  // Tailscale jumpbox access orchestration (provision phase).
  const [accessStatus, setAccessStatus] = useState<string | null>(null);
  const [tailscalePrUrl, setTailscalePrUrl] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [clusterReady, setClusterReady] = useState<boolean>(false);
  const accessKickedRef = useRef<boolean>(false);
  // Explicit "create infrastructure PR" action (never triggered by polling).
  const [infraPrAvailable, setInfraPrAvailable] = useState<boolean>(false);
  const [tailscaleMerged, setTailscaleMerged] = useState<boolean>(false);
  const [infraPrBusy, setInfraPrBusy] = useState<boolean>(false);
  const [infraPrFailure, setInfraPrFailure] = useState<string | null>(null);

  // Mandatory submission preflight gates (from /plan, or a 412 on submit).
  const [gateReport, setGateReport] = useState<SubmissionGateReport | null>(
    null,
  );
  // Gates returned by a 412 on the final approval stage.
  const [approvalGates, setApprovalGates] =
    useState<SubmissionGateReport | null>(null);

  // Read-only infrastructure execution tracking (pull_request / provision).
  const [execView, setExecView] = useState<ExecutionView | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [execNotConfigured, setExecNotConfigured] = useState<boolean>(false);
  const [execBusy, setExecBusy] = useState<boolean>(false);

  // Live SSE events timeline
  const openBackendStream = useBackendEventStream();
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Four-tier readiness status & operational actions
  const [readiness, setReadiness] = useState<AksReadinessStatus | null>(null);
  const [verifyingBusy, setVerifyingBusy] = useState<boolean>(false);
  const [addonDeploying, setAddonDeploying] = useState<string | null>(null);
  const [cancellingBusy, setCancellingBusy] = useState<boolean>(false);
  const [saveDraftBusy, setSaveDraftBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Request resumption via ?request=<requestId>.
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeRequestId = searchParams.get('request');
  const resumedIdRef = useRef<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeCopied, setResumeCopied] = useState(false);

  const meta = PROFILE_META[form.clusterProfile];

  // Canonical request + derived values (same shared model as the backend).
  const aksRequest = useMemo(() => toAksClusterRequest(form), [form]);
  const liveErrors = useMemo(
    () => validateAksClusterRequest(aksRequest),
    [aksRequest],
  );
  const localNames = useMemo(() => deriveAksNames(aksRequest), [aksRequest]);
  const names: AksDerivedNames = planPreview?.names ?? localNames;
  const nameReady = Boolean(
    aksRequest.tenantId &&
      !liveErrors.tenantId &&
      !liveErrors.location &&
      !liveErrors.env &&
      !liveErrors.tenancy,
  );
  const clusterName = submittedNames?.clusterName ?? names.clusterName;
  const subnets: AksDerivedSubnets | null = liveErrors.addressSpace
    ? null
    : planPreview?.subnets ?? deriveAksSubnets(aksRequest.addressSpace);
  const localValuesFile = useMemo(
    () =>
      renderAksValuesFile(aksRequest, {
        created: new Date().toISOString().slice(0, 10),
      }),
    [aksRequest],
  );
  const nodeSizeText = aksRequest.userPool
    ? `${aksRequest.systemPool.vmSize} / ${aksRequest.userPool.vmSize}`
    : aksRequest.systemPool.vmSize;

  const [modalOpen, setModalOpen] = useState(false);
  const [configTab, setConfigTab] = useState(0);
  const [copiedClusterName, setCopiedClusterName] = useState(false);

  const handleOpenModal = () => {
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
  };

  const copyClusterName = () => {
    const name = nameReady ? clusterName : '';
    if (name && navigator.clipboard) {
      navigator.clipboard.writeText(name);
      setCopiedClusterName(true);
      setTimeout(() => setCopiedClusterName(false), 2000);
    }
  };

  const isTab0Valid = TAB0_FIELDS.every(
    k => !liveErrors[k as keyof typeof liveErrors],
  );
  const isTab1Valid = TAB1_FIELDS.every(
    k => !liveErrors[k as keyof typeof liveErrors],
  );
  const isTab2Valid = clusterAdmins.length > 0;

  /** Switch to the first configure tab that shows one of `fieldErrors`. */
  const focusErrorTab = (fieldErrors: Record<string, string>) => {
    const keys = Object.keys(fieldErrors);
    if (keys.some(k => TAB0_FIELDS.includes(k))) setConfigTab(0);
    else if (keys.some(k => TAB1_FIELDS.includes(k))) setConfigTab(1);
    else if (keys.includes('clusterAdministrators')) setConfigTab(2);
  };

  const phases = useMemo<WizardPhase[]>(
    () => ['configure', 'review', 'approval', 'pull_request', 'provision'],
    [],
  );
  const phaseIndex = phases.indexOf(phase);

  const provisionSteps = useMemo(
    () => buildProvisionSteps(aksRequest, names),
    [aksRequest, names],
  );

  const provisionLog = useMemo(
    () =>
      buildProvisionLog(
        provisionSteps,
        currentIdx,
        stepPct,
        runState,
        clusterName,
      ),
    [provisionSteps, currentIdx, stepPct, runState, clusterName],
  );

  const overallPct =
    runState === 'completed'
      ? 100
      : Math.round(
          ((currentIdx + (runState === 'running' ? stepPct / 100 : 0)) /
            provisionSteps.length) *
            100,
        );

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (seqRef.current) clearTimeout(seqRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
    seqRef.current = null;
  }, []);

  // Declared here (before useEffects) to avoid TDZ in dependency arrays
  const handleDeploy = useCallback(() => {
    clearTimers();
    setCurrentIdx(0);
    setStepPct(0);
    setRunState('draft');
    setPhase('provision');
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Auto-scroll the active terminal
  useEffect(() => {
    if (termRef.current)
      termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [planLogs, submitLogs, provisionLog]);

  // ── Poll real backend task when in provision phase ──────────────────────
  useEffect(() => {
    if (phase !== 'provision' || !taskId) return undefined;
    const poll = () => {
      backendFetch('provisioning', `/task/${taskId}`)
        .then(async r => {
          const data = (await r.json()) as {
            status?: string;
            workflowRunUrl?: string;
            progress?: { current: number; total: number };
            registryStatus?: string;
            bootstrapStatus?: string;
            error?: string;
          };
          if (data.workflowRunUrl) setWorkflowRunUrl(data.workflowRunUrl);
          if (data.registryStatus) setRegistryStatus(data.registryStatus);
          if (data.bootstrapStatus) setBootstrapStatus(data.bootstrapStatus);
          if (
            data.progress &&
            Number.isFinite(data.progress.current) &&
            Number.isFinite(data.progress.total)
          ) {
            const nextIdx = Math.max(
              0,
              Math.min(data.progress.total - 1, data.progress.current),
            );
            setCurrentIdx(nextIdx);
          }
          if (data.status === 'completed') {
            setRunState('completed');
          } else if (data.status === 'running') {
            setRunState('running');
          } else if (data.status === 'cancelled') {
            setRunState('cancelled');
          } else if (
            data.status === 'submitted' ||
            data.status === 'awaiting_pr_merge'
          ) {
            setRunState('draft');
          } else if (data.status === 'failed') {
            setRunState('failed');
            const message = data.error
              ? `Provision workflow failed: ${data.error}`
              : 'Provision workflow failed.';
            setPlanErrors(prev =>
              prev.includes(message) ? prev : [...prev, message],
            );
          }
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, taskId]);

  // ── Read-only execution tracking (pull_request / provision) ──────────────
  /**
   * POST /execution/refresh observes GitHub / Terraform Cloud read-only and
   * returns the stored view. Returns whether polling should continue.
   */
  const fetchExecution = useCallback(
    async (id: string, isCancelled: () => boolean): Promise<boolean> => {
      setExecBusy(true);
      try {
        const r = await backendFetch(
          'provisioning',
          `/request/${id}/execution/refresh`,
          { method: 'POST' },
        );
        const data = await readJsonResponse<
          Partial<ExecutionView> & { error?: string }
        >(r);
        if (isCancelled()) return false;
        if (r.status === 503) {
          // Tracking not configured: keep showing whatever is stored.
          setExecNotConfigured(true);
          setExecError(null);
          if (data.requestId) setExecView(data as ExecutionView);
          return false;
        }
        if (!r.ok) {
          setExecError(
            data.error ?? `Execution status request failed (HTTP ${r.status})`,
          );
          return r.status !== 403 && r.status !== 404;
        }
        const next = data as ExecutionView;
        setExecNotConfigured(false);
        setExecError(null);
        setExecView(next);
        if (next.prUrl) setPrUrl(next.prUrl);
        if (next.prNumber) setPrNumber(next.prNumber);
        if (next.execution?.pullRequest?.merged) setPrMerged(true);
        return shouldPollExecution(next);
      } catch (err) {
        if (isCancelled()) return false;
        setExecError(
          `Execution status request failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return shouldPollExecution(null);
      } finally {
        if (!isCancelled()) setExecBusy(false);
      }
    },
    [backendFetch],
  );

  useEffect(() => {
    if ((phase !== 'pull_request' && phase !== 'provision') || !requestId)
      return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const isCancelled = () => cancelled;
    const tick = async () => {
      const keepPolling = await fetchExecution(requestId, isCancelled);
      if (!cancelled && keepPolling)
        timer = setTimeout(tick, EXECUTION_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, requestId, prNumber, fetchExecution]);

  // ── Execution events live streaming and polling ───────────────────────────
  const fetchEvents = useCallback(
    async (id: string) => {
      try {
        const r = await backendFetch('provisioning', `/request/${id}/events`);
        if (r.ok) {
          const data = (await r.json()) as { events?: ExecutionEvent[] };
          if (Array.isArray(data.events)) {
            setEvents(data.events);
          }
        }
      } catch {
        // Ignore background polling errors
      }
    },
    [backendFetch],
  );

  useEffect(() => {
    if (!requestId) return undefined;
    let cancelled = false;
    const abortController = new AbortController();

    fetchEvents(requestId);

    openBackendStream({
      pluginId: 'provisioning',
      path: `/request/${requestId}/events/stream`,
      signal: abortController.signal,
      onOpen: () => {
        if (!cancelled) {
          setStreamConnected(true);
          setStreamError(null);
        }
      },
      onEvent: sseEvent => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(sseEvent.data) as ExecutionEvent;
          setEvents(prev => {
            const exists = prev.some(
              e =>
                e.eventId === parsed.eventId ||
                (parsed.id !== undefined && e.id === parsed.id),
            );
            if (exists) return prev;
            return [...prev, parsed];
          });
        } catch {
          // Ignore heartbeat or non-JSON comments
        }
      },
    }).catch(err => {
      if (!cancelled && (err as Error)?.name !== 'AbortError') {
        setStreamConnected(false);
        setStreamError('Live stream disconnected; falling back to polling');
      }
    });

    const interval = setInterval(() => {
      if (!cancelled) {
        fetchEvents(requestId);
      }
    }, 15000);

    return () => {
      cancelled = true;
      abortController.abort();
      clearInterval(interval);
    };
  }, [requestId, fetchEvents, openBackendStream]);

  // ── Workflow Action Handlers ──────────────────────────────────────────────
  const saveDraft = async () => {
    if (saveDraftBusy) return;
    setSaveDraftBusy(true);
    try {
      const res = await backendFetch('provisioning', '/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...aksRequest,
          clusterAdministrators: clusterAdmins,
          draft: true,
        }),
      });
      const data = await readJsonResponse<{
        requestId?: string;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || 'Failed to save draft');
      if (data.requestId) {
        setRequestId(data.requestId);
        setSearchParams({ request: data.requestId });
      }
    } catch (err) {
      setActionError(`Save draft failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaveDraftBusy(false);
    }
  };

  const cancelWorkflow = async () => {
    if (!requestId || cancellingBusy) return;
    setCancellingBusy(true);
    setActionError(null);
    try {
      const res = await backendFetch(
        'provisioning',
        `/request/${requestId}/cancel`,
        { method: 'POST' },
      );
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Cancel failed');
      setRunState('cancelled');
      fetchExecution(requestId, () => false);
      fetchEvents(requestId);
    } catch (err) {
      setActionError(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCancellingBusy(false);
    }
  };

  const deployAddon = async (addon: 'common-res' | 'datadog' | 'velero') => {
    if (!requestId || addonDeploying) return;
    setAddonDeploying(addon);
    setActionError(null);
    try {
      const res = await backendFetch(
        'provisioning',
        `/request/${requestId}/addons/deploy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addon }),
        },
      );
      const data = await readJsonResponse<{
        error?: string;
        readinessStatus?: AksReadinessStatus;
      }>(res);
      if (!res.ok) throw new Error(data.error || `Deploying ${addon} failed`);
      if (data.readinessStatus) {
        setReadiness(data.readinessStatus);
      }
      fetchEvents(requestId);
    } catch (err) {
      setActionError(`Failed to deploy ${addon}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddonDeploying(null);
    }
  };

  const verifyOperational = async () => {
    if (!requestId || verifyingBusy) return;
    setVerifyingBusy(true);
    setActionError(null);
    try {
      const res = await backendFetch(
        'provisioning',
        `/request/${requestId}/verify`,
        { method: 'POST' },
      );
      const data = await readJsonResponse<{
        error?: string;
        readiness?: AksReadinessStatus;
      }>(res);
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      if (data.readiness) {
        setReadiness(data.readiness);
      }
      fetchEvents(requestId);
    } catch (err) {
      setActionError(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVerifyingBusy(false);
    }
  };

  // ── Resume a stored request from ?request=<requestId> ─────────────────────
  useEffect(() => {
    if (!resumeRequestId || resumedIdRef.current === resumeRequestId)
      return undefined;
    resumedIdRef.current = resumeRequestId;
    let cancelled = false;
    setResumeError(null);
    backendFetch(
      'provisioning',
      `/request/${encodeURIComponent(resumeRequestId)}`,
    )
      .then(async r => {
        const data = await readJsonResponse<{
          requestId?: string;
          status?: string;
          approvalChain?: ApprovalStage[];
          clusterName?: string;
          jumpboxName?: string;
          clusterProfile?: string;
          clusterAdministrators?: string[];
          prUrl?: string | null;
          prNumber?: number | null;
          branchName?: string | null;
          commitSha?: string | null;
          tailscalePrUrl?: string | null;
          accessStatus?: string | null;
          error?: string;
          readinessStatus?: AksReadinessStatus | null;
        }>(r);
        if (cancelled) return;
        if (!r.ok || !data.requestId) {
          setResumeError(
            r.ok
              ? `Could not load request ${resumeRequestId}.`
              : resumeErrorMessage(r.status, resumeRequestId),
          );
          return;
        }
        const status = data.status ?? '';
        setRequestId(data.requestId);
        setApprovalChain(data.approvalChain ?? []);
        setSubmittedNames({
          clusterName: data.clusterName,
          jumpboxName: data.jumpboxName,
        });
        if (data.readinessStatus) {
          setReadiness(data.readinessStatus);
        }
        if (data.clusterProfile && PROFILE_META[data.clusterProfile]) {
          const profile = data.clusterProfile;
          setForm(prev => ({ ...prev, clusterProfile: profile }));
        }
        if (data.clusterAdministrators)
          setClusterAdmins(data.clusterAdministrators);
        setPrUrl(data.prUrl ?? null);
        setPrNumber(data.prNumber ?? null);
        setBranchName(data.branchName ?? null);
        setCommitSha(data.commitSha ?? null);
        setTailscalePrUrl(data.tailscalePrUrl ?? null);
        setAccessStatus(data.accessStatus ?? null);
        setApprovalError(
          status === 'rejected' || status === 'failed'
            ? data.error ?? `Request ${data.requestId} is ${status}.`
            : null,
        );
        setPhase(resumePhaseForStatus(status));
        setModalOpen(true);
      })
      .catch(err => {
        if (cancelled) return;
        setResumeError(
          `Could not load request ${resumeRequestId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    return () => {
      cancelled = true;
      // Allow a retry if this load was interrupted.
      if (resumedIdRef.current === resumeRequestId) resumedIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeRequestId]);

  /** Put (or clear) ?request=<id> in the URL without adding history. */
  const setResumeParam = useCallback(
    (id: string | null) => {
      resumedIdRef.current = id;
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (id) next.set('request', id);
          else next.delete('request');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ── Auto-transition to provision when PR merge is detected ────────────────
  useEffect(() => {
    if (!prMerged || phase !== 'pull_request') return undefined;
    const timer = setTimeout(() => handleDeploy(), 2000);
    return () => clearTimeout(timer);
  }, [prMerged, phase, handleDeploy]);

  // ── Tailscale jumpbox access orchestration (approval phase) ───────────────
  // The Tailscale policy PR is the first gate. Once the final approval stage
  // completes, we poll for that PR to merge and only then let the AKS branch
  // / PR workflow start.
  useEffect(() => {
    const approvalsComplete =
      approvalChain.length > 0 &&
      approvalChain.every(stage => stage.status === 'approved');
    if (
      phase !== 'approval' ||
      !requestId ||
      !approvalsComplete ||
      accessKickedRef.current
    )
      return undefined;
    accessKickedRef.current = true;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const appendLog = (msg: string) =>
      setSubmitLogs(prev => [...prev, `[${ts()}] ${msg}`]);

    // Read-only: reports the Tailscale PR and whether the infrastructure-PR
    // action is available. It never creates anything; the user must press
    // "Create infrastructure PR".
    let mergedLogged = false;
    const pollAccess = () => {
      backendFetch('provisioning', `/request/${requestId}/access-status`)
        .then(async r => {
          const data = (await r.json()) as {
            accessStatus?: string;
            tailscalePrUrl?: string;
            merged?: boolean;
            infraPrActionAvailable?: boolean;
            infraPrOperation?: { state?: string; error?: string } | null;
            branchName?: string;
            commitSha?: string;
            prUrl?: string;
            prNumber?: number;
          };
          if (cancelled) return;
          if (data.accessStatus) setAccessStatus(data.accessStatus);
          if (data.tailscalePrUrl) setTailscalePrUrl(data.tailscalePrUrl);
          setTailscaleMerged(Boolean(data.merged));
          setInfraPrAvailable(Boolean(data.infraPrActionAvailable));
          setInfraPrFailure(
            data.infraPrOperation?.state === 'failed'
              ? data.infraPrOperation.error ?? 'The last attempt failed'
              : null,
          );
          if (data.prUrl && data.prNumber) {
            // Already created (e.g. by another tab): show it.
            if (pollId) {
              clearInterval(pollId);
              pollId = null;
            }
            if (data.branchName) setBranchName(data.branchName);
            if (data.commitSha) setCommitSha(data.commitSha);
            setPrUrl(data.prUrl);
            setPrNumber(data.prNumber);
            setPhase('pull_request');
            return;
          }
          if (data.merged && !mergedLogged) {
            mergedLogged = true;
            appendLog(
              'Tailscale PR merged — the infrastructure PR can now be created',
            );
          }
        })
        .catch(() => undefined);
    };

    pollAccess();
    pollId = setInterval(pollAccess, 8000);

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, requestId, approvalChain]);

  // No client-side provisioning simulation: Step 5 only reflects state the
  // backend has observed from real, tracked operations.

  // ── Field changes ──────────────────────────────────────────────────────────
  // A /plan preview describes the form it was produced for; drop it on edit.
  useEffect(() => {
    setPlanPreview(null);
    setGeneratedYaml(null);
    setGateReport(null);
  }, [form]);

  /** Clear a field's displayed error once the user edits it. */
  const clearError = (...keys: string[]) =>
    setErrors(prev => {
      if (!keys.some(k => k in prev)) return prev;
      const next = { ...prev };
      keys.forEach(k => delete next[k]);
      return next;
    });

  const onChange =
    (field: keyof AksFormData) => (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setForm(prev => {
        const next = { ...prev, [field]: val } as AksFormData;
        // Spot is not allowed for prd/ppd user pools.
        if (field === 'env' && !isSpotAllowed(val)) {
          next.nodePriority = 'Regular';
        }
        return next;
      });
      if (field === 'userMinNodes' || field === 'userMaxNodes') {
        clearError('userPool');
      } else if (field === 'nodePriority' || field === 'env') {
        clearError(field, 'userPool');
      } else {
        clearError(field, ...(field === 'tenantId' ? ['name'] : []));
      }
    };

  const setUserPoolEnabled = (enabled: boolean) => {
    setForm(prev => ({ ...prev, userPoolEnabled: enabled }));
    clearError('userPool');
  };

  const selectProfile = (profileId: string) => {
    // Multi-region profiles need paired clusters, which are not generated yet.
    if (isUnsupportedProfile(profileId)) return;
    setForm(prev => ({ ...prev, clusterProfile: profileId }));
    clearError('clusterProfile');
    setProfileDialog(null);
  };

  const selectNodeSizeFlavor = (flavor: NodeSizeFlavor) => {
    const { userPool } = AKS_FLAVOR_POOLS[flavor];
    setForm(prev => ({
      ...prev,
      nodeSizeFlavor: flavor,
      userMinNodes: String(userPool.minCount),
      userMaxNodes: String(userPool.maxCount),
    }));
    clearError('systemPool', 'userPool');
    setFlavorDialog(null);
  };

  // ── Validation ───────────────────────────────────────────────────────────
  // ── Cluster administrators (Tailscale jumpbox access) ──────────────────────
  const addAdmin = () => {
    const name = adminInput.trim();
    if (!name) return;
    if (!GITHUB_USERNAME_RE.test(name)) {
      setErrors(prev => ({
        ...prev,
        clusterAdministrators: `"${name}" is not a valid GitHub username`,
      }));
      return;
    }
    if (clusterAdmins.some(a => a.toLowerCase() === name.toLowerCase())) {
      setErrors(prev => ({
        ...prev,
        clusterAdministrators: `"${name}" has already been added`,
      }));
      return;
    }
    setClusterAdmins(prev => [...prev, name]);
    setAdminInput('');
    setErrors(prev => {
      const { clusterAdministrators: _removed, ...rest } = prev;
      return rest;
    });
  };

  const removeAdmin = (name: string) => {
    setClusterAdmins(prev => prev.filter(a => a !== name));
  };

  const validateConfigure = (): boolean => {
    const e: Record<string, string> = {
      ...(validateAksClusterRequest(toAksClusterRequest(form)) as Record<
        string,
        string
      >),
    };
    if (clusterAdmins.length === 0)
      e.clusterAdministrators =
        'At least one cluster administrator is required';
    setErrors(e);
    focusErrorTab(e);
    return Object.keys(e).length === 0;
  };

  /** Show backend field errors (400 from /plan or /submit) on the inputs. */
  const applyBackendFieldErrors = (fieldErrors?: Record<string, string>) => {
    if (!fieldErrors || Object.keys(fieldErrors).length === 0) return;
    setErrors(prev => ({ ...prev, ...fieldErrors }));
    focusErrorTab(fieldErrors);
  };

  // ── Phase transitions ──────────────────────────────────────────────────────
  const goReview = () => {
    if (!validateConfigure()) return;
    clearTimers();
    setGeneratedYaml(null);
    setPlanPreview(null);
    setPlanErrors([]);
    setPlanWarnings([]);
    setApprovalError(null);
    setGateReport(null);
    setPlanStatus('validating');
    setReviewLoading(true);
    setPhase('review');
    // POST /plan validates the canonical request and renders the values file.
    // No Terraform runs here: the plan comes from Terraform Cloud after merge.
    backendFetch('provisioning', '/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toAksClusterRequest(form, clusterAdmins)),
    })
      .then(async r => {
        const data = await readJsonOrThrow<PlanPreview>(
          r,
          'Plan request failed',
        );
        setPlanPreview(data);
        setGateReport(parseGateReport(data.gates));
        if (data.valuesFile) setGeneratedYaml(data.valuesFile);
        setPlanWarnings(data.warnings ?? []);
        if (data.valid === false) {
          applyBackendFieldErrors(data.fieldErrors);
          setPlanErrors(
            data.errors?.length
              ? data.errors
              : ['The backend rejected this configuration.'],
          );
          setPlanStatus('failed');
          return;
        }
        setPlanErrors(data.errors ?? []);
        setPlanStatus('completed');
      })
      .catch(err => {
        // Never present a locally computed preview as a validated plan.
        setPlanErrors(prev => [
          ...prev,
          `Plan request failed: ${err instanceof Error ? err.message : err}`,
        ]);
        setPlanStatus('failed');
      })
      .finally(() => {
        setReviewLoading(false);
      });
  };

  const runDeployPreflight = async (): Promise<boolean> => {
    setDeployPreflightBusy(true);
    try {
      const r = await backendFetch('provisioning', '/preflight');
      const data = (await r.json()) as { ok?: boolean; reason?: string };
      if (!r.ok || !data.ok) {
        const message =
          data.reason ??
          'Submit blocked: GitHub preflight failed. Check backend token permissions.';
        setPlanErrors(prev =>
          prev.includes(message) ? prev : [...prev, message],
        );
        return false;
      }
      return true;
    } catch (err) {
      const message = `Submit blocked: preflight check failed (${
        err instanceof Error ? err.message : String(err)
      })`;
      setPlanErrors(prev =>
        prev.includes(message) ? prev : [...prev, message],
      );
      return false;
    } finally {
      setDeployPreflightBusy(false);
    }
  };

  const goSubmit = async () => {
    // Guard against double-clicks: state updates are async, the ref is not.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitBusy(true);
    try {
      const ready = await runDeployPreflight();
      if (!ready) return;
      clearTimers();
      setRequestId(null);
      setPrUrl(null);
      setPrNumber(null);
      setBranchName(null);
      setWorkflowRunUrl(null);
      setTaskId(null);
      setApprovalError(null);
      setApprovalChain([]);
      setCommitSha(null);
      setPrCreateError(null);
      setGitBranchBusy(false);
      setSubmittedNames(null);
      const appendLogs = (...lines: string[]) =>
        setSubmitLogs(prev => [...prev, ...lines.map(l => `[${ts()}] ${l}`)]);
      setSubmitLogs([
        `[${ts()}] Creating CloudHub Infrastructure Request for ${
          names.clusterName
        }...`,
      ]);

      let response: Response;
      try {
        response = await backendFetch('provisioning', '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toAksClusterRequest(form, clusterAdmins)),
        });
      } catch (err) {
        const message = `Submit failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
        appendLogs(`ERROR: ${message}. Request halted.`);
        setApprovalError(message);
        return;
      }

      let data: {
        requestId?: string;
        status?: string;
        approvalChain?: ApprovalStage[];
        clusterName?: string;
        jumpboxName?: string;
        configFingerprint?: string;
        mode?: string;
        error?: string;
        errors?: string[];
        fieldErrors?: Record<string, string>;
        gates?: SubmissionGateReport;
      };
      try {
        data = await readJsonResponse(response);
      } catch (err) {
        const message = `Submit failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
        appendLogs(`ERROR: ${message}. Request halted.`);
        setApprovalError(message);
        return;
      }

      if (response.status === 412) {
        // Mandatory preflight gates blocked the submission; stay on review.
        const gates = parseGateReport(data.gates);
        if (gates) setGateReport(gates);
        const message = `Submission blocked by preflight checks: ${
          data.error ?? GATES_BLOCKING_MESSAGE
        }`;
        appendLogs(`ERROR: ${message}. Request halted.`);
        setApprovalError(message);
        return;
      }

      if (!response.ok || !data.requestId) {
        let prefix = 'Submit failed';
        if (response.status === 400) prefix = 'Request rejected (validation)';
        else if (response.status === 409)
          prefix = 'Conflicts with an in-flight request';
        else if (response.status === 422)
          prefix = 'Approval stage not configured';
        else if (response.status === 503)
          prefix = 'Provisioning backend unavailable';
        const detail =
          data.error ??
          (response.ok
            ? 'Backend did not return a request ID'
            : `HTTP ${response.status}`);
        const message = `${prefix}: ${detail}`;
        applyBackendFieldErrors(data.fieldErrors);
        appendLogs(`ERROR: ${message}. Request halted.`);
        setApprovalError(message);
        return;
      }
      if (data.mode === 'sim') {
        const message =
          'Backend returned simulation mode; request was not created';
        appendLogs(`ERROR: ${message}.`);
        setApprovalError(message);
        return;
      }

      setRequestId(data.requestId);
      // Refreshing the page resumes this request.
      setResumeParam(data.requestId);
      setSubmittedNames({
        clusterName: data.clusterName,
        jumpboxName: data.jumpboxName,
      });
      const chain =
        data.approvalChain ??
        (PROFILE_META[form.clusterProfile]?.approvals ?? []).map(role => ({
          role,
          status: 'pending' as const,
        }));
      setApprovalChain(chain);
      appendLogs(
        `✅ Infrastructure Request ${data.requestId} created for ${
          data.clusterName ?? names.clusterName
        } — status PENDING APPROVAL`,
        ...(data.configFingerprint
          ? [`Configuration fingerprint ${data.configFingerprint}`]
          : []),
        `CloudHub Approval Workflow started: ${chain
          .map(s => s.role)
          .join(' → ')}`,
        `Values file ${names.valuesFilePath} will be committed only after CloudHub approval.`,
        `No Git branch, commit, or PR created yet.`,
      );
      setPhase('approval');
    } finally {
      submitInFlightRef.current = false;
      setSubmitBusy(false);
    }
  };

  // Advance one CloudHub approval stage. Once the final stage is approved the
  // backend starts the Tailscale access step first.
  const approveStage = (role: string) => {
    if (!requestId || approvalBusy) return;
    setApprovalBusy(true);
    setApprovalError(null);
    setApprovalGates(null);
    backendFetch('provisioning', `/request/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The approver is the signed-in user, resolved by the backend.
      body: JSON.stringify({ role }),
    })
      .then(async r => {
        const data = await readJsonResponse<{
          approvalChain?: ApprovalStage[];
          status?: string;
          accessStatus?: string;
          tailscalePrUrl?: string;
          branchName?: string;
          commitSha?: string;
          tfvarsPath?: string;
          error?: string;
          gates?: SubmissionGateReport;
        }>(r);
        if (r.status === 412) {
          // Final stage blocked by preflight gates; nothing was recorded.
          setApprovalGates(parseGateReport(data.gates));
          setApprovalError(
            `Approval blocked by preflight checks: ${
              data.error ?? GATES_BLOCKING_MESSAGE
            }`,
          );
          return;
        }
        if (!r.ok)
          throw new Error(data.error ?? `Approval failed (HTTP ${r.status})`);
        if (data.approvalChain) setApprovalChain(data.approvalChain);
        if (data.accessStatus) setAccessStatus(data.accessStatus);
        if (data.tailscalePrUrl) setTailscalePrUrl(data.tailscalePrUrl);
        // All stages approved — backend starts the Tailscale access gate.
        if (
          data.status === 'awaiting_tailscale_merge' ||
          data.status === 'approved'
        ) {
          setGitBranchBusy(false);
          setSubmitLogs(prev => [
            ...prev,
            `[${ts()}] ✅ Final approval complete — starting Tailscale access step`,
            data.tailscalePrUrl
              ? `[${ts()}] Tailscale PR opened: ${data.tailscalePrUrl}`
              : `[${ts()}] Waiting for Tailscale PR to open...`,
          ]);
          setTimeout(() => setPhase('approval'), 200);
        } else if (data.status === 'provisioning') {
          // Approval chain still processing — keep approval phase, show spinner
          setGitBranchBusy(true);
        } else if (data.status === 'branch_ready' && data.branchName) {
          setGitBranchBusy(false);
          setBranchName(data.branchName);
          if (data.branchName) setPrUrl(null);
          setCommitSha(data.commitSha ?? null);
          setSubmitLogs(prev => [
            ...prev,
            `[${ts()}] ✅ Feature branch ${data.branchName} created from main`,
            `[${ts()}] tfvars committed at ${data.tfvarsPath ?? ''} (${
              data.commitSha ?? ''
            })`,
            `[${ts()}] infra/workspacemanager/workspaces.tfvars updated`,
            `[${ts()}] No PR created yet — ready for Pull Request step`,
          ]);
          setTimeout(() => setPhase('pull_request'), 800);
        }
      })
      .catch(err => {
        setGitBranchBusy(false);
        setApprovalError(err?.message ?? String(err));
      })
      .finally(() => {
        setApprovalBusy(false);
      });
  };

  const rejectRequest = () => {
    if (!requestId || approvalBusy) return;
    setApprovalBusy(true);
    setApprovalError(null);
    backendFetch('provisioning', `/request/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Rejected by approver' }),
    })
      .then(async r => {
        const data = await readJsonOrThrow<{
          approvalChain?: ApprovalStage[];
          status?: string;
          error?: string;
        }>(r, 'Reject failed');
        if (data.approvalChain) setApprovalChain(data.approvalChain);
        setSubmitLogs(prev => [
          ...prev,
          `[${ts()}] ✖ Request rejected — no Git operations were performed`,
        ]);
      })
      .catch(err => {
        setApprovalError(err?.message ?? String(err));
      })
      .finally(() => {
        setApprovalBusy(false);
      });
  };

  const cancelDeployment = () => {
    clearTimers();
    if (!taskId) {
      // Nothing CloudHub-tracked to cancel; never report a cancellation that
      // did not happen.
      setPlanErrors(prev => {
        const msg =
          'Nothing to cancel: infrastructure execution is not tracked by CloudHub yet. Cancel the run in Terraform Cloud.';
        return prev.includes(msg) ? prev : [...prev, msg];
      });
      return;
    }
    setCancelDeployBusy(true);
    backendFetch('provisioning', `/task/${taskId}/cancel`, { method: 'POST' })
      .then(async r => {
        const data = (await r.json()) as { status?: string };
        if (data.status === 'cancelled') {
          setRunState('cancelled');
        }
      })
      .catch(err => {
        setPlanErrors(prev => [
          ...prev,
          `Cancel failed: ${err?.message ?? err}`,
        ]);
      })
      .finally(() => {
        setCancelDeployBusy(false);
      });
  };

  const resetWizard = () => {
    clearTimers();
    setPhase('configure');
    setForm(INITIAL_FORM);
    setErrors({});
    setPlanPreview(null);
    setPlanLogs([]);
    setSubmitLogs([]);
    setRequestId(null);
    setTaskId(null);
    setPrUrl(null);
    setWorkflowRunUrl(null);
    setPrMerged(false);
    setRegistryStatus(null);
    setBootstrapStatus(null);
    setGeneratedYaml(null);
    setReviewLoading(false);
    setPlanErrors([]);
    setPlanWarnings([]);
    setPlanStatus('idle');
    setSubmitBusy(false);
    setSubmittedNames(null);
    setCancelDeployBusy(false);
    setDeployPreflightBusy(false);
    setApprovalChain([]);
    setApprovalBusy(false);
    setApprovalError(null);
    setPrNumber(null);
    setBranchName(null);
    setCommitSha(null);
    setPrCreateBusy(false);
    setPrCreateError(null);
    setGitBranchBusy(false);
    setRunState('draft');
    setCurrentIdx(0);
    setStepPct(0);
    setApiEndpoint('');
    setClusterAdmins([]);
    setAdminInput('');
    setAccessStatus(null);
    setTailscalePrUrl(null);
    setAccessError(null);
    setClusterReady(false);
    accessKickedRef.current = false;
    setGateReport(null);
    setApprovalGates(null);
    setExecView(null);
    setExecError(null);
    setExecNotConfigured(false);
    setResumeError(null);
    setResumeParam(null);
  };

  // ── Field renderer ───────────────────────────────────────────────────────
  const f = (
    field: keyof AksFormData,
    label: string,
    opts?: string[],
    err?: string,
    renderOpt?: (o: string) => string,
    required?: boolean,
    helper?: string,
  ) => (
    <TextField
      fullWidth
      select={Boolean(opts)}
      label={label}
      value={form[field]}
      onChange={onChange(field)}
      error={!!err}
      helperText={err ?? helper}
      required={required}
      variant="outlined"
      size="small"
      margin="dense"
      className={classes.compactField}
    >
      {opts?.map(o => (
        <MenuItem key={o} value={o}>
          {renderOpt ? renderOpt(o) : o}
        </MenuItem>
      ))}
    </TextField>
  );

  /** Read-only value rendered with the same compact field styling. */
  const readOnlyField = (label: string, value: string, helper?: string) => (
    <TextField
      fullWidth
      label={label}
      value={value}
      variant="outlined"
      size="small"
      margin="dense"
      className={classes.compactField}
      InputProps={{ readOnly: true }}
      helperText={helper}
    />
  );

  const submitDisabled =
    reviewLoading ||
    planStatus !== 'completed' ||
    planErrors.length > 0 ||
    deployPreflightBusy ||
    submitBusy ||
    Boolean(gateReport?.blocking);
  const submitLabel = (idle: string) => {
    if (deployPreflightBusy) return 'Checking Submit...';
    if (submitBusy) return 'Submitting…';
    return idle;
  };

  // ── Shared status renderers ───────────────────────────────────────────────
  const renderNotice = (
    severity: Severity,
    content: ReactNode,
    extraStyle?: CSSProperties,
  ) => {
    const c = NOTICE_COLORS[severity];
    return (
      <div
        style={{
          marginTop: 12,
          padding: '10px 14px',
          background: c.background,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          fontSize: '0.8125rem',
          color: c.color,
          ...extraStyle,
        }}
      >
        {content}
      </div>
    );
  };

  const linkButtonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#1D4ED8',
    color: '#FFFFFF',
    padding: '4px 10px',
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.75rem',
    textDecoration: 'none',
  };

  /** Mandatory submission preflight gates (POST /plan, or a 412 body). */
  const renderGates = (report: SubmissionGateReport) => (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        background: '#F9FAFB',
        border: `1px solid ${report.blocking ? '#FCA5A5' : '#86EFAC'}`,
        borderRadius: 8,
      }}
    >
      <Typography
        style={{
          fontWeight: 700,
          color: '#111827',
          fontSize: '0.85rem',
          marginBottom: 6,
        }}
      >
        Preflight Checks
        {report.checkedAt && (
          <span
            style={{ fontWeight: 400, color: '#6B7280', fontSize: '0.75rem' }}
          >
            {' '}
            · checked {report.checkedAt}
          </span>
        )}
      </Typography>
      {report.checks.map(check => (
        <div
          key={check.id}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '4px 0',
            fontSize: '0.8125rem',
          }}
        >
          <Chip
            size="small"
            label={check.status}
            style={{
              fontWeight: 700,
              minWidth: 84,
              ...(GATE_CHIP_COLORS[check.status] ?? GATE_CHIP_COLORS.failed),
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#111827' }}>
              {check.label}
            </div>
            <div style={{ color: '#374151' }}>{check.detail}</div>
            {(check.warnings ?? []).map((w, i) => (
              <div key={i} style={{ color: '#92400E' }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        </div>
      ))}
      {report.blocking && (
        <div
          style={{
            marginTop: 6,
            fontSize: '0.8125rem',
            color: '#991B1B',
            fontWeight: 600,
          }}
        >
          {GATES_BLOCKING_MESSAGE}
        </div>
      )}
    </div>
  );

  /** Request ID plus a link that reopens this request after a refresh. */
  const renderResumeLink = () => {
    if (!requestId) return null;
    const link = `${window.location.origin}${
      window.location.pathname
    }?request=${encodeURIComponent(requestId)}`;
    return (
      <Tooltip title={resumeCopied ? 'Copied' : `Copy resume link: ${link}`}>
        <Chip
          size="small"
          icon={resumeCopied ? <CheckIcon /> : <ContentCopyIcon />}
          label={`Resume link · ?request=${requestId}`}
          onClick={() => {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(link);
              setResumeCopied(true);
              setTimeout(() => setResumeCopied(false), 2000);
            }
          }}
          style={{
            background: '#F3F4F6',
            color: '#374151',
            fontWeight: 700,
            marginLeft: 8,
            marginBottom: 16,
          }}
        />
      </Tooltip>
    );
  };

  const refreshExecutionNow = () => {
    if (!requestId || execBusy) return;
    fetchExecution(requestId, () => false);
  };

  /** Read-only infrastructure execution status (GitHub + Terraform Cloud). */
  const renderExecutionPanel = () => {
    const view = execView;
    const headline = view ? executionHeadline(view) : null;
    const banner = view ? freshnessBanner(view) : null;
    const verified = lastVerifiedAt(view);
    const stages = view ? executionStages(view) : [];
    const polling = view ? shouldPollExecution(view) : false;
    return (
      <div className={classes.stagesCard}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            marginBottom: 4,
            flexWrap: 'wrap',
          }}
        >
          <Typography className={classes.stagesHead}>
            Infrastructure Execution
          </Typography>
          <Typography className={classes.stagesMeta}>
            Read-only · GitHub &amp; Terraform Cloud
            {verified ? ` · Last verified: ${verified}` : ''}
          </Typography>
          <span className={classes.spacer} />
          <Button
            size="small"
            variant="outlined"
            className={classes.secondaryBtn}
            startIcon={<RefreshIcon />}
            disabled={!requestId || execBusy}
            onClick={refreshExecutionNow}
          >
            {execBusy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {execNotConfigured && renderNotice('warning', TRACKING_NOT_CONFIGURED)}
        {view &&
          !view.trackable &&
          !execNotConfigured &&
          renderNotice(
            'info',
            view.notTrackableReason ?? 'This request is not tracked.',
          )}
        {execError && renderNotice('error', execError)}
        {actionError && renderNotice('error', actionError)}
        {banner && renderNotice(banner.severity, banner.message)}
        {!view && !execError && renderNotice('info', 'Loading status…')}

        {headline &&
          renderNotice(
            headline.severity,
            <>
              <strong>{headline.title}</strong>
              {headline.message ? ` — ${headline.message}` : ''}
            </>,
          )}

        {stages.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {stages.map((stage, i) => {
              const st = STAGE_STATE_STYLE[stage.state];
              return (
                <div
                  key={stage.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '8px 0',
                    borderTop: i === 0 ? 'none' : '1px solid #F3F4F6',
                  }}
                >
                  <span
                    className={classes.stepDot}
                    style={{
                      background: st.dot,
                      color: st.color,
                      flexShrink: 0,
                    }}
                  >
                    {st.symbol || i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '0.8125rem',
                          color: '#111827',
                        }}
                      >
                        {i + 1}. {stage.label}
                      </span>
                      <span
                        style={{
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                          color: stage.state === 'pending' ? '#6B7280' : st.dot,
                        }}
                      >
                        {stage.summary}
                      </span>
                    </div>
                    {stage.detail && (
                      <div style={{ fontSize: '0.8rem', color: '#374151' }}>
                        {stage.detail}
                      </div>
                    )}
                    {stage.facts.map((fact, j) => (
                      <div
                        key={j}
                        style={{
                          fontSize: '0.78rem',
                          color: '#4B5563',
                          wordBreak: 'break-word',
                        }}
                      >
                        {fact}
                      </div>
                    ))}
                    {stage.errors.map((e, j) => (
                      <div
                        key={j}
                        style={{
                          fontSize: '0.78rem',
                          color: '#B91C1C',
                          fontWeight: 600,
                        }}
                      >
                        ✗ {e}
                      </div>
                    ))}
                    {stage.links.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          marginTop: 4,
                        }}
                      >
                        {stage.links.map(l => (
                          <a
                            key={`${l.label}-${l.url}`}
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={linkButtonStyle}
                          >
                            <VisibilityIcon style={{ fontSize: '0.85rem' }} />{' '}
                            {l.label}
                          </a>
                        ))}
                      </div>
                    )}
                    {stage.notice &&
                      renderNotice(
                        stage.notice.severity,
                        <>
                          <div>{stage.notice.text}</div>
                          {stage.notice.link && (
                            <a
                              href={stage.notice.link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ ...linkButtonStyle, marginTop: 8 }}
                            >
                              <VisibilityIcon style={{ fontSize: '0.85rem' }} />{' '}
                              {stage.notice.link.label}
                            </a>
                          )}
                        </>,
                        { marginTop: 6 },
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {polling && (
          <Typography
            variant="caption"
            style={{ display: 'block', marginTop: 8, color: '#6B7280' }}
          >
            CloudHub re-checks every {EXECUTION_POLL_MS / 1000} seconds. It
            never merges, applies or changes anything in GitHub or Terraform
            Cloud.
          </Typography>
        )}
      </div>
    );
  };

  const renderReadinessStatus = () => {
    const isInfraReady =
      readiness?.infrastructureReady ||
      execView?.execution?.phase === 'outputs_available' ||
      runState === 'completed';
    const overall =
      readiness?.overallStatus ??
      (isInfraReady ? 'Infrastructure Ready' : 'Provisioning');

    const addons = readiness?.details?.addons ?? {
      'common-res': { status: 'pending' },
      datadog: { status: 'pending' },
      velero: { status: 'pending' },
    };

    return (
      <div
        style={{
          marginTop: 16,
          marginBottom: 16,
          padding: '16px',
          borderRadius: 10,
          border: '1px solid #E5E7EB',
          background: '#FFFFFF',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <Typography
              style={{ fontWeight: 800, fontSize: '0.95rem', color: '#111827' }}
            >
              Cluster Readiness &amp; Verification
            </Typography>
            <Typography style={{ fontSize: '0.8rem', color: '#6B7280' }}>
              Four-tier readiness tracker: Infrastructure, Add-ons, Operational, and Final Completion
            </Typography>
          </div>
          <Chip
            size="small"
            label={overall}
            style={{
              fontWeight: 800,
              fontSize: '0.75rem',
              background: isInfraReady ? '#DCFCE7' : '#EFF6FF',
              color: isInfraReady ? '#166534' : '#1D4ED8',
            }}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            marginBottom: 14,
          }}
        >
          {/* Tier 1: Infrastructure */}
          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              border: `1px solid ${isInfraReady ? '#86EFAC' : '#E5E7EB'}`,
              background: isInfraReady ? '#F0FDF4' : '#F9FAFB',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: '1rem' }}>{isInfraReady ? '✅' : '⏳'}</span>
              <Typography style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#111827' }}>
                1. Infrastructure
              </Typography>
            </div>
            <Typography style={{ fontSize: '0.75rem', color: '#4B5563' }}>
              {isInfraReady ? 'Terraform applied & outputs verified' : 'Awaiting apply & outputs'}
            </Typography>
          </div>

          {/* Tier 2: Add-ons */}
          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              border: `1px solid ${readiness?.addonsReady ? '#86EFAC' : '#E5E7EB'}`,
              background: readiness?.addonsReady ? '#F0FDF4' : '#F9FAFB',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: '1rem' }}>{readiness?.addonsReady ? '✅' : '📦'}</span>
              <Typography style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#111827' }}>
                2. Add-ons
              </Typography>
            </div>
            <Typography style={{ fontSize: '0.75rem', color: '#4B5563' }}>
              {readiness?.addonsReady ? 'All supported add-ons ready' : 'common-res, datadog, velero'}
            </Typography>
          </div>

          {/* Tier 3: Operational */}
          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              border: `1px solid ${readiness?.operationallyReady ? '#86EFAC' : '#E5E7EB'}`,
              background: readiness?.operationallyReady ? '#F0FDF4' : '#F9FAFB',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: '1rem' }}>{readiness?.operationallyReady ? '✅' : '🔒'}</span>
              <Typography style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#111827' }}>
                3. Operational
              </Typography>
            </div>
            <Typography style={{ fontSize: '0.75rem', color: '#4B5563' }}>
              {readiness?.operationallyReady ? 'Jumpbox & access verified' : 'Jumpbox, SSH & Kubeconfig'}
            </Typography>
          </div>

          {/* Tier 4: Completed */}
          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              border: `1px solid ${readiness?.completed ? '#86EFAC' : '#E5E7EB'}`,
              background: readiness?.completed ? '#F0FDF4' : '#F9FAFB',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: '1rem' }}>{readiness?.completed ? '🏆' : '🎯'}</span>
              <Typography style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#111827' }}>
                4. Completed
              </Typography>
            </div>
            <Typography style={{ fontSize: '0.75rem', color: '#4B5563' }}>
              {readiness?.completed ? 'Fully operational & validated' : 'Pending prior tiers'}
            </Typography>
          </div>
        </div>

        {/* Add-ons dispatch controls */}
        {isInfraReady && (
          <div
            style={{
              borderTop: '1px solid #F3F4F6',
              paddingTop: 10,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151' }}>
              Add-ons:
            </span>
            {(['common-res', 'datadog', 'velero'] as const).map(addon => {
              const info = addons[addon];
              const isWorking = addonDeploying === addon;
              return (
                <div
                  key={addon}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid #E5E7EB',
                    fontSize: '0.75rem',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{addon}:</span>
                  <Chip
                    size="small"
                    label={info?.status ?? 'pending'}
                    style={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      background:
                        info?.status === 'succeeded'
                          ? '#DCFCE7'
                          : info?.status === 'in_progress'
                          ? '#FEF3C7'
                          : '#F3F4F6',
                    }}
                  />
                  <Button
                    size="small"
                    variant="text"
                    disabled={Boolean(addonDeploying)}
                    onClick={() => deployAddon(addon)}
                    style={{ padding: '0 4px', minWidth: 'auto', textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    {isWorking ? 'Deploying…' : 'Deploy'}
                  </Button>
                </div>
              );
            })}
            <Button
              size="small"
              variant="outlined"
              className={classes.secondaryBtn}
              disabled={verifyingBusy}
              onClick={verifyOperational}
              style={{ marginLeft: 'auto' }}
            >
              {verifyingBusy ? 'Verifying…' : 'Verify Operational Status'}
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderEventsTimeline = () => {
    if (events.length === 0) return null;

    return (
      <div
        style={{
          marginTop: 16,
          padding: '16px',
          borderRadius: 10,
          border: '1px solid #E5E7EB',
          background: '#FFFFFF',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography
              style={{ fontWeight: 800, fontSize: '0.95rem', color: '#111827' }}
            >
              Execution Timeline &amp; Events
            </Typography>
            <Chip
              size="small"
              label={events.length}
              style={{ height: 20, fontWeight: 700, fontSize: '0.75rem' }}
            />
          </div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: streamConnected ? '#059669' : '#D97706',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{streamConnected ? '●' : '○'}</span>
            {streamConnected ? 'Live stream connected' : streamError || 'Polling active'}
          </span>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {events.map((evt, idx) => {
            const timeStr = evt.ingestionTimestamp
              ? new Date(evt.ingestionTimestamp).toLocaleTimeString()
              : '—';
            const badgeBg =
              evt.severity === 'error'
                ? '#FEE2E2'
                : evt.severity === 'success'
                ? '#DCFCE7'
                : evt.severity === 'warning'
                ? '#FEF3C7'
                : '#EFF6FF';
            const badgeColor =
              evt.severity === 'error'
                ? '#991B1B'
                : evt.severity === 'success'
                ? '#166534'
                : evt.severity === 'warning'
                ? '#92400E'
                : '#1D4ED8';

            return (
              <div
                key={evt.id ?? `${evt.eventId}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '8px 0',
                  borderTop: idx === 0 ? 'none' : '1px solid #F3F4F6',
                  fontSize: '0.8rem',
                }}
              >
                <span
                  style={{
                    color: '#6B7280',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    flexShrink: 0,
                    minWidth: 70,
                  }}
                >
                  {timeStr}
                </span>
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: '#F3F4F6',
                    color: '#374151',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {evt.sourceSystem}
                </span>
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: badgeBg,
                    color: badgeColor,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {evt.normalizedStatus}
                </span>
                <div style={{ flex: 1, color: '#1F2937' }}>
                  {evt.message}
                  {evt.sourceUrl && (
                    <a
                      href={evt.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginLeft: 8,
                        color: '#2563EB',
                        textDecoration: 'none',
                        fontWeight: 600,
                      }}
                    >
                      View ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Renderers ────────────────────────────────────────────────────────────
  const renderStepper = () => (
    <div className={classes.modalStepperBar}>
      {phases.map((p, i) => {
        const done = i < phaseIndex;
        const active = i === phaseIndex;
        const dotBg = getPhaseStepperDotBg(done, active);
        const dotColor = getPhaseStepperDotColor(done, active);
        const dotBorder = getPhaseStepperDotBorder(done, active);
        return (
          <Fragment key={p}>
            <div
              className={classes.stepperNodeCompact}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (done) setPhase(p);
              }}
              onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  if (done) setPhase(p);
                }
              }}
              style={{ cursor: done ? 'pointer' : 'default' }}
            >
              <span
                className={classes.stepperDotCompact}
                style={{
                  background: dotBg,
                  color: dotColor,
                  border: `2px solid ${dotBorder}`,
                }}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={classes.stepperNameCompact}
                style={{ color: getPhaseStepNameColor(done, active) }}
              >
                {PHASE_LABELS[p]}
              </span>
            </div>
            {i < phases.length - 1 && (
              <span
                className={classes.stepperConnCompact}
                style={{ background: getPhaseStepperConnBg(done) }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );

  const renderTerminal = (title: string, lines: string[]) => (
    <div className={classes.terminalCard}>
      <div className={classes.terminalHead}>
        <span>{title}</span>
        <span style={{ color: '#6EE7B7' }}>
          {runState === 'completed' ? 'DONE' : 'RUNNING'}
        </span>
      </div>
      <div className={classes.terminalBody} ref={termRef}>
        {lines.map((line, i) => {
          let color = '#E5E7EB';
          if (line.includes('✓') || line.includes('✅')) color = '#6EE7B7';
          else if (line.includes('▶') || line.includes('stream'))
            color = '#93C5FD';
          else if (line.includes('output :') || line.includes('━'))
            color = '#6B7280';
          else if (line === '') color = 'transparent';
          return (
            <div key={i} className={classes.terminalLine} style={{ color }}>
              {line || '\u00A0'}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderConfigure = () => {
    return (
      <div className={classes.configureLayout}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isDesktopSummary
              ? 'minmax(0, 2fr) minmax(272px, 0.85fr)'
              : 'minmax(0, 1fr)',
            gap: theme.spacing(2),
            alignItems: 'start',
          }}
        >
          {/* Left Column: Form & Selectors */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing(1.25),
            }}
          >
            {/* Context strip indicating selected profile & compute */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                padding: '8px 14px',
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                  Architecture:
                </span>
                <strong style={{ fontSize: '0.85rem', color: '#111827' }}>
                  {meta?.label}
                </strong>
                <span style={{ color: '#E5E7EB' }}>|</span>
                <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                  Compute Flavor:
                </span>
                <strong style={{ fontSize: '0.85rem', color: '#111827' }}>
                  {NODE_SIZE_FLAVORS[form.nodeSizeFlavor].label} ({nodeSizeText}
                  )
                </strong>
                <span style={{ color: '#E5E7EB' }}>|</span>
                <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                  Est. Cost:
                </span>
                <strong style={{ fontSize: '0.85rem', color: '#6B7280' }}>
                  {NOT_ESTIMATED}
                </strong>
              </div>
              <Button
                size="small"
                variant="text"
                style={{
                  textTransform: 'none',
                  fontSize: '0.78rem',
                  color: '#6B21A8',
                  fontWeight: 700,
                  padding: '2px 8px',
                }}
                onClick={handleCloseModal}
              >
                Change Profile / Size
              </Button>
            </div>

            {/* Sub-tabs */}
            <div>
              <Tabs
                value={configTab}
                onChange={(_, val) => setConfigTab(val)}
                className={classes.configSubTabs}
                indicatorColor="primary"
                textColor="primary"
              >
                <Tab
                  label={
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      1. Identity &amp; Environment
                      {isTab0Valid ? (
                        <CheckIcon style={{ fontSize: 14, color: '#059669' }} />
                      ) : (
                        <span style={{ color: '#DC2626' }}>*</span>
                      )}
                    </span>
                  }
                />
                <Tab
                  label={
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      2. Compute &amp; Network
                      {isTab1Valid ? (
                        <CheckIcon style={{ fontSize: 14, color: '#059669' }} />
                      ) : (
                        <span style={{ color: '#DC2626' }}>*</span>
                      )}
                    </span>
                  }
                />
                <Tab
                  label={
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      3. Access &amp; Jumpbox
                      {isTab2Valid ? (
                        <CheckIcon style={{ fontSize: 14, color: '#059669' }} />
                      ) : (
                        <span style={{ color: '#DC2626' }}>*</span>
                      )}
                    </span>
                  }
                />
              </Tabs>

              {/* Tab 0: Identity & Environment */}
              {configTab === 0 && (
                <div className={classes.configTabPanel}>
                  {errors.clusterProfile && (
                    <Typography
                      variant="caption"
                      style={{
                        color: '#DC2626',
                        display: 'block',
                        marginBottom: 6,
                      }}
                    >
                      Cluster profile: {errors.clusterProfile}
                    </Typography>
                  )}
                  <div className={classes.configFieldsGrid2Col}>
                    <div>
                      {f(
                        'customer',
                        'Customer',
                        undefined,
                        errors.customer,
                        undefined,
                        true,
                      )}
                    </div>
                    <div>
                      {f(
                        'businessUnit',
                        'Business Unit',
                        undefined,
                        errors.businessUnit,
                        undefined,
                        true,
                      )}
                    </div>
                    <div>
                      {f(
                        'env',
                        'Environment',
                        [...AKS_ENVIRONMENTS],
                        errors.env,
                        undefined,
                        true,
                      )}
                    </div>
                    <div>
                      {f(
                        'tenancy',
                        'Tenancy',
                        [...AKS_TENANCIES],
                        errors.tenancy,
                        t => `${TENANCY_LABELS[t] ?? t} (${t})`,
                        true,
                      )}
                    </div>
                    <div>
                      {f(
                        'tenantId',
                        'Tenant ID',
                        undefined,
                        errors.tenantId ?? errors.name,
                        undefined,
                        true,
                        "'all' or 2–24 lower-case letters/digits",
                      )}
                    </div>
                    <div>
                      {f(
                        'owner',
                        'Owner Email',
                        undefined,
                        errors.owner,
                        undefined,
                        true,
                      )}
                    </div>
                    <div>
                      {f(
                        'costCentre',
                        'Cost Centre',
                        undefined,
                        errors.costCentre,
                        undefined,
                        true,
                        'e.g. P64358',
                      )}
                    </div>
                    <div>
                      {f(
                        'changeTicket',
                        'Change Ticket',
                        undefined,
                        errors.changeTicket,
                        undefined,
                        true,
                        'Jira key, e.g. SCP-1234',
                      )}
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      {readOnlyField(
                        'Subscription',
                        AKS_SUBSCRIPTION_LABEL,
                        'Fixed by the azure-kubernetes-service-standard root',
                      )}
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      {readOnlyField(
                        'Resource Group',
                        nameReady
                          ? names.resourceGroupName
                          : 'rg-scp-<env>-<region>-<tenancy>-<tenant>',
                        'Always created by Terraform',
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 1: Compute & Network */}
              {configTab === 1 && (
                <div className={classes.configTabPanel}>
                  <div className={classes.configFieldsGrid2Col}>
                    <div>
                      {f(
                        'location',
                        'Region',
                        REGION_NAMES,
                        errors.location,
                        regionText,
                        true,
                      )}
                    </div>
                    <div>
                      {f(
                        'kubernetesVersion',
                        'Kubernetes Version',
                        undefined,
                        errors.kubernetesVersion,
                        undefined,
                        true,
                        'Full version, e.g. 1.36.2',
                      )}
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      {f(
                        'addressSpace',
                        'Address Space',
                        undefined,
                        errors.addressSpace,
                        undefined,
                        true,
                        '/16 inside 10.0.0.0/8, unique across SCP VNets — check the Virtual Network Information page',
                      )}
                    </div>
                    {subnets && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <div className={classes.lockedNodeBox}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: '#4B5563',
                              fontWeight: 600,
                            }}
                          >
                            Derived subnets — AKS {subnets.aks} · Secondary{' '}
                            {subnets.secondary} · NetApp {subnets.netapp} · VPN
                            gateway {subnets.vpnGateway}
                          </span>
                        </div>
                      </div>
                    )}

                    <div style={{ gridColumn: 'span 2' }}>
                      <TextField
                        fullWidth
                        label="System Pool"
                        value={formatPool(aksRequest.systemPool)}
                        variant="outlined"
                        size="small"
                        margin="dense"
                        className={classes.compactField}
                        InputProps={{ readOnly: true }}
                        error={!!errors.systemPool}
                        helperText={
                          errors.systemPool ??
                          `Fixed by the ${
                            NODE_SIZE_FLAVORS[form.nodeSizeFlavor].label
                          } flavor`
                        }
                      />
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            color="primary"
                            checked={!form.userPoolEnabled}
                            onChange={e =>
                              setUserPoolEnabled(!e.target.checked)
                            }
                          />
                        }
                        label={
                          <span style={{ fontSize: '0.8rem' }}>
                            No user pool (system pool only)
                          </span>
                        }
                      />
                    </div>

                    {form.userPoolEnabled && (
                      <>
                        <div>
                          {readOnlyField(
                            'User Pool VM Size',
                            AKS_FLAVOR_POOLS[form.nodeSizeFlavor].userPool
                              .vmSize,
                            `Pre-selected by ${
                              NODE_SIZE_FLAVORS[form.nodeSizeFlavor].label
                            } flavor`,
                          )}
                        </div>
                        <div>
                          <TextField
                            fullWidth
                            select
                            label="User Pool Priority"
                            value={form.nodePriority}
                            onChange={onChange('nodePriority')}
                            variant="outlined"
                            size="small"
                            margin="dense"
                            className={classes.compactField}
                            helperText={
                              isSpotAllowed(form.env)
                                ? undefined
                                : 'Spot is not allowed for prd/ppd'
                            }
                          >
                            <MenuItem value="Regular">Regular</MenuItem>
                            <MenuItem
                              value="Spot"
                              disabled={!isSpotAllowed(form.env)}
                            >
                              Spot
                            </MenuItem>
                          </TextField>
                        </div>
                        <div>
                          <TextField
                            fullWidth
                            label="User Pool Min Nodes"
                            value={form.userMinNodes}
                            onChange={onChange('userMinNodes')}
                            error={!!errors.userPool}
                            variant="outlined"
                            size="small"
                            margin="dense"
                            className={classes.compactField}
                          />
                        </div>
                        <div>
                          <TextField
                            fullWidth
                            label="User Pool Max Nodes"
                            value={form.userMaxNodes}
                            onChange={onChange('userMaxNodes')}
                            error={!!errors.userPool}
                            helperText={errors.userPool}
                            variant="outlined"
                            size="small"
                            margin="dense"
                            className={classes.compactField}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 2: Access & Jumpbox */}
              {configTab === 2 && (
                <div className={classes.configTabPanel}>
                  <Typography
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: '#111827',
                      marginBottom: 6,
                    }}
                  >
                    Cluster Administrators (Tailscale Jumpbox Access) *
                  </Typography>
                  <Typography
                    variant="caption"
                    style={{
                      color: '#6B7280',
                      display: 'block',
                      marginBottom: 12,
                    }}
                  >
                    GitHub usernames added here will be granted direct Tailscale
                    jumpbox access to the private Kubernetes API endpoint upon
                    cluster provisioning.
                  </Typography>

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      marginBottom: 12,
                    }}
                  >
                    <TextField
                      fullWidth
                      variant="outlined"
                      size="small"
                      placeholder="Enter GitHub username (e.g. jubermohamad)"
                      value={adminInput}
                      onChange={e => setAdminInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addAdmin();
                        }
                      }}
                      error={!!errors.clusterAdministrators}
                      helperText={errors.clusterAdministrators}
                      className={classes.compactField}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      className={classes.primaryBtn}
                      startIcon={<AddCircleIcon />}
                      onClick={addAdmin}
                      disabled={!adminInput.trim()}
                      style={{ height: 36, whiteSpace: 'nowrap' }}
                    >
                      Add Admin
                    </Button>
                  </div>

                  <div className={classes.adminPanel}>
                    <Typography className={classes.adminPanelTitle}>
                      Configured Administrators ({clusterAdmins.length})
                    </Typography>
                    <div className={classes.adminChipWrap}>
                      {clusterAdmins.length === 0 ? (
                        <Typography
                          variant="caption"
                          style={{ color: '#9CA3AF' }}
                        >
                          No cluster administrators added yet. At least one is
                          required.
                        </Typography>
                      ) : (
                        clusterAdmins.map(admin => (
                          <Chip
                            key={admin}
                            label={admin}
                            size="small"
                            onDelete={() => removeAdmin(admin)}
                            style={{
                              backgroundColor: '#EDE9FE',
                              color: '#5B21A8',
                              fontWeight: 700,
                            }}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live Architecture & Spec Inspector */}
          <div className={classes.inspectorPanel}>
            <div>
              <Typography
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: '#6B7280',
                  marginBottom: 5,
                }}
              >
                Computed Cluster Name
              </Typography>
              <div className={classes.clusterNameBox}>
                <span>
                  {nameReady
                    ? clusterName
                    : 'aks-scp-<env>-<region>-<tenancy>-<tenant>'}
                </span>
                {nameReady && (
                  <Tooltip
                    title={copiedClusterName ? 'Copied!' : 'Copy cluster name'}
                  >
                    <IconButton
                      size="small"
                      onClick={copyClusterName}
                      style={{ padding: 2 }}
                    >
                      {copiedClusterName ? (
                        <CheckIcon style={{ fontSize: 15, color: '#059669' }} />
                      ) : (
                        <ContentCopyIcon
                          style={{ fontSize: 15, color: '#64748B' }}
                        />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
              </div>
              {nameReady && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                    columnGap: 8,
                    rowGap: 3,
                    marginTop: 6,
                    fontSize: '0.68rem',
                    lineHeight: 1.3,
                  }}
                >
                  {[
                    ['Resource group', names.resourceGroupName],
                    ['VNet', names.vnetName],
                    ['Node RG', names.nodeResourceGroupName],
                    [
                      'Jumpbox',
                      submittedNames?.jumpboxName ?? names.jumpboxName,
                    ],
                  ].map(([k, v]) => (
                    <Fragment key={k}>
                      <span style={{ color: '#64748B', fontWeight: 600 }}>
                        {k}
                      </span>
                      <span
                        style={{
                          color: '#0F172A',
                          fontFamily: 'monospace',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {v}
                      </span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>

            {/* Architecture Specs */}
            <div
              style={{
                display: 'grid',
                gap: 7,
                borderTop: '1px solid #E2E8F0',
                paddingTop: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    color: '#64748B',
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    flexShrink: 0,
                  }}
                >
                  Architecture
                </span>
                <TextField
                  select
                  size="small"
                  variant="outlined"
                  value={form.clusterProfile}
                  onChange={event => selectProfile(event.target.value)}
                  className={classes.compactField}
                  aria-label="Cluster architecture profile"
                  SelectProps={{
                    renderValue: value =>
                      PROFILE_META[String(value)]?.label ?? String(value),
                  }}
                  style={{ width: '68%' }}
                >
                  {PROFILE_ORDER.map(profileId => (
                    <MenuItem
                      key={profileId}
                      value={profileId}
                      disabled={isUnsupportedProfile(profileId)}
                    >
                      {PROFILE_META[profileId].label}
                      {isUnsupportedProfile(profileId)
                        ? ` — ${UNSUPPORTED_PROFILE_TEXT}`
                        : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    color: '#64748B',
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    flexShrink: 0,
                  }}
                >
                  Cluster Size
                </span>
                <TextField
                  select
                  size="small"
                  variant="outlined"
                  value={form.nodeSizeFlavor}
                  onChange={event =>
                    selectNodeSizeFlavor(event.target.value as NodeSizeFlavor)
                  }
                  className={classes.compactField}
                  aria-label="AKS cluster size"
                  SelectProps={{
                    renderValue: value => {
                      const size =
                        NODE_SIZE_FLAVORS[String(value) as NodeSizeFlavor];
                      return size
                        ? `${size.label} (${size.nodeSize})`
                        : String(value);
                    },
                  }}
                  style={{ width: '68%' }}
                >
                  {NODE_SIZE_FLAVOR_ORDER.map(flavor => (
                    <MenuItem key={flavor} value={flavor}>
                      {NODE_SIZE_FLAVORS[flavor].label} (
                      {NODE_SIZE_FLAVORS[flavor].nodeSize})
                    </MenuItem>
                  ))}
                </TextField>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.72rem',
                  lineHeight: 1.3,
                }}
              >
                <span style={{ color: '#64748B', fontWeight: 600 }}>
                  Region
                </span>
                <span style={{ color: '#0F172A', fontWeight: 700 }}>
                  {regionText(form.location)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.72rem',
                  lineHeight: 1.3,
                }}
              >
                <span style={{ color: '#64748B', fontWeight: 600 }}>
                  Governance
                </span>
                <span style={{ color: '#5B21A8', fontWeight: 700 }}>
                  {meta?.approvals.length}-step approval
                </span>
              </div>
            </div>

            {/* Estimated Cost */}
            <div
              style={{
                background: 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)',
                border: '1px solid #E9D5FF',
                borderRadius: 8,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#6B21A8',
                  }}
                >
                  Est. Compute Cost
                </span>
                <div
                  style={{
                    fontSize: '0.9rem',
                    fontWeight: 800,
                    color: '#581C87',
                  }}
                >
                  {NOT_ESTIMATED}
                </div>
              </div>
              <Chip
                size="small"
                label="Preview"
                style={{
                  backgroundColor: '#EDE9FE',
                  color: '#6B21A8',
                  fontWeight: 700,
                  fontSize: '0.7rem',
                }}
              />
            </div>

            {/* Readiness Checklist */}
            <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 8 }}>
              <Typography
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: '#64748B',
                  marginBottom: 5,
                }}
              >
                Readiness Checklist
              </Typography>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  columnGap: 8,
                  rowGap: 5,
                  fontSize: '0.67rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: form.customer.trim() ? '#059669' : '#94A3B8',
                  }}
                >
                  {form.customer.trim() ? (
                    <CheckCircleIcon style={{ fontSize: 12 }} />
                  ) : (
                    '○'
                  )}{' '}
                  Customer specified
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: subnets ? '#059669' : '#94A3B8',
                  }}
                >
                  {subnets ? <CheckCircleIcon style={{ fontSize: 12 }} /> : '○'}{' '}
                  Address space set
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: !liveErrors.location ? '#059669' : '#94A3B8',
                  }}
                >
                  {!liveErrors.location ? (
                    <CheckCircleIcon style={{ fontSize: 12 }} />
                  ) : (
                    '○'
                  )}{' '}
                  Region configured
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: clusterAdmins.length > 0 ? '#059669' : '#94A3B8',
                  }}
                >
                  {clusterAdmins.length > 0 ? (
                    <CheckCircleIcon style={{ fontSize: 12 }} />
                  ) : (
                    '○'
                  )}{' '}
                  Jumpbox admin added
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detail Modals for Profile and Flavor */}
        <Dialog
          open={Boolean(profileDialog)}
          onClose={() => setProfileDialog(null)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="profile-dialog-title"
        >
          {profileDialog && (
            <>
              <DialogTitle id="profile-dialog-title">
                {PROFILE_META[profileDialog].label}
              </DialogTitle>
              <DialogContent dividers>
                <Typography variant="body1" style={{ marginBottom: 20 }}>
                  {PROFILE_META[profileDialog].tagline}
                </Typography>
                <Typography variant="subtitle2" style={{ fontWeight: 800 }}>
                  Deployment pattern
                </Typography>
                <Typography variant="body2" color="textSecondary" gutterBottom>
                  {PROFILE_META[profileDialog].multiRegion
                    ? `${UNSUPPORTED_PROFILE_TEXT}.`
                    : 'Single-region deployment in the selected Azure region.'}
                </Typography>
                <Typography
                  variant="subtitle2"
                  style={{ fontWeight: 800, marginTop: 16 }}
                >
                  Approval path
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {PROFILE_META[profileDialog].approvals.join(' → ')}
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  style={{ display: 'block', marginTop: 20 }}
                >
                  Selecting this profile updates the configuration defaults. You
                  can review applicable settings in the form.
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setProfileDialog(null)}>Cancel</Button>
                <Button
                  variant="contained"
                  disabled={isUnsupportedProfile(profileDialog)}
                  onClick={() => selectProfile(profileDialog)}
                >
                  Use {PROFILE_META[profileDialog].label}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>

        <Dialog
          open={Boolean(flavorDialog)}
          onClose={() => setFlavorDialog(null)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="flavor-dialog-title"
        >
          {flavorDialog && (
            <>
              <DialogTitle id="flavor-dialog-title">
                {NODE_SIZE_FLAVORS[flavorDialog].label} AKS Cluster
              </DialogTitle>
              <DialogContent dividers>
                <Typography variant="body1" style={{ marginBottom: 20 }}>
                  {NODE_SIZE_FLAVORS[flavorDialog].description}
                </Typography>
                <Typography variant="subtitle2" style={{ fontWeight: 800 }}>
                  Azure VM size
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  System pool:{' '}
                  {formatPool(AKS_FLAVOR_POOLS[flavorDialog].systemPool)}
                  <br />
                  User pool:{' '}
                  {formatPool(AKS_FLAVOR_POOLS[flavorDialog].userPool)}
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  style={{ display: 'block', marginTop: 20 }}
                >
                  These pools are written to the cluster values file. User pool
                  node counts can be adjusted in the configuration.
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setFlavorDialog(null)}>Cancel</Button>
                <Button
                  variant="contained"
                  onClick={() => selectNodeSizeFlavor(flavorDialog)}
                >
                  Use {NODE_SIZE_FLAVORS[flavorDialog].label}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </div>
    );
  };

  const renderReview = () => {
    const reviewRows: Array<[string, string]> = [
      ['Cluster Profile', meta?.label ?? form.clusterProfile],
      ['Cluster Name', names.clusterName],
      ['Resource Group', `${names.resourceGroupName} (created by Terraform)`],
      ['VNet', names.vnetName],
      ['Node Resource Group', names.nodeResourceGroupName],
      ['Jumpbox', names.jumpboxName],
      ['Environment', aksRequest.env],
      ['Region', regionText(aksRequest.location)],
      [
        'Tenancy / Tenant',
        `${TENANCY_LABELS[aksRequest.tenancy] ?? aksRequest.tenancy} / ${
          aksRequest.tenantId
        }`,
      ],
      ['AKS Version', aksRequest.kubernetesVersion],
      ['Address Space', aksRequest.addressSpace],
      [
        'Subscription',
        planPreview?.subscriptionId
          ? `Azure Sensa Engineering (${planPreview.subscriptionId})`
          : AKS_SUBSCRIPTION_LABEL,
      ],
      ['Customer / BU', `${aksRequest.customer} / ${aksRequest.businessUnit}`],
      ['Owner', aksRequest.owner],
      ['Cost Centre', aksRequest.costCentre],
      ['Change Ticket', aksRequest.changeTicket],
      ['System Pool', formatPool(aksRequest.systemPool)],
      [
        'User Pool',
        aksRequest.userPool ? formatPool(aksRequest.userPool) : 'None',
      ],
      ['Est. Monthly Cost', NOT_ESTIMATED],
    ];
    return (
      <div>
        <Typography className={classes.panelTitle}>Review</Typography>
        <Typography className={classes.panelSub}>
          Review the validated configuration and the values file CloudHub will
          commit. Submit opens a CloudHub Infrastructure Request and starts the
          approval workflow — Git operations run against main only after
          approval.
        </Typography>

        <div className={classes.reviewGrid}>
          {reviewRows.map(([k, v]) => (
            <div key={k} className={classes.reviewItem}>
              <span className={classes.reviewKey}>{k}</span>
              <span className={classes.reviewVal}>{v}</span>
            </div>
          ))}
        </div>

        {subnets && (
          <div
            style={{
              marginTop: 8,
              fontSize: '0.8125rem',
              color: '#374151',
            }}
          >
            Derived subnets — AKS {subnets.aks} · Secondary {subnets.secondary}{' '}
            · NetApp {subnets.netapp} · VPN gateway {subnets.vpnGateway}
          </div>
        )}

        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            background: '#F9FAFB',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            fontSize: '0.8125rem',
            color: '#374151',
          }}
        >
          The Terraform plan is produced by Terraform Cloud after the
          infrastructure PR merges. CloudHub does not estimate resource counts
          or cost.
        </div>

        {gateReport && renderGates(gateReport)}

        {planErrors.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 8,
            }}
          >
            <Typography
              style={{
                fontWeight: 700,
                color: '#B91C1C',
                fontSize: '0.85rem',
                marginBottom: 4,
              }}
            >
              Policy Validation Errors
            </Typography>
            {planErrors.map((e, i) => (
              <div
                key={i}
                style={{
                  fontSize: '0.8125rem',
                  color: '#7F1D1D',
                  paddingLeft: 8,
                  lineHeight: '1.6',
                }}
              >
                ✗ {e}
              </div>
            ))}
            {planStatus === 'failed' && (
              <div
                style={{
                  fontSize: '0.78rem',
                  color: '#7F1D1D',
                  marginTop: 6,
                }}
              >
                Use “Configure” to go back and correct the highlighted fields.
              </div>
            )}
          </div>
        )}

        {approvalError && !requestId && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 8,
              fontSize: '0.8125rem',
              color: '#991B1B',
              fontWeight: 600,
            }}
          >
            {approvalError}
          </div>
        )}

        {planWarnings.length > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 14px',
              background: '#FFFBEB',
              border: '1px solid #FCD34D',
              borderRadius: 8,
            }}
          >
            <Typography
              style={{
                fontWeight: 700,
                color: '#92400E',
                fontSize: '0.85rem',
                marginBottom: 4,
              }}
            >
              Warnings
            </Typography>
            {planWarnings.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: '0.8125rem',
                  color: '#78350F',
                  paddingLeft: 8,
                  lineHeight: '1.6',
                }}
              >
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        <Typography className={classes.sectionLabel}>
          Values File Preview{' '}
          <span style={{ fontWeight: 400, textTransform: 'none' }}>
            ({names.valuesFilePath}
            {generatedYaml ? '' : ' — local preview'})
          </span>
        </Typography>
        {reviewLoading ? (
          <Typography
            style={{
              margin: '12px 0',
              color: '#6B7280',
              fontWeight: 600,
              fontStyle: 'italic',
            }}
          >
            Validating the request and rendering the values file…
          </Typography>
        ) : (
          <pre className={classes.yamlBlock}>
            {generatedYaml ?? localValuesFile}
          </pre>
        )}

        {planErrors.length === 0 && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              borderRadius: 8,
              fontSize: '0.8125rem',
              color: '#374151',
            }}
          >
            Review only validates the request (no branch/commit/PR). Submit
            opens a CloudHub Infrastructure Request and starts the CloudHub
            approval workflow. After approval, CloudHub creates a feature branch
            from main, writes the values file, updates workspaces, pushes, and
            opens a PR to main.
          </div>
        )}

        <div className={classes.wizardActions}>
          <Button
            variant="outlined"
            className={classes.secondaryBtn}
            startIcon={<RefreshIcon />}
            onClick={() => setPhase('configure')}
          >
            Update
          </Button>
          <Button
            variant="outlined"
            className={classes.secondaryBtn}
            startIcon={<CancelIcon />}
            onClick={resetWizard}
          >
            Cancel
          </Button>
          <span className={classes.spacer} />
          <Button
            variant="contained"
            className={classes.submitBtn}
            startIcon={<AddCircleIcon />}
            disabled={submitDisabled}
            onClick={goSubmit}
          >
            {submitLabel('Submit')}
          </Button>
        </div>
      </div>
    );
  };

  const createInfrastructurePr = () => {
    if (!requestId || infraPrBusy) return;
    setInfraPrBusy(true);
    setApprovalError(null);
    setApprovalGates(null);
    backendFetch('provisioning', `/request/${requestId}/infrastructure-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(async r => {
        const data = await readJsonResponse<{
          error?: string;
          gates?: SubmissionGateReport;
          branchName?: string;
          commitSha?: string;
          prUrl?: string;
          prNumber?: number;
          infraPrOperation?: { state?: string; error?: string } | null;
        }>(r);
        if (r.status === 412) {
          setApprovalGates(parseGateReport(data.gates));
          setApprovalError(data.error ?? GATES_BLOCKING_MESSAGE);
          return;
        }
        if (!r.ok) {
          if (data.infraPrOperation?.state === 'failed') {
            setInfraPrFailure(data.infraPrOperation.error ?? null);
          }
          setApprovalError(
            data.error ??
              `Creating the infrastructure PR failed (HTTP ${r.status})`,
          );
          return;
        }
        if (data.branchName) setBranchName(data.branchName);
        if (data.commitSha) setCommitSha(data.commitSha);
        if (data.prUrl) setPrUrl(data.prUrl);
        if (data.prNumber) setPrNumber(data.prNumber);
        setInfraPrFailure(null);
        setSubmitLogs(prev => [
          ...prev,
          `[${ts()}] Infrastructure PR #${
            data.prNumber ?? '?'
          } created in scp-infra-as-code: ${data.prUrl ?? ''}`,
        ]);
        setPhase('pull_request');
      })
      .catch(err => setApprovalError(err?.message ?? String(err)))
      .finally(() => setInfraPrBusy(false));
  };

  const renderInfrastructurePrAction = () => {
    if (!requestId) return null;
    if (!tailscaleMerged) {
      return (
        <div
          style={{
            padding: '10px 14px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 8,
            margin: '16px 0',
            fontSize: '0.8125rem',
            color: '#92400E',
            fontWeight: 600,
          }}
        >
          ⏳ Waiting for the Tailscale access PR to be reviewed and merged. The
          infrastructure PR can be created after that.
        </div>
      );
    }
    return (
      <div
        style={{
          padding: '14px 16px',
          background: '#EFF6FF',
          border: '1px solid #BFDBFE',
          borderRadius: 10,
          margin: '16px 0',
        }}
      >
        <Typography
          style={{ fontWeight: 800, fontSize: '0.875rem', color: '#1E40AF' }}
        >
          Tailscale access merged — create the infrastructure PR
        </Typography>
        <Typography
          style={{
            fontSize: '0.8125rem',
            color: '#374151',
            margin: '6px 0 10px',
          }}
        >
          This opens a branch and PR in SymphonySensa/scp-infra-as-code with the
          approved values file and workspace entry. The preflight checks run
          again first. CloudHub never merges the PR: it needs the Terraform
          Quality Gate, a CODEOWNERS review and a maintainer merge.
        </Typography>
        {infraPrFailure && (
          <Typography
            style={{
              fontSize: '0.8125rem',
              color: '#991B1B',
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            Last attempt failed: {infraPrFailure}
          </Typography>
        )}
        <Button
          variant="contained"
          disabled={!infraPrAvailable || infraPrBusy}
          onClick={createInfrastructurePr}
          style={{ textTransform: 'none', fontWeight: 700 }}
        >
          {infraPrBusy && 'Creating infrastructure PR…'}
          {!infraPrBusy &&
            (infraPrFailure
              ? 'Retry creating infrastructure PR'
              : 'Create infrastructure PR')}
        </Button>
        {!infraPrAvailable && (
          <Typography
            style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 8 }}
          >
            Not available for this request in its current state.
          </Typography>
        )}
      </div>
    );
  };

  const renderApproval = () => {
    const nextPendingIdx = approvalChain.findIndex(s => s.status === 'pending');
    const rejected = approvalChain.some(s => s.status === 'rejected');
    const allApprovedLocal =
      approvalChain.length > 0 &&
      approvalChain.every(s => s.status === 'approved');
    return (
      <div>
        <Typography className={classes.panelTitle}>
          Platform Approval
        </Typography>
        <Typography className={classes.panelSub}>
          Platform Team approves the request. CloudHub then opens the Tailscale
          access PR. Once that PR is merged, the requester or an approver
          creates the infrastructure PR explicitly; nothing is created
          automatically.
        </Typography>
        {requestId ? (
          <>
            <Chip
              label={`Request ID: ${requestId}`}
              style={{
                background: '#EDE9FE',
                color: '#5B21B6',
                fontWeight: 700,
                marginBottom: 16,
              }}
            />
            {renderResumeLink()}
          </>
        ) : (
          <div
            style={{
              padding: '10px 14px',
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.8125rem',
              color: '#1E40AF',
            }}
          >
            ⏳ Creating Infrastructure Request…
          </div>
        )}

        {approvalError && (
          <div
            style={{
              padding: '10px 14px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: '0.8125rem',
              color: '#991B1B',
              fontWeight: 600,
            }}
          >
            {approvalError}
          </div>
        )}

        {approvalGates && (
          <div style={{ marginBottom: 16 }}>{renderGates(approvalGates)}</div>
        )}

        {/* CloudHub approval chain */}
        {approvalChain.map((stage, i) => {
          const approved = stage.status === 'approved';
          const isRejected = stage.status === 'rejected';
          const isNext = i === nextPendingIdx && !rejected;
          return (
            <div key={stage.role} className={classes.approvalRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  className={classes.stepDot}
                  style={{
                    background: getApprovalDotBg(approved, isRejected),
                    color: getApprovalDotColor(approved, isRejected),
                    border: `2px solid ${getApprovalDotBorder(
                      approved,
                      isRejected,
                    )}`,
                  }}
                >
                  {getApprovalDotLabel(approved, isRejected, i)}
                </span>
                <span className={classes.approvalName}>{stage.role}</span>
                {approved && stage.approver && (
                  <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                    · {stage.approver}
                  </span>
                )}
              </div>
              {(() => {
                if (approved) {
                  return (
                    <Chip
                      size="small"
                      icon={<CheckCircleIcon style={{ color: '#059669' }} />}
                      label="Approved"
                      style={{
                        background: '#DCFCE7',
                        color: '#166534',
                        fontWeight: 700,
                      }}
                    />
                  );
                }
                if (isRejected) {
                  return (
                    <Chip
                      size="small"
                      label="Rejected"
                      style={{
                        background: '#FEE2E2',
                        color: '#991B1B',
                        fontWeight: 700,
                      }}
                    />
                  );
                }
                if (isNext) {
                  return (
                    <Button
                      size="small"
                      variant="contained"
                      className={classes.submitBtn}
                      startIcon={<CheckCircleIcon />}
                      disabled={approvalBusy || !requestId}
                      onClick={() => approveStage(stage.role)}
                    >
                      {approvalBusy ? 'Approving…' : 'Approve'}
                    </Button>
                  );
                }
                return (
                  <Chip
                    size="small"
                    label="Pending"
                    style={{
                      background: '#FEF3C7',
                      color: '#92400E',
                      fontWeight: 700,
                    }}
                  />
                );
              })()}
            </div>
          );
        })}

        {/* Git branch preparation spinner — shown after all approvals while backend works */}
        {(gitBranchBusy || (allApprovedLocal && !approvalError)) &&
          !rejected && (
            <div
              style={{
                padding: '10px 14px',
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: 8,
                marginTop: 12,
                fontSize: '0.8125rem',
                color: '#1E40AF',
                fontWeight: 600,
              }}
            >
              ✅ Approved — the Tailscale access PR is opened next. Nothing is
              created in scp-infra-as-code until the infrastructure PR is
              requested below.
            </div>
          )}

        {rejected && (
          <div
            style={{
              padding: '12px 16px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 10,
              marginTop: 16,
              fontWeight: 700,
              color: '#991B1B',
              fontSize: '0.875rem',
            }}
          >
            ✕ Request rejected. No Git operations were performed.
          </div>
        )}

        <div className={classes.wizardActions}>
          <Button
            variant="outlined"
            className={classes.secondaryBtn}
            startIcon={<CancelIcon />}
            onClick={resetWizard}
          >
            {rejected ? 'Start Over' : 'Cancel'}
          </Button>
          {allApprovedLocal && !rejected && renderInfrastructurePrAction()}
          {!rejected && nextPendingIdx >= 0 && requestId && (
            <Button
              variant="outlined"
              className={classes.secondaryBtn}
              disabled={approvalBusy}
              onClick={rejectRequest}
              style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}
            >
              Reject Request
            </Button>
          )}
        </div>
      </div>
    );
  };
  const renderPullRequest = () => {
    // The infrastructure PR lives in scp-infra-as-code; prefer the PR's own repo.
    const repoSlug =
      /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(prUrl ?? '')?.[1] ??
      'SymphonySensa/scp-infra-as-code';
    const repoUrl = `https://github.com/${repoSlug}`;
    const hasBranch = Boolean(branchName);
    const hasPr = Boolean(prUrl && prNumber);
    const createPR = () => {
      if (!requestId || prCreateBusy) return;
      setPrCreateBusy(true);
      setPrCreateError(null);
      backendFetch('provisioning', `/request/${requestId}/create-pr`, {
        method: 'POST',
      })
        .then(async r => {
          const data = (await r.json()) as {
            prUrl?: string;
            prNumber?: number;
            branchName?: string;
            error?: string;
          };
          if (!r.ok)
            throw new Error(
              data.error || `Create PR failed (HTTP ${r.status})`,
            );
          if (data.prUrl) setPrUrl(data.prUrl);
          if (data.prNumber) setPrNumber(data.prNumber);
          if (data.branchName && !branchName) setBranchName(data.branchName);
        })
        .catch(err => {
          setPrCreateError(err?.message ?? String(err));
        })
        .finally(() => {
          setPrCreateBusy(false);
        });
    };

    return (
      <div>
        <Typography className={classes.panelTitle}>Pull Request</Typography>
        {renderResumeLink()}
        <Typography className={classes.panelSub}>
          {hasPr
            ? 'The infrastructure PR needs the Terraform Quality Gate to pass, an approving CODEOWNERS review and a maintainer merge. After the merge, workspacemanager creates the Terraform Cloud workspace and an operator confirms the apply in Terraform Cloud.'
            : 'The feature branch is ready. Review it, then create the Pull Request when you are satisfied.'}
        </Typography>

        {/* Git Preparation Complete panel */}
        {hasBranch && (
          <div
            style={{
              padding: '14px 16px',
              background: '#F0FDF4',
              border: '1px solid #86EFAC',
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            <Typography
              style={{
                fontWeight: 800,
                fontSize: '0.875rem',
                color: '#166534',
                marginBottom: 10,
              }}
            >
              ✅ Git Preparation Complete
            </Typography>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '6px 12px',
                fontSize: '0.8125rem',
              }}
            >
              <span style={{ color: '#6B7280', fontWeight: 600 }}>
                Repository
              </span>
              <span style={{ color: '#111827', fontWeight: 700 }}>
                {repoSlug}
              </span>
              <span style={{ color: '#6B7280', fontWeight: 600 }}>
                Feature Branch
              </span>
              <span
                style={{
                  color: '#111827',
                  fontFamily: 'monospace',
                  fontSize: '0.78rem',
                }}
              >
                {branchName}
              </span>
              {commitSha && (
                <>
                  <span style={{ color: '#6B7280', fontWeight: 600 }}>
                    Commit
                  </span>
                  <span
                    style={{
                      color: '#111827',
                      fontFamily: 'monospace',
                      fontSize: '0.78rem',
                    }}
                  >
                    {commitSha}
                  </span>
                </>
              )}
              <span style={{ color: '#6B7280', fontWeight: 600 }}>Status</span>
              <span
                style={{
                  color: hasPr ? '#1D4ED8' : '#059669',
                  fontWeight: 700,
                }}
              >
                {hasPr ? `PR #${prNumber} opened` : 'Ready for Pull Request'}
              </span>
            </div>
          </div>
        )}

        {/* PR creation error */}
        {prCreateError && (
          <div
            style={{
              padding: '10px 14px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: '0.8125rem',
              color: '#991B1B',
              fontWeight: 600,
            }}
          >
            {prCreateError}
          </div>
        )}

        {/* Actions before PR is created */}
        {!hasPr && hasBranch && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <a
              href={`${repoUrl}/tree/${encodeURIComponent(branchName ?? '')}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#374151',
                color: '#FFFFFF',
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: '0.8125rem',
                textDecoration: 'none',
              }}
            >
              <VisibilityIcon style={{ fontSize: '0.9rem' }} /> View Feature
              Branch
            </a>
            <Button
              variant="contained"
              className={classes.submitBtn}
              startIcon={prCreateBusy ? undefined : <AddCircleIcon />}
              disabled={prCreateBusy}
              onClick={createPR}
            >
              {prCreateBusy ? 'Creating Pull Request…' : 'Create Pull Request'}
            </Button>
          </div>
        )}

        {/* After PR created */}
        {hasPr && (
          <>
            <div
              style={{
                padding: '14px 16px',
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: '0.875rem',
                  color: '#1E40AF',
                  marginBottom: 6,
                }}
              >
                Pull Request #{prNumber}
              </div>
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: '#374151',
                  marginBottom: 10,
                }}
              >
                Review the PR checks and Quality Gate, get GitHub approval, and
                merge into main. CloudHub observes the PR read-only and moves to{' '}
                <strong>Provision &amp; Configure</strong> once it observes the
                merge.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={prUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#1D4ED8',
                    color: '#FFFFFF',
                    padding: '6px 14px',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: '0.8125rem',
                    textDecoration: 'none',
                  }}
                >
                  <VisibilityIcon style={{ fontSize: '1rem' }} /> Open Pull
                  Request
                </a>
                <Button
                  variant="outlined"
                  className={classes.secondaryBtn}
                  startIcon={<RefreshIcon />}
                  disabled={execBusy}
                  onClick={refreshExecutionNow}
                >
                  Refresh Status
                </Button>
              </div>
            </div>

            {prMerged && (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#F0FDF4',
                  border: '1px solid #86EFAC',
                  borderRadius: 10,
                  marginBottom: 14,
                  fontWeight: 700,
                  color: '#166534',
                  fontSize: '0.875rem',
                }}
              >
                ✅ PR merged — transitioning to Provision &amp; Configure…
              </div>
            )}

            {!prMerged && (
              <div
                style={{
                  padding: '10px 14px',
                  background: '#FFFBEB',
                  border: '1px solid #FCD34D',
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: '0.8125rem',
                  color: '#92400E',
                  fontWeight: 600,
                }}
              >
                ⏳ Waiting for GitHub approval and merge.
              </div>
            )}

            {renderExecutionPanel()}
            {renderEventsTimeline()}
          </>
        )}

        <div className={classes.wizardActions}>
          <Button
            variant="outlined"
            className={classes.secondaryBtn}
            startIcon={<CancelIcon />}
            onClick={resetWizard}
          >
            Cancel
          </Button>
          {prMerged && (
            <Button
              variant="contained"
              className={classes.submitBtn}
              startIcon={<CheckCircleIcon />}
              onClick={handleDeploy}
            >
              Monitor Provision
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderProvision = () => {
    return (
      <div>
        <Typography className={classes.panelTitle}>
          {runState === 'completed' ? 'Cluster Ready' : 'Provisioning'}
        </Typography>
        {renderResumeLink()}
        <Typography className={classes.panelSub}>
          {getProvisionStatusMessage(runState, overallPct)}
        </Typography>

        {runState === 'failed' && (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #FECACA',
              background: '#FEF2F2',
              color: '#991B1B',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}
          >
            Deployment failed. If backend logs show &quot;Resource not
            accessible by personal access token&quot;, update the GitHub token
            to include workflow dispatch permissions (`repo` + `workflow` /
            Actions write), then retry Deploy.
          </div>
        )}

        {/* Read-only Terraform Cloud execution tracking */}
        {!taskId && (
          <>
            {renderExecutionPanel()}
            {renderReadinessStatus()}
            {renderEventsTimeline()}
          </>
        )}

        {/* Legacy CloudHub-tracked task (GitHub Actions apply) */}
        {taskId && (
          <>
            {/* Progress stages */}
            <div className={classes.stagesCard}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  marginBottom: 4,
                }}
              >
                <Typography className={classes.stagesHead}>
                  Provisioning Stages
                </Typography>
                <Typography className={classes.stagesMeta}>
                  {overallPct}% complete
                </Typography>
              </div>
              <div className={classes.stagesBody}>
                {provisionSteps.map((step, i) => {
                  const status: StepStatus = getProvisionStepStatus(
                    runState,
                    i,
                    currentIdx,
                  ) as StepStatus;
                  const isFirst = i === 0;
                  const isLast = i === provisionSteps.length - 1;
                  const leftConnectorDone =
                    !isFirst && (runState === 'completed' || i <= currentIdx);
                  const rightConnectorDone =
                    !isLast && (runState === 'completed' || i < currentIdx);
                  return (
                    <div
                      key={step.id}
                      className={[
                        classes.stageStep,
                        status === 'running' ? classes.stageStepRunning : '',
                        status === 'done' ? classes.stageStepDone : '',
                      ].join(' ')}
                    >
                      <div className={classes.stageIconRow}>
                        <div
                          className={[
                            classes.stageConnector,
                            isFirst ? classes.stageConnectorGhost : '',
                            leftConnectorDone ? classes.stageConnectorDone : '',
                          ].join(' ')}
                        />
                        <StepIcon status={status} label={String(i + 1)} />
                        <div
                          className={[
                            classes.stageConnector,
                            isLast ? classes.stageConnectorGhost : '',
                            rightConnectorDone
                              ? classes.stageConnectorDone
                              : '',
                          ].join(' ')}
                        />
                      </div>
                      <Typography className={classes.stageLabel}>
                        {step.label}
                      </Typography>
                    </div>
                  );
                })}
              </div>
            </div>

            {workflowRunUrl && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <a
                  href={workflowRunUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#1D4ED8',
                    color: '#FFFFFF',
                    padding: '5px 12px',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                  }}
                >
                  <VisibilityIcon style={{ fontSize: '0.9rem' }} /> View GitHub
                  Actions Run
                </a>
              </div>
            )}

            {renderTerminal('GITHUB ACTIONS — TERRAFORM APPLY', provisionLog)}
          </>
        )}

        {/* Tailscale jumpbox access + registry lifecycle */}
        <div
          style={{
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid #E5E7EB',
            background: '#F9FAFB',
          }}
        >
          <Typography
            style={{
              fontSize: '0.8rem',
              fontWeight: 800,
              color: '#111827',
              marginBottom: 8,
            }}
          >
            Access &amp; Connectivity — Tailscale Jumpbox
          </Typography>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <Chip
              size="small"
              label={`Access: ${accessStatus ?? 'Pending'}`}
              style={{
                fontWeight: 700,
                ...getAccessStatusColors(accessStatus),
              }}
            />
            {tailscalePrUrl && (
              <a
                href={tailscalePrUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#1D4ED8',
                  color: '#FFFFFF',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  textDecoration: 'none',
                }}
              >
                <VisibilityIcon style={{ fontSize: '0.85rem' }} /> View
                Tailscale PR
              </a>
            )}
          </div>
          <Typography
            variant="caption"
            style={{ display: 'block', marginTop: 8, color: '#6B7280' }}
          >
            {getTailscaleStatusMessage(accessError, clusterReady, accessStatus)}
          </Typography>
        </div>

        {/* CloudHub cannot cancel Terraform Cloud runs; only legacy tasks. */}
        {runState !== 'completed' && taskId && (
          <div className={classes.wizardActions}>
            <Button
              variant="outlined"
              className={classes.secondaryBtn}
              startIcon={<CancelIcon />}
              onClick={cancelDeployment}
              disabled={cancelDeployBusy || runState === 'cancelled'}
            >
              {getCancelDeploymentLabel(runState, cancelDeployBusy)}
            </Button>
          </div>
        )}

        {/* Platform Registry + Bootstrap status (appear after provision completes) */}
        {runState === 'completed' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginTop: 12,
            }}
          >
            {(() => {
              const colors = getRegistryStatusBoxColors(registryStatus);
              return (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    background: colors.background,
                    border: `1px solid ${colors.border}`,
                    color: colors.color,
                  }}
                >
                  {getRegistryStatusMessage(registryStatus)}
                </div>
              );
            })()}
            {(() => {
              const colors = getBootstrapStatusBoxColors(bootstrapStatus);
              return (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    background: colors.background,
                    border: `1px solid ${colors.border}`,
                    color: colors.color,
                  }}
                >
                  {getBootstrapStatusMessage(bootstrapStatus)}
                </div>
              );
            })()}
          </div>
        )}

        {runState === 'completed' && (
          <div className={classes.readyCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircleIcon />
              <Typography style={{ fontSize: '1.375rem', fontWeight: 800 }}>
                Cluster Ready
              </Typography>
            </div>
            <div className={classes.readyGrid}>
              <div>
                <div className={classes.readyKey}>Cluster Name</div>
                <div className={classes.readyVal}>{clusterName}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Environment</div>
                <div className={classes.readyVal}>{aksRequest.env}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Region</div>
                <div className={classes.readyVal}>
                  {regionText(aksRequest.location)}
                </div>
              </div>
              <div>
                <div className={classes.readyKey}>AKS Version</div>
                <div className={classes.readyVal}>{form.kubernetesVersion}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Node Pools</div>
                <div className={classes.readyVal}>
                  {aksRequest.userPool
                    ? `system + user (${nodeSizeText})`
                    : `system (${nodeSizeText})`}
                </div>
              </div>
              <div>
                <div className={classes.readyKey}>API Endpoint</div>
                <div className={classes.readyVal}>{apiEndpoint}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Creation Date</div>
                <div className={classes.readyVal}>
                  {new Date().toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className={classes.readyKey}>Owner</div>
                <div className={classes.readyVal}>{form.owner || '—'}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Cost Centre</div>
                <div className={classes.readyVal}>
                  {aksRequest.costCentre || '—'}
                </div>
              </div>
              <div>
                <div className={classes.readyKey}>Monthly Cost Estimate</div>
                <div className={classes.readyVal}>{NOT_ESTIMATED}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Request ID</div>
                <div className={classes.readyVal}>{requestId}</div>
              </div>
              <div>
                <div className={classes.readyKey}>Jumpbox Access</div>
                <div className={classes.readyVal}>
                  {accessStatus === 'Applied'
                    ? 'Granted (Tailscale)'
                    : accessStatus ?? '—'}
                </div>
              </div>
              <div>
                <div className={classes.readyKey}>Cluster Administrators</div>
                <div className={classes.readyVal}>
                  {clusterAdmins.length ? clusterAdmins.join(', ') : '—'}
                </div>
              </div>
            </div>
            <div className={classes.wizardActions}>
              <Button
                variant="contained"
                style={{
                  background: '#FFFFFF',
                  color: '#065F46',
                  fontWeight: 700,
                  textTransform: 'none',
                  borderRadius: 6,
                }}
                startIcon={<ReplayIcon />}
                onClick={resetWizard}
              >
                Create Another Cluster
              </Button>
              <Button
                variant="outlined"
                style={{
                  borderColor: 'rgba(255,255,255,0.6)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  textTransform: 'none',
                  borderRadius: 6,
                }}
                onClick={() => navigate('/')}
              >
                Back to Home
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={isTab ? classes.tabRoot : classes.root}>
      {/* Background Page (Landing / Hub View) */}
      <div
        className={`${classes.heroBanner} ${
          isTab ? classes.heroBannerInTab : ''
        }`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StorageIcon style={{ fontSize: '1.5rem' }} />
          <Typography className={classes.heroTitle}>
            Kubernetes Cluster Management (AKS)
          </Typography>
        </div>
        <Typography className={classes.heroSub}>
          Self-service enterprise AKS provisioning via Terraform + GitOps and
          GitHub Actions
        </Typography>
        <span className={classes.heroOwner}>Platform Engineering</span>
      </div>

      {resumeError &&
        renderNotice('error', resumeError, { marginTop: 0, marginBottom: 12 })}

      {/* 1. Cluster Profiles (Main Page - 4 in a row) */}
      <Typography
        className={classes.sectionLabel}
        style={{ marginBottom: 8, fontSize: '0.85rem' }}
      >
        Cluster Profile *
      </Typography>
      <div className={classes.profileGrid}>
        {PROFILE_ORDER.map(id => {
          const pm = PROFILE_META[id];
          const active = form.clusterProfile === id;
          const unsupported = isUnsupportedProfile(id);
          return (
            <div
              key={id}
              className={[
                classes.profileCard,
                active ? classes.profileCardActive : '',
              ].join(' ')}
              onClick={() => selectProfile(id)}
              role="button"
              aria-label={`Select ${pm.label} profile`}
              aria-disabled={unsupported}
              tabIndex={unsupported ? -1 : 0}
              style={
                unsupported
                  ? { opacity: 0.55, cursor: 'not-allowed' }
                  : undefined
              }
              onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  selectProfile(id);
                }
              }}
            >
              <span
                className={classes.profileDot}
                style={{ background: pm.accent }}
              />
              <Typography className={classes.profileLabel}>
                {pm.label}
              </Typography>
              <Typography className={classes.profileTag}>
                {pm.tagline}
              </Typography>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 12,
                }}
              >
                <span className={classes.profileBadge}>
                  {unsupported
                    ? UNSUPPORTED_PROFILE_TEXT
                    : `${pm.approvals.length}-step approval`}
                </span>
                {active && (
                  <Button
                    size="small"
                    variant="text"
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#6B21A8',
                      padding: '2px 6px',
                      minWidth: 0,
                      textTransform: 'none',
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      handleOpenModal();
                    }}
                  >
                    Configure →
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. AKS Cluster Size (Small, Medium, Large - 4 in a row) */}
      <Typography
        className={classes.sectionLabel}
        style={{ marginTop: 16, marginBottom: 8, fontSize: '0.85rem' }}
      >
        AKS Cluster Size *
      </Typography>
      <div className={classes.flavorGrid}>
        {NODE_SIZE_FLAVOR_ORDER.map(flavor => {
          const flavorMeta = NODE_SIZE_FLAVORS[flavor];
          const active = form.nodeSizeFlavor === flavor;
          return (
            <div
              key={flavor}
              className={[
                classes.profileCard,
                active ? classes.profileCardActive : '',
              ].join(' ')}
              onClick={() => selectNodeSizeFlavor(flavor)}
              role="button"
              aria-label={`Select ${flavorMeta.label} flavor`}
              tabIndex={0}
              onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  selectNodeSizeFlavor(flavor);
                }
              }}
            >
              <span
                className={classes.profileDot}
                style={{ background: flavorMeta.accent }}
              />
              <Typography className={classes.profileLabel}>
                {flavorMeta.label}
              </Typography>
              <Typography className={classes.profileTag}>
                {flavorMeta.description}
              </Typography>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 12,
                }}
              >
                <span className={classes.profileBadge}>
                  {flavorMeta.nodeSize}
                </span>
                {active && (
                  <Button
                    size="small"
                    variant="text"
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#6B21A8',
                      padding: '2px 6px',
                      minWidth: 0,
                      textTransform: 'none',
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      handleOpenModal();
                    }}
                  >
                    Configure →
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Action Banner / Launch Modal Card */}
      <div className={classes.mainActionBanner}>
        <div className={classes.mainActionLeft}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Chip
              size="small"
              label={`Profile: ${meta?.label}`}
              style={{
                backgroundColor: '#EDE9FE',
                color: '#5B21A8',
                fontWeight: 700,
              }}
            />
            <Chip
              size="small"
              label={`Compute: ${
                NODE_SIZE_FLAVORS[form.nodeSizeFlavor].label
              } (${nodeSizeText})`}
              style={{
                backgroundColor: '#E0F2FE',
                color: '#0369A1',
                fontWeight: 700,
              }}
            />
            <Chip
              size="small"
              label={`Cost: ${NOT_ESTIMATED}`}
              style={{
                backgroundColor: '#F3F4F6',
                color: '#374151',
                fontWeight: 700,
              }}
            />
          </div>
          <Typography
            style={{ fontSize: '0.825rem', color: '#4B5563', marginTop: 4 }}
          >
            Target Cluster:{' '}
            <code style={{ fontWeight: 700, color: '#111827' }}>
              {nameReady
                ? clusterName
                : 'aks-scp-<env>-<region>-<tenancy>-<tenant>'}
            </code>{' '}
            · Ready to configure environment context, network, and jumpbox
            access.
          </Typography>
        </div>
        <Button
          variant="contained"
          className={classes.hubPrimaryBtn}
          startIcon={<RocketLaunchIcon />}
          onClick={handleOpenModal}
        >
          Configure &amp; Provision Cluster →
        </Button>
      </div>

      {/* ── Redesigned Workflow Modal Dialog ── */}
      <Dialog
        open={modalOpen}
        onClose={(_, reason) => {
          if (reason !== 'backdropClick') {
            handleCloseModal();
          }
        }}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          className: classes.modalPaper,
        }}
      >
        {/* Fixed Header */}
        <div className={classes.modalTitleBar}>
          <div className={classes.modalTitleLeft}>
            <div className={classes.modalIconBadge}>
              <StorageIcon style={{ fontSize: '1.25rem' }} />
            </div>
            <div>
              <Typography className={classes.modalTitleText}>
                Create Kubernetes Cluster (AKS)
              </Typography>
              <Typography className={classes.modalSubtitleText}>
                {meta?.label} · {NODE_SIZE_FLAVORS[form.nodeSizeFlavor].label} (
                {nodeSizeText}) · Step {phaseIndex + 1} of 5:{' '}
                {PHASE_LABELS[phase]}
              </Typography>
            </div>
          </div>
          <div className={classes.modalTitleRight}>
            <Chip
              size="small"
              label={`${meta?.label} · ${
                NODE_SIZE_FLAVORS[form.nodeSizeFlavor].label
              }`}
              style={{
                backgroundColor: '#EDE9FE',
                color: '#6B21A8',
                fontWeight: 700,
              }}
            />
            <IconButton
              size="small"
              onClick={handleCloseModal}
              style={{ color: '#6B7280' }}
            >
              <CloseIcon style={{ fontSize: 20 }} />
            </IconButton>
          </div>
        </div>

        {/* Compact Stepper */}
        {renderStepper()}

        {/* Scrollable Content Body */}
        <DialogContent className={classes.modalContent}>
          {phase === 'configure' && renderConfigure()}
          {phase === 'review' && renderReview()}
          {phase === 'approval' && renderApproval()}
          {phase === 'pull_request' && renderPullRequest()}
          {phase === 'provision' && renderProvision()}
        </DialogContent>

        {/* Fixed Footer Actions */}
        <div className={classes.modalFooter}>
          <Button
            variant="outlined"
            className={classes.secondaryBtn}
            startIcon={<CancelIcon />}
            onClick={() => {
              if (phase === 'configure') {
                handleCloseModal();
              } else {
                resetWizard();
              }
            }}
          >
            {phase === 'configure' ? 'Close' : 'Cancel'}
          </Button>

          {/* Contextual Phase Action Buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {phase === 'configure' && (
              <>
                <Button
                  variant="outlined"
                  className={classes.secondaryBtn}
                  disabled={saveDraftBusy}
                  onClick={saveDraft}
                >
                  {saveDraftBusy ? 'Saving…' : 'Save Draft'}
                </Button>
                {configTab > 0 && (
                  <Button
                    variant="outlined"
                    className={classes.secondaryBtn}
                    onClick={() => setConfigTab(prev => Math.max(0, prev - 1))}
                  >
                    ← Previous
                  </Button>
                )}
                {configTab < 2 ? (
                  <Button
                    variant="contained"
                    className={classes.primaryBtn}
                    onClick={() => setConfigTab(prev => Math.min(2, prev + 1))}
                  >
                    Next Section →
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    className={classes.submitBtn}
                    startIcon={<CheckCircleIcon />}
                    onClick={() => goReview()}
                  >
                    Review &amp; Plan →
                  </Button>
                )}
              </>
            )}

            {phase === 'review' && (
              <>
                <Button
                  variant="outlined"
                  className={classes.secondaryBtn}
                  startIcon={<RefreshIcon />}
                  onClick={() => setPhase('configure')}
                >
                  Configure
                </Button>
                <Button
                  variant="contained"
                  className={classes.submitBtn}
                  startIcon={<AddCircleIcon />}
                  disabled={submitDisabled}
                  onClick={goSubmit}
                >
                  {submitLabel('Submit Request')}
                </Button>
              </>
            )}

            {phase === 'approval' && (
              <>
                {approvalChain.some(s => s.status === 'pending') && (
                  <Button
                    variant="outlined"
                    className={classes.secondaryBtn}
                    disabled={approvalBusy}
                    onClick={rejectRequest}
                    style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}
                  >
                    Reject Request
                  </Button>
                )}
              </>
            )}

            {phase === 'pull_request' && prMerged && (
              <Button
                variant="contained"
                className={classes.submitBtn}
                startIcon={<CheckCircleIcon />}
                onClick={handleDeploy}
              >
                Monitor Provision
              </Button>
            )}

            {(phase === 'pull_request' || phase === 'provision') &&
              runState !== 'completed' &&
              runState !== 'cancelled' && (
                <Button
                  variant="outlined"
                  className={classes.secondaryBtn}
                  disabled={cancellingBusy}
                  onClick={cancelWorkflow}
                  style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}
                >
                  {cancellingBusy ? 'Cancelling…' : 'Cancel Request'}
                </Button>
              )}

            {phase === 'provision' && runState === 'completed' && (
              <Button
                variant="contained"
                className={classes.primaryBtn}
                onClick={handleCloseModal}
              >
                Done / Finish
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
