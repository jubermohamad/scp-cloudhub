# Deployment Approval Integration Guide

## Overview

Your SRI deployment workflow should include an approval gate to ensure platform admins review each deployment before it goes to the cluster. You already have a backend approval system in place. This guide shows how to:

1. Integrate it with the new `DeploymentActionButtons` component
2. Configure GitHub Actions environment protection (optional 2nd layer)
3. Implement approval in callback functions

---

## Current Approval Architecture

### Layer 1: Backend Approval (In-App) ✅ IMPLEMENTED

```
User → UI (DeploymentWizard/DeploymentActionButtons)
     → Sends approval request to backend
     → Backend records approval request
     → Admin reviews in UI
     → Admin clicks Approve/Reject
     → UI checks approval status (polling)
     → Deploy button unlocks only after approval
```

**Requirements Met:**
- ✅ Approval required before deployment
- ✅ Approvers: GRP-CloudHub-PlatformAdmin group
- ✅ Audit trail in backend logs
- ✅ Workflow can't proceed without approval

### Layer 2: GitHub Actions Environment Protection ⚠️ NEEDS SETUP

```
GitHub Actions workflow → environment: dev/prod
                       → Check protection rules
                       → If configured: wait for approval
                       → If not configured: run immediately
```

**Status:** Configured in workflow, but GitHub repo protection rules not set up yet.

---

## DeploymentActionButtons with Approval Integration

### Phase State Machine with Approval

The new `DeploymentActionButtons` component supports a complete deployment flow including approval:

```
IDLE
  ↓ [Validate]
VALIDATING → VALIDATED
  ↓ [Generate Config]
GENERATING → GENERATED
  ↓ [Update]
UPDATING → UPDATED
  ↓ [Deploy] → Sends approval request
DEPLOYMENT-AWAITING-APPROVAL
  ↓ (admin reviews)
DEPLOYMENT-APPROVED
  ↓ (automatically proceeds)
DEPLOYING → DEPLOYED
```

### Implementation Pattern

```typescript
import { useState } from 'react';
import { DeploymentActionButtons, DeploymentPhase } from './DeploymentActionButtons';

export function SriDeploymentWithApproval() {
  const [phase, setPhase] = useState<DeploymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<
    'PENDING' | 'APPROVED' | 'REJECTED' | null
  >(null);

  const config = {
    env: 'dev',
    namespacePrefix: 'sri-dev',
    hostPrefix: 'dev',
    dnsZone: 'example.com',
  };

  const callbacks = {
    // 1. VALIDATE
    onValidate: async () => {
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
    },

    // 2. GENERATE CONFIG
    onGenerateConfig: async () => {
      setPhase('generating');
      try {
        const response = await fetch('/api/generate-helmfile', {
          method: 'POST',
          body: JSON.stringify(config),
        });
        if (!response.ok) throw new Error('Generation failed');
        setError(null);
        setPhase('generated');
      } catch (err) {
        setError((err as Error).message);
      }
    },

    // 3. UPDATE CONFIG (Can include approval request)
    onUpdate: async () => {
      setPhase('updating');
      try {
        // First, send for approval
        const approvalResponse = await fetch('/deployments/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'sri-investigation',
            instance: config.namespacePrefix,
            helmfile: '...generated helmfile...',
            config: config,
          }),
        });

        if (!approvalResponse.ok) {
          throw new Error('Failed to submit for approval');
        }

        const approvalData = await approvalResponse.json();
        setApprovalId(approvalData.id);
        setApprovalStatus('PENDING');

        // Display approval message
        setSuccess(
          '✅ Sent for approval. Waiting for GRP-CloudHub-PlatformAdmin to review...'
        );
        setError(null);

        // Start polling for approval decision
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(
              `/deployments/approvals/${approvalData.id}`
            );
            const status = await statusResponse.json();

            if (status.status === 'APPROVED') {
              clearInterval(pollInterval);
              setApprovalStatus('APPROVED');
              setSuccess('✅ Approved! You can now deploy.');
              setPhase('updated'); // Move to updated for deploy button
            } else if (status.status === 'REJECTED') {
              clearInterval(pollInterval);
              setApprovalStatus('REJECTED');
              setError('❌ Deployment rejected by admin. Please reconfigure.');
              setPhase('generated'); // Go back for reconfiguration
            }
          } catch (err) {
            console.error('Approval status check failed:', err);
          }
        }, 15000); // Poll every 15 seconds

      } catch (err) {
        setError((err as Error).message);
        setPhase('generated');
      }
    },

    // 4. DEPLOY (Only available after approval)
    onDeploy: async () => {
      if (approvalStatus !== 'APPROVED') {
        setError('Deployment cannot proceed without approval');
        return;
      }

      setPhase('deploying');
      try {
        const response = await fetch('/api/trigger-deployment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId: approvalId,
            config: config,
          }),
        });

        if (!response.ok) throw new Error('Deployment trigger failed');

        const deployment = await response.json();

        // Poll for deployment status
        const pollInterval = setInterval(async () => {
          const statusResp = await fetch(
            `/api/deployment-status/${deployment.id}`
          );
          const status = await statusResp.json();

          if (status.isTerminal) {
            clearInterval(pollInterval);
            if (status.isSuccess) {
              setPhase('deployed');
              setSuccess('✅ Deployment successful!');
            } else {
              setPhase('deploy-failed');
              setError(status.error || 'Deployment failed');
            }
          }
        }, 15000);

      } catch (err) {
        setPhase('deploy-failed');
        setError((err as Error).message);
      }
    },

    // 5. CANCEL
    onCancel: () => {
      setPhase('idle');
      setError(null);
      setSuccess(null);
      setApprovalId(null);
      setApprovalStatus(null);
    },
  };

  return (
    <DeploymentActionButtons
      phase={phase}
      callbacks={callbacks}
      error={error}
      successMessage={success}
      showProgress
    />
  );
}
```

---

## Approval Flow in Detail

### Step 1: User Initiates Deployment

User fills in deployment config and clicks "Update" button:
- Component shows loading indicator
- Phase changes to 'updating'

### Step 2: Backend Receives Approval Request

```typescript
POST /deployments/approvals
{
  "component": "sri-investigation",
  "instance": "dt-juber-poc",
  "helmfile": "releases:\n  - name: sri-investigation...",
  "config": {
    "env": "dev",
    "namespacePrefix": "sri-dev",
    ...
  }
}
```

Backend returns:
```json
{
  "id": "approval-abc123",
  "status": "PENDING",
  "createdAt": "2024-01-15T10:30:00Z",
  "requesterEmail": "user@example.com"
}
```

### Step 3: Approval Polling Starts

Component polls every 15 seconds:

```typescript
GET /deployments/approvals/approval-abc123
```

Backend response (while waiting):
```json
{
  "id": "approval-abc123",
  "status": "PENDING",
  "waitingForApprovalSince": "2024-01-15T10:30:00Z"
}
```

UI shows: "Waiting for approval from GRP-CloudHub-PlatformAdmin..."

### Step 4: Platform Admin Reviews

Admin sees approval in their queue and reviews:
- Helmfile content
- Deployment configuration
- Target cluster
- Instance name

Admin either:
- **Approves**: Clicks "Approve" button
  ```
  POST /deployments/approvals/approval-abc123/approve
  ```
  
- **Rejects**: Clicks "Reject" button
  ```
  POST /deployments/approvals/approval-abc123/reject
  {
    "reason": "Instance name doesn't follow naming convention"
  }
  ```

### Step 5: Polling Detects Approval

When next polling check happens:

```json
{
  "id": "approval-abc123",
  "status": "APPROVED",
  "approvedBy": "admin@example.com",
  "approvedAt": "2024-01-15T10:35:00Z"
}
```

Component:
- Updates `approvalStatus` to 'APPROVED'
- Changes phase to 'updated'
- Shows success message: "✅ Approved! Ready to deploy."
- **Enables Deploy button**

### Step 6: User Deploys

User clicks "Deploy" button:
- Component confirms approval is granted
- Triggers deployment workflow
- Workflow runs and deploys to cluster

---

## GitHub Actions Environment Protection (Optional Layer 2)

For additional safety, configure GitHub Actions environment protection rules:

### Configuration Steps

1. **Go to Repository Settings**
   - GitHub → Your repo → Settings → Environments

2. **Create Environments**
   - dev
   - staging
   - prod

3. **Configure dev Environment**
   ```
   Environment name: dev
   Deployment branches: main (optional restriction)
   Required reviewers: [Enable]
                      → Add GRP-CloudHub-PlatformAdmin
                      → or specific team members
   ```

4. **Configure prod Environment** (stricter)
   ```
   Environment name: prod
   Deployment branches: main only (required)
   Required reviewers: [Enable]
                      → Add security team
                      → Multiple approvers
   Custom deployment protection rules: (GitHub Enterprise only)
      → Require specific test pipeline to pass
      → Require deploy window validation
   ```

### How It Works

When workflow runs with `environment: prod`:

```yaml
jobs:
  deploy-component:
    environment: prod  # ← Checks protection rules here
    runs-on: ubuntu-latest
```

GitHub Actions automatically:
1. Checks environment protection rules
2. If required reviewers configured:
   - **Pauses the workflow** ⏸️
   - **Notifies reviewers** via GitHub
   - **Waits for approval** in GitHub UI
3. Only proceeds after approval

### Two-Layer Approval

With both layers enabled:

```
User Submits Deployment
    ↓
Backend Approval (Layer 1)
    ├─ GRP-CloudHub-PlatformAdmin reviews
    ├─ Approves in platform UI
    └─ Deployment request approved
    ↓
GitHub Actions Workflow Triggered
    ↓
GitHub Environment Protection (Layer 2)
    ├─ Workflow paused at environment
    ├─ GitHub notifies reviewers
    ├─ Reviewers approve in GitHub UI
    └─ Workflow proceeds
    ↓
Deployment Executes
```

This provides **defense in depth** — requires approval at UI level AND workflow level.

---

## Approval Notification System

Currently, approval is requested but admins might not know about it. Options to notify admins:

### Option 1: Email Notifications
Add to approval request:
```typescript
await fetch('/deployments/approvals', {
  method: 'POST',
  body: JSON.stringify({
    ...deployment,
    notifyEmails: ['admin1@example.com', 'admin2@example.com'],
    sendEmailNotification: true,
  }),
});
```

### Option 2: Approval Dashboard
Create a dashboard page:
- URL: `/admin/approvals`
- Shows pending approvals
- Quick approve/reject actions
- Audit trail

### Option 3: Slack Notifications
Integrate with Slack:
- Backend posts to Slack channel when approval needed
- Admins click button in Slack to approve/reject
- Webhook updates approval status

### Option 4: GitHub Notifications (Layer 2)
If using GitHub environment protection:
- GitHub automatically notifies reviewers
- No additional setup needed
- Uses GitHub's native notification system

---

## Testing Approval Flow

### Test Scenario 1: Successful Approval

1. Fill deployment form
2. Click "Update"
3. See "Waiting for approval..." message
4. Open new browser tab as admin
5. Navigate to approvals queue
6. Click "Approve"
7. Go back to first tab
8. See "Approved" message and enabled Deploy button
9. Click Deploy
10. Verify deployment in cluster

### Test Scenario 2: Rejected Deployment

1. Fill deployment form
2. Click "Update"
3. As admin, click "Reject"
4. User sees error message
5. User reconfigures and tries again

### Test Scenario 3: Timeout (No Decision)

1. Submit for approval
2. Wait without approval decision
3. After 24 hours (or configured timeout), auto-reject or notify admin

---

## Checklist: Approval Integration

- [ ] Backend approval endpoints implemented
  - [ ] POST /deployments/approvals
  - [ ] GET /deployments/approvals/{id}
  - [ ] POST /deployments/approvals/{id}/approve
  - [ ] POST /deployments/approvals/{id}/reject

- [ ] Permission checks working
  - [ ] canApprove checked for admin users
  - [ ] GRP-CloudHub-PlatformAdmin group membership validated
  - [ ] Audit trail logged

- [ ] UI Components ready
  - [ ] DeploymentActionButtons integrated
  - [ ] Approval status displayed
  - [ ] Approval polling implemented (15s intervals)
  - [ ] Success/error messages shown

- [ ] GitHub Layer (Optional but recommended)
  - [ ] Environments created (dev, staging, prod)
  - [ ] Protection rules configured for prod
  - [ ] Required reviewers added to prod environment
  - [ ] Deployment branches restricted (optional)

- [ ] Testing complete
  - [ ] Approval flow tested end-to-end
  - [ ] Rejection flow tested
  - [ ] Polling works correctly
  - [ ] Deploy blocked until approved

- [ ] Admin Notification (Choose at least one)
  - [ ] Email notifications configured
  - [ ] Dashboard created
  - [ ] Slack integration (optional)
  - [ ] GitHub native notifications (if using Layer 2)

---

## Quick Reference: Approval Endpoints

```
POST /deployments/approvals
  Create approval request
  Body: { component, instance, helmfile, config, notifyEmails? }
  Returns: { id, status: 'PENDING', ... }

GET /deployments/approvals/{id}
  Check approval status
  Returns: { id, status: 'PENDING'|'APPROVED'|'REJECTED', ... }

POST /deployments/approvals/{id}/approve
  Admin approves deployment
  Returns: { id, status: 'APPROVED', approvedBy, approvedAt }

POST /deployments/approvals/{id}/reject
  Admin rejects deployment
  Returns: { id, status: 'REJECTED', rejectedBy, rejectedAt, reason? }

GET /deployments/approvals/pending
  Get all pending approvals (admin only)
  Returns: [ { id, component, instance, requesterEmail, ... } ]

GET /deployments/approvals/permissions
  Check if user can approve
  Returns: { canApprove: boolean }
```

---

## Summary

**Current State:** ✅ Backend approval system is implemented and working

**What You Need to Do:**
1. Integrate `DeploymentActionButtons` with approval flow (use pattern shown above)
2. Implement approval polling in `onUpdate` callback
3. (Optional) Configure GitHub environment protection rules for additional safety
4. (Optional) Set up admin notifications (email, dashboard, or Slack)

**Result:**
- ✅ No deployment proceeds without admin approval
- ✅ Platform admins review Helmfile before applying to cluster
- ✅ Audit trail of all approvals and rejections
- ✅ Users cannot bypass approval workflow

