# CloudHub Deployment Validation Report

Date: 2026-09-09
Repository audited: `/home/juberm/git-all/platform_cloudhub`
Implementation commit: `922174e phase- scp pipeline integration`

## Executive Summary

Result: **NOT READY**.

The implementation contains a promising APP_LIST reader, server-side instance
lookup, approval-capable APIs, and a scripts workflow adapter. It does not yet
form a working end-to-end deployment path. The most serious blockers are:

1. The frontend uses a separate approval-record workflow, but approval decisions
   never approve or dispatch the associated portal deployment. The later
   `POST /deployments` creates a new `PENDING_APPROVAL` record.
2. The GitHub adapter defaults to `jubermohamad/platform_cloudhub`, not
   `SymphonyFS/scripts`, unless an external environment variable is supplied.
   The default ref is also derived from the old deployment-definition service.
3. Run correlation uses only creation time and branch. It does not match
   workflow inputs and can associate the wrong run under concurrency.
4. The new workflow/job/correlation migration is not wired into persistence or
   reconciliation. Jobs and incremental logs are not stored.
5. Legacy backend classes, factory, types, selectors, and direct execution
   paths remain in active source. Full typecheck is already broken.
6. The frontend still expects a rendered Helmfile preview containing `releases:`;
   the new backend returns a metadata-only message, so the wizard cannot reach
   its approval/deploy flow.

## Repository Audit

### CloudHub

`git status --short`, `git diff --stat`, and `git diff --name-only` were clean
at the start of validation. The implementation is committed in `922174e`.
That commit changes 10 files: the inventory document, migration `008`, router,
control-plane composition, deployment portal service, GitHub Actions service,
two new scripts services, deployment types, and the admin settings page.

### Protected repositories

`/home/juberm/git-all/symphony-repos/scripts`: clean status and empty diff.

`/home/juberm/git-all/symphony-repos/helm`: clean status and empty diff at the
corrected audit; no implementation changes were observed. The repository is on
`feature/juber-cloudhub`.

No files outside `platform_cloudhub` were changed by the implementation commit.

## Implementation Map

```text
DeploymentWizard.tsx / SriDeploymentHubPage.tsx
  -> deployment-control-plane /deployments/options, /preview,
     /deployments/approvals, /deployments
  -> router.ts
  -> ControlPlaneService
  -> DeploymentPortalService / separate DeploymentApproval persistence
  -> ScriptsPipelineDeploymentService
  -> GitHubActionsService.dispatch
  -> GitHub Actions workflow_dispatch
  -> SymphonyFS/scripts deploy-with-dynamic-runners.yml
```

### Frontend entry points

* `plugins/platform-home/src/components/DeploymentWizard.tsx` is the main
  wizard and opens an approval request, polls it, then submits `/deployments`.
* `SriDeploymentHubPage.tsx` maps SRI catalog cards into the same wizard.
* `DeploymentHistory.tsx` and `PendingApprovalsPage.tsx` consume deployment and
  approval endpoints.
* The wizard still calls `/deployments/preview`, checks for a `releases:`
  section, and requires a chart version. This conflicts with the new
  metadata-only preview and scripts-owned rendering.

### API and validation

Relevant routes in `plugins/deployment-control-plane-backend/src/router.ts`:

* `GET /deployments/options`
* `GET /deployments/instances`
* `POST /deployments/preview`
* `POST /deployments`
* `POST /deployments/approvals`
* `POST /deployments/approvals/:id/approve|reject`
* `GET /deployments/:id/status`
* `GET /deployments/:id/events`
* `GET /deployments/:id/logs/stream`
* `POST /webhooks/github/workflow-runs`

`DeploymentPortalService.validate()` checks application, name, customer,
environment, instance, and target cluster. The composition root maps
`discoverClusters` to `ControlPlaneService.listClusters()`, filtering
registered `control_plane_clusters` rows rather than direct Azure inventory.
That is the correct registry direction. However, the approval creation route
passes no subscription/resource-group to the approval service, and the frontend
does not use `/deployments/instances`.

### Persistence and state

The primary table is `control_plane_portal_deployments`; approval rows are in
`control_plane_deployment_approvals`; events are written to `deployment_events`
when the portal event path is used. The intended new migration is
`008_scripts_pipeline_deployment.sql`.

The actual portal `SELECT`, `INSERT`, `UPDATE`, `portalParams()`, and `mapRow()`
do not include migration 008 columns. Workflow repository, workflow inputs,
run attempt, correlation status/message, job rows, and log offsets are never
persisted or loaded. A restart therefore cannot recover those new correlation
or job details.

The actual portal status flow is approximately:

```text
PENDING_APPROVAL -> APPROVED -> DISPATCHING -> QUEUED -> DEPLOYING
                                          -> SUCCEEDED / FAILED
PENDING_APPROVAL -> REJECTED
```

Historical `PENDING` is also accepted. `applyRunStatus()` maps completed
`success` to `SUCCEEDED` and every other non-null conclusion to `FAILED`, but
there is no explicit persisted handling for run attempt, jobs, or cancellation
metadata.

### Approval

There are two overlapping approval systems:

1. `DeploymentPortalService.approve()` operates on a portal deployment and does
   dispatch after approval, with requester/approver equality protection.
2. `ControlPlaneService.createDeploymentApproval()` creates a separate approval
   row. `decideDeploymentApproval()` only updates that row and audits it; it does
   not call `DeploymentPortalService.approve()` or create/dispatch the linked
   portal record.

The frontend uses system 2 first, then calls `POST /deployments` with the
approval deployment ID. Since `start` is intentionally ignored by the portal
service, that creates a new `PENDING_APPROVAL` portal record. The displayed
approval therefore does not unlock execution. This is a critical functional
failure.

Self-approval is protected in `DeploymentPortalService.approve()` and `reject()`,
but not in `decideDeploymentApproval()`. The frontend approval endpoint can
therefore mark the separate approval row approved by its requester if that
requester has approval RBAC.

### GitHub adapter and contract

`ScriptsPipelineDeploymentService` dispatches
`deploy-with-dynamic-runners.yml` with these six inputs:

| Input | Existing workflow expects | CloudHub sends | Result |
|---|---:|---:|---|
| `appName` | Yes | Yes | PASS |
| `appInstance` | Yes | Yes | PASS |
| `configureSkupper` | Yes | Yes | PASS |
| `triggerFailover` | Yes | Yes | PASS, but boolean/string semantics need verification |
| `actionValidation` | Yes | Yes | PASS |
| `acceptance` | Yes | Yes | PASS |

No `cloudhubDeploymentId` is sent. The adapter uses `workflow_dispatch` through
`GitHubActionsService`.

Critical targeting issue: `GitHubActionsService.repository()` defaults to
`jubermohamad/platform_cloudhub`; `GitHubDeploymentService.branch()` defaults
to `main`; and no checked-in configuration was found setting
`SRI_PIPELINE_REPO`. Unless deployment environment configuration supplies the
correct repository, CloudHub dispatches against the wrong repository. The
adapter's workflow ref also uses `record.branch`, which comes from the old
GitHub deployment service.

### Run correlation

The dispatch API is followed by a workflow-runs list query. A candidate is
accepted when `created_at >= dispatch timestamp` and `head_branch` matches the
ref. Multiple candidates cause an error rather than guessing, which is a good
fail-closed property.

It is still insufficient for the required concurrency guarantee: workflow input
values (`appName`, `appInstance`, and option inputs) are not matched, and a
single candidate can be the wrong concurrent run. The correlation result is
also not persisted in the new correlation fields. There is no reconciliation
worker/startup recovery path for a dispatch whose response is lost.

### Jobs, logs, and SSE

`GitHubActionsService.runStatus()` fetches jobs and returns job name/status/
conclusion plus timing fields in memory. The portal service only applies the
run-level status; it does not persist jobs or expose current job data in the
portal status view. `runLogs()` exists, but the deployment SSE route does not
call it. The SSE route streams persisted/local deployment events and polls
run-level status; it does not stream incremental GitHub job logs. Migration 008's
job and log-offset columns/tables have no runtime consumers.

The frontend deployment console does merge event IDs and falls back to status
polling, which helps avoid duplicate event rows. It cannot display real GitHub
job logs through this path because the backend never injects them into the
stream.

## APP_LIST Authority

`ScriptsApplicationCatalogService` reads `APP_LIST=(...)` from
`/home/juberm/git-all/symphony-repos/scripts/task.bash` (overrideable by
`SYMPHONYFS_TASK_PATH` and `SYMPHONYFS_SCRIPTS_ROOT`). It exposes the backend
catalog, and no `cloudhubDeploymentId` reference was found anywhere in
CloudHub.

The protected source contains exactly **18** APP_LIST entries:

`ai-store`, `common-res`, `edb-common-res`, `datadog`, `dxv`, `detectionhub`,
`flows`, `invhub`, `netreveal`, `netrevealv95`, `netrevealv96`,
`edb-netrevealv96`, `sales-genie`, `sensaai-sanctions`, `tailscale`, `velero`,
`istio-service-entry`, `hybrid-manager`.

The backend catalog maps exactly those entries. The general deployment wizard
gets applications from `/deployments/options`; it does not own a manually
maintained React application array. SRI cards are a separate SRI catalog and
preserve SRI metadata/navigation, but they pass their selected application into
the wizard.

Instance discovery scans `apps/<app>/<instance>/helmfile.yaml` in the scripts
checkout and extracts a small set of scalar metadata keys. The checkout
currently contains 538 matching Helmfiles. The parser is line-oriented rather
than YAML-structured and does not prove nested/quoted metadata correctness.
It is also called once per application repeatedly, which is inefficient but not
the primary blocker.

## Platform Registry

Deployment composition uses `ControlPlaneService.listClusters()` and filters
registered, CloudHub-eligible cluster rows. This avoids a deployment-only
cluster inventory and rejects an unregistered target when discovery returns no
matching registered row. Direct Azure discovery remains in unrelated cluster,
provisioning, and legacy SRI routes, but the new portal dependency uses the
registry path.

## Legacy Backend Audit

The following active source remains:

* `cloudHubNativeService.ts`
* `sriProvisionalService.ts`
* `deploymentBackend.ts`
* `deploymentBackendFactory.ts`
* `IDeploymentBackend`
* `SriDeploySource` and `DeploymentBackendSource` legacy types
* `PlatformSettingsService` and related persisted selector columns
* `canTriggerSriPipeline` in RBAC and route checks
* old backend/routing/integration tests

The portal no longer calls the factory in its active orchestration method, but
these classes are not removed and still compile/runtime-load through the
control-plane codebase. The admin selector component was removed from
`AdminSettingsPage`, but the old selector/settings implementation and legacy
API/values remain. This fails the requested legacy cleanup requirement.

## Direct Deployment and Secrets Boundary

The new scripts adapter does not execute Helm, Helmfile, kubectl, or task.bash;
it only dispatches GitHub. However, legacy CloudHub-native/deployment backend
services remain in source and contain CloudHub-side Helmfile rendering and
GitHub Contents commits. The active portal still injects `HelmfileTemplateService`
and `GitHubDeploymentService` dependencies and uses their branch/repository
metadata even though the new dispatch path no longer renders or commits.
This leaves a misleading and potentially reusable direct execution surface.

No external scripts or helm repository modifications were found. GitHub token
handling remains in backend services, which is appropriate, but the target
repository default must be corrected through deployment configuration before
real use.

## Test and Build Results

### Focused tests

Command:

```text
CI=1 yarn workspace @internal/plugin-deployment-control-plane-backend test -- deploymentPortalService.test.ts approvalWorkflow.integration.test.ts router.deploymentPortal.test.ts githubActionsService.test.ts --runInBand
```

Result: **2 suites failed, 2 passed; 29 tests failed, 26 passed; 55 total**.
The failures are dominated by stale fixtures expecting CloudHub-rendered
Helmfiles and non-existent synthetic script instances, but this is still a
regression and means the critical paths lack valid coverage.

### Full typecheck

Command:

```text
yarn tsc:full
```

Result: **18 TypeScript errors in 8 files**. Errors include missing catalog
fields in tests, retired status literals still used by legacy backends,
incorrect `PortalHelmfilePreview` fields, optional cluster/subscription values,
an unused orchestration parameter/method, an incomplete GitHub jobs type, and
an unused frontend import.

No real GitHub dispatch or AKS deployment was performed. No live E2E IDs exist.
A real E2E deployment is therefore **NOT RUN**.

## Final Validation Matrix

| Requirement | Result | Evidence |
|---|---|---|
| One deployment execution path | FAIL | Legacy services/factory remain; frontend approval path is split and broken |
| Only CloudHub modified | PASS | CloudHub commit only; protected repos clean |
| SymphonyFS/scripts untouched | PASS | Empty status/diff |
| nrod-helm untouched | PASS | Empty status/diff |
| No cloudhubDeploymentId | PASS | Repository-wide search found none |
| APP_LIST authoritative | PASS | Backend reads task.bash APP_LIST |
| 18 apps exposed | PASS | APP_LIST count and catalog source both 18 |
| Instance discovery | PARTIAL | Scripts path scan exists; frontend does not consume instances API; parser is ad hoc |
| Platform Registry clusters only | PASS | Portal composition uses registered cluster rows |
| Server-side target validation | PASS | Portal validates app, instance, and registered cluster |
| Approval mandatory | FAIL | Separate approval API does not bind to portal deployment execution |
| No GitHub dispatch before approval | PASS for portal `approve()` path; FAIL for usable UI path | Direct portal approve gates; UI path never reaches linked dispatch |
| Self-approval protection | PARTIAL | Portal service protects; separate approval decision does not |
| Existing GitHub workflow contract | PASS | Six exact existing inputs; workflow_dispatch |
| Correct workflow correlation | FAIL | Repository/ref defaults and input matching are insufficient |
| Concurrent deployment correlation | FAIL | Single candidate can still be wrong; no input correlation test |
| Job tracking | FAIL | Returned in memory only; not persisted or rendered |
| Log streaming | FAIL | `runLogs()` is not connected to deployment SSE |
| SSE | PARTIAL | Deployment event SSE exists, but not GitHub incremental logs |
| Deployment console | FAIL | Old preview/fields; no real current job/log stream |
| SRI uses unified deployment | FAIL | SRI opens wizard, but wizard approval/deploy sequence is broken |
| Legacy backends removed | FAIL | Legacy classes/factory/types/settings remain active source |
| Admin deployment mode removed | PARTIAL | Visible selector removed; API/service/values remain |
| No direct Helm deployment | PARTIAL | New adapter does not; legacy direct/rendering code remains |
| Secrets remain in pipeline | PARTIAL | Adapter does not handle secrets; external target/repo defaults unsafe |
| Idempotency | FAIL | No request idempotency/dispatch reconciliation guard |
| Restart recovery | FAIL | New correlation/job fields unused; no startup reconciler |
| Existing history preserved | PASS | Existing table/legacy fields retained; no destructive migration |
| Regression tests | FAIL | Focused tests and full typecheck fail |
| E2E deployment | NOT RUN | No live credentials/test execution performed |

## Security/API Review

Authentication and basic persona authorization are present on deployment and
approval routes. Platform deployment creation is role-gated; approval actions
are Entra/group-gated; the portal service checks requester/approver inequality.
However, the separate approval row route does not enforce requester/approver
inequality and does not transition the actual deployment record. The GitHub
workflow dispatch endpoint is not exposed as a frontend-direct endpoint, but
retry/legacy pipeline routes remain and should be reviewed as part of legacy
removal.

## Failure Injection and Concurrency

No live failure injection or two-run GitHub concurrency test was run because no
safe configured GitHub execution environment was available. Static analysis
already demonstrates that ambiguous candidates fail closed, but unique
candidate selection is not sufficiently correlated to prove correctness.

## Required Follow-up Before E2E

1. Collapse the two approval models into one deployment request record and make
   the approval decision transition that record before dispatch.
2. Make scripts repository/workflow/ref explicit and fail closed if the scripts
   repository is not configured; remove CloudHub deployment-repository defaults.
3. Persist dispatch metadata, run attempt, correlation state, jobs, and log
   offsets; add restart reconciliation and idempotency handling.
4. Correlate runs using workflow/ref/input evidence or a durable reconciliation
   state; never accept a merely unique timestamp candidate as proof.
5. Connect GitHub job logs to the existing deployment event/SSE pipeline with
   incremental offsets.
6. Remove legacy backend classes, selector types/settings/routes, and stale
   tests, while retaining historical data display compatibility.
7. Update the wizard to consume instance metadata and stop expecting CloudHub
   Helmfile rendering.
8. Repair tests/typecheck, then run a safe real E2E deployment against the
   authorized development cluster only.

## Classification

**🔴 NOT READY**
