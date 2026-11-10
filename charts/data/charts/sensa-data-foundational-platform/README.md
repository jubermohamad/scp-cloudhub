# Prism Helm chart

Packages the stack that `deploy/remote/*.yaml` applies by hand: the API, the
console, the AI assistant, and the three stores they own — Neo4j (graph
projection), the ledger Postgres (truth) and the warehouse Postgres (derived,
disposable).

Chart `sensa-data-foundational-platform`, images `prism-api:v22`,
`console:v9`, `chat-backend:v12`.

## Install

Standalone, reproducing today's `prism` namespace layout:

```bash
helm upgrade --install prism deploy/helm -n prism --create-namespace \
  --set fullnameOverride=prism
```

`fullnameOverride=prism` keeps resource names short (`prism-api`,
`prism-console`, `prism-neo4j`, …). Without it, names are
`<release>-data-prism-<component>` — the convention the SRI platform requires
when this chart is installed as a data-domain subchart.

### Prerequisites — the chart reads these, it never creates them

Every credential lives in a Secret you install first. The chart holds no
credential values, which is also why it cannot create them for you.

| Secret | Keys | What it is |
|---|---|---|
| `neo4j-auth` | `NEO4J_AUTH` (`neo4j/<password>`), `password` | Graph credential. Both keys are the same password in two shapes: the image reads `NEO4J_AUTH`, the clients read `password`. |
| `ledger-pg` | `password` | The LEDGER credential — truth. Never reuse it for the warehouse. |
| `warehouse-pg` | `password` | The WAREHOUSE credential — disposable data plane. |
| `anthropic-auth` | `api_key` | The assistant's model credential. **Optional**: without it the pod runs and the assistant answers "not logged in" rather than crashlooping. |
| `symphonyfs-acr-secret` | `.dockerconfigjson` | Pull secret for `symphonyfs.azurecr.io` — the org-standard registry (see `values.yaml`'s `image:` and `imagePullSecrets:` comments for the fsaisrieurekaaiacr → symphonyfs cutover). The CD pipeline's `prepare_env: true` step creates this from the org-level `INVHUB_DOCKERCONFIGJSON` secret if it is missing; it never overwrites one that already exists. |

```bash
kubectl -n prism create secret generic neo4j-auth \
  --from-literal=NEO4J_AUTH="neo4j/$PW" --from-literal=password="$PW"
```

A StorageClass named `managed-csi` must exist (AKS default). Override per store
with `infra.<store>.persistence.storageClass`.

## Layout

| Component | Values key | Notes |
|---|---|---|
| API | `api` | **One replica, `Recreate` strategy** — the write lock lives in the process. Do not scale. |
| Console | `console` | Static nginx; proxies `/rigraph/` → API and `/chat/` → assistant. |
| Assistant | `chatBackend` | Runs as uid 10001 (the claude CLI refuses `bypassPermissions` as root). |
| Neo4j | `infra.neo4j` | Community Edition, single instance. Heap/pagecache pinned so the JVM cannot overshoot `limits.memory`. |
| Ledger Postgres | `infra.ledgerPostgres` | Truth. Separate instance and separate credential from the warehouse **by design**. |
| Warehouse Postgres | `infra.warehousePostgres` | Disposable; its databases are created by the restore/rebuild jobs, not by the image entrypoint. |

### The console's nginx config is rendered, not baked

The console image ships an `nginx.conf` that proxies to the bare service names
`prism-api` and `chat-backend`. Because this chart scopes every Service name to
the release, that baked file cannot resolve them — so the chart renders its own
`default.conf` from the same helpers everything else uses and mounts it over the
image's copy. `console.overrideNginxConf=false` disables that, which is only
correct if you have also pinned the service names back to the bare originals.

### Pointing Prism at existing infrastructure

Each store has a switch. Flip it off and supply the endpoint; every consumer
(including the warehouse jobs' `psql -h`) follows from one helper:

```bash
helm upgrade prism deploy/helm -n prism \
  --set infra.ledgerPostgres.enabled=false \
  --set externalInfra.ledgerPostgres.host=sri-qa-postgres-rw.sri-qa.svc.cluster.local
```

`externalInfra.ledgerPostgres.dsn` overrides the composed DSN outright if the
platform hands you one.

**An external server needs its databases created.** Turning a store off stops
the chart running a server; it does not make the databases appear on the one you
pointed at. The bundled StatefulSets get theirs for free (the postgres
entrypoint creates `POSTGRES_DB`; the restore job creates the warehouse
databases) — an external server has neither, so `ensureDatabases` provisions
them:

```bash
helm upgrade prism deploy/helm -n prism \
  --set infra.ledgerPostgres.enabled=false \
  --set externalInfra.ledgerPostgres.host=sri-qa-postgres-rw.sri-qa.svc.cluster.local \
  --set ensureDatabases.adminExistingSecret=sri-qa-postgres-superuser
```

One Job **per server** (`…-ensure-db-ledger`, `…-ensure-db-warehouse`), because
truth and the warehouse are separate failure domains *and* separate credential
domains — the owner passwords live in different secrets so that no warehouse
credential can reach truth. Each Job waits for the server, creates the role
(keeping its password in step with the secret the apps read), then creates each
database owned by that role. Idempotent, so re-running is a no-op.

| Setting | Default | Notes |
|---|---|---|
| `ensureDatabases.enabled` | `true` | Renders only for stores that are external. |
| `ensureDatabases.includeBundled` | `false` | Bundled servers do not need it, and as a pre-hook it would deadlock on a server this release creates. Set `true` and the Job switches itself to a post-hook. |
| `ensureDatabases.adminExistingSecret` | — | **Required** when the Job renders. Superuser credential, keys `username`/`password` (CNPG's superuser secret shape). Per-server override under `ensureDatabases.{ledgerPostgres,warehousePostgres}`. |
| `ensureDatabases.backoffLimit` | `6` | ~10 min of backoff on top of the in-pod `pg_isready` loop — rides out a failover, still fails fast on a bad credential. |
| `warehouseDatabases` | `kyc_warehouse`, `foundation_warehouse` | Named once: this Job creates them and the restore Job seeds each from `/dumps/<name>.sql`. |

Database and role names come from the same values the apps use
(`infra.*.database`, `infra.*.user`, or their `externalInfra` counterparts), so a
second environment can rename them without editing templates.

## Operational jobs

All four are **off** by default and none is a helm hook — they are run on
demand, and a hook would re-run them on every upgrade (two of them destroy
data). Enable, `helm upgrade`, wait, disable again.

| Job | Values key | Effect |
|---|---|---|
| reproject | `jobs.reproject` | Rebuilds the derived stores from truth: wipes the graph, `TRUNCATE term_version`. Never touches `changeset`. |
| restore-warehouses | `jobs.restoreWarehouses` | Creates `kyc_warehouse` / `foundation_warehouse` from the dumps in the API image. **Skip-if-exists**, so it cannot carry a schema change. |
| rebuild-warehouse | `jobs.rebuildWarehouse` | `DROP DATABASE` + restore. Use when the shipped dump intentionally replaces the remote one. |
| reset-world | `jobs.resetWorld` | **DESTRUCTIVE**: `TRUNCATE term_version, changeset` — discards this environment's world. Archive first with `scripts/export_ledger.py`; reinstall records with `scripts/sync_ledger.py`. |

### Destructive jobs refuse to run against a server this release does not own

`enabled: true` was written when the only possible target was this release's own
bundled server. Pointing a store at an external one — the platform's shared
Postgres, or a shared Neo4j — changes what those statements mean: a `DROP
DATABASE` or a whole-graph `DETACH DELETE` would destroy data other products
depend on, from a single line in an environment overlay.

So three of the jobs carry a **second gate that only applies in external mode**,
and a missing opt-in **fails the render**. It is deliberately not a silent skip:
a skipped destructive job reads as "it ran".

| Job | Guarded when external | Statement |
|---|---|---|
| `reproject` | Neo4j | `MATCH (n) DETACH DELETE n` over the entire database |
| `reset-world` | Neo4j **or** ledger Postgres | whole-graph delete **and** `TRUNCATE term_version, changeset` (truth) |
| `rebuild-warehouse` | warehouse Postgres | `DROP DATABASE <db>` |

`restore-warehouses` is **not** guarded: it is skip-if-exists and only ever
`CREATE DATABASE` + load a dump into a database it just created. It never drops
or overwrites existing data.

`reproject`'s ledger side (`TRUNCATE term_version`) is deliberately **not**
guarded either: that table is Prism's own projection inside Prism's own
database, so on a shared server it cannot reach another product — and guarding
it would block the configuration the platform actually wants (platform Postgres
for the ledger, bundled graph).

Overriding is a deliberate, audited choice — the flag is per job, so authorising
a warehouse rebuild never silently authorises truncating truth:

```bash
helm upgrade prism deploy/helm -n prism \
  --set jobs.rebuildWarehouse.enabled=true \
  --set jobs.rebuildWarehouse.allowExternalDestructive=true   # I mean it
```

**Recommendation: keep the warehouse bundled** (`infra.warehousePostgres.enabled:
true`). It exists to be dropped and rebuilt from dumps, which is a poor fit for a
server shared with everything else; the ledger is the store worth moving to the
platform's managed Postgres.

A Job's spec is immutable, so re-running with a changed body needs a new name —
use `nameSuffix` (this is why the live namespace holds `reproject-v16/-v20/-v22`):

```bash
helm upgrade prism deploy/helm -n prism \
  --set jobs.reproject.enabled=true --set jobs.reproject.nameSuffix=v23
```

`ttlSecondsAfterFinished` is 7200 everywhere: a TTL shorter than helm's `--wait`
reaps the completed Job before the watcher sees it, failing a release that
actually worked.

## Ingress

Off by default. Inside the SRI platform the portal proxies the console
same-origin, and a second public hostname would publish the same app under a
second identity — its own certificate, its own Keycloak redirect surface, its
own login. Enable it only for a standalone install with no portal in front; one
host in front of the console reaches all three services, since its nginx already
routes `/rigraph/` and `/chat/`.

## Not in this chart

- `deploy/liquibase/` — generated changelogs applied by developer tooling, not
  by any workload here.
- The Azure File secret present in the live namespace
  (`azure-storage-account-*-secret`): no manifest in this repo mounts it, so
  nothing here references it.
- Secrets, as above.
