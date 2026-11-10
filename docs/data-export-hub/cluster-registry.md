# Cluster registry

Clusters are a first-class concept. Every export runs on one registered cluster, and every cluster belongs to one tenant and one environment. An export can only target a cluster of its own tenant and environment.

## Sources of clusters

| Source | How | Editable in Data Export Hub |
|---|---|---|
| **Platform Registry sync** (preferred) | Automatic every 30 minutes, or **Sync from Platform Registry** (platform admin) | No. Platform Registry is the source of truth; change the cluster there. |
| **Manual registration** | Clusters page → Register cluster (platform admin) | Yes, except tenant and environment once exports use the cluster |

### Platform Registry sync

The sync reads Platform Registry's tables (`pr_clusters`, `pr_platforms`, `pr_environments`, `pr_cloud_accounts`) from the same database and reconciles:

| Platform Registry | Data Export Hub |
|---|---|
| `cluster_type = AKS` or `provider = AZURE` | Synced. Other providers are ignored. |
| `pr_platforms.platform_code` | `tenant_id`, as a slug (`Metro Bank` → `metro-bank`) |
| `pr_environments.environment_name` | `prod`/`production`/`prd`/`live` → PRODUCTION; `stag*`/`uat`/`preprod` → STAGING; `sit`/`qa`/`test`/`int` → SIT; `dev*`/`sandbox` → DEVELOPMENT; otherwise PRODUCTION if `environment_type = prod`, else skipped |
| `pr_cloud_accounts.account_identifier` (a GUID) | `subscription_id` |
| `region`, `resource_group` | Copied |
| `status = active` | In service |
| Missing or not active | `is_retired = true` |

On each run, for each active AKS cluster:

- **Already linked** (same `platform_registry_id`): metadata is updated, and the cluster is restored if it was retired.
- **Manual cluster with the same tenant and name:** adopted. It is linked and becomes read-only.
- **Otherwise:** created.

A change of tenant or environment in Platform Registry is **not applied** to a cluster that exports use. Applying it would silently move those exports. It is reported in `skipped` instead. Every create, retire and restore is written to the audit trail with actor `system:data-export-scheduler`, or the platform admin who triggered the sync.

The result is reported as `{ created, updated, retired, restored, skipped[] }`.

## Retirement, never deletion

Clusters are never deleted. That preserves job history and audit references. Retiring a cluster:

- stops scheduling on it, because the scheduler skips retired clusters;
- fails any `CREATED` jobs at dispatch with "Cluster … is retired";
- blocks new exports and edits that target it;
- rejects its agents' calls with 403.

Restore returns it to service. Retired clusters are hidden from lists unless you filter with `includeRetired=true`.

## Health

Cluster health comes from its most recently seen agent ([data model](data-model.md#agents--agent-registry)):

- HEALTHY, heartbeat under 5 minutes
- WARNING, 5–10 minutes or the agent reports DEGRADED
- CRITICAL, 10–15 minutes
- OFFLINE, over 15 minutes or never

The dashboard counts healthy clusters against registered, non-retired clusters.

## Agents

An agent is registered on a cluster by a platform admin, with the **object id of its workload identity** (`identitySubject`). Version, status, capabilities and last-seen time come from the agent's heartbeats. Rotating an identity means updating `identitySubject`. Deregistering an agent deletes it and its heartbeat history; its job history stays.
