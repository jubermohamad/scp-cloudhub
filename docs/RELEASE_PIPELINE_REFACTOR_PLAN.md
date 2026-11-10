# Release Pipeline Refactor Plan

## Target flow

```text
Build existing images
        |
Deploy selected version to staging slots
        |
Run frontend and backend smoke tests
        |
GitHub production environment approval
        |
Swap backend, then frontend staging slots to production
        |
Rollback by reverse swap or redeploy a known version
```

## Workflows

- `deploy-to-staging.yml` deploys an existing version only to the `staging` slot. It never swaps slots or changes the production slot.
- `promote-to-production.yml` validates both staging slots, waits for the protected `production` environment, then swaps backend first and frontend second.
- `rollback-production.yml` supports reverse slot swap or deploying a known version to staging followed by an optional swap.

## Compatibility

The existing build workflows and image version format are unchanged. Existing direct deployment remains available in `deploy-fe-be-prod-basic.yml` during migration; new releases should use the staging and promotion workflows.

## Guardrails

- ACR tag existence is checked before deployment.
- Slot existence is checked before any image change.
- Production promotion cannot proceed when staging health checks fail.
- Backend is swapped before frontend to avoid exposing a frontend that depends on an unavailable backend.
- Every workflow publishes version, images, commit, actor, duration, and health/swap results in the job summary.
