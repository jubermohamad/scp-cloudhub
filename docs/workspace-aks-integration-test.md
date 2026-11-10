# CloudHub Workspace AKS Integration Test

This test validates the real workspace infrastructure lifecycle on the pre-created AKS target namespace.

Scope:

- Create ServiceAccount, PVC, and Pod
- Wait for PVC Bound and Pod Ready
- Stop: remove Pod only
- Start: recreate Pod and reuse the same PVC
- Delete: remove Pod, PVC, and ServiceAccount

## Required Environment Variables

Set these before running:

- `CLOUDHUB_WORKSPACE_AKS_SUBSCRIPTION_ID`
- `CLOUDHUB_WORKSPACE_AKS_RESOURCE_GROUP`
- `CLOUDHUB_WORKSPACE_AKS_CLUSTER_NAME`
- `CLOUDHUB_WORKSPACE_NAMESPACE` (default: `cloudhub-workspaces`)

Optional:

- `WORKSPACE_INTEGRATION_IMAGE` (defaults to `companyacr.azurecr.io/cloudhub/dev/node:1.0.0`)

## Authentication

Authentication uses CloudHub's canonical `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
and `AZURE_CLIENT_SECRET` with `ClientSecretCredential`. The client and tenant
are validated and the code does not fall back to Azure CLI, managed identity, or
workload identity.

No static kubeconfig files are written by the test.

## Run

```bash
RUN_WORKSPACE_AKS_INTEGRATION=true \
NODE_OPTIONS=--max-old-space-size=6144 \
yarn workspace @internal/plugin-deployment-control-plane-backend test \
  --runInBand src/__tests__/workspaceKubernetesProvisioner.integration.test.ts \
  --watch=false
```

If `RUN_WORKSPACE_AKS_INTEGRATION` is not `true`, the test is skipped.
