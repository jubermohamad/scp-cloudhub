# Operational guide

## What "healthy" looks like

| Signal | Where | Healthy |
|---|---|---|
| Healthy clusters | Dashboard KPI, Clusters page | Equal to registered clusters |
| Connected agents | Dashboard KPI, Agents page | Equal to registered agents |
| Queued jobs | Dashboard KPI and queue-depth trend (platform admins) | Returns to near zero after each schedule peak (e.g. 02:00 UTC for daily presets) |
| Failed jobs today | Dashboard KPI → Executions filtered to FAILED | 0, or explained |
| Destination status | Destinations page | HEALTHY (live checks every 15 minutes while in use) |

All of these come from PostgreSQL; there is no separate monitoring stack. To alert from outside CloudHub, query `data_export.metric_samples` and `data_export.jobs`. Example queries are in [runbooks](runbooks.md).

## Routine tasks

| Task | How |
|---|---|
| Re-run an export now | Exports → Run now. Queues one high-priority job per dataset. |
| Retry a failed job | Executions → job → Retry. Re-queued with the same scheduled time. |
| Stop a job | Executions → job → Cancel. The agent stops at its next progress report, within about 30 seconds. |
| Pause an export | Exports → Disable. Re-enabling never back-fills missed runs. |
| Take a cluster out of service | Clusters → Retire, or let Platform Registry sync retire it. Its agent is refused and its jobs fail at dispatch. |
| Force a cluster sync | Administration or Clusters → Sync from Platform Registry |
| Upgrade agents | Roll out a new image tag with the chart. The `Recreate` strategy lets a running job drain within the grace period. |
| Rotate an SFTP key | Add the new key to the server, update the Key Vault secret, then remove the old key. No CloudHub change is needed. |
| Rotate an SFTP host key | Set `hostKeyFingerprint` to `old,new` before the server switches, then to `new` after |
| Rotate an agent identity | Create the new managed identity and federated credential, update the agent's `identitySubject` in CloudHub, redeploy with the new client id |
| Review changes | Administration → Audit log, or `GET /audit` |

## Capacity

- **One job at a time per cluster.** Throughput per cluster is bounded by the read replica and the destination. Spread heavy exports across the day with custom cron schedules, rather than putting everything on the daily 02:00 preset.
- **Statement timeout is 2 hours.** Split larger extracts into several datasets, or switch them to incremental.
- **Work directory.** Each job writes one file locally before upload, so `workDir.sizeLimit` must exceed the largest single file.
- **Control plane load.** About 70 heartbeats a minute plus idle claim polls every 15 seconds is light, even with CloudHub on two replicas. The scheduler runs on one replica at a time.

## Data retention inside CloudHub

| Data | Kept |
|---|---|
| Jobs (with logs, manifests) | Indefinitely, and deleted with their export. Archive old rows if the table grows past your needs. |
| Agent heartbeats | 7 days (pruned every 6 hours) |
| Metric samples | 30 days |
| Audit events | Indefinitely (append-only) |
