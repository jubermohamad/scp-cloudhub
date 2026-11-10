# Self-Contained Architecture Guide

## Overview

`platform_cloudhub` is now a **fully self-contained, single-repository deployment system** with **zero external dependencies** on Helm chart repositories.

This follows the proven pattern used in [SymphonySensa/sri-provisional](https://github.com/SymphonySensa/sri-provisional) repository.

---

## Why Self-Contained?

### ❌ Problems with External Repositories

```
External Helm Repos (https://helm.symphonyfs.net, https://charts.symphonyai.com)
    ↓
Requires: HELM_REPO_USERNAME, HELM_REPO_PASSWORD secrets
    ↓
Network calls to external servers
    ↓
Credentials management overhead
    ↓
Dependency on external services being available
    ↓
Cannot pin exact chart versions (version drift)
```

### ✅ Benefits of Self-Contained

```
platform_cloudhub Repository
    ├── All Helm charts stored locally in charts/
    ├── All configurations in deployments/
    ├── All values in version control
    ├── Zero external dependencies
    ├── Exact version control (git history)
    ├── Faster deployments (no repo fetch)
    ├── Easier troubleshooting (see exact chart code)
    └── Better security (no credential exposure)
```

---

## Architecture

### Directory Structure

```
platform_cloudhub/
├── charts/                          ← Local Helm charts (no external deps)
│   ├── investigation/
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   ├── templates/
│   │   └── charts/                  ← Sub-chart dependencies
│   ├── data/
│   ├── detection/
│   └── common/
│
├── deployments/                     ← Configuration for each deployment
│   ├── sri/
│   │   ├── component/               ← Stage 2: Component helmfiles
│   │   │   └── dev-centralindia/
│   │   │       ├── helmfile.yaml    ← References local charts/investigation
│   │   │       └── values.generated.yaml
│   │   │
│   │   └── overlay/                 ← Stage 3: Customer overlay helmfiles
│   │       └── dev-centralindia/
│   │           └── acme-corp/
│   │               ├── helmfile.yaml
│   │               └── values.generated.yaml
│   │
│   ├── flows/
│   ├── detectionhub/
│   └── invhub/
│
└── .github/workflows/               ← GitHub Actions (no external repos)
    ├── stage-1-provision-cluster.yml
    ├── stage-2-deploy-component.yml   ← Uses local charts
    └── stage-3-deploy-overlay.yml     ← Uses local charts
```

---

## Key Changes from Previous System

### Before (External Repositories)

**helmfile.yaml:**
```yaml
repositories:
  - name: symphonyfs
    url: https://helm.symphonyfs.net
    username: {{ env "HELM_REPO_USERNAME" }}
    password: {{ env "HELM_REPO_PASSWORD" }}

releases:
  - name: sri-investigation
    chart: symphonyfs/sri-investigation  # ← From external repo
    version: "1.0.0"
```

**Workflow requirements:**
- ✅ HELM_REPO_USERNAME secret
- ✅ HELM_REPO_PASSWORD secret
- ✅ "Add Helm Repositories" step
- ✅ Network call to external server

---

### After (Self-Contained)

**helmfile.yaml:**
```yaml
# LOCAL CHARTS ONLY - No external dependencies
# All charts stored in: ../../../../../../charts/

releases:
  - name: sri-investigation
    chart: ../../../../../../charts/investigation  # ← Local path
```

**Workflow requirements:**
- ✅ None! No credentials, no network calls
- ✅ "Verify Local Charts Available" step (optional)
- ✅ Instant access to charts

---

## How It Works

### 1. Local Charts Are Included

All Helm charts are stored in the repository:

```bash
$ ls -la charts/
drwxr-xr-x  investigation/
drwxr-xr-x  data/
drwxr-xr-x  detection/
drwxr-xr-x  common/
```

### 2. Helmfile References Relative Paths

Component helmfile:
```yaml
releases:
  - name: sri-investigation
    chart: ../../../../../../charts/investigation
```

The path is relative to the helmfile location:
```
helmfile location:     deployments/sri/component/dev-centralindia/
                       └ 4 levels up ../../../../../../
local charts:          charts/investigation/ ✓
```

### 3. Helm Install Uses Local Chart

**Workflow execution:**
```bash
# 1. Check out repository (charts included)
git clone platform_cloudhub

# 2. Verify local charts exist
ls -la charts/investigation/

# 3. Deploy using local chart (NO network call)
helm upgrade --install sri-investigation charts/investigation \
  --namespace sri-dev-centralindia \
  --values values.generated.yaml
```

---

## Migrating Charts

### If You Need to Add a New Chart

1. **Obtain the chart code** from the source repository (e.g., SymphonySensa)

2. **Copy into platform_cloudhub:**
   ```bash
   cp -r /path/to/source/charts/my-chart charts/my-chart
   ```

3. **Commit to git:**
   ```bash
   git add charts/my-chart
   git commit -m "Add my-chart as local dependency"
   ```

4. **Reference in helmfile:**
   ```yaml
   releases:
     - name: my-release
       chart: ../../../../../../charts/my-chart
   ```

### If You Update an Existing Chart

1. **Make changes in `charts/{chart-name}/`**
2. **Bump Chart.yaml version:**
   ```yaml
   # charts/investigation/Chart.yaml
   version: 0.1.2
   ```
3. **Commit changes:**
   ```bash
   git add charts/investigation
   git commit -m "Update investigation chart to 0.1.2"
   ```

---

## Deployment Flow

### Stage 2: Deploy Component

```mermaid
1. GitHub Actions triggered
   ↓
2. Checkout repository (includes charts/)
   ↓
3. Verify local charts exist
   ├─ charts/investigation/ ✓
   ├─ charts/data/ ✓
   ├─ charts/detection/ ✓
   └─ charts/common/ ✓
   ↓
4. Read helmfile.yaml from deployments/sri/component/dev-centralindia/
   ↓
5. helm upgrade --install using local chart path
   ├─ chart: ../../../../../../charts/investigation
   └─ values: values.generated.yaml
   ↓
6. No network calls! Chart deployed from local source
   ↓
✅ Deployment complete
```

### Stage 3: Deploy Overlay

```mermaid
1. GitHub Actions triggered
   ↓
2. Checkout repository (includes charts/)
   ↓
3. Verify local charts exist
   ↓
4. Read helmfile.yaml from deployments/sri/overlay/dev-centralindia/acme-corp/
   ↓
5. helm upgrade --install using local chart path
   ├─ chart: ../../../../../../charts/investigation
   └─ values: values.generated.yaml (customer-specific)
   ↓
6. No network calls! Overlay deployed from local source
   ↓
✅ Deployment complete
```

---

## Benefits Comparison

| Aspect | External Repos | Self-Contained |
|--------|---|---|
| **Credentials** | Requires secrets | None needed |
| **Network calls** | Every deploy | Zero |
| **Chart availability** | Dependent on external service | Always available |
| **Version control** | Chart versions managed externally | Full git history |
| **Troubleshooting** | See chart code by cloning external repo | Immediate access |
| **Speed** | Network latency | Instant (local) |
| **Security** | Credentials in GitHub secrets | No credentials needed |
| **Off-network deployments** | Requires network access | Works offline |
| **Audit trail** | External service logs | Git commits |

---

## Secrets Configuration

### No External Helm Repo Secrets Required

The workflows **no longer need**:
- ❌ `HELM_REPO_USERNAME` secret
- ❌ `HELM_REPO_PASSWORD` secret

They **still need** (for Azure/AKS authentication):
- ✅ `AZURE_SUBSCRIPTION_ID` secret
- ✅ `AZURE_TENANT_ID` secret
- ✅ `AZURE_CLIENT_ID` secret

### Action Items

If you previously had external Helm repo secrets in GitHub, you can now safely **delete** them:
1. GitHub → Settings → Secrets and variables → Actions
2. Remove `HELM_REPO_USERNAME` (if present)
3. Remove `HELM_REPO_PASSWORD` (if present)

---

## Verification

### Check All Charts Are Available

```bash
# Verify local charts directory
ls -la charts/

# Expected output:
# drwxr-xr-x  investigation/
# drwxr-xr-x  data/
# drwxr-xr-x  detection/
# drwxr-xr-x  common/

# Verify each chart has Chart.yaml
find charts -name Chart.yaml
```

### Verify Helmfile References

```bash
# Check all helmfiles reference local charts (not external repos)
grep -r "chart:" deployments/ | grep -v "charts/"

# Should return: (nothing - all should reference local paths)
# If you see external repos, those helmfiles need updating
```

### Test Helm Template Locally

```bash
# Test that Helm can find and template the chart
cd deployments/sri/component/dev-centralindia/
helm template sri-investigation ../../../../../../charts/investigation \
  --values values.generated.yaml

# Should output valid Kubernetes manifests with no errors
```

---

## Troubleshooting

### Issue: `chart: not found`

**Symptom:** Helm error "chart not found"

**Solution:**
```bash
# Verify the relative path is correct
cd deployments/sri/component/dev-centralindia/
ls -la ../../../../../../charts/investigation/

# Should show Chart.yaml, values.yaml, templates/, etc.
```

### Issue: `mkdir: cannot create directory`

**Symptom:** Workflow fails creating namespace

**Solution:** Not related to charts. Check namespace creation permissions in AKS.

### Issue: Helmfile not found

**Symptom:** `helmfile: command not found`

**Solution:** Install helmfile:
```bash
# On your local machine
brew install helmfile

# Verify
helmfile version
```

---

## Next Steps

### For Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourorgan/platform_cloudhub
   cd platform_cloudhub
   ```

2. **Verify local charts:**
   ```bash
   ls charts/
   ```

3. **Test deployment locally:**
   ```bash
   cd deployments/sri/component/dev-centralindia/
   helm template sri-investigation ../../../../../../charts/investigation
   ```

### For Deployment

1. **Use GitHub Actions UI:**
   - GitHub → Actions → Select workflow (Stage 2 or 3)
   - No credentials to configure!

2. **Or deploy manually:**
   ```bash
   cd deployments/sri/component/dev-centralindia/
   helm upgrade --install sri-investigation \
     ../../../../../../charts/investigation \
     --namespace sri-dev-centralindia \
     --values values.generated.yaml
   ```

---

## Comparison with sri-provisional

| Aspect | sri-provisional | platform_cloudhub |
|--------|---|---|
| **Chart storage** | Local in `charts/` | Local in `charts/` |
| **Dependencies** | None (external) | None (external) |
| **Deployment** | Helm + helmfile | Helm + helmfile |
| **Values management** | Template-generated | Generated values files |
| **Pattern** | Umbrella chart | Independent stages |

Both systems follow the **self-contained, single-repository pattern** ✅

---

## Summary

✅ **platform_cloudhub is now fully self-contained**
- All Helm charts stored locally in `charts/`
- All deployments reference local charts via relative paths
- Zero external Helm repository dependencies
- Zero credential requirements for chart access
- Full version control of chart code
- Faster, more reliable deployments

🎯 **You can now:**
- Deploy offline (no network needed for charts)
- Version control all chart changes
- Eliminate credential management for Helm repos
- Troubleshoot charts immediately (no external cloning needed)
- Scale to unlimited customers/components

---

**Last updated:** 2024  
**Deployment system:** 3 independent stages (provision, component, overlay)  
**External dependencies:** None (fully self-contained)
