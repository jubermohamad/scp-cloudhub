# Scheduler

`@internal/plugin-data-export-scheduler` is a Backstage backend plugin that runs in the CloudHub backend next to the control plane. It uses Backstage's scheduler service with `scope: 'global'`, so each task runs on one backend replica at a time even when CloudHub is scaled out. The task lock lives in the Backstage database.

| Task | Every | Does |
|---|---|---|
| `data-export-scheduler:tick` | 1 minute (timeout 55 s) | Create due jobs, dispatch, reclaim, sample metrics |
| `data-export-scheduler:cluster-sync` | 30 minutes | Calls the control plane's `POST /internal/clusters/sync` with the plugin's service token |
| `data-export-scheduler:housekeeping` | 6 hours | Deletes heartbeats older than 7 days and metric samples older than 30 days, in batches |

Before each tick the scheduler checks that `data_export.schema_migrations` is at version 3 or later. The control plane owns the schema, so a scheduler that starts first simply waits.

Set `DATA_EXPORT_SCHEDULER_ENABLED=false` to turn it off (for example on a read-only replica).

## Creating jobs

For each enabled profile on a non-retired cluster:

1. `since = last_scheduled_at`, or `created_at` if never scheduled.
2. `due` = the latest cron occurrence (UTC) in `(since, now]`.
3. If there is one, insert a `CREATED` job per dataset with `scheduled_time = due` (`ON CONFLICT DO NOTHING`), and set `last_scheduled_at = due`, in one transaction.

Only the latest missed occurrence is created. After an outage of any length, each profile gets one catch-up run, not a backlog. Overlapping ticks cannot duplicate work, because `(profile_id, dataset_id, scheduled_time)` is unique.

## Dispatching

`CREATED` jobs are checked in one statement and moved on:

| Condition | Result |
|---|---|
| Export disabled | `CANCELLED` |
| Cluster retired, dataset disabled or without SQL, destination disabled or without a provider, incremental without a watermark column | `FAILED` with the reason |
| Otherwise | `QUEUED` |

## Reclaiming

A job held by an agent (`ASSIGNED`, `RUNNING`, `UPLOADING`) is reclaimed when:

- the agent was removed;
- the agent has not sent a heartbeat for 15 minutes (OFFLINE);
- the job stayed `ASSIGNED` for 10 minutes without starting;
- no progress has been reported for 150 minutes, the 7,200-second statement timeout plus headroom for upload.

A reclaimed job is re-queued after 2 minutes while `retry_count < max_retries`, and otherwise fails. The reason is kept in `error_message`.

## Metrics

Each tick samples `queue_depth` (CREATED and QUEUED jobs), `running_jobs`, `connected_agents` (heartbeat within 5 minutes) and `registered_agents` into `metric_samples`. The dashboard shows the last 24 hours of queue depth to platform admins.

## Testing

`cd plugins/data-export-scheduler && yarn test --watchAll=false` covers cron evaluation. The full scheduler runs against PostgreSQL in the control plane's integration suite.
