import { useCallback, useEffect, useState } from 'react';
import { Typography, Paper, Box, CircularProgress, Button } from '@mui/material';
import { makeStyles } from '@mui/styles';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';
import { DeveloperEnvironmentStatusBadge } from './DeveloperEnvironmentStatusBadge';
import type {
  ApplicationDeploymentRecord,
  CiWorkflowRecord,
  GenerateCiWorkflowResult,
  DeveloperEnvironmentRecord,
  DeveloperWorkspaceRecord,
  GenerateWorkspaceResult,
  WorkspaceConnectionRecord,
  WorkspaceConnectionSessionRecord,
} from './types';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1300,
    margin: '0 auto',
  },
  section: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '1px solid #E5E7EB',
    padding: theme.spacing(1.25, 0),
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  key: {
    color: '#6B7280',
    fontWeight: 600,
  },
  value: {
    fontWeight: 600,
    textAlign: 'right',
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  connectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
  inlineAction: {
    marginLeft: theme.spacing(1),
    minWidth: 64,
  },
  instructionLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.4),
  },
  instructionText: {
    flex: 1,
  },
  instructions: {
    marginTop: theme.spacing(1),
    color: '#4B5563',
    lineHeight: 1.5,
  },
  workflowList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  workflowJob: {
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    padding: theme.spacing(1.25),
    backgroundColor: '#F9FAFB',
  },
  workflowJobTitle: {
    fontWeight: 700,
    marginBottom: theme.spacing(0.5),
  },
  workflowStepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    paddingLeft: theme.spacing(1.5),
    margin: 0,
  },
  workflowStep: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    fontSize: '0.9rem',
  },
  workflowStepName: {
    color: '#374151',
    fontWeight: 500,
  },
  workflowStepStatus: {
    color: '#6B7280',
    fontWeight: 600,
  },
}));

function renderWorkflowStepStatus(
  status: 'queued' | 'in_progress' | 'completed',
  conclusion: string | null,
): string {
  if (status === 'completed') {
    return conclusion ? conclusion : 'completed';
  }
  return status.replace('_', ' ');
}

export function WorkspaceDetailsPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const { environmentId } = useParams<{ environmentId: string }>();
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceActionLoading, setWorkspaceActionLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionPreflightLoading, setConnectionPreflightLoading] =
    useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [ciActionLoading, setCiActionLoading] = useState(false);
  const [deployActionLoading, setDeployActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<DeveloperEnvironmentRecord | null>(null);
  const [workspace, setWorkspace] = useState<DeveloperWorkspaceRecord | null>(
    null,
  );
  const [workspaceConnection, setWorkspaceConnection] =
    useState<WorkspaceConnectionRecord | null>(null);
  const [workspaceSession, setWorkspaceSession] =
    useState<WorkspaceConnectionSessionRecord | null>(null);
  const [generated, setGenerated] = useState<GenerateWorkspaceResult | null>(
    null,
  );
  const [ciWorkflow, setCiWorkflow] = useState<CiWorkflowRecord | null>(null);
  const [generatedCi, setGeneratedCi] =
    useState<GenerateCiWorkflowResult | null>(null);
  const [deployments, setDeployments] = useState<ApplicationDeploymentRecord[]>(
    [],
  );

  const copyToClipboard = async (value: string, label: string) => {
    if (!value) return;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedLabel(label);
      window.setTimeout(
        () => setCopiedLabel(current => (current === label ? null : current)),
        1600,
      );
    } catch {
      setError(`Unable to copy ${label}.`);
    }
  };

  const loadWorkspaceConnection = useCallback(
    async (mode: 'preflight' | 'manual') => {
      if (!environmentId) {
        return;
      }
      if (mode === 'preflight') {
        setConnectionPreflightLoading(true);
      } else {
        setConnectionLoading(true);
      }

      try {
        const response = await backendFetch(
          'deployment-control-plane',
          `/workspaces/${encodeURIComponent(environmentId)}/connection`,
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(
            body.error ?? 'Failed to load workspace connection details',
          );
        }
        setWorkspaceConnection(body as WorkspaceConnectionRecord);
      } catch (e) {
        if (mode === 'manual') {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (mode === 'preflight') {
          setConnectionPreflightLoading(false);
        } else {
          setConnectionLoading(false);
        }
      }
    },
    [backendFetch, environmentId],
  );

  const refreshWorkspaceRecord = async () => {
    if (!environmentId) {
      return;
    }

    const response = await backendFetch(
      'deployment-control-plane',
      `/workspaces/${encodeURIComponent(environmentId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? 'Failed to refresh workspace details');
    }
    setItem(body as DeveloperEnvironmentRecord);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!environmentId) {
        setError('Environment ID is missing');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          `/workspaces/${encodeURIComponent(environmentId)}`,
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? 'Failed to load environment details');
        }
        if (!cancelled) {
          setItem(body as DeveloperEnvironmentRecord);
        }

        setWorkspaceLoading(true);
        const workspaceResponse = await backendFetch(
          'deployment-control-plane',
          `/workspaces/${encodeURIComponent(environmentId)}/workspace`,
        );
        const workspaceBody = await workspaceResponse.json();
        if (!workspaceResponse.ok) {
          throw new Error(
            workspaceBody.error ?? 'Failed to load workspace details',
          );
        }
        if (!cancelled) {
          setWorkspace(workspaceBody as DeveloperWorkspaceRecord);
        }

        try {
          const ciResponse = await backendFetch(
            'deployment-control-plane',
            `/workspaces/${encodeURIComponent(environmentId)}/ci-workflow`,
          );
          const ciBody = await ciResponse.json();
          const looksLikeCiWorkflow = Boolean(
            ciBody &&
              typeof ciBody === 'object' &&
              typeof (ciBody as { workflowStatus?: unknown }).workflowStatus ===
                'string' &&
              (ciBody as { buildProfile?: { adapter?: unknown } })
                .buildProfile &&
              typeof (ciBody as { buildProfile?: { adapter?: unknown } })
                .buildProfile?.adapter === 'string',
          );

          if (ciResponse.ok && looksLikeCiWorkflow && !cancelled) {
            setCiWorkflow(ciBody as CiWorkflowRecord);
          }
        } catch {
          // CI workflow section is optional if backend is not yet fully configured.
        }

        try {
          const deploymentsResponse = await backendFetch(
            'deployment-control-plane',
            `/workspaces/${encodeURIComponent(environmentId)}/deployments`,
          );
          const deploymentsBody = await deploymentsResponse.json();
          if (deploymentsResponse.ok && !cancelled) {
            setDeployments(
              Array.isArray(deploymentsBody.items) ? deploymentsBody.items : [],
            );
          }
        } catch {
          // Deployment history section is optional when backend endpoint is unavailable.
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false);
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [backendFetch, environmentId]);

  const handleValidateWorkspace = async () => {
    if (!environmentId) {
      return;
    }
    setWorkspaceActionLoading(true);
    setError(null);
    setGenerated(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/workspace/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to validate workspace');
      }
      setWorkspace(body as DeveloperWorkspaceRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkspaceActionLoading(false);
    }
  };

  const handleGenerateWorkspace = async () => {
    if (!environmentId) {
      return;
    }
    setWorkspaceActionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/workspace/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to generate workspace');
      }
      const generatedResult = body as GenerateWorkspaceResult;
      setGenerated(generatedResult);
      setWorkspace(generatedResult.workspace);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkspaceActionLoading(false);
    }
  };

  const handleStartWorkspace = async () => {
    if (!environmentId) {
      return;
    }

    setWorkspaceActionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to start workspace');
      }

      setItem(body as DeveloperEnvironmentRecord);
      await refreshWorkspaceRecord();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkspaceActionLoading(false);
    }
  };

  const handleStopWorkspace = async () => {
    if (!environmentId) {
      return;
    }

    setWorkspaceActionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/stop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to stop workspace');
      }

      setItem(body as DeveloperEnvironmentRecord);
      await refreshWorkspaceRecord();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkspaceActionLoading(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!environmentId) {
      return;
    }

    setWorkspaceActionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}`,
        {
          method: 'DELETE',
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to delete workspace');
      }

      navigate('/workspaces');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkspaceActionLoading(false);
    }
  };

  const handleConnectWorkspace = async () => {
    if (!environmentId) {
      return;
    }

    if (workspaceConnection?.connectionStatus !== 'READY') {
      setError(
        'Connection preflight is not READY. Click Check Connection and resolve any reported issue first.',
      );
      return;
    }

    setError(null);
    await loadWorkspaceConnection('manual');
  };

  const handleCheckConnection = async () => {
    setError(null);
    await loadWorkspaceConnection('preflight');
  };

  const handleStartManagedSession = async () => {
    if (!environmentId) {
      return;
    }

    if (workspaceConnection?.connectionStatus !== 'READY') {
      setError(
        'Connection preflight is not READY. Run Check Connection first.',
      );
      return;
    }

    setSessionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/connection/session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to start managed session');
      }

      const session = body as WorkspaceConnectionSessionRecord;
      setWorkspaceSession(session);
      if (session.sessionStatus === 'READY' && session.launchUrl) {
        window.open(session.launchUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    if (!environmentId || !item) {
      return;
    }
    void loadWorkspaceConnection('preflight');
  }, [environmentId, item, loadWorkspaceConnection]);

  const handleValidateCiWorkflow = async () => {
    if (!environmentId) {
      return;
    }

    setCiActionLoading(true);
    setError(null);
    setGeneratedCi(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/ci-workflow/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to validate CI workflow');
      }
      setCiWorkflow(body as CiWorkflowRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCiActionLoading(false);
    }
  };

  const handleGenerateCiWorkflow = async () => {
    if (!environmentId) {
      return;
    }

    setCiActionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/ci-workflow/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to generate CI workflow');
      }

      const generatedResult = body as GenerateCiWorkflowResult;
      setGeneratedCi(generatedResult);
      setCiWorkflow(generatedResult.workflow);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCiActionLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (!environmentId) {
      return;
    }

    setDeployActionLoading(true);
    setError(null);
    try {
      const sourceBranch = item?.sourceBranch ?? 'main';
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(environmentId)}/deployments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: {
              branch: sourceBranch,
            },
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to trigger deployment');
      }

      setDeployments(prev => [body as ApplicationDeploymentRecord, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployActionLoading(false);
    }
  };

  const handleSyncDeployment = async (deploymentId: string) => {
    if (!environmentId) {
      return;
    }

    setDeployActionLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        `/workspaces/${encodeURIComponent(
          environmentId,
        )}/deployments/${encodeURIComponent(deploymentId)}/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to sync deployment status');
      }

      const updated = body as ApplicationDeploymentRecord;
      setDeployments(prev =>
        prev.map(itemDeployment =>
          itemDeployment.id === updated.id ? updated : itemDeployment,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployActionLoading(false);
    }
  };

  let workspaceSectionContent: JSX.Element;
  if (workspaceLoading) {
    workspaceSectionContent = (
      <Box mt={2} display="flex" alignItems="center" style={{ gap: 10 }}>
        <CircularProgress size={20} />
        <Typography>Loading workspace details...</Typography>
      </Box>
    );
  } else if (!workspace) {
    workspaceSectionContent = (
      <Typography color="textSecondary">
        Workspace details are not available.
      </Typography>
    );
  } else {
    workspaceSectionContent = (
      <>
        <div className={classes.row}>
          <span className={classes.key}>Workspace Status</span>
          <span className={classes.value}>{workspace.workspaceStatus}</span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Workspace Status Message</span>
          <span className={classes.value}>
            {workspace.workspaceStatusMessage ?? 'N/A'}
          </span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Development Profile</span>
          <span className={classes.value}>
            {workspace.developmentProfileId}:
            {workspace.developmentProfileVersion}
          </span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Workspace Type</span>
          <span className={classes.value}>Dev Container</span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Development Image</span>
          <span className={classes.value}>{workspace.devContainerImage}</span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Repository</span>
          <span className={classes.value}>
            {workspace.repository.organization}/{workspace.repository.name}
          </span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Branch</span>
          <span className={classes.value}>{workspace.branch}</span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Dev Container</span>
          <span className={classes.value}>{workspace.devContainerStatus}</span>
        </div>
        <div className={classes.row}>
          <span className={classes.key}>Recommended IDE</span>
          <span className={classes.value}>VS Code</span>
        </div>

        <div className={classes.actionRow}>
          {workspace.repository.url && (
            <Button
              variant="outlined"
              onClick={() =>
                window.open(
                  workspace.repository.url ?? '',
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              Open Repository
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            disabled={
              connectionLoading ||
              connectionPreflightLoading ||
              item?.status !== 'READY' ||
              workspaceConnection?.connectionStatus !== 'READY'
            }
            onClick={() => void handleConnectWorkspace()}
          >
            {connectionLoading
              ? 'Refreshing Connection...'
              : 'Connect Workspace'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              sessionLoading ||
              connectionLoading ||
              connectionPreflightLoading ||
              workspaceConnection?.connectionStatus !== 'READY'
            }
            onClick={() => void handleStartManagedSession()}
          >
            {sessionLoading ? 'Starting Session...' : 'Start Managed Session'}
          </Button>
          <Button
            variant="outlined"
            disabled={connectionLoading || connectionPreflightLoading}
            onClick={() => void handleCheckConnection()}
          >
            {connectionPreflightLoading ? 'Checking...' : 'Check Connection'}
          </Button>
          <Button
            variant="outlined"
            disabled={workspaceActionLoading}
            onClick={() => void handleValidateWorkspace()}
          >
            Validate Workspace
          </Button>
          <Button
            variant="outlined"
            color="primary"
            disabled={workspaceActionLoading}
            onClick={() => void handleGenerateWorkspace()}
          >
            Generate Dev Container
          </Button>
        </div>

        {workspaceConnection && (
          <Box
            mt={2}
            p={2}
            style={{
              background: '#F8FAFC',
              borderRadius: 8,
              border: '1px solid #E2E8F0',
            }}
          >
            <div className={classes.connectionHeader}>
              <Typography variant="body2" style={{ fontWeight: 700 }}>
                Workspace Connection
              </Typography>
              {copiedLabel && (
                <Typography variant="caption" color="primary">
                  Copied {copiedLabel}
                </Typography>
              )}
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Connection Status</span>
              <span className={classes.value}>
                {workspaceConnection.connectionStatus}
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Mode</span>
              <span className={classes.value}>
                {workspaceConnection.connectionMode}
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Target Cluster</span>
              <span className={classes.value}>
                {workspaceConnection.targetCluster}
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Namespace</span>
              <span className={classes.value}>
                {workspaceConnection.namespace}
                <Button
                  size="small"
                  className={classes.inlineAction}
                  onClick={() =>
                    void copyToClipboard(
                      workspaceConnection.namespace,
                      'namespace',
                    )
                  }
                >
                  Copy
                </Button>
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Pod</span>
              <span className={classes.value}>
                {workspaceConnection.podName ?? 'N/A'}
                {workspaceConnection.podName && (
                  <Button
                    size="small"
                    className={classes.inlineAction}
                    onClick={() =>
                      void copyToClipboard(
                        workspaceConnection.podName ?? '',
                        'pod',
                      )
                    }
                  >
                    Copy
                  </Button>
                )}
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Container</span>
              <span className={classes.value}>
                {workspaceConnection.containerName}
                <Button
                  size="small"
                  className={classes.inlineAction}
                  onClick={() =>
                    void copyToClipboard(
                      workspaceConnection.containerName,
                      'container',
                    )
                  }
                >
                  Copy
                </Button>
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>VS Code Attach</span>
              <span className={classes.value}>
                {workspaceConnection.vscodeAttachHint}
                <Button
                  size="small"
                  className={classes.inlineAction}
                  onClick={() =>
                    void copyToClipboard(
                      workspaceConnection.vscodeAttachHint,
                      'attach hint',
                    )
                  }
                >
                  Copy
                </Button>
              </span>
            </div>
            {workspaceConnection.portForwardCommand && (
              <div className={classes.row}>
                <span className={classes.key}>Port Forward</span>
                <span className={classes.value}>
                  {workspaceConnection.portForwardCommand}
                  <Button
                    size="small"
                    className={classes.inlineAction}
                    onClick={() =>
                      void copyToClipboard(
                        workspaceConnection.portForwardCommand ?? '',
                        'port-forward command',
                      )
                    }
                  >
                    Copy
                  </Button>
                </span>
              </div>
            )}
            {workspaceConnection.reason && (
              <div className={classes.row}>
                <span className={classes.key}>Reason</span>
                <span className={classes.value}>
                  {workspaceConnection.reason}
                </span>
              </div>
            )}
            <Box mt={1}>
              {workspaceConnection.instructions.map((line, index) => (
                <div
                  key={`${line}-${index}`}
                  className={classes.instructionLine}
                >
                  <Typography
                    variant="body2"
                    className={classes.instructionText}
                  >{`${index + 1}. ${line}`}</Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() =>
                      void copyToClipboard(line, `step ${index + 1}`)
                    }
                  >
                    Copy
                  </Button>
                </div>
              ))}
            </Box>
          </Box>
        )}

        {workspaceSession && (
          <Box
            mt={2}
            p={2}
            style={{
              background: '#F9FAFB',
              borderRadius: 8,
              border: '1px solid #E5E7EB',
            }}
          >
            <Typography variant="body2" style={{ fontWeight: 700 }}>
              Managed Session
            </Typography>
            <div className={classes.row}>
              <span className={classes.key}>Session Status</span>
              <span className={classes.value}>
                {workspaceSession.sessionStatus}
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Mode</span>
              <span className={classes.value}>
                {workspaceSession.sessionMode}
              </span>
            </div>
            <div className={classes.row}>
              <span className={classes.key}>Expires At</span>
              <span className={classes.value}>
                {workspaceSession.expiresAt
                  ? new Date(workspaceSession.expiresAt).toLocaleString()
                  : 'N/A'}
              </span>
            </div>
            {workspaceSession.reason && (
              <div className={classes.row}>
                <span className={classes.key}>Reason</span>
                <span className={classes.value}>{workspaceSession.reason}</span>
              </div>
            )}
            {workspaceSession.launchUrl && (
              <div className={classes.actionRow}>
                <Button
                  variant="outlined"
                  onClick={() =>
                    window.open(
                      workspaceSession.launchUrl ?? '',
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  Open Session URL
                </Button>
                <Button
                  variant="outlined"
                  onClick={() =>
                    void copyToClipboard(
                      workspaceSession.launchUrl ?? '',
                      'session URL',
                    )
                  }
                >
                  Copy Session URL
                </Button>
              </div>
            )}
            <Box mt={1}>
              {workspaceSession.instructions.map((line, index) => (
                <div
                  key={`${line}-${index}`}
                  className={classes.instructionLine}
                >
                  <Typography
                    variant="body2"
                    className={classes.instructionText}
                  >{`${index + 1}. ${line}`}</Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() =>
                      void copyToClipboard(line, `session step ${index + 1}`)
                    }
                  >
                    Copy
                  </Button>
                </div>
              ))}
            </Box>
          </Box>
        )}

        <div className={classes.instructions}>
          {workspace.setupInstructions.map((line, index) => (
            <Typography key={`${line}-${index}`} variant="body2">{`${
              index + 1
            }. ${line}`}</Typography>
          ))}
        </div>

        {generated && generated.generatedFiles[0] && (
          <Box mt={2} p={2} style={{ background: '#F3F4F6', borderRadius: 8 }}>
            <Typography variant="body2" style={{ fontWeight: 700 }}>
              Generated .devcontainer/devcontainer.json
            </Typography>
            <Typography
              variant="caption"
              color="textSecondary"
              display="block"
              style={{ marginTop: 4 }}
            >
              Copy this content to the target repository via pull request
              workflow.
            </Typography>
            <Box
              mt={1}
              style={{
                maxHeight: 260,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              {generated.generatedFiles[0].content}
            </Box>
          </Box>
        )}
      </>
    );
  }

  if (loading) {
    return (
      <div className={classes.root}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/workspaces')}
        >
          Back to My Workspaces
        </Button>
        <Box mt={2} display="flex" alignItems="center" style={{ gap: 10 }}>
          <CircularProgress size={24} />
          <Typography>Loading environment details...</Typography>
        </Box>
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.root}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/workspaces')}
        >
          Back to My Workspaces
        </Button>
        <Box
          mt={2}
          p={2}
          style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8 }}
        >
          {error}
        </Box>
      </div>
    );
  }

  if (!item) {
    return (
      <div className={classes.root}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/workspaces')}
        >
          Back to My Workspaces
        </Button>
        <Typography>Environment not found</Typography>
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

      <>
        <Box
          mt={2}
          mb={2}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <div>
            <Typography variant="h4" style={{ fontWeight: 700 }}>
              {item.displayName}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {item.name}
            </Typography>
          </div>
          <DeveloperEnvironmentStatusBadge status={item.status} />
        </Box>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Overview
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Application</span>
            <span className={classes.value}>{item.componentDisplayName}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Component ID</span>
            <span className={classes.value}>{item.componentId}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Development Profile</span>
            <span className={classes.value}>
              {item.developmentProfileId}:{item.developmentProfileVersion}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Owner Team</span>
            <span className={classes.value}>{item.ownerTeam}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Requested By</span>
            <span className={classes.value}>{item.requestedBy}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Created</span>
            <span className={classes.value}>
              {new Date(item.createdAt).toLocaleString()}
            </span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Source
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Provider</span>
            <span className={classes.value}>
              {item.sourceRepositoryProvider}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Repository</span>
            <span className={classes.value}>
              {item.sourceRepositoryOrganization}/{item.sourceRepositoryName}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Branch</span>
            <span className={classes.value}>{item.sourceBranch}</span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Workspace Runtime
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Cloud</span>
            <span className={classes.value}>{item.cloudProvider}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Platform</span>
            <span className={classes.value}>{item.runtimePlatform}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Platform Cluster</span>
            <span className={classes.value}>{item.clusterName}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Workspace Namespace</span>
            <span className={classes.value}>
              {item.namespace} ({item.namespaceStatus})
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Resource Profile</span>
            <span className={classes.value}>{item.resourceProfile}</span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Platform Services
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Container Registry</span>
            <span className={classes.value}>
              {item.platformServices?.containerRegistry?.enabled
                ? 'Enabled'
                : 'Disabled'}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Secrets</span>
            <span className={classes.value}>
              {item.platformServices?.secrets?.provider ?? 'N/A'} (
              {item.platformServices?.secrets?.status ?? 'UNKNOWN'})
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Ingress</span>
            <span className={classes.value}>
              {item.platformServices?.ingress?.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Observability</span>
            <span className={classes.value}>
              Logs:{' '}
              {String(item.platformServices?.observability?.logs ?? false)}{' '}
              Metrics:{' '}
              {String(item.platformServices?.observability?.metrics ?? false)}{' '}
              Traces:{' '}
              {String(item.platformServices?.observability?.traces ?? false)}
            </span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Security Baseline
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>RBAC</span>
            <span className={classes.value}>
              {item.securityBaseline?.rbac ?? 'N/A'}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Resource Quota</span>
            <span className={classes.value}>
              {item.securityBaseline?.resourceQuota ?? 'N/A'}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Network Policy</span>
            <span className={classes.value}>
              {item.securityBaseline?.networkPolicy ?? 'N/A'}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Pod Security</span>
            <span className={classes.value}>
              {item.securityBaseline?.podSecurity ?? 'N/A'}
            </span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Lifecycle
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Current Status</span>
            <span className={classes.value}>{item.status}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Status Message</span>
            <span className={classes.value}>{item.statusMessage ?? 'N/A'}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Last Transition</span>
            <span className={classes.value}>
              {new Date(item.lastTransitionAt).toLocaleString()}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Failure Reason</span>
            <span className={classes.value}>
              {item.failureReason ?? 'Not Available'}
            </span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Developer Workspace
          </Typography>

          <div className={classes.actionRow}>
            <Button
              variant="outlined"
              color="primary"
              disabled={workspaceActionLoading}
              onClick={() => void handleStartWorkspace()}
            >
              Start Workspace
            </Button>
            <Button
              variant="outlined"
              disabled={workspaceActionLoading}
              onClick={() => void handleStopWorkspace()}
            >
              Stop Workspace
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              disabled={workspaceActionLoading}
              onClick={() => void handleDeleteWorkspace()}
            >
              Delete Workspace
            </Button>
          </div>

          {workspaceSectionContent}
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            CI/CD Workflow
          </Typography>

          {!ciWorkflow ? (
            <Typography color="textSecondary">
              CI workflow details are not available.
            </Typography>
          ) : (
            <>
              <div className={classes.row}>
                <span className={classes.key}>Workflow Status</span>
                <span className={classes.value}>
                  {ciWorkflow.workflowStatus}
                </span>
              </div>
              <div className={classes.row}>
                <span className={classes.key}>Status Message</span>
                <span className={classes.value}>
                  {ciWorkflow.workflowStatusMessage ?? 'N/A'}
                </span>
              </div>
              <div className={classes.row}>
                <span className={classes.key}>Build Adapter</span>
                <span className={classes.value}>
                  {ciWorkflow.buildProfile?.adapter ?? 'N/A'}
                </span>
              </div>
              <div className={classes.row}>
                <span className={classes.key}>CI Workflow File</span>
                <span className={classes.value}>
                  {ciWorkflow.ciWorkflowPath}
                </span>
              </div>
              <div className={classes.row}>
                <span className={classes.key}>Deploy Workflow File</span>
                <span className={classes.value}>
                  {ciWorkflow.deployWorkflowPath}
                </span>
              </div>
              <div className={classes.row}>
                <span className={classes.key}>Branch Policy</span>
                <span className={classes.value}>
                  {ciWorkflow.branchPolicy.allowedBranches.join(', ')}
                </span>
              </div>

              <div className={classes.actionRow}>
                <Button
                  variant="outlined"
                  disabled={ciActionLoading}
                  onClick={() => void handleValidateCiWorkflow()}
                >
                  Validate CI Workflow
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  disabled={ciActionLoading}
                  onClick={() => void handleGenerateCiWorkflow()}
                >
                  Generate Thin Workflows
                </Button>
              </div>

              {generatedCi && generatedCi.workflow.generatedFiles[0] && (
                <Box
                  mt={2}
                  p={2}
                  style={{ background: '#F3F4F6', borderRadius: 8 }}
                >
                  <Typography variant="body2" style={{ fontWeight: 700 }}>
                    Generated CI/CD Workflow Templates
                  </Typography>
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    display="block"
                    style={{ marginTop: 4 }}
                  >
                    Add these files via pull request in the application
                    repository.
                  </Typography>
                  {generatedCi.workflow.generatedFiles.map(file => (
                    <Box key={file.path} mt={1}>
                      <Typography variant="caption" color="textSecondary">
                        {file.path}
                      </Typography>
                      <Box
                        mt={1}
                        style={{
                          maxHeight: 220,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                          fontSize: 12,
                        }}
                      >
                        {file.content}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </>
          )}
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Application Deployments
          </Typography>

          <div className={classes.actionRow}>
            <Button
              variant="contained"
              color="primary"
              disabled={deployActionLoading}
              onClick={() => void handleDeploy()}
            >
              Redeploy
            </Button>
          </div>

          {deployments.length === 0 ? (
            <Typography color="textSecondary" style={{ marginTop: 8 }}>
              No application deployments recorded yet.
            </Typography>
          ) : (
            <>
              {deployments.slice(0, 5).map(deployment => (
                <Box
                  key={deployment.id}
                  mt={2}
                  p={2}
                  style={{ border: '1px solid #E5E7EB', borderRadius: 8 }}
                >
                  <div className={classes.row}>
                    <span className={classes.key}>Deployment</span>
                    <span className={classes.value}>{deployment.id}</span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Status</span>
                    <span className={classes.value}>{deployment.status}</span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Commit</span>
                    <span className={classes.value}>
                      {deployment.commitSha}
                    </span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Image</span>
                    <span className={classes.value}>
                      {deployment.imageRepository}:{deployment.imageTag}
                    </span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Namespace</span>
                    <span className={classes.value}>
                      {deployment.namespace}
                    </span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Endpoint</span>
                    <span className={classes.value}>
                      {deployment.endpointUrl ?? 'N/A'}
                    </span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Started</span>
                    <span className={classes.value}>
                      {new Date(deployment.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className={classes.row}>
                    <span className={classes.key}>Completed</span>
                    <span className={classes.value}>
                      {deployment.completedAt
                        ? new Date(deployment.completedAt).toLocaleString()
                        : 'In Progress'}
                    </span>
                  </div>

                  <Box mt={1}>
                    <Typography variant="body2" style={{ fontWeight: 700 }}>
                      Pipeline
                    </Typography>
                    {deployment.pipelineStages.map(stage => (
                      <div
                        key={`${deployment.id}-${stage.id}`}
                        className={classes.row}
                      >
                        <span className={classes.key}>{stage.id}</span>
                        <span className={classes.value}>{stage.status}</span>
                      </div>
                    ))}
                  </Box>

                  {deployment.workflowRun ? (
                    <Box mt={2}>
                      <Typography variant="body2" style={{ fontWeight: 700 }}>
                        Workflow Run
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {deployment.workflowRun.htmlUrl}
                      </Typography>
                      <div className={classes.workflowList}>
                        {deployment.workflowRun.jobs.map(job => (
                          <div key={job.id} className={classes.workflowJob}>
                            <div className={classes.workflowJobTitle}>
                              {job.name}
                            </div>
                            <div className={classes.workflowStepList}>
                              {job.steps.map(step => (
                                <div
                                  key={`${job.id}-${step.number}`}
                                  className={classes.workflowStep}
                                >
                                  <span className={classes.workflowStepName}>
                                    {step.number}. {step.name}
                                  </span>
                                  <span className={classes.workflowStepStatus}>
                                    {renderWorkflowStepStatus(
                                      step.status,
                                      step.conclusion,
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Box>
                  ) : null}

                  <div className={classes.actionRow}>
                    <Button
                      variant="outlined"
                      onClick={() =>
                        navigate(
                          `/workspaces/${encodeURIComponent(
                            item.id,
                          )}/deployments/${encodeURIComponent(deployment.id)}`,
                        )
                      }
                    >
                      View Details
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={deployActionLoading}
                      onClick={() => void handleSyncDeployment(deployment.id)}
                    >
                      Sync Status
                    </Button>
                    {deployment.workflowRunUrl && (
                      <Button
                        variant="outlined"
                        href={deployment.workflowRunUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View Pipeline
                      </Button>
                    )}
                    {deployment.endpointUrl && (
                      <Button
                        variant="outlined"
                        href={deployment.endpointUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Endpoint
                      </Button>
                    )}
                  </div>
                </Box>
              ))}
            </>
          )}
        </Paper>
      </>
    </div>
  );
}

export const DeveloperEnvironmentDetailsPage = WorkspaceDetailsPage;
