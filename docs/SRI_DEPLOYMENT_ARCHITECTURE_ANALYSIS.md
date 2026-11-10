# SRI Deployment Architecture & Workflow Analysis

**Source Repository:** `SymphonySensa/sri-provisional`  
**Date:** 2026-08-29  
**Purpose:** Comprehensive technical documentation of the SRI platform deployment architecture, workflow orchestration, and CI/CD pipeline.

---

## Executive Summary

The SRI platform uses a **sophisticated, multi-stage provisioning pipeline** that orchestrates deployment of four independent domain charts across Kubernetes clusters via a unified provisioning engine. The system emphasizes:

- **Reproducibility** - Pinned chart versions, versioned installations, content digests
- **Safety** - Multi-gate approval for production, pre-flight validation, idempotent operations
- **Scalability** - Parallel product installation, independent SKU selection, environment-agnostic templating
- **Auditability** - Complete audit trail of provisioning decisions and outcomes

The deployment is **NOT scripted** (no shell automation) but entirely Helm-driven, with orchestration by a Python-based provisioning engine that can run as a CLI tool, in-cluster Job, or through a web API.

---

## Part 1: Repository Structure & Components

### 1.1 Directory Layout

```
sri-provisional/
├── .github/workflows/
│   └── provisioner-ci.yml           # CI/CD pipeline (delegates to sri-gh-workflows)
│
├── charts/                          # Four domain chart groups
│   ├── common/                      # Shared operators + services (all clusters)
│   │   ├── charts/
│   │   │   ├── keycloak/           # Identity & auth
│   │   │   ├── platform-services/  # postgres, redis, kafka, minio, micro-frontend
│   │   │   ├── common-res/         # Operators + ingress-nginx + cert-manager
│   │   │   ├── spark-operator/
│   │   │   └── ...
│   │   ├── Chart.yaml
│   │   └── values.yaml
│   │
│   ├── detection/                   # Detection domain
│   │   ├── charts/
│   │   │   ├── detectionhub/       # Core detection platform
│   │   │   ├── ai-store/           # Model hub, MLflow, Zot, MinIO
│   │   │   ├── threat-intelligence/
│   │   │   └── ...
│   │   └── Chart.yaml
│   │
│   ├── investigation/               # Investigation domain
│   │   ├── charts/
│   │   │   ├── invhub/             # Core investigation platform
│   │   │   ├── api/
│   │   │   ├── web/
│   │   │   └── ...
│   │   └── Chart.yaml
│   │
│   └── data/                        # Data domain
│       ├── charts/
│       │   ├── dxv/
│       │   ├── sensa-data-ontology/    # Lens
│       │   ├── sensa-data-fin-*/
│       │   ├── assembly-workflows/
│       │   └── ...
│       └── Chart.yaml
│
├── provisioner/                     # Provisioning pipeline (API + engine)
│   ├── Dockerfile                   # Single image: API + engine + helm + bundles
│   ├── app/
│   │   ├── api/
│   │   │   └── main.py             # Thin provisioning API (no install logic)
│   │   └── engine/
│   │       ├── cli.py              # CLI entry point
│   │       ├── installer.py        # Main orchestration engine
│   │       ├── plan.py             # SKU → install plan resolution
│   │       ├── steps.py            # Steps framework
│   │       ├── materials.py        # Secret/config materials
│   │       ├── helm.py             # Helm wrapper
│   │       └── kube.py             # Kubernetes operations
│   ├── ui/                         # Web UI (client-side only)
│   ├── release-sri/                # Release bundle configuration
│   │   ├── sku-catalog.yaml       # Available SKUs
│   │   ├── versions.yaml           # Pinned chart versions (BOM)
│   │   ├── installation.yaml       # Global pre/post steps
│   │   ├── products/
│   │   │   ├── operators/product.yaml
│   │   │   ├── platform/product.yaml
│   │   │   ├── umbrella/product.yaml
│   │   │   ├── detection/product.yaml
│   │   │   ├── investigation/product.yaml
│   │   │   └── data/product.yaml
│   │   └── installation-config.sri-dev-centraindia.yaml
│   ├── README.md                   # Provisioning pipeline documentation
│   ├── EXTENDING.md                # How to add products
│   └── tools/                      # Validation & testing
│
├── deploy/                         # Environment configurations
│   ├── base/
│   │   └── values.tmpl.yaml       # Template for generated values
│   ├── template/
│   │   ├── values.yaml            # GENERATED values (machine-produced)
│   │   ├── secrets.provided.yaml  # Required external secrets
│   │   ├── values-common-res.yaml
│   │   ├── env.yaml               # 4 tokens for templating
│   │   └── ...
│   ├── sri-dev-centraindia/       # LIVE ENVIRONMENT configuration
│   │   ├── README.md              # Environment runbook
│   │   ├── values.yaml            # Generated from template
│   │   ├── secrets.gen.yaml       # Generated credentials (gitignored)
│   │   ├── secrets.provided.yaml  # Vault references
│   │   ├── values-*.yaml          # Per-product/per-component
│   │   ├── cluster-issuer.yaml
│   │   ├── aistore-cert.yaml
│   │   └── ...
│   ├── multi-namespace.md         # One-release-per-domain layout guide
│   └── gen-env-values.py          # Script: template → generated values
│
├── design/
│   ├── ARCHITECTURE.md            # High-level architecture
│   ├── RELEASE-SELECTION-DESIGN.md
│   └── PROVISIONING-PIPELINE.md
│
├── docs/                          # General documentation
│   ├── ARCHITECTURE.md
│   ├── container-architecture.md
│   ├── github-actions-deployment-workflows.md
│   ├── github-environment-configuration.md
│   └── ...
│
├── README.md                      # Repository overview
├── provisioner-ci.yml             # GitHub Actions workflow
└── ...
```

### 1.2 Chart Structure

Each domain chart follows this pattern:

```
domain/
├── Chart.yaml
│   name: <domain>
│   version: <X.Y.Z>
│   dependencies:
│     - name: <subchart>
│       version: <X.Y.Z>
│       repository: ...
│
├── values.yaml              # Base defaults (non-production safe)
├── values-scp.yaml         # SCP baseline (platform posture + image sources)
├── values-dev.yaml         # Dev AKS specific values
├── values-*.yaml           # Environment-specific overrides
│
├── templates/
│   ├── <application-deployments>
│   ├── <services>
│   ├── <ingresses>
│   ├── NOTES.txt
│   └── ...
│
├── charts/                  # Subdomain products (unpacked, not tgz)
│   ├── <product-a>/
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   └── templates/
│   ├── <product-b>/
│   └── ...
│
└── README.md               # Deployment guide for this domain
```

---

## Part 2: CI/CD Workflow & Entry Points

### 2.1 GitHub Actions Workflow

**File:** `.github/workflows/provisioner-ci.yml`

```yaml
name: SRI Provisioner CI/CD

# Triggers
on:
  push:
    branches: [main]
    paths:
      - 'provisioner/**'
      - 'deploy/**'
      - '.github/workflows/provisioner-ci.yml'
  workflow_dispatch: []  # Manual trigger on any branch

# Delegates to external workflow
jobs:
  build-scan-deploy:
    uses: SymphonySensa/sri-gh-workflows/.github/workflows/build-scan-deploy.yml@main
    with:
      # All build, scan, and deploy logic lives in sri-gh-workflows
      image-name: provisioner
      Dockerfile: provisioner/Dockerfile
      # ... more inputs
```

**Key Points:**
- Builds provisioner **independently** of umbrella chart
- Scans image for vulnerabilities
- Deploys provisioner service
- **All CI/CD logic externalized** to `SymphonySensa/sri-gh-workflows`
- Image: Single container with API + engine + helm + both bundles + charts

### 2.2 Entry Points for Deployment

#### A. **Engine CLI (Most Proven)**
```bash
# Prerequisites
kubectl config use-context <desired-cluster>

# Validate without installing
python -m engine.cli plan \
  -c deploy/sri-dev-centraindia/installation-config.yaml \
  -r provisioner/release-sri/

# Dry-run (render with server-side validation)
python -m engine.cli dry-run \
  -c deploy/sri-dev-centraindia/installation-config.yaml \
  -r provisioner/release-sri/ \
  --server

# Install (full deployment)
python -m engine.cli install \
  -c deploy/sri-dev-centraindia/installation-config.yaml \
  -r provisioner/release-sri/ \
  --report installation-report.json
```

**Status:** ✅ **Proven against real platform** - entire `sri-dev-centraindia` installed from zero

#### B. **Provisioning API + Installer Job (In-Cluster)**
```bash
POST /installations
{
  "config": <installation-config>,
  "sku": ["sri-detection", "sri-investigation", "sri-data"]
}
```

**Flow:**
1. API resolves plan from SKU + config
2. API generates tenant identity
3. API persists state
4. API spawns Installer Job
5. Job runs: `python -m engine.installer` (same engine, same code path)
6. Job pulls status via `PUT /internal/installations/{id}/status`

**Status:** Packaging gap only (image must be in cluster registry)

#### C. **Air-Gapped Installer Job**
- Same engine + plan ConfigMap (in-cluster plan)
- Image-gated (must be available in-cluster)
- No external cluster API access

#### D. **Marketplace UI**
- Pure client-side (no frameworks, air-gap safe)
- Reads from Provisioning API
- SKU tiles from `sku-catalog.yaml`
- Hash routing + polling for status

---

## Part 3: Provisioning Pipeline Architecture

### 3.1 The Provisioning Engine

**Core Principle:** *Every operation is idempotent, so re-runs fast-forward and resume at the failure point.*

#### Installation Stages

```
Stage 0  ┌─────────────────────────────────────┐
         │ Preflight + Global PreSteps         │
         │ • Gate enforcement (provenance,     │
         │   approval, policy)                 │
         │ • Config validation                 │
         │ • Global pre-deployment steps       │
         └─────────────────────────────────────┘
                        ↓
Stage 1  ┌─────────────────────────────────────┐
         │ Platform Components (Sequential)    │
         │ • Operators (shared cluster-scoped) │
         │ • Platform services (shared)        │
         │ • Ordered by: stage → needs-DAG     │
         └─────────────────────────────────────┘
                        ↓
Stage 2  ┌─────────────────────────────────────┐
         │ SKU Products (Parallel)             │
         │ Per product, per dependency wave:   │
         │ • secrets (generate or copy)        │
         │ • preSteps                          │
         │ • helm upgrade --install            │
         │   ├── Namespace creation            │
         │   ├── Registry pull secrets         │
         │   ├── TLS secrets                   │
         │   └── Application resources         │
         │ • postSteps                         │
         │ • smoke test (optional)             │
         └─────────────────────────────────────┘
                        ↓
Stage 3  ┌─────────────────────────────────────┐
         │ Global PostSteps + Report           │
         │ • Environment setup/cleanup         │
         │ • Final health checks               │
         │ • Installation report JSON          │
         └─────────────────────────────────────┘
```

### 3.2 Helm Release Per Product

Each product becomes a **single Helm release**:

```
└─ Release: <release-name>
   Namespace: <namespace>
   Chart: <domain>/charts/<product>/
   Values:
     ├─ Chart defaults (values.yaml)
     ├─ Environment values (values-<env>.yaml)
     ├─ Generated values (secrets.gen.yaml)
     ├─ Config overrides (installation-config)
     └─ Component toggles (sku, component selection)
   
   Resources:
   ├─ Deployments (application pods)
   ├─ StatefulSets (data stores)
   ├─ Services (ClusterIP, LoadBalancer)
   ├─ Ingress (TLS termination)
   ├─ ConfigMaps (configuration)
   ├─ Secrets (credentials)
   ├─ PVCs (persistent storage)
   ├─ Jobs (setup/migration)
   └─ Custom Resources (operators)
```

### 3.3 Deployment Order & Dependencies

**Multi-Namespace Mode (per `deploy/multi-namespace.md`):**

```
1. operators (shared)
   └─ Release: sri-operators, Namespace: sri-operators
   └─ Installs: common-res, spark-operator, CNPG, Strimzi, minio-operator, ingress-nginx, reloader
   
2. platform (shared)
   └─ Release: sri-platform, Namespace: sri-common
   └─ Depends: operators healthy
   └─ Installs: postgres, redis, kafka, minio, keycloak, micro-frontend
   
3. Products (parallel, but respect dependencies)
   ├─ Wave 1 (depends only on platform):
   │  ├─ sri-detection
   │  ├─ sri-investigation
   │  └─ sri-data
   └─ Wave 2+ (if products declare needs on other products)
```

**Single-Namespace Mode (umbrella):**

```
1. operators (shared)
   └─ Release: sri-operators, Namespace: sri-operators
   
2. umbrella (everything)
   └─ Release: sri, Namespace: sri
   └─ Chart root with four domain charts as subcharts
   └─ Depends: operators healthy
   └─ Installs: common + detection + investigation + data
```

### 3.4 Dependency Resolution

**Product Descriptor Structure:**

```yaml
# products/<domain>/<product>/product.yaml
name: <product-name>
type: product               # product | platform
stage: 1                    # 1 = platform, 2 = SKU products
needs: [platform]           # Dependency list (resolved DAG)
requires: [operators]       # Hard dependency (before install)

valuesFiles: [...]          # Configuration files
generatedValues:            # Passwords, keys, etc. (generated once, persisted)
  - path: common.keycloak.auth.adminPassword
requiredConfigValues:       # Non-generatable (SAML, API keys, etc.)
  - path: samlKeyPair
    description: "..."

preSteps: [...]             # Pre-install cluster operations
postSteps: [...]            # Post-install setup/verification
smokeTest: helm-test        # Verification

phases:                     # Multi-phase for bootstrap sequences
  - name: "phase1"
    values: {}
    steps: []
  - name: "phase2"
    steps: []
```

**Wave Resolution Algorithm:**

```python
def product_waves(plan):
    """Stage-2 products run in PARALLEL, grouped by dependency waves."""
    prods = list(plan["stages"]["products"])
    waves, placed = [], set()
    remaining = list(prods)
    while remaining:
        # Wave N: all remaining products whose only dependencies are already placed
        wave = [n for n in remaining
                if all(d in placed for d in plan["products"][n].get("needs", []))]
        waves.append(wave)
        placed.update(wave)
        remaining = [n for n in remaining if n not in placed]
    return waves
```

---

## Part 4: Configuration & Secrets Management

### 4.1 Installation-Config Structure

**File:** `deploy/sri-dev-centraindia/installation-config.yaml`

```yaml
# Customer & Environment
customer: sri-dev-centraindia
env: dev                                    # Environment class token
namespacePrefix: sri                        # → sri-common, sri-detection, ...

# SKU Selection
sku: [sri-detection, sri-investigation, sri-data]

# Secrets Mode
secrets:
  mode: provided                            # or: generate
  source: infisical                        # or: keyvault, kube-secret

# Registry & Image Configuration
registry:
  host: "{{ .acrHost }}"                  # ACR address
  username: "{{ .acrUsername }}"
  password: "{{ .acrPassword }}"

# Per-Product Configuration
products:
  operators:
    valuesFiles:
      - deploy/multi-namespace/values-common-res.yaml
    namespace: sri-operators               # Override default
    release: sri-operators                 # Override default
    values:
      cloudnative-pg.enabled: true
      spark-operator.enabled: true

  platform:
    valuesFiles:
      - deploy/multi-namespace/values-common.yaml
      - deploy/template/secrets.gen.yaml   # Generated secrets
      - deploy/template/secrets.provided.yaml
    values:
      common-keycloak.auth.adminPassword: "{{ .kcAdminPassword }}"
      # ... more config

  detection:
    components:
      detectionhub: true
      ai-store: true
    valuesFiles:
      - deploy/multi-namespace/values-detection.yaml
    values:
      detectionhub.api.replicas: 3

# Database & Credentials
database:
  adminSecretRef: "postgres-admin-secret"  # Pre-existing secret name

# Endpoints
endpoints:
  ingressDomain: "sri-dev-centraindia.symphonyai.dev"

# Approval (for production)
approvedBy: "identity/devops-team"         # Second-person signature
```

### 4.2 Secrets Management Modes

#### A. **Generate Mode** (Default)

Pipeline **invents** non-user-facing values:

```yaml
secrets:
  mode: generate
  source: infisical                        # Persist in Vault
```

**Generated Values Declared in Product Descriptors:**

```yaml
generatedValues:
  - path: common.keycloak.auth.adminPassword
    description: "Keycloak bootstrap admin password"
    
  - path: common-platform-services.redis.password
    description: "Redis password"
```

**Lifecycle:**
1. First install: Pipeline generates random value
2. Persist in Vault (Infisical) with tenant ID
3. On upgrade/retry: Read from Vault (same value, no rotation)
4. On pod restart: Pod re-reads from secret volume

#### B. **Provided Mode**

User **supplies** all values (for external Vaults or air-gapped):

```yaml
secrets:
  mode: provided
```

**Required Values in installation-config:**

```yaml
requiredConfigValues:
  - path: saml.keyPair
    description: "SAML signing keypair (PEM format)"
  - path: anthropic.apiKey
    description: "Anthropic API key"
  - path: registry.password
    description: "ACR pull secret password"
```

### 4.3 Values File Composition Order

```
┌─────────────────────────────────────────┐
│ 1. Chart base defaults (values.yaml)    │ Lowest precedence
├─────────────────────────────────────────┤
│ 2. Environment values (values-<env>)    │
├─────────────────────────────────────────┤
│ 3. Generated values (secrets.gen.yaml)  │
├─────────────────────────────────────────┤
│ 4. Product overrides (installation-cfg) │ Highest precedence
└─────────────────────────────────────────┘
```

**Helm Command Pattern:**

```bash
helm upgrade --install <release> ./chart \
  -n <namespace> \
  -f chart/values.yaml \                    # Base (loaded automatically)
  -f deploy/<env>/values-<env>.yaml \       # Environment
  -f deploy/<env>/secrets.gen.yaml \        # Generated
  -f deploy/<env>/config-override.yaml      # Overrides (optional)
  --set global.tenant.id=<tenant-id> \
  --set global.imageRegistry=<acr> \
  # ... more values
```

### 4.4 Component Selection

**SKU Catalog Selection:**

```yaml
# sku-catalog.yaml
skus:
  sri-detection:
    components:
      detection.detectionhub: true
      detection.ai-store: true
  sri-investigation:
    components:
      investigation.invhub: true
  sri-data:
    components:
      data.dxv: true
      data.lens: true
      data.fin-pipeline: true
```

**Component Rendering in Values:**

Each component maps to a values path, enabling/disabling features:

```yaml
# generated during installation
detection:
  detectionhub:
    enabled: true
  ai-store:
    enabled: true
investigation:
  invhub:
    enabled: true
data:
  dxv:
    enabled: true
  lens:
    enabled: true
```

**Cross-Product Dependencies:**

Components can require other components:

```yaml
# threat-intelligence needs graph database
needs:
  - common.neo4j                           # Enables common.neo4j: true
```

---

## Part 5: Pre-Deployment Validation

### 5.1 Three-Contract Preflight

Fails in **seconds, not 20 minutes**, before first Helm command:

#### Contract 1: **Values Files Exist & Parse**

```python
for name in plan["stages"]["platform"] + plan["stages"]["products"]:
    for spec in config["products"][name]["valuesFiles"]:
        path = resolve_path(spec)  # Against baseDir
        with open(path) as f:
            yaml.safe_load(f)      # Fail if syntax error
```

#### Contract 2: **Materials Exist & Resolvable**

```python
# Pre-steps may reference materials (secrets, configs, etc.)
for step in all_steps:
    if step.get("type") in MATERIAL_STEPS:
        material_name = step.get("material")
        # Fail if material does not exist in materials.yaml
```

#### Contract 3: **Required Values Present & Non-Empty**

```python
if secrets_mode == "provided":
    # ALL generatedValues must be supplied
    for decl in desc.get("generatedValues", []):
        if not merged.get(decl["path"]):
            fail(f"Missing required value: {decl['path']}")
            
for req in desc.get("requiredConfigValues", []):
    if not merged.get(req["path"]):
        fail(f"Missing required value: {req['path']}")
```

### 5.2 Cluster Safety Gates

#### Gate 1: Provenance Verification

```
For each chart source (directory):
  ├─ Git commit SHA (short)
  ├─ Branch name
  ├─ Is commit merged to main?
  ├─ Is working tree dirty?
  ├─ Content digest (SHA256 of sources)
  └─ Which products use this source?

Log Example:
  provenance ./charts/detection: 
    source=git commit=a3f2b1e branch=main 
    merged=true dirty=false 
    content=sha256:abc123... 
    products=sri-detection,threat-intelligence
```

#### Gate 2: Environment Class Validation

```python
ENV_TOKEN_CLASS = {
    "dev": "dev",           # dev, develop, development, sandbox, local
    "qa": "qa",             # qa, test, testing, staging, uat, preprod
    "prod": "prod",         # prod, prd, production, live
}

# Escalation prevention
cluster_env_class = registry.get(cluster_name, "unknown")
declared_env_class = ENV_TOKEN_CLASS.get(config.get("env"), "unknown")

# Strictness check
if strictness[cluster_env_class] < strictness[declared_env_class]:
    fail("Config declares stricter env than cluster registry knows")
```

#### Gate 3: Production Approval (for prod clusters only)

```
Production Requirements:
  1. Requester MUST declare themselves (config.requestedBy)
  2. Second person MUST approve (different subject)
  3. Approval record MUST:
     - Be recent (within 24 hours)
     - Be bound to config fingerprint
     - Specify the cluster name
     - Be signed by verified subject
     
Example approval ConfigMap:
  apiVersion: v1
  kind: ConfigMap
  metadata:
    name: sri-install-approval-<installation-id>
    namespace: sri-system
  data:
    approvedBy: "alice@example.com"
    approvedAt: "2026-08-29T14:30:00Z"
    expiresAt: "2026-08-30T14:30:00Z"
    reason: "Quarterly update - verified by QA"
    clusterName: "aks-scp-dev-sdc-st-cms"
    configFingerprint: "sha256:abc123..."
```

---

## Part 6: Helm Deployment

### 6.1 Helm Release Lifecycle

```
For each product in order (or parallel waves):

1. Ensure Namespace
   └─ kube.ensure_namespace(namespace, tenant_id)

2. Create/Manage Secrets
   ├─ Registry pull secret (if chart-managed)
   ├─ TLS secret for ingress (if chart-managed)
   └─ Application secrets (from values or Vault)

3. Run PreSteps (idempotent cluster operations)
   └─ Jobs, config, setup operations

4. Helm Release (Main Application)
   └─ helm upgrade --install <release> <chart> \
        -n <namespace> \
        --create-namespace \
        -f values.yaml (all layers) \
        --wait \                                 # Wait for rollout
        --timeout 20m \
        --rollback-on-failure                   # Undo on error

5. Run PostSteps (Verification, configuration)
   └─ Health checks, setup completion

6. Smoke Test (if helm-test)
   └─ helm test <release> -n <namespace>

7. Report Status
   └─ Update Reporter (API, logs)
```

### 6.2 Helm Rollback Behavior

**Default:** `--rollback-on-failure`

```yaml
# provisioner/app/engine/installer.py
ROLLBACK_ON_FAILURE = True  # Default for all releases

# In product.yaml, override if needed:
rollbackOnFailure: false    # Don't rollback, leave broken release
```

**Rollback Semantics:**
- First install + failure: Uninstall (no previous revision)
- Upgrade + failure: Rollback to previous revision
- User-triggered: `engine.cli rollback` reverses order, skips operators

### 6.3 Multi-Phase Installations

For **bootstrap sequences** that cannot be expressed in one pass:

```yaml
phases:
  - name: "operators"
    values:
      installOperators: true
      installApplications: false
    steps:
      - name: "wait-for-webhooks"
        type: wait
        condition: "kubectl get deployment operator-webhooks..."

  - name: "applications"
    values:
      installOperators: false
      installApplications: true
    steps: []
```

**Same release, twice**:
1. Phase 1: Install operators
2. Intermediate steps: Wait for operator webhooks to be ready
3. Phase 2: Install applications (operators now admit them)

---

## Part 7: Post-Deployment Verification

### 7.1 Smoke Testing

**Framework:** Helm test hooks

```yaml
# In chart templates/
apiVersion: batch/v1
kind: Job
metadata:
  name: "{{ .Release.Name }}-smoke-test"
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": "before-this,failed,succeeded"
spec:
  template:
    spec:
      containers:
      - name: test
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
        command:
          - "/bin/sh"
          - "-c"
          - |
            curl -f http://{{ .Release.Name }}-api:8080/health || exit 1
            echo "✓ Health check passed"
```

**Smoke Test Configuration:**

```yaml
# In product descriptor:
smokeTest: helm-test              # Run chart's test hooks
# or: none                         # Skip smoke test
# or: optional                     # Warn but don't fail if test fails
```

### 7.2 Installation Report

**Report Format:** JSON (written to stdout and file)

```json
{
  "installationId": "i-abc123...",
  "mode": "install",
  "state": "SUCCEEDED",
  "error": null,
  "sku": ["sri-detection", "sri-investigation", "sri-data"],
  "bundleVersion": "1.0.49",
  "tenant": {
    "id": "t-qakalvin...",
    "slug": "qakalvin",
    "email": "kalvin@example.com"
  },
  "customer": "sri-dev-centraindia",
  "startedAt": "2026-08-29T14:00:00Z",
  "finishedAt": "2026-08-29T14:35:00Z",
  "cluster": {
    "name": "aks-scp-dev-sdc-st-cms",
    "envClass": "dev",
    "declaredEnvClass": "dev",
    "envClassEscalated": false
  },
  "gates": {
    "mode": "install",
    "cluster": "aks-scp-dev-sdc-st-cms",
    "envClass": "dev",
    "provenance": {
      "./charts/detection": {
        "source": "git",
        "shortCommit": "a3f2b1e",
        "branch": "main",
        "mergedToMain": true,
        "dirty": false,
        "contentDigest": "sha256:abc123...",
        "products": ["sri-detection"]
      }
    },
    "approval": {
      "approvedBy": "bob@example.com",
      "expiresAt": "2026-08-30T14:30:00Z"
    }
  },
  "stages": [
    {
      "name": "preflight",
      "state": "SUCCEEDED",
      "startedAt": "2026-08-29T14:00:00Z",
      "finishedAt": "2026-08-29T14:02:00Z",
      "seconds": 120
    },
    {
      "name": "platform",
      "state": "SUCCEEDED",
      "seconds": 480
    },
    {
      "name": "products",
      "state": "SUCCEEDED",
      "seconds": 900
    }
  ],
  "products": {
    "operators": {
      "state": "SUCCEEDED",
      "release": "sri-operators",
      "namespace": "sri-operators",
      "seconds": 120,
      "steps": [
        {
          "phase": "install",
          "name": "helm-upgrade",
          "state": "SUCCEEDED",
          "seconds": 110
        }
      ]
    },
    "platform": {
      "state": "SUCCEEDED",
      "release": "sri-platform",
      "namespace": "sri-common",
      "seconds": 360,
      "steps": [
        {
          "phase": "pre",
          "name": "setup-postgres",
          "state": "SUCCEEDED",
          "seconds": 45
        },
        {
          "phase": "install",
          "name": "helm-upgrade",
          "state": "SUCCEEDED",
          "seconds": 300
        },
        {
          "phase": "post",
          "name": "verify-keycloak",
          "state": "SUCCEEDED",
          "seconds": 15
        }
      ]
    },
    "detection": {
      "state": "SUCCEEDED",
      "release": "sri-detection",
      "namespace": "sri-detection",
      "seconds": 420,
      "steps": []
    }
  }
}
```

---

## Part 8: AKS Deployment Specifics

### 8.1 Cluster Context & Credentials

**Context Management:**

```bash
# Default: use current context
python -m engine.cli install -c config.yaml -r release/

# Override context
python -m engine.cli install -c config.yaml -r release/ \
  --context aks-scp-dev-sdc-st-cms

# Fetch credentials via Azure CLI
python -m engine.cli install -c config.yaml -r release/ \
  -c <cluster-name> -g <resource-group>
  # Internally: az aks get-credentials --name <cluster-name> --resource-group <resource-group>
```

**Cluster Info Discovery:**

```python
# From kubeconfig context or API server
cluster_info = {
    "name": "aks-scp-dev-sdc-st-cms",
    "envClass": "dev",  # Inferred from registry if known
    "host": "https://...",
    "tlsVerify": true
}
```

### 8.2 Container Registry (ACR)

**Pull Secret Creation:**

```yaml
# Chart-managed (default)
global:
  imagePullSecrets:
    - name: acr-secret
  manageImagePullSecrets: true
  secrets:
    acrUrl: "myacr.azurecr.io"
    acrUsername: "sp-client-id"
    acrPassword: "sp-secret"

# Helm creates Secret: acr-secret
apiVersion: v1
kind: Secret
metadata:
  name: acr-secret
type: kubernetes.io/dockercfg
data:
  .dockercfg: base64(...)
```

**Alternative: Managed Identity**

```bash
# On AKS node, pod authenticates via managed identity
# Requires: az aks update --attach-acr <acr-name>
# No Secret needed; pod kubelet handles auth
```

### 8.3 Storage Classes

**Default AKS StorageClass:**

```bash
kubectl get storageclass
# Output: managed-csi (default)
```

**Chart Assumption:**

```yaml
# Most charts expect managed-csi
persistence:
  storageClass: managed-csi
```

**Override per Product:**

```yaml
# In values or installation-config
infra:
  postgres:
    persistence:
      storageClass: managed-premium-rwo
  redis:
    persistence:
      storageClass: managed-csi
```

### 8.4 Namespace Management

**Creation Pattern:**

```python
# engine ensures namespace with tenant label
kube.ensure_namespace(namespace="sri-detection", 
                     tenant_id="t-qakalvin...")

# Creates if missing:
apiVersion: v1
kind: Namespace
metadata:
  name: sri-detection
  labels:
    app.kubernetes.io/tenant: "t-qakalvin..."
```

**Networking Policies:**

- Shared clusters: **Disabled** (default-deny + same-namespace breaks cross-namespace paths)
- Overlay clusters: Can enable if needed (with explicit allow rules)

### 8.5 TLS & Ingress

**Shared ingress-nginx (common-res):**

```yaml
# Multi-environment pattern:
# - One shared ingress-nginx per cluster
# - Each product creates Ingress under it
# - TLS Secret synced from 1Password (wildcard cert)

ingress:
  enabled: true
  className: nginx
  tls:
    - secretName: wildcard-symphonyai-dev-tls  # Pre-existing
      hosts:
        - detection.sri-dev-centraindia.symphonyai.dev
  rules:
    - host: detection.sri-dev-centraindia.symphonyai.dev
      http:
        paths:
          - path: /
            backend:
              service:
                name: detectionhub-api
                port:
                  number: 8080
```

**cert-manager NOT Available on SCP:**

```yaml
# SCP does not run ACME ClusterIssuers
# Reason: Customer-facing certificates require manual control

# DO NOT use this (would stay Pending):
cert:
  enabled: false
  certManager:
    enabled: false
    clusterIssuer: letsencrypt-production  # ❌ Does not exist on SCP

# DO use this (TLS Secret pre-created):
tls:
  enabled: true
  existingSecret: wildcard-symphonyai-dev-tls  # ✓ Pre-synced
```

---

## Part 9: Environment Classes & Gating

### 9.1 Environment Token Classification

```python
ENV_TOKEN_CLASS = {
    "dev": "dev",
    "develop": "dev",
    "development": "dev",
    "sandbox": "dev",
    "local": "dev",
    # ─────────────────
    "qa": "qa",
    "test": "qa",
    "testing": "qa",
    "staging": "qa",
    "stage": "qa",
    "uat": "qa",
    "preprod": "qa",
    "pre-prod": "qa",
    # ─────────────────
    "prod": "prod",
    "prd": "prod",
    "production": "prod",
    "live": "prod",
}
```

### 9.2 Gate Strictness Levels

```python
_STRICTNESS = {
    "dev": 0,       # Loose (no approval needed)
    "qa": 1,        # Moderate (approval recommended)
    "prod": 2,      # Strict (approval required)
    "unknown": 3,   # Strictest (refuse by default)
}
```

**Policy Per Environment Class:**

```
Dev Cluster:
  ├─ Provenance: Recorded, not enforced
  ├─ Approval: Not required
  └─ Speed: Fastest

QA Cluster:
  ├─ Provenance: Recorded, checked (dev/qa-only)
  ├─ Approval: Recommended but not required
  └─ Speed: Medium

Prod Cluster:
  ├─ Provenance: Recorded, verified (main-only + non-dirty)
  ├─ Approval: REQUIRED (second person, different identity)
  ├─ TTL: 24 hours (approval expires)
  └─ Speed: Slowest (gate enforcement)

Unknown (Unrecognized env token):
  ├─ Treated as prod (strictest)
  ├─ Approval: REQUIRED
  └─ Purpose: Fail-safe (unknown env → strict gating)
```

---

## Part 10: Audit & Compliance

### 10.1 Audit Trail Recording

**Engine emits structured audit records:**

```json
{
  "action": "install.provenance",
  "outcome": "recorded",
  "source": "provisioner",
  "detail": {
    "installationId": "i-abc123...",
    "tenant": "t-qakalvin...",
    "bundleVersion": "1.0.49",
    "charts": {
      "./charts/detection": {
        "source": "git",
        "commit": "a3f2b1e",
        "branch": "main",
        "mergedToMain": true,
        "dirty": false,
        "contentDigest": "sha256:abc123..."
      }
    }
  }
}
```

**Terminal Records (one per install):**

```json
{
  "action": "install.finish",
  "outcome": "succeeded",
  "reason": "18/18 pods Ready, all Jobs Complete",
  "detail": {
    "installationId": "i-abc123...",
    "duration": 1800,
    "stages": ["platform", "products"],
    "productsInstalled": ["sri-detection", "sri-investigation", "sri-data"]
  }
}
```

### 10.2 Subject Attribution

**Identity Sources (in priority order):**

1. **config.requestedBy** (explicit declaration)
   ```yaml
   requestedBy: kalvin@example.com
   ```

2. **env:SRI_ACTOR** (environment variable)
   ```bash
   export SRI_ACTOR="alice@example.com"
   ```

3. **os.user** (fallback - dev only)
   ```
   getpass.getuser() → "kalvin" (NOT verified)
   ```

**Subject Verification:**

- Declared subject: Not verified at gate
- Production approval: Requires verified second subject
- Source recorded: (config, env, os.user)

---

## Part 11: Key Differences: Umbrella vs. Multi-Namespace

### 11.1 Single-Namespace (Umbrella)

**File:** `provisioner/release-sri/products/umbrella/product.yaml`

```yaml
name: umbrella
type: platform
stage: 1
release: sri                      # One release
namespace: sri                    # One namespace

chart: charts/                    # Root chart
valuesFiles:
  - deploy/base/values.tmpl.yaml
  - deploy/template/values.yaml
  - deploy/template/secrets.gen.yaml

# Four domains as subcharts
# ├─ charts/common/
# ├─ charts/detection/
# ├─ charts/investigation/
# └─ charts/data/
```

**Advantages:**
- Single Helm release → single install/upgrade transaction
- Atomic: all-or-nothing
- One pull secret serves all subcharts
- No cross-namespace coordination needed

**Disadvantages:**
- Larger release state
- Slower rollout (sequential by chart)
- All domain updates tied together

### 11.2 Multi-Namespace

**Files:**
- `provisioner/release-sri/products/platform/product.yaml` (platform services)
- `provisioner/release-sri/products/detection/product.yaml` (detection domain)
- `provisioner/release-sri/products/investigation/product.yaml` (investigation domain)
- `provisioner/release-sri/products/data/product.yaml` (data domain)

**Advantages:**
- Smaller releases (faster rollouts)
- Domain independence (can update detection without touching investigation)
- Parallel product installation (Wave 1: all domains at once)
- Scaling: add/remove products without affecting others

**Disadvantages:**
- Operator coordination (platform must run first)
- Cross-namespace secrets/service discovery
- More complex upgrade orchestration

---

## Part 12: Troubleshooting & Operations

### 12.1 Installation Failure Recovery

**Re-run Same Command:**

```bash
# Same config, same release dir
python -m engine.cli install -c config.yaml -r release/

# Fast-forwards:
# ✓ Skips preflight (already passed)
# ✓ Skips completed products
# ✓ Resumes at failure point
```

### 12.2 Rollback Last Change

```bash
python -m engine.cli rollback -c config.yaml -r release/

# Reverses installation order:
# 1. Roll back data products
# 2. Roll back investigation products
# 3. Roll back detection products
# 4. Roll back platform (skips operators)
```

### 12.3 Uninstall Environment

```bash
python -m engine.cli uninstall -c config.yaml -r release/

# ⚠ Gated for production (requires approval)
# ✓ Operators retained (shared resource)
# ✓ PVCs retained (data safety)
```

### 12.4 Inspect Plan

```bash
python -m engine.cli plan -c config.yaml -r release/

# Output:
# bundle          1.0.49
# sku             sri-detection, sri-investigation, sri-data
# tenant          qakalvin (t-qakalvin...)
# secrets mode    provided
# 
# ── platform (sequential)
#   operators (release=sri-operators, namespace=sri-operators)
#   platform (release=sri-platform, namespace=sri-common)
#
# ── products wave 1 (parallel)
#   detection (release=sri-detection, namespace=sri-detection)
#   investigation (release=sri-investigation, namespace=sri-investigation)
#   data (release=sri-data, namespace=sri-data)
```

---

## Part 13: Summary of Deployment Files & Paths

### Configuration Files

| Path | Purpose |
|------|---------|
| `.github/workflows/provisioner-ci.yml` | GitHub Actions CI/CD trigger |
| `provisioner/release-sri/sku-catalog.yaml` | Available SKUs |
| `provisioner/release-sri/versions.yaml` | Pinned chart versions (BOM) |
| `provisioner/release-sri/installation.yaml` | Global pre/post steps |
| `provisioner/release-sri/products/*/product.yaml` | Per-product descriptors |
| `provisioner/release-sri/installation-config.sri-dev-centraindia.yaml` | Live environment config |
| `deploy/base/values.tmpl.yaml` | Template for generated values |
| `deploy/template/values.yaml` | Generated values (auto-produced) |
| `deploy/template/secrets.provided.yaml` | Required external secrets |
| `deploy/sri-dev-centraindia/values.yaml` | Environment-specific base |
| `deploy/sri-dev-centraindia/secrets.gen.yaml` | Generated credentials (gitignored) |

### Engine Entry Points

| Path | Role |
|------|------|
| `provisioner/app/api/main.py` | Provisioning API (thin service) |
| `provisioner/app/engine/cli.py` | CLI entry point |
| `provisioner/app/engine/installer.py` | Installation orchestration |
| `provisioner/app/engine/plan.py` | SKU → plan resolution |
| `provisioner/app/engine/steps.py` | Steps framework |
| `provisioner/app/engine/helm.py` | Helm CLI wrapper |
| `provisioner/app/engine/kube.py` | Kubernetes operations |

### Documentation

| Path | Content |
|------|---------|
| `provisioner/README.md` | Provisioning pipeline overview |
| `provisioner/EXTENDING.md` | How to add products |
| `deploy/multi-namespace.md` | One-release-per-domain layout |
| `deploy/sri-dev-centraindia/README.md` | Environment runbook |
| `docs/ARCHITECTURE.md` | High-level architecture |
| `design/PROVISIONING-PIPELINE.md` | Pipeline design decisions |

---

## Part 14: Recommended Practices

### 14.1 For Development

1. **Always test locally first**
   ```bash
   python -m engine.cli dry-run -c config.yaml -r release/ --server
   ```

2. **Validate configuration before installing**
   ```bash
   python -m engine.cli plan -c config.yaml -r release/
   ```

3. **Use dry-run with --server for render-time checks**
   ```bash
   # Catches operator preflight problems early
   python -m engine.cli dry-run -c config.yaml -r release/ --server
   ```

### 14.2 For Production

1. **Always require approval**
   - Include `approvedBy` in installation-config for prod clusters
   - Use separate approval file, never commit real approvals

2. **Validate provenance first**
   ```bash
   # Ensure all charts on main branch and non-dirty
   git log --oneline -1 charts/
   git status charts/
   ```

3. **Use full container digests**
   ```yaml
   image:
     repository: myacr.azurecr.io/product
     tag: v1.2.3
     pullPolicy: IfNotPresent
   ```

4. **Pin chart versions explicitly**
   ```yaml
   Chart.yaml:
     dependencies:
       - name: subchart
         version: 1.2.3  # EXACT version, no ~1.2 ranges
   ```

### 14.3 For Troubleshooting

1. **Save full report on failure**
   ```bash
   python -m engine.cli install -c config.yaml -r release/ \
     --report failed-install.json
   ```

2. **Check audit trail**
   ```bash
   kubectl logs -n sri-system -l app=provisioner
   ```

3. **Inspect helm releases**
   ```bash
   helm list -A
   helm get values <release> -n <namespace>
   helm history <release> -n <namespace>
   ```

---

## Conclusion

The SRI deployment system represents a **production-grade, multi-environment provisioning platform** that prioritizes:

1. **Safety** - Multi-stage validation, approval gates, provenance tracking
2. **Reproducibility** - Pinned versions, idempotent operations, recorded decisions
3. **Auditability** - Complete trail of who deployed what when
4. **Scalability** - Parallel deployment, independent SKU selection, component toggles

All deployment logic is **externalized to Helm** (no imperative scripts), orchestrated by a **stateless provisioning engine** that can run as CLI, in-cluster Job, or API service.

The system supports **two deployment topologies** (single-namespace umbrella vs. multi-namespace per-domain), **multiple environments** (dev/qa/prod), and **flexible configuration management** (templated values, generated secrets, user-supplied materials).

**Entry point for deployment:** Install the provisioner image, create installation-config, run engine CLI or API, and the system handles the rest idempotently.
