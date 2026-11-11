/**
 * Stage 3: Deploy NetReveal
 * Guided wizard for PS team to deploy NetReveal solutions onto AKS clusters.
 * Flow: Landing → [1] Environment → [2] Solutions → [3] Components → [4] Review → Deploy
 */

import { useState, useRef, Fragment } from 'react';
import { Typography, Grid, Button, Chip, Paper, TextField, MenuItem, Switch, FormControlLabel, Checkbox, Divider } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { WarningPanel } from '@backstage/core-components';
import { useNavigate } from 'react-router-dom';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import { usePersona } from '@internal/plugin-platform-common';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep =
  | 'landing'
  | 'env'
  | 'solutions'
  | 'components'
  | 'review'
  | 'deploying';
type ProfileId =
  | 'minimal'
  | 'aml-full'
  | 'cdd-wlm'
  | 'full-platform'
  | 'custom';

interface ClusterInfo {
  name: string;
  region: string;
  k8sVersion: string;
  capacity: string;
  isProd: boolean;
}
interface Solutions {
  aml: boolean;
  amlModelOps: boolean;
  amlOptimization: boolean;
  amlCustomer: boolean;
  wlm: boolean;
  wlmScreening: boolean;
  wlmTradeFinance: boolean;
  wlmSensaAI: boolean;
  cdd: boolean;
  paymentFraud: boolean;
  fincen: boolean;
}
interface Engines {
  smbd: boolean;
  rtde: boolean;
  wlmEngine: boolean;
}
interface Platform {
  openSearch: boolean;
  sparkOperator: boolean;
  keycloak: boolean;
  monitoring: boolean;
}
interface DeployForm {
  environment: string;
  cluster: string;
  namespace: string;
  solutions: Solutions;
  engines: Engines;
  platform: Platform;
  advancedMode: boolean;
  profile: ProfileId;
}

const ACCENT = '#2563EB';
const ACCENT_LIGHT = '#EFF6FF';
const GRADIENT = 'linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)';
const SUCCESS = '#059669';
const WARN_CLR = '#D97706';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNextButtonColor(
  canGoNext: boolean,
  step: WizardStep,
): string | undefined {
  if (!canGoNext) return undefined;
  return step === 'review' ? '#10B981' : '#3B82F6';
}

function getNextButtonTextColor(canGoNext: boolean): string {
  return canGoNext ? '#FFFFFF' : '#9CA3AF';
}

function getNextButtonLabel(step: WizardStep): string {
  if (step === 'review') return 'Deploy';
  return 'Next';
}

function getNextButtonIcon(step: WizardStep) {
  if (step === 'review') return <PlayArrowIcon />;
  return undefined;
}

function getNextButtonStartIcon(step: WizardStep) {
  if (step === 'review') return <CloudUploadIcon />;
  return undefined;
}

function getStepBarBackgroundColor(isActive: boolean, isDone: boolean): string {
  if (isActive) return '#3B82F6';
  if (isDone) return '#10B981';
  return '#E5E7EB';
}

function getStepBarBorderLineBackground(isDone: boolean): string {
  return isDone ? '#10B981' : '#E5E7EB';
}

function getStepBarTextColor(isActive: boolean, isDone: boolean): string {
  if (isActive) return '#3B82F6';
  if (isDone) return '#374151';
  return '#9CA3AF';
}

function getStepBarTextWeight(isActive: boolean): number {
  return isActive ? 700 : 400;
}

function getDeployStepFontWeight(isDone: boolean, isActive: boolean): number {
  if (isDone) return 600;
  if (isActive) return 500;
  return 400;
}

function getDeployStepColor(isDone: boolean, isActive: boolean): string {
  if (isDone) return '#111827';
  if (isActive) return '#3B82F6';
  return '#9CA3AF';
}

function getDeployStepIcon(isDone: boolean, isActive: boolean) {
  if (isDone)
    return <CheckCircleIcon style={{ fontSize: 16, color: SUCCESS }} />;
  if (isActive)
    return <PlayArrowIcon style={{ fontSize: 16, color: ACCENT }} />;
  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: '#D1D5DB',
      }}
    />
  );
}

function getChipLabel(
  isDone: boolean,
  isActive: boolean,
  fallback: string,
): string {
  if (isDone) return 'Done';
  if (isActive) return 'Running';
  return fallback;
}

function getChipStyle(isDone: boolean, isActive: boolean) {
  if (isDone) {
    return {
      backgroundColor: '#D1FAE5',
      color: '#065F46',
      fontWeight: 700,
      fontSize: '0.68rem',
    };
  }
  if (isActive) {
    return {
      backgroundColor: '#DBEAFE',
      color: '#1E40AF',
      fontWeight: 700,
      fontSize: '0.68rem',
    };
  }
  return {
    backgroundColor: '#F3F4F6',
    color: '#6B7280',
    fontWeight: 700,
    fontSize: '0.68rem',
  };
}

function chipLabel(k: keyof Solutions): string {
  if (k === 'paymentFraud') return 'Payment Fraud';
  if (k === 'fincen') return 'FINCEN';
  return (k as string).toUpperCase();
}

// ─── Static data ──────────────────────────────────────────────────────────────

const CLUSTER_DATA: Record<string, ClusterInfo[]> = {
  dev: [
    {
      name: 'aks-dev-01',
      region: 'UK South',
      k8sVersion: '1.33',
      capacity: '3 nodes · Standard_E16ds_v4',
      isProd: false,
    },
    {
      name: 'aks-dev-02',
      region: 'East US 2',
      k8sVersion: '1.32',
      capacity: '2 nodes · Standard_D8s_v3',
      isProd: false,
    },
  ],
  qa: [
    {
      name: 'aks-qa-01',
      region: 'Canada Central',
      k8sVersion: '1.33',
      capacity: '5 nodes · Standard_E16ds_v4',
      isProd: false,
    },
  ],
  uat: [
    {
      name: 'aks-uat-01',
      region: 'West Europe',
      k8sVersion: '1.33',
      capacity: '6 nodes · Standard_E16ds_v4',
      isProd: false,
    },
  ],
  production: [
    {
      name: 'aks-prod-01',
      region: 'UK South',
      k8sVersion: '1.32',
      capacity: '10 nodes · Standard_E32ds_v4',
      isProd: true,
    },
    {
      name: 'aks-prod-02',
      region: 'East US 2',
      k8sVersion: '1.32',
      capacity: '10 nodes · Standard_E32ds_v4',
      isProd: true,
    },
  ],
};

const ENV_LABELS: Record<string, string> = {
  dev: 'Dev',
  qa: 'QA',
  uat: 'UAT',
  production: 'Production',
};

const PROFILE_META: Record<ProfileId, { label: string; desc: string }> = {
  minimal: { label: 'Minimal', desc: 'WLM only — screening & payments' },
  'aml-full': { label: 'AML Full', desc: 'All AML sub-solutions' },
  'cdd-wlm': { label: 'CDD + WLM', desc: 'Due diligence + watchlist' },
  'full-platform': { label: 'Full Platform', desc: 'All solutions enabled' },
  custom: { label: 'Custom', desc: 'Manual selection' },
};

const PROFILE_PRESETS: Record<ProfileId, Partial<Solutions>> = {
  minimal: { wlm: true, wlmScreening: true },
  'aml-full': {
    aml: true,
    amlModelOps: true,
    amlOptimization: true,
    amlCustomer: true,
  },
  'cdd-wlm': { cdd: true, wlm: true, wlmScreening: true },
  'full-platform': {
    aml: true,
    amlModelOps: true,
    amlOptimization: true,
    amlCustomer: true,
    wlm: true,
    wlmScreening: true,
    wlmTradeFinance: true,
    wlmSensaAI: true,
    cdd: true,
    paymentFraud: true,
    fincen: true,
  },
  custom: {},
};

const DEPLOY_SIM_STEPS = [
  { id: 'config', label: 'Config Generated', durationMs: 900 },
  { id: 'pipeline', label: 'Pipeline Triggered', durationMs: 1100 },
  { id: 'helm', label: 'Deploying Helm Charts', durationMs: 2800 },
  { id: 'customer-cfg', label: 'Applying Customer Config', durationMs: 1400 },
  { id: 'health', label: 'Running Health Checks', durationMs: 1000 },
];

const WIZARD_STEP_LABELS: Array<{ id: WizardStep; label: string }> = [
  { id: 'env', label: 'Environment' },
  { id: 'solutions', label: 'Solutions' },
  { id: 'components', label: 'Components' },
  { id: 'review', label: 'Review' },
];
const STEP_ORDER: WizardStep[] = [
  'landing',
  'env',
  'solutions',
  'components',
  'review',
  'deploying',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_SOLUTIONS: Solutions = {
  aml: false,
  amlModelOps: false,
  amlOptimization: false,
  amlCustomer: false,
  wlm: false,
  wlmScreening: false,
  wlmTradeFinance: false,
  wlmSensaAI: false,
  cdd: false,
  paymentFraud: false,
  fincen: false,
};
const INITIAL_FORM: DeployForm = {
  environment: 'dev',
  cluster: 'aks-dev-01',
  namespace: 'netreveal-dev',
  solutions: { ...EMPTY_SOLUTIONS },
  engines: { smbd: false, rtde: false, wlmEngine: false },
  platform: {
    openSearch: true,
    sparkOperator: false,
    keycloak: false,
    monitoring: true,
  },
  advancedMode: false,
  profile: 'custom',
};

function deriveEngines(sol: Solutions, manual: Engines): Engines {
  return {
    smbd: sol.aml || manual.smbd,
    rtde: sol.cdd || manual.rtde,
    wlmEngine: sol.wlm || manual.wlmEngine,
  };
}
function applyProfile(profileId: ProfileId): Solutions {
  return { ...EMPTY_SOLUTIONS, ...(PROFILE_PRESETS[profileId] ?? {}) };
}
function getWarnings(form: DeployForm): string[] {
  const w: string[] = [];
  if (form.solutions.aml && !form.engines.smbd)
    w.push('AML is selected but SMBD engine is disabled');
  if (form.solutions.cdd && !form.engines.rtde)
    w.push('CDD is selected but RTDE engine is disabled');
  if (form.solutions.wlm && !form.engines.wlmEngine)
    w.push('WLM is selected but WLM Engine is disabled');
  const meta = (CLUSTER_DATA[form.environment] ?? []).find(
    c => c.name === form.cluster,
  );
  if (meta?.isProd)
    w.push(
      'Deploying to Production — ensure all changes are reviewed and approved',
    );
  return w;
}
function hasAnySolution(sol: Solutions) {
  return sol.aml || sol.wlm || sol.cdd || sol.paymentFraud || sol.fincen;
}

// ─── SolutionCard (outside component to avoid remount) ────────────────────────

interface SolutionCardProps {
  parentKey: keyof Solutions;
  title: string;
  subtitle?: string;
  isChecked: boolean;
  subItems?: Array<{ key: keyof Solutions; label: string; isChecked: boolean }>;
  depBadge?: string;
  depColor?: string;
  depBg?: string;
  onToggle: (key: keyof Solutions) => void;
}
function SolutionCard({
  parentKey,
  title,
  subtitle,
  isChecked,
  subItems,
  depBadge,
  depColor,
  depBg,
  onToggle,
}: SolutionCardProps) {
  return (
    <Paper
      elevation={0}
      style={{
        padding: 16,
        borderRadius: 8,
        height: '100%',
        border: `1px solid ${isChecked ? '#BFDBFE' : '#E5E7EB'}`,
        background: isChecked ? ACCENT_LIGHT : '#fff',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <FormControlLabel
        control={
          <Checkbox
            checked={isChecked}
            onChange={() => onToggle(parentKey)}
            color="primary"
            size="small"
          />
        }
        label={
          <span>
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.9375rem',
                color: '#111827',
              }}
            >
              {title}
            </span>
            {subtitle && (
              <span
                style={{
                  fontWeight: 400,
                  color: '#6B7280',
                  fontSize: '0.8rem',
                }}
              >
                {' '}
                {subtitle}
              </span>
            )}
          </span>
        }
      />
      {isChecked && subItems && (
        <div style={{ marginLeft: 28, marginTop: 4 }}>
          {subItems.map(sub => (
            <FormControlLabel
              key={sub.key as string}
              style={{ display: 'block' }}
              control={
                <Checkbox
                  checked={sub.isChecked}
                  onChange={() => onToggle(sub.key)}
                  color="primary"
                  size="small"
                />
              }
              label={
                <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                  {sub.label}
                </span>
              }
            />
          ))}
        </div>
      )}
      {isChecked && depBadge && (
        <Chip
          label={depBadge}
          size="small"
          style={{
            marginLeft: 28,
            marginTop: 6,
            background: depBg ?? '#DBEAFE',
            color: depColor ?? '#1E40AF',
            fontSize: '0.68rem',
            fontWeight: 600,
          }}
        />
      )}
    </Paper>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2) },
  },
  backRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    cursor: 'pointer',
    color: '#6B7280',
    fontSize: '0.875rem',
    marginBottom: theme.spacing(2),
    '&:hover': { color: ACCENT },
  },
}));

// ─── Component ────────────────────────────────────────────────────────────────

export interface Stage2DeployPageProps {
  isTab?: boolean;
}

export function Stage2DeployPage({ isTab = false }: Stage2DeployPageProps) {
  const classes = useStyles();
  const navigate = useNavigate();
  const { persona } = usePersona();

  const [step, setStep] = useState<WizardStep>('landing');
  const [form, setForm] = useState<DeployForm>(INITIAL_FORM);
  const [deployedIdx, setDeployedIdx] = useState(-1);
  const [deployDone, setDeployDone] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  if (persona !== 'cloudhub-platform') {
    return (
      <div style={{ padding: 24 }}>
        <WarningPanel title="Access restricted">
          Stage 3 is available only to the Platform Team persona.
        </WarningPanel>
      </div>
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const goBack = () => {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStep(STEP_ORDER[i - 1]);
  };
  const goNext = () => {
    const i = STEP_ORDER.indexOf(step);
    if (i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]);
  };

  const setEnvironment = (env: string) => {
    const first = CLUSTER_DATA[env]?.[0]?.name ?? '';
    setForm(prev => ({
      ...prev,
      environment: env,
      cluster: first,
      namespace: first ? `netreveal-${env}` : '',
    }));
  };
  const setCluster = (name: string) =>
    setForm(prev => ({
      ...prev,
      cluster: name,
      namespace: `netreveal-${prev.environment}`,
    }));

  const toggleSolution = (key: keyof Solutions) => {
    setForm(prev => {
      const sol = {
        ...prev.solutions,
        [key]: !(prev.solutions[key] as boolean),
      };
      if (key === 'aml' && !sol.aml) {
        sol.amlModelOps = false;
        sol.amlOptimization = false;
        sol.amlCustomer = false;
      }
      if (key === 'wlm' && !sol.wlm) {
        sol.wlmScreening = false;
        sol.wlmTradeFinance = false;
        sol.wlmSensaAI = false;
      }
      if (
        (key === 'amlModelOps' ||
          key === 'amlOptimization' ||
          key === 'amlCustomer') &&
        (sol[key] as boolean)
      )
        sol.aml = true;
      if (
        (key === 'wlmScreening' ||
          key === 'wlmTradeFinance' ||
          key === 'wlmSensaAI') &&
        (sol[key] as boolean)
      )
        sol.wlm = true;
      return {
        ...prev,
        solutions: sol,
        engines: deriveEngines(sol, prev.engines),
        profile: 'custom',
      };
    });
  };

  const selectProfile = (pid: ProfileId) => {
    if (pid === 'custom') {
      setForm(prev => ({ ...prev, profile: 'custom' }));
      return;
    }
    const sol = applyProfile(pid);
    setForm(prev => ({
      ...prev,
      profile: pid,
      solutions: sol,
      engines: deriveEngines(sol, INITIAL_FORM.engines),
    }));
  };

  const startDeploy = () => {
    setStep('deploying');
    setDeployedIdx(-1);
    setDeployDone(false);
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    let cum = 0;
    DEPLOY_SIM_STEPS.forEach((_s, i) => {
      cum += i === 0 ? 600 : DEPLOY_SIM_STEPS[i - 1].durationMs;
      const t = setTimeout(() => setDeployedIdx(i), cum);
      timersRef.current.push(t);
    });
    cum += DEPLOY_SIM_STEPS[DEPLOY_SIM_STEPS.length - 1].durationMs;
    timersRef.current.push(setTimeout(() => setDeployDone(true), cum));
  };

  const canProceedEnv = form.cluster !== '' && form.namespace !== '';
  const canProceedSolutions = hasAnySolution(form.solutions);
  const canDeploy = hasAnySolution(form.solutions) && form.cluster !== '';

  // ── Nav row ────────────────────────────────────────────────────────────────────
  const renderNavRow = (canGoNext: boolean) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 24,
      }}
    >
      <Button
        variant="outlined"
        startIcon={<ArrowBackIcon />}
        onClick={goBack}
        style={{
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 600,
          color: '#374151',
          borderColor: '#D1D5DB',
        }}
      >
        {step === 'env' ? 'Cancel' : 'Back'}
      </Button>
      <Button
        variant="contained"
        endIcon={getNextButtonIcon(step)}
        startIcon={getNextButtonStartIcon(step)}
        disabled={!canGoNext}
        onClick={step === 'review' ? startDeploy : goNext}
        style={{
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 700,
          backgroundColor: getNextButtonColor(canGoNext, step),
          color: getNextButtonTextColor(canGoNext),
        }}
      >
        {getNextButtonLabel(step)}
      </Button>
    </div>
  );

  // ── Step bar ───────────────────────────────────────────────────────────────────
  const renderStepBar = () => {
    const cur = WIZARD_STEP_LABELS.findIndex(s => s.id === step);
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          marginBottom: 24,
          marginTop: 4,
        }}
      >
        {WIZARD_STEP_LABELS.map((s, i) => {
          const isDone = i < cur;
          const isActive = i === cur;
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    marginTop: 15,
                    background: getStepBarBorderLineBackground(isDone),
                  }}
                />
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  minWidth: 72,
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: getStepBarBackgroundColor(isActive, isDone),
                    color: isActive || isDone ? '#fff' : '#9CA3AF',
                  }}
                >
                  {isDone ? (
                    <CheckCircleIcon style={{ fontSize: 16 }} />
                  ) : (
                    i + 1
                  )}
                </div>
                <Typography
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: getStepBarTextWeight(isActive),
                    textAlign: 'center',
                    color: getStepBarTextColor(isActive, isDone),
                  }}
                >
                  {s.label}
                </Typography>
              </div>
            </Fragment>
          );
        })}
      </div>
    );
  };

  // ── Landing ────────────────────────────────────────────────────────────────────
  const renderLanding = () => (
    <div>
      <div
        style={{
          background: GRADIENT,
          borderRadius: 12,
          padding: '28px 32px',
          color: '#fff',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 8,
          }}
        >
          <CloudUploadIcon style={{ fontSize: 28, opacity: 0.85 }} />
          <Typography style={{ fontSize: '1.375rem', fontWeight: 700 }}>
            Deploy NetReveal
          </Typography>
        </div>
        <Typography
          style={{
            fontSize: '0.9rem',
            opacity: 0.85,
            maxWidth: 600,
            lineHeight: 1.6,
          }}
        >
          Deploy NetReveal business solutions onto your AKS clusters. Choose
          your solutions and the platform auto-configures engines and
          infrastructure for you.
        </Typography>
      </div>
      <div
        style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}
      >
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={() => {
            setForm(INITIAL_FORM);
            setStep('env');
          }}
          style={{
            backgroundColor: ACCENT,
            color: '#fff',
            borderRadius: 8,
            padding: '10px 24px',
            fontWeight: 700,
            fontSize: '0.9375rem',
            textTransform: 'none',
          }}
        >
          New Deployment
        </Button>
        <Button
          variant="outlined"
          disabled
          style={{
            borderRadius: 8,
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: '0.9375rem',
            textTransform: 'none',
          }}
        >
          View Existing Deployments
          <Chip
            label="Coming soon"
            size="small"
            style={{
              marginLeft: 8,
              height: 18,
              fontSize: '0.65rem',
              backgroundColor: '#F3F4F6',
              color: '#9CA3AF',
            }}
          />
        </Button>
      </div>
      <Paper
        elevation={0}
        style={{
          padding: 20,
          borderRadius: 10,
          border: '1px solid #E5E7EB',
          background: '#FAFAFA',
        }}
      >
        <Typography
          style={{
            fontSize: '0.875rem',
            fontWeight: 700,
            color: '#374151',
            marginBottom: 12,
          }}
        >
          What this wizard does
        </Typography>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {[
            { n: '①', text: 'Select an existing AKS cluster' },
            {
              n: '②',
              text: 'Choose your NetReveal solutions (AML, WLM, CDD…)',
            },
            {
              n: '③',
              text: 'Auto-map to engines & infra — tweak in Advanced mode',
            },
            { n: '④', text: 'Deploy via a single unified pipeline' },
          ].map(item => (
            <div
              key={item.n}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.8rem',
                color: '#6B7280',
                minWidth: 220,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: ACCENT,
                  fontSize: '1rem',
                  flexShrink: 0,
                }}
              >
                {item.n}
              </span>
              {item.text}
            </div>
          ))}
        </div>
      </Paper>
    </div>
  );

  // ── Step 1: Environment ────────────────────────────────────────────────────────
  const renderEnvStep = () => {
    const clusters = CLUSTER_DATA[form.environment] ?? [];
    const selected = clusters.find(c => c.name === form.cluster);
    return (
      <Paper
        elevation={0}
        style={{ padding: 24, borderRadius: 10, border: '1px solid #E5E7EB' }}
      >
        <Typography
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            color: '#111827',
            marginBottom: 18,
          }}
        >
          Select Target Environment
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <Typography
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#6B7280',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              Environment
            </Typography>
            <TextField
              fullWidth
              select
              variant="outlined"
              size="small"
              value={form.environment}
              onChange={e => setEnvironment(e.target.value)}
            >
              {Object.keys(CLUSTER_DATA).map(env => (
                <MenuItem key={env} value={env}>
                  {ENV_LABELS[env] ?? env}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#6B7280',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              Cluster
            </Typography>
            <TextField
              fullWidth
              select
              variant="outlined"
              size="small"
              value={form.cluster}
              onChange={e => setCluster(e.target.value)}
            >
              {clusters.map(c => (
                <MenuItem key={c.name} value={c.name}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#6B7280',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              Namespace
            </Typography>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              value={form.namespace}
              onChange={e =>
                setForm(prev => ({ ...prev, namespace: e.target.value }))
              }
              placeholder="netreveal-dev"
            />
          </Grid>
        </Grid>
        {selected && (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              background: '#F9FAFB',
              borderRadius: 8,
              border: '1px solid #E5E7EB',
            }}
          >
            <Typography
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#6B7280',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 10,
              }}
            >
              Cluster Details
            </Typography>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 28,
                alignItems: 'center',
              }}
            >
              {[
                { label: 'Region', value: selected.region },
                { label: 'Kubernetes', value: `v${selected.k8sVersion}` },
                { label: 'Capacity', value: selected.capacity },
              ].map(m => (
                <div key={m.label}>
                  <Typography style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>
                    {m.label}
                  </Typography>
                  <Typography
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: '#374151',
                    }}
                  >
                    {m.value}
                  </Typography>
                </div>
              ))}
              {selected.isProd && (
                <Chip
                  label="PRODUCTION"
                  size="small"
                  style={{
                    backgroundColor: '#FEF2F2',
                    color: '#DC2626',
                    fontWeight: 700,
                    fontSize: '0.68rem',
                    border: '1px solid #FCA5A5',
                  }}
                />
              )}
            </div>
          </div>
        )}
        {renderNavRow(canProceedEnv)}
      </Paper>
    );
  };

  // ── Step 2: Solutions ─────────────────────────────────────────────────────────
  const renderSolutionsStep = () => (
    <div>
      <Paper
        elevation={0}
        style={{
          padding: 16,
          borderRadius: 10,
          border: '1px solid #E5E7EB',
          marginBottom: 16,
        }}
      >
        <Typography
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            color: '#6B7280',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 10,
          }}
        >
          Quick Profiles
        </Typography>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(Object.keys(PROFILE_META) as ProfileId[]).map(pid => {
            const active = form.profile === pid;
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/interactive-supports-focus
              <div
                key={pid}
                role="button"
                onClick={() => selectProfile(pid)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: `2px solid ${active ? ACCENT : '#E5E7EB'}`,
                  background: active ? ACCENT_LIGHT : '#fff',
                  transition: 'all 0.15s',
                  userSelect: 'none',
                }}
              >
                <Typography
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: active ? ACCENT : '#374151',
                    lineHeight: 1.2,
                  }}
                >
                  {PROFILE_META[pid].label}
                </Typography>
                <Typography style={{ fontSize: '0.7rem', color: '#6B7280' }}>
                  {PROFILE_META[pid].desc}
                </Typography>
              </div>
            );
          })}
        </div>
      </Paper>

      <Typography
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#6B7280',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 10,
        }}
      >
        Select Solutions
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <SolutionCard
            parentKey="aml"
            title="AML"
            subtitle="(Transaction Monitoring)"
            isChecked={form.solutions.aml}
            subItems={[
              {
                key: 'amlModelOps',
                label: 'Model Ops',
                isChecked: form.solutions.amlModelOps,
              },
              {
                key: 'amlOptimization',
                label: 'AML Optimization',
                isChecked: form.solutions.amlOptimization,
              },
              {
                key: 'amlCustomer',
                label: 'AML Customer',
                isChecked: form.solutions.amlCustomer,
              },
            ]}
            depBadge="Auto-enables SMBD engine"
            depColor="#1E40AF"
            depBg="#DBEAFE"
            onToggle={toggleSolution}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <SolutionCard
            parentKey="wlm"
            title="WLM"
            subtitle="(Watchlist Management)"
            isChecked={form.solutions.wlm}
            subItems={[
              {
                key: 'wlmScreening',
                label: 'Screening & Payments',
                isChecked: form.solutions.wlmScreening,
              },
              {
                key: 'wlmTradeFinance',
                label: 'Trade Finance',
                isChecked: form.solutions.wlmTradeFinance,
              },
              {
                key: 'wlmSensaAI',
                label: 'SymphonyAI',
                isChecked: form.solutions.wlmSensaAI,
              },
            ]}
            depBadge="Auto-enables WLM Engine"
            depColor="#065F46"
            depBg="#D1FAE5"
            onToggle={toggleSolution}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <SolutionCard
            parentKey="cdd"
            title="CDD"
            subtitle="(Customer Due Diligence)"
            isChecked={form.solutions.cdd}
            depBadge="Auto-enables RTDE engine"
            depColor="#92400E"
            depBg="#FEF3C7"
            onToggle={toggleSolution}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <SolutionCard
            parentKey="paymentFraud"
            title="Payment Fraud"
            isChecked={form.solutions.paymentFraud}
            onToggle={toggleSolution}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <SolutionCard
            parentKey="fincen"
            title="FINCEN"
            subtitle="(Disclosures)"
            isChecked={form.solutions.fincen}
            onToggle={toggleSolution}
          />
        </Grid>
      </Grid>
      {!canProceedSolutions && (
        <Typography
          style={{ fontSize: '0.8rem', color: '#DC2626', marginTop: 10 }}
        >
          Select at least one solution to continue.
        </Typography>
      )}
      {renderNavRow(canProceedSolutions)}
    </div>
  );

  // ── Step 3: Components ────────────────────────────────────────────────────────
  const renderComponentsStep = () => {
    const engRows = [
      {
        key: 'smbd' as keyof Engines,
        label: 'SMBD',
        autoOn: form.solutions.aml,
        reason: form.solutions.aml ? 'Required by AML' : 'Not required',
      },
      {
        key: 'rtde' as keyof Engines,
        label: 'RTDE',
        autoOn: form.solutions.cdd,
        reason: form.solutions.cdd ? 'Required by CDD' : 'Not required',
      },
      {
        key: 'wlmEngine' as keyof Engines,
        label: 'WLM Engine',
        autoOn: form.solutions.wlm,
        reason: form.solutions.wlm ? 'Required by WLM' : 'Not required',
      },
    ];
    const platRows = [
      {
        key: 'openSearch' as keyof Platform,
        label: 'OpenSearch',
        required: true,
      },
      {
        key: 'monitoring' as keyof Platform,
        label: 'Monitoring (Prometheus)',
        required: true,
      },
      {
        key: 'sparkOperator' as keyof Platform,
        label: 'Spark Operator',
        required: false,
      },
      {
        key: 'keycloak' as keyof Platform,
        label: 'Keycloak (SSO)',
        required: false,
      },
    ];
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <Typography
            style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}
          >
            Engines &amp; Platform Components
          </Typography>
          <FormControlLabel
            labelPlacement="start"
            control={
              <Switch
                checked={form.advancedMode}
                onChange={e =>
                  setForm(prev => ({ ...prev, advancedMode: e.target.checked }))
                }
                color="primary"
              />
            }
            label={
              <span
                style={{
                  fontSize: '0.8rem',
                  color: '#6B7280',
                  fontWeight: 600,
                }}
              >
                Advanced Mode
              </span>
            }
          />
        </div>
        {!form.advancedMode ? (
          <Paper
            elevation={0}
            style={{
              padding: 20,
              borderRadius: 10,
              border: '1px solid #E5E7EB',
            }}
          >
            <Typography
              style={{ fontSize: '0.8rem', color: '#6B7280', marginBottom: 16 }}
            >
              Based on your solution selection, the platform will automatically
              configure the following:
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#6B7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 10,
                  }}
                >
                  Processing Engines
                </Typography>
                {engRows.map(e => (
                  <div
                    key={e.key as string}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 0',
                      borderBottom: '1px solid #F3F4F6',
                    }}
                  >
                    {form.engines[e.key] ? (
                      <CheckCircleIcon
                        style={{ fontSize: 16, color: SUCCESS, flexShrink: 0 }}
                      />
                    ) : (
                      <CancelIcon
                        style={{
                          fontSize: 16,
                          color: '#D1D5DB',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Typography
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: form.engines[e.key] ? '#111827' : '#9CA3AF',
                      }}
                    >
                      {e.label}
                    </Typography>
                    <Typography
                      style={{
                        fontSize: '0.75rem',
                        color: '#9CA3AF',
                        marginLeft: 'auto',
                      }}
                    >
                      {e.reason}
                    </Typography>
                  </div>
                ))}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#6B7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 10,
                  }}
                >
                  Platform Components
                </Typography>
                {platRows.map(p => (
                  <div
                    key={p.key as string}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 0',
                      borderBottom: '1px solid #F3F4F6',
                    }}
                  >
                    {form.platform[p.key] ? (
                      <CheckCircleIcon
                        style={{ fontSize: 16, color: SUCCESS, flexShrink: 0 }}
                      />
                    ) : (
                      <CancelIcon
                        style={{
                          fontSize: 16,
                          color: '#D1D5DB',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Typography
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: form.platform[p.key] ? '#111827' : '#9CA3AF',
                      }}
                    >
                      {p.label}
                    </Typography>
                    <Typography
                      style={{
                        fontSize: '0.75rem',
                        color: '#9CA3AF',
                        marginLeft: 'auto',
                      }}
                    >
                      {p.required ? 'Always required' : 'Optional'}
                    </Typography>
                  </div>
                ))}
              </Grid>
            </Grid>
          </Paper>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Paper
                elevation={0}
                style={{
                  padding: 20,
                  borderRadius: 10,
                  border: '1px solid #E5E7EB',
                }}
              >
                <Typography
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#6B7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 10,
                  }}
                >
                  Processing Engines
                </Typography>
                {engRows.map(e => (
                  <FormControlLabel
                    key={e.key as string}
                    style={{ display: 'flex', marginLeft: 0, marginBottom: 4 }}
                    control={
                      <Checkbox
                        checked={form.engines[e.key]}
                        onChange={() =>
                          setForm(prev => ({
                            ...prev,
                            engines: {
                              ...prev.engines,
                              [e.key]: !prev.engines[e.key],
                            },
                          }))
                        }
                        color="primary"
                        size="small"
                        disabled={e.autoOn}
                      />
                    }
                    label={
                      <span style={{ fontSize: '0.875rem' }}>
                        {e.label}
                        {e.autoOn && (
                          <Chip
                            label="auto"
                            size="small"
                            style={{
                              marginLeft: 6,
                              height: 16,
                              fontSize: '0.6rem',
                              background: '#DBEAFE',
                              color: '#1E40AF',
                            }}
                          />
                        )}
                      </span>
                    }
                  />
                ))}
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper
                elevation={0}
                style={{
                  padding: 20,
                  borderRadius: 10,
                  border: '1px solid #E5E7EB',
                }}
              >
                <Typography
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#6B7280',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 10,
                  }}
                >
                  Platform Components
                </Typography>
                {platRows.map(p => (
                  <FormControlLabel
                    key={p.key as string}
                    style={{ display: 'flex', marginLeft: 0, marginBottom: 4 }}
                    control={
                      <Checkbox
                        checked={form.platform[p.key]}
                        onChange={() =>
                          setForm(prev => ({
                            ...prev,
                            platform: {
                              ...prev.platform,
                              [p.key]: !prev.platform[p.key],
                            },
                          }))
                        }
                        color="primary"
                        size="small"
                        disabled={p.required}
                      />
                    }
                    label={
                      <span style={{ fontSize: '0.875rem' }}>
                        {p.label}
                        {p.required && (
                          <Chip
                            label="required"
                            size="small"
                            style={{
                              marginLeft: 6,
                              height: 16,
                              fontSize: '0.6rem',
                              background: '#D1FAE5',
                              color: '#065F46',
                            }}
                          />
                        )}
                      </span>
                    }
                  />
                ))}
              </Paper>
            </Grid>
          </Grid>
        )}
        {renderNavRow(true)}
      </div>
    );
  };

  // ── Step 4: Review ────────────────────────────────────────────────────────────
  const renderReviewStep = () => {
    const warnings = getWarnings(form);
    const clusterMeta = (CLUSTER_DATA[form.environment] ?? []).find(
      c => c.name === form.cluster,
    );
    const critWarns = warnings.filter(w => !w.includes('Production'));

    return (
      <div>
        <Paper
          elevation={0}
          style={{
            padding: 24,
            borderRadius: 10,
            border: '1px solid #E5E7EB',
            marginBottom: 16,
          }}
        >
          <Typography
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: '#111827',
              marginBottom: 16,
            }}
          >
            Deployment Summary
          </Typography>
          <Divider style={{ marginBottom: 16 }} />
          <div
            style={{
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: '1px solid #F3F4F6',
            }}
          >
            <Typography
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#6B7280',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              Cluster
            </Typography>
            <Typography
              style={{
                fontSize: '0.9375rem',
                fontWeight: 700,
                color: '#111827',
              }}
            >
              {form.cluster || '—'}
            </Typography>
            {clusterMeta && (
              <Typography style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                {clusterMeta.region} · k8s v{clusterMeta.k8sVersion} ·
                namespace: <strong>{form.namespace}</strong>
              </Typography>
            )}
          </div>
          <div
            style={{
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: '1px solid #F3F4F6',
            }}
          >
            <Typography
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#6B7280',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Solutions
            </Typography>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(
                [
                  'aml',
                  'wlm',
                  'cdd',
                  'paymentFraud',
                  'fincen',
                ] as (keyof Solutions)[]
              )
                .filter(k => form.solutions[k])
                .map(k => (
                  <Chip
                    key={k as string}
                    label={chipLabel(k)}
                    size="small"
                    style={{
                      backgroundColor: '#DBEAFE',
                      color: '#1E40AF',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                    }}
                  />
                ))}
              {!hasAnySolution(form.solutions) && (
                <Typography style={{ fontSize: '0.875rem', color: '#DC2626' }}>
                  No solutions selected
                </Typography>
              )}
            </div>
          </div>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#6B7280',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Engines
              </Typography>
              {[
                { label: 'SMBD', on: form.engines.smbd },
                { label: 'RTDE', on: form.engines.rtde },
                { label: 'WLM Engine', on: form.engines.wlmEngine },
              ].map(e => (
                <div
                  key={e.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 0',
                  }}
                >
                  {e.on ? (
                    <CheckCircleIcon style={{ fontSize: 14, color: SUCCESS }} />
                  ) : (
                    <CancelIcon style={{ fontSize: 14, color: '#D1D5DB' }} />
                  )}
                  <Typography
                    style={{
                      fontSize: '0.875rem',
                      color: e.on ? '#111827' : '#9CA3AF',
                    }}
                  >
                    {e.label}
                  </Typography>
                </div>
              ))}
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#6B7280',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Platform
              </Typography>
              {[
                { label: 'OpenSearch', on: form.platform.openSearch },
                { label: 'Monitoring', on: form.platform.monitoring },
                { label: 'Spark Operator', on: form.platform.sparkOperator },
                { label: 'Keycloak', on: form.platform.keycloak },
              ].map(p => (
                <div
                  key={p.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 0',
                  }}
                >
                  {p.on ? (
                    <CheckCircleIcon style={{ fontSize: 14, color: SUCCESS }} />
                  ) : (
                    <CancelIcon style={{ fontSize: 14, color: '#D1D5DB' }} />
                  )}
                  <Typography
                    style={{
                      fontSize: '0.875rem',
                      color: p.on ? '#111827' : '#9CA3AF',
                    }}
                  >
                    {p.label}
                  </Typography>
                </div>
              ))}
            </Grid>
          </Grid>
        </Paper>
        {warnings.length > 0 && (
          <Paper
            elevation={0}
            style={{
              padding: 16,
              borderRadius: 10,
              border: '1px solid #FCD34D',
              backgroundColor: '#FFFBEB',
              marginBottom: 12,
            }}
          >
            {warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginBottom: i < warnings.length - 1 ? 8 : 0,
                }}
              >
                <WarningIcon
                  style={{
                    fontSize: 16,
                    color: WARN_CLR,
                    marginTop: 2,
                    flexShrink: 0,
                  }}
                />
                <Typography style={{ fontSize: '0.875rem', color: '#92400E' }}>
                  {w}
                </Typography>
              </div>
            ))}
          </Paper>
        )}
        {critWarns.length === 0 && hasAnySolution(form.solutions) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
            }}
          >
            <CheckCircleIcon style={{ fontSize: 16, color: SUCCESS }} />
            <Typography
              style={{ fontSize: '0.875rem', color: SUCCESS, fontWeight: 600 }}
            >
              Valid configuration — ready to deploy
            </Typography>
          </div>
        )}
        {renderNavRow(canDeploy)}
      </div>
    );
  };

  // ── Deploying ─────────────────────────────────────────────────────────────────
  const renderDeployingStep = () => (
    <Paper
      elevation={0}
      style={{ padding: 28, borderRadius: 10, border: '1px solid #E5E7EB' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <Typography
          style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}
        >
          Deployment Status
        </Typography>
        {!deployDone ? (
          <Chip
            label="IN PROGRESS"
            size="small"
            style={{
              backgroundColor: '#DBEAFE',
              color: ACCENT,
              fontWeight: 700,
              fontSize: '0.68rem',
            }}
          />
        ) : (
          <Chip
            label="COMPLETE"
            size="small"
            style={{
              backgroundColor: '#D1FAE5',
              color: '#065F46',
              fontWeight: 700,
              fontSize: '0.68rem',
            }}
          />
        )}
      </div>
      <Typography
        style={{ fontSize: '0.8rem', color: '#6B7280', marginBottom: 24 }}
      >
        {form.cluster} · namespace: <strong>{form.namespace}</strong>
      </Typography>
      {DEPLOY_SIM_STEPS.map((s, i) => {
        const isDone = deployDone || i <= deployedIdx;
        const isActive = !deployDone && i === deployedIdx + 1;
        return (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '10px 0',
              borderBottom:
                i < DEPLOY_SIM_STEPS.length - 1 ? '1px solid #F3F4F6' : 'none',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {getDeployStepIcon(isDone, isActive)}
            </div>
            <Typography
              style={{
                fontSize: '0.9rem',
                flex: 1,
                fontWeight: getDeployStepFontWeight(isDone, isActive),
                color: getDeployStepColor(isDone, isActive),
              }}
            >
              {s.label}
            </Typography>
            {isDone && (
              <Chip
                label={getChipLabel(true, false, '')}
                size="small"
                style={getChipStyle(true, false)}
              />
            )}
            {isActive && (
              <Chip
                label={getChipLabel(false, true, '')}
                size="small"
                style={getChipStyle(false, true)}
              />
            )}
          </div>
        );
      })}
      {deployDone && (
        <div
          style={{
            marginTop: 24,
            padding: 18,
            background: '#F0FDF4',
            borderRadius: 8,
            border: '1px solid #BBF7D0',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <CheckCircleIcon style={{ fontSize: 22, color: SUCCESS }} />
            <Typography
              style={{ fontWeight: 700, fontSize: '1rem', color: '#065F46' }}
            >
              Deployment Complete!
            </Typography>
          </div>
          <Typography
            style={{ fontSize: '0.8rem', color: '#047857', marginBottom: 14 }}
          >
            NetReveal has been deployed to <strong>{form.cluster}</strong> in
            namespace <strong>{form.namespace}</strong>.
          </Typography>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={() => {
                setStep('landing');
                setForm(INITIAL_FORM);
                setDeployedIdx(-1);
                setDeployDone(false);
              }}
              style={{
                backgroundColor: ACCENT,
                color: '#fff',
                borderRadius: 6,
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              New Deployment
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => navigate('/platform-deployment')}
              style={{
                borderRadius: 6,
                textTransform: 'none',
                fontWeight: 600,
                color: '#374151',
                borderColor: '#D1D5DB',
              }}
            >
              View Deployments
            </Button>
          </div>
        </div>
      )}
    </Paper>
  );

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div className={classes.root}>
      {!isTab && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
        <div
          className={classes.backRow}
          onClick={() => navigate('/deployment')}
        >
          <ArrowBackIcon style={{ fontSize: 16 }} /> Back to Pipeline Overview
        </div>
      )}
      {step === 'landing' && renderLanding()}
      {step !== 'landing' && step !== 'deploying' && (
        <>
          {renderStepBar()}
          {step === 'env' && renderEnvStep()}
          {step === 'solutions' && renderSolutionsStep()}
          {step === 'components' && renderComponentsStep()}
          {step === 'review' && renderReviewStep()}
        </>
      )}
      {step === 'deploying' && renderDeployingStep()}
    </div>
  );
}
