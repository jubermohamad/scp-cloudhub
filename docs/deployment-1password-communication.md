# CloudHub Deployment: 1Password Communication Contract

This document defines how CloudHub communicates with 1Password during
application deployments.

## Scope

- Applies to deployment readiness checks for apps such as `invhub`, `flows`,
  `netreveal`, and `dxv`.
- Secrets are read from 1Password only.
- Readiness checks remain read-only.
- Secret create/populate is handled by a secure runner workflow that writes to 1Password.
- Azure Key Vault is not used as a deployment-readiness source or fallback.

## Source of Truth

CloudHub validates references against the customer-scoped 1Password layout:

- Vault: `Customers`
- Item: `<customer>` (for example `sri`, `visa`, `bbk`)
- Runtime section: `<app>-<instance>` (for example `invhub-juber18`)
- Pipeline section: `pipeline_refs`

Reference format:

```text
ref+op://Customers/<customer>/<section>/<field>
```

## Authentication Model

CloudHub backend uses the 1Password CLI in read-only mode.

- Required authentication:
  - `OP_SERVICE_ACCOUNT_TOKEN` (preferred), or
  - 1Password Connect with `OP_CONNECT_HOST` + `OP_CONNECT_TOKEN`
- Preflight checks:
  - `op --version`
  - `op whoami --format json`
- If neither auth mode is configured, readiness fails and deployment is blocked.

## Read-Only Enforcement

Readiness checks allow only read-only 1Password commands:

- `op --version`
- `op whoami --format json`
- `op item get <item> --vault <vault> --format json`
- `op read op://...`

Any other 1Password command is rejected by the backend service.

## Secret Provisioning (Screen 1)

When readiness is blocked on Step 1 (Deployment details), CloudHub exposes:

- `Create & Populate 1Password Section`

Behavior:

1. CloudHub triggers a secure-runner workflow in this repository (`platform_cloudhub`) by default.
2. The runner creates/updates the required section from the official template.
3. The runner generates cryptographically strong random passwords for required
  secret fields.
4. The runner writes values into 1Password using write-enabled credentials on
  the runner.
5. CloudHub polls workflow status and re-runs readiness on completion.

Default repository/workflow routing:

- Repository: `jubermohamad/platform_cloudhub`
- Workflow: `copy-1password-section.yml`
- Ref: `main` (or current `GITHUB_REF_NAME` when set)

Optional overrides:

- `CLOUDHUB_1PASSWORD_WORKFLOW_REPOSITORY` (owner/repo)
- `CLOUDHUB_1PASSWORD_WORKFLOW_ID`
- `CLOUDHUB_1PASSWORD_WORKFLOW_REF`

Important separation:

- Secret provisioning does not inherit deployment repository variables such as
  `SRI_PIPELINE_REPO` or `GITHUB_ACTIONS_REPO`.
- Deployment and diff continue to use `SYMPHONYFS_SCRIPTS_REPOSITORY`
  (expected: `SymphonyFS/scripts`).

CloudHub never returns generated plaintext passwords to the browser.

Runner workflow token binding (CloudHub workflow repo):

```yaml
env:
  # Write-enabled service account token. Use only for section
  # create/populate and random password generation.
  OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets[inputs.opServiceAccountTokenSecretName] }}

steps:
  - name: Fail fast when token is missing
    run: |
      if [ -z "${OP_SERVICE_ACCOUNT_TOKEN}" ]; then
        echo "OP_SERVICE_ACCOUNT_TOKEN is not set for provisioning workflow"
        exit 1
      fi
```

CloudHub sends `opServiceAccountTokenSecretName` with default value
`CLOUDHUB_GITHUB_RUNNER_WRITE`.

This write-enabled token is never used by the backend readiness checker.
Bind this token only at the provisioning job scope, not globally across all jobs.

## Validation Rules

Before deployment approval/retry, CloudHub validates:

1. 1Password connection is available and authenticated.
2. Referenced section exists.
3. Referenced field exists.
4. Resolved value is non-empty.
5. Resolved value is not `UPDATE_ME` (or `UPDATE_ME_*`).
6. File-level placeholders (`UPDATE_ME*`) are absent in scanned files.

If any check fails, deployment is blocked.

## What Is Scanned

CloudHub scans deployment files for both:

- Legacy direct refs: `ref+op://...` and `op://...`
- Env-based refs: `{{ env "CLOUDHUB_*" }}` and
  `{{ requiredEnv "CLOUDHUB_*" }}`

Env-based refs are mapped to 1Password as follows:

- Pipeline control keys (`*_version`, `*_branch`, `*_ref`) ->
  `pipeline_refs/<namespace>__<field>`
- Runtime keys -> `<app>-<instance>/<field>`

`<namespace>` follows deployment namespace semantics:

- If `instanceName` already starts with `<app>-`, use `instanceName`.
- Else use `<app>-<instanceName>`.

## API Gate Integration

Endpoint:

- `POST /api/deployment-control-plane/deployments/secret-readiness`
- `POST /api/deployment-control-plane/deployments/secret-provision`
- `GET /api/deployment-control-plane/deployments/secret-provision/:operationId`

Required request fields:

- `application`
- `instanceName`
- `customer`

The deployment wizard calls this endpoint in Step 1 and Step 2. Backend also
enforces the gate during deployment approval and retry, so bypass attempts are
blocked server-side.

Screen 1 behavior (Deployment details):

- After Instance Name + Customer + Target Cluster are present and the resolved
  configuration is available, CloudHub auto-runs 1Password readiness.
- The readiness section is mandatory and blocks progress when not ready.
- If readiness is blocked, CloudHub can trigger secure-runner create/populate
  and then automatically re-check readiness.
- `Next` stays disabled until readiness is green.

Approval behavior:

- CloudHub re-validates readiness before approval/deploy/retry.
- `Send For Approval` and approver `Deploy` remain blocked when readiness is
  invalid.
- If blocked, CloudHub shows an actionable list of missing/empty/placeholder
  references.

## Wizard Diff Action

CloudHub wizard Step 2 now exposes an explicit `Run Diff` action.

- Current behavior: runs the rendered deployment preview flow and refreshes
  1Password readiness evidence before approval.
- Purpose: give users a clear pre-deploy review step aligned with deployment
  runbook terminology.
- Guardrails unchanged: approval/deploy remains blocked if 1Password readiness
  is not green.

## Security Notes

- Do not log secret values.
- Do not persist secret values in DB records.
- Only return readiness/provisioning metadata (status, field paths, run IDs,
  failure reasons).
- Do not add any Key Vault fallback path for deployment readiness.
- Keep token split strict:
  - Readiness path: backend read-only identity (`OP_SERVICE_ACCOUNT_TOKEN` or
    Connect credentials configured for read checks).
  - Provisioning path: runner-only write-enabled secret
    (`CLOUDHUB_GITHUB_RUNNER_WRITE` by default).
