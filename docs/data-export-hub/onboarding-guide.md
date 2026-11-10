# Onboarding guide

Onboarding a tenant or a cluster is **configuration only**: Entra groups, Azure identities, one Helm release, and records in CloudHub. No code changes.

## One-time platform setup

1. **CloudHub API app registration.** Set the Application ID URI (e.g. `api://cloudhub-data-export`) and `accessTokenAcceptedVersion: 2`.
2. **CloudHub backend.** Set `DATA_EXPORT_AGENT_AUDIENCE` to that URI (`AUTH_MICROSOFT_TENANT_ID` is already set). `app-config.production.yaml` contains the `externalAccess` entry that verifies agent tokens.
3. **Groups.** The configured Entra group `grp-cloudhub-data-export` grants
   Data Export Hub platform-admin access. Members of `CloudHubPlatformOwners`
   also receive full Data Export Hub access. The configured Data Export group
   object ID is `ea5a79c7-5b88-4108-9c2e-9e88bffff673` in SymphonyAI Sensa's
   Entra tenant. Add users to the appropriate group, then have them sign in
   again for membership to take effect.
4. **Registry.** Publish the agent image to the container registry used by the chart (`image.repository`).

## New tenant

1. **Choose the tenant slug.** It is the Platform Registry platform code, slugified (e.g. `metrobank`). Synced clusters derive it automatically.
2. **Create tenant-specific Entra groups** when tenant-scoped roles are needed:
   - `CloudHub.DataExport.Tenant.<slug>.Admin`: the people who manage the tenant's exports;
   - `CloudHub.DataExport.Tenant.<slug>.User`: read-only users.
3. **Register the tenant's clusters** ([new cluster](#new-cluster)).
4. **Create the tenant's destinations** (tenant admin, Destinations page):
   - **ADLS Gen2:** storage account and file system (default `data-export-hub`). Grant each of the tenant's agent identities Storage Blob Data Contributor on that file system.
   - **SFTP:** host, port, username, remote path, the Key Vault secret holding the private key (`kv://<vault>/<secret>`), and the server's host key fingerprint (`ssh-keygen -lf <host key>.pub`, or ask the customer). Grant the agent identities Key Vault Secrets User on the secret.
5. **Create exports** (tenant admin): Exports → New Export → environment, cluster, datasets, schedule, mode, format, destination.

## New cluster

1. **Register the cluster in CloudHub.** Normally Platform Registry already knows it, and it appears within 30 minutes, or immediately with Sync from Platform Registry. Otherwise a platform admin registers it manually.
2. **Create a user-assigned managed identity** for the agent, one per cluster. Then add a **federated credential**:
   - issuer: the cluster's OIDC issuer;
   - subject: `system:serviceaccount:cloudhub-system:data-export-agent`;
   - audience: `api://AzureADTokenExchange`.
3. **Grant the identity access to the read replica.** Create a PostgreSQL role for the managed identity, with `SELECT` only on the export views or tables:
   ```sql
   SELECT * FROM pgaadauth_create_principal('<identity name>', false, false);
   GRANT SELECT ON <export views> TO "<identity name>";
   ```
4. **Grant destination access:** the storage role or Key Vault access from the tenant steps.
5. **Register the agent in CloudHub:** Clusters → cluster → Register agent, with the identity's **object (principal) id** as the identity subject.
6. **Deploy the agent:**
   ```bash
   helm upgrade --install data-export-agent charts/platform/data-export-agent \
     --namespace cloudhub-system --create-namespace \
     --set clusterName=<cluster name as registered> \
     --set controlPlane.url=https://<cloudhub host> \
     --set controlPlane.scope=api://cloudhub-data-export/.default \
     --set workloadIdentity.clientId=<identity client id> \
     --set postgres.host=<replica host> --set postgres.database=<db> --set postgres.user=<identity name>
   ```
   The cluster must have the OIDC issuer and workload identity enabled (`az aks update --enable-oidc-issuer --enable-workload-identity`).
7. **Verify.** Within a minute the cluster shows **HEALTHY** with the agent version. Within 15 minutes of an export using a destination, the destination shows a live check result. Then use **Run now** on an export, and confirm the job completes and the files and manifest appear at the destination.

## New dataset

A platform admin publishes it in the data catalog. See [data catalog](data-catalog.md#publishing-a-dataset).

## Offboarding

1. **Disable the tenant's exports.**
2. **Retire its clusters.** They are kept for history and never deleted.
3. **Uninstall the agent:** `helm uninstall data-export-agent -n cloudhub-system`.
4. **Remove agent identities and role assignments.**
5. **Remove the tenant's Entra groups.**
