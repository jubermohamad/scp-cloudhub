# Runbooks

Each runbook gives the symptom, how to confirm it, and the fix. SQL runs against CloudHub's database (schema `data_export`); use a read-only role unless the step says otherwise.

## Useful queries

```sql
-- Queue depth and running jobs right now
SELECT status, COUNT(*) FROM data_export.jobs
 WHERE status IN ('CREATED','QUEUED','ASSIGNED','RUNNING','UPLOADING') GROUP BY status;

-- Agents not heard from in 5 minutes
SELECT c.tenant_id, c.cluster_name, a.agent_name, a.agent_version, a.status, a.last_seen
  FROM data_export.agents a JOIN data_export.clusters c ON c.id = a.cluster_id
 WHERE NOT c.is_retired AND (a.last_seen IS NULL OR a.last_seen < NOW() - INTERVAL '5 minutes')
 ORDER BY a.last_seen NULLS FIRST;

-- Failures today, grouped by reason
SELECT tenant_id, LEFT(error_message, 120) AS reason, COUNT(*)
  FROM data_export.jobs WHERE status = 'FAILED' AND completed_time >= date_trunc('day', NOW())
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- Oldest queued job per cluster (stuck queue)
SELECT c.cluster_name, MIN(j.scheduled_time) AS oldest, COUNT(*)
  FROM data_export.jobs j JOIN data_export.clusters c ON c.id = j.cluster_id
 WHERE j.status = 'QUEUED' GROUP BY 1 ORDER BY 2;
```

## RB-1 Cluster OFFLINE or CRITICAL

**Symptom:** a cluster shows OFFLINE or CRITICAL; Healthy Clusters < Registered.

1. Check the agent on the cluster: `kubectl -n cloudhub-system get pods -l app.kubernetes.io/name=data-export-agent`, then `kubectl logs …`.
2. If the pod is crash-looping with exit code 78, configuration is invalid. The log lists each problem.
3. If the log shows `403` on heartbeat:
   - the token subject doesn't match a registered agent (check `identitySubject` against the managed identity's **object id**); or
   - the cluster is retired; or
   - the audience is wrong (`CONTROL_PLANE_SCOPE` must match `DATA_EXPORT_AGENT_AUDIENCE`).
4. If the log shows `401` or a token error, check the federated credential and the service account annotation `azure.workload.identity/client-id`.
5. If the agent can't connect at all, check egress from `cloudhub-system` to CloudHub on port 443.

Jobs held by an OFFLINE agent are re-queued automatically after 15 minutes. No action is needed once the agent recovers.

## RB-2 Jobs stay QUEUED

**Symptom:** the queue doesn't drain for one cluster.

1. Run the oldest-queued query. If only one cluster is affected, run RB-1 for that cluster.
2. Check `not_before`. Retried jobs wait 2, 4, 8 … minutes before they can be claimed.
3. A healthy agent works through one job at a time. A long extract (up to 2 hours) delays the rest. Look at the RUNNING job on the Executions page.

## RB-3 Jobs never created

**Symptom:** a schedule didn't fire.

1. Is the export enabled, and is its cluster not retired?
2. Is the scheduler running? Check the backend logs for `data-export-scheduler`, and whether `metric_samples` gains a row every minute. Check that `DATA_EXPORT_SCHEDULER_ENABLED` isn't `false`.
3. Check `export_profiles.last_scheduled_at`. It only moves when an occurrence is created. Schedules are in **UTC**.
4. Jobs FAILED with a reason straight after creation were rejected at dispatch (dataset disabled or without SQL, destination disabled). Fix the reason and use Run now.

## RB-4 Job FAILED

Open the job and read `errorMessage` and the log. The meaning of each message is in [troubleshooting](troubleshooting.md). After fixing the cause, select **Retry**.

## RB-5 Destination FAILED

1. The destination's message records which cluster's agent checked it and what failed.
2. **SFTP:**
   - host key mismatch means the server's key changed; confirm with the customer and update `hostKeyFingerprint`;
   - authentication failure means the Key Vault secret holds the wrong key, or the agent identity lacks Key Vault Secrets User;
   - a timeout means egress or the customer's firewall is blocking port 22.
3. **ADLS:** 403 means the role assignment (Storage Blob Data Contributor on the file system) is missing for the agent identity.

## RB-6 Data delivered twice, or rows missing

1. **Twice** is expected with `GREATER_OR_EQUAL`: boundary rows are delivered again, and consumers de-duplicate on primary keys. With `GREATER_THAN`, check whether a watermark was reset manually (audit trail and `watermarks.updated_at`).
2. **Missing rows** in incremental mode usually mean rows were written with a watermark value lower than one already exported, for example a late-arriving timestamp. Use a sequence or commit-time column, or schedule a periodic FULL export.
3. **Re-deliver from a point:** platform admin, with no job for the profile running.
   ```sql
   UPDATE data_export.watermarks SET last_success_value = '<value>', updated_at = NOW()
    WHERE profile_id = '<profile>' AND dataset_id = '<dataset uuid>';
   ```
   Record the change in the change ticket, then use Run now.

## RB-7 Platform Registry sync skipped clusters

The sync result (Clusters → Sync, or the scheduler log every 30 minutes) lists skipped clusters with a reason:

- **No environment mapping:** rename the environment in Platform Registry to a standard name, or register the cluster manually.
- **Tenant or environment changed while exports use the cluster:** the change was not applied, because it would move those exports. Move or delete the exports first, then sync again.
- **No platform:** assign the cluster to a platform (tenant) in Platform Registry.
