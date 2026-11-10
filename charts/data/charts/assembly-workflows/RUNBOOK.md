# Assembly Workflows — Operations Runbook

The devops handoff for running the platform on Kubernetes. [`DEPLOYMENT.md`](./DEPLOYMENT.md)
is the install walkthrough; this document is the operating contract: which
values file belongs to which cluster, the knobs you are expected to touch,
the invariants you must never break, and the procedures for upgrade,
rollback, and the known failure modes.

---

## 1. Deployment model

**Deploy = 1 command + 1 values file + secrets.** No overlay stacking.

```bash
helm upgrade --install assembly-workflows ./helm/assembly-workflows \
  -n assembly-workflows --create-namespace \
  -f helm/assembly-workflows/values-<cluster>.yaml \
  --set image.tag=<release-tag>
  # plus secret injection — see §4
```

### Values files

| File | Role |
|---|---|
| `values.yaml` | Chart defaults. Perf-validated on the tierA cluster — these ARE the tuned settings; a plain install is already fast. Never deploy-edit this; change a cluster's canonical file. |
| `values-dev.yaml` | **Canonical** for `assembly-aks-dev`. Complete delta vs defaults; CI deploys exactly this + `--set image.tag`. |
| `values-demo.yaml` | **Canonical** for `assembly-aks-demo`. Real user accounts live here — see invariants. |
| `values-perf-tierA.yaml` | **Canonical** for the (currently spun-down) `assembly-perf-tierA` validation cluster. |
| `values-small/medium/large.yaml` | Sizing profiles for new self-hosted installs (node-count/resources only). |
| `values-prod-perf.yaml` | **Canonical perf profile** (~270k chain-M/hr OOTB). Deploy via `deploy/bootstrap.sh`; see `deploy/DEVOPS-RUNBOOK.md`. |

Starting a new cluster: copy the closest sizing/throughput profile to
`values-<cluster>.yaml`, fill in secrets out of band, record
`numHistoryShards` in it on day one, and treat that file as canonical
forever after.

---

## 2. The knobs (everything else is a default you should not need)

Chart-wide tuning has been deliberately collapsed: proven settings are chart
defaults, derived values derive (payload warn/trace derive from one hard
limit; gateway stream timeouts derive from one stream knob). The supported
surface is:

| # | Knob | Default | When to touch |
|---|------|---------|---------------|
| 1 | `image.tag` | release pin | Every deploy (`--set image.tag=…`). Per-service `<svc>.image.tag` exists for emergencies only. |
| 2 | `infra.enabled` | `false` | `true` = self-contained install. **Pin it explicitly in every canonical file** (see invariants). |
| 3 | `infra.temporal.numHistoryShards` | `512` | Once, before first install. **Immutable afterwards** (see invariants). |
| 4 | `infra.temporal.mode` | `auto-setup` | `split` past ~6 wf/s (separate frontend/history/matching/worker). |
| 5 | `infra.postgresTemporal.enabled` | `false` | Dedicated Temporal Postgres; the biggest single-node throughput win (~60%). |
| 6 | `infra.postgresTemporal.syncCommitOff` | `false` | `true` trades crash durability for throughput. Perf/dev only — never on clusters with real users. |
| 7 | `workflowResourceLimits.enabled` | `false` | `true` on multi-tenant clusters (per-user concurrency + daily quotas, Redis-backed). |
| 8 | `workflowStreamTimeoutSeconds` | `900` | One knob for workflow SSE: engine timeout + APISIX read timeouts (rendered at +60s). |
| 9 | `agentsWorker.replicas` (+ code/subflow pools) | 2/2/off | First scaling lever. Python event loop is per-pod: more replicas beats higher per-pod concurrency. |
| 10 | `agentsWorker.resources` | 512Mi–2Gi, no CPU limit | Workers burst; keep CPU uncapped, size memory with `maxCachedWorkflows`. |
| 11 | `agentsWorker.temporal.maxConcurrent{Activities,WorkflowTasks}` / `maxCachedWorkflows` | 400/300/1024 | Only downward, for small nodes (dev trims to 300/200/384 in 1Gi pods). |
| 12 | `ASSEMBLY_LOCAL_ACTIVITY_NODE_TYPES` (worker env) | `api_request,transform` | Add `custom_code` only where trusted in-process execution is acceptable. **Drain before first enablement** (see failure modes). |
| 13 | `ASSEMBLY_WORKFLOW_PAYLOAD_HARD_LIMIT_BYTES` (worker env) | `1800000` chart / `1200000` code | One knob; warn (80%) and trace (75%) ceilings derive. Clamped to ≤12M in code. Values >~2M only work for COMPRESSIBLE payloads (ZlibPayloadCodec compresses before Temporal's ~2MiB cap); incompressible >~2M needs blob-offload (#140). |
| 14 | `terminationGracePeriodSeconds` + `TEMPORAL_WORKER_GRACEFUL_SHUTDOWN_SECONDS` | 120 / 90 | Keep pod grace comfortably ABOVE worker drain or rotation SIGKILLs running activities. |
| 15 | `secrets.existingSecret` | `""` | Point at a Vault/SealedSecrets-managed Secret instead of chart-rendered secrets. |

If an investigation tempts you toward an env var not on this list, treat it
as a code/default problem and file it against the platform team rather than
pinning it in a values file — pinned one-off envs are how the 140-knob
surface grew the first time.

---

## 3. Invariants (break these and you lose data or the cluster)

1. **`numHistoryShards` is immutable per Temporal database.** dev = 256,
   demo = 256, tierA = 256 (recorded in each canonical file). Changing the
   value against an existing DB bricks Temporal. Verify with
   `temporal operator cluster describe` / `cluster_metadata_info` if unsure.
2. **`infra.enabled` must be pinned in every canonical file.** An upgrade
   rendered without it flips the release to external-infra mode and prunes
   the in-cluster Postgres. Defense in depth: the data PVCs (postgres,
   postgres-temporal, minio, mcp-hub workspaces) carry
   `helm.sh/resource-policy: keep`, so even a bad upgrade orphans rather
   than deletes them — but do not rely on that.
3. **The chart fails fast on placeholder/garbage secrets** (`REDACTED_*`
   anywhere, malformed fernet key, empty JWT secret). The escape hatch
   `--set validation.allowPlaceholders=true` is for `helm template` ONLY.
4. **Demo has real user accounts.** No `syncCommitOff` (the canonical file
   pins durable commits), keep `workflowResourceLimits.enabled: true`, and
   never point load tests at it.
5. **Helm lists replace, maps merge.** A values-file `extraEnv:` replaces
   the chart-default list wholesale; an empty map (`nodeSelector: {}`)
   does NOT clear keys. Both have bitten this repo — state what you mean
   explicitly in the canonical file.
6. **NEVER `--reuse-values` (and never `--reuse-values --set`).** This is the
   single most dangerous upgrade flag here. `--reuse-values` re-applies the
   PREVIOUS release's values ON TOP of your `-f` file, so your canonical file
   is silently overridden by stale state. Real incident (tierA, 2026-06-12):
   a `helm upgrade --reuse-values -f values-perf-tierA.yaml` reverted
   `infra.temporal.mode: split` back to a stale `auto-setup` — collapsing the
   4+4+4 split Temporal into ONE pod, a silent throughput cliff that looked
   like a perf regression. (`--reuse-values --set k=v` is worse: it also drops
   chart-default value sub-trees and fails on `validation.allowPlaceholders`.)
   ALWAYS pass the full canonical `-f` file with no `--reuse-values`; supply
   secrets via `secrets.existingSecret` (§4) or a persisted secrets `-f` file
   so there is nothing in the release that needs "reusing".
7. **`infra.temporal.mode` is load-bearing and must be pinned** in every
   canonical file (`split` for multi-infra-node clusters, e.g. `tierA`/`assembly-perf-high`). An
   upgrade that loses it (e.g. via invariant 6) reverts to single-pod `auto-setup` and caps
   throughput hard. **Exception: clusters provisioned with only 1 infra node** (e.g.
   `assembly-perf-small`, `assembly-perf-medium` — see `DEVOPS-RUNBOOK.md` §3's SIZE table)
   correctly run `auto-setup` by design (#1235, `perf-scripts/reset_size_safe.sh`): splitting
   Temporal into 4 separate deployments on a single node adds pod/scheduling overhead without
   adding capacity, since split mode's benefit comes from spreading pods across *multiple* infra
   nodes. Don't treat `auto-setup` on a 1-infra-node cluster as drift — check the cluster's actual
   infra node count before assuming this invariant was violated (a real false-alarm investigation
   closed as by-design: #1563).

---

## 4. Secrets

Canonical files in git are sanitized (`REDACTED_*`). Real values are
injected at deploy time, either:

- `--set secrets.jwtSecret=… --set secrets.fernetKey=…` (+ the rest; see
  DEPLOYMENT.md quick-start for the full set and generation commands), or
- `secrets.existingSecret: <name>` referencing a pre-provisioned Secret.

Fernet key must be a 44-char urlsafe-base64 string
(`python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`).
The chart validates the format at render time.

---

## 5. Procedures

### Upgrade

```bash
helm upgrade assembly-workflows ./helm/assembly-workflows \
  -n assembly-workflows \
  -f helm/assembly-workflows/values-<cluster>.yaml \
  --set image.tag=<new-tag>
```

- Always pass the canonical file (do not rely on `--reuse-values` across
  chart-version bumps — new chart defaults don't land under reuse).
- Engine pods restart whenever worker env defaults change; workers drain
  gracefully (90s) within the 120s pod grace.
- Split mode: schema-migration runs as a regular Job
  (`temporal-schema-migrate-r<revision>`); server pods gate on it via init
  containers — no `--no-hooks`, no manual ordering.

### Rollback

```bash
helm rollback assembly-workflows <revision> -n assembly-workflows
# or: helm upgrade … --set image.tag=<last-good-tag>
```

Schema migrations are forward-only; `helm rollback` does not downgrade
Temporal schemas (they are backward-compatible across one minor version).

### Verify after any deploy

```bash
kubectl get pods -n assembly-workflows                  # all Running/Completed
helm get values assembly-workflows -n assembly-workflows | grep -A1 numHistoryShards
kubectl logs deploy/assembly-engine-worker -n assembly-workflows | grep -i "worker started"
# Functional smoke: run a trivial workflow through the UI or API.
```

### Scaling for load

In order: (1) `agentsWorker.replicas` up; (2) enable `agentsSubflowWorker`;
(3) `infra.postgresTemporal.enabled: true`; (4) `infra.temporal.mode: split`.
Watch schedule-to-start latency and task-queue backlog (§6) between steps —
if backlog is empty, more workers will not help; the bottleneck is upstream.

---

## 6. Observability

Everything is annotation-discovered (`prometheus.io/*`) — any
annotation-aware scraper (including Azure Managed Prometheus) picks it up
with zero chart configuration:

| Target | Port | Source |
|---|---|---|
| Engine worker/code/subflow pods | `:9100` | Temporal SDK: schedule-to-start latency, slot usage, sticky cache hits |
| Temporal server (both modes) | `:8000` | persistence latency, shard lock contention, task-queue backlog |

Engine **web** pods are intentionally NOT scraped (multi-process uvicorn
cannot bind one metrics port). The dashboard that matters for scaling:
workflow/activity `schedule_to_start_latency`, task-queue backlog, sticky
cache hit rate, persistence latency.

---

## 7. Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Temporal crashloops after upgrade, logs mention shard count | `numHistoryShards` changed against existing DB | Revert the value. There is no in-place migration. |
| Install/upgrade fails with `values validation: …` | Placeholder/malformed secrets reached a real install | Inject real secrets (§4). Do NOT set `validation.allowPlaceholders` on an install. |
| Workflows panic with non-determinism errors mid-rollout | `ASSEMBLY_LOCAL_ACTIVITY_NODE_TYPES` changed under live workflows (env frozen at worker import) | Drain first: scale workers to 0 / let in-flight complete, then roll. Clusters already running the same value are unaffected. |
| Every workflow 429s for a user; Redis set `sdlc:active_workflows:<user>` full | Leaked concurrency slots (historical bug class) | Self-heals: web pods reconcile leaked slots every 15 min (`ASSEMBLY_SLOT_RECONCILE_INTERVAL_SECONDS`). Manual: `SREM` the stale workflow ids. |
| SSE stream dies at the gateway mid-workflow | A proxy timeout below `workflowStreamTimeoutSeconds` | Raise knob #8 (both sides re-render from it); check any LB in front of APISIX too. |
| Pod rotation kills running activities | Pod grace below worker drain | Keep `terminationGracePeriodSeconds` > `TEMPORAL_WORKER_GRACEFUL_SHUTDOWN_SECONDS` (defaults 120/90 are correct). |
| `helm uninstall` then reinstall shows old data | Data PVCs carry `resource-policy: keep` by design | Expected. Delete PVCs/namespace explicitly only when you truly mean to destroy data. |
| Image pulls fail on fresh cluster | No ACR access | `image.createPullSecret` (token) or pre-created `pullSecrets`. Also verify the tag exists — `az acr repository show-tags`. |
| `helm upgrade` fails: `Deployment "<svc>" is invalid: …env[N].valueFrom: may not be specified when value is not empty` | A legacy (pre-2026) deployment object has an env var carrying BOTH `value` and `valueFrom`; the strategic-merge patch can't reconcile it | One-time: `kubectl delete deploy <svc> -n assembly-workflows` so Helm recreates it cleanly from the current template, then re-run the upgrade. The current chart never renders both keys; this only affects deployments first created by old charts. |
| Throughput silently halves/collapses after a routine upgrade | Temporal reverted to single-pod `auto-setup` — almost always `--reuse-values` re-applying a stale `mode` (invariants 6/7) | `kubectl get deploy -n assembly-workflows | grep temporal` — if you see one `temporal` pod instead of `temporal-frontend/history/matching/worker`, re-upgrade with the full `-f` file and NO `--reuse-values`. |

---

## 8. Cluster inventory (2026-06)

| Cluster | Canonical file | Shards | Notes |
|---|---|---|---|
| `assembly-aks-dev` | `values-dev.yaml` | 256 | CI target (`deploy.yml`, manual dispatch). 4× 2-vCPU nodes — replica trims are load-bearing. |
| `assembly-aks-demo` | `values-demo.yaml` | 256 | Real users. Quotas on, durable commits, 12 workers (soak-validated). |
| `assembly-perf-tierA` | `values-perf-tierA.yaml` | 256 | Spun down; perf validation ladder. Resume = same file, same shards. |

## Worker-replica sizing (measured)

Workflow-worker replicas only help while they have **cores behind them**.
Measured on an 8-core compose box at C=1200 (chain-S, zero failures all
cells): 1 worker = 74.7k runs/hr, 3 = 87.3k (+17%, p50 −17%), 4 = 72k —
beyond ~cores/3, sticky-cache dilution and poller splitting outweigh the
added CPU even with idle headroom (workers at 38% CPU and throughput falls).
Cluster sizing profiles already respect this; when overriding `replicas`,
scale nodes first, replicas second, and expect a p95 cost from each
additional worker per workflow (sticky-cache spread). The same study
exonerated Temporal dynamic-config limits (rps/partitions/cache: no effect
at this scale) and attributed the residual single-box ceiling to
temporal-server task processing + PG WAL work — i.e., past ~cores/3 workers,
add nodes, not replicas.
