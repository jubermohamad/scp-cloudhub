# GPU Provisioning - Terraform Cloud Troubleshooting Guide

## Problem: "Repository doesn't exist or isn't accessible" (422 Error)

### Error Message
```
Failed to dispatch GPU provisioning workflow: Failed to create Terraform Cloud workspace (422):
{"errors":[{"status":"422","title":"invalid attribute","detail":"Repository doesn't exist or isn't accessible","source":{"pointer":"/data/attributes/repository"}}]}
```

### Root Cause
The Terraform Cloud OAuth token does not have access to the configured repository. This happens when:

1. **Repository not connected to VCS provider**: The GitHub repository is not registered with Terraform Cloud's VCS OAuth provider
2. **OAuth token insufficient permissions**: The token was created with limited permissions that don't include the repository
3. **Repository in different GitHub account**: The OAuth token was created for a different GitHub user/organization than the repository owner
4. **Repository is private**: The OAuth app hasn't been authorized to access private repositories

### Solution Steps

#### Option 1: Use an Organization Repository (Recommended)
Create or use an organization-level repository that's accessible to the Terraform Cloud OAuth token:

1. Create a repository under the organization: `sensa-cloud-platform/platform_cloudhub`
2. Set environment variable:
   ```bash
   export CLOUDHUB_TFC_REPOSITORY="sensa-cloud-platform/platform_cloudhub"
   ```

#### Option 2: Configure OAuth Token Permissions
1. Go to Terraform Cloud UI → Organization (`sensa-cloud-platform`)
2. Settings → VCS Providers
3. Find your GitHub connection and re-authenticate with an account that has access to `jubermohamad/platform_cloudhub`
4. Grant permission to private repositories if the repo is private

#### Option 3: Use GitHub Actions Environment Variables
When running in GitHub Actions, automatically use the current repository:

```yaml
env:
  CLOUDHUB_TFC_REPOSITORY: ${{ github.repository }}
  CLOUDHUB_TFC_BRANCH: ${{ github.ref_name }}
```

#### Option 4: Configure a Public Fork
If the private repository is the issue:

1. Create a public fork of `platform_cloudhub` in an accessible location
2. Set environment variable:
   ```bash
   export CLOUDHUB_TFC_REPOSITORY="<your-org>/platform_cloudhub"
   ```

### Environment Variables

Configure these to control Terraform Cloud integration:

```bash
# Repository identifier (format: owner/repo)
CLOUDHUB_TFC_REPOSITORY=jubermohamad/platform_cloudhub

# Branch to use for VCS linking
CLOUDHUB_TFC_BRANCH=main

# Working directory within the repository
CLOUDHUB_TFC_WORKING_DIRECTORY=infra/gpu-self-service

# Terraform Cloud API token (required)
CLOUDHUB_TFC_TOKEN=<your-token>

# VCS OAuth token ID for GitHub (required)
CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID=ot-<id>

# GitHub Actions token for committing tfvars (required)
GITHUB_ACTIONS_TOKEN=ghp_<token>
```

### Verification Checklist

- [ ] `CLOUDHUB_TFC_TOKEN` is set and valid
- [ ] `CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID` is set and valid
- [ ] `GITHUB_ACTIONS_TOKEN` is set and valid
- [ ] Repository exists at specified location
- [ ] OAuth token has access to the repository:
  ```bash
  curl -H "Authorization: Bearer $GITHUB_ACTIONS_TOKEN" \
    https://api.github.com/repos/owner/repo
  ```
- [ ] Repository is connected to Terraform Cloud VCS provider
- [ ] Working directory (`infra/gpu-self-service`) exists in the repository

### Testing the Configuration

1. **List available repositories** (if using OAuth token with list permissions):
   ```bash
   curl -H "Authorization: Bearer $CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID" \
     https://api.terraform.io/api/v2/organizations/sensa-cloud-platform/oauth-tokens
   ```

2. **Test workspace creation** (manual API call):
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $CLOUDHUB_TFC_TOKEN" \
     -H "Content-Type: application/vnd.api+json" \
     -d '{
       "data": {
         "type": "workspaces",
         "attributes": {
           "name": "test-gpu-workspace",
           "vcs-repo": {
             "identifier": "owner/repo",
             "branch": "main",
             "oauth-token-id": "'$CLOUDHUB_TFC_VCS_OAUTH_TOKEN_ID'"
           }
         }
       }
     }' \
     https://app.terraform.io/api/v2/organizations/sensa-cloud-platform/workspaces
   ```

3. **Check logs** for detailed error messages:
   ```bash
   grep "REPOSITORY ACCESS ISSUE" /var/log/cloudhub/*.log
   ```

### For Administrators

**To enable GPU provisioning across the organization:**

1. Create or grant access to an organization repository
2. Generate OAuth token in Terraform Cloud with sufficient GitHub permissions
3. Add GitHub token with repo write access
4. Set environment variables in deployment configuration
5. Run test GPU provisioning to verify

### See Also

- [Terraform Cloud VCS Integration](https://developer.hashicorp.com/terraform/cloud-docs/vcs)
- [Creating OAuth tokens](https://developer.hashicorp.com/terraform/cloud-docs/vcs/github#authentication)
- CloudHub Terraform Cloud validation: `docs/cloudhub-terraform-cloud-live-validation.md`
