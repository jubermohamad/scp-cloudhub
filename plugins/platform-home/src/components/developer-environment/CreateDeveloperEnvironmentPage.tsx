import { useEffect, useMemo, useRef, useState } from 'react';
import { Typography, Paper, Stepper, Step, StepLabel, Grid, TextField, MenuItem, Box, Button, CircularProgress, FormControlLabel, Switch, Chip } from '@mui/material';
import { makeStyles } from '@mui/styles';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CodeIcon from '@mui/icons-material/Code';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import GroupIcon from '@mui/icons-material/Group';
import ExtensionIcon from '@mui/icons-material/Extension';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import BuildIcon from '@mui/icons-material/Build';
import { useNavigate } from 'react-router-dom';
import { discoveryApiRef, useApi } from '@backstage/core-plugin-api';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type {
  DeveloperEnvironmentOptions,
  DevelopmentProfile,
  ResourceProfile,
} from './types';

const STEPS = [
  'Application',
  'Source',
  'Environment',
  'Platform Services',
  'Review',
];

type WorkspaceProduct = 'SRI' | 'NETREVEAL';

const PRODUCT_OPTIONS: Array<{ id: WorkspaceProduct; label: string }> = [
  { id: 'SRI', label: 'SRI - Symphony Risk Intelligence' },
  { id: 'NETREVEAL', label: 'NetReveal' },
];

const NETREVEAL_TECH_STACK = [
  {
    component: 'OpenJDK',
    version: '21 (17 for Spark)',
    role: 'Application runtime',
  },
  { component: 'WildFly', version: '37.0.1', role: 'Java EE app server' },
  {
    component: 'PostgreSQL',
    version: '17.7 (CloudNativePG)',
    role: 'Primary database',
  },
  {
    component: 'Apache Kafka',
    version: '4.0.0 (KRaft, no Zookeeper)',
    role: 'Event streaming',
  },
  {
    component: 'Apache Spark',
    version: '3.5.6',
    role: 'Batch analytics / ML jobs',
  },
  { component: 'OpenSearch', version: '2.18.0', role: 'Full-text search' },
  { component: 'MinIO', version: 'Operator 5.0.18', role: 'Object storage' },
  { component: 'Helm', version: '3.x', role: 'Deployment' },
];

function sriTechStack(selectedComponent: {
  language: { name: string };
  runtime: { name: string; version: string | null };
  developmentProfile: { id: string; version: string };
}) {
  return [
    {
      component: 'Primary Language',
      version: selectedComponent.language.name,
      role: 'Implementation language',
    },
    {
      component: 'Runtime',
      version: selectedComponent.runtime.version
        ? `${selectedComponent.runtime.name} ${selectedComponent.runtime.version}`
        : selectedComponent.runtime.name,
      role: 'Application runtime',
    },
    {
      component: 'Development Profile',
      version: `${selectedComponent.developmentProfile.id}:${selectedComponent.developmentProfile.version}`,
      role: 'Workspace blueprint',
    },
  ];
}

function productLabel(product: WorkspaceProduct): string {
  return (
    PRODUCT_OPTIONS.find(option => option.id === product)?.label ?? product
  );
}

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1300,
    margin: '0 auto',
  },
  titleWrap: {
    marginTop: theme.spacing(1),
    textAlign: 'center',
  },
  titleLine: {
    fontWeight: 800,
    lineHeight: 1.1,
  },
  paper: {
    borderRadius: 12,
    border: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(2.25),
    marginTop: theme.spacing(2),
  },
  stepMeta: {
    marginTop: theme.spacing(0.8),
    color: '#475569',
    fontWeight: 600,
  },
  stepLegendRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  stepLegendChip: {
    borderRadius: 999,
    border: '1px solid #D1D5DB',
    background: '#FFFFFF',
    color: '#334155',
    fontWeight: 600,
  },
  stepLegendChipActive: {
    borderColor: '#2563EB',
    background: '#EFF6FF',
    color: '#1D4ED8',
  },
  stepLegendChipDone: {
    borderColor: '#10B981',
    background: '#ECFDF5',
    color: '#047857',
  },
  actions: {
    marginTop: theme.spacing(3),
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    marginBottom: theme.spacing(1),
  },
  netRevealMeta: {
    marginTop: theme.spacing(-0.4),
    marginBottom: theme.spacing(1),
    color: '#1E293B',
    fontWeight: 700,
    fontSize: '0.9rem',
  },
  netRevealMetaSub: {
    marginBottom: theme.spacing(1.1),
    color: '#334155',
    fontWeight: 600,
    fontSize: '0.86rem',
  },
  hintBox: {
    padding: theme.spacing(1.5),
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    background: '#F9FAFB',
  },
  compactPreviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: theme.spacing(1),
    alignItems: 'stretch',
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  compactPreviewWrap: {
    maxWidth: 1080,
    margin: '0 auto',
  },
  compactPreviewCard: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: theme.spacing(0.9, 1),
    borderRadius: 8,
    border: '1px solid #E2E8F0',
    background: '#FFFFFF',
  },
  compactList: {
    display: 'grid',
    gap: theme.spacing(0.35),
  },
  compactListRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    borderBottom: '1px solid #EEF2F7',
    paddingBottom: theme.spacing(0.25),
    '&:last-child': {
      borderBottom: 'none',
      paddingBottom: 0,
    },
  },
  compactListLabel: {
    fontSize: '0.76rem',
    fontWeight: 700,
    color: '#334155',
  },
  compactListValue: {
    fontSize: '0.84rem',
    fontWeight: 700,
    color: '#0F172A',
    textAlign: 'right' as const,
  },
  compactResourceList: {
    display: 'grid',
    gap: theme.spacing(0.35),
  },
  compactResourceItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: '#0F172A',
    fontWeight: 600,
    fontSize: '0.8rem',
    lineHeight: 1.25,
  },
  techCardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: theme.spacing(1.25),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  techCard: {
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: theme.spacing(1.25, 1.5),
    background: '#FFFFFF',
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
  },
  techCardTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  techCardVersion: {
    marginTop: theme.spacing(0.5),
    fontSize: '0.95rem',
    fontWeight: 800,
    color: '#0F172A',
  },
  techCardRole: {
    marginTop: theme.spacing(0.35),
    fontSize: '0.83rem',
    color: '#334155',
  },
  techCardsGridCompact: {
    gap: theme.spacing(0.75),
  },
  techCardCompact: {
    padding: theme.spacing(0.9, 1.1),
    borderRadius: 8,
  },
  techCardCompactTitle: {
    fontSize: '0.74rem',
  },
  techCardCompactVersion: {
    marginTop: theme.spacing(0.2),
    fontSize: '0.82rem',
  },
  techCardCompactRole: {
    marginTop: theme.spacing(0.2),
    fontSize: '0.78rem',
  },
  metadataGrid: {
    display: 'grid',
    gap: theme.spacing(1),
  },
  metadataRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    borderBottom: '1px dashed #E2E8F0',
    paddingBottom: theme.spacing(0.6),
    '&:last-child': {
      borderBottom: 'none',
      paddingBottom: 0,
    },
  },
  metadataLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.8),
    color: '#334155',
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  metadataValue: {
    color: '#0F172A',
    fontWeight: 700,
    fontSize: '0.9rem',
  },
  resourcesList: {
    marginTop: theme.spacing(0.8),
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))',
    gap: theme.spacing(0.75, 1.5),
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  resourcesItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.8),
    color: '#0F172A',
    fontWeight: 600,
    fontSize: '0.86rem',
  },
  stackTableWrap: {
    borderRadius: 8,
    border: '1px solid #E2E8F0',
    overflowX: 'auto',
    background: '#FFFFFF',
  },
  stackTable: {
    minWidth: 760,
  },
  stackRow: {
    display: 'grid',
    gridTemplateColumns: '1.1fr 1.4fr 1.5fr',
    borderBottom: '1px solid #E5E7EB',
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  stackHeader: {
    background: '#F8FAFC',
  },
  stackCell: {
    padding: theme.spacing(1.2, 1.5),
    color: '#334155',
    fontSize: '0.9rem',
    lineHeight: 1.35,
  },
  stackCellStrong: {
    fontWeight: 700,
    color: '#0F172A',
  },
  stackHeaderCell: {
    fontWeight: 700,
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: '0.72rem',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '1px solid #E5E7EB',
    padding: theme.spacing(1.25, 0),
  },
  reviewIntro: {
    marginBottom: theme.spacing(2),
    borderRadius: 12,
    padding: theme.spacing(2),
    color: '#0F172A',
    background:
      'linear-gradient(110deg, #E0F2FE 0%, #DCFCE7 60%, #FEF9C3 100%)',
    border: '1px solid #BFDBFE',
  },
  summaryCard: {
    borderRadius: 12,
    border: '1px solid #E2E8F0',
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
  },
  summaryCardBody: {
    padding: theme.spacing(2),
  },
  summaryCardTitle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontWeight: 800,
    fontSize: '1rem',
    color: '#0F172A',
    marginBottom: theme.spacing(1),
  },
  summaryPill: {
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: 0.4,
    color: '#0369A1',
    background: '#E0F2FE',
    borderRadius: 999,
    padding: '2px 10px',
    textTransform: 'uppercase',
  },
  rowLabel: {
    color: '#475569',
    fontWeight: 500,
  },
  rowValue: {
    color: '#0F172A',
    fontWeight: 700,
    textAlign: 'right',
    marginLeft: theme.spacing(2),
  },
  consoleCard: {
    marginTop: theme.spacing(2),
    borderRadius: 12,
    border: '1px solid #1E293B',
    background: '#0B1220',
    color: '#E2E8F0',
    overflow: 'hidden',
  },
  consoleHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1.5, 2),
    borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
    background:
      'linear-gradient(90deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
  },
  consoleDotRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.8),
    marginRight: theme.spacing(1.5),
  },
  consoleDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
  },
  consoleBody: {
    maxHeight: 320,
    overflowY: 'auto',
    padding: theme.spacing(1.5, 2),
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.82rem',
    lineHeight: 1.55,
    background:
      'radial-gradient(circle at top right, rgba(14, 165, 233, 0.08), transparent 55%), #0B1220',
  },
  consoleBodyCompact: {
    maxHeight: 420,
    padding: theme.spacing(1, 1.5),
    fontSize: '0.75rem',
    lineHeight: 1.35,
  },
  consoleLine: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    marginBottom: theme.spacing(0.7),
  },
  consoleLineCompact: {
    marginBottom: theme.spacing(0.35),
  },
  consoleMuted: {
    color: '#94A3B8',
  },
  consoleInfo: {
    color: '#BFDBFE',
  },
  consoleWarn: {
    color: '#FDE68A',
  },
  consoleError: {
    color: '#FCA5A5',
  },
  consoleSuccess: {
    color: '#86EFAC',
  },
}));

interface WizardState {
  product: WorkspaceProduct;
  componentId: string;
  branch: string;
  repositoryOrganization: string;
  repositoryName: string;
  repositoryUrl: string;
  environmentType: 'SHARED_TEAM';
  resourceProfile: 'SMALL' | 'MEDIUM' | 'LARGE';
  services: {
    postgresql: boolean;
    kafka: boolean;
    redis: boolean;
    objectStorage: boolean;
  };
}

const DEFAULT_STATE: WizardState = {
  product: 'SRI',
  componentId: '',
  branch: 'main',
  repositoryOrganization: 'SymphonySensa',
  repositoryName: '',
  repositoryUrl: '',
  environmentType: 'SHARED_TEAM',
  resourceProfile: 'MEDIUM',
  services: {
    postgresql: false,
    kafka: false,
    redis: false,
    objectStorage: false,
  },
};

interface AuditLogEntry {
  id: string;
  actorRef: string;
  role: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface ConsoleLogLine {
  id: string;
  createdAt: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

function isTerminalWorkspaceStatus(status: string): boolean {
  return ['READY', 'FAILED', 'STOPPED', 'DELETED'].includes(status);
}

function formatAuditAction(action: string): string {
  const map: Record<string, string> = {
    'developer-environment-create': 'Workspace create request accepted',
    'developer-workspace-start': 'Workspace lifecycle action: start',
    'developer-workspace-stop': 'Workspace lifecycle action: stop',
    'developer-workspace-validate': 'Workspace validation executed',
    'developer-environment-delete': 'Workspace deleted',
  };
  return map[action] ?? action.replace(/-/g, ' ');
}

function compactPayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.status === 'string') {
    parts.push(`status=${payload.status}`);
  }
  if (typeof payload.namespace === 'string') {
    parts.push(`namespace=${payload.namespace}`);
  }
  if (typeof payload.clusterId === 'string') {
    parts.push(`cluster=${payload.clusterId}`);
  }
  if (typeof payload.componentId === 'string') {
    parts.push(`component=${payload.componentId}`);
  }
  return parts.join(' | ');
}

function createButtonLabel(input: {
  submitting: boolean;
  provisioningInProgress: boolean;
}): string {
  if (input.submitting) {
    return 'Creating...';
  }
  if (input.provisioningInProgress) {
    return 'Streaming Logs...';
  }
  return 'Create Development Workspace';
}

function consoleLevelClass(
  level: ConsoleLogLine['level'],
  classes: ReturnType<typeof useStyles>,
): string {
  if (level === 'error') {
    return classes.consoleError;
  }
  if (level === 'warn') {
    return classes.consoleWarn;
  }
  if (level === 'success') {
    return classes.consoleSuccess;
  }
  return classes.consoleInfo;
}

export function CreateWorkspacePage() {
  const WORKSPACE_NAMESPACE = 'cloudhub-workspaces';
  const classes = useStyles();
  const navigate = useNavigate();
  const discoveryApi = useApi(discoveryApiRef);
  const backendFetch = useBackendFetch();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [options, setOptions] = useState<DeveloperEnvironmentOptions | null>(
    null,
  );
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(
    null,
  );
  const [creationFinished, setCreationFinished] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogLine[]>([]);
  const [latestWorkspaceStatus, setLatestWorkspaceStatus] = useState<
    string | null
  >(null);
  const [streamMode, setStreamMode] = useState<'sse' | 'polling'>('sse');
  const [consolePaused, setConsolePaused] = useState(false);
  const [pendingPausedCount, setPendingPausedCount] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const [showWarn, setShowWarn] = useState(true);
  const [showError, setShowError] = useState(true);
  const [followTail, setFollowTail] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const seenAuditIdsRef = useRef(new Set<string>());
  const lastAuditSinceRef = useRef<string | null>(null);
  const statusSnapshotRef = useRef<string>('');
  const consolePausedRef = useRef(false);
  const bufferedLogsRef = useRef<ConsoleLogLine[]>([]);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    consolePausedRef.current = consolePaused;
  }, [consolePaused]);

  const visibleConsoleLogs = useMemo(() => {
    return consoleLogs.filter(line => {
      if (line.level === 'warn') {
        return showWarn;
      }
      if (line.level === 'error') {
        return showError;
      }
      return showInfo;
    });
  }, [consoleLogs, showError, showInfo, showWarn]);

  useEffect(() => {
    if (!followTail) {
      return;
    }
    const node = consoleBodyRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [followTail, visibleConsoleLogs.length, compactMode]);

  const appendConsoleLog = (
    level: ConsoleLogLine['level'],
    message: string,
    createdAt = new Date().toISOString(),
  ) => {
    const nextLine: ConsoleLogLine = {
      id: `${createdAt}-${Math.random().toString(16).slice(2, 7)}`,
      createdAt,
      level,
      message,
    };

    if (consolePausedRef.current) {
      bufferedLogsRef.current = [...bufferedLogsRef.current, nextLine].slice(
        -600,
      );
      setPendingPausedCount(bufferedLogsRef.current.length);
      return;
    }

    setConsoleLogs(prev => [...prev, nextLine].slice(-600));
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          '/workspaces/options',
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? 'Failed to load wizard options');
        }
        if (cancelled) return;
        setOptions(body as DeveloperEnvironmentOptions);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [backendFetch]);

  const selectedComponent = useMemo(() => {
    return (
      options?.components.find(
        component => component.id === state.componentId,
      ) ?? null
    );
  }, [options?.components, state.componentId]);

  const availableComponents = useMemo(() => {
    const catalogProduct = state.product === 'NETREVEAL' ? 'NetReveal' : 'SRI';
    return (
      options?.components.filter(
        component => component.product === catalogProduct,
      ) ?? []
    );
  }, [options?.components, state.product]);

  const isNetReveal = state.product === 'NETREVEAL';

  const selectedProfile = useMemo<DevelopmentProfile | null>(() => {
    if (!selectedComponent) return null;
    return (
      options?.developmentProfiles.find(
        profile => profile.id === selectedComponent.developmentProfile.id,
      ) ?? null
    );
  }, [options?.developmentProfiles, selectedComponent]);

  const selectedResourceProfile = useMemo<ResourceProfile | null>(() => {
    return (
      options?.resourceProfiles.find(
        profile => profile.id === state.resourceProfile,
      ) ?? null
    );
  }, [options?.resourceProfiles, state.resourceProfile]);

  const resolvedRepository = useMemo(() => {
    if (!selectedComponent) {
      return { provider: 'github', organization: '', name: '', url: '' };
    }

    return {
      provider: selectedComponent.repository.provider,
      organization: 'SymphonySensa',
      name: selectedComponent.repository.name ?? state.repositoryName,
      url: selectedComponent.repository.url ?? state.repositoryUrl,
    };
  }, [selectedComponent, state.repositoryName, state.repositoryUrl]);

  const stepIsValid = (step: number) => {
    if (!options) return false;

    if (step === 0) {
      return !!selectedComponent;
    }

    if (step === 1) {
      return (
        !!state.branch.trim() &&
        !!resolvedRepository.name.trim() &&
        !!resolvedRepository.organization.trim()
      );
    }

    if (step === 2) {
      return !!selectedResourceProfile;
    }

    if (step === 3) {
      return true;
    }

    if (step === 4) {
      return !!selectedComponent && !!selectedResourceProfile;
    }

    return false;
  };

  const createEnvironment = async () => {
    if (!selectedComponent || !selectedResourceProfile) {
      return;
    }

    setConsoleOpen(true);
    setCreatedWorkspaceId(null);
    setCreationFinished(false);
    setLatestWorkspaceStatus(null);
    setConsoleLogs([]);
    setConsolePaused(false);
    setPendingPausedCount(0);
    setShowInfo(true);
    setShowWarn(true);
    setShowError(true);
    setFollowTail(true);
    setCompactMode(false);
    seenAuditIdsRef.current = new Set<string>();
    lastAuditSinceRef.current = null;
    statusSnapshotRef.current = '';
    consolePausedRef.current = false;
    bufferedLogsRef.current = [];
    appendConsoleLog('info', 'Initializing workspace provisioning request...');
    appendConsoleLog(
      'info',
      `Resolving component ${selectedComponent.id} and profile ${selectedResourceProfile.id}.`,
    );

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        componentId: selectedComponent.id,
        source: {
          repository: {
            provider: resolvedRepository.provider,
            organization: resolvedRepository.organization,
            name: resolvedRepository.name,
            url: resolvedRepository.url || undefined,
          },
          branch: state.branch.trim(),
        },
        runtime: {
          cloudProvider: 'AZURE',
          platform: 'KUBERNETES',
        },
        environmentType: 'SHARED_TEAM',
        resourceProfile: selectedResourceProfile.id,
        platformServices: {
          dependencies: {
            postgresql: state.services.postgresql,
            kafka: state.services.kafka,
            redis: state.services.redis,
            objectStorage: state.services.objectStorage,
          },
        },
      };

      const response = await backendFetch(
        'deployment-control-plane',
        '/workspaces',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to create developer environment');
      }

      const workspaceId = String(body.id ?? '').trim();
      if (!workspaceId) {
        throw new Error('Workspace was created but no id was returned by API.');
      }

      setCreatedWorkspaceId(workspaceId);
      appendConsoleLog('success', `Workspace record created: ${workspaceId}`);
      appendConsoleLog(
        'info',
        'Streaming backend audit events and lifecycle transitions...',
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      appendConsoleLog('error', message);
      setCreationFinished(true);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!consoleOpen || !createdWorkspaceId || creationFinished) {
      return () => {};
    }

    let cancelled = false;
    let stream: EventSource | null = null;
    let fallbackTimer: number | null = null;
    let fallbackRunning = false;

    const finalizeFromStatus = (
      status: string,
      statusMessage?: string | null,
      failureReason?: string | null,
      updatedAt?: string,
    ) => {
      const snapshot = `${status}|${statusMessage ?? ''}|${
        failureReason ?? ''
      }`;
      if (snapshot !== statusSnapshotRef.current) {
        statusSnapshotRef.current = snapshot;
        setLatestWorkspaceStatus(status);

        const message =
          statusMessage?.trim() || 'No status message provided by backend';
        const level: ConsoleLogLine['level'] =
          status === 'FAILED' ? 'error' : 'info';
        appendConsoleLog(level, `Status ${status}: ${message}`, updatedAt);
        if (failureReason) {
          appendConsoleLog(
            'error',
            `Failure reason: ${failureReason}`,
            updatedAt,
          );
        }
      }

      if (isTerminalWorkspaceStatus(status)) {
        if (status === 'READY') {
          appendConsoleLog(
            'success',
            'Workspace provisioning completed successfully.',
            updatedAt,
          );
        } else if (status === 'STOPPED') {
          appendConsoleLog(
            'warn',
            'Workspace finished in STOPPED state.',
            updatedAt,
          );
        } else {
          appendConsoleLog(
            'error',
            `Workspace finished in ${status} state.`,
            updatedAt,
          );
        }
        if (!cancelled) {
          setCreationFinished(true);
        }
      }
    };

    const handleAuditEvents = (events: AuditLogEntry[]) => {
      for (const event of events) {
        if (seenAuditIdsRef.current.has(event.id)) {
          continue;
        }
        seenAuditIdsRef.current.add(event.id);
        const details = compactPayload(event.payload);
        appendConsoleLog(
          'info',
          details.length > 0
            ? `${formatAuditAction(event.action)} (${details})`
            : formatAuditAction(event.action),
          event.createdAt,
        );
      }
      const newest = events[events.length - 1];
      if (newest?.createdAt) {
        lastAuditSinceRef.current = newest.createdAt;
      }
    };

    const pollOnce = async () => {
      if (fallbackRunning || cancelled) {
        return;
      }
      fallbackRunning = true;
      try {
        const auditParams = new URLSearchParams({ limit: '200' });
        if (lastAuditSinceRef.current) {
          auditParams.set('since', lastAuditSinceRef.current);
        }

        const [workspaceRes, auditRes] = await Promise.all([
          backendFetch(
            'deployment-control-plane',
            `/workspaces/${createdWorkspaceId}`,
          ),
          backendFetch(
            'deployment-control-plane',
            `/workspaces/${createdWorkspaceId}/audit-logs?${auditParams.toString()}`,
          ),
        ]);

        if (!workspaceRes.ok) {
          const body = await workspaceRes.json().catch(() => ({}));
          throw new Error(
            String(
              (body as { error?: string }).error ??
                'Failed to load workspace status',
            ),
          );
        }
        if (!auditRes.ok) {
          const body = await auditRes.json().catch(() => ({}));
          throw new Error(
            String(
              (body as { error?: string }).error ??
                'Failed to load workspace logs',
            ),
          );
        }

        const workspace = (await workspaceRes.json()) as {
          status: string;
          statusMessage?: string | null;
          failureReason?: string | null;
          updatedAt: string;
        };

        const auditBody = (await auditRes.json()) as {
          items?: AuditLogEntry[];
        };
        handleAuditEvents(auditBody.items ?? []);
        finalizeFromStatus(
          workspace.status,
          workspace.statusMessage,
          workspace.failureReason,
          workspace.updatedAt,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        appendConsoleLog('error', message);
      } finally {
        fallbackRunning = false;
      }
    };

    const startFallbackPolling = (reason: string) => {
      if (cancelled || fallbackTimer !== null) {
        return;
      }
      setStreamMode('polling');
      appendConsoleLog('warn', reason);
      void pollOnce();
      fallbackTimer = window.setInterval(() => {
        void pollOnce();
      }, 1800);
    };

    const startSse = async () => {
      if (typeof EventSource === 'undefined') {
        startFallbackPolling(
          'SSE is unavailable in this browser context. Falling back to polling.',
        );
        return;
      }

      try {
        const baseUrl = await discoveryApi.getBaseUrl(
          'deployment-control-plane',
        );
        const streamUrl = new URL(
          `${baseUrl}/workspaces/${createdWorkspaceId}/logs/stream`,
        );
        if (lastAuditSinceRef.current) {
          streamUrl.searchParams.set('since', lastAuditSinceRef.current);
        }

        try {
          const persona = localStorage.getItem('cloudhub:active_persona');
          if (persona) {
            streamUrl.searchParams.set('persona', persona);
          }
        } catch {
          // localStorage might be unavailable; stream will continue without persona hint.
        }

        stream = new EventSource(streamUrl.toString(), {
          withCredentials: true,
        });
        setStreamMode('sse');

        stream.addEventListener('connected', () => {
          appendConsoleLog('success', 'Connected to provisioning log stream.');
        });

        stream.addEventListener('audit', event => {
          try {
            const parsed = JSON.parse(
              (event as MessageEvent).data,
            ) as AuditLogEntry;
            handleAuditEvents([parsed]);
          } catch {
            appendConsoleLog(
              'warn',
              'Received malformed audit event from stream.',
            );
          }
        });

        stream.addEventListener('status', event => {
          try {
            const parsed = JSON.parse((event as MessageEvent).data) as {
              status: string;
              statusMessage?: string | null;
              failureReason?: string | null;
              updatedAt?: string;
            };
            finalizeFromStatus(
              parsed.status,
              parsed.statusMessage,
              parsed.failureReason,
              parsed.updatedAt,
            );
          } catch {
            appendConsoleLog(
              'warn',
              'Received malformed status event from stream.',
            );
          }
        });

        stream.addEventListener('done', event => {
          try {
            const parsed = JSON.parse((event as MessageEvent).data) as {
              status: string;
              statusMessage?: string | null;
              failureReason?: string | null;
              updatedAt?: string;
            };
            finalizeFromStatus(
              parsed.status,
              parsed.statusMessage,
              parsed.failureReason,
              parsed.updatedAt,
            );
          } finally {
            stream?.close();
          }
        });

        stream.addEventListener('error', event => {
          try {
            const parsed = JSON.parse((event as MessageEvent).data) as {
              message?: string;
            };
            if (parsed.message) {
              appendConsoleLog('error', parsed.message);
            }
          } catch {
            // noop
          }
        });

        stream.onerror = () => {
          stream?.close();
          stream = null;
          if (!creationFinished) {
            startFallbackPolling(
              'Log stream disconnected. Falling back to polling mode.',
            );
          }
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        startFallbackPolling(
          `Unable to establish SSE stream (${message}). Falling back to polling.`,
        );
      }
    };

    void startSse();

    return () => {
      cancelled = true;
      if (stream) {
        stream.close();
      }
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, [
    backendFetch,
    creationFinished,
    createdWorkspaceId,
    consoleOpen,
    discoveryApi,
  ]);

  const provisioningInProgress =
    Boolean(createdWorkspaceId) && !creationFinished;

  const onTogglePause = () => {
    if (consolePaused) {
      const buffered = bufferedLogsRef.current;
      bufferedLogsRef.current = [];
      setPendingPausedCount(0);
      setConsolePaused(false);
      if (buffered.length > 0) {
        setConsoleLogs(prev => [...prev, ...buffered].slice(-600));
      }
      return;
    }

    setConsolePaused(true);
  };

  const onClearConsole = () => {
    setConsoleLogs([]);
    bufferedLogsRef.current = [];
    setPendingPausedCount(0);
  };

  const onDownloadConsoleLogs = () => {
    const lines = visibleConsoleLogs.map(
      line =>
        `[${new Date(
          line.createdAt,
        ).toISOString()}] [${line.level.toUpperCase()}] ${line.message}`,
    );
    const content =
      lines.length > 0
        ? lines.join('\n')
        : 'No logs available for the selected filters.';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `workspace-live-logs-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.txt`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className={classes.root}>
        <Box display="flex" alignItems="center" style={{ gap: 10 }}>
          <CircularProgress size={24} />
          <Typography>Loading developer environment wizard...</Typography>
        </Box>
      </div>
    );
  }

  if (!options) {
    return (
      <div className={classes.root}>
        <Typography color="error">
          {error ?? 'Unable to load options.'}
        </Typography>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/workspaces')}
      >
        Back to My Workspaces
      </Button>
      <div className={classes.titleWrap}>
        <Typography variant="h4" className={classes.titleLine}>
          Create Development
        </Typography>
        <Typography variant="h4" className={classes.titleLine}>
          Workspace
        </Typography>
      </div>
      <Typography
        variant="body2"
        color="textSecondary"
        style={{ marginTop: 6, textAlign: 'center' }}
      >
        Provision a standardized Cloud Development Workspace for SRI components.
      </Typography>

      {error && (
        <Box
          mt={2}
          p={2}
          style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8 }}
        >
          {error}
        </Box>
      )}

      <Paper className={classes.paper} elevation={0}>
        <Typography variant="caption" className={classes.stepMeta}>
          Step {activeStep + 1} of {STEPS.length}
        </Typography>
        <div className={classes.stepLegendRow}>
          {STEPS.map((label, index) => {
            const isDone = index < activeStep;
            const isActive = index === activeStep;
            return (
              <Chip
                key={`step-pill-${label}`}
                size="small"
                icon={
                  isDone ? (
                    <CheckCircleOutlineIcon fontSize="small" />
                  ) : (
                    <RadioButtonUncheckedIcon fontSize="small" />
                  )
                }
                label={label}
                className={`${classes.stepLegendChip} ${
                  isDone ? classes.stepLegendChipDone : ''
                } ${isActive ? classes.stepLegendChipActive : ''}`}
              />
            );
          })}
        </div>
        <Stepper activeStep={activeStep} alternativeLabel>
          {STEPS.map(step => (
            <Step key={step}>
              <StepLabel>{step}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box mt={2}>
          {activeStep === 0 && (
            <Grid container spacing={1}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  select
                  variant="outlined"
                  size="small"
                  label="Product"
                  value={state.product}
                  onChange={e => {
                    const product = e.target.value as WorkspaceProduct;
                    setState(prev => ({
                      ...prev,
                      product,
                      componentId: product === 'NETREVEAL' ? 'netreveal' : '',
                    }));
                  }}
                >
                  {PRODUCT_OPTIONS.map(product => (
                    <MenuItem key={product.id} value={product.id}>
                      {product.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                {isNetReveal ? (
                  <TextField
                    fullWidth
                    variant="outlined"
                    size="small"
                    label="Development Environment"
                    value="NetReveal Standalone Environment"
                    disabled
                    helperText="NetReveal is provisioned as one integrated development environment."
                  />
                ) : (
                  <TextField
                    fullWidth
                    select
                    variant="outlined"
                    size="small"
                    label="Component"
                    value={state.componentId}
                    onChange={e =>
                      setState(prev => ({
                        ...prev,
                        componentId: e.target.value,
                      }))
                    }
                  >
                    {availableComponents.map(component => (
                      <MenuItem key={component.id} value={component.id}>
                        {component.displayName}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </Grid>

              {isNetReveal && (
                <Grid item xs={12}>
                  <div className={classes.hintBox}>
                    <Typography className={classes.sectionTitle}>
                      NetReveal Technology Stack
                    </Typography>
                    <Typography className={classes.netRevealMeta}>
                      {selectedComponent
                        ? `${
                            selectedComponent.language.name
                          } ${selectedComponent.componentType.toUpperCase()} Workspace`
                        : 'Java ENGINE Workspace'}
                    </Typography>
                    <Typography className={classes.netRevealMetaSub}>
                      Runtime: {selectedComponent?.runtime.name ?? 'OpenJDK'}
                    </Typography>
                    <div
                      className={`${classes.techCardsGrid} ${classes.techCardsGridCompact}`}
                    >
                      {NETREVEAL_TECH_STACK.map(item => (
                        <div
                          key={item.component}
                          className={`${classes.techCard} ${classes.techCardCompact}`}
                        >
                          <Typography
                            className={`${classes.techCardTitle} ${classes.techCardCompactTitle}`}
                          >
                            {item.component}
                          </Typography>
                          <Typography
                            className={`${classes.techCardVersion} ${classes.techCardCompactVersion}`}
                          >
                            {item.version}
                          </Typography>
                          <Typography
                            className={`${classes.techCardRole} ${classes.techCardCompactRole}`}
                          >
                            {item.role}
                          </Typography>
                        </div>
                      ))}
                    </div>
                  </div>
                </Grid>
              )}

              {!isNetReveal && selectedComponent && (
                <Grid item xs={12}>
                  <div className={classes.compactPreviewWrap}>
                    <div className={classes.compactPreviewGrid}>
                      <div className={classes.compactPreviewCard}>
                        <Typography className={classes.sectionTitle}>
                          Technology
                        </Typography>
                        <div className={classes.compactList}>
                          {sriTechStack(selectedComponent).map(item => (
                            <div
                              key={item.component}
                              className={classes.compactListRow}
                            >
                              <span className={classes.compactListLabel}>
                                {item.component}
                              </span>
                              <span className={classes.compactListValue}>
                                {item.version}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className={classes.compactPreviewCard}>
                        <Typography className={classes.sectionTitle}>
                          Metadata
                        </Typography>
                        <div className={classes.compactList}>
                          <div className={classes.compactListRow}>
                            <span className={classes.compactListLabel}>
                              Primary Language
                            </span>
                            <span className={classes.compactListValue}>
                              {selectedComponent.language.name}
                            </span>
                          </div>
                          <div className={classes.compactListRow}>
                            <span className={classes.compactListLabel}>
                              Runtime
                            </span>
                            <span className={classes.compactListValue}>
                              {selectedComponent.runtime.name}
                            </span>
                          </div>
                          <div className={classes.compactListRow}>
                            <span className={classes.compactListLabel}>
                              Owning Team
                            </span>
                            <span className={classes.compactListValue}>
                              {selectedComponent.owner.team}
                            </span>
                          </div>
                          <div className={classes.compactListRow}>
                            <span className={classes.compactListLabel}>
                              Development Profile
                            </span>
                            <span className={classes.compactListValue}>
                              {selectedComponent.developmentProfile.id}:
                              {selectedComponent.developmentProfile.version}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className={classes.compactPreviewCard}>
                        <Typography className={classes.sectionTitle}>
                          Resources
                        </Typography>
                        <div className={classes.compactResourceList}>
                          <span className={classes.compactResourceItem}>
                            <CheckCircleOutlineIcon fontSize="small" />
                            GitHub Repository
                          </span>
                          <span className={classes.compactResourceItem}>
                            <BuildIcon fontSize="small" />
                            AKS Workspace Pod
                          </span>
                          <span className={classes.compactResourceItem}>
                            <VerifiedUserIcon fontSize="small" />
                            1Password Integration
                          </span>
                          <span className={classes.compactResourceItem}>
                            <CheckCircleOutlineIcon fontSize="small" />
                            Monitoring and Logging
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {selectedProfile && (
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      display="block"
                      style={{ marginTop: 6 }}
                    >
                      {selectedProfile.displayName} -{' '}
                      {selectedProfile.description}
                    </Typography>
                  )}
                </Grid>
              )}

              {isNetReveal && selectedComponent && (
                <Grid item xs={12}>
                  <div className={classes.hintBox}>
                    <Typography className={classes.sectionTitle}>
                      Resolved Component Metadata
                    </Typography>
                    <div className={classes.metadataGrid}>
                      <div className={classes.metadataRow}>
                        <span className={classes.metadataLabel}>
                          <CodeIcon fontSize="small" />
                          Primary Language
                        </span>
                        <span className={classes.metadataValue}>
                          {selectedComponent.language.name}
                        </span>
                      </div>
                      <div className={classes.metadataRow}>
                        <span className={classes.metadataLabel}>
                          <FlashOnIcon fontSize="small" />
                          Runtime
                        </span>
                        <span className={classes.metadataValue}>
                          {selectedComponent.runtime.name}
                        </span>
                      </div>
                      <div className={classes.metadataRow}>
                        <span className={classes.metadataLabel}>
                          <GroupIcon fontSize="small" />
                          Owning Team
                        </span>
                        <span className={classes.metadataValue}>
                          {selectedComponent.owner.team}
                        </span>
                      </div>
                      <div className={classes.metadataRow}>
                        <span className={classes.metadataLabel}>
                          <ExtensionIcon fontSize="small" />
                          Development Profile
                        </span>
                        <span className={classes.metadataValue}>
                          {selectedComponent.developmentProfile.id}:
                          {selectedComponent.developmentProfile.version}
                        </span>
                      </div>
                    </div>
                    {selectedProfile && (
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        display="block"
                        style={{ marginTop: 6 }}
                      >
                        {selectedProfile.displayName} -{' '}
                        {selectedProfile.description}
                      </Typography>
                    )}
                  </div>
                </Grid>
              )}

              {isNetReveal && selectedComponent && (
                <Grid item xs={12}>
                  <div className={classes.hintBox}>
                    <Typography className={classes.sectionTitle}>
                      Workspace Resources Preview
                    </Typography>
                    <div className={classes.resourcesList}>
                      <span className={classes.resourcesItem}>
                        <CheckCircleOutlineIcon fontSize="small" />
                        GitHub Repository
                      </span>
                      <span className={classes.resourcesItem}>
                        <BuildIcon fontSize="small" />
                        AKS Workspace Pod
                      </span>
                      <span className={classes.resourcesItem}>
                        <VerifiedUserIcon fontSize="small" />
                        1Password Integration
                      </span>
                      <span className={classes.resourcesItem}>
                        <CheckCircleOutlineIcon fontSize="small" />
                        Monitoring and Logging
                      </span>
                    </div>
                  </div>
                </Grid>
              )}
            </Grid>
          )}

          {activeStep === 1 && selectedComponent && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Source Provider"
                  value="GitHub"
                  disabled
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Organization"
                  value={resolvedRepository.organization}
                  disabled
                  helperText="Fixed organization: SymphonySensa"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Repository"
                  value={resolvedRepository.name}
                  disabled={Boolean(selectedComponent.repository.name)}
                  onChange={e =>
                    setState(prev => ({
                      ...prev,
                      repositoryName: e.target.value,
                    }))
                  }
                  helperText={
                    selectedComponent.repository.name
                      ? 'Resolved from SRI catalog'
                      : 'Repository not configured in catalog - provide name'
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Repository URL"
                  value={resolvedRepository.url}
                  disabled={Boolean(selectedComponent.repository.url)}
                  onChange={e =>
                    setState(prev => ({
                      ...prev,
                      repositoryUrl: e.target.value,
                    }))
                  }
                  helperText={
                    selectedComponent.repository.url
                      ? 'Resolved from SRI catalog'
                      : 'Optional when repository is manually specified'
                  }
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Branch"
                  value={state.branch}
                  onChange={e =>
                    setState(prev => ({ ...prev, branch: e.target.value }))
                  }
                />
              </Grid>
            </Grid>
          )}

          {activeStep === 2 && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Cloud Provider"
                  value="Azure"
                  disabled
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Runtime Platform"
                  value="Kubernetes"
                  disabled
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Workspace Mode"
                  value="Shared Team"
                  disabled
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  label="Workspace Namespace"
                  value={WORKSPACE_NAMESPACE}
                  helperText="Managed by platform configuration"
                  disabled
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  select
                  variant="outlined"
                  size="small"
                  label="Resource Profile"
                  value={state.resourceProfile}
                  onChange={e =>
                    setState(prev => ({
                      ...prev,
                      resourceProfile: e.target
                        .value as WizardState['resourceProfile'],
                    }))
                  }
                >
                  {options.resourceProfiles.map(profile => (
                    <MenuItem key={profile.id} value={profile.id}>
                      {profile.displayName} - {profile.description}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              {selectedComponent && (
                <Grid item xs={12}>
                  <div className={classes.hintBox}>
                    <Typography variant="body2" style={{ fontWeight: 600 }}>
                      Runtime Policy
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Platform resolves the workspace AKS target server-side and
                      provisions this workspace in {WORKSPACE_NAMESPACE}.
                    </Typography>
                  </div>
                </Grid>
              )}
            </Grid>
          )}

          {activeStep === 3 && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <div className={classes.hintBox}>
                  <Typography className={classes.sectionTitle}>
                    Optional Dependencies (Phase 1 metadata only)
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={state.services.postgresql}
                        onChange={e =>
                          setState(prev => ({
                            ...prev,
                            services: {
                              ...prev.services,
                              postgresql: e.target.checked,
                            },
                          }))
                        }
                        color="primary"
                      />
                    }
                    label="PostgreSQL"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={state.services.kafka}
                        onChange={e =>
                          setState(prev => ({
                            ...prev,
                            services: {
                              ...prev.services,
                              kafka: e.target.checked,
                            },
                          }))
                        }
                        color="primary"
                      />
                    }
                    label="Kafka"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={state.services.redis}
                        onChange={e =>
                          setState(prev => ({
                            ...prev,
                            services: {
                              ...prev.services,
                              redis: e.target.checked,
                            },
                          }))
                        }
                        color="primary"
                      />
                    }
                    label="Redis"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={state.services.objectStorage}
                        onChange={e =>
                          setState(prev => ({
                            ...prev,
                            services: {
                              ...prev.services,
                              objectStorage: e.target.checked,
                            },
                          }))
                        }
                        color="primary"
                      />
                    }
                    label="Object Storage"
                  />
                </div>
              </Grid>
            </Grid>
          )}

          {activeStep === 4 && selectedComponent && selectedResourceProfile && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <div className={classes.reviewIntro}>
                  <Typography variant="subtitle1" style={{ fontWeight: 800 }}>
                    Final Review
                  </Typography>
                  <Typography variant="body2" style={{ marginTop: 4 }}>
                    Verify the resolved catalog metadata, source branch, runtime
                    envelope, and platform baselines before launching
                    provisioning.
                  </Typography>
                </div>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" className={classes.summaryCard}>
                  <div className={classes.summaryCardBody}>
                    <Typography className={classes.summaryCardTitle}>
                      Application
                      <span className={classes.summaryPill}>Catalog</span>
                    </Typography>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Product</span>
                      <strong className={classes.rowValue}>
                        {productLabel(state.product)}
                      </strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Component</span>
                      <strong className={classes.rowValue}>
                        {selectedComponent.displayName}
                      </strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>
                        Language / Runtime
                      </span>
                      <strong className={classes.rowValue}>
                        {selectedComponent.language.name} /{' '}
                        {selectedComponent.runtime.name}
                      </strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>
                        Development Profile
                      </span>
                      <strong className={classes.rowValue}>
                        {selectedComponent.developmentProfile.id}:
                        {selectedComponent.developmentProfile.version}
                      </strong>
                    </div>
                  </div>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" className={classes.summaryCard}>
                  <div className={classes.summaryCardBody}>
                    <Typography className={classes.summaryCardTitle}>
                      Source
                      <span className={classes.summaryPill}>Git</span>
                    </Typography>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Repository</span>
                      <strong className={classes.rowValue}>
                        {resolvedRepository.organization}/
                        {resolvedRepository.name}
                      </strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Branch</span>
                      <strong className={classes.rowValue}>
                        {state.branch}
                      </strong>
                    </div>
                  </div>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" className={classes.summaryCard}>
                  <div className={classes.summaryCardBody}>
                    <Typography className={classes.summaryCardTitle}>
                      Workspace Runtime
                      <span className={classes.summaryPill}>Managed</span>
                    </Typography>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Cloud</span>
                      <strong className={classes.rowValue}>Azure</strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Cluster</span>
                      <strong className={classes.rowValue}>
                        Platform Managed
                      </strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Namespace</span>
                      <strong className={classes.rowValue}>
                        {WORKSPACE_NAMESPACE}
                      </strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Mode</span>
                      <strong className={classes.rowValue}>Shared Team</strong>
                    </div>
                    <div className={classes.row}>
                      <span className={classes.rowLabel}>Resource Profile</span>
                      <strong className={classes.rowValue}>
                        {selectedResourceProfile.displayName}
                      </strong>
                    </div>
                  </div>
                </Paper>
              </Grid>
            </Grid>
          )}
        </Box>

        <div className={classes.actions}>
          <Button
            disabled={activeStep === 0 || submitting}
            onClick={() => setActiveStep(step => Math.max(0, step - 1))}
          >
            Back
          </Button>

          <div>
            {activeStep < STEPS.length - 1 ? (
              <Button
                variant="contained"
                color="primary"
                disabled={!stepIsValid(activeStep)}
                onClick={() =>
                  setActiveStep(step => Math.min(STEPS.length - 1, step + 1))
                }
              >
                Next
              </Button>
            ) : (
              <Button
                variant="contained"
                color="primary"
                disabled={
                  !stepIsValid(activeStep) ||
                  submitting ||
                  provisioningInProgress
                }
                onClick={() => void createEnvironment()}
                startIcon={
                  submitting ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : undefined
                }
              >
                {createButtonLabel({ submitting, provisioningInProgress })}
              </Button>
            )}
          </div>
        </div>

        {consoleOpen && (
          <Paper elevation={0} className={classes.consoleCard}>
            <div className={classes.consoleHeader}>
              <Box display="flex" alignItems="center">
                <div className={classes.consoleDotRow}>
                  <span
                    className={classes.consoleDot}
                    style={{ background: '#F87171' }}
                  />
                  <span
                    className={classes.consoleDot}
                    style={{ background: '#FBBF24' }}
                  />
                  <span
                    className={classes.consoleDot}
                    style={{ background: '#4ADE80' }}
                  />
                </div>
                <Typography
                  variant="subtitle2"
                  style={{ fontWeight: 700, color: '#E2E8F0' }}
                >
                  Live Provisioning Console
                </Typography>
              </Box>
              <Box display="flex" alignItems="center" style={{ gap: 12 }}>
                <Typography variant="caption" style={{ color: '#94A3B8' }}>
                  {latestWorkspaceStatus
                    ? `Status: ${latestWorkspaceStatus} (${
                        streamMode === 'sse' ? 'SSE' : 'Polling'
                      })`
                    : `Status: initializing (${
                        streamMode === 'sse' ? 'SSE' : 'Polling'
                      })`}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onTogglePause}
                  style={{
                    color: '#E2E8F0',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  {consolePaused
                    ? `Resume${
                        pendingPausedCount > 0 ? ` (${pendingPausedCount})` : ''
                      }`
                    : 'Pause'}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onClearConsole}
                  style={{
                    color: '#E2E8F0',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  Clear
                </Button>
                <Button
                  size="small"
                  variant={followTail ? 'contained' : 'outlined'}
                  onClick={() => setFollowTail(value => !value)}
                  style={{
                    color: followTail ? '#0B1220' : '#93C5FD',
                    background: followTail ? '#93C5FD' : 'transparent',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  Follow Tail
                </Button>
                <Button
                  size="small"
                  variant={compactMode ? 'contained' : 'outlined'}
                  onClick={() => setCompactMode(value => !value)}
                  style={{
                    color: compactMode ? '#0B1220' : '#A7F3D0',
                    background: compactMode ? '#A7F3D0' : 'transparent',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  Compact
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onDownloadConsoleLogs}
                  style={{
                    color: '#E2E8F0',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  Download
                </Button>
                <Button
                  size="small"
                  variant={showInfo ? 'contained' : 'outlined'}
                  onClick={() => setShowInfo(value => !value)}
                  style={{
                    color: showInfo ? '#0B1220' : '#BFDBFE',
                    background: showInfo ? '#BFDBFE' : 'transparent',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                    minWidth: 56,
                  }}
                >
                  Info
                </Button>
                <Button
                  size="small"
                  variant={showWarn ? 'contained' : 'outlined'}
                  onClick={() => setShowWarn(value => !value)}
                  style={{
                    color: showWarn ? '#0B1220' : '#FDE68A',
                    background: showWarn ? '#FDE68A' : 'transparent',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                    minWidth: 56,
                  }}
                >
                  Warn
                </Button>
                <Button
                  size="small"
                  variant={showError ? 'contained' : 'outlined'}
                  onClick={() => setShowError(value => !value)}
                  style={{
                    color: showError ? '#0B1220' : '#FCA5A5',
                    background: showError ? '#FCA5A5' : 'transparent',
                    borderColor: 'rgba(148, 163, 184, 0.5)',
                    textTransform: 'none',
                    fontWeight: 700,
                    minWidth: 56,
                  }}
                >
                  Error
                </Button>
                {createdWorkspaceId && creationFinished && (
                  <Button
                    size="small"
                    variant="contained"
                    style={{
                      background: '#0EA5E9',
                      color: '#0B1220',
                      fontWeight: 700,
                    }}
                    onClick={() =>
                      navigate(`/workspaces/${createdWorkspaceId}`)
                    }
                  >
                    Open Workspace
                  </Button>
                )}
              </Box>
            </div>
            <div
              ref={consoleBodyRef}
              className={`${classes.consoleBody} ${
                compactMode ? classes.consoleBodyCompact : ''
              }`}
            >
              {consolePaused && pendingPausedCount > 0 && (
                <Typography
                  variant="body2"
                  className={classes.consoleWarn}
                  style={{ marginBottom: 8 }}
                >
                  Console is paused. {pendingPausedCount} new log{' '}
                  {pendingPausedCount === 1 ? 'line is' : 'lines are'} buffered.
                </Typography>
              )}
              {visibleConsoleLogs.length === 0 ? (
                <Typography variant="body2" className={classes.consoleMuted}>
                  {consoleLogs.length === 0
                    ? 'Waiting for provisioning events...'
                    : 'No log lines match the selected filters.'}
                </Typography>
              ) : (
                visibleConsoleLogs.map(line => {
                  const levelClass = consoleLevelClass(line.level, classes);

                  return (
                    <Typography
                      key={line.id}
                      variant="body2"
                      className={`${classes.consoleLine} ${
                        compactMode ? classes.consoleLineCompact : ''
                      } ${levelClass}`}
                    >
                      <span className={classes.consoleMuted}>
                        [{new Date(line.createdAt).toLocaleTimeString()}]
                      </span>{' '}
                      {line.message}
                    </Typography>
                  );
                })
              )}
            </div>
          </Paper>
        )}
      </Paper>
    </div>
  );
}

export const CreateDeveloperEnvironmentPage = CreateWorkspacePage;
