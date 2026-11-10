# CloudHub AKS Namespace Deployment

This bundle migrates CloudHub from App Service to a dedicated AKS namespace with:

- A namespace-scoped frontend Deployment and ClusterIP Service
- A namespace-scoped backend Deployment and ClusterIP Service
- Azure Workload Identity for the backend pod identity
- Azure Database for PostgreSQL connection settings via `PGHOST`, `PGDATABASE`, and `PGUSER`
- An ingress that exposes only the frontend host

## Files

- `k8s/aks-namespace/00-namespace.yaml`
- `k8s/aks-namespace/10-backend-serviceaccount.yaml`
- `k8s/aks-namespace/20-backend-deployment.yaml`
- `k8s/aks-namespace/30-backend-service.yaml`
- `k8s/aks-namespace/40-frontend-deployment.yaml`
- `k8s/aks-namespace/50-frontend-service.yaml`
- `k8s/aks-namespace/60-frontend-ingress.yaml`
- `.github/workflows/deploy-aks-namespace.yml`
- `scripts/aks/bootstrap_aks_namespace.sh`

## Assumptions

- The AKS cluster has the Azure Workload Identity webhook installed.
- The ingress controller already exists in the cluster.
- The backend runtime secret is supplied separately as `cloudhub-runtime-secrets`.
- The PostgreSQL server allows Entra ID authentication for the backend identity.

## Runtime Secret

Create `cloudhub-runtime-secrets` in the target namespace with the sensitive values that the backend still needs at runtime, for example:

- `AUTH_MICROSOFT_CLIENT_ID`
- `AUTH_MICROSOFT_CLIENT_SECRET`
- `AUTH_MICROSOFT_TENANT_ID`
- `GITHUB_TOKEN`
- `GPU_ENTRA_GROUP_ID`

Store those values in Azure Key Vault or another secret source and sync them into the namespace; do not hardcode them in the manifest.

`GITHUB_DIRECT_DEPLOY` is not part of the AKS deployment flow. The current deployment path is image-tag driven and workflow-dispatch based.

## PostgreSQL Passwordless Mode

The backend now supports PostgreSQL passwordless authentication when `POSTGRES_AAD_AUTH=true` is set and no static password is provided. In that mode it uses Azure identity credentials to fetch a short-lived token for the PostgreSQL Flexible Server scope.

Required environment variables for the backend container:

- `PGHOST`
- `PGDATABASE`
- `PGUSER`
- `POSTGRES_AAD_AUTH=true`

The backend also accepts the legacy `POSTGRES_HOST`, `POSTGRES_DB`, and `POSTGRES_USER` names for compatibility during migration.

## Bootstrap

Run the bootstrap script after logging into Azure:

```bash
export AKS_RESOURCE_GROUP=rg-scp-dev-sdc-st-cms
export AKS_CLUSTER_NAME=aks-scp-dev-sdc-st-cms
export ACR_NAME=symphonyfs
export K8S_NAMESPACE=cloudhub
export AZURE_TENANT_ID=<tenant-id>

./scripts/aks/bootstrap_aks_namespace.sh
```

The script:

- Creates or reuses a user-assigned managed identity
- Creates the federated credential for the backend ServiceAccount
- Creates the namespace if it does not exist
- Prints the identity and federation details you need for AKS and ACR wiring

## Build and Deploy Workflow

Use `.github/workflows/deploy-aks-namespace.yml` to build both images, push them to ACR, render the manifests, and apply them to the target namespace.

Repository variables for this environment:

- `K8S_NAMESPACE=cloudhub`
- `FRONTEND_HOST=https://cloudh.azurewebsites.net/`
- `aks_resource_group=rg-scp-dev-sdc-st-cms`
- `AKS_RESOURCE_GROUP=rg-scp-dev-sdc-st-cms`
- `AKS_CLUSTER_NAME=aks-scp-dev-sdc-st-cms`
- `BACKEND_PG_HOST=cloudhub-postgres.postgres.database.azure.com`
- `BACKEND_PG_DATABASE=cloudhub`
- `BACKEND_PG_USER=cloudhub-backend`

The workflow uses `github.sha` as the image tag for both frontend and backend.

## Validation

After deployment, confirm the rollout:

```bash
kubectl rollout status deployment/cloudhub-backend -n <namespace>
kubectl rollout status deployment/cloudhub-frontend -n <namespace>
```

If the backend cannot connect to PostgreSQL, check that the managed identity is federated correctly and that the database accepts the Entra identity used by the backend pod.
