# CloudHub Deployment E2E Preflight

Date: 2026-09-09
Scope: read-only validation only
Live deployment: **NOT RUN**
Workflow dispatch: **NOT RUN**
Helm/kubectl/context changes: **NOT RUN**

## Database

**FAIL**

No PostgreSQL connection configuration is present in the current environment:

* `DATABASE_URL`: unset
* `POSTGRES_HOST` / `PGHOST`: unset
* `POSTGRES_DB` / `PGDATABASE`: unset
* `POSTGRES_USER` / `PGUSER`: unset
* `psql`: unavailable

PostgreSQL reachability and active deployment inspection could not be performed.

Required configuration: provide a disposable or approved CloudHub PostgreSQL
connection for preflight testing without printing credentials.

## Migrations

**FAIL / UNVERIFIED**

Migration file `plugins/deployment-control-plane-backend/migrations/008_scripts_pipeline_deployment.sql`
exists and defines the workflow correlation/job tables and columns. However, no
PostgreSQL connection is configured, so the database cannot confirm that:

* base CloudHub schema is applied
* migration 008 is applied
* job cursor columns/table exist
* deployment reconciliation indexes exist

The runtime control-plane schema initializer also contains the corresponding
idempotent structures, but that is not proof that a target database has been
initialized.

Required configuration: connect to the intended CloudHub database, initialize
or migrate it, then rerun this preflight.

## Job Cursor Integration Tests

**FAIL / SKIPPED**

Command executed:

```text
CI=1 yarn workspace @internal/plugin-deployment-control-plane-backend test -- deploymentJobCursor.integration.test.ts --runInBand
```

Result: 2 tests skipped because no `DATABASE_URL`, `POSTGRES_HOST`, or `PGHOST`
was configured.

Required configuration: provide the PostgreSQL test connection, then rerun the
suite and require both cursor persistence/reload tests to pass.

## GitHub Configuration

**FAIL**

Read-only GitHub access is available:

* `SymphonyFS/scripts` repository API: HTTP 200
* `deploy-with-dynamic-runners.yml` workflow API: HTTP 200
* Repository permission metadata reports `pull`, `push`, `triage`, `maintain`,
  and `admin` as available for the current credential

However, the required deployment configuration is missing:

* `SYMPHONYFS_SCRIPTS_REPOSITORY`: unset
* `SYMPHONYFS_WORKFLOW_ID`: unset
* `SYMPHONYFS_WORKFLOW_REF`: unset

The adapter intentionally fails closed without
`SYMPHONYFS_SCRIPTS_REPOSITORY=SymphonyFS/scripts`.

Required configuration:

```text
SYMPHONYFS_SCRIPTS_REPOSITORY=SymphonyFS/scripts
SYMPHONYFS_WORKFLOW_ID=deploy-with-dynamic-runners.yml
SYMPHONYFS_WORKFLOW_REF=main
```

The GitHub credential must remain supplied through the deployment environment,
not committed to files or printed in logs.

## Platform Registry

**FAIL / UNVERIFIED**

No PostgreSQL connection is available to inspect CloudHub's registered cluster
inventory. No AKS discovery or kubectl command was run, by design.

The intended cluster `aks-scp-dev-sdc-st-cms` must be present and CloudHub-
eligible in the Platform Registry before the E2E request is created.

Required configuration: provide the CloudHub database and verify the cluster
exists in the registered/eligible cluster table. Do not substitute direct AKS
discovery or an arbitrary kube context.

## APP_LIST

**PASS**

The authoritative `task.bash` is retrieved through the GitHub Contents API from
`SymphonyFS/scripts`; CloudHub no longer requires a local scripts checkout at
runtime. It contains exactly 18 applications. The local protected checkout was
used only for preflight comparison and was not modified:

```text
ai-store
common-res
edb-common-res
datadog
dxv
detectionhub
flows
invhub
netreveal
netrevealv95
netrevealv96
edb-netrevealv96
sales-genie
sensaai-sanctions
tailscale
velero
istio-service-entry
hybrid-manager
```

## Application Instance

**PASS** for the selected candidate.

Selected candidate:

```text
application: detectionhub
instance: dt-absa-dev
source: SymphonyFS/scripts/apps/detectionhub/dt-absa-dev/helmfile.yaml
```

The file exists in the protected scripts checkout. In the deployed runtime,
instance metadata is retrieved through the GitHub Contents API rather than a
local filesystem path. The application is present in APP_LIST.

## RBAC

**FAIL / UNVERIFIED**

The code contains the required role gates and requester/approver separation:

* requester requires the platform deployment role
* approver requires the CloudHub platform-admin approval group or configured
  platform override
* requester and approver must differ for the authoritative portal approval
  path

Actual identity authorization cannot be verified in this environment because
there is no authenticated CloudHub request context or database-backed test
configuration. The preflight must use two real identities:

```text
requester: authorized to create deployments
approver: authorized for GRP-CloudHub-PlatformAdmin
requester != approver
```

## Deployment Environment

**FAIL**

The environment is not ready for live E2E because:

1. PostgreSQL is not configured or reachable.
2. Migration 008 cannot be confirmed.
3. Job cursor integration tests are skipped.
4. `SYMPHONYFS_SCRIPTS_REPOSITORY` is unset.
5. Legacy variables are explicitly set in `.env`:
   `SRI_PIPELINE_REPO=jubermohamad/platform_cloudhub` and
   `GITHUB_ACTIONS_REPO=jubermohamad/platform_cloudhub`.
6. Platform Registry cluster presence cannot be verified.
7. Active/recovery deployments cannot be inspected.
8. Real requester/approver identities cannot be validated.

The legacy variables must not be used for application deployment targeting. The
scripts repository variable must be configured explicitly in the deployment
environment. Do not modify configuration automatically during preflight.

## E2E Readiness

**NOT READY**

### Required before live E2E

* Configure an approved CloudHub PostgreSQL connection.
* Apply/verify all CloudHub migrations, including migration 008.
* Run and pass the two database-backed job cursor tests.
* Configure `SYMPHONYFS_SCRIPTS_REPOSITORY=SymphonyFS/scripts`.
* Configure the workflow ID/ref explicitly.
* Remove or override legacy deployment-target variables so they cannot select
  `jubermohamad/platform_cloudhub` for application deployment.
* Verify `aks-scp-dev-sdc-st-cms` is registered and eligible in Platform Registry.
* Verify one real authorized requester and a different authorized approver.
* Verify no non-terminal/recovery deployment can interfere with the test.
* Rerun this preflight and require every section to pass.

No deployment, workflow dispatch, Helm command, kubectl command, context switch,
or external repository modification was performed.
