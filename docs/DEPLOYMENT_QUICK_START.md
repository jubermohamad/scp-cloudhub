# Quick Start Guide - Independent Deployment Architecture

## Overview

You now have **three completely independent deployment workflows** that can be triggered separately via GitHub Actions. No stage needs to wait for another to complete.

---

## Quick Links

- 📋 Full Architecture: [INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md](INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md)
- 🚀 Stage 1 Workflow: [.github/workflows/stage-1-provision-cluster.yml](.github/workflows/stage-1-provision-cluster.yml)
- 🚀 Stage 2 Workflow: [.github/workflows/stage-2-deploy-component.yml](.github/workflows/stage-2-deploy-component.yml)
- 🚀 Stage 3 Workflow: [.github/workflows/stage-3-deploy-overlay.yml](.github/workflows/stage-3-deploy-overlay.yml)

---

## How to Deploy

### Option 1: Complete Deployment (All Stages)

**1. Run Stage 1 - Provision Cluster**
```
1. Go to GitHub: Actions → "Stage 1: Provision AKS Cluster"
2. Click "Run workflow" button
3. Fill in:
   - Cluster name: aks-scp-dev-itn-st-cms
   - Resource group: rg-cfe-apps-mj
   - Region: centralindia
4. Click "Run workflow"
⏱️  Duration: ~5 minutes
```

**2. Run Stage 2 - Deploy Component**
```
1. Go to GitHub: Actions → "Stage 2: Deploy Platform Component"
2. Click "Run workflow" button
3. Fill in:
   - Component: sri (or flows, detectionhub, invhub)
   - Instance: dev-centralindia
   - Cluster: aks-scp-dev-itn-st-cms
   - Environment: dev
4. Click "Run workflow"
⏱️  Duration: ~10-15 minutes
```

**3. Run Stage 3 - Deploy Overlay**
```
1. Go to GitHub: Actions → "Stage 3: Deploy Customer Overlay"
2. Click "Run workflow" button
3. Fill in:
   - Component: sri
   - Customer ID: acme-corp (or your customer)
   - Instance: dev-centralindia
   - Cluster: aks-scp-dev-itn-st-cms
   - Environment: dev
4. Click "Run workflow"
⏱️  Duration: ~5-10 minutes
```

---

### Option 2: Add New Customer Only (Stage 3 Only)

If your component is already deployed, just add a new customer:

```
1. Go to GitHub: Actions → "Stage 3: Deploy Customer Overlay"
2. Click "Run workflow"
3. Fill in customer details
4. Run
⏱️  Duration: ~5 minutes
```

---

### Option 3: Parallel Multi-Tenant Deployment

Deploy multiple customer overlays simultaneously:

```
// Trigger Stage 3 multiple times:

Trigger 1: Customer A
Trigger 2: Customer B  
Trigger 3: Customer C

// All run in parallel! No waiting.
⏱️  Total duration: ~5-10 minutes (not 15-30)
```

---

### Option 4: Update Component (Redeploy Stage 2)

Update an existing component deployment:

```
1. Update values file:
   deployments/sri/component/dev-centralindia/values.generated.yaml

2. Run Stage 2 workflow again
   - Same inputs as before
   - Helm will automatically upgrade

3. Your overlays will remain intact!
⏱️  Duration: ~5-10 minutes
```

---

## Directory Structure

```
deployments/
└── {component}
    ├── component/
    │   └── {instance}/
    │       ├── helmfile.yaml           ← Stage 2 deploys this
    │       └── values.generated.yaml
    └── overlay/
        └── {instance}
            └── {customer_id}/
                ├── helmfile.yaml       ← Stage 3 deploys this
                └── values.generated.yaml
```

### Examples

```
✅ deployments/sri/component/dev-centralindia/helmfile.yaml
✅ deployments/sri/overlay/dev-centralindia/acme-corp/helmfile.yaml
✅ deployments/sri/overlay/dev-centralindia/customer-001/helmfile.yaml
✅ deployments/flows/component/prod-us-1/helmfile.yaml
```

---

## Creating New Configurations

### Add New Component Instance

```bash
# Create directory structure
mkdir -p deployments/sri/component/prod-us-1

# Copy helmfile from another instance
cp deployments/sri/component/dev-centralindia/helmfile.yaml \
   deployments/sri/component/prod-us-1/

# Copy and modify values
cp deployments/sri/component/dev-centralindia/values.generated.yaml \
   deployments/sri/component/prod-us-1/

# Edit prod-us-1 values as needed
nano deployments/sri/component/prod-us-1/values.generated.yaml

# Commit to git
git add deployments/sri/component/prod-us-1/
git commit -m "Add SRI component instance for prod-us-1"
```

### Add New Customer Overlay

```bash
# Create directory structure
mkdir -p deployments/sri/overlay/dev-centralindia/new-customer

# Copy helmfile from example
cp deployments/sri/overlay/dev-centralindia/acme-corp/helmfile.yaml \
   deployments/sri/overlay/dev-centralindia/new-customer/

# Copy and customize values
cp deployments/sri/overlay/dev-centralindia/acme-corp/values.generated.yaml \
   deployments/sri/overlay/dev-centralindia/new-customer/

# Edit with customer-specific values
nano deployments/sri/overlay/dev-centralindia/new-customer/values.generated.yaml

# Commit to git
git add deployments/sri/overlay/dev-centralindia/new-customer/
git commit -m "Add overlay for new-customer"
```

---

## Checking Deployment Status

### View Workflow Runs

```
GitHub → Actions → Select workflow → See all runs
```

### Check Kubernetes Status

```bash
# Check namespaces
kubectl get namespaces | grep sri

# Check component deployment
kubectl get deployment -n sri-dev-centralindia

# Check component pods
kubectl get pods -n sri-dev-centralindia

# Check component logs
kubectl logs -n sri-dev-centralindia \
  -l app.kubernetes.io/instance=sri-dev-centralindia \
  --tail=50

# Check overlay deployment
kubectl get deployment -n sri-dev-centralindia \
  -l customer=acme-corp

# Check overlay logs
kubectl logs -n sri-dev-centralindia \
  -l app.kubernetes.io/instance=sri-acme-corp-overlay
```

---

## Common Scenarios

### Scenario: Add 50 Customers Quickly

```
# Run Stage 3 fifty times (or automate):
for i in {1..50}; do
  gh workflow run stage-3-deploy-overlay.yml \
    -f component=sri \
    -f customer_id=customer-$i \
    -f instance=dev-centralindia \
    -f cluster=aks-scp-dev-itn-st-cms \
    -f environment=dev
done

⏱️  All deploy in parallel (~5-10 min vs 250 min sequentially)
```

### Scenario: Hotfix Component Deployment

```
1. Update component values:
   nano deployments/sri/component/dev-centralindia/values.generated.yaml

2. Run Stage 2 workflow again
   - All overlays automatically pick up updates
   - No need to redeploy overlays

3. Done! ✅
```

### Scenario: Rollback Component

```bash
# See deployment history
helm history sri-dev-centralindia -n sri-dev-centralindia

# Rollback to previous version
helm rollback sri-dev-centralindia -n sri-dev-centralindia

# Overlays remain unaffected ✅
```

### Scenario: Rollback Single Customer Overlay

```bash
# See overlay history
helm history sri-acme-corp-overlay -n sri-dev-centralindia

# Rollback only acme-corp
helm rollback sri-acme-corp-overlay -n sri-dev-centralindia

# Other customers unaffected ✅
```

---

## Troubleshooting

### Error: "Helmfile not found"

**Problem**: Workflow can't find your helmfile

**Solution**:
```bash
# Verify path is correct
ls -la deployments/sri/component/dev-centralindia/helmfile.yaml

# If missing, create it:
cp deployments/sri/component/dev-centralindia/helmfile.yaml \
   deployments/{component}/{stage}/{instance}/
```

### Error: "Component namespace not found"

**Problem**: Stage 3 can't find component namespace (Stage 2 not deployed)

**Solution**:
```
1. Deploy Stage 2 first (component deployment)
2. Wait ~5-10 minutes for pods to be ready
3. Then run Stage 3
```

### Error: "Chart not found in repository"

**Problem**: Helm can't find the chart specified in helmfile

**Solution**:
```bash
# Update helm repos
helm repo update

# Check available charts
helm search repo symphonyfs

# Update helmfile chart reference to available version
nano deployments/sri/component/dev-centralindia/helmfile.yaml
```

---

## Getting Help

1. **Check logs**: GitHub Actions workflow logs show detailed errors
2. **View pod logs**: `kubectl logs -n namespace pod-name`
3. **Check events**: `kubectl describe pod -n namespace pod-name`
4. **Read documentation**: [INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md](INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md)

---

## Key Differences from Old System

| Old System | New System |
|-----------|-----------|
| Connected stages | ✅ Independent stages |
| One failure blocks all | ✅ Isolated failures |
| Sequential only | ✅ Parallel possible |
| Complex dependencies | ✅ Simple triggers |
| Hard to debug | ✅ Easy to debug |
| Limited flexibility | ✅ Full flexibility |

---

## Next Steps

1. ✅ Set up your first component deployment (Stage 2)
2. ✅ Add your first customer overlay (Stage 3)
3. ✅ Test adding more customers (Stage 3 only)
4. ✅ Try updating component (Stage 2 only)
5. ✅ Explore parallel deployments

---

## Questions?

See the full architecture guide: [INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md](INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md)
