# platform_cloudhub

CloudHub platform repository for Backstage, platform services, and deployment workflows.

## Local Platform Commands

- Hot-reload development mode (no image rebuild for code edits): `./scripts/dev.sh`
- Rebuild from local source and start all containers: `./scripts/rebuild.sh`
- Restart all containers without rebuilding images: `./scripts/restart.sh`

## SRI Pipeline Integration (GitHub Actions)

The SRI Deploy page now triggers GitHub Actions workflows through
`deployment-control-plane` backend APIs and streams run logs in the UI.

Set these environment variables for live mode:

- `SRI_PIPELINE_REPO` (format: `owner/repo`, for example `org/pipeline-clients`)
- `GITHUB_ACTIONS_TOKEN` (or `GITHUB_TOKEN`)
- `SRI_PIPELINE_REF` (optional, default `main`)

The SRI deployment catalog is shared between the portal and control-plane code in
`plugins/platform-common/src/sriDeploymentCatalog.ts`. Every component points to
the same GitHub Actions workflow, and it is the supported application deployment
pipeline for the platform:

- `deploy-helmfile.yml` in `SYMPHONYFS_SCRIPTS_REPOSITORY`

A component can only be marked deployable (`deployment.supported`) when its
`application` value is one of the `appName` choices actually accepted by that
workflow's `workflow_dispatch` input. This whitelist lives in
`SYMPHONYFS_SCRIPTS_SUPPORTED_APPS` (`sriDeploymentCatalog.ts`) and is
re-checked defensively in `ControlPlaneService.deploySriPipeline` before any
dispatch is issued:

- `ai-store`, `datadog`, `common-res`, `dxv`, `detectionhub`, `edb-common-res`,
  `flows`, `invhub`, `netreveal`, `netrevealv95`, `netrevealv96`,
  `edb-netrevealv96`, `mtls-outbound`, `sales-genie`, `sensaai-sanctions`,
  `tailscale`, `velero`, `istio-service-entry`, `hybrid-manager`

Only the GitHub application name changes per component, for example:

- `netreveal-v96` -> `netrevealv96`
- `sri-investigation` -> `invhub`
- `sri-detection` -> `detectionhub`
- `sri-data` -> `flows`
- `sri-agents` -> `sales-genie`

The SRI deploy API sends workflow_dispatch inputs aligned to the active deployment
workflow:

- `app_name`
- `instance_name`

SRI deployment UX now requires user-provided:

- `subscription_id`
- `resource_group`

The portal uses these inputs to list AKS clusters in that resource group before
allowing pipeline trigger.

Authorization gate for triggering pipeline:

- User must be in Entra group `nonprd-cicd-pipeline-trigger-allow`
- Backstage group ref format accepted: `group:default/nonprd-cicd-pipeline-trigger-allow`

If repository or token is missing, the integration runs in simulated mode for local development.

Legacy GitHub deploy flags such as `GITHUB_DIRECT_DEPLOY` are no longer used by the current workflow set; deployments are image-tag driven.

## CI/CD Workflows

CloudHub ships five GitHub Actions workflows for the app itself:

| # | Workflow | Purpose |
| - | -------- | ------- |
| 1 | `.github/workflows/ci-quality-gate.yml` | Lint, typecheck and tests on every push/PR to `main`. |
| 2 | `.github/workflows/build-fe-be-prod-basic.yml` | Build and push frontend + backend images to ACR. No deployment. |
| 3 | `.github/workflows/deploy-component-prod.yml` | Deploy **one** App Service (frontend *or* backend) at an existing tag. |
| 4 | `.github/workflows/deploy-fe-be-prod-basic.yml` | Deploy **both** App Services at an existing tag. |
| 5 | `.github/workflows/release-production.yml` | End-to-end: quality gates -> build/push -> deploy both. |

Workflows 3 and 5 are thin entry points: both reuse workflow 4 (deploy) and
workflow 2 (build), so there is exactly one implementation of each step.

`.github/workflows/deploy-aks-namespace.yml` (AKS target) and
`.github/workflows/dev-workspace-images.yml` (dev-container images) are separate
and unchanged.

### Image naming

Both images are published to `symphonyfs.azurecr.io`:

- Frontend: `symphonyfs.azurecr.io/cloudhub-platform/frontend:<tag>`
- Backend: `symphonyfs.azurecr.io/cloudhub-platform/backend:<tag>`

Workflow 2 resolves `<tag>` either from an explicit `image_tag` input
(`versioning_mode: manual`) or by auto-incrementing the highest `0.1.x` tag
already in ACR (`versioning_mode: auto_beta_semver`). Workflow 5 computes the
tag from `version_prefix` + `release_channel`, so run `142` of channel `beta`
with prefix `0.9.0` produces `0.9.0-beta.142`.

### Frontend build arguments (do not remove)

`docker/Dockerfile.frontend` bakes `APP_BASE_URL` and `BACKEND_BASE_URL` into the
static bundle at build time, and defaults both to `http://localhost:3000`.
Workflow 2 always passes them, and deliberately sets
`BACKEND_BASE_URL = APP_BASE_URL`: nginx proxies `/api/` to the backend, so the
bundle must call the backend through its **own** origin. Baking the backend's
public hostname instead splits the Microsoft OAuth popup across two origins, the
`microsoft-nonce` cookie is never returned to the callback, and sign-in silently
never completes.

App Service Easy Auth must stay **disabled** on both web apps for the same
reason: CloudHub authenticates at the Backstage layer, not at the App Service
edge.

### Deployed version is the image, not an app setting

`/__cloudhub_version` (rendered by nginx and shown in the header badge) reads
`CLOUDHUB_VERSION`, which is **baked into the frontend image at build time** from
the tag being built. Do **not** create a `CLOUDHUB_VERSION` app setting: a
runtime env var wins over the baked value at envsubst time, so the UI would keep
reporting the old version after any deploy that skips the workflow. The deploy
workflow deletes that setting if it finds one, and then asserts both
`linuxFxVersion == the intended image` and `/__cloudhub_version == the deployed
tag` before finishing.

An image that reports `dev` was built before version baking existed; rebuild it.

> Only `cloudhub-platform/frontend` and `cloudhub-platform/backend` are valid
> deploy targets. The older `cloudhub-frontend` / `cloudhub-backend` repositories
> hold `0.9.0-beta.*` tags from a retired pipeline whose frontend images are
> baked to `http://localhost:3000`; deploying one breaks the app.

### Workflow outputs

Workflow 2 publishes outputs consumed by the deploy workflows:

- `image_version`
- `frontend_tag` / `backend_tag`
- `frontend_image` / `backend_image`

Workflows 3, 4 and 5 accept `image_version`, `frontend_image` and `backend_image`
directly, so no tag reconstruction is needed. `deploy-fe-be-prod-basic.yml` also
takes `deploy_component` (`both` | `frontend` | `backend`) to skip the App
Service that is not being changed.

### Required GitHub Secrets

The build and deploy workflows authenticate to Azure with the CloudHub platform
service principal (`az login --service-principal`) using only `AZURE_*`:

- `AZURE_CLIENT_ID` — must be `73b2043b-6230-480a-8a9a-fd37f68af1b2`
- `AZURE_CLIENT_SECRET` — platform service principal secret
- `AZURE_TENANT_ID` — must be `d0fec9dd-9219-4514-a1d8-1a872244bf6e`
- `AZURE_SUBSCRIPTION_ID` — target subscription

Interactive Microsoft login uses separate `AUTH_MICROSOFT_*` secrets; do not
reuse these user-login credentials for Azure platform SDKs.

Azure prerequisites:

- The service principal must have `AcrPush` on the `symphonyfs` registry and
  Contributor on the `rg-cfe-apps-mj` resource group.

### Future Version Policy and Migration Path

`release-production.yml` supports release channels:

- `beta`: `0.9.0-beta.<run_number>`
- `rc`: `0.9.0-rc.<run_number>`
- `ga`: `0.9.0`

Planned progression:

1. Beta phase: `0.9.0-beta.x`
2. Release candidate phase: `0.9.0-rc.x`
3. GA release: `1.0.0`
4. Patch releases: `1.0.1`, `1.0.2`, ...
5. Minor releases: `1.1.0`, `1.2.0`, ...
6. Major releases: `2.0.0`, ...

## App Service Production Runtime (Azure PostgreSQL)

For production App Service deployments, use Azure Database for PostgreSQL and the
production Backstage config (`app-config.production.yaml`).

Required App Service environment variables:

- `APP_BASE_URL` (for example `https://cloudhub.example.com`)
- `BACKEND_BASE_URL` (optional; defaults to `APP_BASE_URL`)
- `POSTGRES_HOST` (Azure PostgreSQL server FQDN)
- `POSTGRES_PORT` (typically `5432`)
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `AUTH_MICROSOFT_CLIENT_ID`
- `AUTH_MICROSOFT_CLIENT_SECRET`
- `AUTH_MICROSOFT_TENANT_ID`
- `GPU_ENTRA_GROUP_ID` (required for GPU Compute visibility and access)

Recommended backend startup command on App Service:

```bash
node packages/backend --config app-config.yaml --config app-config.production.yaml
```

This keeps local defaults from `app-config.yaml` while applying production
overrides for auth and Azure PostgreSQL.

## Datasource Profiles

Environment-specific datasource profile files are now available in `config/`:

- `config/application-local.yml`
- `config/application-dev.yml`
- `config/application-prod.yml`

Configured URLs:

- Local: `jdbc:postgresql://localhost:5433/cloudhub`
- Dev/Prod (Azure): `jdbc:postgresql://myazurepostgres.postgres.database.azure.com:5432/cloudhub`

For Backstage runtime in this repository, database settings remain driven by
`app-config.yaml` (local) and `app-config.production.yaml` (App Service).

## App Service Deployment Workflow

Use GitHub Actions workflow `Deploy CloudHub Backend To App Service` to deploy a
previously published backend image tag from ACR into Azure App Service.

Safety behavior in this workflow:

- it now captures the currently running backend image before deployment
- if any deployment step fails, it automatically restores the previous image and restarts the app

Workflow inputs:

- `image_tag`
- `resource_group`
- `webapp_name`
- `slot_name` (optional)
- `swap_with_production`
- `configure_app_settings`
- `startup_command`

Required repository secrets for deployment auth and ACR pull:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_ACR_USERNAME`
- `AZURE_ACR_PASSWORD`

Required repository secrets for production runtime configuration when
`configure_app_settings=true`:

- `APP_BASE_URL`
- `BACKEND_BASE_URL` (optional; defaults to `APP_BASE_URL`)
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `AUTH_MICROSOFT_CLIENT_ID`
- `AUTH_MICROSOFT_CLIENT_SECRET`
- `AUTH_MICROSOFT_TENANT_ID`

Release details and verification commands are documented in [docs/container-release-process.md](../docs/container-release-process.md).

## Quality Gates And Rollback

Every change to `main` and every pull request to `main` now runs workflow
`CloudHub Quality Gates` (`.github/workflows/ci-quality-gate.yml`) with:

- `yarn lint:all`
- `yarn tsc:full`
- `yarn test:all` (coverage-enabled workspace tests)
- `./tests/run.sh` (platform validation tests)

The production release workflow `Release CloudHub To Production` now enforces the
same quality-gate checks before build/deploy, and it automatically rolls back to
previous backend/frontend images if any deployment stage fails.

## Frontend-to-Backend Routing on App Service

The frontend nginx container proxies `/api/` and `/.backstage/` to the backend
via the `BACKEND_ORIGIN` environment variable (see
[docker/nginx.conf.template](docker/nginx.conf.template)). This is separate
from `BACKEND_BASE_URL`/`APP_BASE_URL`, which are the public-facing URLs used
in auth callbacks and app config.

- Local docker-compose: `BACKEND_ORIGIN` defaults to `http://backend:7007`
  (the compose service hostname).
- Azure App Service: the release workflow sets `BACKEND_ORIGIN` on the
  frontend web app to the backend's reachable service origin. This is an
  internal proxy target and is separate from the public auth URL; production
  `APP_BASE_URL`, `BACKEND_BASE_URL`, and callback URLs must remain
  `https://cloudhub.symphonyai.cloud`.
- Azure App Service multi-container compose deployments: keep `frontend` as
  the first service in `docker-compose.yml` so App Service routes public
  traffic to it, and set `WEBSITES_PORT=80` plus `BACKEND_ORIGIN` in the app
  settings when the container starts.

## Backend Health Endpoint

The backend exposes Backstage's built-in health routes (no custom code
required):

- Readiness: `<BACKEND_BASE_URL>/.backstage/health/v1/readiness`
- Liveness: `<BACKEND_BASE_URL>/.backstage/health/v1/liveness`

Use the readiness URL as the `backend_health_url` input for the
`Release CloudHub To Production` workflow:
`https://cloudhub.symphonyai.cloud/.backstage/health/v1/readiness`.
