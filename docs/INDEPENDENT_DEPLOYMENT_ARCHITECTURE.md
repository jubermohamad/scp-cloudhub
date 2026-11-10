# INDEPENDENT DEPLOYMENT ARCHITECTURE
# Three Completely Independent Stages - No Dependencies Between Stages

## Overview

This deployment architecture eliminates stage dependencies by creating **three completely independent workflows** that can be executed in any order or combination.

### Key Principles

- **✅ Stage Independence**: Each stage is a complete, standalone unit
- **✅ No Cascading Failures**: One stage's failure doesn't block others
- **✅ Flexible Execution**: Deploy stages in any order or skip stages entirely
- **✅ Parallel Execution**: Multiple stages can run simultaneously
- **✅ Auditability**: Each stage has its own trigger, logs, and approval chain

---

## Directory Structure

```
deployments/
├── {component}/
│   ├── provision/              # Stage 1: Cluster Provisioning
│   │   ├── dev-centralindia/
│   │   │   ├── helmfile.yaml
│   │   │   └── values.generated.yaml
│   │   └── prod-us-1/
│   │       ├── helmfile.yaml
│   │       └── values.generated.yaml
│   │
│   ├── component/              # Stage 2: Component Deployment
│   │   ├── dev-centralindia/
│   │   │   ├── helmfile.yaml
│   │   │   └── values.generated.yaml
│   │   └── prod-us-1/
│   │       ├── helmfile.yaml
│   │       └── values.generated.yaml
│   │
│   └── overlay/                # Stage 3: Customer Overlays
│       ├── dev-centralindia/
│       │   ├── {customer-1}/
│       │   │   ├── helmfile.yaml
│       │   │   └── values.generated.yaml
│       │   └── {customer-2}/
│       │       ├── helmfile.yaml
│       │       └── values.generated.yaml
│       └── prod-us-1/
│           ├── {customer-1}/
│           │   ├── helmfile.yaml
│           │   └── values.generated.yaml
│           └── {customer-2}/
│               ├── helmfile.yaml
│               └── values.generated.yaml
```

### Examples

```
deployments/sri/component/dev-centralindia/helmfile.yaml
deployments/sri/overlay/dev-centralindia/acme-corp/helmfile.yaml
deployments/invhub/component/prod-us-1/helmfile.yaml
deployments/flows/overlay/prod-us-1/customer-001/helmfile.yaml
```

---

## Stage Details

### Stage 1: Provision AKS Cluster

**Workflow**: `.github/workflows/stage-1-provision-cluster.yml`

**Purpose**: Verify/provision AKS cluster and register in environment registry

**Trigger**: Manual dispatch via GitHub Actions UI

**Inputs**:
- Cluster name: `aks-scp-dev-itn-st-cms`
- Resource group: `rg-cfe-apps-mj`
- Region: `centralindia`

**Output**: Provisioned cluster registered and accessible

**Key Features**:
- No dependencies on other stages
- Idempotent (safe to run multiple times)
- Verifies cluster connectivity
- Registers cluster in environment registry

**Who**: Platform Team

---

### Stage 2: Deploy Platform Component

**Workflow**: `.github/workflows/stage-2-deploy-component.yml`

**Purpose**: Deploy base platform component (SRI, Flows, DetectionHub, etc.)

**Trigger**: Manual dispatch via GitHub Actions UI

**Inputs**:
- Component: `sri` | `flows` | `detectionhub` | `invhub`
- Instance: `dev-centralindia`, `prod-us-1`, etc.
- Cluster: `aks-scp-dev-itn-st-cms`
- Environment: `dev` | `staging` | `prod`

**Output**: Component deployed to target cluster in dedicated namespace

**Key Features**:
- Completely independent (no Stage 1 requirement)
- Can deploy multiple components simultaneously
- Auto-creates namespaces
- Includes health verification
- Atomic deployments with rollback

**Who**: Platform Team

**Path**: `deployments/{component}/component/{instance}/helmfile.yaml`

---

### Stage 3: Deploy Customer Overlay

**Workflow**: `.github/workflows/stage-3-deploy-overlay.yml`

**Purpose**: Apply customer-specific configurations and overlays

**Trigger**: Manual dispatch via GitHub Actions UI

**Inputs**:
- Component: `sri` | `flows` | `detectionhub` | `invhub`
- Customer ID: `acme-corp`, `customer-001`, etc.
- Instance: `dev-centralindia`, `prod-us-1`, etc.
- Cluster: `aks-scp-dev-itn-st-cms`
- Environment: `dev` | `staging` | `prod`

**Output**: Customer-specific overlay deployed to component namespace

**Key Features**:
- Completely independent (no Stage 1 or Stage 2 requirement)
- Verifies component namespace exists (helpful hint if missing)
- Customer-specific configurations applied
- Isolated release names per customer
- Can deploy multiple overlays for same component

**Who**: Professional Services / Customer Operations

**Path**: `deployments/{component}/overlay/{instance}/{customer_id}/helmfile.yaml`

---

## Execution Scenarios

### Scenario 1: Complete Fresh Deployment (All Stages)

```
1. Run Stage 1 workflow → Provision cluster
2. Run Stage 2 workflow → Deploy component
3. Run Stage 3 workflow → Deploy overlay
```

**Execution**: Sequential (each stage as independent trigger)

**Time**: ~30-40 minutes total

---

### Scenario 2: Add New Customer (Overlay Only)

```
1. Run Stage 3 workflow with new customer_id
```

**Prerequisites**: Component already deployed (Stage 2)

**Execution**: Single workflow run

**Time**: ~5-10 minutes

**Who**: Professional Services

---

### Scenario 3: Update Component (Redeploy Stage 2)

```
1. Run Stage 2 workflow with updated values
```

**Execution**: Single workflow run (no Stage 1 needed)

**Time**: ~10-15 minutes

**Who**: Platform Team

---

### Scenario 4: Parallel Multi-Tenant Deployment

```
// Simultaneously run:
- Stage 3: Deploy overlay for Customer A
- Stage 3: Deploy overlay for Customer B
- Stage 3: Deploy overlay for Customer C
```

**Execution**: All in parallel (no blocking)

**Time**: Same as single overlay (~5-10 minutes)

**Who**: Professional Services

---

### Scenario 5: Cluster Upgrade & Re-provision

```
1. Update cluster → Stage 1 workflow (idempotent)
2. Re-deploy components → Stage 2 workflow
3. Re-apply overlays → Stage 3 workflow
```

**Execution**: Sequential but each independent

**Time**: ~30-40 minutes

**Who**: Platform Team / SRE

---

## Creating Helmfile Configurations

### Stage 2 - Component Helmfile

**Location**: `deployments/sri/component/dev-centralindia/helmfile.yaml`

```yaml
repositories:
  - name: symphonyfs
    url: https://helm.symphonyfs.net
    username: {{ env "HELM_REPO_USERNAME" }}
    password: {{ env "HELM_REPO_PASSWORD" }}

releases:
  - name: sri-investigation
    chart: symphonyfs/sri-investigation
    version: "1.0.0"
    namespace: sri-dev-centralindia
    values:
      - values.generated.yaml
    
    # Configuration for SRI component
    set:
      environment: dev
      cluster: aks-scp-dev-itn-st-cms
      region: centralindia
```

**Corresponding Values**: `deployments/sri/component/dev-centralindia/values.generated.yaml`

```yaml
# Component base values
replicaCount: 2

image:
  repository: symphonyai/sri-investigation
  tag: latest
  pullPolicy: IfNotPresent

resources:
  limits:
    cpu: 2000m
    memory: 2Gi
  requests:
    cpu: 1000m
    memory: 1Gi

# Component-specific configuration
config:
  logLevel: info
  enableMetrics: true
  
# NO tenant/customer-specific settings here (handled by Stage 3)
```

---

### Stage 3 - Overlay Helmfile

**Location**: `deployments/sri/overlay/dev-centralindia/acme-corp/helmfile.yaml`

```yaml
repositories:
  - name: symphonyfs
    url: https://helm.symphonyfs.net
    username: {{ env "HELM_REPO_USERNAME" }}
    password: {{ env "HELM_REPO_PASSWORD" }}

releases:
  - name: sri-investigation-acme-corp-overlay
    chart: symphonyfs/sri-investigation-overlay
    version: "1.0.0"
    namespace: sri-dev-centralindia
    values:
      - values.generated.yaml
    
    # Configuration for ACME Corp overlay
    set:
      customerId: acme-corp
      environment: dev
```

**Corresponding Values**: `deployments/sri/overlay/dev-centralindia/acme-corp/values.generated.yaml`

```yaml
# Customer-specific overlay values
customer:
  id: acme-corp
  name: ACME Corporation
  region: centralindia

# Tenant customizations
tenantConfig:
  branding:
    logo: https://acme-corp.example.com/logo.png
    colors:
      primary: "#007BFF"
  
  features:
    investigationAccess: true
    advancedAnalytics: true
    customReporting: true

# Customer-specific resource limits
resources:
  limits:
    cpu: 1000m
    memory: 1Gi

# Customer data isolation
dataIsolation:
  namespace: sri-dev-centralindia
  labels:
    customer: acme-corp
```

---

## Deployment Workflow Comparison

### OLD ARCHITECTURE (Connected Stages)

```
detect-changes
    ↓
deploy-non-prod ← depends on detect-changes
    ↓
deploy-prod ← depends on detect-changes

Issues:
❌ All stages run together
❌ One failure blocks others
❌ Can't run overlays independently
❌ Complex job dependencies
❌ Inflexible scheduling
```

### NEW ARCHITECTURE (Independent Stages)

```
stage-1-provision
(independent)

stage-2-component
(independent)

stage-3-overlay
(independent)

Benefits:
✅ Run stages independently
✅ No cascading failures
✅ Parallel execution possible
✅ Simple triggers
✅ Flexible scheduling
✅ Easy to skip stages
```

---

## Migration Guide

### Step 1: Create Helmfile Configurations

Copy your current deployment configurations into the new structure:

```bash
# Example for SRI component
cp charts/investigation/values.yaml \
   deployments/sri/component/dev-centralindia/values.generated.yaml

# Create helmfile
cat > deployments/sri/component/dev-centralindia/helmfile.yaml <<'EOF'
repositories:
  - name: symphonyfs
    url: https://helm.symphonyfs.net
releases:
  - name: sri-dev
    chart: symphonyfs/investigation
    values:
      - values.generated.yaml
EOF
```

### Step 2: Create Customer Overlays

For each customer, create overlay configurations:

```bash
mkdir -p deployments/sri/overlay/dev-centralindia/{customer-id}

cat > deployments/sri/overlay/dev-centralindia/{customer-id}/helmfile.yaml <<'EOF'
repositories:
  - name: symphonyfs
    url: https://helm.symphonyfs.net
releases:
  - name: sri-customer-overlay
    chart: symphonyfs/investigation-overlay
    values:
      - values.generated.yaml
EOF

# Add customer-specific values
cat > deployments/sri/overlay/dev-centralindia/{customer-id}/values.generated.yaml <<'EOF'
customer:
  id: customer-id
  # customer-specific config
EOF
```

### Step 3: Trigger Workflows

Use GitHub Actions UI to trigger each stage independently:

```
1. Go to Actions → Choose workflow
2. Click "Run workflow"
3. Fill in inputs
4. Run
```

---

## Rollback Strategy

### For Component (Stage 2)

```bash
# Check deployment history
helm history sri-dev-centralindia -n sri-dev-centralindia

# Rollback to previous version
helm rollback sri-dev-centralindia -n sri-dev-centralindia
```

### For Overlay (Stage 3)

```bash
# Check overlay history
helm history sri-acme-corp-overlay -n sri-dev-centralindia

# Rollback overlay independently
helm rollback sri-acme-corp-overlay -n sri-dev-centralindia
```

---

## Monitoring & Observability

### Component Status

```bash
# Check component deployment
kubectl get deployment -n sri-dev-centralindia

# Check component pods
kubectl get pods -n sri-dev-centralindia \
  -l app.kubernetes.io/instance=sri-dev-centralindia

# Component logs
kubectl logs -n sri-dev-centralindia \
  -l app.kubernetes.io/instance=sri-dev-centralindia \
  --tail=100
```

### Overlay Status

```bash
# Check overlay deployment
kubectl get deployment -n sri-dev-centralindia \
  -l customer=acme-corp

# Overlay logs
kubectl logs -n sri-dev-centralindia \
  -l app.kubernetes.io/instance=sri-acme-corp-overlay
```

---

## Troubleshooting

### "Helmfile not found" Error

**Error**: `❌ Helmfile not found: deployments/sri/component/dev-centralindia/helmfile.yaml`

**Solution**:
1. Verify path structure: `deployments/{component}/{stage}/{instance}/`
2. Create helmfile: `touch deployments/sri/component/dev-centralindia/helmfile.yaml`
3. Check file permissions: `chmod 644 helmfile.yaml`

### Overlay Can't Find Component Namespace

**Error**: `❌ Component namespace not found: sri-dev-centralindia`

**Solution**:
1. Verify component deployment: `kubectl get namespace | grep sri`
2. Deploy component first (Stage 2)
3. Check cluster connectivity

### Helm Chart Not Found

**Error**: `Error: chart not found in repository`

**Solution**:
1. Update Helm repos: `helm repo update`
2. List available charts: `helm search repo symphonyfs`
3. Verify chart name in helmfile.yaml

---

## Summary

| Aspect | Old | New |
|--------|-----|-----|
| **Dependencies** | Connected | Independent |
| **Failure Impact** | Cascading | Isolated |
| **Execution** | Sequential | Parallel |
| **Flexibility** | Low | High |
| **Debugging** | Hard | Easy |
| **Scalability** | Limited | Unlimited |

✅ **Result**: Three completely independent deployment stages that can be orchestrated flexibly!
