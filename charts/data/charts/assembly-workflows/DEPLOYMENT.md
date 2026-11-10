# Assembly Workflows — Deployment Guide

> Operating an existing cluster? See [`RUNBOOK.md`](./RUNBOOK.md) — the
> per-cluster canonical values, supported knob set, invariants, and failure
> modes. This guide covers first-time installs.

## Quick Start (self-contained, ~10 minutes)

This deploys everything — app services AND infrastructure (Postgres, Redis, Keycloak, Temporal) — into a single namespace.

### Prerequisites

- Kubernetes cluster (AKS, EKS, GKE, or local) with 3+ nodes
- `helm` 3.12+
- `kubectl` configured
- Access to `assemblyrgacr.azurecr.io` (ACR credentials provided separately)

### 1. Login to the image registry

```bash
helm registry login assemblyrgacr.azurecr.io \
  --username <provided-username> \
  --password <provided-password>
```

### 2. Create namespace

```bash
kubectl create namespace assembly-workflows
```

### 3. Install

```bash
helm install workflows \
  oci://assemblyrgacr.azurecr.io/helm/assembly-workflows \
  --version 0.4.0 \
  -n assembly-workflows \
  --set infra.enabled=true \
  --set infra.postgres.password="$(openssl rand -hex 16)" \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set secrets.fernetKey="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
  --set secrets.internalServiceApiKey="$(openssl rand -hex 24)" \
  --set secrets.llmGateway.userKeysInternalApiKey="$(openssl rand -hex 24)" \
  --set secrets.llmGateway.adminKey="$(openssl rand -hex 24)" \
  --set secrets.sandboxInternalServiceApiKey="$(openssl rand -hex 24)" \
  --set secrets.bootstrapAdminPassword="$(openssl rand -hex 16)" \
  --set infra.keycloak.adminPassword="$(openssl rand -hex 16)"
```

> **Both admin-password keys above are REQUIRED (#1584)**: `aw.validate.adminPasswords` fails the
> render if `secrets.bootstrapAdminPassword` is empty or the known repo default
> (`assembly-admin-rotateme`), or if `infra.keycloak.adminPassword` is empty or the known repo
> default (`changeme`) — this Quick Start omitted both until #1584 and would abort at `helm
> install` on any chart version with that gate. Save the values you generate here; you'll need
> `secrets.bootstrapAdminPassword` to log in (see step 5).

> **If you will ever `helm upgrade` this cluster, do NOT generate secrets with
> `--set` at install time.** Those random secrets live only in the Helm release,
> so every later upgrade is then tempted to use `--reuse-values` to keep them —
> and `--reuse-values` silently re-applies stale release values over your `-f`
> file (it reverted `infra.temporal.mode: split` → single-pod `auto-setup` on
> tierA, a throughput cliff; see RUNBOOK §3 invariants 6–7). Instead, put the
> secrets in a normal Secret once and reference it, so upgrades carry no secret
> state and never need `--reuse-values`:
>
> ```bash
> kubectl create secret generic assembly-workflows-secrets -n assembly-workflows \
>   --from-literal=jwt-secret="$(openssl rand -hex 32)" \
>   --from-literal=fernet-key="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
>   --from-literal=internal-service-api-key="$(openssl rand -hex 24)" \
>   --from-literal=sandbox-internal-service-api-key="$(openssl rand -hex 24)"
>   # ...PLUS every other key that templates/secrets.yaml lists — the
>   #    assembly-llm-gateway-*, workspace-manager-* and database-url keys are
>   #    referenced broadly (e.g. via aw.agentEnv on the workers and by
>   #    assembly-core), NOT only when the gateway/sandbox pods are enabled.
>   #    An existingSecret MUST be complete or pods crash with SecretKeyRef
>   #    errors — diff against `helm template ... --show-only templates/secrets.yaml`.
> # then install/upgrade with:  --set secrets.existingSecret=assembly-workflows-secrets
> ```
> Upgrades become a plain
> `helm upgrade --install workflows oci://assemblyrgacr.azurecr.io/helm/assembly-workflows -n assembly-workflows -f values-<cluster>.yaml --set image.tag=…`
> (no `--reuse-values`, no `--set secrets.*`).

For small clusters (3 nodes / B2ms), add: `-f values-small.yaml`

### 4. Wait for pods

```bash
kubectl get pods -n assembly-workflows -w
```

All pods should reach `Running` within 3-5 minutes.

### 5. Access

```bash
kubectl -n assembly-workflows port-forward svc/apisix 9080:80
# Open http://localhost:9080
```

Log in as `admin@assembly.dev` using the `secrets.bootstrapAdminPassword` value you set in step 3
(there is no forced password reset — the seeded credential is set directly with `"temporary":
false`, so whatever you generate there is the real, permanent login).

---

## Bring Your Own Infrastructure

If you already have Postgres, Redis, Keycloak, and Temporal running, skip the infra toggle and point at them:

```bash
helm install workflows \
  oci://assemblyrgacr.azurecr.io/helm/assembly-workflows \
  --version 0.4.0 \
  -n assembly-workflows \
  --set externalInfra.postgres.url="postgresql+asyncpg://user:pass@your-postgres:5432/workflows_db" \
  --set externalInfra.redis.url="redis://your-redis:6379/0" \
  --set externalInfra.keycloak.serverUrl="http://your-keycloak:8091" \
  --set externalInfra.temporal.host="your-temporal:7233" \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set secrets.fernetKey="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
  --set secrets.internalServiceApiKey="$(openssl rand -hex 24)" \
  --set secrets.llmGateway.userKeysInternalApiKey="$(openssl rand -hex 24)" \
  --set secrets.llmGateway.adminKey="$(openssl rand -hex 24)" \
  --set secrets.sandboxInternalServiceApiKey="$(openssl rand -hex 24)"
```

---

## Sizing Profiles

| Profile | Nodes | Throughput | Monthly cost (AKS) |
|---------|-------|-----------|---------------------|
| `values-small.yaml` | 3× B2ms | ~1 wf/s | ~$250 |
| default (`values.yaml`) | 3-4 D4ds_v4 | ~2 wf/s | ~$500 |
| **`values-prod-perf.yaml`** | **5× D4ds_v4 app + 2× D4ds_v4 infra** | **~270k chain-M/hr (~75 wf/s)** | **~$1,300** |

### Performance deployment — one command

The perf profile (`values-prod-perf.yaml`) is deployed by **`deploy/bootstrap.sh`**, which automates
everything the old manual profiles required — node-pool `workload=app|infra` labels + taints, the full
per-service image set (including the gate-retired `wv-nogate` engine build that delivers the throughput),
internal-secret generation, the perf mock, and a webhook smoke that fails loud if the platform isn't
executing. It produces **~270k chain-M/hr out of the box, with no tuning**:

```bash
RG=<rg> CLUSTER=<aks-name> IMAGE_TAG=<engine-tag> ./deploy/bootstrap.sh --perf
```

See **`deploy/DEVOPS-RUNBOOK.md`** for the full perf deploy / verify / troubleshoot guide. Under the
hood the profile runs a dedicated infra tier (`infra.temporal.mode=split` + a dedicated Temporal
Postgres with `synchronous_commit=off`), 16 engine-worker replicas, and the Temporal dynamic-config
(24 task-queue partitions, tuned persistence QPS / poll RPS). **Worker-versioning stays off** — enabling
it craters throughput (the versioned task queue loses the partition tuning).
- **Schema migration job** runs automatically on install/upgrade

The schema migration job upgrades Temporal's visibility schema from v1.9
(auto-setup default) to v1.13 (required by `temporalio/server:1.30.4`).
It runs as a regular Job (`temporal-schema-migrate-r<revision>`) deployed
with the release — not a pre-install hook — so fresh installs work without
any `--no-hooks` workaround. Temporal server pods gate on schema readiness
via init containers and start once migration completes.

---

## Upgrading

```bash
helm upgrade workflows \
  oci://assemblyrgacr.azurecr.io/helm/assembly-workflows \
  --version <new-version> \
  -n assembly-workflows \
  --reuse-values
```

### First upgrade onto local-activity dispatch

Chart defaults now set `ASSEMBLY_LOCAL_ACTIVITY_NODE_TYPES=api_request,transform`
on the engine workers. The set is frozen at worker import, so during a rolling
update old pods (empty set) and new pods (enabled) coexist — a workflow replayed
across the two can hit a non-determinism panic. On clusters upgrading from chart
defaults **without** a perf overlay that already set this env, drain in-flight
workflows first (scale the worker Deployment to 0, wait for running workflows to
finish or pause traffic, then upgrade). Clusters already running the perf overlay
(`values-prod-perf.yaml`) are unaffected — the value is unchanged.

---

## Uninstalling

```bash
helm uninstall workflows -n assembly-workflows
kubectl delete namespace assembly-workflows
```

Note: the data-bearing PVCs (postgres, postgres-temporal, minio, mcp-hub
workspaces) carry `helm.sh/resource-policy: keep`, so `helm uninstall`
orphans them instead of deleting them. Deleting the namespace (second
command) removes them — and the data — for real.

Note: this deletes all data (Postgres PVC is in the namespace). Back up first if needed.

---

## TLS termination

HTTPS in front of the gateway is off by default (`apisix.tls.enabled: false` →
plain HTTP on `:80`). When you enable it, `apisix.tls.mode` picks **how** TLS is
terminated:

| Mode | Who terminates | Use when | Cert source |
|---|---|---|---|
| `apisix` (default) | APISIX itself, on `:443` | standalone clusters with **no** shared ingress-nginx (our dev AKS, SCP) — the gateway is the front door on its own LB | `apisix.tls.existingSecret` is mounted into the pod and an init-container splices it into APISIX's `ssls` at startup (no cluster `lookup`, no cert/key in a ConfigMap; a cert rotation is picked up on the next pod restart) |
| `ingress` | an ingress-nginx `Ingress` | clusters that already run **ingress-nginx + cert-manager** (assembly next to InvHub) | referenced by the Ingress; with `apisix.tls.ingress.clusterIssuer` set, cert-manager's ingress-shim issues + renews it, else the Secret must pre-exist |

In `ingress` mode the gateway Service stays a `ClusterIP`, APISIX runs with TLS
off behind the controller, and the `Ingress` carries the public host. This is the
standard k8s pattern — the way the shared InvHub cluster already terminates TLS.
`apisix.tls.publicHostname` is required whenever TLS is enabled (it drives the
Keycloak issuer, the OIDC redirect URIs, and the Ingress host). See
`values-invhub-dev.yaml` (`ingress`) and `values-dev.yaml` / `values-scp.yaml`
(`apisix`) for worked overlays.

## Deploying on SCP (Sensa Cloud Platform)

SCP is a customer/prod Azure landing zone deployed by the platform team's
`pipeline-internal` helmfile (chart pulled from an OCI ACR, secrets from
1Password). Assembly runs as a self-contained app that owns its APISIX gateway on
a **dedicated internal Azure LB** (not fronted by shared ingress-nginx). Use the
committed `values-scp.yaml` overlay as the starting point.

The chart-side knobs SCP relies on — `global.imageRegistry` (mirror ACR for
third-party images), `apisix.tls.existingSecret` (synced wildcard cert),
`externalInfra.keycloak.realm`, and
`imagePullSecrets` on every infra pod — are all documented above. The full
onboarding runbook, including the work outside this repo (ACR/image mirroring,
1Password items, `pipeline-internal` onboarding files, the privileged
`sandbox-execute` PodSecurity ruling, and the dev-cluster validation gate), lives
in [`docs/scp-deployment.md`](../../docs/scp-deployment.md).

## Configuration Reference

### Key values

| Value | Default | Description |
|-------|---------|-------------|
| `infra.enabled` | `false` | Deploy Postgres, Redis, Keycloak, Temporal |
| `infra.postgres.password` | `""` | Required when `infra.enabled=true` |
| `secrets.bootstrapAdminPassword` | `""` | Required when `infra.enabled=true` — the `admin@assembly.dev` login password; render fails if empty/default (#1584) |
| `infra.keycloak.adminPassword` | `""` | Required when `infra.enabled=true` — Keycloak console admin password; render fails if empty/default (#1584) |
| `infra.postgres.storage` | `20Gi` | PVC size for Postgres |
| `infra.postgres.storageClass` | `managed-csi` | Storage class (change for non-Azure) |
| `image.registry` | `assemblyrgacr.azurecr.io` | Registry for the first-party app images |
| `global.imageRegistry` | `""` | Optional mirror registry for the **bundled third-party** images (postgres, redis, keycloak, temporal\*, minio/mc, apisix); set for air-gapped/SCP clusters. Empty = images left byte-for-byte unchanged |
| `apisix.service.type` | `ClusterIP` | Set to `LoadBalancer` for public/internal-LB access |
| `apisix.tls.enabled` | `false` | Enable HTTPS on APISIX |
| `apisix.tls.existingSecret` | `apisix-tls` | Name of the pre-existing TLS Secret APISIX terminates from (point at a synced wildcard secret to reuse a shared cert) |
| `apisix.cors.allowOriginsRegex` | localhost + github.dev | Browser origins for the global **and** per-route CORS blocks (overriding REPLACES the list — restate defaults) |
| `urlValidation.allowHosts` | `""` | Comma-separated exact hostnames **or `*.suffix` wildcards** exempt from the SSRF guard's private-IP block on `api_request`/webhook URLs (engine + workers + mcp-hub + llm-gateway). Public hosts never need listing. A wildcard never opens platform infra (postgres/keycloak/redis/…); empty = fail-closed |
| `urlValidation.extraAllowHosts` | `""` | Merged with `allowHosts`, same grammar. For entries that shouldn't be committed (a customer's internal zone) or should change without a release. Already wired to `ref+op://…/urlValidation__extraAllowHosts` in `values-dev.yaml` + `values-invhub-dev.yaml` (fields exist, empty → renders nothing); opening a domain is a 1Password edit + re-run of `deploy.yml`. `vals` fails closed on a **missing** field, so create it before wiring a new target and never delete one that's referenced — see [docs/deploy.md](../../docs/deploy.md) |
| `sandboxTrigger.webhookRunAllowlist` | `""` | Emails/subs allowed to invoke deployments they don't own on the `/run` + webhook path (InvHub drop-in); empty = fail-closed |
| `infra.keycloak.flowsIntegration.enabled` | `false` | Seed + converge the InvHub ROPC client (`workflow-canvas`) and service user (kcadm Job on every upgrade) |
| `secrets.invhubServiceUserPassword` | `""` | Required when `flowsIntegration.enabled=true` — must equal InvHub's `flows` Secret password (shared contract, never generated) |
| `secrets.existingSecret` | `""` | Use an existing Secret (for Vault/SealedSecrets) |
| `externalInfra.keycloak.realm` | `assembly-platform` | Keycloak realm name — now honoured everywhere (realm seed + all APISIX OIDC routes + eureka rewrite), so a non-default realm applies cleanly |
| `platform.authMode` | `keycloak` | Authentication mode |
| `sandboxTrigger.aliasResolutionEnabled` | `true` | Resolve `/webhook/{workflow_id}/aliases/{tag}` to the deployment the alias points at, so integration URLs survive a redeploy ([docs](../../docs/webhook-aliases.md)). Set `false` to revert to pre-alias behaviour without a rollback |
| `sandboxExecute.enabled` | `true` | Code execution service |
| `mcpHub.enabled` | `true` | MCP server management |
| `agentsSubflowWorker.enabled` | `false` | Extra worker pool (for scale) |
| `infra.postgresTemporal.enabled` | `false` | Dedicated Postgres for Temporal (improves throughput ~60%) |
| `infra.nodeSelector` | `{}` | Schedule infra pods on specific nodes |
| `infra.tolerations` | `[]` | Tolerations for infra pods |
| `agentsCodeWorker.trustedCodeInprocess` | `false` | Run trusted custom_code via exec() instead of sandbox |
| `agentsWorker.temporal.disableResourceTuner` | `false` | Disable Temporal resource-based tuner for fixed concurrency |
| `infra.temporal.mode` | `auto-setup` | `auto-setup` (single pod) or `split` (separate services for high throughput) |
| `infra.temporal.split.history.replicas` | `8` | History service replicas in split mode |
| `infra.temporal.split.matching.replicas` | `2` | Matching service replicas in split mode |
| `infra.temporal.split.frontend.replicas` | `1` | Frontend service replicas in split mode |

### Mirroring images to your own registry

```bash
IMAGES="agents llm-gateway user-project frontend sandbox mcp-hub"
TAG="release-v1.0.0-0b3a19ce2"

for img in $IMAGES; do
  docker pull assemblyrgacr.azurecr.io/$img:$TAG
  docker tag assemblyrgacr.azurecr.io/$img:$TAG your-registry.example.com/$img:$TAG
  docker push your-registry.example.com/$img:$TAG
done
```

Then install with: `--set image.registry=your-registry.example.com`

---

## Architecture

```
                    ┌─────────────┐
                    │   APISIX    │ ← port 80 (HTTP) / 443 (HTTPS)
                    │  (gateway)  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
  ┌─────┴─────┐    ┌──────┴──────┐    ┌──────┴──────┐
  │ frontend  │    │   agents    │    │ user-project│
  │  (React)  │    │  (API pod)  │    │  (metadata) │
  └───────────┘    └──────┬──────┘    └─────────────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
     ┌─────┴──────┐ ┌────┴─────┐ ┌──────┴───────┐
     │   worker   │ │   code   │ │  llm-gateway  │
     │  (Temporal)│ │  worker  │ │  (LLM proxy)  │
     └────────────┘ └──────────┘ └───────────────┘

  Optional: sandbox-execute, sandbox-trigger, mcp-hub
```

When `infra.enabled=true`, the chart also deploys:

```
  ┌──────────┐  ┌───────┐  ┌──────────┐  ┌──────────┐
  │ Postgres │  │ Redis │  │ Keycloak │  │ Temporal │
  └──────────┘  └───────┘  └──────────┘  └──────────┘
```

All within the same namespace — no cross-namespace dependencies.
