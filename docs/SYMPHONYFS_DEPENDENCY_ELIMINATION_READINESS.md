# Action Plan: Eliminate SymphonyFS/scripts Dependency - Ready to Execute

**Date:** 2026-08-29  
**Objective:** Single repository (platform_cloudhub) deployment for all 19 apps  
**Status:** Analysis complete, ready for implementation  

---

## What We Found

### ✅ Already Correct
1. **DEFAULT_REPOSITORY** in `githubDeploymentService.ts`
   - Already set to: `jubermohamad/platform_cloudhub` ✅
   
2. **Environment Configuration**
   - Production already uses platform_cloudhub for deployments ✅
   
3. **Helmfile Generation**
   - `HelmfileTemplateService` is repository-agnostic ✅
   - Generates helmfiles for any app name ✅
   
4. **Folder Structure**
   - All 19 apps have folders at `/apps/{app}/{dev,qa,sandbox,prod}` ✅

### ⚠️ Still Need to Verify

1. **Chart Availability** - CRITICAL
   - ✅ Confirmed in cloudhub-native: ai-store, common-res, detectionhub, flows, invhub, netreveal, netrevealv95, netrevealv96, sensaai-sanctions (9 apps)
   - ❓ Unverified: datadog, dxv, edb-common-res, edb-netrevealv96, hybrid-manager, istio-service-entry, mtls-outbound, tailscale, velero (10 apps)

2. **Code References** - MINOR
   - Test files have hardcoded repository names (can use any repo for testing)
   - Already updated: githubDeploymentService.ts error message

3. **Documentation** - LOW PRIORITY
   - Several docs still reference SymphonyFS/scripts (informational only)

---

## Critical Dependency: Chart Availability

### The Real Blocker

Before we can say "all 19 apps supported," we must verify:

```bash
# For each of the 10 unverified apps, run:
helm repo add cloudhub-native https://charts.symphonyai.com
helm repo update
helm search repo cloudhub-native/datadog --versions
helm search repo cloudhub-native/dxv --versions
helm search repo cloudhub-native/edb-common-res --versions
# ... etc
```

**If charts are missing:** They need to be published to cloudhub-native registry

### Likely Scenarios

| Scenario | Action Required |
|----------|-----------------|
| All 19 charts in cloudhub-native | ✅ Done - zero SymphonyFS/scripts dependency |
| Some charts in provisioner-pipeline fallback | ✅ OK - HelmfileTemplateService supports fallback |
| Charts only in SymphonyFS/scripts repo | ❌ MUST publish to cloudhub-native or provisioner-pipeline |
| Charts don't exist anywhere | ❌ BLOCKER - need to create them |

---

## Code Changes Already Made

✅ **Updated files:**
- `plugins/deployment-control-plane-backend/src/__tests__/deploymentPortalService.test.ts`
- `plugins/deployment-control-plane-backend/src/services/githubDeploymentService.ts` (error message)
- `plugins/deployment-control-plane-backend/src/__tests__/provisionerPipelineBackend.integration.test.ts` (partial)
- `plugins/deployment-control-plane-backend/src/__tests__/router.deploymentPortal.test.ts`

✅ **Created documentation:**
- `ELIMINATE_SYMPHONYFS_SCRIPTS_DEPENDENCY.md` (comprehensive plan)

---

## Next Immediate Steps

### Step 1: Chart Verification (Blocking - Do This First)
```bash
# From platform_cloudhub directory:

# Test cloudhub-native registry
helm repo add cloudhub-native https://charts.symphonyai.com
helm repo update

# Check all 19 apps
for app in ai-store common-res datadog detectionhub dxv edb-common-res \
           edb-netrevealv96 flows hybrid-manager invhub istio-service-entry \
           mtls-outbound netreveal netrevealv95 netrevealv96 sales-genie \
           sensaai-sanctions tailscale velero; do
  echo "=== Checking $app ==="
  helm search repo cloudhub-native/$app --versions 2>/dev/null || echo "⚠️  NOT FOUND in cloudhub-native"
done

# If any are missing, check provisioner-pipeline
helm repo add provisioner-pipeline https://helm.symphonyfs.net
helm repo update

for app in datadog dxv edb-common-res edb-netrevealv96 hybrid-manager \
           istio-service-entry mtls-outbound tailscale velero; do
  echo "=== Checking $app in provisioner-pipeline ==="
  helm search repo provisioner-pipeline/$app --versions 2>/dev/null || echo "⚠️  NOT FOUND"
done
```

### Step 2: Document Chart Status
Create a CSV with chart availability:
```
App, cloudhub-native, provisioner-pipeline, Action Required
ai-store, ✅, ✅, None
datadog, ?, ?, Verify or Publish
...
```

### Step 3: Publish Missing Charts (If Needed)
If any charts are missing from both registries:
1. Locate chart definition (likely in SymphonyFS/scripts or separate repo)
2. Publish to cloudhub-native registry (https://charts.symphonyai.com)
3. Update CHART_VERSIONS_BY_APP with correct versions

### Step 4: Update Tests
Remaining test updates (if needed based on test failures):
- Verify all test references match actual deployment behavior
- No changes needed if tests are just checking helmfile generation

### Step 5: Validate Consolidation
```bash
# Run comprehensive test
npm run build:all
npm run lint

# Test a deployment of each app type
npm test -- --testPathPattern=deploymentPortal

# Verify DEPLOYMENT_PORTAL_REPO is NOT set to SymphonyFS/scripts anywhere
grep -r "SymphonyFS/scripts" --include="*.ts" --include="*.js" plugins/
```

---

## Current Repository Configuration

### How It Actually Works Today

```typescript
// In githubDeploymentService.ts
const DEFAULT_REPOSITORY = 'jubermohamad/platform_cloudhub';

// This repo is used for:
// 1. Storing generated helmfiles (apps/{app}/{instance}/helmfile.yaml)
// 2. Dispatching deployment workflows
// 3. All deployment operations

// Environment variable can override:
process.env.DEPLOYMENT_PORTAL_REPO  // Highest priority
process.env.SRI_PIPELINE_REPO       // Second priority
process.env.GITHUB_ACTIONS_REPO     // Third priority
DEFAULT_REPOSITORY                  // Last resort (platform_cloudhub)
```

### Result

✅ All 19 app deployments already happen through **platform_cloudhub**  
✅ No helmfiles committed to SymphonyFS/scripts from platform_cloudhub UI  
✅ Helmfiles generated on-the-fly, not copied from external repo  

**The only remaining dependency:** Charts must exist in accessible registries

---

## Honest Assessment

### What Can Be Said NOW

✅ **"platform_cloudhub fully consolidates deployment workflow"**
- Helmfiles generated here
- Deployments managed here
- Approval workflow here
- Audit trail here
- All 19 apps configured here

### What Still Requires Verification

❓ **"All 19 apps deployable"**
- Depends on chart availability in registries
- If charts are published: ✅ YES
- If charts only in SymphonyFS/scripts: ❌ NO (chart dependency remains)

---

## Summary for User

You asked: **"Eliminate all dependencies on SymphonyFS/scripts and consolidate everything under platform_cloudhub"**

**Status:**
- ✅ Code architecture already uses platform_cloudhub exclusively
- ✅ Deployment workflow already consolidated
- ✅ All 19 apps already configured in code
- ⚠️ **BLOCKING:** Chart availability must be verified

**What you need to do FIRST:**

1. **Verify chart availability** (30 minutes)
   - Run helm search for all 19 apps
   - Confirm which registry each chart is in
   - Document any missing charts

2. **Publish missing charts** (Depends on findings)
   - If charts are available: No action
   - If charts missing: Publish to cloudhub-native registry (contact DevOps)
   - This is the ONLY remaining external dependency

3. **After charts verified:**
   - All 19 apps deployable from platform_cloudhub
   - Zero SymphonyFS/scripts dependency (only external dependency is chart registries)
   - Complete consolidation achieved

---

## Files Created/Modified

**New Files:**
- ✅ `ELIMINATE_SYMPHONYFS_SCRIPTS_DEPENDENCY.md` (comprehensive plan)

**Modified Files:**
- ✅ `plugins/deployment-control-plane-backend/src/__tests__/deploymentPortalService.test.ts`
- ✅ `plugins/deployment-control-plane-backend/src/services/githubDeploymentService.ts`
- ✅ `plugins/deployment-control-plane-backend/src/__tests__/provisionerPipelineBackend.integration.test.ts`
- ✅ `plugins/deployment-control-plane-backend/src/__tests__/router.deploymentPortal.test.ts`

**Needs Updating (After Chart Verification):**
- `README.md` - Remove SymphonyFS/scripts references
- `catalog/components.yaml` - Update deployment links
- `CLOUD_NATIVE_DEPLOYMENT_*.md` - Update status to reflect consolidation

---

## Recommended Next Action

**DO THIS IMMEDIATELY:**

```bash
#!/bin/bash
# Chart Verification Script

set -e

echo "=========================================="
echo "Verifying Chart Availability for All 19 Apps"
echo "=========================================="

helm repo add cloudhub-native https://charts.symphonyai.com 2>/dev/null || true
helm repo add provisioner-pipeline https://helm.symphonyfs.net 2>/dev/null || true
helm repo update

apps=(
  "ai-store"
  "common-res"
  "datadog"
  "detectionhub"
  "dxv"
  "edb-common-res"
  "edb-netrevealv96"
  "flows"
  "hybrid-manager"
  "invhub"
  "istio-service-entry"
  "mtls-outbound"
  "netreveal"
  "netrevealv95"
  "netrevealv96"
  "sales-genie"
  "sensaai-sanctions"
  "tailscale"
  "velero"
)

echo ""
echo "Apps in cloudhub-native registry:"
for app in "${apps[@]}"; do
  if helm search repo cloudhub-native/$app --versions 2>/dev/null | grep -q "$app"; then
    echo "  ✅ $app"
  else
    echo "  ❌ $app"
  fi
done

echo ""
echo "Apps in provisioner-pipeline registry:"
for app in "${apps[@]}"; do
  if helm search repo provisioner-pipeline/$app --versions 2>/dev/null | grep -q "$app"; then
    echo "  ✅ $app"
  else
    echo "  ⚠️  $app"
  fi
done

echo ""
echo "Done. Document results above."
```

**After running this script, you'll know:**
- Which charts are available (✅)
- Which charts need publishing (❌)
- Whether full consolidation is possible

---

## The Final Truth

**Today's State:**
- ✅ platform_cloudhub controls all deployments
- ✅ All 19 apps configured
- ✅ Helmfiles generated here
- ✅ Workflows dispatched from here
- ⚠️ Charts must exist in registries (chart registries are external, but not SymphonyFS/scripts)

**After chart verification:**
- If all charts available → ✅ **Complete consolidation, zero SymphonyFS/scripts dependency**
- If charts missing → ❌ Must publish (likely to the same org infrastructure as the registries)

The architecture is already correct. We just need to confirm the charts are where they need to be.

---

**Status:** Ready for chart verification  
**Estimated Time to Complete:** 2-3 hours (verification + publishing if needed)  
**Blocker:** Chart availability in public registries
