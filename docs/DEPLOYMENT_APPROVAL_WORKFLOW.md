# SRI Deployment with Approval Button - Complete Integration Guide

This guide shows developers how to integrate the `SendForApprovalButton` and `DeploymentActionButtons` into their deployment workflows.

## Quick Start (5 minutes)

### 1. Copy the Example Page

The simplest way to get started is to use `SriQuickDeployPage` as a template:

```bash
# Copy the example page
cp plugins/platform-home/src/components/SriQuickDeployPage.tsx \
   plugins/platform-home/src/pages/MyDeploymentPage.tsx
```

Then customize it for your component.

### 2. Use the Components

```typescript
import { DeploymentActionButtons } from './DeploymentActionButtons';
import { SendForApprovalButton } from './SendForApprovalButton';

// In your deployment page:
<DeploymentActionButtons
  phase={phase}
  callbacks={{
    onValidate: handleValidate,
    onGenerateConfig: handleGenerateConfig,
    onUpdate: handleUpdate,
    onDeploy: handleDeploy,
    onCancel: handleCancel,
  }}
/>

<SendForApprovalButton
  config={{
    component: 'sri-investigation',
    instance: 'dt-test-001',
    helmfile: generatedHelmfile,
    config: deploymentConfig,
  }}
  onApprovalSubmitted={(id) => setApprovalId(id)}
  onApprovalApproved={() => setCanDeploy(true)}
  onApprovalRejected((reason) => showError(reason))
/>
```

## Complete Workflow

### Step 1: User Fills Configuration

```typescript
const [config, setConfig] = useState({
  component: 'sri-investigation',
  instance: 'dt-my-deploy',
  env: 'dev',
  namespacePrefix: 'sri-dev',
  hostPrefix: 'dev',
  dnsZone: 'example.com',
  cluster: 'aks-scp-dev-sdc-st-cms',
});
```

### Step 2: Validate Deployment

User clicks "Validate" button → Component calls `onValidate` callback

```typescript
const handleValidate = async () => {
  setPhase('validating');
  try {
    const response = await backendFetch(
      'deployment-control-plane',
      '/deployments/validate',
      {
        method: 'POST',
        body: JSON.stringify(config),
      }
    );

    if (!response.ok) {
      throw new Error('Validation failed');
    }

    setPhase('validated');
  } catch (err) {
    setPhase('validation-failed');
    setError((err as Error).message);
  }
};
```

**Phase transitions:**
- `idle` → `validating` (button clicked, loading starts)
- `validating` → `validated` (success, unlock Generate Config button)
- `validating` → `validation-failed` (error, show error message, keep config)

### Step 3: Generate Helmfile

User clicks "Generate Config" button → Component calls `onGenerateConfig` callback

```typescript
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
      }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Generation failed');
    }

    const data = await response.json();
    setHelmfile(data.helmfile); // Store for approval
    setPhase('generated');
  } catch (err) {
    setPhase('generated'); // Retry allowed
    setError((err as Error).message);
  }
};
```

**Phase transitions:**
- `validated` → `generating` (button clicked, loading starts)
- `generating` → `generated` (success, unlock approval button)
- `generated` (error, keep state, user can click Generate again)

### Step 4: Send for Approval

User clicks "Send For Approval" button → `SendForApprovalButton` handles the submission

```typescript
<SendForApprovalButton
  config={{
    component: config.component,
    instance: config.instance,
    helmfile: helmfile,
    config: config,
  }}
  disabled={!helmfile} // Disable until Helmfile generated
  onApprovalSubmitted={(id) => {
    setApprovalId(id);
    console.log('Approval submitted:', id);
  }}
  onApprovalApproved={() => {
    setApprovalStatus('APPROVED');
    setPhase('updated'); // Unlock Deploy button
  }}
  onApprovalRejected={(reason) => {
    setApprovalStatus('REJECTED');
    setError(`Rejected: ${reason}`);
    setPhase('generated'); // Allow reconfiguration
  }}
/>
```

**What happens behind the scenes:**

1. Button calls: `POST /deployments/approvals`
   ```json
   {
     "component": "sri-investigation",
     "instance": "dt-my-deploy",
     "helmfile": "releases:\n  - name: sri-investigation...",
     "config": { "env": "dev", ... }
   }
   ```

2. Backend creates approval request → stores in database
3. Backend response: `{ id: "approval-abc123", status: "PENDING" }`
4. Component starts polling: `GET /deployments/approvals/approval-abc123`
5. Admin sees notification (email/Slack/dashboard)

### Step 5: Admin Reviews and Approves

Admin interface shows:
- Component name, instance, cluster
- Helmfile for review
- "Approve" and "Reject" buttons

Admin clicks "Approve" → Backend calls: `POST /deployments/approvals/approval-abc123/approve`

**Result:**
- Polling detects status change → `APPROVED`
- `onApprovalApproved` callback fires
- Deploy button becomes enabled
- User sees: "✅ Approved! Ready to deploy."

### Step 6: Deploy

User clicks "Deploy" button → Component calls `onDeploy` callback

```typescript
const handleDeploy = async () => {
  // Check approval status
  if (approvalStatus !== 'APPROVED') {
    setError('Deployment requires approval');
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
          approvalId: approvalId,
          config: config,
          helmfile: helmfile,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Deployment trigger failed');
    }

    const deployment = await response.json();
    setDeploymentId(deployment.id);

    // Poll for completion
    const pollStatus = async () => {
      const statusResp = await backendFetch(
        'deployment-control-plane',
        `/deployments/${deployment.id}`
      );
      const status = await statusResp.json();

      if (status.isTerminal) {
        if (status.isSuccess) {
          setPhase('deployed');
          setSuccess('✅ Deployment successful!');
        } else {
          setPhase('deploy-failed');
          setError(status.error);
        }
      } else {
        setTimeout(pollStatus, 10000); // Check every 10 seconds
      }
    };

    pollStatus();
  } catch (err) {
    setPhase('deploy-failed');
    setError((err as Error).message);
  }
};
```

**Phase transitions:**
- `updated` → `deploying` (button clicked, loading starts)
- `deploying` → `deployed` (success, show completion message)
- `deploying` → `deploy-failed` (error, show error, allow retry)

## Button Lifecycle

### Phase Visibility Rules

Buttons are only shown when appropriate for the current phase:

| Phase | Validate | Generate | Send Approval | Deploy | Cancel |
|-------|----------|----------|---------------|--------|--------|
| idle | ✓ | | | | |
| validating | ⟳ | | | | |
| validated | | ✓ | | | |
| generating | | ⟳ | | | |
| generated | | | ✓ | | ✓ |
| updated | | | | ✓ | ✓ |
| deploying | | | | ⟳ | |
| deployed | | | | | |
| *-failed | ✓ | | | | ✓ |

### Phase Transitions (Linear)

The approved workflow flows like this:

```
idle
  ↓ (click Validate)
validating
  ↓ (backend validates)
validated
  ↓ (click Generate Config)
generating
  ↓ (backend generates Helmfile)
generated
  ↓ (click Send For Approval)
[Admin approval pending...]
  ↓ (admin clicks Approve)
updated (Deploy button enabled)
  ↓ (click Deploy)
deploying
  ↓ (backend deploys)
deployed ✓ (Success!)
```

Any error can be retried from that point (e.g., `validation-failed` allows clicking Validate again).

## Integration into Existing Pages

### Option A: Replace DeploymentWizard

If your page currently uses `DeploymentWizard`:

```typescript
// Before:
<DeploymentWizard
  open={wizardOpen}
  preselectedApp={app}
  onClose={handleClose}
  onDeployed={handleDeployed}
/>

// After:
<SriQuickDeployPage />
```

Benefits:
- Simpler UX (no multi-step wizard)
- Inline approval workflow
- Better for quick deployments

### Option B: Add to Existing Flow

If you have a deployment page and want to add approval:

```typescript
import { SendForApprovalButton } from './SendForApprovalButton';

export function MyDeploymentPage() {
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [canDeploy, setCanDeploy] = useState(false);

  return (
    <>
      {/* ... existing deployment config UI ... */}

      {/* Add approval gate before deployment */}
      {phase === 'ready-for-deployment' && (
        <SendForApprovalButton
          config={{
            component: selectedComponent,
            instance: instanceName,
            helmfile: generatedHelmfile,
            config: deploymentConfig,
          }}
          onApprovalApproved={() => setCanDeploy(true)}
          onApprovalRejected={(reason) => {
            showError(`Deployment rejected: ${reason}`);
            setCanDeploy(false);
          }}
        />
      )}

      {/* Deploy button only enabled after approval */}
      <Button
        disabled={!canDeploy}
        onClick={handleDeploy}
      >
        Deploy
      </Button>
    </>
  );
}
```

## Testing

### Run Component Tests

```bash
npm test -- SendForApprovalButton.test.tsx
```

Tests cover:
- ✓ Button submission
- ✓ Approval polling (every 15 seconds)
- ✓ Status transitions (PENDING → APPROVED/REJECTED)
- ✓ Error handling
- ✓ Preview dialog
- ✓ Callbacks

### Run End-to-End Verification

```bash
./scripts/verify-approval-flow.sh
```

Verifies:
1. ✓ Deployment validation endpoint works
2. ✓ Helmfile generation works
3. ✓ Approval submission works
4. ✓ Approval polling works
5. ✓ Deployment trigger works

### Manual Testing

1. **Start your backend:**
   ```bash
   cd plugins/deployment-control-plane-backend
   npm run dev
   ```

2. **Port-forward the service:**
   ```bash
   kubectl port-forward -n platform svc/deployment-control-plane 8080:8080
   ```

3. **Navigate to your deployment page**

4. **Fill config and click buttons:**
   - Click "Validate" → see it validate
   - Click "Generate Config" → see Helmfile generated
   - Click "Send For Approval" → see button polling
   - In another terminal, manually approve:
     ```bash
     curl -X POST http://localhost:8080/deployments/approvals/{id}/approve
     ```
   - See status update in real-time
   - Click "Deploy" → see deployment proceed

## Admin Notification Setup

By default, the approval system has NO notifications (admins must check manually).

To add notifications, see [ADMIN_NOTIFICATION_OPTIONS.ts](../docs/ADMIN_NOTIFICATION_OPTIONS.ts)

Three options:
1. **Email** (simplest)
2. **Slack** (team-friendly)
3. **Admin Dashboard** (most comprehensive)

## Common Issues

### Button shows "Submitting..." forever

**Cause:** Backend endpoint not responding

**Fix:**
```bash
# Check if backend is running
kubectl get pods -n platform -l app=deployment-control-plane

# Check port-forward
kubectl port-forward -n platform svc/deployment-control-plane 8080:8080

# Test endpoint
curl -X GET http://localhost:8080/health
```

### Polling doesn't detect approval status

**Cause:** Backend not persisting approval status

**Fix:**
```bash
# Check approval in database
kubectl exec -it deployment-control-plane-pod -c backend -- \
  psql $DATABASE_URL -c "SELECT * FROM approvals WHERE id='approval-xyz';"

# Check backend logs
kubectl logs -n platform -l app=deployment-control-plane -c backend
```

### Deploy button still disabled after approval

**Cause:** `onApprovalApproved` callback not setting state correctly

**Fix:**
```typescript
onApprovalApproved={() => {
  setApprovalStatus('APPROVED'); // ✓ Set state
  setPhase('updated');            // ✓ Unlock Deploy button
  setSuccess('Ready to deploy');  // ✓ Show success message
}}
```

## API Reference

### DeploymentActionButtons

```typescript
interface DeploymentActionButtonsProps {
  phase: DeploymentPhase;
  callbacks: {
    onValidate: () => Promise<void>;
    onGenerateConfig: () => Promise<void>;
    onUpdate?: () => void;
    onDeploy: () => Promise<void>;
    onCancel?: () => void;
  };
  disabled?: boolean;
  error?: string | null;
  successMessage?: string | null;
  showProgress?: boolean;
}
```

### SendForApprovalButton

```typescript
interface SendForApprovalButtonProps {
  config: {
    component: string;
    instance: string;
    helmfile: string;
    config: Record<string, any>;
    notifyEmails?: string[];
  };
  disabled?: boolean;
  onApprovalSubmitted?: (id: string) => void;
  onApprovalApproved?: () => void;
  onApprovalRejected?: (reason?: string) => void;
}
```

## Next Steps

1. **Copy SriQuickDeployPage** to get started quickly
2. **Customize** for your component
3. **Run verify-approval-flow.sh** to test
4. **Set up admin notifications** (email/Slack/dashboard)
5. **Deploy** and monitor

## Need Help?

See:
- `SriQuickDeployPage.tsx` - Complete working example
- `SriDeploymentExample.tsx` - Integration patterns
- `SendForApprovalButton.test.tsx` - How it's tested
- `scripts/verify-approval-flow.sh` - Verification script
