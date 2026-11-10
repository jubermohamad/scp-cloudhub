# CloudHub Deployment Refactor Inventory

## Scope and repository boundary

This inventory covers the deployment-related implementation in
`platform_cloudhub`. No files in `symphony-repos/scripts` or
`symphony-repos/helm` were modified. The existing CloudHub implementation was
read before refactoring.

## Existing deployment flow

The primary self-service flow is owned by
`plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts`.
It currently validates a portal request, exposes application/options data,
renders a Helmfile preview through `HelmfileTemplateService`, persists a portal
deployment record, and delegates execution through `DeploymentBackendFactory`.
The current execution choice is:

* `cloudhub-native` -> `CloudHubNativeService`

The CloudHub-native path renders Helmfile and values content in CloudHub,
commits generated files through `GitHubDeploymentService`, then dispatches a
GitHub Actions workflow through `GitHubActionsService`. The SRI-provisional
path writes to an optional separate SRI database and waits for a webhook; it
does not use the scripts pipeline.

## Approval flow

Approval persistence is implemented in the control-plane service and migration
`004_approval_workflow.sql`, with additional linkage in
`006_link_approval_to_deployment.sql`. The router exposes approval creation,
approval/rejection decisions, pending-approval queries, and permission checks.
The portal flow creates a deployment with pending approval; approval handling
then starts backend orchestration. Existing RBAC includes
`canApproveDeployment` and `canTriggerSriPipeline`, with requester/approver
identity and audit records retained by the control plane.

The required invariant to preserve is that no GitHub dispatch occurs before a
successful CloudHub approval. Self-approval behavior and the existing actor
identity checks must remain covered by tests.

## GitHub integration

`GitHubActionsService` is the existing HTTP adapter for workflow dispatch and
workflow-run status. It uses the configured token precedence
`GITHUB_ACTIONS_TOKEN`, `CLOUDHUB_GITHUB_TOKEN`, then `GITHUB_TOKEN`, and
currently supports a simulated fallback when GitHub is not configured.
The dispatch API does not return a run ID, so the current implementation polls
workflow runs after dispatch and selects a run using timestamp/list ordering.
That correlation is not sufficiently safe for concurrent deployments and must
be replaced with persisted pre-dispatch metadata plus conservative matching.

`GitHubDeploymentService` is a separate Contents API adapter used to commit
CloudHub-rendered Helmfile/configuration files. This is deployment-engine
behavior that the unified scripts-backed design must remove from the new
application deployment path.

## Deployment states and persistence

The principal record type is `PortalDeploymentRecord` in
`plugins/deployment-control-plane-backend/src/types.ts`. It contains request
identity, application/instance/cluster fields, generated Helmfile fields,
branch/commit fields, workflow run fields, status/timestamps, approval fields,
and legacy source metadata. The control-plane schema and migrations include
portal deployment, approval, audit, and GitHub repository tables. Event rows
are written by `DeploymentPortalService.logEvent` and are also emitted to an
in-process `EventEmitter` for live listeners.

The existing statuses include validation/generation/commit/triggering,
queued/deploying, success, and failure concepts. The refactor should map these
to the unified lifecycle without rewriting historical records.

## SSE and event implementation

Deployment events are persisted in the deployment event table when a database
pool is available and emitted through the portal service event bus. The router
exposes deployment event/log streaming endpoints. The frontend uses the shared
`useBackendEventStream` hook from `plugins/platform-common` and also polls
deployment status. This infrastructure is reusable for GitHub job/log
reconciliation; incremental log offsets must prevent duplicate emissions.

## Frontend deployment flow

`plugins/platform-home/src/components/DeploymentWizard.tsx` provides the
multi-step deployment experience and currently includes a Helmfile preview,
approval actions, deploy/status tracking, and retry behavior.
`DeploymentHistory.tsx` renders historical records and links to pipeline logs.
SRI entry points include `SriDeployPage.tsx` and the shared
`SriDeploymentHubPage.tsx`; their deployment actions already route into the
portal wizard rather than owning an independent engine.

The frontend receives deployment options from CloudHub APIs. However, the
current backend option generation is not APP_LIST-derived, and the source
contains a hardcoded 19-entry chart-version/application map. No frontend
application catalog should be added; the catalog must be server-owned.

## SRI catalog and SRI deployment

The SRI catalog remains implemented in the platform-home plugin and the
deployment-control-plane SRI component metadata/service. The current
`SriProvisionalService` is an active deployment execution backend, persisting
to a separate optional database and consuming status webhooks. It must remain
available only for historical/non-deployment catalog functionality; new SRI
deployment buttons must submit the unified deployment request and use the
scripts pipeline after approval.

## Backend-selection mechanism and admin setting

`DeploymentBackendFactory` selects among the three runtime backends based on
`SriDeploySource`/`DeploymentBackendSource`. `PlatformSettingsService` stores
the selected source in `platform_deployment_settings`, and the admin UI uses
`DeploymentBackendSelector` plus `SriDeploySourceContext` to expose it.
These are active selectors, not historical compatibility only, and must be
removed from the new deployment execution path. Historical source values in
old deployment rows remain readable.

## Platform Registry and target validation

CloudHub already has platform/cluster discovery and tag-based onboarding
services, including `ClusterDiscoveryService` and `ClusterTagService`. The
current portal dependency accepts discovered clusters, but the inventory did
not find an APP_LIST source in this repository and the deployment request must
be strengthened to resolve target clusters through the existing Platform
Registry rather than accepting arbitrary frontend kube-context values.

## Application instance discovery

The current portal validates application and instance naming and builds
deployment paths through `HelmfileTemplateService`; it does not yet expose a
single authoritative discovery abstraction for all valid
`apps/<app>/<instance>/helmfile.yaml` combinations. This is a required new
server-side boundary. Metadata must be derived from existing files where
present, without inventing missing values or duplicating the scripts parser.

## Authorization and audit

Authorization is enforced in `router.ts` using authenticated Backstage
credentials, persona/group resolution, and deployment RBAC helpers. Approval
and deployment actions are audited through the control-plane service. The
unified dispatch boundary must re-check authorization, approval state,
registered target, and valid application/instance rather than relying on the
frontend or a direct GitHub-facing route.

## Tests and migrations inspected

Relevant tests include deployment portal service/router tests, approval
workflow integration tests, backend factory/routing tests, GitHub Actions and
GitHub deployment service tests, platform settings API tests, SRI/provisioner
backend tests, RBAC tests, and frontend deployment tests. Migrations
`001_control_plane.sql` through `007_github_repository_requests.sql` define
the existing control-plane persistence; they must be extended with additive
fields/tables where needed so existing records remain readable.

## Files expected to change

Likely implementation surfaces are:

* `plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts`
* `plugins/deployment-control-plane-backend/src/services/githubActionsService.ts`
* a new scripts-pipeline deployment adapter/service and catalog/instance service
* `plugins/deployment-control-plane-backend/src/services/controlPlaneService.ts`
* `plugins/deployment-control-plane-backend/src/router.ts`
* `plugins/deployment-control-plane-backend/src/types.ts`
* additive control-plane migrations
* focused backend tests
* `plugins/platform-home/src/components/DeploymentWizard.tsx`
* SRI deployment entry points and related frontend tests
* admin settings/context only where needed to remove the active backend selector

## Files/repositories that must remain untouched

The following execution-engine files are outside the allowed implementation
surface and must not be changed:

* `/home/juberm/git-all/symphony-repos/scripts`
* `/home/juberm/git-all/symphony-repos/helm`
* `task.bash`
* `deploy-with-dynamic-runners.yml`
* `helmfile-wrapper.sh`
* application Helmfiles
* `nrod-helm`
* existing SymphonyFS/scripts deployment logic

No `cloudhubDeploymentId` may be added to the workflow contract, scripts, or
any execution-engine metadata.

## Risks and dependencies

1. The current GitHub adapter attempts “latest/timestamp” run discovery after
   dispatch; concurrent dispatches make this unsafe without stronger matching
   and an explicit ambiguous-correlation state.
2. The current portal owns Helmfile rendering and Contents API commits; moving
   to workflow inputs must not leave a hidden direct Helm/Helmfile execution
   path active.
3. The authoritative `APP_LIST` was not found in the CloudHub repository; the
   server-side catalog must read the existing scripts source at runtime or via
   an existing configured checkout, without creating a manually maintained
   second list.
4. Platform Registry lookup and application-instance compatibility need to be
   enforced server-side on both request creation and dispatch.
5. Existing historical records may contain `cloudhub-native` or
   `sri-provisional`; cleanup must remove active control flow while retaining
   display compatibility.
6. Restart recovery requires persisted dispatch/correlation metadata and a
   reconciliation path that does not depend on the in-process event emitter.
