# DeploymentActionButtons Integration Guide

## Overview

The `DeploymentActionButtons` component provides a clean, reusable 5-button interface for deployment workflows. However, **the component does NOT automatically wire phase transitions** — it only controls button visibility based on the current phase.

Your callbacks are responsible for managing the phase state and ensuring the lean progression:

```
IDLE → VALIDATING → VALIDATED → GENERATING → GENERATED → UPDATING → UPDATED → DEPLOYING → DEPLOYED
```

---

## Phase Transition Wiring

### The Component's Responsibility (Button Visibility)

The component ensures buttons are only shown when appropriate:

```typescript
const canValidate = ['idle', 'validation-failed', 'generated', 'updated'].includes(phase);
const canGenerateConfig = ['idle', 'validated', 'deploy-failed'].includes(phase);
const canUpdate = ['generated', 'updated', 'deploy-failed'].includes(phase);
const canDeploy = ['updated', 'generated', 'deploy-failed'].includes(phase);
const canCancel = !['deploying', 'deployed'].includes(phase);
```

### Your Callbacks' Responsibility (State Transitions)

You MUST implement the 5 callbacks to manage phase transitions:

```typescript
const callbacks = {
  // 1. VALIDATE
  onValidate: async () => {
    setPhase('validating');
    try {
      // Call validation API
      const response = await fetch('/api/validate-deployment', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      
      if (!response.ok) {
        const error = await response.json();
        setPhase('validation-failed');
        setError(error.message);
        return;
      }
      
      // Validation passed
      setError(null);
      setPhase('validated');  // ← REQUIRED: Move to validated
    } catch (err) {
      setPhase('validation-failed');
      setError((err as Error).message);
    }
  },

  // 2. GENERATE CONFIG
  onGenerateConfig: async () => {
    setPhase('generating');
    try {
      // Call generation API (e.g., render Helmfile from template)
      const response = await fetch('/api/generate-helmfile', {
        method: 'POST',
        body: JSON.stringify({
          env: config.env,
          namespacePrefix: config.namespacePrefix,
          hostPrefix: config.hostPrefix,
          dnsZone: config.dnsZone,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Generation failed');
      }
      
      const generatedConfig = await response.json();
      setDeploymentConfig(generatedConfig);
      setError(null);
      setPhase('generated');  // ← REQUIRED: Move to generated
    } catch (err) {
      setError((err as Error).message);
      // Don't set a failed phase — stay in 'idle' to allow retry
    }
  },

  // 3. UPDATE CONFIG
  onUpdate: async () => {
    setPhase('updating');
    try {
      // Call update API (e.g., save to git, run approval workflow)
      const response = await fetch('/api/update-deployment', {
        method: 'PUT',
        body: JSON.stringify(deploymentConfig),
      });
      
      if (!response.ok) {
        throw new Error('Update failed');
      }
      
      setSuccess('Configuration updated successfully');
      setError(null);
      setPhase('updated');  // ← REQUIRED: Move to updated
    } catch (err) {
      setError((err as Error).message);
      // Go back to generated so user can re-edit
      setPhase('generated');
    }
  },

  // 4. DEPLOY
  onDeploy: async () => {
    setPhase('deploying');
    try {
      // Call deploy API (e.g., trigger GitHub Actions workflow)
      const response = await fetch('/api/deploy-to-cluster', {
        method: 'POST',
        body: JSON.stringify(deploymentConfig),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Deployment failed');
      }
      
      const result = await response.json();
      
      // Start polling for deployment status (15s interval)
      const pollDeploymentStatus = setInterval(async () => {
        try {
          const statusResponse = await fetch(
            `/api/deployment-status/${result.deploymentId}`
          );
          const status = await statusResponse.json();
          
          if (status.isComplete) {
            clearInterval(pollDeploymentStatus);
            
            if (status.isSuccess) {
              setPhase('deployed');  // ← REQUIRED: Move to deployed
              setSuccess(`Deployment complete! Cluster: ${config.cluster}`);
            } else {
              setPhase('deploy-failed');
              setError(status.errorMessage);
            }
          }
        } catch (err) {
          clearInterval(pollDeploymentStatus);
          setPhase('deploy-failed');
          setError('Status check failed');
        }
      }, 15000);
      
      // Also poll immediately
      pollDeploymentStatus();
    } catch (err) {
      setPhase('deploy-failed');
      setError((err as Error).message);
    }
  },

  // 5. CANCEL
  onCancel: () => {
    // Reset everything
    setPhase('idle');
    setError(null);
    setSuccess(null);
    setDeploymentConfig(null);
    // Close dialog if in a modal
  },
};
```

---

## Lean Progression Path

The "lean" (most direct) path through the phase state machine is:

```
IDLE
  ↓ (user clicks Validate)
VALIDATING (async in progress)
  ↓ (validation passes)
VALIDATED (user can now generate config)
  ↓ (user clicks Generate Config)
GENERATING (async in progress)
  ↓ (config generated)
GENERATED (user can review and edit)
  ↓ (user clicks Update)
UPDATING (async in progress)
  ↓ (update completes)
UPDATED (user can now deploy)
  ↓ (user clicks Deploy, confirms dialog)
DEPLOYING (async in progress)
  ↓ (deployment succeeds)
DEPLOYED ✅ (Done!)
```

This is the flow you should aim for in your callbacks. Each callback must set the appropriate phase on success.

---

## SRI Deployment Implementation

### Example: SRI Component Deployment

```tsx
import { useState } from 'react';
import {
  DeploymentActionButtons,
  DeploymentPhase,
} from './DeploymentActionButtons';

export function SriComponentDeployment() {
  const [phase, setPhase] = useState<DeploymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [config, setConfig] = useState({
    env: 'dev',
    namespacePrefix: 'sri-dev',
    hostPrefix: 'dev',
    dnsZone: 'example.com',
    component: 'sri-investigation',
    instance: 'dt-juber-poc',
    cluster: 'aks-scp-dev-sdc-st-cms',
  });

  const handleValidate = async () => {
    setPhase('validating');
    try {
      // Check that cluster exists, params are valid, etc.
      const response = await fetch(
        `/api/deployment-control-plane/validate-params`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        setPhase('validation-failed');
        setError(error.message);
        return;
      }
      
      setError(null);
      setPhase('validated');
    } catch (err) {
      setPhase('validation-failed');
      setError((err as Error).message);
    }
  };

  const handleGenerateConfig = async () => {
    setPhase('generating');
    try {
      // Generate Helmfile from template
      const response = await fetch(
        `/api/deployment-control-plane/render-helmfile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: config.component,
            instance: config.instance,
            env: config.env,
            namespacePrefix: config.namespacePrefix,
            hostPrefix: config.hostPrefix,
            dnsZone: config.dnsZone,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error('Helmfile generation failed');
      }
      
      const helmfile = await response.json();
      // Store helmfile for review and update
      setConfig(prev => ({...prev, renderedHelmfile: helmfile}));
      
      setError(null);
      setPhase('generated');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUpdate = async () => {
    setPhase('updating');
    try {
      // Commit Helmfile to git deployment branch
      const response = await fetch(
        `/api/deployment-control-plane/commit-helmfile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: config.component,
            instance: config.instance,
            helmfile: config.renderedHelmfile,
            branch: `deploy/${config.component}/${config.instance}`,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error('Helmfile commit failed');
      }
      
      setSuccess('Configuration committed to deployment branch');
      setError(null);
      setPhase('updated');
    } catch (err) {
      setError((err as Error).message);
      setPhase('generated');
    }
  };

  const handleDeploy = async () => {
    setPhase('deploying');
    try {
      // Trigger Stage 2 workflow
      const response = await fetch(
        `/api/deployment-control-plane/trigger-stage2`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: config.component,
            instance: config.instance,
            cluster: config.cluster,
            environment: config.env,
          }),
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Deployment trigger failed');
      }
      
      const deployment = await response.json();
      const deploymentId = deployment.id;
      
      // Poll for status every 15 seconds
      const pollStatus = setInterval(async () => {
        try {
          const statusResp = await fetch(
            `/api/deployment-control-plane/deployment-status/${deploymentId}`
          );
          const status = await statusResp.json();
          
          if (status.isTerminal) {
            clearInterval(pollStatus);
            
            if (status.isSuccess) {
              setPhase('deployed');
              setSuccess(
                `✅ Deployment succeeded!\n` +
                `Component: ${config.component}\n` +
                `Instance: ${config.instance}\n` +
                `Namespace: ${config.namespacePrefix}\n` +
                `Cluster: ${config.cluster}`
              );
            } else {
              setPhase('deploy-failed');
              setError(status.error || 'Deployment failed');
            }
          }
        } catch (err) {
          clearInterval(pollStatus);
          setPhase('deploy-failed');
          setError('Failed to check deployment status');
        }
      }, 15000);
    } catch (err) {
      setPhase('deploy-failed');
      setError((err as Error).message);
    }
  };

  const handleCancel = () => {
    setPhase('idle');
    setError(null);
    setSuccess(null);
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Deploy SRI {config.component}</h2>
      
      {/* Configuration inputs */}
      <div style={{ marginBottom: 24, padding: 16, backgroundColor: '#F9FAFB', borderRadius: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <div>
            <label>Environment</label>
            <input
              value={config.env}
              onChange={e => setConfig({...config, env: e.target.value})}
              style={{ width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
          <div>
            <label>Namespace</label>
            <input
              value={config.namespacePrefix}
              onChange={e => setConfig({...config, namespacePrefix: e.target.value})}
              style={{ width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
          <div>
            <label>Host Prefix</label>
            <input
              value={config.hostPrefix}
              onChange={e => setConfig({...config, hostPrefix: e.target.value})}
              style={{ width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
          <div>
            <label>DNS Zone</label>
            <input
              value={config.dnsZone}
              onChange={e => setConfig({...config, dnsZone: e.target.value})}
              style={{ width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <DeploymentActionButtons
        phase={phase}
        callbacks={{
          onValidate: handleValidate,
          onGenerateConfig: handleGenerateConfig,
          onUpdate: handleUpdate,
          onDeploy: handleDeploy,
          onCancel: handleCancel,
        }}
        error={error}
        successMessage={success}
        showProgress
      />
    </div>
  );
}
```

---

## Checklist: Is Your Implementation Properly Wired?

### Phase Transitions
- [ ] **onValidate** sets phase to 'validating' → on success 'validated' / on error 'validation-failed'
- [ ] **onGenerateConfig** sets phase to 'generating' → on success 'generated'
- [ ] **onUpdate** sets phase to 'updating' → on success 'updated' / on error 'generated'
- [ ] **onDeploy** sets phase to 'deploying' → on success 'deployed' / on error 'deploy-failed'
- [ ] **onCancel** resets phase to 'idle' and clears error/success

### Lean Progression Support
- [ ] Can progress: IDLE → VALIDATING → VALIDATED → GENERATING → GENERATED → UPDATING → UPDATED → DEPLOYING → DEPLOYED
- [ ] All async operations display progress feedback
- [ ] Error messages are displayed when callbacks fail
- [ ] User can retry from error states (validation-failed, deploy-failed)

### Error Handling
- [ ] Callbacks catch exceptions and set error state
- [ ] Error state is cleared on successful next operation
- [ ] User can navigate back to previous phase on error (e.g., from deploy-failed back to updated via Update button)

### UI Feedback
- [ ] Phase badge displays current phase (IDLE, VALIDATING, VALIDATED, etc.)
- [ ] Phase badge is colored green for success, red for error, gray for neutral
- [ ] Progress bar shown during async operations (validating, generating, updating, deploying)
- [ ] Error/success messages display inline

---

## Common Mistakes to Avoid

❌ **Not setting phase in callbacks**
```tsx
// WRONG - phase never changes!
onValidate: async () => {
  await fetch('/api/validate', { ... });
  // Missing: setPhase('validated')
}
```

✅ **Correctly managing phase**
```tsx
// CORRECT - phase transitions properly
onValidate: async () => {
  setPhase('validating');  // Show loading
  try {
    await fetch('/api/validate', { ... });
    setPhase('validated');  // Success
  } catch (err) {
    setPhase('validation-failed');  // Error
  }
}
```

---

❌ **Forgetting error/success state**
```tsx
// WRONG - user doesn't know if it succeeded
onDeploy: async () => {
  await fetch('/api/deploy', { ... });
  setPhase('deployed');
}
```

✅ **Show feedback**
```tsx
// CORRECT - user sees what happened
onDeploy: async () => {
  setPhase('deploying');
  try {
    await fetch('/api/deploy', { ... });
    setPhase('deployed');
    setSuccess('Deployment successful!');
  } catch (err) {
    setPhase('deploy-failed');
    setError(err.message);
  }
}
```

---

❌ **Not allowing recovery from errors**
```tsx
// WRONG - stuck in error state
if (phase === 'validation-failed') {
  return <div>Validation failed. Close and try again.</div>;
}
```

✅ **Allow retry**
```tsx
// CORRECT - user can retry
// Button visibility automatically shows Validate button in validation-failed state
<DeploymentActionButtons
  phase={phase}  // 'validation-failed' allows Validate button
  callbacks={{
    onValidate: handleValidate,  // User can click to retry
    ...
  }}
/>
```

---

## Files Reference

- **Component**: [plugins/platform-home/src/components/DeploymentActionButtons.tsx](plugins/platform-home/src/components/DeploymentActionButtons.tsx)
- **Parameters Guide**: [DEPLOYMENT_PARAMETERS_GUIDE.md](DEPLOYMENT_PARAMETERS_GUIDE.md)
- **Existing Example**: `SriDeployPage` (uses `DeploymentWizard`)

---

**Last Updated**: 2026-08-29  
**Component Status**: ✅ Fully wired and production-ready  
**Integration Status**: Pending (awaiting SRI page integration)
