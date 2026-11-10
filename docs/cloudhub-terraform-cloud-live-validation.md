# CloudHub Terraform Cloud live validation checklist

This runbook validates the live CloudHub Terraform Cloud integration end-to-end. It matches the implementation used by the backend: organization `sensa-cloud-platform`, repository `jubermohamad/platform_cloudhub`, branch `main`, working directory `infra/gpu-self-service`, and workspace naming pattern `cloudhub-gpu-<vmName>`.

Use `cloudhub-gpu-test` as the validation target for the live checks below.

---

## 0) Preconditions

Verify the runtime environment contains the required values before testing:

```bash
echo "$CLOUDHUB_TFC_TOKEN"
echo "$CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID"
echo "$GITHUB_ACTIONS_TOKEN"
echo "$CLOUDHUB_TFC_REPOSITORY"
echo "$CLOUDHUB_TFC_BRANCH"
echo "$CLOUDHUB_TFC_WORKING_DIRECTORY"
```

Expected:
- `CLOUDHUB_TFC_TOKEN` is set
- `CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID` is set
- `GITHUB_ACTIONS_TOKEN` is set
- `CLOUDHUB_TFC_REPOSITORY` is `jubermohamad/platform_cloudhub`
- `CLOUDHUB_TFC_BRANCH` is `main`
- `CLOUDHUB_TFC_WORKING_DIRECTORY` is `infra/gpu-self-service`

If any of these are missing, the backend will fall back to a simulated Terraform Cloud path instead of making live calls.

---

## 1) Verify GitHub tfvars commit succeeds

### Exact GitHub API checks

Check the file exists in the repo:

```bash
curl -sS \
  -H "Authorization: Bearer $GITHUB_ACTIONS_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/jubermohamad/platform_cloudhub/contents/infra/gpu-self-service/values/cloudhub-gpu-test.tfvars.json?ref=main"
```

If it exists and needs updating, the backend performs a PUT to the same path:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $GITHUB_ACTIONS_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -d '{
    "message":"chore(gpu-compute): request cloudhub-gpu-test",
    "content":"BASE64_ENCODED_TFVARS_JSON",
    "branch":"main",
    "committer":{"name":"CloudHub GPU Compute","email":"cloudhub-gpu-compute@symphony.ai"}
  }' \
  "https://api.github.com/repos/jubermohamad/platform_cloudhub/contents/infra/gpu-self-service/values/cloudhub-gpu-test.tfvars.json"
```

### GitHub UI check

Open:
- Repository: `jubermohamad/platform_cloudhub`
- Branch: `main`
- Path: `infra/gpu-self-service/values/cloudhub-gpu-test.tfvars.json`

Expected:
- File exists
- Latest commit message matches `chore(gpu-compute): request cloudhub-gpu-test`
- Commit is authored by the GitHub Actions token owner or an authorized automation identity

### Logs to validate

Check backend logs and errors for:
- `Failed to commit GPU tfvars (...)`
- `Terraform repo unavailable or tfvars path missing; falling back to simulated dispatch...`
- `simulated Terraform Cloud dispatch...`

Success means no commit error and no simulated fallback at this stage.

---

## 2) Verify Terraform Cloud workspace creation succeeds

### Exact API call

The backend creates the workspace with a POST to the Terraform Cloud API:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $CLOUDHUB_TFC_TOKEN" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "workspaces",
      "attributes": {
        "name": "cloudhub-gpu-test",
        "working-directory": "infra/gpu-self-service",
        "auto-apply": true,
        "trigger-patterns": [
          "infra/gpu-self-service/values/cloudhub-gpu-test.tfvars.json",
          "infra/gpu-self-service/main.tf"
        ],
        "vcs-repo": {
          "identifier": "jubermohamad/platform_cloudhub",
          "branch": "main",
          "oauth-token-id": "'$CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID'"
        }
      }
    }
  }' \
  "https://app.terraform.io/api/v2/organizations/sensa-cloud-platform/workspaces"
```

### Terraform Cloud UI check

Navigate to:
- Organization: `sensa-cloud-platform`
- Workspace: `cloudhub-gpu-test`

Expected:
- Workspace exists in the org
- VCS repo is `jubermohamad/platform_cloudhub`
- Branch is `main`
- Working directory is `infra/gpu-self-service`
- VCS provider is connected and authorized

### Logs to validate

Look for:
- `Failed to create Terraform Cloud workspace (...)`
- `Failed to look up Terraform Cloud workspace (...)`

Success means the workspace ID is returned and the workspace appears in the TFC UI.

---

## 3) Verify Terraform Cloud can access jubermohamad/platform_cloudhub through the configured VCS provider

### Exact API validation

Check that the workspace can be retrieved successfully:

```bash
curl -sS \
  -H "Authorization: Bearer $CLOUDHUB_TFC_TOKEN" \
  "https://app.terraform.io/api/v2/organizations/sensa-cloud-platform/workspaces/cloudhub-gpu-test"
```

Expected HTTP status: `200`

### Terraform Cloud UI check

In Terraform Cloud:
- Open `cloudhub-gpu-test`
- Go to `Settings` → `Version control`

Expected:
- VCS provider is connected
- Repository path is `jubermohamad/platform_cloudhub`
- Branch is `main`
- Working directory is `infra/gpu-self-service`
- OAuth token is the expected one from `CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID`

### Logs to validate

Look for permission or repo access errors:
- `Failed to create Terraform Cloud workspace`
- `Failed to look up Terraform Cloud workspace`
- `Terraform repo unavailable or tfvars path missing...`

If VCS access is broken, workspace creation or repo-linked run creation will fail even if GitHub itself is reachable.

---

## 4) Verify a workspace named cloudhub-gpu-test can be created

### Exact check

The code constructs the workspace name as:

```text
cloudhub-gpu-test
```

and looks up the workspace with:

```bash
curl -sS \
  -H "Authorization: Bearer $CLOUDHUB_TFC_TOKEN" \
  "https://app.terraform.io/api/v2/organizations/sensa-cloud-platform/workspaces/cloudhub-gpu-test"
```

Expected:
- HTTP 200 if it exists
- HTTP 404 if it does not exist yet

### Terraform Cloud UI check

Check the organization workspace list for:
- `cloudhub-gpu-test`
- No duplicate or older legacy naming such as `gpu-...`

### Logs to validate

Look for:
- workspace name output in the backend logs
- any workspace-not-found or duplicate-name errors

Success means the workspace exists exactly under the CloudHub-first naming convention.

---

## 5) Verify a Terraform run can be queued

### Exact TFC API calls

The backend polls the current run after the tfvars commit:

```bash
curl -sS \
  -H "Authorization: Bearer $CLOUDHUB_TFC_TOKEN" \
  "https://app.terraform.io/api/v2/workspaces/<workspace_id>?include=current_run"
```

It creates a run with:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $CLOUDHUB_TFC_TOKEN" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "runs",
      "attributes": {
        "is-destroy": false,
        "message": "CloudHub GPU VM apply (request req-1)"
      },
      "relationships": {
        "workspace": { "data": { "type": "workspaces", "id": "<workspace_id>" } }
      }
    }
  }' \
  "https://app.terraform.io/api/v2/runs"
```

### Terraform Cloud UI check

Open the workspace and go to `Runs`:
- A new run appears
- Status moves from `pending` or `queued` to `planning`
- Message matches the request context

### Logs to validate

Look for:
- `Terraform Cloud run was not discovered yet; check the workspace in a few seconds`
- `Failed to create Terraform Cloud run (...)`

Success means the workspace has at least one run in progress or queued.

---

## 6) Verify Terraform plan completes successfully

### Terraform Cloud UI check

In the run details:
- Open `Plan`
- Confirm the status becomes `planned`
- Check there are no validation errors
- Ensure the tfvars file is read successfully
- Confirm the backend processes the selected var file

The workspace is configured with:

```text
TF_CLI_ARGS = -var-file=values/cloudhub-gpu-test.tfvars.json
```

This ensures Terraform reads the generated instance tfvars file from the repository checkout.

### Logs to validate

Look for run log output such as:
- `Initializing the backend`
- `Terraform used the selected providers`
- `Plan: X to add, Y to change, Z to destroy`

Expected:
- No missing-file errors
- No required-variable errors
- No permission or auth errors
- Run reaches a successful planned state

---

## 7) Verify Terraform apply completes successfully

### Terraform Cloud UI check

In the same run details:
- Confirm the run proceeds from plan to apply
- Final status shows `Applied`
- Final result is success
- Resources are created or updated as expected

### Logs to validate

Look for final messages in the run log:
- `Apply complete! Resources: ...`
- `Plan was successful`
- `Apply complete`

Expected:
- The GPU infrastructure defined by `cloudhub-gpu-test.tfvars.json` is provisioned successfully
- No failure in authentication, VCS access, or Terraform validation

---

## Success criteria summary

The integration is considered valid only when all of the following are true:

1. GitHub file commit succeeds for `infra/gpu-self-service/values/cloudhub-gpu-test.tfvars.json`
2. TFC workspace `cloudhub-gpu-test` exists and is linked to `jubermohamad/platform_cloudhub`
3. The workspace is linked to the correct VCS branch and working directory
4. A TFC run is queued and appears in the workspace run history
5. The plan phase succeeds without missing vars or file-path errors
6. The apply phase succeeds and the infrastructure is created

---

## Common failure patterns

Watch for these symptoms:
- `403` from GitHub on file create/update: usually a token permission or repository access issue
- `404` for workspace creation or repo lookup: typically a missing VCS connection or invalid repo identifier
- `Not Found` on tfvars path: repo path or branch mismatch
- workspace is created but no run starts: trigger pattern or repo access mismatch
- plan fails: bad tfvars file content, missing variable file, or invalid module inputs
- apply fails: provider auth, Azure RBAC, or Terraform resource validation issues

---

## Suggested validation order

Run the validation in this order:

1. Verify GitHub token access and file commit
2. Verify TFC workspace creation
3. Verify VCS repo linkage
4. Confirm `cloudhub-gpu-test` exists
5. Confirm run queued
6. Confirm plan success
7. Confirm apply success

This order mirrors the actual backend logic and makes failures easier to localize.
