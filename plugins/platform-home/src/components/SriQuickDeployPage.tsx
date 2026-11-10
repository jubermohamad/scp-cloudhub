/**
 * SRI Quick Deploy Page — Streamlined deployment with inline approval
 *
 * Simpler alternative to DeploymentWizard:
 * - Deployment config inputs
 * - DeploymentActionButtons for control
 * - SendForApprovalButton for approval gate
 * - Deploy button unlocked only after approval
 *
 * Better for:
 * - Quick deployments without multi-step wizard
 * - Showing approval workflow inline
 * - SRI component deployments
 */

import { useState } from 'react';
import { Box, Paper, TextField, Typography, Grid, FormControl, InputLabel, Select, MenuItem, CircularProgress } from '@mui/material';
import { makeStyles } from '@mui/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { DeploymentActionButtons } from './DeploymentActionButtons';
import { SendForApprovalButton } from './SendForApprovalButton';
import { useBackendFetch } from '@internal/plugin-platform-common';
import type { DeploymentPhase } from './DeploymentActionButtons';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1200,
    margin: '0 auto',
  },
  header: {
    marginBottom: theme.spacing(3),
  },
  title: {
    fontWeight: 700,
    marginBottom: theme.spacing(1),
  },
  subtitle: {
    color: theme.palette.text.secondary,
  },
  configSection: {
    padding: theme.spacing(3),
    marginBottom: theme.spacing(2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
  },
  configGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  buttonSection: {
    padding: theme.spacing(2.5),
    marginBottom: theme.spacing(2),
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  approvalGate: {
    padding: theme.spacing(2.5),
    marginBottom: theme.spacing(2),
    backgroundColor: '#FFFBEB',
    border: `1px solid #FCD34D`,
    borderRadius: 8,
  },
  successBox: {
    padding: theme.spacing(2.5),
    marginBottom: theme.spacing(2),
    backgroundColor: '#ECFDF5',
    border: `1px solid #10B981`,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  successIcon: {
    color: '#10B981',
    fontSize: '1.5rem',
  },
  errorBox: {
    padding: theme.spacing(2.5),
    marginBottom: theme.spacing(2),
    backgroundColor: '#FEF2F2',
    border: `1px solid #DC2626`,
    borderRadius: 8,
  },
  statusChip: {
    marginRight: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: '0.75rem',
    color: '#fff',
  },
  stepActive: {
    backgroundColor: '#3B82F6',
  },
  stepCompleted: {
    backgroundColor: '#10B981',
  },
  stepPending: {
    backgroundColor: '#9CA3AF',
  },
}));

interface DeploymentConfig {
  component: string;
  instance: string;
  env: string;
  namespacePrefix: string;
  hostPrefix: string;
  dnsZone: string;
  cluster: string;
}

export function SriQuickDeployPage(): JSX.Element {
  const classes = useStyles();
  const backendFetch = useBackendFetch();

  // ============= STATE =============
  const [config, setConfig] = useState<DeploymentConfig>({
    component: 'sri-investigation',
    instance: 'dt-svc-001',
    env: 'dev',
    namespacePrefix: 'sri-dev',
    hostPrefix: 'dev',
    dnsZone: 'example.com',
    cluster: 'aks-scp-dev-sdc-st-cms',
  });

  const [phase, setPhase] = useState<DeploymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Approval state
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<
    'PENDING' | 'APPROVED' | 'REJECTED' | null
  >(null);
  const [helmfile, setHelmfile] = useState<string>('');

  // Deployment state
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<string | null>(null);

  // ============= HANDLERS =============

  const handleValidate = async () => {
    setPhase('validating');
    setError(null);

    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/deployments/validate',
        {
          method: 'POST',
          body: JSON.stringify(config),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Validation failed');
      }

      setPhase('validated');
    } catch (err) {
      setPhase('validation-failed');
      setError((err as Error).message);
    }
  };

  const handleGenerateConfig = async () => {
    setPhase('generating');
    setError(null);

    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/deployments/generate-helmfile',
        {
          method: 'POST',
          body: JSON.stringify(config),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Generation failed');
      }

      const data = await response.json();
      setHelmfile(data.helmfile);
      setPhase('generated');
    } catch (err) {
      setPhase('generated');
      setError((err as Error).message);
    }
  };

  const handleUpdate = async () => {
    // This is called by DeploymentActionButtons when "Update" button is clicked.
    // For approval flow, the approval button handles the actual submission.
    if (phase === 'generated') {
      return;
    }
  };

  const handleDeploy = async () => {
    // Check if approved
    if (approvalStatus !== 'APPROVED') {
      setError('❌ Deployment requires approval from GRP-CloudHub-PlatformAdmin');
      return;
    }

    setPhase('deploying');
    setError(null);

    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/deployments/trigger',
        {
          method: 'POST',
          body: JSON.stringify({
            approvalId,
            config,
            helmfile,
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Deployment trigger failed');
      }

      const deployment = await response.json();
      setDeploymentId(deployment.id);

      // Poll for completion
      const pollDeploymentStatus = async () => {
        const statusResp = await backendFetch(
          'deployment-control-plane',
          `/deployments/${deployment.id}`,
          { method: 'GET' },
        );

        const status = await statusResp.json();

        if (status.isTerminal) {
          if (status.isSuccess) {
            setPhase('deployed');
            setDeploymentStatus('success');
            setSuccess(
              `✅ Deployment successful! ${config.component} deployed to ${config.cluster}`,
            );
          } else {
            setPhase('deploy-failed');
            setDeploymentStatus('failed');
            setError(status.error || '❌ Deployment failed');
          }
        } else {
          // Still running
          setDeploymentStatus(status.status || 'Running...');
          setTimeout(pollDeploymentStatus, 10000); // Check every 10 seconds
        }
      };

      pollDeploymentStatus();
    } catch (err) {
      setPhase('deploy-failed');
      setError((err as Error).message);
    }
  };

  const handleCancel = () => {
    setPhase('idle');
    setError(null);
    setSuccess(null);
    setApprovalId(null);
    setApprovalStatus(null);
    setHelmfile('');
    setDeploymentId(null);
    setDeploymentStatus(null);
  };

  const handleConfigChange = (key: keyof DeploymentConfig, value: string) => {
    if (phase === 'idle' || phase === 'validation-failed') {
      setConfig(prev => ({ ...prev, [key]: value }));
      setError(null);
    }
  };

  // ============= RENDER HELPERS =============

  const getStepNumber = (stepPhase: DeploymentPhase): number => {
    const steps: Record<DeploymentPhase, number> = {
      idle: 0,
      validating: 1,
      validated: 1,
      'validation-failed': 1,
      generating: 2,
      generated: 2,
      updating: 3,
      updated: 3,
      deploying: 4,
      deployed: 4,
      'deploy-failed': 4,
    };
    return steps[stepPhase] || 0;
  };

  const getStepClass = (stepNum: number, currentStep: number): string => {
    if (stepNum < currentStep) return classes.stepCompleted;
    if (stepNum === currentStep) return classes.stepActive;
    return classes.stepPending;
  };

  const currentStep = getStepNumber(phase);

  // ============= RENDER =============

  return (
    <Box className={classes.root}>
      {/* Header */}
      <Box className={classes.header}>
        <Typography variant="h4" className={classes.title}>
          🚀 Deploy SRI Component
        </Typography>
        <Typography className={classes.subtitle}>
          Streamlined deployment with approval gate. Cluster: {config.cluster}
        </Typography>
      </Box>

      {/* Step Indicator */}
      <Box style={{ marginBottom: 24 }}>
        <Grid container spacing={2}>
          {[
            { num: 1, label: 'Config' },
            { num: 2, label: 'Generate' },
            { num: 3, label: 'Approve' },
            { num: 4, label: 'Deploy' },
          ].map(step => (
            <Grid item key={step.num}>
              <Box className={classes.stepIndicator}>
                <Box
                  className={`${classes.stepDot} ${getStepClass(
                    step.num,
                    currentStep,
                  )}`}
                >
                  {step.num < currentStep ? '✓' : step.num}
                </Box>
                <Typography variant="body2">{step.label}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Configuration Section */}
      <Paper className={classes.configSection}>
        <Typography variant="h6" style={{ marginBottom: 16, fontWeight: 600 }}>
          1️⃣ Deployment Configuration
        </Typography>
        <Grid container spacing={2} className={classes.configGrid}>
          <FormControl fullWidth variant="outlined" size="small">
            <InputLabel>Component</InputLabel>
            <Select
              value={config.component}
              onChange={e =>
                handleConfigChange('component', e.target.value as string)
              }
              disabled={phase !== 'idle' && phase !== 'validation-failed'}
              label="Component"
            >
              <MenuItem value="sri-investigation">SRI Investigation</MenuItem>
              <MenuItem value="sri-data">SRI Data</MenuItem>
              <MenuItem value="sri-detection">SRI Detection</MenuItem>
              <MenuItem value="sri-agents">SRI Agents</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Instance Name"
            value={config.instance}
            onChange={e => handleConfigChange('instance', e.target.value)}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            variant="outlined"
            size="small"
            fullWidth
            placeholder="e.g., dt-svc-001"
          />

          <FormControl fullWidth variant="outlined" size="small">
            <InputLabel>Environment</InputLabel>
            <Select
              value={config.env}
              onChange={e => handleConfigChange('env', e.target.value as string)}
              disabled={phase !== 'idle' && phase !== 'validation-failed'}
              label="Environment"
            >
              <MenuItem value="dev">Development</MenuItem>
              <MenuItem value="staging">Staging</MenuItem>
              <MenuItem value="prod">Production</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Namespace Prefix"
            value={config.namespacePrefix}
            onChange={e =>
              handleConfigChange('namespacePrefix', e.target.value)
            }
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            variant="outlined"
            size="small"
            fullWidth
          />

          <TextField
            label="Host Prefix"
            value={config.hostPrefix}
            onChange={e => handleConfigChange('hostPrefix', e.target.value)}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            variant="outlined"
            size="small"
            fullWidth
          />

          <TextField
            label="DNS Zone"
            value={config.dnsZone}
            onChange={e => handleConfigChange('dnsZone', e.target.value)}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            variant="outlined"
            size="small"
            fullWidth
          />
        </Grid>
      </Paper>

      {/* Action Buttons Section */}
      <Paper className={classes.buttonSection}>
        <Typography variant="subtitle2" style={{ marginBottom: 12 }}>
          Workflow Controls
        </Typography>
        <DeploymentActionButtons
          phase={phase}
          callbacks={{
            onValidate: handleValidate,
            onGenerateConfig: handleGenerateConfig,
            onUpdate: handleUpdate,
            onDeploy: handleDeploy,
            onCancel: handleCancel,
          }}
          disabled={phase === 'deploying'}
          showProgress
        />
      </Paper>

      {/* Approval Gate Section */}
      {(phase === 'generated' || phase === 'updated') && (
        <Paper className={classes.approvalGate}>
          <Typography variant="h6" style={{ marginBottom: 12, fontWeight: 600 }}>
            📋 Approval Required
          </Typography>
          <Typography
            variant="body2"
            color="textSecondary"
            style={{ marginBottom: 16 }}
          >
            Submit your deployment for approval by GRP-CloudHub-PlatformAdmin.
            Admins will review the Helmfile and configuration before deployment.
          </Typography>

          <SendForApprovalButton
            config={{
              component: config.component,
              instance: config.instance,
              helmfile: helmfile,
              config: config,
            }}
            disabled={!helmfile}
            onApprovalSubmitted={id => {
              setApprovalId(id);
            }}
            onApprovalApproved={() => {
              setApprovalStatus('APPROVED');
              setSuccess(
                '✅ Approved! You can now click Deploy to proceed.',
              );
              setPhase('updated');
            }}
            onApprovalRejected={reason => {
              setApprovalStatus('REJECTED');
              setError(
                `❌ Deployment rejected${reason ? `: ${reason}` : ''}. Please reconfigure and resubmit.`,
              );
              setPhase('generated');
            }}
          />
        </Paper>
      )}

      {/* Error Display */}
      {error && (
        <Paper className={classes.errorBox}>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ErrorIcon style={{ color: '#DC2626' }} />
            <Typography style={{ color: '#DC2626' }}>{error}</Typography>
          </Box>
        </Paper>
      )}

      {/* Success Display */}
      {success && (
        <Paper className={classes.successBox}>
          <CheckCircleIcon className={classes.successIcon} />
          <Typography style={{ color: '#059669', fontWeight: 500 }}>
            {success}
          </Typography>
        </Paper>
      )}

      {/* Deployment Status */}
      {deploymentId && deploymentStatus && (
        <Paper style={{ padding: 16, marginBottom: 16 }}>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <CircularProgress size={20} />
            <Typography>
              <strong>Deployment Status:</strong> {deploymentStatus}
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
