# GitHub Repository Provisioning

This document describes the self-service GitHub repository creation feature in
CloudHub. The feature extends the existing **Engineering Tools → GitHub** page
so authorized users can create repositories in the `SymphonySensa` GitHub
organization without needing Organization Owner permissions.

---

## Table of Contents

1. [Architecture](#architecture)
2. [GitHub App Setup](#github-app-setup)
3. [Entra Group Configuration](#entra-group-configuration)
4. [Configuration](#configuration)
5. [API Contracts](#api-contracts)
6. [Audit Database Schema](#audit-database-schema)
7. [Repository Governance](#repository-governance)
8. [Troubleshooting](#troubleshooting)
9. [Operational Runbook](#operational-runbook)

---

## Architecture

```mermaid
sequenceDiagram
    actor User
    participant EngTools as Engineering Tools → GitHub
    participant Backend as deployment-control-plane backend
    participant AuthZ as GitHubAuthorizationService
    participant AppSvc as GitHubAppService
    participant RepoSvc as GitHubRepositoryService
    participant GitHub as GitHub API (App installation)
    participant DB as PostgreSQL

    User->>EngTools: Select "Repository Creation"
    EngTools->>Backend: GET /api/github/authorization
    Backend->>AuthZ: Check Entra group membership
    AuthZ-->>EngTools: authorized / enabled
    EngTools->>Backend: GET /api/github/teams
    EngTools->>Backend: GET /api/github/templates
    Backend->>AppSvc: Authenticate GitHub App
    AppSvc->>GitHub: Installation token
    GitHub-->>Backend: Teams / templates
    EngTools-->>User: Render form with teams & templates
    User->>EngTools: Submit repository details
    EngTools->>Backend: POST /api/github/repositories
    Backend->>AuthZ: Verify authorization
    Backend->>RepoSvc: Create repository
    RepoSvc->>AppSvc: Authenticated Octokit client
    RepoSvc->>GitHub: Create repository / assign team / protect branch / CODEOWNERS / Dependabot
    RepoSvc->>DB: Write audit record
    GitHub-->>RepoSvc: Repository URL
    RepoSvc-->>Backend: Result
    Backend-->>EngTools: Success + repository URL
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Frontend form | [plugins/platform-home/src/components/GitHubToolForm.tsx](../plugins/platform-home/src/components/GitHubToolForm.tsx) | Repository creation UI |
| Engineering Tools hub | [plugins/platform-home/src/components/EngToolsPage.tsx](../plugins/platform-home/src/components/EngToolsPage.tsx) | Existing tool wrapper |
| GitHub App service | [plugins/deployment-control-plane-backend/src/services/githubAppService.ts](../plugins/deployment-control-plane-backend/src/services/githubAppService.ts) | GitHub App authentication |
| Authorization service | [plugins/deployment-control-plane-backend/src/services/githubAuthorizationService.ts](../plugins/deployment-control-plane-backend/src/services/githubAuthorizationService.ts) | Entra group authorization |
| Repository service | [plugins/deployment-control-plane-backend/src/services/githubRepositoryService.ts](../plugins/deployment-control-plane-backend/src/services/githubRepositoryService.ts) | Repository lifecycle & governance |
| API routes | [plugins/deployment-control-plane-backend/src/router.ts](../plugins/deployment-control-plane-backend/src/router.ts) | REST endpoints |
| Database schema | [plugins/deployment-control-plane-backend/migrations/007_github_repository_requests.sql](../plugins/deployment-control-plane-backend/migrations/007_github_repository_requests.sql) | Audit table |

---

## GitHub App Setup

Repository creation uses a GitHub App installed into the `SymphonySensa`
organization. No Personal Access Tokens (PATs), OAuth user tokens, GitHub
Actions tokens, or personal credentials are used.

### Required Repository Permissions

| Permission | Level |
|------------|-------|
| Administration | Read & Write |
| Contents | Read & Write |
| Metadata | Read |
| Pull Requests | Read & Write |

### Required Organization Permissions

| Permission | Level |
|------------|-------|
| Members | Read |

### Environment Variables

```bash
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=78901234
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

In production, `GITHUB_APP_PRIVATE_KEY` should be sourced from Azure Key Vault
and injected as an environment variable or a Kubernetes secret.

### Why a GitHub App?

- End users do **not** need Organization Owner permissions.
- The App acts on behalf of the installation, not an individual user.
- Access is revocable by uninstalling the App or rotating the private key.
- Actions are auditable through the App's installation logs.

---

## Entra Group Configuration

Authorization is enforced through Microsoft Entra ID groups. The authorized
group name is externalized in configuration and is never hardcoded.

### Default Group

```text
CloudHub-GitHub-RepoCreators
```

Users who are not members of the configured group can view the page but cannot
submit repository creation requests. The **Create Repository** button is
disabled and a message is shown:

```text
You are not authorized to create GitHub repositories.
```

### How Membership Is Resolved

1. Backstage identity token claims are checked first.
2. If inconclusive, Microsoft Graph `checkMemberGroups` is used as a fallback
   (enabled via `GITHUB_REPO_PROVISIONING_GRAPH_ENABLED=true`).
3. The check uses the canonical `AZURE_*` platform service principal, which must
  have `GroupMember.Read.All` and `User.Read.All`.

---

## Configuration

Configuration lives in the Backstage `github` config key.

### Base configuration (app-config.yaml)

```yaml
github:
  organization: ${GITHUB_ORGANIZATION:-SymphonySensa}
  app:
    appId: ${GITHUB_APP_ID:-}
    installationId: ${GITHUB_INSTALLATION_ID:-}
    privateKey: ${GITHUB_APP_PRIVATE_KEY:-}
  repositoryProvisioning:
    enabled: ${GITHUB_REPO_PROVISIONING_ENABLED:-false}
    authorizedGroups:
      - ${GITHUB_REPO_PROVISIONING_GROUP:-CloudHub-GitHub-RepoCreators}
```

### Production configuration (app-config.production.yaml)

```yaml
github:
  organization: ${GITHUB_ORGANIZATION:-SymphonySensa}
  app:
    appId: ${GITHUB_APP_ID}
    installationId: ${GITHUB_INSTALLATION_ID}
    privateKey: ${GITHUB_APP_PRIVATE_KEY}
  repositoryProvisioning:
    enabled: ${GITHUB_REPO_PROVISIONING_ENABLED:-true}
    authorizedGroups:
      - ${GITHUB_REPO_PROVISIONING_GROUP:-CloudHub-GitHub-RepoCreators}
```

### Local development (app-config.local.yaml)

A local override file is provided at [app-config.local.yaml](../app-config.local.yaml).
Fill in a test GitHub App and set `GITHUB_REPO_PROVISIONING_ENABLED=true` to
exercise repository creation locally.

---

## API Contracts

### `GET /api/github/authorization`

Returns whether the current user is authorized to create repositories.

**Response**

```json
{
  "authorized": true,
  "enabled": true,
  "source": "token"
}
```

### `GET /api/github/teams`

Returns available owner teams from the configured organization.

**Response**

```json
{
  "items": [
    { "slug": "cloud-engineering", "name": "Cloud Engineering" }
  ]
}
```

### `GET /api/github/templates`

Returns available template repositories.

**Response**

```json
{
  "items": ["Empty", "node-api-template", "react-app-template", "terraform-module-template"]
}
```

### `POST /api/github/repositories`

Creates a new repository.

**Request body**

```json
{
  "repositoryName": "platform-orders-api",
  "description": "Orders Domain API",
  "visibility": "private",
  "ownerTeam": "cloud-engineering",
  "templateName": "Empty",
  "enableBranchProtection": true,
  "enableCodeOwners": true,
  "enableDependabot": true
}
```

**Success response (201)**

```json
{
  "success": true,
  "repositoryName": "platform-orders-api",
  "repositoryUrl": "https://github.com/SymphonySensa/platform-orders-api",
  "ownerTeam": "cloud-engineering"
}
```

**Failure response (400/403/503)**

```json
{
  "success": false,
  "message": "Repository already exists"
}
```

---

## Audit Database Schema

Every repository creation attempt is written to `github_repository_requests`
regardless of success or failure.

```sql
CREATE TABLE IF NOT EXISTS github_repository_requests (
  id UUID PRIMARY KEY,
  repository_name VARCHAR(255) NOT NULL,
  description TEXT,
  visibility VARCHAR(50) NOT NULL,
  owner_team VARCHAR(255) NOT NULL,
  template_name VARCHAR(255),
  requested_by VARCHAR(255) NOT NULL,
  github_repo_url TEXT,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Captured Fields

| Field | Source |
|-------|--------|
| `requested_by` | Backstage user entity ref |
| `repository_name` | User input |
| `description` | User input |
| `visibility` | User input |
| `owner_team` | User input |
| `template_name` | User input |
| `github_repo_url` | GitHub API response |
| `status` | `SUCCESS`, `FAILED`, `ALREADY_EXISTS`, `VALIDATION_FAILED` |
| `created_at` | Database timestamp |

---

## Repository Governance

When a repository is created, the following governance steps are applied
automatically:

1. **Owner team assignment** — the selected team receives `admin` permission.
2. **Branch protection** — the `main` branch is protected with:
   - Pull requests required
   - At least one approval
   - Stale review dismissal
   - Force pushes disabled
   - Branch deletion disabled
3. **CODEOWNERS** — `.github/CODEOWNERS` is created with:
   ```text
   * @SymphonySensa/<team-slug>
   ```
4. **Dependabot** — `.github/dependabot.yml` is created for `npm`,
   `github-actions`, and `docker` ecosystems (weekly schedule).

### Repository Name Validation

- Must be 3–100 characters.
- May only contain lowercase letters, numbers, and hyphens.
- Must be unique within the organization.

Examples:

| Valid | Invalid |
|-------|---------|
| `platform-orders-api` | `OrdersAPI` |
| `cloudhub-backend` | `orders_api` |
| `terraform-network-module` | `orders api` |

---

## Troubleshooting

### "GitHub App is not configured"

Check that `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and
`GITHUB_APP_PRIVATE_KEY` are set and that the private key is formatted
correctly (including newlines).

### "You are not authorized to create GitHub repositories"

1. Verify the user is in the configured Entra group
   (`CloudHub-GitHub-RepoCreators` by default).
2. If group claims are missing from the token, set
   `GITHUB_REPO_PROVISIONING_GRAPH_ENABLED=true` and ensure the service
   principal has `GroupMember.Read.All` and `User.Read.All`.

### Repository creation fails with GitHub API error

- Confirm the GitHub App is installed into `SymphonySensa`.
- Confirm the App has the required repository and organization permissions.
- Check the backend logs for the exact GitHub API error message.

### Teams or templates do not load

- Verify the GitHub App can list organization teams (`Members` read
  permission).
- Check browser network logs for `/api/github/teams` and
  `/api/github/templates` responses.

---

## Operational Runbook

### Rotating the GitHub App private key

1. Generate a new private key in the GitHub App settings.
2. Update the secret in Azure Key Vault (production) or the environment
   variable (development).
3. Restart the CloudHub backend.
4. Verify repository creation still works through the UI.
5. Delete the old private key from GitHub once verified.

### Adding or changing an authorized group

1. Update `github.repositoryProvisioning.authorizedGroups` in
   `app-config.production.yaml`.
2. Redeploy CloudHub.
3. Verify the new group can create repositories and the old group (if
   removed) cannot.

### Disabling repository provisioning

Set `github.repositoryProvisioning.enabled: false` in the active config file
and redeploy. The page remains visible but repository creation is disabled.

### Querying audit records

```sql
SELECT
  repository_name,
  owner_team,
  requested_by,
  status,
  github_repo_url,
  created_at
FROM github_repository_requests
ORDER BY created_at DESC
LIMIT 100;
```

---

## Related Documentation

- [EngToolsPage.tsx](../plugins/platform-home/src/components/EngToolsPage.tsx)
- [GitHubToolForm.tsx](../plugins/platform-home/src/components/GitHubToolForm.tsx)
- [deployment-control-plane router](../plugins/deployment-control-plane-backend/src/router.ts)
- [CloudHub Technology Stack](CLOUDHUB_TECHSTACK.md)
