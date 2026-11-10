import { useEffect, useState } from 'react';
import { Typography, Paper, Box, CircularProgress, Button } from '@mui/material';
import { makeStyles } from '@mui/styles';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { ApplicationDeploymentRecord } from './types';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1100,
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

export function DeploymentDetailsPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const { environmentId, deploymentId } = useParams<{
    environmentId: string;
    deploymentId: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployment, setDeployment] =
    useState<ApplicationDeploymentRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!environmentId || !deploymentId) {
        setError('Environment ID or deployment ID is missing');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          `/workspaces/${encodeURIComponent(
            environmentId,
          )}/deployments/${encodeURIComponent(deploymentId)}`,
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? 'Failed to load deployment details');
        }

        if (!cancelled) {
          setDeployment(body as ApplicationDeploymentRecord);
        }
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
  }, [backendFetch, environmentId, deploymentId]);

  const handleSyncDeployment = async () => {
    if (!environmentId || !deploymentId) {
      return;
    }

    setSyncing(true);
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

      setDeployment(body as ApplicationDeploymentRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  let pageContent: JSX.Element;
  if (loading) {
    pageContent = (
      <Box mt={2} display="flex" alignItems="center" style={{ gap: 10 }}>
        <CircularProgress size={24} />
        <Typography>Loading deployment details...</Typography>
      </Box>
    );
  } else if (error) {
    pageContent = (
      <Box
        mt={2}
        p={2}
        style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8 }}
      >
        {error}
      </Box>
    );
  } else if (!deployment) {
    pageContent = <Typography>Deployment not found</Typography>;
  } else {
    pageContent = (
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

        {deployment.workflowRun ? (
          <Paper className={classes.section} elevation={0}>
            <Typography variant="h6" style={{ fontWeight: 700 }}>
              Workflow Run
            </Typography>
            <Typography variant="body2" style={{ marginBottom: 8 }}>
              {deployment.workflowRun.htmlUrl}
            </Typography>
            <div className={classes.workflowList}>
              {deployment.workflowRun.jobs.map(job => (
                <div key={job.id} className={classes.workflowJob}>
                  <div className={classes.workflowJobTitle}>{job.name}</div>
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
          </Paper>
        ) : null}
              Deployment Details
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {deployment.id}
            </Typography>
          </div>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            {deployment.status}
          </Typography>
        </Box>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Artifact
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Component</span>
            <span className={classes.value}>{deployment.componentId}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Repository</span>
            <span className={classes.value}>{deployment.repository}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Branch</span>
            <span className={classes.value}>{deployment.branch}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Commit</span>
            <span className={classes.value}>{deployment.commitSha}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Image</span>
            <span className={classes.value}>
              {deployment.imageRepository}:{deployment.imageTag}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Digest</span>
            <span className={classes.value}>
              {deployment.imageDigest ?? 'N/A'}
            </span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Target
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Cluster</span>
            <span className={classes.value}>{deployment.clusterName}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Namespace</span>
            <span className={classes.value}>{deployment.namespace}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Release</span>
            <span className={classes.value}>{deployment.releaseName}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Executor</span>
            <span className={classes.value}>{deployment.executorType}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Strategy</span>
            <span className={classes.value}>
              {deployment.deploymentStrategy}
            </span>
          </div>
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Lifecycle
          </Typography>
          <div className={classes.row}>
            <span className={classes.key}>Status</span>
            <span className={classes.value}>{deployment.status}</span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Message</span>
            <span className={classes.value}>
              {deployment.statusMessage ?? 'N/A'}
            </span>
          </div>
          <div className={classes.row}>
            <span className={classes.key}>Failure Reason</span>
            <span className={classes.value}>
              {deployment.failureReason ?? 'N/A'}
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
        </Paper>

        <Paper className={classes.section} elevation={0}>
          <Typography variant="h6" style={{ fontWeight: 700 }}>
            Pipeline Stages
          </Typography>
          {deployment.pipelineStages.map(stage => (
            <div key={stage.id} className={classes.row}>
              <span className={classes.key}>{stage.id}</span>
              <span className={classes.value}>{stage.status}</span>
            </div>
          ))}

          <div className={classes.actionRow}>
            <Button
              variant="outlined"
              disabled={syncing}
              onClick={() => void handleSyncDeployment()}
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
        </Paper>

        {deployment.workflowRun ? (
          <Paper className={classes.section} elevation={0}>
            <Typography variant="h6" style={{ fontWeight: 700 }}>
              Workflow Run
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {deployment.workflowRun.htmlUrl}
            </Typography>
            <div className={classes.workflowList}>
              {deployment.workflowRun.jobs.map(job => (
                <div key={job.id} className={classes.workflowJob}>
                  <div className={classes.workflowJobTitle}>{job.name}</div>
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
                          {renderWorkflowStepStatus(step.status, step.conclusion)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Paper>
        ) : null}
      </>
    );
  }

  return (
    <div className={classes.root}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() =>
          navigate(`/workspaces/${encodeURIComponent(environmentId ?? '')}`)
        }
      >
        Back to Workspace Details
      </Button>
      {pageContent}
    </div>
  );
}
