# Security

## Principles

- **No stored passwords or embedded secrets anywhere in the pipeline.** Every identity is an Entra identity, obtained at runtime.
- **CloudHub never touches customer data.** SQL runs only inside the customer's cluster, against a read replica, in a read-only session.
- **All connections are outbound from the cluster.** CloudHub has no network path into any cluster.
- **Least privilege per cluster.** Each agent has its own identity and can only see its own cluster's jobs.

## Identities

| From → to | Mechanism |
|---|---|
| User → CloudHub | Backstage sign-in with Microsoft Entra ID. Roles from Entra groups ([RBAC](rbac.md)). |
| Agent → CloudHub | Entra access token from the agent's **user-assigned managed identity**, via Azure Workload Identity (federated with the agent's Kubernetes service account). CloudHub verifies it with Backstage `externalAccess` type `jwks` against Entra's signing keys, issuer `https://login.microsoftonline.com/<tenant>/v2.0`, and audience `DATA_EXPORT_AGENT_AUDIENCE`. Access is restricted to the `data-export` plugin, and the token subject must match a registered agent on a non-retired cluster. |
| Agent → PostgreSQL read replica | Entra token for Azure Database for PostgreSQL (`https://ossrdbms-aad.database.windows.net/.default`), used as the password and refreshed per connection. The identity maps to a PostgreSQL role with `SELECT` only. |
| Agent → ADLS Gen2 | The same workload identity, with **Storage Blob Data Contributor** scoped to the export file system |
| Agent → SFTP | Private key fetched at runtime from **Key Vault** (`secretRef` = `kv://<vault>/<secret>`) with the workload identity (**Key Vault Secrets User** on that secret). The server's host key must match the pinned `hostKeyFingerprint`; unpinned hosts are refused. |
| Scheduler → control plane | Backstage plugin-to-plugin service token |

Destination configuration is validated to contain no credential-like keys (password, token, secret, apiKey, privateKey, credential, connectionString, sasKey).

## Database guardrails

Every source connection the agent opens runs, before any dataset query:

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SET statement_timeout='7200s';
```

It then verifies `SHOW transaction_read_only` returns `on`, and refuses to continue otherwise. Further protections:

- Templates must be a single `SELECT` or `WITH … SELECT` (checked when stored and again by the agent).
- Watermark column names must be plain identifiers, and are quoted.
- Watermark values are bound as parameters.
- `SNAPSHOT` exports run in `REPEATABLE READ READ ONLY` for a consistent view.

The agent's PostgreSQL role should itself be read-only, as defence in depth.

## Data integrity

Each delivery carries a SHA-256 for every data file, in `checksum.sha256` and in `manifest.json`. The manifest is written last, so a folder without one is incomplete. Agents report checksums to CloudHub, which keeps them on the job.

## Tenant isolation

See [tenant isolation](tenant-isolation.md).

## Audit

Every change made through the API is written to `audit_events` in the same transaction as the change: exports, datasets, destinations, clusters, agents, job retries and cancellations, and Run now. So are system actions such as cluster discovery and retirement. Tenant admins can read their tenant's trail, and platform admins can read everything.

## Hardening checklist

- [ ] CloudHub API app registration issues v2 tokens (`accessTokenAcceptedVersion: 2`), and its App ID URI matches `DATA_EXPORT_AGENT_AUDIENCE`
- [ ] One managed identity per cluster agent; federated credential subject `system:serviceaccount:cloudhub-system:data-export-agent`
- [ ] The PostgreSQL role for the agent has `SELECT` on the export views only
- [ ] Storage role assignment is scoped to the export file system, not the account
- [ ] Key Vault access is scoped to the SFTP key secrets
- [ ] Agent pods run with the chart's restricted security context (non-root, read-only root filesystem, no capabilities)
- [ ] Egress from `cloudhub-system` allows only CloudHub, Entra, the read replica, the destinations and Key Vault
