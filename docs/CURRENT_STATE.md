# CloudHub App Service Release Current State

## Deployment

- Build workflows publish existing images to Azure Container Registry `symphonyfs.azurecr.io`.
- Frontend image: `symphonyfs.azurecr.io/cloudhub-platform/frontend:<version>`.
- Backend image: `symphonyfs.azurecr.io/cloudhub-platform/backend:<version>`.
- Resource group: `rg-cfe-apps-mj`.
- App Services: `cloudhub-frontend` and `cloudhub-backend`.
- Current deployment workflow: `.github/workflows/deploy-fe-be-prod-basic.yml`.

## Existing Flow

The BASIC deployment workflow validates an existing ACR tag, configures an App Service container, restarts the target app, and performs health/auth checks. It targets the production slot directly. A failed deployment can restore the captured image, but recovery requires another image configuration operation.

## Authentication

The workflows log in with `az login --service-principal` using only `AZURE_*` secrets, validated against CloudHub's platform client and tenant. Microsoft user sign-in uses separate `AUTH_MICROSOFT_*` secrets. GitHub Environments should protect the `production` environment with required reviewers.

## Configuration

Backend settings include PostgreSQL, Microsoft Entra authentication, `APP_BASE_URL`, `BACKEND_BASE_URL`, and runtime integration settings. Frontend uses `BACKEND_ORIGIN` for its nginx upstream. Sensitive values must remain GitHub Secrets and should be marked slot settings where the staging and production values differ.

## Gap

There is no staging-first promotion path in the current BASIC workflow. The new workflows add staging-slot deployment, smoke validation, approval-gated slot swap, and rollback.
