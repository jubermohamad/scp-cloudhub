# Deployment E2E Readiness

Date: 2026-09-09
Live AKS/GitHub E2E: **NOT RUN**

## Automated Validation

Passed:

* `yarn test:all`: 43 suites passed, 587 tests passed
* `yarn tsc:full` with zero errors
* `yarn lint:all`
* `yarn build:all`
* deployment-control-plane backend build
* platform-home build
* full deployment-control-plane suite: 15 suites passed, 194 tests passed,
  1 skipped
* full platform-home suite: 6 suites passed, 42 tests passed
* focused hardening suite: 63 tests passed before final legacy adapter removal;
  final full backend suite passed 194 tests
* `git diff --check`

Skipped:

* Full repository suite: 2 suites and 3 tests skipped
* Database cursor integration suite: 2 tests skipped because no Postgres test
   database was configured (`DATABASE_URL`, `POSTGRES_HOST`, or `PGHOST`).

The protected repositories were not modified:

* `SymphonyFS/scripts`: untouched
* `nrod-helm`: untouched

## Correlation Validation

The adapter now records repository, workflow, ref, exact inputs, dispatch
initiation timestamp, attempts, deadline, status, and correlation message before
dispatch. Candidate selection requires:

* workflow run creation at/after dispatch initiation
* matching ref when supplied
* appName/appInstance identity in the existing workflow run title/display title

One candidate is associated. Zero candidates remain `PENDING` and are retried
through deployment status polling/startup reconciliation. Multiple candidates
become `AMBIGUOUS` and are never guessed.

Automated tests cover:

* distinct concurrent applications/instances on the same ref
* identical inputs with multiple candidates, which fail closed
* initially invisible run
* wrong identity filtering through the candidate matcher

Limitation: the existing workflow contract does not expose a unique CloudHub
identifier. If two runs have identical ref, appName, appInstance, and workflow
inputs, safe correlation is impossible and the implementation intentionally
remains ambiguous.

## Restart Validation

Startup reconciliation scans persisted non-terminal deployments. Deployments
with known run IDs resume status/jobs/log processing. Deployments without run
IDs retry candidate lookup using persisted metadata and do not redispatch. A
bounded five-minute correlation deadline changes an unresolved record to
`FAILED` with a correlation-specific reason rather than starting another run.

A focused test covers a successful dispatch whose run is initially invisible,
followed by reconciliation that associates the original run while dispatch is
called exactly once.

## Log/SSE Validation

GitHub jobs are persisted by `(deployment_id, github_job_id)` with status,
conclusion, start/completion timestamps, and a line cursor. Log events include
both deployment ID and GitHub job ID. The existing deployment SSE endpoint
streams only that deployment's events and terminal status.

The implementation processes only lines after each job's persisted cursor.
SSE status polling closes on `SUCCEEDED`, `FAILED`, or `REJECTED`.

Dedicated router tests now cover reconnect, post-reconnect events, terminal
state, simultaneous deployment isolation, and reconnect isolation. The
database-backed cursor suite applies the real migration and verifies independent
cursors/restart deduplication, but it was skipped because no Postgres test
database was configured.

## Approval Validation

The wizard creates one deployment record in `PENDING_APPROVAL`. The same
record is approved/rejected through `/deployments/:id/approve|reject`.
Dispatch occurs only after `DeploymentPortalService.approve()` transitions the
record to `APPROVED`. Rejection is terminal and does not dispatch.

Focused tests cover pending no-dispatch, same-record approval dispatch, and
self-approval rejection.

## Repository Target

`ScriptsPipelineDeploymentService` requires:

```text
SYMPHONYFS_SCRIPTS_REPOSITORY=SymphonyFS/scripts
```

It rejects missing or incorrect values. The workflow is
`deploy-with-dynamic-runners.yml`, default ref is `main`, and the six existing
inputs are unchanged:

`appName`, `appInstance`, `configureSkupper`, `triggerFailover`,
`actionValidation`, `acceptance`.

No `cloudhubDeploymentId` exists in the external pipeline contract.

## Legacy Backend Validation

Active application deployment runtime no longer contains:

* `CloudHubNativeService`
* `SriProvisionalService`
* `DeploymentBackendFactory`
* `IDeploymentBackend`
* `DeploymentBackendSelector`
* CloudHub Helmfile renderer/Contents commit adapter
* SRI-specific application dispatch route

Remaining legacy database columns/comments/documentation are historical
compatibility data only.

The new application path consumes APP_LIST/instance metadata and dispatches
GitHub; it does not execute Helm, Helmfile, kubectl, or task.bash.

## E2E Readiness

**NOT READY**

All compilation, lint, package builds, full backend/frontend suites, approval,
correlation, retry, SSE, and repository-target checks pass. The remaining
blocking gate is execution of the database-backed per-job cursor tests; they
are implemented but skipped without a configured Postgres test database. No
live AKS or production deployment was attempted.

## Remaining Risks

1. GitHub run identity depends on the existing workflow run title/display title;
   identical concurrent inputs cannot be safely distinguished and are rejected.
2. Correlation deadline is five minutes and unresolved runs become failed
   correlation records; operators need a reconciliation/retry procedure that
   does not redispatch.
3. No real GitHub API, job log proxy, or AKS execution occurred.

## Recommendation

Do not run live AKS E2E yet. Provide a disposable Postgres test database and
rerun the skipped cursor suite. If it passes, rerun the final repository gates;
only then should one controlled E2E deployment be considered.
