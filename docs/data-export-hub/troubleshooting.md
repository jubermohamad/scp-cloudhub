# Troubleshooting

Look up the message from a job's error, an API response or an agent log.

## Job errors

| Message | Cause | Fix |
|---|---|---|
| `Dataset … is disabled` / `has no SQL template` | Rejected at dispatch or claim | Enable the dataset, or add its SQL template; then Run now |
| `The export was disabled before the job was queued` | Export disabled after scheduling | Expected (CANCELLED) |
| `Cluster … is retired` | Cluster retired | Restore it, or move the export |
| `Destination type … has no delivery provider` | Legacy destination type | Recreate the destination as ADLS_GEN2 or SFTP |
| `Agent … stopped sending heartbeats` | Agent offline for 15 minutes | RB-1. The job retries automatically while attempts remain. |
| `The agent claimed this job but never started it` | Agent crashed right after claiming | Check the agent logs; the job is retried |
| `Agent restarted while the job was in progress` | Pod restarted mid-job | Retried automatically. Check pod events for OOM kills (raise the memory limit) or evictions (work directory full). |
| `No progress reported for 150 minutes` | Hung upload or extract | Check the destination and the replica; retried automatically |
| `cannot execute … in a read-only transaction` / `data-modifying statement` | The template tries to write | Fix the template; it must be a plain SELECT |
| `canceling statement due to statement timeout` | Extract exceeded 2 hours | Split the dataset, add an index, or use INCREMENTAL |
| `permission denied for table …` | The agent's PostgreSQL role lacks SELECT | Grant SELECT on the view or table |
| Host key mismatch / `hostVerifier` | SFTP host key changed | Confirm with the destination owner, then update `hostKeyFingerprint` |
| `All configured authentication methods failed` | Wrong key in Key Vault, or wrong username | Update the secret, or the destination's username |
| ADLS `AuthorizationPermissionMismatch` | Missing role assignment | Grant Storage Blob Data Contributor on the file system to the agent identity |

## API errors

| Status and message | Cause |
|---|---|
| `400 sortBy must be one of …` | The client asked to sort by a field the list doesn't support |
| `400 Datasets without a SQL template cannot be exported yet` | Publish the dataset fully first ([data catalog](data-catalog.md)) |
| `400 clusterId … is not a registered cluster for tenant …` | The cluster belongs to another tenant, or isn't registered |
| `400 Cluster … is registered as PRODUCTION, not SIT` | The export's environment must match its cluster's |
| `400 destinationId … is not available to tenant …` | That destination belongs to another tenant |
| `403 Requires tenant admin for <tenant>` | The caller is a tenant user or in another tenant ([RBAC](rbac.md)) |
| `403 Shared destinations require CloudHub.DataExport.Admin` | Only platform admins (`grp-cloudhub-data-export` or `CloudHubPlatformOwners`) create shared destinations |
| `404` for a record you expect to see | It belongs to a tenant you're not a member of |
| `409 … is managed by Platform Registry` | Edit the cluster in Platform Registry instead |
| `409 Cannot change the tenant or environment of a cluster that exports use` | Move the exports first |

## Agent start-up

| Log | Cause |
|---|---|
| Exit code 78 with a list of problems | Missing or invalid environment variables (`CONTROL_PLANE_URL`, `CLUSTER_NAME`, `PG*`, …) |
| `PGPASSWORD is set; the agent authenticates with Azure Workload Identity only…` (or another secret variable) | A secret variable such as `PGPASSWORD` or `AZURE_CLIENT_SECRET` is set; remove it |
| `403 No agent is registered for identity <oid>` | Register the agent in CloudHub with that object id |
| `403 Cluster … is retired` | Restore the cluster |
| `401` on every call | Token audience or issuer mismatch. The CloudHub API app must issue v2 tokens, and the scope must match `DATA_EXPORT_AGENT_AUDIENCE`. |
| `kubernetesVersion` missing from capabilities | The chart's ClusterRole is not installed (`rbac.create=false`). Harmless. |
