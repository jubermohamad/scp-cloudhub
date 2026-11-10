# Approval Workflow Guide

**Status:** ✅ **ALIGNED & IMPLEMENTED**  
**Date:** 2026-08-29  
**Scope:** Production deployment approvals across all workflows

---

## 📋 Overview

CloudHub implements a **comprehensive approval workflow system** using GitHub Environments to ensure safe, auditable deployments to production. All production-facing workflows require explicit approval before proceeding.

### Key Principles
- ✅ **No production changes without approval** (enforced by GitHub)
- ✅ **Full audit trail** (actor, timestamp, deployment details recorded)
- ✅ **Environment-specific policies** (different rules for prod vs non-prod)
- ✅ **Automated safety checks** (health verification, rollback on failure)

---

## 🏗️ Architecture

### GitHub Environments

```
┌─────────────────────────────────────────────────────────────┐
│ CloudHub Production Workflows                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Environment: production                                    │
│ ├─ Deploments require explicit approval                    │
│ ├─ Reviewers: Team leads, Release managers, Admins        │
│ ├─ Timeout: 30 days (approval must occur within 30 days)   │
│ └─ Secrets: Isolated from non-prod (OIDC, Key Vault)      │
│                                                             │
│ Workflows Using This Environment:                          │
│ ├─ deploy-helmfile.yml (deploy-prod job)                  │
│ ├─ promote-to-production.yml (promote job)                │
│ ├─ rollback-production.yml (rollback job)                 │
│ └─ release-production.yml (jobs with environment: prod)    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Flow

```
Developer Push/Manual Dispatch
    ↓
GitHub Actions Triggered
    ↓
detect-changes Job
    ├─ Detects which helmfiles changed
    ├─ Separates prod vs non-prod
    └─ Outputs filtered lists
    ↓
┌─────────────────────────────────────────────┐
│ CONDITIONAL BRANCHING                       │
├─────────────────────────────────────────────┤
│                                             │
│ Non-Production Detected                    │
│ ↓                                           │
│ deploy-non-prod Job (No Approval)          │
│ ├─ Runs immediately                        │
│ ├─ No environment gate                     │
│ ├─ Fast deployment (dev/staging)           │
│ └─ Logs + health checks + reporting        │
│                                             │
│ Production Detected                        │
│ ↓                                           │
│ deploy-prod Job (environment: production)  │
│ ├─ WAITS for GitHub approval               │
│ ├─ Shows notification to reviewers         │
│ ├─ Timeout: 30 days                        │
│ ├─ Requires n-of-m approvals (configurable)│
│ └─ On approval: Deploy to production       │
│                                             │
└─────────────────────────────────────────────┘
    ↓
Deployment with Enhanced Checks (Production)
    ├─ Stricter pre-flight validation
    ├─ Atomic deployment (rollback on failure)
    ├─ 4-point health verification
    ├─ Helm tests (required)
    └─ Audit trail + detailed reporting
    ↓
✅ Deployment Complete (with approval record)
```

---

## 📁 Updated Workflows

### 1. deploy-helmfile.yml (Primary)
**Status:** ✅ **Updated with approval gates**

#### Changes
- ✅ Split `deploy` job into `deploy-non-prod` and `deploy-prod`
- ✅ Added production detection (instances with "prod" in name)
- ✅ `deploy-prod` job has `environment: production`
- ✅ Separate validation logic (stricter for prod)
- ✅ Different reporting format (approval info for prod)

#### Workflow Structure
```yaml
jobs:
  detect-changes:
    # Detects changed helmfiles and separates prod vs non-prod
    outputs:
      helmfiles: [all helmfiles]
      prod_helmfiles: [prod-only]
      non_prod_helmfiles: [dev/staging]
      has_prod_changes: true|false
      has_non_prod_changes: true|false

  deploy-non-prod:
    # For dev/staging instances
    needs: detect-changes
    if: has_non_prod_changes
    # NO environment gate
    steps:
      # Standard deployment

  deploy-prod:
    # For production instances
    needs: detect-changes
    if: has_prod_changes
    environment: production  # ← Approval gate
    steps:
      # Enhanced validation
      # Stricter health checks
      # Audit trail with approval info
```

#### Detection Logic
```bash
# Production: instance name contains "prod"
if [[ "$INSTANCE" =~ prod ]]; then
  # Send to deploy-prod (requires approval)
else
  # Send to deploy-non-prod (automatic)
fi
```

#### Examples
```
✅ Production (requires approval):
   - apps/detectionhub/prod-us-1/helmfile.yaml
   - apps/invhub/prod-centralindia/helmfile.yaml
   - apps/flows/prod-staging/helmfile.yaml

✅ Non-Production (automatic):
   - apps/detectionhub/dev-us-1/helmfile.yaml
   - apps/invhub/test-centralindia/helmfile.yaml
   - apps/flows/staging-eu/helmfile.yaml
```

---

### 2. promote-to-production.yml (Existing)
**Status:** ✅ **Already using environment: production**

```yaml
jobs:
  promote:
    environment: production  # ← Requires approval
    steps:
      # Smoke tests already run in validate-staging job
      # Then promote job waits for approval
      # Then swaps staging slots to production
```

**Approval Requirement:** YES
**When:** During the `promote` job (after validation)

---

### 3. rollback-production.yml (Existing)
**Status:** ✅ **Already using environment: production**

```yaml
jobs:
  rollback:
    environment: production  # ← Requires approval
    steps:
      # Validates rollback mode
      # Waits for approval
      # Executes rollback (slot swap or redeploy)
```

**Approval Requirement:** YES
**When:** During the `rollback` job (after validation)

---

### 4. release-production.yml (Existing)
**Status:** ✅ **Already using environment: production on specific jobs**

```yaml
jobs:
  publish-docker-images:
    # No approval (image building)
    runs-on: ubuntu-latest
    steps: [build images]

  publish-helm-chart:
    # No approval (chart building)
    runs-on: ubuntu-latest
    steps: [package chart]

  deploy-to-production:
    environment: production  # ← Requires approval
    needs: [publish-docker-images, publish-helm-chart]
    steps:
      # Waits for approval after images/charts built
      # Then deploys to production
```

**Approval Requirement:** YES (only for deploy-to-production job)
**When:** During `deploy-to-production` job (after build steps)

---

## 🔐 Approval Gate Configuration

### GitHub Repository Settings

#### Environment: "production"

**Location:** Settings → Environments → production

**Configuration:**
```
✅ Protection rules enabled
├─ Required reviewers: 1+ (configurable)
├─ Dismiss stale pull request approvals: Yes
├─ Require branch protection rule to pass: Yes (if applicable)
├─ Wait timer: 0 days (can add delay if needed)
└─ Deployment branches: All branches
```

**Secrets (Isolated to this environment):**
```
AZURE_SUBSCRIPTION_ID   (production subscription)
AZURE_TENANT_ID         (production tenant)
AZURE_CLIENT_ID         (CloudHub platform service principal: 73b2043b-6230-480a-8a9a-fd37f68af1b2)
AZURE_TENANT_ID         (CloudHub tenant: d0fec9dd-9219-4514-a1d8-1a872244bf6e)
AZURE_CLIENT_SECRET     (platform service principal secret)
```

**Access Control:**
- Allowed repositories: cloudhub
- Required approvals: At least 1 reviewer
- Reviewers: Team leads, Release managers

---

## 🚀 Deployment Scenarios

### Scenario 1: Dev/Staging Deployment

```
Developer pushes: apps/detectionhub/dev-us-1/helmfile.yaml
    ↓
Workflow triggered
    ↓
detect-changes: "This is non-prod (no 'prod' in instance name)"
    ↓
deploy-non-prod job starts IMMEDIATELY (no approval needed)
    ↓
Deployment proceeds:
  ├─ Standard validation (5 checks)
  ├─ Helm deployment
  ├─ Health verification
  ├─ Report generated
  └─ ✅ Complete in ~5-10 minutes
    ↓
RESULT: No interruption, fast feedback to developer
```

---

### Scenario 2: Production Deployment

```
Developer pushes: apps/detectionhub/prod-us-1/helmfile.yaml
    ↓
Workflow triggered
    ↓
detect-changes: "This is production (contains 'prod')"
    ↓
deploy-prod job prepared but PAUSES before steps
    ↓
🔔 APPROVAL NOTIFICATION SENT
├─ "Deploy prod-us-1 requires approval"
├─ Notification to: configured reviewers
├─ Run URL: https://github.com/...
└─ Details: app, instance, changed helmfile
    ↓
Reviewer receives notification
    ↓
Reviewer checks the deployment
├─ Views changed helmfile
├─ Reviews commit messages
├─ Checks deployment plan
└─ Visits run URL
    ↓
Reviewer approves (or rejects)
    ↓
If Approved:
│ ├─ deploy-prod job continues
│ ├─ Enhanced validation (8 checks, stricter)
│ ├─ Helm deployment (atomic, rollback on fail)
│ ├─ Helm tests (required)
│ ├─ 4-point health verification (required)
│ ├─ Audit trail records: actor, timestamp, approval
│ └─ ✅ Complete in ~10-15 minutes
│     
If Rejected:
│ ├─ deploy-prod job CANCELLED
│ ├─ No deployment occurs
│ └─ Developer must re-push with fixes
    ↓
RESULT: Safe production deployment with full audit trail
```

---

### Scenario 3: Promotion to Production

```
Release manager triggers: promote-to-production workflow
    ↓
validate-staging job runs
├─ Tests backend API
├─ Tests frontend UI
└─ Confirms staging is healthy
    ↓
promote job prepared but PAUSES before slot swap
    ↓
🔔 APPROVAL NOTIFICATION SENT
├─ "Promote staging→production requires approval"
├─ Notification to: configured reviewers
└─ Details: staging validation results, commit
    ↓
Reviewer approves
    ↓
promote job continues
├─ Swaps backend slot: staging → production
├─ Swaps frontend slot: staging → production
├─ Summary: Both slots swapped successfully
└─ ✅ Complete in ~2-3 minutes
    ↓
RESULT: Blue-green deployment with approval record
```

---

### Scenario 4: Production Rollback

```
Release manager triggers: rollback-production workflow
├─ Selects rollback mode: "swap-back" or "redeploy-version"
└─ Provides version if needed
    ↓
validate-slots job runs
├─ Verifies staging slot has previous version
└─ Confirms rollback is possible
    ↓
rollback job prepared but PAUSES before slot swap
    ↓
🔔 APPROVAL NOTIFICATION SENT
├─ "URGENT: Rollback production requires approval"
├─ Notification to: configured reviewers
└─ Details: rollback mode, version, reason
    ↓
Reviewer approves (typically fast due to urgency)
    ↓
rollback job continues
├─ Swaps staging ← back to production
├─ Verifies health post-rollback
└─ ✅ Complete in ~2-3 minutes
    ↓
RESULT: Rapid incident recovery with approval record
```

---

## 📊 Approval Request Details

### What Reviewers See

When GitHub sends approval notification:

```
Run Status: Pending approval
Run Name: Deploy prod-us-1/detectionhub
Workflow: deploy-helmfile.yml
Branch: main
Environment: production

Actor: username
Message: "Updated helmfile for prod-us-1"

Changed Files:
  - apps/detectionhub/prod-us-1/helmfile.yaml
  - apps/detectionhub/prod-us-1/values.generated.yaml

Commit: a1b2c3d4...
Link: Review Deployments → Click to approve/reject
```

### Reviewer Actions

1. **Click "Review Deployments"** button in notification
2. **View the deployment details:**
   - Changed helmfile
   - Helm values
   - Target cluster
   - Database migration (if any)
3. **Choose action:**
   - ✅ **Approve** - Deployment proceeds
   - ❌ **Reject** - Deployment cancelled
4. **Optional:** Add review comment explaining decision

---

## 📝 Audit Trail

Every production deployment is recorded:

### Approval Record
```
Deployment ID: deploy-prod-detectionhub-20260829-143025
Application: detectionhub
Instance: prod-us-1
Environment: production
Status: approved

Approval Details:
├─ Requested At: 2026-08-29 14:30:25 UTC
├─ Approved At: 2026-08-29 14:32:10 UTC
├─ Approved By: jane.smith@company.com
├─ Reviewer Role: Senior DevOps Engineer
├─ Approval Comment: "Helm changes look good, health metrics normal"
└─ Duration: 1 minute 45 seconds

Deployment Details:
├─ Helm Status: success
├─ Tests Status: passed
├─ Health Status: healthy
├─ Helm Deployment: ✅ Completed in 8m 23s
├─ Helm Tests: ✅ Completed in 2m 15s
├─ Health Verification: ✅ All 4 checks passed
└─ Report: Uploaded to GitHub Artifacts

Kubernetes Details:
├─ Cluster: aks-scp-dev-sdc-st-cms
├─ Namespace: prod-us-1
├─ Release: detectionhub-prod-us-1
├─ Pods: 3/3 Running
├─ Service: Ready (3 endpoints)
├─ HTTP Health: 200 OK
└─ Logs: No errors
```

### Where to Find Audit Trail

1. **GitHub UI:**
   - Actions tab → workflow run → "Deployments" section
   - Shows: Approver, approval time, deployment outcome

2. **Workflow Artifacts:**
   - installation-report-detectionhub-prod-us-1.md
   - Contains full deployment details + approval info

3. **Azure Audit Logs:**
   - Activity Log → Filter by resource group
   - Shows: OIDC authentication, Key Vault access, AKS operations

4. **Installation Report (JSON):**
   - Programmatically accessible
   - Includes deployment timeline, events, decisions

---

## 🔄 Rollback Procedures

### Automatic Rollback

If deployment fails, automatic rollback is triggered:

```
helm upgrade --install \
  --atomic \
  --cleanup-on-fail
```

**What happens:**
1. Deployment starts
2. Kubernetes waits for pods to become Ready
3. If timeout or error occurs:
   - Helm automatically rolls back to previous version
   - Partial deployments are cleaned up
   - Previous release remains in production

**Approval:** Already approved (rollback is automatic)

### Manual Rollback

For emergency rollbacks:

```
Trigger: rollback-production workflow (manual)
├─ Selects rollback mode
├─ Waits for approval
├─ Executes rollback
└─ Records audit trail
```

**Approval:** Required (even for rollbacks)
**Timeout:** 30 days (normally approved within seconds)

---

## 📋 Checklist: Setting Up Approval Workflow

### GitHub Repository Configuration

- [ ] **Environment: production created**
  - Settings → Environments → "New environment"
  - Name: "production"

- [ ] **Protection rules enabled**
  - Settings → Environments → production → Edit
  - Check "Require reviewers"
  - Add reviewers (1 minimum)

- [ ] **Secrets configured**
  - Add AZURE_SUBSCRIPTION_ID (production)
  - Add AZURE_TENANT_ID (production)
  - Add AZURE_CLIENT_ID (production/OIDC)
  - Add HELM_REPO_USERNAME (if private)
  - Add HELM_REPO_PASSWORD (if private)

### Workflow Configuration

- [ ] **deploy-helmfile.yml updated**
  - detect-changes outputs prod_helmfiles
  - deploy-prod job has `environment: production`
  - Production validation is stricter

- [ ] **promote-to-production.yml verified**
  - promote job has `environment: production` ✅

- [ ] **rollback-production.yml verified**
  - rollback job has `environment: production` ✅

- [ ] **release-production.yml verified**
  - deploy-to-production job has `environment: production` ✅

### Team Communication

- [ ] **Notify reviewers**
  - Send list of who can approve
  - Explain when approval is needed
  - Provide SLA (e.g., "15 minutes for non-urgent")

- [ ] **Update documentation**
  - Team handbook
  - Deployment guides
  - On-call runbooks

- [ ] **Monitor approval times**
  - Set expectations (should be < 5 min)
  - Escalate if approval takes too long

---

## ❓ FAQ

### Q: Why separate prod and non-prod jobs?

**A:** Because:
1. Production needs approval gate (non-prod doesn't)
2. Different validation rules (prod is stricter)
3. Different reporting format (prod includes approval details)
4. Different secrets/credentials (prod vs non-prod)

### Q: How does GitHub detect "production" jobs?

**A:** The `environment: production` field at the job level tells GitHub to:
1. Pause job execution before any steps run
2. Send approval notification to reviewers
3. Wait for approval (max 30 days)
4. Continue only if approved

### Q: Can I approve my own deployment?

**A:** Depends on configuration. By default:
- ✅ Different user: YES (approval from someone else)
- ❌ Same user: NO (self-approvals disabled)

You can change this in Environment protection rules.

### Q: What if I reject a deployment?

**A:** If rejected:
1. The job is cancelled
2. No deployment occurs
3. Developer must investigate and re-push
4. Rejection is recorded in audit trail

### Q: How do I know if deployment is waiting for approval?

**A:** You'll see:
1. **GitHub notification** (email/web)
2. **Actions UI** shows "Waiting for deployment to be reviewed"
3. **Run summary** displays "⏳ Pending"

### Q: Can I set approval timeout?

**A:** Yes, in Environment settings:
- Default: 30 days
- Can set to: 0-30 days
- Common: 0 days (no delay)

### Q: What happens to approvals on force-push?

**A:** Force-pushing creates a new commit:
1. Old approval is invalidated
2. New approval needed for new commit
3. Prevents bad actors from using old approvals

### Q: Can multiple approvers be required?

**A:** Yes, in Environment protection rules:
- "Require # of reviewers" (1-6)
- Common: 2 for critical environments
- All must approve before deployment

---

## 📞 Support & Escalation

### Common Issues

**Issue:** "Deployment stuck in pending approval"
- **Check:** Is reviewer available?
- **Action:** Escalate to next level, contact team lead
- **Prevention:** Set SLA (e.g., "15 min for urgent")

**Issue:** "Approval took too long"
- **Check:** Reviewer workload, notification delivery
- **Action:** Add more reviewers, use escalation path
- **Prevention:** Consider async approval (e.g., Slack bot)

**Issue:** "Wrong person approved"
- **Check:** Was approver on the approved list?
- **Action:** Review environment protection rules
- **Prevention:** Ensure correct reviewers configured

---

## 🎯 Summary

| Aspect | Non-Production | Production |
|--------|---|---|
| **Approval Required** | ❌ No | ✅ Yes |
| **Deployment Speed** | 🚀 Fast (5-10 min) | ⏳ Delayed (1+ min approval) |
| **Validation Checks** | ✅ 5 checks | ✅✅ 8+ checks |
| **Health Verification** | ⚠️ Advisory | ❌ Required (fail if unhealthy) |
| **Helm Tests** | ⚠️ Advisory | ❌ Required |
| **Audit Trail** | ✅ Logged | ✅ Detailed (approval info) |
| **Atomic Deployment** | ⚠️ Standard | ✅ Enforced |
| **Auto-Rollback** | ✅ On failure | ✅ On failure |
| **Reviewers Notified** | ❌ No | ✅ Yes |
| **Approval Recording** | ❌ N/A | ✅ Full audit trail |

---

**Status:** ✅ APPROVAL WORKFLOW ALIGNED AND DOCUMENTED  
**Last Updated:** 2026-08-29  
**Coverage:** All production-facing workflows  
**Enforced By:** GitHub Environment protection rules
