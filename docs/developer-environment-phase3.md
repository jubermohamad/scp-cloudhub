# CloudHub Developer Environment (Phase 3)

## Goal

Phase 3 closes the loop from standardized developer workspace to standardized application CI/CD and deployment into shared AKS development namespaces.

The primary path is:

SOURCE -> STANDARD CI -> IMAGE -> ACR -> STANDARD CD -> AKS -> TEAM NAMESPACE -> RUNNING APP

## Architecture Decisions

- Application teams consume CI/CD through platform-owned reusable workflows.
- Application repositories use thin caller workflows.
- Deployment execution is abstracted behind a deployment executor interface.
- Initial executor is GitHub Actions based (`aks-helm`), designed to be replaceable by Argo CD/GitOps later.

## Existing Functionality Reused

- DeveloperEnvironment and DevelopmentProfile from Phase 1/2.
- Shared namespace and resource profile resolution from Phase 1.
- Existing deployment-control-plane RBAC and ownership checks.
- Existing GitHub Actions dispatch/status integration (`GitHubActionsService`).
- Existing platform Helm charts (`namespace-bootstrap`, `app-bootstrap`).

## New Domain Extensions

Phase 3 extends `deployment-control-plane` with:

- CI workflow standardization model:
  - status: `NOT_CONFIGURED`, `PLATFORM_MANAGED`, `OUTDATED`, `CUSTOM`, `INVALID`, `CONFLICT`, `FAILED`
  - generated thin workflows: `.github/workflows/ci.yml`, `.github/workflows/deploy-dev.yml`
- Application deployment model:
  - immutable image identity (`repository`, `tag`, optional `digest`)
  - workflow run metadata
  - pipeline stage visualization model
  - deployment history persistence

## API Surface

Added endpoints on `deployment-control-plane`:

- `GET /developer-environments/:id/ci-workflow`
- `POST /developer-environments/:id/ci-workflow/validate`
- `POST /developer-environments/:id/ci-workflow/generate`
- `GET /developer-environments/:id/deployments`
- `POST /developer-environments/:id/deployments`
- `GET /developer-environments/:id/deployments/:deploymentId`
- `POST /developer-environments/:id/deployments/:deploymentId/sync`

All endpoints reuse the existing ownership checks used for environment and workspace data.

## Deployment Executor Abstraction

`DeploymentExecutor` interface supports:

- `deploy()`
- `getStatus()`
- `verify()`
- `cancel()`
- `rollback()`

Initial implementation:

- `AksHelmDeploymentExecutor`
  - dispatches standardized deployment workflow through GitHub Actions
  - maps workflow state to CloudHub deployment lifecycle
  - exposes stage-level status for UI rendering

## Workflow Ownership and Versioning

Platform-owned reusable workflows are defined under:

- `platform-workflows/.github/workflows/application-ci.yml`
- `platform-workflows/.github/workflows/deploy-aks-dev.yml`

Application-side thin caller templates are provided at:

- `developer-environments/templates/ci-workflows/ci.yml`
- `developer-environments/templates/ci-workflows/deploy-dev.yml`

Callers pin versioned workflow references (`@v1`) rather than mutable `main`.

## Security and Identity

- Azure authentication in platform workflows uses OIDC via `azure/login@v2`.
- No kubeconfig or static cluster credentials are committed in workflows.
- No deployment path allows frontend-provided arbitrary cluster/namespace overrides in backend APIs.
- Deployment target is derived from `DeveloperEnvironment` policy.

## Namespace and Resource Governance

- Namespace remains the shared team namespace from Phase 1.
- Resource profile remains resolved from Phase 1 (`SMALL/MEDIUM/LARGE`).
- Namespace controls continue via `namespace-bootstrap` chart (`ResourceQuota`, `LimitRange`, RBAC, network policy).

## Current Vertical Slice

Implemented and validated for:

- Component: `sri-investigation-api`
- Profile: `node-api`
- Runtime packaging: Helm (`app-bootstrap`)

## Known Limitations

- PR creation for workflow files is still manual (generated content + instructions).
- Deployment cancellation and rollback executor actions are stubbed and return explicit unsupported status.
- Endpoint URL resolution depends on `CLOUDHUB_DEV_BASE_DOMAIN` configuration.
- Deployment verification currently relies on workflow status mapping and chart rollout checks.

## Future Compatibility

Current APIs/models are designed so execution can migrate from:

GitHub Actions -> Helm -> AKS

to:

GitHub Actions -> Desired State Git -> Argo CD -> AKS

without changing DeveloperEnvironment, ApplicationDeployment, or CloudHub frontend contracts.
