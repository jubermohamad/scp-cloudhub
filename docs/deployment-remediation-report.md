# CloudHub Deployment Remediation Report

Date: 2026-09-09
Scope: `/home/juberm/git-all/platform_cloudhub` only
Live AKS/GitHub E2E: **NOT RUN**

## Overall Result

**NOT READY FOR E2E**.

The approval path, scripts workflow target, frontend Helmfile assumptions,
legacy active paths, idempotency, typecheck, builds, and focused/full package
tests were remediated. Durable job/log persistence and startup reconciliation
are now wired. Two important risks remain before a live deployment: GitHub run
correlation still needs a real API-level concurrency test and its input identity
matching depends on the workflow run title format; no live failure-injection or
E2E test was run.

## Findings Fixed

1. The wizard now creates one portal deployment record at `/deployments`, and
   approval/rejection compatibility routes operate on that same deployment ID.
   Approval invokes `DeploymentPortalService.approve()` and then the scripts
   adapter. The wizard no longer creates a separate approval row followed by a
   second deployment record.
2. Dispatch requires `SYMPHONYFS_SCRIPTS_REPOSITORY=SymphonyFS/scripts` and
   uses `deploy-with-dynamic-runners.yml`, `main` by default, and the exact six
   existing workflow inputs. Missing or incorrect repository configuration
   fails closed.
3. CloudHub no longer renders Helmfiles in the new flow. The review panel shows
   selected application-instance metadata and explains that scripts owns
   rendering, values, secrets, and Kubernetes execution.
4. The SRI-specific `/pipelines/sri/deploy` dispatch route and service method
   were removed. SRI catalog cards continue to enter the shared wizard.
5. Portal deployment records now persist workflow repository, workflow ID/ref,
   exact inputs, dispatch timestamp, correlation status/message, workflow status
   and conclusion, and log offset fields. The runtime schema creates the job
   table and additive columns.
6. GitHub jobs are upserted by deployment/job ID during status reconciliation,
   and unseen log lines are emitted as deployment events through the existing SSE
   path with a per-deployment offset.
7. A startup reconciliation pass checks persisted non-terminal deployments and
   updates known workflow runs without dispatching again.
8. Repeated requests with the same internal deployment request ID return the
   existing same request; conflicting reuse returns `409`.
9. Retry now requires a previously approved failed deployment, so retry cannot
   bypass approval.
10. Removed active legacy backend services/factory/interface, deployment-mode
    selector UI/API/service, obsolete SRI pipeline authorization, CloudHub
    Helmfile renderer, and tests that encoded the retired architecture.
11. Full TypeScript errors were fixed without compiler weakening or broad
    suppressions.

## Key Files Changed

* `plugins/platform-home/src/components/DeploymentWizard.tsx`
* `plugins/platform-home/src/components/AdminSettingsPage.tsx`
* `plugins/deployment-control-plane-backend/src/router.ts`
* `plugins/deployment-control-plane-backend/src/types.ts`
* `plugins/deployment-control-plane-backend/src/services/deploymentPortalService.ts`
* `plugins/deployment-control-plane-backend/src/services/scriptsPipelineDeploymentService.ts`
* `plugins/deployment-control-plane-backend/src/services/scriptsApplicationCatalogService.ts`
* `plugins/deployment-control-plane-backend/src/services/githubActionsService.ts`
* `plugins/deployment-control-plane-backend/src/services/controlPlaneService.ts`
* `plugins/deployment-control-plane-backend/src/rbac.ts`
* `plugins/deployment-control-plane-backend/migrations/008_scripts_pipeline_deployment.sql`
* focused tests under `plugins/deployment-control-plane-backend/src/__tests__`
* deleted legacy backend/selector/renderer files and their obsolete tests

## Tests and Checks

Passed:

* `yarn tsc:full`
* deployment-control-plane backend build
* platform-home build
* focused backend suite: 5 suites, 59 tests passed
* full deployment-control-plane suite: 16 suites passed, 193 tests passed, 1
  test skipped
* full platform-home suite: 6 suites, 42 tests passed
* `git diff --check` before the final reconciliation edit

The final reconciliation edit still requires the focused build/typecheck check
before merge; no live E2E was run.

## Repository Boundary

`SymphonyFS/scripts` was not modified. `nrod-helm` was not modified. No
`cloudhubDeploymentId` was introduced into the workflow contract, dispatch
payload, environment, or scripts integration. CloudHub's internal deployment
ID remains internal.

## Remaining Risks / Blockers

1. GitHub run correlation is fail-closed for multiple candidates and matches
   app/instance identity from the GitHub run title, but it has not been tested
   against two real concurrent workflow runs, delayed appearance, wrong ref,
   or a changed upstream run-name format.
2. A dispatch that succeeds but has no candidate after the bounded adapter poll
   currently needs a durable retry/reconciliation entry path; the record has
   correlation metadata, but no separate background scheduler retries missing
   run IDs yet.
3. Incremental logs currently use the merged `runLogs()` output offset, not
   GitHub job-specific offsets. Job IDs are persisted, but per-job log offset
   persistence and reconnect-specific tests remain incomplete.
4. No real GitHub dispatch, workflow run, job, log, or AKS deployment was
   executed. Credentials and a safe deployment target were intentionally not
   used in this phase.
5. Full lint and the entire monorepo regression suite were not run in this
   phase. Unrelated CloudHub features require their normal regression gates.

## Final Static Review

* Approval before dispatch: **PASS** for the unified portal path.
* One deployment record: **PASS** for wizard/API flow.
* Scripts repository target: **PASS**, explicit fail-closed configuration.
* Existing six-input workflow contract: **PASS**.
* No CloudHub Helmfile generation in new flow: **PASS**.
* APP_LIST authority: **PASS**.
* Platform Registry target validation: **PASS**.
* SRI shared deployment entry: **PASS**.
* Job persistence and event log connection: **PASS**, with per-job offset gap.
* Startup reconciliation: **PASS** for known run IDs; missing-run retry remains.
* Idempotency: **PASS** for supplied internal request IDs; broader semantic
  duplicate detection remains limited.
* Legacy active application backends/selectors: **PASS** after cleanup.
* Typecheck/build/focused/full package suites: **PASS**.
* Live E2E: **NOT RUN**.

## Recommendation

Do not execute live AKS E2E yet. First add deterministic mocked correlation and
per-job incremental-log tests, implement retry of persisted `DISPATCHING` /
uncorrelated records without redispatch, run lint and the complete monorepo
regression suite, then perform one controlled E2E deployment only after all
checks pass.
