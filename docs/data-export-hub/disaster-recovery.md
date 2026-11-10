# Disaster recovery

All state lives in CloudHub's PostgreSQL database (schema `data_export`) and in the destinations. Agents are stateless.

| Component lost | Impact | Recovery |
|---|---|---|
| **One agent pod or node** | That cluster's exports pause | Kubernetes reschedules the pod. Jobs held by the old pod are re-queued: on the new agent's first claim, or after 15 minutes by the scheduler. Watermarks only move on completion, so nothing is skipped. |
| **One AKS cluster** | That tenant's exports on that cluster stop | Restore the cluster, or register a replacement. Retire the old cluster and re-point its exports to the new one; they keep their watermarks, which are stored per profile. Deploy the chart with a new or reused identity and update the agent's `identitySubject`. |
| **A read replica** | Jobs fail as retryable (connection errors) and retry with backoff | Restore the replica. Retries resume automatically. After 3 attempts, jobs are FAILED; retry them from Executions. |
| **A destination** | Uploads fail as retryable, and the destination check reports FAILED | Restore the destination, then retry. Files are written to job-specific folders, so a re-run never overwrites earlier deliveries. |
| **CloudHub backend** | No scheduling or claims. Agents keep retrying with backoff, and a running job finishes its extract but cannot report until CloudHub returns. | Redeploy. On restart the scheduler creates **one** catch-up job per profile for the latest missed occurrence (no backlog storm). Jobs whose agents could not report are reclaimed and re-run. |
| **CloudHub database** | Full outage of the control plane | Restore from the PostgreSQL backup (Azure Database for PostgreSQL point-in-time restore). See below. |

## After a database restore

A point-in-time restore rolls back recent jobs, and possibly watermarks:

1. Restore the database, start CloudHub, and check that migrations report nothing to apply.
2. **Watermarks** may now be older than what was actually delivered after the restore point. The next incremental run re-delivers those rows. This is safe for consumers that de-duplicate on primary keys. Where duplicates are unacceptable, set each watermark to the `watermark.to` of the latest `manifest.json` found at the destination (see RB-6).
3. Jobs that were in flight at the restore point appear as ASSIGNED or RUNNING. The scheduler reclaims them within 15 minutes, or retry or cancel them by hand.
4. Audit events after the restore point are lost. The destinations' manifests remain the record of what was delivered.

## Backups

- **CloudHub database:** covered by the CloudHub PostgreSQL backup policy. The `data_export` schema has no external dependencies.
- **Destination data** is the customer's copy. Manifests and checksums make every delivery independently verifiable.
- **Configuration:** Helm values per cluster (non-secret) in GitOps; Entra groups and managed identities in infrastructure-as-code.

## Targets

| Item | Target |
|---|---|
| Agent recovery | Minutes (pod restart) |
| Lost-agent job reclaim | 15 minutes |
| Control plane RPO and RTO | Those of CloudHub's PostgreSQL and backend deployment |
