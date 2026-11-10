# CloudHub Deployment Remediation Map

Date: 2026-09-09

## Current Flow

```text
SriDeploymentHubPage / SriDeployPage
  -> DeploymentWizard
  -> GET /deployments/options + GET /clusters/deployable
  -> POST /deployments/preview
  -> POST /deployments/approvals
  -> POST /deployments/approvals/:id/approve
  -> POST /deployments
  -> GET /deployments/:id/status + /events + /logs/stream
```

## Frontend

* `plugins/platform-home/src/components/DeploymentWizard.tsx` is the primary
  deployment action. It loads application options and deployable clusters,
  sends a preview request, creates an approval row, polls that approval row,
  and then submits a deployment request.
* `plugins/platform-home/src/components/SriDeploymentHubPage.tsx` and
  `SriDeployPage.tsx` open the same `DeploymentWizard` for SRI catalog cards.
  This preserves SRI navigation and metadata, but the wizard still describes
  and validates a generated Helmfile.
* `DeploymentHistory.tsx` and the wizard consume deployment status/events and
  the deployment SSE route. The frontend merges event IDs and polls status when
  SSE is unavailable.

## Backend

* `router.ts` exposes `/deployments/options`, `/deployments/preview`,
  `/deployments`, `/deployments/approvals`, approval decisions,
  `/deployments/:id/status`, `/deployments/:id/events`, and
  `/deployments/:id/logs/stream`.
* `ControlPlaneService.createDeploymentApproval()` creates a row in
  `control_plane_deployment_approvals` with a separate generated
  `deploymentId`. `decideDeploymentApproval()` changes only that approval row
  and writes an audit entry.
* `ControlPlaneService.createPortalDeployment()` delegates to
  `DeploymentPortalService.create()`, which persists
  `control_plane_portal_deployments` with `PENDING_APPROVAL` and no workflow run.
* `DeploymentPortalService.approve()` is a second approval implementation. It
  updates a portal deployment using compare-and-set, then invokes
  `ScriptsPipelineDeploymentService.dispatch()`.
* `ScriptsPipelineDeploymentService` changes the record to `DISPATCHING`, calls
  `GitHubActionsService.dispatch()`, stores the returned run ID in memory/portal
  persistence fields, and changes the record to `QUEUED` or `SUCCEEDED`.
* `GitHubActionsService` calls GitHub `workflow_dispatch`, then polls workflow
  runs because dispatch does not return a run ID. It currently filters by
  timestamp and branch only.
* `getStatus()` polls run-level status. `runStatus()` retrieves jobs in memory,
  but the portal service does not persist job rows. `runLogs()` is not connected
  to deployment SSE.
* `router.ts` SSE sends stored deployment events and run-level status snapshots.
  It does not emit incremental GitHub job log content.

## Exact Approval Divergence

The frontend calls:

```text
POST /deployments/approvals
POST /deployments/approvals/:approvalId/approve
POST /deployments
```

The approval decision invokes `ControlPlaneService.decideDeploymentApproval()`.
That method updates `control_plane_deployment_approvals` only. It does not call
`DeploymentPortalService.approve()` and does not dispatch GitHub.

The subsequent `/deployments` request creates a new portal deployment record.
Its `start` flag is ignored by the unified portal implementation, which always
creates `PENDING_APPROVAL`. Therefore the UI approval record and the executable
portal deployment record are disconnected, and approval never reaches the
orchestrator.

The authoritative remediation is to create one portal deployment record first,
attach one approval record or approval state to that same record, and make the
actual approval endpoint transition that same deployment to `APPROVED` before
calling the scripts pipeline adapter. The frontend must not create a second
record after approval.

## Divergences To Remediate

1. Two approval models instead of one authoritative deployment approval model.
2. GitHub repository default is CloudHub rather than explicitly configured
   `SymphonyFS/scripts`.
3. Correlation lacks workflow-input matching and durable correlation state.
4. Migration 008 job/correlation/log fields have no persistence consumers.
5. Frontend preview still expects generated Helmfile content and `releases:`.
6. SRI uses the same broken wizard approval sequence, so it is not executable.
7. No durable startup reconciliation or idempotent request key.
8. Legacy backend classes, selectors, routes, types, and tests remain.
9. Full typecheck is broken by stale status/type contracts and test fixtures.

## Target Remediation Flow

```text
DeploymentWizard / SRI catalog
  -> POST /deployments (create one record)
  -> PENDING_APPROVAL
  -> POST /deployments/:id/approve
  -> APPROVED
  -> ScriptsPipelineDeploymentService
  -> workflow_dispatch to SymphonyFS/scripts
  -> durable correlation/reconciliation
  -> persisted jobs and incremental logs
  -> deployment events/SSE
  -> DeploymentWizard console
```
