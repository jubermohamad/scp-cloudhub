# End-to-End Deployment Flow

## Current Verified Flow

1. The user opens CloudHub and starts the Deploy Wizard.
2. The user selects an application, instance name, customer, and target AKS cluster.
3. CloudHub dispatches `onepassword-readiness.yml` to the secure runner for a read-only 1Password readiness check and polls the workflow result.
4. If required values are missing, the user can select **Create & Populate 1Password Section**.
5. CloudHub dispatches the separate `copy-1password-section.yml` workflow.
6. That workflow uses the write-enabled GitHub secret configured by `CLOUDHUB_1PASSWORD_WRITE_SECRET_NAME` to create or populate the customer item and generate secret values.
7. CloudHub polls the provisioning run and re-checks readiness.
8. The user generates and reviews the deployment definition. The current wizard also supports an optional Run Diff step.
9. The user sends the saved deployment for approval.
10. An authorized approver approves or rejects it. Self-approval is blocked unless explicitly enabled.
11. After approval, CloudHub dispatches the application deployment workflow and tracks its GitHub Actions run.

## Separate Responsibilities

| Responsibility                 | Actual implementation                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| 1Password create and populate  | `copy-1password-section.yml`, dispatched by the deployment backend                           |
| 1Password readiness validation | `onepassword-readiness.yml`, dispatched and polled by the deployment backend                 |
| Application deployment         | `deploy-helmfile.yml`, dispatched by the deployment backend                                  |
| App discovery                  | GitHub Contents API; `task.bash` is optional and `apps/` directory discovery is the fallback |
| Approval gate                  | Deployment Control Plane approval endpoints and RBAC                                         |
| Status and logs                | GitHub Actions run correlation, polling, job status, and deployment events                   |

The 1Password create-and-populate action only prepares secret data. It does not deploy the application.

## Actual Application Deployment

The default backend contract is:

- Repository: `SYMPHONYFS_SCRIPTS_REPOSITORY`, defaulting to `jubermohamad/platform_cloudhub`
- Workflow: `SYMPHONYFS_WORKFLOW_ID`, defaulting to `deploy-helmfile.yml`
- Ref: `SYMPHONYFS_WORKFLOW_REF`, defaulting to `main`
- Inputs for the active workflow: `app_name` and `instance_name`

The workflow checks out the repository, resolves `apps/<app>/<instance>/helmfile.yaml`, authenticates to AKS, and executes Helm deployment commands on the runner. The active workflow does not execute `task.bash`; it performs direct Helm deployment.

## Secret Resolution

The readiness gate scans references on the secure runner and uses `op whoami`, `op item get`, and `op read` only. The runner returns a sanitized readiness report containing statuses and references, never secret values. The CloudHub backend does not require the `op` binary. The provisioning workflow writes generated values to 1Password. During deployment, `deploy-helmfile.yml` scans the instance directory for `op://` references. When references are present, it installs the pinned 1Password CLI, authenticates with the read-only token from the `CLOUDHUB_1PASSWORD_READ` GitHub secret by default, resolves `values.generated.yaml`, and passes the resolved file to Helm.

Instances without `op://` references continue through the existing values path and Key Vault integration. The write-enabled provisioning token and read-only deployment token remain separate credentials.

The write-enabled provisioning workflow and the later application deployment remain intentionally separate.

## Changes Validated

- Missing `task.bash` no longer causes app discovery to fail with a 404.
- Validate 1Password dispatches to `onepassword-readiness.yml` and polls the secure runner result.
- Backend readiness no longer invokes a local `op` binary or returns secret values to the browser.
- App discovery falls back to valid `apps/<appName>/<appInstance>` directories.
- A repository with neither a usable `task.bash` nor a valid `apps/` catalog fails with an actionable error.
- Approved deployment dispatch now defaults to `deploy-helmfile.yml` and uses its `app_name` / `instance_name` input contract.
- Local `.env` deployment workflow configuration now points to `deploy-helmfile.yml` instead of the CloudHub image deployment workflow.
- The 1Password provisioning workflow was not changed.
