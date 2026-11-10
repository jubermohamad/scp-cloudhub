# Eliminate SymphonyFS/scripts Dependency - Comprehensive Plan

**Objective:** Move all deployment configuration and helmfile management into `platform_cloudhub` repository. Zero external dependencies on `SymphonyFS/scripts`.

**Status:** Implementation Plan  
**Date:** 2026-08-29  
**Scope:** All 19 applications consolidated under one repository

---

## Current State Analysis

### Today's Architecture (PROBLEMATIC)
```
┌─────────────────────────────────────┐
│  User Request in platform_cloudhub  │
│  (Deployment Portal UI)             │
└────────────────┬────────────────────┘
                 │ Generates helmfile
                 ↓
┌─────────────────────────────────────┐
│  SymphonyFS/scripts Repository       │
│  (PRs, helmfile commits)            │ ← EXTERNAL DEPENDENCY
│  apps/{app}/{instance}/helmfile.yaml│
└────────────────┬────────────────────┘
                 │ Workflow reads helmfile
                 ↓
┌─────────────────────────────────────┐
│  deploy-with-dynamic-runners.yml    │
│  (Executes helmfile)                │
└─────────────────────────────────────┘

PROBLEM: Two repositories, helmfiles scattered
```

### Target Architecture (UNIFIED)
```
┌─────────────────────────────────────┐
│  User Request in platform_cloudhub  │
│  (Deployment Portal UI)             │
└────────────────┬────────────────────┘
                 │ Generates helmfile
                 ↓
┌─────────────────────────────────────┐
│  platform_cloudhub Repository       │
│  (All config in PostgreSQL)         │ ✅ SINGLE REPO
│  /apps/{app}/{instance}/helmfile.yaml│
└────────────────┬────────────────────┘
                 │ Workflow reads helmfile
                 ↓
┌─────────────────────────────────────┐
│  deploy-with-dynamic-runners.yml    │
│  (in this repo)                     │
└─────────────────────────────────────┘

BENEFIT: One repository, complete autonomy
```

---

## Identified Dependencies on SymphonyFS/scripts

### 1. **Hardcoded Repository References**
```
Location: plugins/deployment-control-plane-backend/src/__tests__/
Files:
  - deploymentPortalService.test.ts (line 60, 71, 102)
  - githubDeploymentService.test.ts (line 62, 72, 79)
  - provisionerPipelineBackend.integration.test.ts (line 32, 200)
  - router.deploymentPortal.test.ts (line 58, 102)

Issue: Tests reference 'SymphonyFS/scripts' as expected repo
Fix: Change to 'jubermohamad/platform_cloudhub'
```

### 2. **Environment Variable Configuration**
```
Location: plugins/deployment-control-plane-backend/src/services/githubDeploymentService.ts
Line 50: DEPLOYMENT_PORTAL_REPO

Current Behavior:
  - Reads from env var DEPLOYMENT_PORTAL_REPO
  - Defaults to 'SymphonyFS/scripts' (in tests)
  - Actually uses jubermohamad/platform_cloudhub in production

Issue: Tests assume SymphonyFS/scripts as default
Fix: Update to expect platform_cloudhub as default
```

### 3. **Workflow File References**
```
Location: .github/workflows/deploy-helmfile.yml
Issue: 
  - Line 52: HELMFILE="apps/$APP/$INSTANCE/helmfile.yaml"
  - Line 64: CHANGED=$(git diff --name-only origin/main..HEAD | grep '^apps/.*helmfile.yaml')
  
Current: Workflow expects helmfiles at apps/{app}/{instance}/helmfile.yaml
Expected: Same structure, but in THIS repo (platform_cloudhub)

Fix: No changes needed IF DEPLOYMENT_PORTAL_REPO is correct
```

### 4. **Chart Registry Dependencies**
```
Current Registries:
  - cloudhub-native: https://charts.symphonyai.com
  - provisioner-pipeline: https://helm.symphonyfs.net

Critical Questions:
  ❓ Are ALL 19 app charts in cloudhub-native registry?
  ❓ Are any charts ONLY in provisioner-pipeline?
  ❓ Are any charts NOT PUBLISHED anywhere?

Status by App:
  ✅ Confirmed (8 apps): ai-store, common-res, detectionhub, flows, 
                        invhub, netreveal, netrevealv95, netrevealv96, 
                        sensaai-sanctions
  
  ❓ Unverified (11 apps): datadog, dxv, edb-common-res, edb-netrevealv96,
                          hybrid-manager, istio-service-entry, 
                          mtls-outbound, tailscale, velero
```

### 5. **Documentation References**
```
Files with SymphonyFS/scripts References:
  - CLOUD_NATIVE_DEPLOYMENT_CONSOLIDATION_REVIEW.md
  - CLOUD_NATIVE_DEPLOYMENT_IMPLEMENTATION_COMPLETE.md
  - CLOUD_NATIVE_DEPLOYMENT_ROLLOUT_COMPLETE.md
  - CLOUD_NATIVE_DEPLOYMENT_SUMMARY.md
  - README.md
  - catalog/components.yaml

Action: Update to reflect consolidation
```

---

## Detailed Implementation Plan

### Phase 1: Chart Verification & Publishing (Week 1)

**Step 1.1: Audit Chart Availability**

For each of the 11 unverified apps, verify chart exists:

```bash
# Test cloudhub-native registry
helm repo add cloudhub-native https://charts.symphonyai.com
helm repo update
helm search repo cloudhub-native/{app-name} --versions

# Test provisioner-pipeline fallback
helm repo add provisioner-pipeline https://helm.symphonyfs.net
helm repo update
helm search repo provisioner-pipeline/{app-name} --versions
```

**Apps to Verify:**
1. ✅ datadog → Check if at charts.symphonyai.com/datadog
2. ✅ dxv → Check if at charts.symphonyai.com/dxv
3. ✅ edb-common-res → Check if at charts.symphonyai.com/edb-common-res
4. ✅ edb-netrevealv96 → Check if at charts.symphonyai.com/edb-netrevealv96
5. ✅ hybrid-manager → Check if at charts.symphonyai.com/hybrid-manager
6. ✅ istio-service-entry → Check if at charts.symphonyai.com/istio-service-entry
7. ✅ mtls-outbound → Check if at charts.symphonyai.com/mtls-outbound
8. ✅ tailscale → Check if at charts.symphonyai.com/tailscale
9. ✅ velero → Check if at charts.symphonyai.com/velero

**Step 1.2: Publish Missing Charts**

For any chart NOT in cloudhub-native registry:
1. Locate chart definition (likely in SymphonyFS/scripts or separate repo)
2. Publish to https://charts.symphonyai.com
3. Document chart version published
4. Add version to CHART_VERSIONS_BY_APP

**Action Items:**
- [ ] Run helm search for all 19 apps against both registries
- [ ] Document which charts are in which registry
- [ ] Identify any charts that need publishing
- [ ] Coordinate with DevOps to publish missing charts
- [ ] Verify all charts are accessible from aks-scp-dev-sdc-st-cms cluster

---

### Phase 2: Code Consolidation (Week 1)

**Step 2.1: Update All SymphonyFS/scripts References to platform_cloudhub**

Files to Update:

```bash
# 1. Test files - Replace 'SymphonyFS/scripts' with 'jubermohamad/platform_cloudhub'
plugins/deployment-control-plane-backend/src/__tests__/deploymentPortalService.test.ts
plugins/deployment-control-plane-backend/src/__tests__/githubDeploymentService.test.ts
plugins/deployment-control-plane-backend/src/__tests__/provisionerPipelineBackend.integration.test.ts
plugins/deployment-control-plane-backend/src/__tests__/router.deploymentPortal.test.ts

# 2. Service files - Verify correct defaults
plugins/deployment-control-plane-backend/src/services/githubDeploymentService.ts

# 3. Documentation - Update all references
CLOUD_NATIVE_DEPLOYMENT_CONSOLIDATION_REVIEW.md
CLOUD_NATIVE_DEPLOYMENT_IMPLEMENTATION_COMPLETE.md
CLOUD_NATIVE_DEPLOYMENT_ROLLOUT_COMPLETE.md
CLOUD_NATIVE_DEPLOYMENT_SUMMARY.md
README.md
catalog/components.yaml
```

**Specific Changes:**

**File: deploymentPortalService.test.ts**
```typescript
// BEFORE:
repository: 'SymphonyFS/scripts',

// AFTER:
repository: 'jubermohamad/platform_cloudhub',
```

**File: githubDeploymentService.ts**
```typescript
// BEFORE:
const repo = process.env.DEPLOYMENT_PORTAL_REPO ?? 'SymphonyFS/scripts';

// AFTER:
const repo = process.env.DEPLOYMENT_PORTAL_REPO ?? 'jubermohamad/platform_cloudhub';
```

**Step 2.2: Verify Environment Configuration**

Ensure `DEPLOYMENT_PORTAL_REPO` is set correctly in all environments:

```bash
# Development
export DEPLOYMENT_PORTAL_REPO=jubermohamad/platform_cloudhub

# Staging
export DEPLOYMENT_PORTAL_REPO=symphonyai/platform-cloudhub

# Production
export DEPLOYMENT_PORTAL_REPO=symphonyai/platform-cloudhub
```

---

### Phase 3: Workflow Consolidation (Week 1)

**Step 3.1: Verify deploy-helmfile.yml**

No changes needed IF:
- ✅ DEPLOYMENT_PORTAL_REPO points to platform_cloudhub
- ✅ Helmfiles are at `apps/{app}/{instance}/helmfile.yaml`
- ✅ Workflow has access to platform_cloudhub repo

**Step 3.2: Remove SymphonyFS/scripts Workflow Dispatch**

If there's any GitHub Actions workflow that dispatches from SymphonyFS/scripts:
```bash
# Search for:
# - repository: symphonyai/deploy-with-dynamic-runners
# - uses: symphonyai/[any-repo]/.github/workflows/...
# - workflow_dispatch from SymphonyFS/scripts
```

Action: Move all workflow definitions to platform_cloudhub if not already there.

---

### Phase 4: Folder Structure Verification (Week 1)

**Step 4.1: Verify /apps Folder Structure**

```bash
# Verify all 19 app folders exist
ls -la apps/ | wc -l  # Should be 19 + . and .. = 21

# Verify environment subdirectories exist
for app in ai-store common-res datadog detectionhub dxv edb-common-res flows hybrid-manager \
           invhub istio-service-entry mtls-outbound netreveal netrevealv95 netrevealv96 \
           edb-netrevealv96 sales-genie sensaai-sanctions tailscale velero; do
  echo "Checking $app..."
  for env in dev qa sandbox prod; do
    test -d "apps/$app/$env" || echo "  ⚠️ Missing apps/$app/$env"
  done
done
```

**Step 4.2: Create Missing Folders**

```bash
# If any folders are missing, create them
mkdir -p apps/{datadog,dxv,edb-common-res,netreveal,netrevealv95,edb-netrevealv96,mtls-outbound,tailscale,velero,istio-service-entry,hybrid-manager}/{dev,qa,sandbox,prod}
```

---

### Phase 5: Testing & Validation (Week 2)

**Step 5.1: Unit Tests**

```bash
npm run test -- \
  plugins/deployment-control-plane-backend/src/__tests__/deploymentPortalService.test.ts \
  plugins/deployment-control-plane-backend/src/__tests__/githubDeploymentService.test.ts
```

Expected: All tests pass with no SymphonyFS/scripts references

**Step 5.2: End-to-End Deployment Testing**

Test deployment of each app type:

```bash
# SRI Component (ai-store)
curl -X POST http://localhost:7007/deployment-control-plane/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "application": "ai-store",
    "instanceName": "test-instance",
    "customer": "test-customer",
    "environment": "dev",
    "cluster": "aks-scp-dev-sdc-st-cms",
    "chartVersion": "2.3.1"
  }'

# NetReveal (netreveal)
curl -X POST http://localhost:7007/deployment-control-plane/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "application": "netreveal",
    "instanceName": "test-nr",
    "customer": "test-customer",
    "environment": "dev",
    "cluster": "aks-scp-dev-sdc-st-cms",
    "chartVersion": "9.4.0"
  }'

# Platform Extension (datadog)
curl -X POST http://localhost:7007/deployment-control-plane/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "application": "datadog",
    "instanceName": "test-dd",
    "customer": "test-customer",
    "environment": "dev",
    "cluster": "aks-scp-dev-sdc-st-cms",
    "chartVersion": "4.8.0"
  }'
```

Expected Results:
- ✅ Helmfile generated for each app
- ✅ Helmfile committed to platform_cloudhub (not SymphonyFS/scripts)
- ✅ Helmfile path: `apps/{app}/{instance}/helmfile.yaml`
- ✅ No external repo references

**Step 5.3: Verify Helmfile Generation**

```bash
# Check that generated helmfiles reference correct registries
grep -r "charts.symphonyai.com" apps/

# Should see:
# apps/ai-store/test-instance/helmfile.yaml:    url: https://charts.symphonyai.com
# apps/netreveal/test-nr/helmfile.yaml:    url: https://charts.symphonyai.com
# apps/datadog/test-dd/helmfile.yaml:    url: https://charts.symphonyai.com
```

---

### Phase 6: Documentation Update (Week 2)

**Step 6.1: Update All References**

Replace all instances of:
- "SymphonyFS/scripts" → "platform_cloudhub"
- "scripts repo" → "platform_cloudhub repository"
- References to external workflow dispatch → internal workflow dispatch

**Step 6.2: Create Deprecation Notice**

Add to README.md and RELEASE_RUNBOOK.md:

```markdown
## ⚠️ DEPRECATED: SymphonyFS/scripts

As of [DATE], all SRI deployments have been consolidated into the 
`platform_cloudhub` repository. The `SymphonyFS/scripts` repository 
is no longer used for deployment management.

### What Changed
- All 19 applications deployable from `platform_cloudhub`
- Deployment configuration stored in PostgreSQL (not GitHub files)
- Approval workflow integrated into platform (not GitHub PRs)
- Single repository for all operations

### Migration Path
Existing deployments in SymphonyFS/scripts will continue to work 
through [DATE], but all new deployments should use the platform_cloudhub 
deployment portal.

For assistance migrating existing deployments, contact [team].
```

**Step 6.3: Archive SymphonyFS/scripts Deployment Section**

Create `LEGACY_SYMPHONYFS_DEPLOYMENT.md` documenting the old process for historical reference.

---

## Critical Success Criteria

### Chart Availability
- ✅ All 19 apps have charts in cloudhub-native registry (https://charts.symphonyai.com)
- ✅ Fallback to provisioner-pipeline (https://helm.symphonyfs.net) if needed
- ✅ No dependency on SymphonyFS/scripts chart definitions

### Code Quality
- ✅ All tests pass with platform_cloudhub references
- ✅ Build succeeds: `npm run build:all`
- ✅ Lint passes: `npm run lint`
- ✅ No TypeScript errors: strict mode

### Functional Verification
- ✅ Deployment wizard shows all 19 apps
- ✅ Helmfiles generate correctly for all 19 apps
- ✅ Helmfiles committed to platform_cloudhub/apps/
- ✅ No helmfile commits to SymphonyFS/scripts
- ✅ deploy-with-dynamic-runners.yml executes successfully
- ✅ Approval workflow functions end-to-end

### Repository Dependency
- ✅ ZERO commits to SymphonyFS/scripts for deployments
- ✅ DEPLOYMENT_PORTAL_REPO = jubermohamad/platform_cloudhub
- ✅ All workflow references point to platform_cloudhub
- ✅ All documentation updated

---

## Rollout Timeline

| Week | Tasks | Deliverable |
|------|-------|-------------|
| Week 1 | Chart verification + Code updates + Tests | All code changes tested locally |
| Week 2 | Documentation + Staging deployment | Ready for production |
| Week 3 | Production deployment (canary) | 10% of deployments use new system |
| Week 4 | Gradual rollout | 100% using platform_cloudhub |
| Week 5+ | SymphonyFS/scripts archive | Complete consolidation |

---

## Rollback Plan

If issues arise:

1. **Code Rollback**
   - Revert all code changes to SymphonyFS/scripts references
   - Deployment Portal continues to work with fallback repo

2. **Chart Availability Issue**
   - Fall back to provisioner-pipeline registry
   - Update HelmfileTemplateService to use fallback source

3. **Workflow Issues**
   - Keep deploy-helmfile.yml in SymphonyFS/scripts as fallback
   - Dispatch to old workflow if new one fails

---

## Environment Variables to Set

### Development
```bash
DEPLOYMENT_PORTAL_REPO=jubermohamad/platform_cloudhub
```

### Staging
```bash
DEPLOYMENT_PORTAL_REPO=symphonyai/platform-cloudhub
```

### Production
```bash
DEPLOYMENT_PORTAL_REPO=symphonyai/platform-cloudhub
```

---

## Questions to Clarify Before Starting

1. **Chart Publishing**
   - Who has access to publish charts to cloudhub-native registry?
   - Which team manages the registry?
   - Timeline for publishing any missing charts?

2. **Repository Ownership**
   - Should production use `symphonyai/platform-cloudhub` or `jubermohamad/platform_cloudhub`?
   - What are the access controls?

3. **Fallback Strategy**
   - If a chart is NOT in cloudhub-native, should we use provisioner-pipeline?
   - Or should we wait until all charts are published?

4. **Deployment Cutover**
   - Can existing SymphonyFS/scripts deployments continue during transition?
   - Target date for full consolidation?

---

## Summary

**To eliminate ALL SymphonyFS/scripts dependencies:**

1. ✅ **Verify all 19 charts available** in public registries
2. ✅ **Update all code references** from SymphonyFS/scripts to platform_cloudhub
3. ✅ **Update test mocks** to expect platform_cloudhub
4. ✅ **Verify workflow configuration** (DEPLOYMENT_PORTAL_REPO)
5. ✅ **Test end-to-end** deployments for all 19 apps
6. ✅ **Update documentation** to reflect consolidation
7. ✅ **Deprecate SymphonyFS/scripts** workflow for deployments

**Result:** Single repository (platform_cloudhub) controls all 19 application deployments. Zero external dependencies. Complete autonomy.

---

**Next Action:** Clarify the questions above, then proceed with Phase 1 (Chart Verification).
