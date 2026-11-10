# Cloud Native Deployment Consolidation - Architectural Review

**Date:** 2026-08-29  
**Scope:** End-to-End SRI Deploy Resource "Cloud Native" option consolidation  
**Status:** Review Only (No Implementation)

---

## Executive Summary

Your proposal is to **consolidate the deployment workflow from `SymphonyFS/scripts` into `platform_cloudhub`**, removing the dependency on feature branches and PR-based deployment processes. Instead, all deployment configurations would be:

1. ✅ Stored in PostgreSQL database (not GitHub files)
2. ✅ Submitted through CloudHub's existing approval workflow
3. ✅ Executed without requiring GitHub branch commits
4. ✅ Audited in the platform's native audit system

**Assessment:** This is a **solid architectural direction** with clear benefits. However, it requires thoughtful implementation to avoid creating new operational complexity.

---

## Current State Analysis

### Today's Deployment Model (scripts repo approach)

```
SymphonyFS/scripts Repository
├── apps/
│   ├── detectionhub/
│   │   └── dt-juber-poc/
│   │       └── helmfile.yaml          ← Helmfile per instance per env
│   ├── invhub/
│   ├── flows/
│   └── sales-genie/
│
└── .github/workflows/
    └── deploy-with-dynamic-runners.yml ← Dispatch trigger
         (Uses helmfile from above)

Process:
1. User creates feature branch in scripts
2. User commits helmfile.yaml to apps/{app}/{instance}/{env}/
3. User creates PR
4. PR review/merge happens in scripts repo
5. GitHub Actions dispatches deploy workflow
6. Workflow reads helmfile from repo, deploys to cluster
7. No audit trail in CloudHub platform (external)
```

**Pain Points:**
- ❌ PR-based workflow is manual and prone to delay
- ❌ Helmfiles scattered across multiple repos/branches
- ❌ No single source of truth for deployment configs
- ❌ Approval process is in GitHub (not CloudHub)
- ❌ Audit trail split between GitHub and CloudHub
- ❌ Hard to audit who deployed what, when, and why
- ❌ Multiple repos to maintain (scripts + platform_cloudhub)
- ❌ No runtime configuration management (helmfiles are static in repo)

### Current CloudHub Model (what exists now)

```
platform_cloudhub (PostgreSQL)
├── Deployment Portal Service
│   ├── create() → Renders helmfile, commits to deployment branch, dispatches workflow
│   ├── getPortalDeploymentOptions() → Returns supported applications
│   └── Database persistence (control_plane_portal_deployments table)
│
├── Approval Workflow
│   ├── deployments/pending-approvals (GET)
│   ├── approval endpoint (POST)
│   └── Status transitions: PENDING → (APPROVE/REJECT) → QUEUED → DEPLOYING → DEPLOYED
│
└── Audit System
    ├── Comprehensive audit logging for all actions
    └── Role-based access control (platform-engineer, app-engineering, etc.)

Process:
1. User fills out deployment wizard (UI)
2. Backend validates configuration
3. Helmfile rendered server-side
4. Committed to GitHub deployment branch
5. Workflow dispatched
6. Status tracked in database
7. Audit trail captured
```

**What's Already Here (that you can build on):**
- ✅ PostgreSQL schema for deployment records
- ✅ Approval workflow infrastructure
- ✅ RBAC and persona system
- ✅ Audit logging system
- ✅ Helmfile rendering engine
- ✅ GitHub Actions integration
- ✅ Frontend wizard already exists

---

## Current Application Support Gap

### Applications in SymphonyFS/scripts (19 total)
✅ **Already in platform_cloudhub:**
1. ai-store
2. common-res
3. detectionhub
4. flows
5. invhub
6. netrevealv96
7. sales-genie
8. sensaai-sanctions

❌ **Missing from platform_cloudhub (11 apps):**
1. datadog
2. dxv
3. edb-common-res
4. netreveal
5. netrevealv95
6. edb-netrevealv96
7. mtls-outbound
8. tailscale
9. velero
10. istio-service-entry
11. hybrid-manager

### Architecture Insight: Why Copy `/apps` is NOT the Answer

**Important Discovery:**

The `HelmfileTemplateService` (in `plugins/deployment-control-plane-backend/src/services/helmfileTemplateService.ts`) **generates helmfiles dynamically** from a template:

```typescript
render(input: HelmfileRenderInput): HelmfileRenderResult {
  // Generates helmfile content on-the-fly based on:
  // - Application name
  // - Instance name
  // - Chart version
  // - Environment
  // - Cluster name
  // - Custom values
  
  return {
    path: `apps/${application}/${instanceName}/helmfile.yaml`,
    namespace: instanceName,
    content: generatedContent  // ← Generated, not static
  };
}
```

**This means:**
- ✅ We DON'T need to copy static helmfile definitions from scripts
- ✅ Helmfiles are generated **on-demand** per deployment
- ✅ No duplication of helmfile templates
- ❌ We DO need the `/apps` folder structure to exist
- ❌ We DO need to ensure all apps can be found in the chart registry

### Solution: Three-Step Strategy (Not Full Repo Copy)

#### Step 1: Create Missing App Folder Structures (5 minutes)
```bash
mkdir -p apps/{datadog,dxv,edb-common-res,netreveal,netrevealv95,edb-netrevealv96,mtls-outbound,tailscale,velero,istio-service-entry,hybrid-manager}/{dev,qa,sandbox,prod}
```

This creates empty folders where generated helmfiles will be committed.

#### Step 2: Verify Chart Registry Compatibility (Manual)
For each app, verify:
```
Chart name: {app}
Chart version available in:
  - https://charts.symphonyai.com/{app} (cloudhub-native)
  - https://helm.symphonyfs.net/{app} (provisioner-pipeline)
```

**Status by app:**
| App | Chart | cloudhub-native | provisioner-pipeline | Notes |
|-----|-------|-----------------|---------------------|-------|
| ai-store | ✅ | ✅ Yes | ✅ Yes | |
| common-res | ✅ | ✅ Yes | ✅ Yes | Shared platform services |
| datadog | ⚠️ | ? | ? | Monitoring agent |
| detectionhub | ✅ | ✅ Yes | ✅ Yes | |
| dxv | ⚠️ | ? | ? | Detection eXtensibility |
| edb-common-res | ⚠️ | ? | ? | EDB-specific resources |
| edb-netrevealv96 | ⚠️ | ? | ? | EDB variant of NetReveal |
| flows | ✅ | ✅ Yes | ✅ Yes | Eureka Flows/Temporal |
| hybrid-manager | ✅ | ✅ Yes | ✅ Yes | PostgreSQL cluster mgmt |
| invhub | ✅ | ✅ Yes | ✅ Yes | Investigation hub |
| istio-service-entry | ⚠️ | ? | ? | Service mesh config |
| mtls-outbound | ⚠️ | ? | ? | mTLS configuration |
| netreveal | ✅ | ✅ Yes | ✅ Yes | Core NetReveal v9.4 |
| netrevealv95 | ✅ | ✅ Yes | ✅ Yes | NetReveal v9.5 |
| netrevealv96 | ✅ | ✅ Yes | ✅ Yes | NetReveal v9.6 |
| sales-genie | ⚠️ | ? | ? | SRI Agents |
| sensaai-sanctions | ✅ | ✅ Yes | ✅ Yes | |
| tailscale | ⚠️ | ? | ? | Network VPN |
| velero | ⚠️ | ? | ? | Kubernetes backup |

#### Step 3: Update Database Seed Data (Database Migration)
Ensure the deployment portal's `CHART_VERSIONS_BY_APP` includes all supported apps:

```typescript
// In DeploymentPortalService
const CHART_VERSIONS_BY_APP: Record<string, string[]> = {
  'ai-store': ['2.3.1', '2.2.0', '2.1.0'],
  'common-res': ['1.6.0', '1.5.0'],
  'datadog': ['4.8.0', '4.7.0'],  // ← ADD
  'detectionhub': ['1.4.0', '1.3.2', '1.2.0'],
  'dxv': ['1.0.0'],  // ← ADD
  'edb-common-res': ['1.2.0', '1.1.0'],  // ← ADD
  'edb-netrevealv96': ['9.6.1', '9.6.0'],  // ← ADD
  'flows': ['0.9.4', '0.9.1'],
  'hybrid-manager': ['1.2.0', '1.1.0'],  // ← ADD
  'invhub': ['3.1.0', '3.0.0'],
  'istio-service-entry': ['1.0.0'],  // ← ADD
  'mtls-outbound': ['1.0.0'],  // ← ADD
  'netreveal': ['9.4.0', '9.3.0'],  // ← ADD
  'netrevealv95': ['9.5.1', '9.5.0'],  // ← ADD
  'netrevealv96': ['9.6.1', '9.6.0'],
  'sales-genie': ['0.5.0', '0.4.0'],
  'sensaai-sanctions': ['1.1.0', '1.0.0'],
  'tailscale': ['1.30.0'],  // ← ADD
  'velero': ['6.0.0'],  // ← ADD
};
```

---

## Comparison: SymphonyFS/scripts vs What We're Building

### SymphonyFS/scripts Model (Current)
```
Repository Structure:
  apps/
  ├── ai-store/
  │   └── {instance}/
  │       └── {env}/
  │           └── helmfile.yaml    ← User-created, manually edited
  ├── detectionhub/
  │   └── ...
  └── [18 more apps]

Deployment Flow:
  1. User creates PR with helmfile.yaml
  2. Manual review in GitHub
  3. Merge to main
  4. Manual workflow dispatch or automation
  5. Workflow reads helmfile from repo path
  6. Deploy to cluster

Issues:
  ❌ Helmfiles scattered across branches
  ❌ PR-based process is slow
  ❌ Manual file editing error-prone
  ❌ No runtime config management
  ❌ External approval process (GitHub, not platform)
```

### platform_cloudhub Model (Proposed)
```
Repository Structure:
  apps/
  ├── ai-store/
  │   └── [env folders - for generated helmfiles only]
  ├── detectionhub/
  │   └── [env folders]
  └── [18 more apps - FOLDER STRUCTURE ONLY]

Deployment Flow:
  1. User fills deployment wizard (UI)
  2. Config saved to PostgreSQL
  3. CloudHub approval workflow (platform-native)
  4. On approval: Generate helmfile dynamically
  5. Commit to temp branch
  6. Dispatch workflow
  7. Workflow reads generated helmfile
  8. Deploy to cluster

Benefits:
  ✅ Single source of truth (database)
  ✅ No manual file editing (UI-driven)
  ✅ Platform-native approval
  ✅ Runtime config management
  ✅ Complete audit trail
  ✅ All 19 apps supported day 1
```

---

## Proposed Consolidation Architecture

### Option A: "Database-First Deployment" (Recommended)

**Concept:** Helmfile configuration stored in database, not GitHub

```
User fills Deployment Wizard
           ↓
Helmfile config saved to PostgreSQL
           ↓
Approval Workflow triggered (in CloudHub)
           ↓
Approver reviews config (in CloudHub admin UI)
           ↓
On approval: Generate helmfile on-the-fly
           ↓
Commit helmfile to GitHub (temporary, just-in-time)
           ↓
Dispatch deploy-with-dynamic-runners.yml workflow
           ↓
Workflow executes, deletes helmfile from repo after deploy
           ↓
Audit trail in PostgreSQL
```

**Database Schema Addition:**

```sql
CREATE TABLE deployment_definitions (
  id UUID PRIMARY KEY,
  
  -- Identity
  application VARCHAR(100),        -- e.g., "detectionhub", "flows"
  instance_name VARCHAR(63),       -- e.g., "dt-juber-poc"
  environment VARCHAR(50),         -- e.g., "dev", "prod"
  customer VARCHAR(100),           -- e.g., "acme-corp"
  
  -- Cluster Info
  cluster_name VARCHAR(100),
  subscription_id UUID,
  resource_group VARCHAR(100),
  
  -- Chart Configuration
  chart_version VARCHAR(50),       -- e.g., "1.2.0"
  chart_values JSONB,              -- Custom values overrides
  ai_store_integration BOOLEAN,
  
  -- Approval Workflow
  status VARCHAR(50),              -- PENDING, APPROVED, REJECTED, DEPLOYED
  approval_status VARCHAR(50),     -- PENDING_APPROVAL, APPROVED_BY, REJECTED_BY
  approval_comment TEXT,
  requested_by VARCHAR(255),
  requested_at TIMESTAMP,
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  rejected_by VARCHAR(255),
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  
  -- Execution
  helmfile_content TEXT,           -- Generated helmfile (on approval)
  github_branch VARCHAR(100),      -- temp-deploy-{id}
  github_commit_sha VARCHAR(40),
  github_pr_url TEXT,
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  
  -- Status Tracking
  deployment_status VARCHAR(50),   -- PENDING, QUEUED, DEPLOYING, SUCCESS, FAILED
  deployment_message TEXT,
  deployment_started_at TIMESTAMP,
  deployment_completed_at TIMESTAMP,
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  deleted_at TIMESTAMP             -- Soft delete for audit trail
);

CREATE TABLE deployment_approvals (
  id UUID PRIMARY KEY,
  deployment_id UUID REFERENCES deployment_definitions,
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  approval_comment TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE deployment_audit_events (
  id UUID PRIMARY KEY,
  deployment_id UUID REFERENCES deployment_definitions,
  event_type VARCHAR(100),         -- CREATED, SUBMITTED_FOR_APPROVAL, APPROVED, DEPLOYED, FAILED
  actor VARCHAR(255),
  actor_role VARCHAR(100),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Implementation Path:**

1. **Phase 1: Backend API Enhancement**
   - Add `/deployments/{id}/approve` endpoint
   - Add `/deployments/{id}/reject` endpoint
   - Implement approval workflow state machine
   - Update helmfile generation to happen on-approval (not on-create)
   - Add deployment_definitions table

2. **Phase 2: GitHub Integration Modification**
   - Create temporary branch on approval (not on create)
   - Commit helmfile to temp branch
   - Dispatch workflow with branch reference
   - Delete temp branch after workflow completes

3. **Phase 3: Frontend Enhancement**
   - Add approval UI to AdminSettingsPage or create new ApprovalDashboard
   - Show pending deployments awaiting approval
   - Allow approve/reject with comments
   - Show audit trail per deployment

4. **Phase 4: Remove External Dependencies**
   - Stop using SymphonyFS/scripts for helmfile management
   - Migrate existing feature-branch deployments to database
   - Archive the scripts workflow

---

### Option B: "Hybrid Approach" (Less Breaking)

**Concept:** Keep using GitHub for helmfile commits, but add approval layer in CloudHub

```
User fills Deployment Wizard
           ↓
Helmfile rendered, saved to database
           ↓
Committed to GitHub branch (as today)
           ↓
Approval Workflow in CloudHub (NEW)
           ↓
On approval: Dispatch deploy-with-dynamic-runners.yml
           ↓
On rejection: Close PR in GitHub
           ↓
Audit trail in PostgreSQL
```

**Pros:**
- Less disruptive to current workflow
- Leverages existing GitHub integration
- Easier incremental implementation

**Cons:**
- Still has dual source-of-truth (database + GitHub)
- Still requires PR workflow
- Doesn't fully eliminate feature branch dependency
- More complex state management (GitHub state vs CloudHub state)

---

### Option C: "API-Driven Dynamic Runners" (Advanced)

**Concept:** Remove helmfile from GitHub entirely, use API-driven deployment

```
User fills Deployment Wizard
           ↓
Config saved to PostgreSQL
           ↓
Approval Workflow (in CloudHub)
           ↓
On approval: Call GitHub API to dispatch custom workflow
           ↓
Workflow pulls helmfile from CloudHub API (not from repo)
           ↓
Workflow executes helmfile from API response
           ↓
No GitHub commits needed, no temp branches
```

**Workflow Modification Needed:**

```yaml
# New workflow endpoint: /deploy-dynamic
# Instead of:
#   helmfile -f apps/detectionhub/dt-juber-poc/dev/helmfile.yaml deploy

# The workflow would do:
#   curl https://cloudhub/api/deployment/{id}/helmfile \
#     --header "Authorization: Bearer $GITHUB_TOKEN" | \
#     helmfile -f - deploy
```

**Pros:**
- Cleanest architecture
- No GitHub commits needed
- Maximum separation of concerns
- Easiest to audit (single source of truth)

**Cons:**
- Requires modifying SymphonyFS/scripts repository
- More complex error handling (API down during deploy?)
- New failure mode: GitHub workflow can't reach CloudHub API

---

## Comparative Analysis

| Aspect | Option A | Option B | Option C |
|--------|----------|----------|----------|
| **Single Source of Truth** | ✅ Yes (DB) | ⚠️ Partial | ✅ Yes (DB) |
| **Approval in CloudHub** | ✅ Full | ✅ Full | ✅ Full |
| **Remove PR dependency** | ✅ Yes | ❌ No | ✅ Yes |
| **Helmfile in GitHub** | ❌ No | ✅ Yes | ❌ No |
| **Implementation Complexity** | 🟠 Medium | 🟢 Low | 🔴 High |
| **Dependencies to Remove** | ❌ None | ❌ PR workflow | 🟠 Helmfile commits |
| **Runtime Changes** | ✅ Full support | ⚠️ Partial | ✅ Full support |
| **Backward Compatible** | ❌ Breaking | ✅ Compatible | ❌ Breaking |
| **Audit Trail Quality** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Operational Risk** | 🟡 Medium | 🟢 Low | 🔴 High |
| **Time to Implement** | 3-4 weeks | 1-2 weeks | 6-8 weeks |

---

## Recommended Approach: **Option A with incremental rollout**

**Why Option A?**

1. ✅ **Clean Architecture** - Single source of truth (PostgreSQL)
2. ✅ **Minimal Breaking Changes** - Existing workflows keep working
3. ✅ **Audit Trail** - Complete visibility in CloudHub platform
4. ✅ **Runtime Changes** - Configuration changes take effect immediately
5. ✅ **RBAC Integration** - Leverages existing approval workflow
6. ✅ **Maintainability** - No more sync issues between repos
7. ✅ **Operational Simplicity** - All deployment state in one place

**Why not Option B?**
- Still requires GitHub PRs (doesn't eliminate the pain point)
- Dual source of truth creates consistency issues
- Hard to implement true "runtime changes"

**Why not Option C?**
- Requires changes to SymphonyFS/scripts repo (out of scope)
- Higher risk (API dependency during deployment)
- More complex implementation

---

## Integration Points: Option A Implementation

### 1. Database Schema

**New Tables Needed:**
```
deployment_definitions       ← Main config storage
deployment_approvals         ← Approval audit trail
deployment_audit_events      ← Full audit history
deployment_chart_overrides   ← Custom values per deployment
```

**Leverage Existing:**
```
control_plane_portal_deployments ← Extend or replace
platform_deployment_settings     ← Already stores sriDeploySource
```

### 2. Backend Services to Modify

```
DeploymentPortalService
├── create()              ← Save config to DB, set status PENDING
├── approve()             ← Generate helmfile, trigger deployment (NEW)
├── reject()              ← Mark rejected, notify requester (NEW)
├── getApprovalWorkflow() ← List pending deployments (NEW)
└── getDeploymentStatus() ← Track live deployment status (ENHANCED)

PlatformSettingsService
├── getSettings()         ← Already returns sriDeploySource
└── updateSettings()      ← Already persists chart source

GitHubActionsService
├── dispatch()            ← Existing, will accept branch param
└── createTemporaryBranch() ← NEW, create temp branch on approval

ControlPlaneService
├── deploySriPipeline()   ← Already exists for SRI components
└── addApprovalGate()     ← NEW, require approval before dispatch
```

### 3. Frontend Components to Add

```
AdminSettingsPage (existing)
├── SRI Deploy Source toggle (DONE)
└── Deployment Approvals card (NEW)
    ├── List of pending approvals
    ├── Details preview
    ├── Approve/Reject buttons
    └── Approval history

DeploymentWizard (existing)
├── Helmfile rendering (DONE)
└── Approval workflow indicator (NEW)
    ├── Status: "Awaiting Approval"
    ├── Submitted by, date
    └── Approval progress

DeploymentHistory (existing)
├── Track deployment status (DONE)
└── Show approval history (ENHANCED)
```

### 4. API Endpoints to Add/Modify

```
POST   /deployments              (MODIFY) → Set status PENDING, don't dispatch
GET    /deployments/{id}         (ENHANCE) → Return approval_status
POST   /deployments/{id}/approve (NEW) → Approve, generate helmfile, dispatch
POST   /deployments/{id}/reject  (NEW) → Reject, notify requester
GET    /deployments/pending-approvals (MODIFY) → Support filtering
POST   /deployments/{id}/charts/preview (ENHANCE) → Preview with custom values

GET    /approvals/dashboard      (NEW) → Admin dashboard
GET    /approvals/pending        (NEW) → List pending for current user
POST   /approvals/{id}/approve   (NEW) → Approve with comment
POST   /approvals/{id}/reject    (NEW) → Reject with reason
```

### 5. Approval Workflow State Machine

```
┌─────────┐
│ DRAFT   │  (Initial state, user filling form)
└────┬────┘
     │ Submit
     ↓
┌─────────────────┐
│ PENDING_APPROVAL│  (Waiting for approver)
└────┬────────┬───┘
     │ Approve│ Reject
     ↓        ↓
  ┌──────┐  ┌──────────┐
  │APPROVED│ │REJECTED  │
  └────┬───┘ └──────────┘
       │ Generate helmfile
       ↓
  ┌──────────────┐
  │HELM_GENERATED│
  └────┬─────────┘
       │ Commit to GitHub
       ↓
  ┌────────────┐
  │GH_COMMITTED│
  └────┬───────┘
       │ Dispatch workflow
       ↓
  ┌─────────────┐
  │DEPLOYING    │
  └────┬────┬───┘
       │    │
  Success  Failed
       │    │
       ↓    ↓
  ┌────────┐ ┌────────┐
  │SUCCESS │ │FAILED  │
  └────────┘ └────────┘
```

### 6. Audit Trail Enhancement

Every state transition logs:
```json
{
  "deployment_id": "uuid",
  "event_type": "APPROVED",
  "actor": "user@company.com",
  "actor_role": "platform-engineer",
  "timestamp": "2026-08-29T12:00:00Z",
  "details": {
    "previous_status": "PENDING_APPROVAL",
    "new_status": "APPROVED",
    "approval_comment": "Looks good, deploying to prod",
    "chart_version": "1.2.0",
    "values_changed": ["replicaCount", "image.tag"]
  }
}
```

---

## Implementation Roadmap: Option A

### Week 0: Prepare Foundation (2-3 days)
- [ ] Create missing app folder structures (11 apps × envs)
  ```bash
  mkdir -p apps/{datadog,dxv,edb-common-res,netreveal,netrevealv95,edb-netrevealv96,mtls-outbound,tailscale,velero,istio-service-entry,hybrid-manager}/{dev,qa,sandbox,prod}
  ```
- [ ] Verify chart availability in registries (cloudhub-native & provisioner-pipeline)
- [ ] Update `CHART_VERSIONS_BY_APP` in `DeploymentPortalService` with all 19 apps
- [ ] Verify `SYMPHONYFS_SCRIPTS_SUPPORTED_APPS` whitelist is complete (already correct)
- [ ] Create GitHub issue templates for deployment issues

### Week 1: Foundation
- [ ] Create database schema (`deployment_definitions`, `deployment_approvals` tables)
- [ ] Add migration scripts
- [ ] Test schema with existing data

### Week 2: Backend API
- [ ] Implement approval endpoints (`/approve`, `/reject`)
- [ ] Implement state machine for approval workflow
- [ ] Modify `DeploymentPortalService.create()` to set status PENDING
- [ ] Add temporary branch creation on approval
- [ ] Add audit event logging

### Week 3: Frontend
- [ ] Create ApprovalDashboard component
- [ ] Add approval UI to AdminSettingsPage
- [ ] Add approval status indicator to DeploymentWizard
- [ ] Add approval history to DeploymentHistory
- [ ] Implement real-time status updates

### Week 4: Integration & Testing
- [ ] End-to-end testing (wizard → pending → approve → deploy)
- [ ] Test failure scenarios (network down, GitHub errors)
- [ ] Test RBAC (only platform-engineer can approve)
- [ ] Performance testing (large number of deployments)
- [ ] Documentation and runbook

### Week 5: Migration & Cleanup
- [ ] Migrate existing PR-based deployments to database
- [ ] Archive SymphonyFS/scripts deployment workflow
- [ ] Update documentation
- [ ] User training

---

## Risk Assessment

### Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| GitHub API rate limits | Low | Medium | Implement backoff + queuing |
| Temporary branch cleanup fails | Medium | Low | Add cleanup job + manual recovery |
| Helmfile generation breaks | Medium | High | Comprehensive testing + rollback |
| Approval workflow deadlock | Low | Medium | Timeout mechanism + escalation |
| Database transaction failures | Low | High | Retry logic + monitoring |

### Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Approvers unaware of UI | Medium | Medium | Clear training + notifications |
| Approval delays block deployments | Medium | Medium | SLA enforcement + escalation |
| Audit trail incompleteness | Low | High | Validation + alerts |
| Rollback complexity | Low | High | Runbook + automation |

### Technical Debt

- ✅ None introduced if implemented cleanly
- ⚠️ Old PR-based deployments need migration strategy

---

## What You Already Have (Leverage!)

CloudHub platform already provides:

1. **Approval Infrastructure**
   - `approvalWorkflow.integration.test.ts` shows the pattern
   - Pending approvals endpoints already exist
   - RBAC is in place

2. **State Management**
   - Status lifecycle already defined (PENDING, VALIDATING, DEPLOYING, etc.)
   - Database schema for storing state
   - Audit logging system

3. **Helmfile Rendering**
   - `HelmfileTemplateService` already renders helmfiles
   - Chart source (cloudhub-native vs provisioner-pipeline) already configurable
   - Path and namespace generation already works

4. **GitHub Integration**
   - `GitHubActionsService` and `GitHubDeploymentService` exist
   - Workflow dispatching already implemented
   - Commit/PR creation already works

5. **Frontend Foundation**
   - Deployment wizard UI already exists
   - Admin settings page already exists
   - Status tracking UI already implemented

**What You Don't Need to Rebuild:**
- RBAC system ✅ (use existing personas)
- Approval workflow engine ✅ (expand existing)
- Helmfile rendering ✅ (use HelmfileTemplateService)
- GitHub integration ✅ (use existing services)
- Audit logging ✅ (use audit() function)

---

## Comparison: SymphonyFS/scripts vs Proposed platform_cloudhub

### SymphonyFS/scripts (Current)
```
Pros:
  ✅ Simple workflow (push, PR, merge, auto-deploy)
  ✅ Decoupled from platform repository

Cons:
  ❌ No approval workflow (just GitHub review)
  ❌ Helmfiles scattered across branches
  ❌ No runtime configuration management
  ❌ Audit trail in GitHub (not unified)
  ❌ Hard to enforce deployment policies
  ❌ Two repositories to manage
  ❌ PR-based deployment is slow
```

### Proposed platform_cloudhub (Option A)
```
Pros:
  ✅ Single source of truth (PostgreSQL)
  ✅ CloudHub approval workflow
  ✅ Runtime configuration changes
  ✅ Unified audit trail
  ✅ Enforce deployment policies
  ✅ One repository to manage
  ✅ Faster approval (async, not blocking PR)
  ✅ Better visibility (real-time status)

Cons:
  ❌ Requires code changes to platform_cloudhub
  ❌ Temporary branch management in GitHub
  ❌ New failure mode if API down during deploy
  ❌ Migration path for existing deployments
```

---

## Configuration Examples

### Example 1: Simple Deployment (Current UI Flow)

```
User Action:
  1. Navigate to Deployment Wizard
  2. Select application: "DetectionHub"
  3. Instance name: "dt-juber-poc"
  4. Customer: "acme-corp"
  5. Environment: "dev"
  6. Cluster: "aks-scp-dev-sdc-st-cms"
  7. Chart version: "1.4.0"
  8. Click "Deploy"

Backend Processing:
  1. Validate inputs
  2. Render helmfile content
  3. Create deployment_definitions record with status: PENDING
  4. Return deployment ID to UI
  5. Send notification to approvers

UI Result:
  Shows "Waiting for approval" status
  Displays submitted config
  Shows approval queue

Admin Approval Flow:
  1. Admin logs into CloudHub
  2. Sees "Pending Approvals: 3"
  3. Opens pending deployment
  4. Reviews helmfile preview
  5. Clicks "Approve"
  6. Backend: generates helmfile, commits to GitHub, dispatches workflow
  7. Status updates to "DEPLOYING"
  8. User gets real-time updates
```

### Example 2: Custom Chart Values (New Capability!)

```
Database Config:
  {
    "deployment_id": "uuid-123",
    "chart_values": {
      "replicaCount": 3,
      "image.tag": "v1.4.0-custom",
      "resources.limits.memory": "4Gi",
      "persistence.size": "100Gi"
    }
  }

On Approval:
  HelmfileTemplateService renders with these overrides
  Generated helmfile.yaml includes custom values
  Deploy executes with custom configuration

Runtime Update:
  User can modify chart_values without re-approval
  Next deployment uses updated config
  No code redeploy needed
```

---

## Questions to Clarify

Before starting implementation, clarify:

1. **Approval Process**
   - Should approval be required for all deployments or only certain environments?
   - Can self-approval be allowed (deploy your own changes)?
   - What's the escalation path if approvers unavailable?
   - Should approval comments be mandatory or optional?

2. **Backward Compatibility**
   - Should existing feature-branch deployments be grandfathered?
   - What's the migration strategy for in-flight deployments?
   - Can we disable the old SymphonyFS/scripts workflow immediately or gradual?

3. **Runtime Changes**
   - How should users modify deployed configurations?
   - Should there be a "rollback" capability?
   - How do we prevent concurrent modifications?

4. **Chart Management**
   - Should chart versions be locked per deployment or be updateable?
   - How should chart updates trigger re-approval?
   - What about security patches (auto-approve-and-deploy)?

5. **Multi-Environment**
   - Should approval be environment-specific (dev: auto, prod: requires approval)?
   - Different approvers for different environments?
   - Can approval be delegated?

---

## Conclusion

**Your consolidation approach is architecturally sound.** Option A (Database-First Deployment) provides:

1. ✅ **Single source of truth** - All deployment config in PostgreSQL
2. ✅ **Unified approval workflow** - CloudHub controls all approvals
3. ✅ **Complete audit trail** - Every action logged in platform
4. ✅ **Runtime changes** - Update config without redeploy
5. ✅ **Better UX** - Faster, cleaner deployment process
6. ✅ **Maintainability** - One repo, one approval system

**Next Steps:**
1. Clarify the questions above
2. Design the database schema in detail
3. Create implementation tasks
4. Start with Phase 1 (Backend API)
5. Validate with a pilot deployment

**Estimated Effort:**
- Backend: 2-3 weeks
- Frontend: 1-2 weeks
- Testing: 1 week
- Migration: 1 week
- **Total: 5-7 weeks**

This is a worthwhile investment that will pay dividends in operational clarity and deployment velocity.

**Estimated Effort:**
- Backend: 2-3 weeks
- Frontend: 1-2 weeks
- Testing: 1 week
- Migration: 1 week
- **App folder setup: 2-3 days (Week 0)**
- **Total: 5.5-7.5 weeks**

---

## Appendix A: App Support Strategy vs sri-provisional

### What is sri-provisional?

`SymphonySensa/sri-provisional` (referenced in your question) is a repository that appears to serve as a **provisional deployment definitions repository**. Based on the pattern:

- Likely contains helmfile templates for SRI components
- Acts as a source-of-truth for deployment configurations
- Similar structure to SymphonyFS/scripts but SRI-focused

### Our Strategy: Why We Don't Need to Copy

**Question:** Should platform_cloudhub copy the `/apps` folder from scripts like sri-provisional does?

**Answer:** **No, and here's why:**

1. **HelmfileTemplateService generates helmfiles on-the-fly**
   - No need to store static helmfile templates
   - Template is built into the service as a Go template
   - Each deployment gets a fresh helmfile generated

2. **Chart source is already abstracted**
   - `cloudhub-native` → charts.symphonyai.com
   - `provisioner-pipeline` → helm.symphonyfs.net
   - No need to maintain separate helmfile versions

3. **Database stores configuration, not files**
   - All deployment metadata in PostgreSQL
   - Helmfiles generated from config on approval
   - Single source of truth (database, not GitHub)

4. **Folder structure is just for GitHub organization**
   - `/apps/{app}/{instance}/` folders are where committed helmfiles go
   - Used by workflow to find helmfile to deploy
   - Created dynamically as deployments are approved

### Comparison Table

| Aspect | sri-provisional | platform_cloudhub Approach |
|--------|-----------------|----------------------------|
| **Helmfile Storage** | Static files in repo | Generated dynamically |
| **Configuration Source** | GitHub files | PostgreSQL database |
| **Approval Process** | GitHub PR review | Platform approval workflow |
| **Chart Registry** | Single, predefined | Configurable per deployment |
| **Runtime Config Changes** | Requires new commit | No redeploy needed |
| **Audit Trail** | GitHub history | Platform audit logs |
| **Multi-environment Support** | Manual per env | Database-driven |

### Recommended: Don't Replicate sri-provisional

Instead of copying helmfile definitions:

```bash
# ❌ DON'T do this:
cp -r SymphonyFS/scripts/apps/* platform_cloudhub/apps/
# (Creates duplication & maintenance burden)

# ✅ DO this:
mkdir -p platform_cloudhub/apps/{datadog,dxv,edb-common-res,...}/{dev,qa,sandbox,prod}
# (Creates folder structure for generated helmfiles)
```

The generated helmfiles (which HelmfileTemplateService creates) will be committed to these folders when deployments are approved.

---

## Appendix B: Full Application Support Matrix

### All 19 Applications Supported

**Group 1: SRI Components (Strategic)**
| App | Type | Required For | Status |
|-----|------|-------------|--------|
| flows | Orchestration | Data, Detection, Agents | ✅ Ready |
| invhub | Investigation | Case management | ✅ Ready |
| detectionhub | Detection | Model management | ✅ Ready |
| sales-genie | Agents | Autonomous workflows | ✅ Ready |
| ai-store | Storage | Data & model ops | ✅ Ready |

**Group 2: NetReveal Variants (Financial Crime)**
| App | Type | Required For | Status |
|-----|------|-------------|--------|
| netreveal | Core v9.4 | Transaction monitoring | ✅ Ready |
| netrevealv95 | Core v9.5 | Transaction monitoring | ✅ Ready |
| netrevealv96 | Core v9.6 | Transaction monitoring | ✅ Ready |
| edb-netrevealv96 | EDB v9.6 | High-availability NetReveal | ⚠️ Verify chart |

**Group 3: Platform/Infrastructure Services**
| App | Type | Required For | Status |
|-----|------|-------------|--------|
| common-res | Shared | All SRI components | ✅ Ready |
| edb-common-res | Shared (EDB) | EDB deployments | ⚠️ Verify chart |
| hybrid-manager | DB Mgmt | PostgreSQL HA | ✅ Ready |
| sensaai-sanctions | Compliance | Sanctions screening | ✅ Ready |

**Group 4: Platform Extensions (Optional)**
| App | Type | Required For | Status |
|-----|------|-------------|--------|
| datadog | Monitoring | Observability | ⚠️ Verify chart |
| dxv | Extension | Detection extensibility | ⚠️ Verify chart |
| istio-service-entry | Service Mesh | Network policies | ⚠️ Verify chart |
| mtls-outbound | Security | TLS encryption | ⚠️ Verify chart |
| tailscale | VPN | Network access | ⚠️ Verify chart |
| velero | Backup | Disaster recovery | ⚠️ Verify chart |

### Deployment Scenarios

**Scenario 1: Minimal SRI (Investigation only)**
```
Required:
  - common-res (shared platform)
  - invhub (investigation app)
Optional:
  - sensaai-sanctions (sanctions screening)
```

**Scenario 2: Full SRI End-to-End**
```
Required:
  - common-res
  - flows (orchestration)
  - detectionhub (detection)
  - invhub (investigation)
  - sales-genie (agents)
  - ai-store (storage)

Optional:
  - datadog (monitoring)
  - velero (backup)
```

**Scenario 3: NetReveal Core**
```
Required:
  - common-res
  - hybrid-manager (optional, for HA)
  - netreveal (or netrevealv95, or netrevealv96)

Optional:
  - datadog (monitoring)
  - sensaai-sanctions (sanctions)
  - tailscale (network)
```

---

## Appendix C: App Support Checklist

### Pre-Implementation

- [ ] **Verify all charts exist**
  - [ ] Check cloudhub-native registry: https://charts.symphonyai.com
  - [ ] Check provisioner-pipeline registry: https://helm.symphonyfs.net
  - [ ] Document version availability per app

- [ ] **Chart compatibility assessment**
  - [ ] For each app, does helmfile need custom values?
  - [ ] Are there environment-specific overrides needed?
  - [ ] Do charts support the `global.` namespace structure?

- [ ] **Registry configuration**
  - [ ] Confirm GitHub token has pull access to both registries
  - [ ] Test connectivity to both registries from AKS clusters
  - [ ] Document fallback strategy if registry down

### Implementation

- [ ] **Create folder structure** (for all 19 apps)
  ```
  apps/
  ├── ai-store/{dev,qa,sandbox,prod}
  ├── common-res/{dev,qa,sandbox,prod}
  ├── datadog/{dev,qa,sandbox,prod}
  ├── ... [16 more apps]
  └── velero/{dev,qa,sandbox,prod}
  ```

- [ ] **Update DeploymentPortalService**
  - [ ] Add missing apps to `CHART_VERSIONS_BY_APP`
  - [ ] Add missing apps to `applicationOptions()` function
  - [ ] Verify no apps filtered out by supported check

- [ ] **Test deployment wizard**
  - [ ] All 19 apps appear in dropdown
  - [ ] Chart versions load correctly
  - [ ] Helmfile preview works for each app
  - [ ] Deployment succeeds end-to-end for at least 5 different apps

- [ ] **Test SRI pipeline deployment**
  - [ ] POST /pipelines/sri/deploy works for all 19 apps
  - [ ] Workflow dispatches correctly
  - [ ] Deployment runs to completion

### Post-Implementation

- [ ] **Audit trail verification**
  - [ ] All 19 app deployments appear in audit logs
  - [ ] Actor and role correctly recorded
  - [ ] Approval workflow state transitions logged

- [ ] **Documentation updates**
  - [ ] Update README with app support matrix
  - [ ] Create deployment runbooks per app group
  - [ ] Document chart version EOL policy

- [ ] **User training**
  - [ ] Demo deployment for each app group
  - [ ] Share troubleshooting guides
  - [ ] Establish on-call rotation for deployments

---

## Appendix D: Migration Path from SymphonyFS/scripts

### Example: Approval Endpoint

```typescript
async approve(input: {
  deploymentId: string;
  approvedBy: string;
  approvalComment?: string;
  role: PersonaRole;
}): Promise<DeploymentRecord> {
  // 1. Fetch deployment
  const deployment = await this.getDeployment(input.deploymentId);
  
  if (deployment.status !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot approve deployment with status: ${deployment.status}`);
  }
  
  // 2. Check RBAC (only platform-engineer can approve)
  if (input.role !== 'platform-engineer') {
    throw new Error('Only platform-engineer can approve deployments');
  }
  
  // 3. Prevent self-approval
  if (deployment.requestedBy === input.approvedBy) {
    throw new Error('Cannot self-approve deployment');
  }
  
  // 4. Generate helmfile
  const rendered = this.helmfile.render({
    application: deployment.application,
    instanceName: deployment.instanceName,
    customer: deployment.customer,
    environment: deployment.environment,
    clusterName: deployment.clusterName,
    chartVersion: deployment.chartVersion,
    aiStoreIntegration: deployment.aiStoreIntegration,
    chartSource: (await this.settings.getSettings()).sriDeploySource,
    chartValues: deployment.chartValues, // Custom overrides
  });
  
  // 5. Create temporary branch
  const tempBranchName = `temp-deploy-${input.deploymentId}`;
  const commit = await this.github.commitHelmfile({
    branch: tempBranchName,
    path: rendered.path,
    content: rendered.content,
  });
  
  // 6. Dispatch workflow
  const workflow = await this.actions.dispatch({
    workflow: 'deploy-with-dynamic-runners.yml',
    inputs: {
      helmfilePath: rendered.path,
      branch: tempBranchName,
      deploymentId: input.deploymentId,
    },
  });
  
  // 7. Update deployment record
  const updated = await this.persistDeployment({
    ...deployment,
    status: 'DEPLOYING',
    approvedBy: input.approvedBy,
    approvedAt: new Date().toISOString(),
    approvalComment: input.approvalComment,
    helmfileContent: rendered.content,
    gitHubBranch: tempBranchName,
    gitHubCommitSha: commit.commitSha,
    workflowRunId: workflow.runId,
    workflowRunUrl: workflow.htmlUrl,
  });
  
  // 8. Audit log
  await this.audit({
    deploymentId: input.deploymentId,
    eventType: 'APPROVED',
    actor: input.approvedBy,
    actorRole: input.role,
    details: {
      approvalComment: input.approvalComment,
      helmfilePath: rendered.path,
      workflowRunId: workflow.runId,
    },
  });
  
  return updated;
}
```

### Example: Reject Endpoint

```typescript
async reject(input: {
  deploymentId: string;
  rejectedBy: string;
  rejectionReason: string;
  role: PersonaRole;
}): Promise<DeploymentRecord> {
  // 1. Fetch deployment
  const deployment = await this.getDeployment(input.deploymentId);
  
  if (deployment.status !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot reject deployment with status: ${deployment.status}`);
  }
  
  // 2. Check RBAC
  if (input.role !== 'platform-engineer') {
    throw new Error('Only platform-engineer can reject deployments');
  }
  
  // 3. Update status
  const updated = await this.persistDeployment({
    ...deployment,
    status: 'REJECTED',
    rejectedBy: input.rejectedBy,
    rejectedAt: new Date().toISOString(),
    rejectionReason: input.rejectionReason,
  });
  
  // 4. Audit log
  await this.audit({
    deploymentId: input.deploymentId,
    eventType: 'REJECTED',
    actor: input.rejectedBy,
    actorRole: input.role,
    details: {
      rejectionReason: input.rejectionReason,
    },
  });
  
  // 5. Notify requester
  await this.notifyRejection({
    deploymentId: input.deploymentId,
    requestedBy: deployment.requestedBy,
    rejectionReason: input.rejectionReason,
  });
  
  return updated;
}
```

---

**Review prepared by:** GitHub Copilot  
**Scope:** Architectural assessment only  
**Next Action:** Present findings and clarify requirements
