# GitHub Actions Deployment Workflows

This document explains the purpose and use cases for each GitHub Actions workflow in the CloudHub platform repository. The workflows handle testing, building, and deploying both frontend and backend services to Azure App Service.

## Overview

The platform uses **6 main workflows** organized into three categories:

1. **Quality & Testing** - Automated code quality checks
2. **Build & Push** - Container image building and registry operations
3. **Deployment** - Application deployment to Azure App Service

---

## 1. Quality Gates Workflow

**File:** `.github/workflows/ci-quality-gate.yml`

### Purpose

Automatically validates code quality and runs tests on every push to `main` and on all pull requests.

### Trigger Events

- **Automatic** on push to `main`
- **Automatic** on pull requests to `main`

### What It Does

- Runs ESLint on all workspaces
- Performs TypeScript type checking across entire codebase
- Executes all unit/integration tests with coverage reporting
- Runs platform validation tests

### When to Use

- This workflow runs **automatically** — no manual action required
- Essential gate before code merges
- Provides confidence that quality standards are maintained

### Status

✅ **Automatic** — Part of CI/CD pipeline, required for PR/merge validation

---

## 2. Build & Push Images Workflow (Primary)

**File:** `.github/workflows/build-and-push-images.yml`

### Purpose

Manually triggered workflow to build and push Docker images for frontend and/or backend to Azure Container Registry (ACR).

### Trigger Events

- **Manual** (`workflow_dispatch`) from GitHub Actions UI

### Input Parameters

| Parameter      | Required | Default | Description                                                 |
| -------------- | -------- | ------- | ----------------------------------------------------------- |
| `component`    | Yes      | `both`  | Which service(s) to build: `frontend`, `backend`, or `both` |
| `image_tag`    | Yes      | —       | Shared tag for both images (e.g., `1.0.0`, `v1.2.3`)        |
| `frontend_tag` | No       | Empty   | Frontend-specific tag (overrides `image_tag`)               |
| `backend_tag`  | No       | Empty   | Backend-specific tag (overrides `image_tag`)                |
| `push_latest`  | Yes      | `false` | Also push `latest` tag in addition to version tag           |

### What It Does

1. Validates that code is on latest `main` branch commit
2. Authenticates to Azure and ACR
3. Builds Docker images using Dockerfile.frontend and Dockerfile.backend
4. Pushes images to ACR with specified tags
5. Verifies tags exist in registry

### When to Use

- **Regular builds:** After code review and merge to `main`
- **Testing:** Build specific component for testing
- **Staging:** Build components for staging environment
- **Production prep:** Build production-ready images before release

### Example Usage

```bash
# Build both frontend and backend with tag 1.5.0
# Components: frontend, backend, both
# Image tag: 1.5.0
# Frontend tag: (leave empty for default)
# Backend tag: (leave empty for default)
# Push latest: true
```

### Status

⚠️ **Manual** — Requires explicit trigger from GitHub UI

### Constraints

- ✅ Must be triggered from latest `main` branch
- ✅ Enforces main-only builds (no feature branches)

---

## 3. Build & Push Images Workflow (Alternative - BASIC)

**File:** `.github/workflows/build-and-push-images-basic.yml`

### Purpose

Alternative build workflow optimized for **BASIC** direct deployment pattern.

### Trigger Events

- **Manual** (`workflow_dispatch`) from GitHub Actions UI

### Input Parameters

| Parameter          | Required | Default | Description                                        |
| ------------------ | -------- | ------- | -------------------------------------------------- |
| `image_tag`        | Yes      | —       | Container image tag (e.g., `1.0.0`)                |
| `component`        | Yes      | `both`  | Which service(s): `frontend`, `backend`, or `both` |
| `push_latest`      | Yes      | `false` | Also push `latest` tag                             |
| `run_quality_gate` | Yes      | `true`  | Run lint, typecheck, and tests before build        |

### What It Does

1. **Optionally** runs quality gates (lint, typecheck, tests)
2. Validates image tag is provided
3. Builds and pushes Docker images to ACR
4. Supports selective frontend or backend builds

### Differences from Primary Build Workflow

- Includes optional quality gate execution
- May use different ACR registry settings
- Explicitly designed for BASIC deployment pattern

### When to Use

- When deploying using BASIC pattern
- When you want to optionally re-run tests before building
- As an alternative to the primary build workflow with additional control

### Status

⚠️ **Manual** — Requires explicit trigger from GitHub UI

---

## 4. Deploy Backend to App Service (With Slots)

**File:** `.github/workflows/deploy-appservice-backend.yml`

### Purpose

Production-grade backend deployment with support for deployment slots, blue-green deployments, and safe slot swapping.

### Trigger Events

- **Manual** (`workflow_dispatch`) from GitHub Actions UI

### Input Parameters

| Parameter                | Required | Default                                                                              | Description                                        |
| ------------------------ | -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `image_tag`              | Yes      | —                                                                                    | Image tag to deploy (must exist in ACR)            |
| `slot_name`              | No       | Empty                                                                                | Deployment slot name (empty = production slot)     |
| `swap_with_production`   | Yes      | `false`                                                                              | Swap deployment slot with production after success |
| `configure_app_settings` | Yes      | `true`                                                                               | Apply production settings (PostgreSQL, Entra auth) |
| `startup_command`        | Yes      | `node packages/backend --config app-config.yaml --config app-config.production.yaml` | Backend startup command                            |

### What It Does

1. Validates image tag exists in ACR
2. Authenticates to Azure using OIDC (or SPN client secret fallback)
3. Captures current running image before deployment
4. Updates App Service with new container image
5. Optionally applies production app settings
6. Performs post-deployment health check
7. **Optionally** swaps deployment slot with production

### Deployment Strategies

- **Direct Production:** Leave `slot_name` empty, `swap_with_production=false`
- **Slot-based Blue-Green:** Specify `slot_name`, then later swap to production
- **Testing First:** Deploy to slot, test, then swap

### When to Use

- **Production deployments** with zero-downtime requirements
- **Blue-green deployments** using Azure deployment slots
- **Backend-only** updates
- When you need safe rollback capability

### Azure App Service Configuration

**Resource Group:** `rg-cfe-apps-mj`
**Backend App Service:** `cloudhub-backend`

### Status

⚠️ **Manual** — Requires explicit trigger from GitHub UI

### Authentication

- **Preferred:** OIDC (OpenID Connect) via federated credentials
- **Fallback:** Service Principal client secret

---

## 5. Deploy Backend to App Service (BASIC)

**File:** `.github/workflows/deploy-appservice-backend-basic.yml`

### Purpose

Simplified backend deployment workflow optimized for **BASIC** direct deployment pattern.

### Trigger Events

- **Manual** (`workflow_dispatch`) from GitHub Actions UI

### Input Parameters

| Parameter                    | Required | Default                     | Description                   |
| ---------------------------- | -------- | --------------------------- | ----------------------------- |
| `image_tag`                  | Yes      | —                           | Container image tag to deploy |
| `app_service_resource_group` | No       | `rg-cfe-apps-mj`            | App Service resource group    |
| `app_service_name`           | No       | `cloudhub-backend-20260728` | App Service name              |
| `health_path`                | No       | `/`                         | Health check endpoint path    |

### What It Does

1. Validates all required inputs
2. Resolves target image from registry
3. Authenticates to Azure (SPN)
4. Validates image tag exists in ACR
5. Captures current running image
6. Updates App Service container image
7. Performs post-deployment health check

### When to Use

- **BASIC pattern deployments**
- **Direct production deployments** (no slots)
- **Simpler deployment** without blue-green strategies
- **Specific app service targeting** (non-standard names)

### Key Differences from Slot-based Workflow

- ❌ No deployment slots support
- ❌ No blue-green deployment capability
- ✅ Simpler configuration
- ✅ Direct production deployment

### Status

⚠️ **Manual** — Requires explicit trigger from GitHub UI

### Azure App Service Configuration

**Resource Group:** `rg-cfe-apps-mj`
**Backend App Service:** `cloudhub-backend-20260728` (configurable)

---

## 6. Deploy to CFE App Service Plan Workflow

**File:** `.github/workflows/deploy-to-cfe-app-svc.yml`

### Purpose

Simplified end-to-end release with **direct deployment** (no slots). Builds both frontend and backend, pushes to ACR, and deploys both directly to production App Services using **BASIC pattern**.

### Trigger Events

- **Manual** (`workflow_dispatch`) from GitHub Actions UI

### Input Parameters

| Parameter                 | Required | Default                                                                              | Description                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `image_tag`               | Yes      | —                                                                                    | Shared image tag (e.g., `1.0.0`)                 |
| `frontend_tag`            | No       | Empty                                                                                | Frontend-specific tag (overrides `image_tag`)    |
| `backend_tag`             | No       | Empty                                                                                | Backend-specific tag (overrides `image_tag`)     |
| `push_latest`             | Yes      | `false`                                                                              | Also push `latest` tag to ACR                    |
| `run_quality_gates`       | Yes      | `true`                                                                               | Run lint, typecheck, and tests before deployment |
| `backend_startup_command` | Yes      | `node packages/backend --config app-config.yaml --config app-config.production.yaml` | Backend startup command                          |

### What It Does

#### Job 1: Quality Gates (Optional)

- ✅ Only runs if `run_quality_gates=true`
- Runs linting, type checking, and tests
- Can be skipped for faster deployments

#### Job 2: Build and Push

- Validates code is on latest `main` branch
- Builds backend and frontend Docker images
- Pushes images to `symphonyfs` registry
- Verifies tags exist in ACR

#### Job 3 & 4: Deploy (Parallel)

- **Backend:** Direct deployment (no slots) to `cloudhub-backend`
- **Frontend:** Direct deployment (no slots) to `cloudhub-frontend`
- Sets `BACKEND_ORIGIN` for nginx proxy configuration
- Performs post-deployment health checks
- ⚠️ **Brief downtime during deployment** (typically 30-60 seconds)

### Deployment Characteristics

- ❌ **No deployment slots** — Direct production update
- ❌ **No blue-green deployment** — Cannot test before cutting over
- ✅ **Simpler configuration** — Fewer parameters
- ✅ **Faster deployment** — No slot operations
- ✅ **BASIC pattern** — Uses `symphonyfs` registry
- ⚠️ **Brief downtime** — Application restarts during update

### When to Use

- **Quick iterations** — Faster than slot-based deployments
- **Non-critical environments** — Acceptable downtime
- **Testing/staging** — Before using advanced pattern
- **BASIC pattern requirement** — Specific infrastructure setup

### Status

⚠️ **Manual** — Requires explicit trigger from GitHub UI

### Pre-requisites

- Code merged to `main` branch
- Images built and pushed to ACR (or `run_quality_gates=true`)
- Azure credentials configured in secrets

---

## 7. Release to Production Workflow - ADVANCED (Production Grade with Slots)

**File:** `.github/workflows/release-production.yml`

### Purpose

Enterprise-grade end-to-end production release orchestration with **zero-downtime deployment**. Runs quality gates, builds both frontend and backend, pushes to ACR, and deploys to production App Services using **Azure Deployment Slots** for safe blue-green deployments.

### Trigger Events

- **Manual** (`workflow_dispatch`) from GitHub Actions UI

### Input Parameters

| Parameter                        | Required | Default                                                                              | Description                                                |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `image_tag`                      | Yes      | —                                                                                    | Shared image tag (e.g., `1.0.0`)                           |
| `frontend_tag`                   | No       | Empty                                                                                | Frontend-specific tag (overrides `image_tag`)              |
| `backend_tag`                    | No       | Empty                                                                                | Backend-specific tag (overrides `image_tag`)               |
| `push_latest`                    | Yes      | `false`                                                                              | Also push `latest` tag to ACR                              |
| `backend_health_url`             | No       | CloudHub readiness endpoint                                                          | Backend health check URL                                   |
| `backend_startup_command`        | Yes      | `node packages/backend --config app-config.yaml --config app-config.production.yaml` | Backend startup command                                    |
| `configure_backend_app_settings` | Yes      | `true`                                                                               | Apply production PostgreSQL and Entra auth settings        |
| `strict_postgres_preflight`      | Yes      | `false`                                                                              | Fail release if GitHub runner cannot connect to PostgreSQL |

### What It Does

#### Job 1: Quality Gates

- ✅ **Always runs** before any build or deployment
- Runs linting on all workspaces
- Performs TypeScript type checking
- Executes all unit/integration tests
- Runs platform validation tests
- ⚠️ **Release fails if tests fail**

#### Job 2: Build and Push

- Validates code is on latest `main` branch
- Validates release inputs
- Authenticates to Azure and ACR
- Builds backend and frontend Docker images
- Pushes images to `symphonyfs` registry
- Verifies tags exist in ACR registry

#### Job 3: Deploy Backend

- **Preflight checks:**
  - Validates PostgreSQL credentials if `configure_backend_app_settings=true`
  - Tests PostgreSQL connectivity (with user format variations for Azure)
  - Validates Entra ID configuration
- **Deployment:**
  - Deploys backend to `cloudhub-backend` App Service with slots
  - Applies production app settings (PostgreSQL, Entra auth)
  - Performs post-deployment health checks
- **Rollback:**
  - Can swap back to previous version via deployment slot

#### Job 4: Deploy Frontend

- Deploys frontend to `cloudhub-frontend` App Service with slots
- Configures `BACKEND_ORIGIN` for nginx proxy
- Performs post-deployment health checks

### When to Use

- **Production releases** — Zero-downtime requirement
- **Version releases** — Formal tagged releases (e.g., `v2.1.0`)
- **Coordinated deployments** — Deploy frontend and backend together
- **High confidence deployments** — Quality gates ensure code quality
- **Complex infrastructure** — PostgreSQL + Entra ID setup required

### Deployment Scope

| Component    | App Service         | Resource Group   | Strategy           |
| ------------ | ------------------- | ---------------- | ------------------ |
| **Frontend** | `cloudhub-frontend` | `rg-cfe-apps-mj` | Slots (Blue-Green) |
| **Backend**  | `cloudhub-backend`  | `rg-cfe-apps-mj` | Slots (Blue-Green) |

### When Deployments Fail

- ✅ **Quality gates fail** — No images built, no deployments attempted
- ✅ **Build fails** — No deployments attempted
- ✅ **Deployment fails** — Slot remains clean, swap not performed
- ✅ **PostgreSQL connection fails** (if strict mode on) — Release halted
- ✅ **Health check fails** — Detailed logs, manual investigation

### Status

⚠️ **Manual** — Requires explicit trigger from GitHub UI

### Pre-requisites

- Code merged to `main` branch
- All tests passing locally
- Images will be built as part of workflow
- Azure credentials configured in secrets
- PostgreSQL connection details configured (for optional strict mode)
- Entra ID configuration configured (for optional Entra auth)

---

## Deployment Pipeline Architecture

### Option A: Deploy to CFE App Service (Direct Deployment)

```
Code on main → Manual trigger
        ↓
Quality Gates (Optional) [run_quality_gates=true/false]
        ↓
Build & Push (frontend + backend → symphonyfs)
        ↓
Deploy Backend (Direct, no slots) ──┐ Parallel
                                    ├──> Parallel
Deploy Frontend (Direct, no slots) ──┘
        ↓
Health Checks
        ↓
✅ Production (Brief downtime: 30-60s)
```

**Characteristics:**

- ⚡ Faster (parallel deployments)
- 📉 Simpler (fewer settings)
- ⚠️ Brief downtime
- 🚫 No rollback slots

### Option B: ADVANCED Release (Production Grade - Blue-Green with Slots)

```
Code on main → Manual trigger
        ↓
Quality Gates (Always runs)
        ↓
Build & Push (frontend + backend → symphonyfs)
        ↓
Preflight Checks (PostgreSQL, Entra ID)
        ↓
Deploy Backend to Slot ──┐
                         ├─→ Sequential
Deploy Frontend to Slot ┘
        ↓
Health Checks
        ↓
Swap Slots (zero-downtime cutover)
        ↓
✅ Production (NO downtime, full rollback capability)
```

**Characteristics:**

- 🔒 Enterprise-grade
- ⏸️ Zero-downtime
- ♻️ Full rollback capability
- 🔍 Extensive validation
- ⏱️ Longer deployment time

### Other Workflows (Modular)

```
CI/CD (Automatic on push/PR) → Quality Gates
                    ↓
Build & Push Images (Manual) → Separate for frontend/backend
                    ↓
Deploy Backend (Manual) → With or without slots
                    ↓
✅ Production
```

---

## Quick Reference: Which Workflow to Use?

### 🚀 Deploy to CFE App Service (Direct Deployment)

**File:** `.github/workflows/deploy-to-cfe-app-svc.yml`

- ✅ Deploy both frontend AND backend in one workflow
- ✅ Optional quality gates
- ✅ Direct deployment (BASIC pattern)
- ⚠️ Brief downtime (30-60 seconds)
- 📍 **Use when:** Quick iterations, non-critical environment, testing

### 🏢 ADVANCED Release (Enterprise, zero-downtime)

**File:** `.github/workflows/release-production.yml`

- ✅ Deploy both frontend AND backend in one workflow
- ✅ Mandatory quality gates
- ✅ Blue-green deployment with slots
- ✅ Zero-downtime, full rollback capability
- ⏱️ Longer deployment time
- 📍 **Use when:** Production release, zero-downtime required, high availability

---

## Quick Reference: Which Workflow to Use (Modular)?

### ❓ I need to deploy to CFE App Service Plan

→ **Use: Deploy to CFE App Service** (`.github/workflows/deploy-to-cfe-app-svc.yml`)

- Fastest end-to-end deployment
- Both frontend and backend
- Sets quality gates to optional for speed

### ❓ I need to deploy to production (SAFE)

→ **Use: ADVANCED Release** (`.github/workflows/release-production.yml`)

- Enterprise-grade with zero-downtime
- Both frontend and backend
- Full validation and rollback capability

### ❓ I just need to build images

→ **Use: Build & Push Images** (`.github/workflows/build-and-push-images.yml`)

- Builds frontend, backend, or both
- Pushes to ACR registry
- Modular (separate from deployment)

### ❓ I need safe blue-green backend deployment (standalone)

→ **Use: Deploy Backend with Slots** (`.github/workflows/deploy-appservice-backend.yml`)

- Supports deployment slots
- Zero-downtime deployments
- Safe rollback capability
- Backend only (modular)

### ❓ I need quick backend deployment (standalone, no slots)

→ **Use: Deploy Backend Direct** (`.github/workflows/deploy-to-appservice.yml`)

- Simple, direct deployment
- No slot management
- Brief downtime
- Backend only (modular)

### ❓ I'm working on a feature branch

→ **Use: None of these** (or use locally)

- These workflows enforce `main` branch only
- Use local development with `yarn` commands

### ❓ I want to check code quality

→ **Automatic** (Quality Gates run automatically on every push/PR)

- No action needed — runs automatically

---

## Azure App Service Architecture

### Frontend Service

- **Name:** `cloudhub-frontend`
- **Resource Group:** `rg-cfe-apps-mj`
- **Deployed by:** `release-production.yml`, build workflow + separate deployment
- **Container Image:** `cloudhub-platform/frontend:latest`

### Backend Service

- **Name:** `cloudhub-backend`
- **Resource Group:** `rg-cfe-apps-mj`
- **Deployed by:** `release-production.yml`, `deploy-appservice-backend.yml`, or `deploy-to-appservice.yml`
- **Container Image:** `cloudhub-platform/backend:latest`

### Registry

- **ACR Name:** `symphonyfs`
- **Registry URL:** Configurable via repository variables

---

## Common Workflows

### Scenario 1: Daily Development Workflow

1. Make code changes on feature branch
2. Create PR → Quality Gates run automatically ✅
3. Merge to `main` → Quality Gates run again ✅
4. Manually trigger **Build & Push Images** to create tagged images
5. Manually trigger **Deploy Backend** to staging/production

### Scenario 2: Production Release

1. Prepare release notes and version number (e.g., `v2.1.0`)
2. Trigger **Release to Production** with `image_tag=v2.1.0`
3. Workflow orchestrates:
   - ✅ Quality gates
   - ✅ Build both frontend and backend
   - ✅ Push to ACR
   - ✅ Deploy both services
   - ✅ Health checks
4. Monitor post-deployment status

### Scenario 3: Backend-Only Hotfix

1. Create hotfix on `main`
2. Merge to main → Quality Gates pass ✅
3. Trigger **Build & Push Images** with `component=backend`, `image_tag=v2.1.1-hotfix`
4. Trigger **Deploy Backend with Slots** with same tag
5. Test in slot, then swap to production

### Scenario 4: Blue-Green Deployment

1. Build images with new version
2. Deploy backend to staging slot: `slot_name=staging`
3. Run smoke tests against staging slot
4. Trigger swap: `swap_with_production=true, slot_name=staging`
5. Zero-downtime cutover complete

---

## Troubleshooting

### Build fails with "not at latest main HEAD"

- **Cause:** Workflow was triggered from an older commit
- **Fix:** Re-run workflow from the latest commit on `main`

### Deployment fails with "image tag not found"

- **Cause:** Image doesn't exist in ACR registry
- **Fix:** First trigger **Build & Push Images**, wait for completion, then deploy

### PostgreSQL connection fails

- **Cause:** Strict preflight check enabled, DB unavailable
- **Fix:** Either fix PostgreSQL connectivity or set `strict_postgres_preflight=false`

### Health check fails after deployment

- **Cause:** Application not ready yet, or wrong health endpoint
- **Fix:** Verify app settings, check logs in Azure Portal, increase health check timeout

---

## Security Notes

- ✅ All workflows require Azure authentication (SPN or OIDC)
- ✅ Workflows enforce `main` branch only (prevents unauthorized deployments)
- ✅ Deployment requires repository secrets configuration
- ✅ Quality gates run before production deployments
- ✅ Blue-green deployments reduce blast radius of bad deployments

---

## Release Pipeline Comparison Matrix

| Feature                  | BASIC (Direct)                  | ADVANCED (Slots)                | Modular (Separate) |
| ------------------------ | ------------------------------- | ------------------------------- | ------------------ |
| **File**                 | `deploy-to-cfe-app-svc.yml`     | `release-production.yml`        | Multiple files     |
| **Deployment**           | Both (frontend + backend)       | Both (frontend + backend)       | Modular choice     |
| **Quality Gates**        | Optional                        | Mandatory                       | Separate           |
| **Build & Deploy**       | Orchestrated                    | Orchestrated                    | Separate workflows |
| **Deployment Strategy**  | Direct (BASIC)                  | Blue-Green (Slots)              | Configurable       |
| **ACR Registry**         | `symphonyfs`                    | `symphonyfs`                    | Configurable       |
| **Downtime**             | 30-60 seconds                   | Zero (slot swap)                | Depends on choice  |
| **Rollback**             | Manual redeploy                 | Instant (swap back)             | Manual redeploy    |
| **PostgreSQL Preflight** | ❌ No                           | ✅ Yes                          | ❌ No              |
| **Entra ID Validation**  | ❌ No                           | ✅ Yes                          | ❌ No              |
| **Complexity**           | ⭐ Low                          | ⭐⭐⭐ High                     | ⭐⭐ Medium        |
| **Deployment Speed**     | ⚡ Fast                         | ⏱️ Slower                       | ⚡ Fast            |
| **Best For**             | Quick iterations                | Production (HA)                 | Advanced users     |

---

## Decision Tree: Which Pipeline to Use?

```
START: Need to deploy both frontend and backend?
│
├─ YES, and I want the FASTEST deployment
│  └─→ Use deploy-to-cfe-app-svc.yml (deploy-to-cfe-app-svc.yml)
│      ✅ Simple, fast, direct deployment
│      ⚠️ Brief downtime acceptable
│
├─ YES, and I need ZERO-DOWNTIME (production)
│  └─→ Use ADVANCED Release (release-production.yml)
│      ✅ Enterprise-grade, full validation
│      ✅ Blue-green with slots
│      ⏱️ Longer deployment time OK
│
├─ NO, I need BACKEND ONLY (modular)
│  │
│  ├─ And I want ZERO-DOWNTIME
│  │  └─→ Use deploy-appservice-backend.yml (with slots)
│  │
│  └─ And QUICK DEPLOYMENT is OK
│     └─→ Use deploy-to-appservice.yml (direct)
│
├─ NO, I need FRONTEND ONLY
│  └─→ Build images, then deploy manually (release workflow doesn't separate frontend)
│
└─ I need MORE CONTROL (modular approach)
   └─→ Use build-and-push-images.yml + separate deploy workflow
```

---

## Environment Variables & Secrets

All workflows require these GitHub Secrets:

- `AZURE_CLIENT_ID` - Service Principal client ID
- `AZURE_TENANT_ID` - Azure tenant ID
- `AZURE_SUBSCRIPTION_ID` - Azure subscription ID
- `AZURE_CLIENT_SECRET` - (Optional) Service Principal secret (uses OIDC if not set)
- `AZURE_ACR_USERNAME` - ACR username
- `AZURE_ACR_PASSWORD` - ACR password

Optional Repository Variables:

- `ACR_LOGIN_SERVER` - ACR login server URL (defaults to `symphonyfs.azurecr.io`)
- `ACR_NAME` - ACR registry name (defaults to `symphonyfs`)
