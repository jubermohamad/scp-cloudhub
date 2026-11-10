# CloudHub Release Runbook

## Prerequisites

1. Build and push the frontend and backend images using the existing build workflow.
2. Confirm both images exist in `symphonyfs.azurecr.io` under `cloudhub-platform/frontend` and `cloudhub-platform/backend`.
3. Confirm `staging` slots exist for `cloudhub-frontend` and `cloudhub-backend`.
4. Configure the GitHub `production` Environment with required reviewers.
5. Configure OIDC federated credentials for the deployment service principal and grant it App Service Contributor plus ACR pull access through the App Services' managed identities.

## Release

1. Run `Deploy Existing Release to Staging` with a complete tag such as `0.9.0-beta.145`.
2. Confirm backend and frontend smoke tests pass in the workflow summary.
3. Run `Promote Staging Release to Production`.
4. A required reviewer approves the protected `production` Environment.
5. The workflow swaps backend staging to production, then frontend staging to production.
6. Verify the production health endpoints and sign-in flow.

## Failure handling

- ACR failure: verify the exact repository/tag and App Service ACR pull permission.
- Startup failure: inspect App Service log stream and slot container settings.
- Smoke failure: do not promote; fix or rollback staging.
- Swap failure: leave production unchanged where Azure permits and inspect slot operation logs.
- Approval timeout: re-run promotion after the production Environment approval is available.

## Version policy

Use immutable tags in the form `0.9.0-beta.N`. Never use `latest` for a release promotion.
