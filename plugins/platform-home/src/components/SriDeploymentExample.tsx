/**
 * Example: Deployment with Send For Approval Button
 *
 * This example shows how to integrate SendForApprovalButton
 * into a real deployment workflow.
 */

import { useState } from 'react';
import { Box, Paper, TextField, Typography, Button } from '@mui/material';
import { DeploymentActionButtons, DeploymentPhase } from './DeploymentActionButtons';
import { SendForApprovalButton } from './SendForApprovalButton';

export function SriDeploymentExample() {
  // Deployment config state
  const [config, setConfig] = useState({
    component: 'sri-investigation',
    instance: 'dt-juber-poc',
    env: 'dev',
    namespacePrefix: 'sri-dev',
    hostPrefix: 'dev',
    dnsZone: 'example.com',
    cluster: 'aks-scp-dev-sdc-st-cms',
  });

  // Deployment phase (from DeploymentActionButtons)
  const [phase, setPhase] = useState<DeploymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Approval state
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<
    'PENDING' | 'APPROVED' | 'REJECTED' | null
  >(null);
  const [helmfile, setHelmfile] = useState<string>('');

  // Step 1: Validate deployment
  const handleValidate = async () => {
    setPhase('validating');
    try {
      const response = await fetch('/api/validate-deployment', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error('Validation failed');
      setError(null);
      setPhase('validated');
    } catch (err) {
      setPhase('validation-failed');
      setError((err as Error).message);
    }
  };

  // Step 2: Generate Helmfile
  const handleGenerateConfig = async () => {
    setPhase('generating');
    try {
      const response = await fetch('/api/generate-helmfile', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error('Generation failed');
      const data = await response.json();
      setHelmfile(data.helmfile);
      setError(null);
      setPhase('generated');
      setSuccess('✅ Helmfile generated. Ready to send for approval.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Step 3: Send for approval
  const handleSendForApproval = async () => {
    if (approvalId) return; // Already sent
    // The SendForApprovalButton handles this
  };

  // Step 4: After approval, can deploy
  const handleDeploy = async () => {
    if (approvalStatus !== 'APPROVED') {
      setError('❌ Deployment cannot proceed without approval');
      return;
    }

    setPhase('deploying');
    try {
      const response = await fetch('/api/trigger-deployment', {
        method: 'POST',
        body: JSON.stringify({
          approvalId,
          config,
          helmfile,
        }),
      });

      if (!response.ok) throw new Error('Deployment trigger failed');

      const deployment = await response.json();

      // Poll for completion
      const checkStatus = async () => {
        const statusResp = await fetch(
          `/api/deployment-status/${deployment.id}`
        );
        const status = await statusResp.json();

        if (status.isTerminal) {
          if (status.isSuccess) {
            setPhase('deployed');
            setSuccess('✅ Deployment completed successfully!');
          } else {
            setPhase('deploy-failed');
            setError(status.error || 'Deployment failed');
          }
        } else {
          // Still running, check again in 15 seconds
          setTimeout(checkStatus, 15000);
        }
      };

      checkStatus();
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
  };

  return (
    <Box style={{ padding: 24 }}>
      <Paper elevation={0} style={{ padding: 24, marginBottom: 24 }}>
        <Typography variant="h5" style={{ marginBottom: 16, fontWeight: 600 }}>
          SRI Deployment with Approval Gate
        </Typography>

        {/* Configuration Inputs */}
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <TextField
            label="Component"
            value={config.component}
            onChange={e => setConfig({ ...config, component: e.target.value })}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            fullWidth
          />
          <TextField
            label="Instance Name"
            value={config.instance}
            onChange={e => setConfig({ ...config, instance: e.target.value })}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            fullWidth
          />
          <TextField
            label="Environment"
            value={config.env}
            onChange={e => setConfig({ ...config, env: e.target.value })}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            fullWidth
          />
          <TextField
            label="Namespace Prefix"
            value={config.namespacePrefix}
            onChange={e =>
              setConfig({ ...config, namespacePrefix: e.target.value })
            }
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            fullWidth
          />
          <TextField
            label="Host Prefix"
            value={config.hostPrefix}
            onChange={e => setConfig({ ...config, hostPrefix: e.target.value })}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            fullWidth
          />
          <TextField
            label="DNS Zone"
            value={config.dnsZone}
            onChange={e => setConfig({ ...config, dnsZone: e.target.value })}
            disabled={phase !== 'idle' && phase !== 'validation-failed'}
            fullWidth
          />
        </Box>

        {/* Deployment Action Buttons */}
        <DeploymentActionButtons
          phase={phase}
          callbacks={{
            onValidate: handleValidate,
            onGenerateConfig: handleGenerateConfig,
            onUpdate: handleSendForApproval,
            onDeploy: handleDeploy,
            onCancel: handleCancel,
          }}
          error={error}
          successMessage={success}
          showProgress
        />
      </Paper>

      {/* Approval Gate */}
      {(phase === 'generated' || phase === 'updated') && (
        <Paper elevation={0} style={{ padding: 24, marginBottom: 24, backgroundColor: '#FFFBEB' }}>
          <Typography variant="h6" style={{ marginBottom: 16, fontWeight: 600 }}>
            📋 Send for Admin Approval
          </Typography>
          <Typography
            variant="body2"
            color="textSecondary"
            style={{ marginBottom: 16 }}
          >
            Your deployment must be approved by GRP-CloudHub-PlatformAdmin before
            it can proceed to the cluster.
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
              setSuccess('✅ Approved! You can now click Deploy.');
              // Move to updated phase so Deploy button appears
              if (phase === 'generated') {
                setPhase('updated');
              }
            }}
            onApprovalRejected={reason => {
              setApprovalStatus('REJECTED');
              setError(
                `❌ Deployment rejected${reason ? `: ${reason}` : ''}. Please reconfigure.`,
              );
              setPhase('generated');
            }}
          />
        </Paper>
      )}

      {/* Deployment Status */}
      {phase === 'deployed' && (
        <Paper
          elevation={0}
          style={{
            padding: 24,
            backgroundColor: '#ECFDF5',
            border: '1px solid #10B981',
          }}
        >
          <Typography variant="h6" style={{ color: '#059669', fontWeight: 600 }}>
            ✅ Deployment Complete!
          </Typography>
          <Typography style={{ color: '#065F46', marginTop: 8 }}>
            Your SRI {config.component} has been successfully deployed to{' '}
            {config.cluster}.
          </Typography>
          <Button
            onClick={handleCancel}
            variant="outlined"
            style={{ marginTop: 16 }}
          >
            Start New Deployment
          </Button>
        </Paper>
      )}
    </Box>
  );
}
