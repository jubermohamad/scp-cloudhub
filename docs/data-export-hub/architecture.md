# Architecture

## Responsibilities

| Component | Owns | Never does |
|---|---|---|
| **Control plane** (CloudHub backend plugin `data-export`) | Data catalog, export profiles, destinations, cluster and agent registries, job state, watermarks, audit, dashboard | Execute SQL, read customer data, write files, contact clusters |
| **Scheduler** (CloudHub backend plugin `data-export-scheduler`) | Turning cron schedules into jobs, dispatching them to the queue, reclaiming jobs from lost agents, metric sampling, housekeeping, triggering cluster sync | Assign jobs to agents |
| **Export agent** (`data-export-agent`, one per AKS cluster) | Claiming its cluster's jobs, running the read-only extract, writing and uploading files, writing the manifest, reporting state and heartbeats, live destination checks | Accept inbound connections from CloudHub; see other clusters' jobs |
| **Platform Registry** (existing CloudHub plugin) | The authoritative list of AKS clusters, their tenants and environments | — |

## Topology

```
                     CloudHub (Backstage backend, N replicas)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  data-export (control plane)                 data-export-scheduler      │
 │  ├─ user API  /api/data-export/*     ◀──┐    ├─ tick (1 min, global)     │
 │  ├─ agent API /api/data-export/agent/*  │    │   create → dispatch →     │
 │  └─ internal  /internal/clusters/sync ◀─┼────┤   reclaim → metrics       │
 │                     │                   │    ├─ cluster sync (30 min)    │
 │                     ▼                   │    └─ housekeeping (6 h)       │
 │         PostgreSQL schema data_export ◀─┘                               │
 │         (jobs = the queue; pr_* = Platform Registry)                     │
 └───────────────────────────────▲──────────────────────────────────────────┘
                                 │ HTTPS, outbound from each cluster only
                                 │ Bearer = Entra token (Azure Workload Identity)
        ┌────────────────────────┴───────────────────────┐
        │ AKS cluster (×70+), namespace cloudhub-system  │
        │  data-export-agent (replicas: 1)               │
        │   ├─ heartbeat every 60 s                      │
        │   ├─ claim → RUNNING → UPLOADING → complete    │
        │   ├─ PostgreSQL read replica (Entra auth,      │
        │   │   READ ONLY session, 7200 s timeout)       │
        │   └─ upload: ADLS Gen2 (workload identity)     │
        │              SFTP (key from Key Vault, pinned  │
        │                    host key)                   │
        └────────────────────────────────────────────────┘
```

All traffic is initiated by agents. CloudHub needs no network path into any cluster, so onboarding a cluster never involves an inbound firewall change.

## Life of a scheduled export

1. **Schedule.** Every minute the scheduler finds enabled profiles on non-retired clusters whose cron fired since `last_scheduled_at`. It inserts one `CREATED` job per dataset for that occurrence. The unique key `(profile_id, dataset_id, scheduled_time)` makes this idempotent.
2. **Dispatch.** In the same tick, `CREATED` jobs are checked against the export, cluster, dataset and destination. Runnable jobs become `QUEUED`. Others become `FAILED` or `CANCELLED` with a reason, so agents only see work they can do.
3. **Claim.** The cluster's agent polls `POST /agent/jobs/claim`. The control plane picks the highest-priority due job for that cluster with `FOR UPDATE SKIP LOCKED`, marks it `ASSIGNED`, and returns a `JobSpec`. The spec carries the SQL, mode, format, destination and current watermark.
4. **Extract.** The agent opens a guarded read-only session to its PostgreSQL read replica, streams rows into the output format, and reports `RUNNING` progress.
5. **Deliver.** The agent reports `UPLOADING`, then uploads the data file, `checksum.sha256` and `manifest.json`, with the manifest last.
6. **Complete.** `POST /agent/jobs/{id}/complete` marks the job `COMPLETED`. For incremental exports it advances the watermark in the same transaction.
7. **Failure.** `POST /agent/jobs/{id}/fail` re-queues retryable failures with exponential backoff while attempts remain, and otherwise marks the job `FAILED`. If the agent goes silent, the scheduler reclaims its jobs after 15 minutes.

Manual runs (`Run now`) skip steps 1 and 2. They insert `QUEUED` jobs directly at priority 200, after the same checks.

## Job states

```
CREATED ──dispatch──▶ QUEUED ──claim──▶ ASSIGNED ──▶ RUNNING ──▶ UPLOADING ──▶ COMPLETED
   │                    ▲  ▲                │            │            │
   │                    │  └── retryable fail / agent lost (attempts left)
   ▼                    │                   ▼            ▼            ▼
FAILED / CANCELLED      └─── manual retry ─ FAILED ◀── (no attempts left / non-retryable)
                                            CANCELLED ◀── user cancel (any unfinished state)
```

## Scale

The design targets 70+ clusters and 1000+ profiles:

- **Queue.** `jobs` is the queue. Claims use a partial index on `QUEUED` rows per cluster and `SKIP LOCKED`, so agents never block each other and backend replicas can serve claims concurrently.
- **Scheduler.** One tick evaluates every enabled profile in memory, which is about a millisecond per profile. It runs once across all replicas, using Backstage's scheduler with `scope: 'global'`.
- **Fleet traffic.** 70 agents send about 1.2 heartbeats per second in total, plus claim polls every 15 seconds while idle. Heartbeat history is pruned after 7 days.
- **UI.** Every list is server-paginated, sorted and filtered, with whitelisted sort keys and indexed filters.
- **Fault isolation.** Each cluster's agent only reads its own cluster's queue, so one slow cluster cannot delay another.

## Tenancy

Every export, job, cluster and tenant-owned destination carries a `tenant_id`. All user queries are scoped in SQL to the caller's tenants. See [tenant isolation](tenant-isolation.md).
