# data-export-agent chart

Deploys the CloudHub Data Export Hub agent: a single-replica Deployment in
`cloudhub-system` that claims export jobs for this cluster from CloudHub, runs
read-only extracts against the cluster's PostgreSQL read replica and delivers
the files to ADLS Gen2 or SFTP. See `services/data-export-agent/README.md` for
what the agent does.

The chart contains **no secrets**. The agent authenticates to everything
(CloudHub, PostgreSQL, ADLS, Key Vault) with Azure Workload Identity.

## Prerequisites (per cluster)

1. **AKS OIDC issuer and workload identity** enabled on the cluster
   (`az aks update --enable-oidc-issuer --enable-workload-identity`).
2. **User-assigned managed identity** for the agent, with a federated
   credential for the service account:

   ```sh
   az identity federated-credential create \
     --name data-export-agent --identity-name <identity> --resource-group <rg> \
     --issuer "$(az aks show -n <cluster> -g <rg> --query oidcIssuerProfile.issuerUrl -o tsv)" \
     --subject system:serviceaccount:cloudhub-system:data-export-agent \
     --audiences api://AzureADTokenExchange
   ```

3. **PostgreSQL AAD role** on the read replica's primary (roles replicate),
   mapped to the identity and granted read-only access to the exported
   schemas only:

   ```sql
   SELECT * FROM pgaadauth_create_principal('<identity-name>', false, false);
   GRANT CONNECT ON DATABASE app TO "<identity-name>";
   GRANT USAGE ON SCHEMA public TO "<identity-name>";
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO "<identity-name>";
   ```

   `postgres.user` is that role name.
4. **Storage Blob Data Contributor** for the identity on every ADLS Gen2
   account used as a destination (scope it to the file system if possible).
5. **Key Vault Secrets User** for the identity on each vault holding SFTP
   private keys (`secretRef: kv://<vault>/<secret>`).
6. **Register the agent in CloudHub**: register the identity's **object
   (principal) ID** as this cluster's agent. Until then every call returns 403
   and the pod stays unready.
7. **CloudHub API access**: the identity must be allowed to obtain tokens for
   `controlPlane.scope` (an app role assignment on the CloudHub API app, if it
   requires assignment).

## Install

```sh
helm upgrade --install data-export-agent charts/platform/data-export-agent \
  --namespace cloudhub-system --create-namespace \
  --set clusterName=aks-eu-prod-1 \
  --set controlPlane.url=https://cloudhub.example.com \
  --set controlPlane.scope=api://cloudhub-data-export/.default \
  --set postgres.host=app-replica.postgres.database.azure.com \
  --set postgres.database=app \
  --set postgres.user=mi-data-export-agent-eu-prod-1 \
  --set workloadIdentity.clientId=<identity client id> \
  --set image.repository=<registry>/data-export-agent --set image.tag=<tag>
```

## Notable values

| Value | Default | Notes |
| --- | --- | --- |
| `namespace` | `cloudhub-system` | All namespaced resources. |
| `clusterName` | required | Cluster name as registered in CloudHub. |
| `controlPlane.url` / `.scope` | required / `api://cloudhub-data-export/.default` | |
| `postgres.host` / `.database` / `.user` | required | Read replica and AAD role. |
| `postgres.sslMode` | `verify-full` | `disable`, `require`, `verify-ca`, `verify-full`. |
| `postgres.sslRootCert.configMapName` | `""` | Optional CA bundle ConfigMap. |
| `workloadIdentity.clientId` | required | Annotated on the ServiceAccount. |
| `shutdownGraceSeconds` | `300` | Time a running job gets after SIGTERM; `terminationGracePeriodSeconds` = this + `terminationGraceBufferSeconds` (60). |
| `workDir.sizeLimit` | `20Gi` | emptyDir for export files; size for the largest export. |
| `resources` | 100m / 256Mi, limit 1Gi | |
| `rbac.create` | `true` | ClusterRole: get namespace `kube-system`, GET `/version`. |
| `networkPolicy.enabled` | `false` | Egress-only policy (DNS + 443/5432/22). Narrow the CIDRs. |

## Security posture

- Pod label `azure.workload.identity/use: "true"`; ServiceAccount annotated
  with the identity client ID. No secret, password or connection string in
  values, env or the image.
- `runAsNonRoot` (uid 1000), `readOnlyRootFilesystem`, all capabilities
  dropped, no privilege escalation, seccomp `RuntimeDefault`. The only
  writable paths are the work dir and a small `/tmp` emptyDir.
- `replicas: 1` with the `Recreate` strategy, so two agents never run for
  the same cluster during a rollout.
- Cluster RBAC is limited to reading the `kube-system` namespace object and
  the API server version.
