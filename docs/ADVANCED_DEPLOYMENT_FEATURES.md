# Advanced Deployment Features - Complete Guide

**Status:** ✅ **IMPLEMENTED**  
**Date:** 2026-08-29  
**Scope:** Multi-stage orchestration, secrets management, audit trail, health verification

---

## Table of Contents

1. [Overview](#overview)
2. [Multi-Stage Orchestration Engine](#multi-stage-orchestration-engine)
3. [Secrets Management (Azure Key Vault)](#secrets-management-azure-key-vault)
4. [Audit Trail & Installation Reporting](#audit-trail--installation-reporting)
5. [Helm Tests & Health Verification](#helm-tests--health-verification)
6. [Configuration Guide](#configuration-guide)
7. [Complete Deployment Flow](#complete-deployment-flow)
8. [Troubleshooting](#troubleshooting)

---

## Overview

CloudHub now includes four advanced deployment features:

| Feature | Purpose | Implementation |
|---------|---------|-----------------|
| **Orchestration Engine** | Multi-stage deployments (like SRI) | TypeScript service + workflow stages |
| **Secrets Management** | Secure credential storage | Azure Key Vault integration |
| **Audit Trail** | Complete deployment history | AuditLogService + InstallationReportService |
| **Health Verification** | Post-deployment validation | Helm tests + pod status + logs + endpoints |

---

## Multi-Stage Orchestration Engine

### Architecture

The orchestration engine implements a 4-stage deployment pipeline similar to SRI's provisioner/engine:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 0: PREFLIGHT                                                  │
│ ├─ Validate helmfile                                                │
│ ├─ Check cluster connectivity                                       │
│ ├─ Verify secrets                                                   │
│ └─ Check node availability                                          │
└─────────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 1: PLATFORM_SERVICES (Optional)                               │
│ ├─ Deploy postgres operator    (sequential)                         │
│ ├─ Deploy minio                (sequential)                         │
│ └─ Deploy redis                (sequential)                         │
└─────────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 2: DOMAIN_PRODUCTS                                            │
│ └─ Deploy application (e.g., detectionhub)                          │
│    ├─ Main Helm release                                             │
│    └─ Retry logic (2 retries on failure)                            │
└─────────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 3: POST_DEPLOYMENT                                            │
│ ├─ Run Helm tests                                                   │
│ ├─ Health checks                                                    │
│ └─ Pod readiness verification                                       │
└─────────────────────────────────────────────────────────────────────┘
                               ↓
                         ✅ COMPLETE
```

### Key Features

#### 1. **Dependency Ordering**
- Platform services deploy **first** (databases, operators)
- Domain products deploy **after** (applications)
- Post-deployment verification runs **last**

#### 2. **Sequential vs. Parallel**
- **Sequential Stages:** Stages wait for completion before moving forward
- **Parallel Steps:** Within a stage, steps can run in parallel (not yet used)

#### 3. **Retry Logic**
- Failed steps can retry automatically (configurable per step)
- Prevents transient failures from failing the entire deployment

#### 4. **Timeout Management**
- Each step has a configurable timeout
- Platform services: 300s (5 min)
- Domain products: 600s (10 min)
- Post-deployment: 300s (5 min)

### Implementation Files

- **Service:** `plugins/deployment-control-plane-backend/src/services/orchestrationEngine.ts` (335 lines)
  - `DeploymentPlanResolver` - Converts configuration to deployment plan
  - `OrchestrationEngine` - Executes the multi-stage deployment

### Usage Example

```typescript
const engine = new OrchestrationEngine(logger, helmfileService);

const result = await engine.execute({
  application: 'detectionhub',
  instanceName: 'prod-us-1',
  customer: 'acme-corp',
  environment: 'production',
  cluster: 'aks-scp-prod-useast',
  chartVersion: '1.4.0',
  dryRun: false,
});

// Returns:
// {
//   plan: OrchestrationPlan,
//   results: [StageExecutionResult, ...],
//   success: boolean
// }
```

---

## Secrets Management (Azure Key Vault)

### Setup

**Key Vault Created:**
```
Name: cloudhub-deploy-vault
Location: eastus
Resource Group: rg-cfe-apps-mj
SKU: Standard
Purge Protection: Enabled
Soft Delete: Enabled (90 days)
RBAC: Enabled
```

### Vault Details

```
Vault URI: https://cloudhub-deploy-vault.vault.azure.net/
Subscription: b0799078-b42a-4b59-9e70-22cd09a20ee2
Resource Group: rg-cfe-apps-mj
```

### Configured Secrets

| Secret Name | Purpose | Value Type |
|-------------|---------|-----------|
| `helm-repo-username` | Helm registry auth | String |
| `helm-repo-password` | Helm registry auth | String (64 char) |
| `database-password` | PostgreSQL credentials | String (64 char) |
| `api-key` | API authentication | String (64 char) |
| `registry-credentials` | Container registry | JSON object |

### Access Pattern

**In GitHub Workflow:**
```bash
# Retrieve secret from Key Vault
HELM_PASSWORD=$(az keyvault secret show \
  --vault-name "cloudhub-deploy-vault" \
  --name "helm-repo-password" \
  --query value -o tsv)

# Mask in logs
echo "::add-mask::$HELM_PASSWORD"
```

### Security Features

| Feature | Benefit |
|---------|---------|
| **RBAC** | Only authorized users/apps can access |
| **Soft Delete** | Accidentally deleted secrets can be recovered (90 days) |
| **Purge Protection** | Prevents accidental permanent deletion |
| **Audit Logging** | All access logged in Azure Activity Log |
| **Encryption** | At-rest encryption with Azure-managed keys |
| **Version History** | Multiple versions of each secret retained |

### Adding New Secrets

```bash
# Create a new secret
az keyvault secret set \
  --vault-name "cloudhub-deploy-vault" \
  --name "my-secret-name" \
  --value "secret-value"

# List all secrets
az keyvault secret list \
  --vault-name "cloudhub-deploy-vault" \
  --query "[].[name]" -o tsv

# Get a secret
az keyvault secret show \
  --vault-name "cloudhub-deploy-vault" \
  --name "my-secret-name" \
  --query value -o tsv
```

### Production Integration

**Option 1: External Secrets Operator**
```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: azure-keyvault
spec:
  provider:
    azurekv:
      vaultUrl: https://cloudhub-deploy-vault.vault.azure.net/
      auth:
        workloadIdentity:
          serviceAccountRef:
            name: external-secrets
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: helm-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: azure-keyvault
    kind: SecretStore
  target:
    name: helm-credentials
    creationPolicy: Owner
  data:
  - secretKey: username
    remoteRef:
      key: helm-repo-username
  - secretKey: password
    remoteRef:
      key: helm-repo-password
```

**Option 2: Azure Key Vault Provider for Secrets Store CSI Driver**
```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: azure-keyvault
spec:
  provider: azure
  parameters:
    usePodIdentity: "true"
    keyvaultName: "cloudhub-deploy-vault"
    objects:  |
      array:
        - |
          objectName: helm-repo-password
          objectType: secret
          objectAlias: HELM_PASSWORD
```

---

## Audit Trail & Installation Reporting

### Services

**`AuditLogService`** - Records all deployment events
```typescript
logEvent({
  eventType: AuditEventType.DEPLOYMENT_STARTED,
  deploymentId: 'deploy-12345',
  application: 'detectionhub',
  instance: 'prod-us-1',
  status: 'in-progress',
  actor: 'github-actions[bot]',
  details: { ... },
  metadata: { cluster, namespace, chartVersion, environment }
})
```

**`InstallationReportService`** - Generates comprehensive reports
```typescript
const report = reportService.generateReport({
  deploymentId: 'deploy-12345',
  application: 'detectionhub',
  instance: 'prod-us-1',
  plan: orchestrationPlan,
  stageResults: stageResults,
  actor: 'github-actions[bot]'
});

// Export as JSON or Markdown
const jsonReport = reportService.exportReportAsJson(report);
const mdReport = reportService.exportReportAsMarkdown(report);
```

### Audit Events Tracked

```
DEPLOYMENT_STARTED          → Deployment initiated
DEPLOYMENT_COMPLETED        → Deployment finished successfully
DEPLOYMENT_FAILED           → Deployment failed
STAGE_STARTED              → Stage execution started
STAGE_COMPLETED            → Stage completed successfully
STAGE_FAILED               → Stage failed
STEP_STARTED               → Step execution started
STEP_COMPLETED             → Step completed successfully
STEP_FAILED                → Step failed
HEALTH_CHECK_PASSED        → Health check passed
HEALTH_CHECK_FAILED        → Health check failed
ROLLBACK_INITIATED         → Rollback started
ROLLBACK_COMPLETED         → Rollback finished successfully
ROLLBACK_FAILED            → Rollback failed
TEST_PASSED                → Test passed
TEST_FAILED                → Test failed
SECRET_RETRIEVED           → Secret fetched from vault
```

### Report Structure

Each report includes:

```json
{
  "id": "report-1693305600000-abc123",
  "deploymentId": "deploy-12345",
  "application": "detectionhub",
  "instance": "prod-us-1",
  "status": "success|failed|in-progress",
  "startTime": "2026-08-29T05:30:00Z",
  "endTime": "2026-08-29T05:45:30Z",
  "duration": 930000,
  "summary": {
    "totalStages": 4,
    "completedStages": 4,
    "failedStages": 0,
    "totalSteps": 15,
    "completedSteps": 15,
    "failedSteps": 0,
    "healthChecksPassed": 4,
    "healthChecksFailed": 0
  },
  "errors": [],
  "warnings": [],
  "recommendations": [
    "Application is performing well",
    "No issues detected"
  ]
}
```

### GitHub Workflow Integration

Reports are automatically generated and uploaded:

```yaml
- name: Generate Installation Report
  if: always()
  run: # Generate markdown report

- name: Upload Installation Report
  uses: actions/upload-artifact@v3
  with:
    name: installation-report-${{ app }}-${{ instance }}
    path: /tmp/installation-report-*.md
    retention-days: 90
```

### Accessing Reports

**Via GitHub Actions:**
1. Go to workflow run
2. Click "Artifacts" section
3. Download `installation-report-*.md`

**Programmatically:**
```typescript
// Query deployment history
const logs = auditLogService.getDeploymentLog('deploy-12345');

// Export for storage
const jsonLogs = auditLogService.exportLogsAsJson();
```

---

## Helm Tests & Health Verification

### Helm Tests

**What is tested:**
- Application-specific tests defined in chart
- Typically smoke tests or integration tests

**In Workflow:**
```bash
# Step: Run Helm Tests
helm test detectionhub-prod-us-1 \
  -n prod-us-1 \
  --timeout 5m
```

**Status:**
- ✅ **Passed** - All tests succeeded
- ⚠️ **Failed** - One or more tests failed
- ⚠️ **Skipped** - No tests defined in chart

### Health Verification (4-Point Check)

#### 1️⃣ **Pod Status**
```bash
kubectl get pods -n namespace \
  -l app.kubernetes.io/instance=release-name \
  --field-selector=status.phase=Running
```

**Checks:**
- All pods are in "Running" state
- Pod count matches expected replicas

#### 2️⃣ **Log Analysis**
```bash
kubectl logs -n namespace \
  -l app.kubernetes.io/instance=release-name \
  --tail=100 | grep -i "error\|fatal\|panic"
```

**Checks:**
- No error/fatal/panic messages in logs
- Application started successfully

#### 3️⃣ **Service Endpoints**
```bash
kubectl get endpoints service-name \
  -n namespace \
  -o jsonpath='{.subsets[*].addresses[*].ip}'
```

**Checks:**
- Service has active endpoints
- Pods are receiving traffic

#### 4️⃣ **HTTP Health Check**
```bash
kubectl exec pod-name -n namespace \
  -- curl -s http://localhost:8080/health
```

**Checks:**
- Health endpoint responds with 200/302
- Application is accepting requests

### Health Check Output

```
🏥 Running health verification...

1️⃣ Checking pod readiness...
  Ready: 3 / 3 pods
  ✅ All pods are ready

2️⃣ Checking for errors in pod logs...
  ✅ No errors in logs

3️⃣ Checking service endpoints...
  ✅ Service has 3 endpoint(s)

4️⃣ Attempting HTTP health check...
  ✅ Health endpoint returned 200

📊 Health Check Summary:
  Pod Status: ✅
  Logs Status: ✅
  Service Status: ✅
  HTTP Status: ✅

✅ Application is healthy
```

---

## Configuration Guide

### Environment Variables

Add to `.github/workflows/deploy-helmfile.yml`:

```yaml
env:
  KEYVAULT_NAME: cloudhub-deploy-vault
  KEYVAULT_RG: rg-cfe-apps-mj
```

### GitHub Secrets (Already Set)

```
AZURE_SUBSCRIPTION_ID    → b0799078-b42a-4b59-9e70-22cd09a20ee2
AZURE_TENANT_ID          → (Your Azure tenant ID)
AZURE_CLIENT_ID          → (Your OIDC app registration ID)
HELM_REPO_USERNAME       → (Helm registry username)
HELM_REPO_PASSWORD       → (Helm registry password)
```

### Workflow Inputs

```yaml
workflow_dispatch:
  inputs:
    app_name:
      description: 'Application name'
      required: false
    instance_name:
      description: 'Instance name'
      required: false
    run_db_migration:
      description: 'Run database migration'
      required: false
      default: true
      type: boolean
```

### Customizing Health Checks

Edit `.github/workflows/deploy-helmfile.yml` - "Health Verification" step:

```bash
# Add custom checks
CUSTOM_CHECK=$(kubectl get deployment $RELEASE_NAME -n $NAMESPACE \
  -o jsonpath='{.status.conditions[?(@.type=="Available")].status}')

if [ "$CUSTOM_CHECK" = "True" ]; then
  echo "✅ Custom check passed"
else
  echo "⚠️ Custom check failed"
fi
```

---

## Complete Deployment Flow

### End-to-End Timeline

```
1. User pushes helmfile OR triggers workflow manually
   ↓
2. GitHub detects change
   ↓
3. Workflow: Checkout code
   ↓
4. Workflow: Setup Helm + Azure CLI
   ↓
5. Workflow: Parse helmfile
   ↓
6. Workflow: Add Helm repositories
   ↓
7. ✅ Workflow: Authenticate to AKS (OIDC)
   ↓
8. ✅ Workflow: Pre-flight Validation (6 checks)
   ↓
9. ✅ Workflow: Retrieve Secrets from Key Vault
   ↓
10. Workflow: Resolve DB migration (if needed)
   ↓
11. Workflow: Run DB migration (if needed)
   ↓
12. ✅ Workflow: Deploy with Helm (ACTUAL deployment)
    └─ helm upgrade --install --wait --atomic
   ↓
13. ✅ Workflow: Run Helm Tests
    └─ helm test (application-specific)
   ↓
14. ✅ Workflow: Health Verification (4 checks)
    ├─ Pod status
    ├─ Log analysis
    ├─ Service endpoints
    └─ HTTP health check
   ↓
15. ✅ Workflow: Rollback on Failure (if needed)
   ↓
16. ✅ Workflow: Generate Installation Report
    └─ Audit log + summary + recommendations
   ↓
17. Workflow: Upload Report Artifact
   ↓
18. Workflow: Post Deployment Summary
   ↓
✅ DEPLOYMENT COMPLETE
```

**Total Duration:** 5-15 minutes (depending on application)

---

## Troubleshooting

### Secret Retrieval Fails

**Error:**
```
ERROR: Caller is not authorized to perform action on resource
```

**Solution:**
```bash
# Grant Key Vault Secrets Officer role
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee $(az ad signed-in-user show --query id -o tsv) \
  --scope "/subscriptions/b0799078-b42a-4b59-9e70-22cd09a20ee2/resourceGroups/rg-cfe-apps-mj/providers/Microsoft.KeyVault/vaults/cloudhub-deploy-vault"
```

### Helm Tests Fail

**Error:**
```
Error: test "detectionhub-test" failed
```

**Solution:**
1. Check test pod logs: `kubectl logs -n namespace -l app.kubernetes.io/instance=release --tail=100`
2. Verify test configuration in chart: `helm get values release -n namespace`
3. Run test manually: `helm test release -n namespace --debug`
4. Check test resource: `kubectl get pod -n namespace -l app.kubernetes.io/instance=release`

### Health Checks Show "Degraded"

**Issue:**
```
Some pods are not ready
```

**Diagnosis:**
```bash
# Check pod status
kubectl get pods -n namespace -o wide

# Check pod events
kubectl describe pod pod-name -n namespace

# Check resource limits
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.capacity.cpu,MEMORY:.status.capacity.memory
```

**Solutions:**
1. Increase pod resource requests: Edit `values.generated.yaml`
2. Scale up cluster: `az aks scale --resource-group RG --name CLUSTER --node-count 5`
3. Check image pull errors: `kubectl get events -n namespace --sort-by='.lastTimestamp'`

### No Endpoints in Service

**Error:**
```
Service has no endpoints
```

**Solution:**
```bash
# Check service selector
kubectl get svc service-name -n namespace -o yaml

# Check pod labels
kubectl get pods -n namespace --show-labels

# Verify labels match selector
kubectl get pods -n namespace -l label-key=label-value
```

### HTTP Health Check Fails

**Error:**
```
Health endpoint returned 000
```

**Solution:**
```bash
# Verify health endpoint exists
kubectl exec pod-name -n namespace -- curl -v http://localhost:8080/health

# Check if port is correct
kubectl get svc service-name -n namespace -o jsonpath='{.spec.ports[*].targetPort}'

# Port-forward for manual test
kubectl port-forward pod-name -n namespace 8080:8080
curl http://localhost:8080/health
```

### Rollback Fails

**Error:**
```
No previous revision to rollback to
```

**Solution:**
```bash
# Check release history
helm history release-name -n namespace

# Manual recovery
kubectl rollout undo deployment/deployment-name -n namespace
```

---

## Summary

| Component | Status | Files | Features |
|-----------|--------|-------|----------|
| **Orchestration Engine** | ✅ Implemented | orchestrationEngine.ts (335 lines) | 4-stage deployment, retry logic, timeouts |
| **Secrets Management** | ✅ Configured | Azure Key Vault | 5 secrets created, RBAC enabled |
| **Audit Trail** | ✅ Implemented | installationReportService.ts (450+ lines) | 16 event types, complete logging |
| **Health Verification** | ✅ Integrated | deploy-helmfile.yml | 4-point health check, Helm tests |
| **Installation Reports** | ✅ Generated | GitHub Artifacts | JSON + Markdown exports |
| **Rollback** | ✅ Automatic | deploy-helmfile.yml | Automatic on failure, manual option |

---

## Next Steps

1. **Test the deployment:**
   ```bash
   # Trigger workflow manually
   gh workflow run deploy-helmfile.yml \
     -f app_name=detectionhub \
     -f instance_name=test-us-1 \
     -f run_db_migration=false
   ```

2. **Monitor execution:**
   ```bash
   # Watch workflow logs
   gh run watch $(gh run list --workflow=deploy-helmfile.yml --limit 1 --json databaseId -q '.[0].databaseId')
   ```

3. **Download report:**
   ```bash
   # Download installation report artifact
   gh run download <run-id> -n "installation-report-*"
   ```

4. **Review audit logs:**
   ```bash
   # In application code
   const logs = auditLogService.getDeploymentLog('deploy-12345');
   console.log(JSON.stringify(logs, null, 2));
   ```

---

## References

- [OrchestrationEngine Service](./plugins/deployment-control-plane-backend/src/services/orchestrationEngine.ts)
- [InstallationReportService](./plugins/deployment-control-plane-backend/src/services/installationReportService.ts)
- [GitHub Workflow](./github/workflows/deploy-helmfile.yml)
- [Azure Key Vault Docs](https://learn.microsoft.com/en-us/azure/key-vault/)
- [Helm Test Docs](https://helm.sh/docs/helm/helm_test/)

---

**Status:** ✅ All features implemented and documented.  
**Production Ready:** Yes - with proper Azure/GitHub secret configuration.
