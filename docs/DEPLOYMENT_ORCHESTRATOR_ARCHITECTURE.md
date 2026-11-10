# Deployment Orchestrator Architecture

## 1. Existing Backend Architecture

CloudHub uses Backstage's new backend plugin architecture:

- `packages/backend/src/index.ts` registers the backend plugins.
- Each feature is isolated behind a backend plugin, router, and service layer.
- PostgreSQL-backed services persist durable state.
- Express routers expose REST APIs through Backstage.
- Azure, GitHub Actions, Helmfile, Kubernetes, and registry operations are implemented as services.

Relevant backend plugins include:

- `deployment-control-plane-backend`: deployment portal, Helmfile preview, deployment persistence, approvals, GitHub workflow dispatch, status, and logs.
- `platform-registry-backend`: platforms, cloud accounts, environments, clusters, deployments, and events.
- `provisioningPlugin`: infrastructure provisioning requests, jumpbox access, and infrastructure approvals.
- `costAutomationPlugin`: Azure VM and AKS cost operations.
- `k8sHealthCheckPlugin`: Kubernetes health checks.

The deployment control plane uses the current deployment model through `DeploymentBackendFactory`:

```text
cloudhub-native       -> CloudHubNativeService
```

The existing abstraction is defined in:

- `plugins/deployment-control-plane-backend/src/services/deploymentBackendFactory.ts`
- `plugins/deployment-control-plane-backend/src/services/deploymentBackend.ts`

## 2. Platform Registry Internal Exposure

The Platform Registry is a Backstage backend plugin with the plugin ID:

```text
platform-registry
```

It is registered in `packages/backend/src/index.ts` and mounts its router through Backstage's internal HTTP router.

The internal API is exposed under:

```text
/api/platform-registry/*
```

Examples:

```text
GET  /api/platform-registry/health
GET  /api/platform-registry/summary
GET  /api/platform-registry/platforms
GET  /api/platform-registry/cloud-accounts
GET  /api/platform-registry/environments
GET  /api/platform-registry/clusters
GET  /api/platform-registry/clusters/onboarded
GET  /api/platform-registry/deployments
GET  /api/platform-registry/deployments/:id/events
```

Implementation:

- `plugins/platform-registry-backend/src/index.ts`
- `plugins/platform-registry-backend/src/router.ts`
- `plugins/platform-registry-backend/src/service.ts`
- `plugins/platform-registry-backend/src/db.ts`

Frontend code accesses the plugin through Backstage backend APIs, for example:

```ts
backendFetch('platform-registry', '/clusters/onboarded')
```

Provisioning also has a direct internal database bridge in:

```text
packages/backend/src/services/PlatformRegistryUpdater.ts
```

That bridge updates cluster lifecycle state such as `Pending Access` and `Ready`.

## 3. Existing Approval Mechanism

Deployment approvals are already implemented in `deployment-control-plane-backend`.

Approval records are persisted in:

```text
control_plane_deployment_approvals
```

The lifecycle is:

```text
Deployment requested
        |
        v
PENDING
        |
        +--> APPROVED --> deployment orchestration
        |
        +--> REJECTED
```

Existing endpoints:

```text
GET  /api/deployment-control-plane/deployments/approvals/permissions
POST /api/deployment-control-plane/deployments/approvals
GET  /api/deployment-control-plane/deployments/approvals
GET  /api/deployment-control-plane/deployments/approvals/:id
POST /api/deployment-control-plane/deployments/approvals/:id/approve
POST /api/deployment-control-plane/deployments/approvals/:id/reject
```

Implementation:

- Router: `plugins/deployment-control-plane-backend/src/router.ts`
- Persistence and decisions: `plugins/deployment-control-plane-backend/src/services/controlPlaneService.ts`
- Deployment lifecycle: `plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts`

Existing safeguards include:

- Requesters cannot approve their own deployments.
- Approval decisions use compare-and-set behavior to prevent double decisions.
- Approval and rejection are audited.
- PostgreSQL persistence has an in-memory fallback for local development.
- Deployment backend selection occurs after approval.

Infrastructure provisioning has a separate approval permission, `jumpboxApprovePermission`. It should not be duplicated for application deployment approvals.

## 4. Authentication and RBAC

The primary authentication model is Backstage identity plus Entra group membership.

The deployment control-plane router:

1. Calls `httpAuth.credentials(..., { allow: ['user'] })`.
2. Resolves the user with `userInfo.getUserInfo(...)`.
3. Reads group references from `ownershipEntityRefs`.
4. Maps groups to a CloudHub persona role.

Roles:

```text
platform-engineer
app-engineering
professional-services
readonly
```

The main mapping is in:

```text
plugins/deployment-control-plane-backend/src/rbac.ts
```

Important permissions include:

```text
canRead(role)
canDeployPlatform(role)
canTriggerSriPipeline(groups, actorRef)
canApproveDeployment(groups, actorRef)
```

Deployment approval is gated by:

```text
group:default/grp-cloudhub-platformadmin
```

There is a local/dev fallback using the `x-cloudhub-persona` header when the identity has no real group claims. This fallback should not replace Entra-backed authorization in production.

Platform Registry has its own group checks in `plugins/platform-registry-backend/src/router.ts`:

- Reads allow platform admins, professional services, app engineering, SRE, and read-only users.
- Writes require platform-admin access.

The provisioning router is a special case: it currently permits unauthenticated HTTP access and relies on Azure/Kubernetes controls. That behavior should remain isolated and should not be copied into deployment orchestration.

## 5. Existing Asynchronous Job Handling

CloudHub does not currently use a separate durable queue such as Azure Service Bus, Temporal, BullMQ, or a dedicated worker process for deployments.

It uses a combination of database state, background execution, external GitHub Actions, polling, webhooks, and Server-Sent Events.

Deployment records persist:

```text
status
current_step
workflow_run_id
workflow_run_url
failure_reason
updated_at
completed_at
```

Deployment states include:

```text
PENDING
VALIDATING
GENERATING_HELMFILE
COMMITTING
TRIGGERING_WORKFLOW
QUEUED
DEPLOYING
SUCCEEDED
FAILED
```

After approval, the service starts orchestration asynchronously:

```ts
void this.runDeploymentAsync(record);
```

The orchestration then:

1. Renders the Helmfile.
2. Commits the Helmfile and generated values to GitHub.
3. Dispatches a GitHub Actions workflow.
4. Stores the workflow run ID.
5. Moves the deployment into a queued/running state.

Status is available through:

```text
GET /api/deployment-control-plane/deployments/:id/status
```

GitHub workflow status can also be synchronized through:

```text
POST /api/deployment-control-plane/webhooks/github/workflow-runs
```

Live logs and status use:

```text
GET /api/deployment-control-plane/deployments/:id/logs/stream
```

The stream combines persisted deployment events, an in-process `EventEmitter`, GitHub status polling, and heartbeat frames for proxy compatibility.

Current limitation: the initial in-process orchestration can be interrupted by a backend restart because it is started with `void` rather than handed to a durable worker. Once GitHub Actions is dispatched, the external workflow continues independently.

## 6. Recommended Location for Deployment Orchestrator

Deployment Orchestrator should live inside the existing:

```text
plugins/deployment-control-plane-backend
```

Recommended structure:

```text
plugins/deployment-control-plane-backend/src/
  services/
    deploymentOrchestrator.ts
    deploymentPortalService.ts
    deploymentBackendFactory.ts
    cloudHubNativeService.ts
```

Recommended ownership:

```text
DeploymentPortalService
  Request validation
  Approval lifecycle
  Deployment record creation
  Status and event access

DeploymentOrchestrator
  Execute an approved deployment
  Coordinate Helmfile rendering
  Commit deployment configuration
  Dispatch the deployment workflow
  Update deployment state and events

DeploymentBackendFactory
  Select CloudHub Native, SRI-Provisional, or legacy backend

Platform Registry
  Provide cluster and platform metadata
  Track cluster lifecycle and readiness
  Do not execute deployments

Provisioning plugin
  Provision infrastructure only
```

The orchestrator should use the existing:

- Backstage authentication and RBAC
- Deployment approval records
- Deployment event table
- Server-Sent Events stream
- GitHub Actions service
- Platform Registry cluster metadata
- `IDeploymentBackend` and `DeploymentBackendFactory` boundaries

It should not be implemented as:

- A new top-level backend plugin
- A second approval system
- A replacement for Platform Registry
- A modification to infrastructure provisioning
- A new generic queue framework before the current workflow requires one

Recommended flow:

```text
Deployment UI
    -> Deployment Control Plane
    -> Approval record
    -> Deployment Orchestrator
    -> Platform Registry for cluster metadata
    -> Helmfile/GitHub commit
    -> GitHub Actions
    -> Target AKS cluster
    -> Webhook/polling/SSE status updates
```

This placement adds orchestration without disturbing Platform Registry, provisioning, cost automation, or the existing deployment backends.
