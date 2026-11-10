# assembly-platform

Assembly Platform Workflows Module — visual workflow authoring with AI agents, an LLM
gateway, and Temporal-based execution. Deployed as a single self-contained release into
one namespace.

This document is the SCP onboarding reference for the chart. It answers, in order, the
requirements in [Requirements for adding any New Apps to the SCP Deployment
Pipeline](https://netreveal.atlassian.net/wiki/spaces/CDOPSNROD/pages/595067185).

- [1. Chart and deployment model](#1-chart-and-deployment-model)
- [2. common-res](#2-common-res)
- [3. Platform / infrastructure requirements](#3-platform--infrastructure-requirements)
- [4. Required secrets](#4-required-secrets)
- [5. Values files](#5-values-files)
- [6. Project & environment-specific values](#6-project--environment-specific-values)
- [7. Passwords and rotation](#7-passwords-and-rotation)
- [8. Endpoints and their protection](#8-endpoints-and-their-protection)
- [9. Maintenance enablement](#9-maintenance-enablement)
- [10. Image sources](#10-image-sources)
- [11. Ingress](#11-ingress)
- [12. PVCs](#12-pvcs)
- [13. Namespace naming](#13-namespace-naming)

---

## 1. Chart and deployment model

Published to the SAI Helm repository as `assembly-platform`:

```bash
helm search repo symphonyfs/assembly-platform --versions
```

The chart is **self-contained**: no subchart dependencies, no `Chart.lock`, and nothing
fetched at install time. Deployment is pure Helm — there are no shell scripts, `az` CLI
calls, `kubectl` steps, or Terraform in the deploy path. Everything that has to happen
before the app serves traffic (schema migration, database and bucket creation, Temporal
namespace registration) runs as an in-chart Job:

| Job | Purpose |
|---|---|
| `postgres-init` | creates the application database and grants |
| `assembly-core-migrate-r<revision>` | Alembic schema migration |
| `minio-createbucket` | creates the object-storage buckets |
| `temporal-namespace-setup` | registers the Temporal namespace |
| `keycloak-flows-integration` | *optional* — seeds the InvHub Copilot ROPC client |

The chart carries **no credentials, certificates, or private keys**. Every secret is an
input value; a missing one fails at render time rather than deploying something insecure
(see [§7](#7-passwords-and-rotation)).

Validated by manual deployment on a DEV SCP AKS cluster before onboarding, per
requirement 1: 18/18 pods Ready, all Jobs Complete, `/api/v1/health` 200, reached
end-to-end through the shared ingress-nginx with wildcard TLS. No manual workarounds
were required.

---

## 2. common-res

`common-res` is expected to be present on the cluster; this chart consumes it and never
duplicates it. Specifically, this chart does **not** ship — and must never ship —
StorageClasses, ClusterIssuers, the ingress-nginx controller, cert-manager, the
CloudNativePG / EDB / MinIO / Strimzi / Argo / OpenTelemetry / Jaeger operators,
`reloader`, or kube-prometheus.

What it consumes from the cluster:

| Provided by common-res | Consumed as |
|---|---|
| ingress-nginx | `apisix.tls.ingress.className: nginx` |
| StorageClasses | `managed-csi`, `managed-csi-premium` (overridable per PVC) |

**Cluster-scoped objects created by this chart: one, and it is opt-in.** A `PriorityClass`
named `platform-services`, gated behind `scheduling.priorityClasses.enabled`, which
defaults to `false` and is **not** enabled by `values-scp.yaml` — so a standard SCP install
renders **zero** cluster-scoped resources. It is called out here because the name is
unqualified: if it is ever enabled, two Assembly releases on one cluster would contend for
the same object.

No CRDs are required. Observability is Prometheus **annotation**-based
(`prometheus.io/scrape`), so there is no dependency on `monitoring.coreos.com` CRDs.

---

## 3. Platform / infrastructure requirements

These need DevOps assessment and approval before onboarding.

### 3.1 Privileged container — requires a PodSecurity ruling

`assembly-sandbox-execute` runs `securityContext.privileged: true`, unconditionally. It
executes untrusted user-authored code inside an **nsjail** sandbox
(`EXECUTE_CODE_BACKEND: nsjail`), and nsjail needs privileged mode to create its
namespaces and apply its seccomp filter.

- It does **not** need Docker, and no Docker daemon is reachable from the pod.
- It cannot be made unprivileged from values. The only alternative is
  `sandboxExecute.enabled: false`, which disables code execution entirely — and the chart
  then refuses to render if `agentsCodeWorker.codeExecutionTarget: sandbox-service` is
  still set, rather than silently falling back to a broken path.
- Relevant policy: Azure Policy `K8sAzureV2NoPrivilege`, CIS 5.2.1. Observed as
  `enforcementAction: dryrun` on the SCP clusters checked so far, but that is not a
  guarantee for a locked-down namespace.

**A PodSecurity exception must be agreed per target cluster.** This is the one genuine
platform gate for this application.

All other pods run as non-root (`runAsUser: 1001`).

### 3.2 Everything else

| Requirement | Detail |
|---|---|
| StorageClasses | `managed-csi` (Postgres, MinIO, workspaces), `managed-csi-premium` (Temporal Postgres only). Overridable per PVC. Confirm both exist on the target cluster — a missing class leaves every stateful pod `Pending`. |
| Node pools / labels | None required. `values-scp.yaml` sets `infra.nodeSelector: {}` because the SCP landing-zone pool is unlabeled and a `workload=infra` selector would strand pods. Optional pinning exists for dedicated pools. |
| NetworkPolicy / CNI | Only if `networkPolicies.enabled` — **off** for SCP (see [§9](#9-maintenance-enablement)). |
| Capabilities | None. No `NET_ADMIN`/`SYS_ADMIN`, no `/dev/fuse`, no `hostPath`, no `hostNetwork`, no `hostPID`, no seccomp/AppArmor annotations. |
| CRDs | None. |
| Egress | The LLM gateway needs outbound HTTPS to the configured model provider endpoint (e.g. Azure OpenAI / Azure AI Foundry). |

An optional sandbox egress filter (`sandboxExecute.egressFilter`) requires cgroup2 +
iptables + privileged; it is **off** by default and off for SCP.

---

## 4. Required secrets

**The chart creates its own Kubernetes Secrets from input values.** It performs no cluster
lookups and generates nothing. Four Secrets are rendered: `platform-secrets`,
`postgres-secret`, `keycloak-secret`, and `acr-secret`.

### 4.1 Must exist in the namespace before deploying

| Secret | Type | Why |
|---|---|---|
| the TLS certificate Secret named by `apisix.tls.existingSecret` | `kubernetes.io/tls` (`tls.crt`, `tls.key`) | Referenced by the Ingress. Not created by this chart. |

The TLS Secret follows the standard platform mechanism rather than anything specific to
this chart: a dedicated `k8s-as-helm/secret` release in the instance's helmfile that the
app release `needs`, populated from the central `HELMV-SAI-SSL-CERTS` 1Password item
(`symphonyai_cloud` for client-facing installs, `symphonyai_dev` for internal) via the
shared `templated-overrides/secrets/certs.gotmpl`.

The Secret's **name is per-install** — it is the `nameOverride` on that release, and each
app chooses its own (`ingress-tls`, `modelhub-wildcard-tls`, `https-certs` are all in use).
Set `apisix.tls.existingSecret` to match. Left unset it is a placeholder that **fails the
render**, so a deploy cannot quietly produce an Ingress pointing at a Secret that isn't there.

> **Do not use cert-manager here.** `apisix.tls.ingress.clusterIssuer` exists for clusters
> that run an ACME issuer, and SCP does not: `common-res` sets `cluster-issuers.enabled:
> false` and the pipeline overlay reasserts it, so a `Certificate` referencing
> `letsencrypt-production` would stay `Pending` indefinitely. Leave it empty.

Optionally, the image pull Secret may be pre-created instead of chart-created — set
`image.createPullSecret.enabled: false` and list the existing name under
`image.pullSecrets`.

### 4.2 Values that must be supplied at deploy time

All are injected from the secret store by the pipeline; none may be committed. Grouped by
what breaks if omitted — the chart fails the render rather than starting insecurely.

**Platform crypto — irreplaceable, see [§7](#7-passwords-and-rotation) before changing**

| Value | Notes |
|---|---|
| `secrets.jwtSecret` | Signs platform-issued tokens. |
| `secrets.fernetKey` | Encrypts stored user credentials. Must be a valid 44-character urlsafe-base64 Fernet key; the chart validates the format. |

**Internal service-to-service authentication**

| Value |
|---|
| `secrets.internalServiceApiKey` |
| `secrets.sandboxInternalServiceApiKey` |
| `secrets.workspaceManagerInternalServiceApiKey` |
| `secrets.llmGateway.userKeysInternalApiKey` |
| `secrets.llmGateway.adminKey` |

The chart derives the remaining per-caller gateway keys
(`userKeysInternalApiKeyAgents`, `…AutonomousExecutor`, `…WorkspaceRuntimeApi`,
`adminKeyAutonomousExecutor`, …) from the two above unless individually overridden, so a
minimal install supplies five keys, not twelve.

**Infrastructure credentials** (required when `infra.enabled: true`, as on SCP)

| Value | Notes |
|---|---|
| `infra.postgres.password` | Application Postgres. |
| `infra.keycloak.adminPassword` | Gates the whole Keycloak realm. |
| `secrets.bootstrapAdminPassword` | Seeded realm-admin, loginable through the public auth flow. |
| `minio.rootUser` / `minio.rootPassword` | Object storage root credentials. |
| `image.createPullSecret.username` / `.password` | ACR pull credentials (when chart-created). |

**Model provider** — at least one, depending on the tenant's provider

| Value |
|---|
| `secrets.azureFoundry.url` / `secrets.azureFoundry.apiKey` |
| `secrets.azureOpenai.endpoint` / `secrets.azureOpenai.apiKey` |
| `secrets.anthropicApiKey` |

**Optional features** — omit unless the feature is enabled

| Value | Feature |
|---|---|
| `secrets.tavilyApiKey` | `web_search` agent tool |
| `secrets.keycloakBackendClientSecret` | confidential Keycloak backend client |
| `secrets.fileSearch.s3AccessKey` / `.s3SecretKey` | file-search storage (defaults to the bundled MinIO root credentials) |
| `secrets.invhubServiceUserPassword` | InvHub Copilot integration. **Shared contract** — must equal the value in InvHub's `flows` Secret, or the integration Job locks InvHub out. |

### 4.3 Alternative: supply one complete Secret

Set `secrets.existingSecret` to bring your own. It must be **complete** — a partial Secret
produces pods that crash with `SecretKeyRef` errors. Enumerate the exact key set for the
version you are deploying with:

```bash
helm template <release> symphonyfs/assembly-platform --version <ver> \
  -f values-scp.yaml --set validation.allowPlaceholders=true \
  --show-only templates/secrets.yaml
```

---

## 5. Values files

| File | Purpose |
|---|---|
| `values.yaml` | Chart defaults. Safe, non-production defaults; not a deployable configuration on its own. |
| `values-scp.yaml` | **The SCP baseline.** Sourced from this repository at a pinned commit hash by the deployment pipeline. Platform posture + image sources + sizing. Contains no credentials and no tenant hostnames — every credential appears as a `REDACTED_*` placeholder that the pipeline replaces at deploy time. |

`values-scp.yaml` is complete in the sense that it renders the full application
(16 Deployments, 4 Jobs, 13 Services, 1 Ingress, 3 PVCs) with only secret values missing.
Per-tenant values (hostname, tenant name, ACR, TLS Secret name, sizing) are layered on top
by the pipeline's own overlay files.

Deploy shape:

```bash
helm upgrade --install <namespace> symphonyfs/assembly-platform --version <ver> \
  -n <namespace> \
  -f values-scp.yaml \        # this repo, pinned commit
  -f <tenant-overlay>.yaml    # pipeline: hostname, tenant, sizing
                              # secrets resolved by `vals` from the secret store
```

Record the chart version and the `values-scp.yaml` commit hash in the [Helm Chart Version +
Helm Params File Hash](https://netreveal.atlassian.net/wiki/spaces/CDOPSNROD/pages/561479772)
table when releasing.

---

## 6. Project & environment-specific values

All per-environment configuration is expressed in values **files**, not `--set` flags. The
chart is namespace- and hostname-agnostic; the per-tenant inputs are:

| Value | Example |
|---|---|
| `apisix.tls.publicHostname` | `assembly-<customer>-<env>.symphonyai.cloud` |
| `apisix.tls.existingSecret` | the wildcard TLS Secret name in the namespace |
| `image.tag` | the released image tag |
| `image.registry` / `global.imageRegistry` | the tenant's ACR |
| `externalInfra.keycloak.realm` | realm name (defaults to `assembly-platform`) |
| replica counts / resources | per-tenant sizing |

`image.tag` is deliberately **not** pinned in `values-scp.yaml` — pin it in the pipeline
overlay so chart and image version move together and are recorded per instance.

Two guards support the file-based model: the chart fails the render on an unresolved
`ref+op://` string (so a missing `vals` step cannot ship a literal reference as a
password), and `--reuse-values` is unsupported by design — always pass the full set of
values files.

---

## 7. Passwords and rotation

### 7.1 Fail-closed validation

The chart refuses to render when a required secret is empty, is a known repository default
(`changeme`, `assembly-admin-rotateme`, `minioadmin`), is an unresolved `ref+op://`
reference, or is a `REDACTED_*` placeholder. `:latest` image tags are rejected when
`global.environment` is `production` or `staging`.

`validation.allowPlaceholders=true` disables **all** of these checks. It exists for
`helm template` / CI rendering only and must never appear in a real deploy.

### 7.2 Which passwords are customisable

Every credential in [§4.2](#42-values-that-must-be-supplied-at-deploy-time) is
customer-customisable and should be unique per environment. None has a usable default.

### 7.3 Rotation

| Credential | Rotation | Notes |
|---|---|---|
| `secrets.fernetKey` | ⚠️ **Do not rotate in place** | Encrypts stored user credentials. Rotating it makes every stored credential permanently undecryptable. Requires a planned re-entry or re-encryption exercise, not a value change. |
| `secrets.jwtSecret` | Safe | Invalidates issued tokens; users re-authenticate. |
| `secrets.internalServiceApiKey`, `sandboxInternalServiceApiKey`, `workspaceManagerInternalServiceApiKey`, `llmGateway.*` | Safe | Rotate together with a rollout so all callers pick up the new value at once. |
| `infra.postgres.password` | Coordinated | Change in the database and in values in the same maintenance window. |
| `infra.keycloak.adminPassword`, `secrets.bootstrapAdminPassword` | Safe | Console/realm-admin credentials. |
| `minio.rootPassword` | Coordinated | Update alongside any external consumer of the same credentials. |
| model provider keys | Safe | Rotate at the provider, then update values. |
| `secrets.invhubServiceUserPassword` | Coordinated with InvHub | Shared contract; both sides must change together or the integration breaks. |
| ACR pull credentials | Safe | Token rotation at the registry. |

Suggested cadence: annually, on personnel change, or per the customer's policy —
excluding `fernetKey`, which is fixed for the life of the data.

---

## 8. Endpoints and their protection

**There is exactly one externally reachable endpoint.** APISIX is the single front door;
every other service is `ClusterIP` and reachable only through it. Under `values-scp.yaml`
no `LoadBalancer` and no `NodePort` is rendered at all.

| Endpoint | Exposure | Protection |
|---|---|---|
| APISIX gateway — serves the UI and all APIs at `apisix.tls.publicHostname` | **Public** (via shared ingress-nginx) | TLS at the Ingress; OIDC (`openid-connect`) enforced by the gateway on ~14 route groups against the Keycloak realm; CORS restricted to configured origins; per-route rate limiting. IP allowlist via `apisix.tls.ingress.ingressAllowList` — see [§11](#11-ingress). |
| Frontend UI, `assembly-core`, `assembly-engine`, `assembly-llm-gateway`, `assembly-mcp-hub`, `assembly-sandbox-*` | Internal | `ClusterIP`; reachable only via authenticated APISIX routes. |
| Keycloak | Internal | `ClusterIP`, routed via APISIX (`/auth/*`, `/realms/*`) — it is the authentication provider. |
| Temporal UI | **Not deployed** | `infra.temporal.ui.enabled: false`. Deliberately never routed through APISIX: it ships no authentication of its own, so exposing it would expose every workflow's inputs. Reach it by `kubectl port-forward` when needed. |
| MinIO API + console | Internal | `ClusterIP`, no APISIX route. |
| Postgres, Redis, Temporal frontend | Internal | `ClusterIP`, no external route. |

Authentication is on by default and configurable from values (realm via
`externalInfra.keycloak.realm`). IP allowlisting is configurable from values in both
gateway modes and requires no manual platform step:

- **`apisix.tls.mode: ingress`** (the SCP shape) — `apisix.tls.ingress.ingressAllowList.customerIPs` / `.platformIPs`
- **`apisix.tls.mode: apisix`** (dedicated LoadBalancer) — `apisix.service.loadBalancerSourceRanges`

Whether the shared ingress is internet-facing or internal is a **cluster-level** property
of ingress-nginx (`common-res`), not something this chart can request. On an
internet-facing cluster, populate `ingressAllowList` to restrict access.

---

## 9. Maintenance enablement

### 9.1 Can any pod be restarted at any time?

**Stateless — restart freely, any time, any order:** `assembly-core`, `assembly-engine`
and its workers (agents, code, subflow), `assembly-llm-gateway`, `assembly-mcp-hub`,
`assembly-sandbox-*`, `frontend`, `apisix`, Keycloak.

Workers drain gracefully: `terminationGracePeriodSeconds` (120s) exceeds the worker drain
timeout (90s), so a running workflow activity finishes or is cleanly rescheduled. Temporal
persists workflow state, so an interrupted workflow resumes on another worker rather than
failing.

**Stateful — restart one at a time, never force-delete:** `postgres`,
`postgres-temporal`, `minio`, `assembly-mcp-hub` (workspace volume).

All four use `strategy: type: Recreate` specifically so a ReadWriteOnce PVC is never
double-mounted during a rollout, and all data PVCs carry
`helm.sh/resource-policy: keep` so a `helm uninstall` cannot delete them.

**Data-corruption risk and mitigation:** the risk is not a graceful restart — it is an
ungraceful one on the database. Mitigations: take a Postgres backup before planned
maintenance; drain with `kubectl drain --grace-period` rather than deleting pods; never
`--force --grace-period=0` a Postgres pod; and never scale a stateful workload above 1
replica (none of them support it).

### 9.2 Rolling restart (node upgrades)

Safe with a standard `kubectl drain` per node, provided nodes are drained one at a time so
the single-replica stateful pods reschedule sequentially.

**PodDisruptionBudgets are currently disabled for SCP** (`podDisruptionBudgets.enabled:
false` in `values-scp.yaml`), so **nothing in this release will block a drain**. The chart
does define 14 PDBs, each gated on `replicas > 1` — a single-replica PDB would block a
drain indefinitely, so the gate is deliberate. Enabling them on SCP is a follow-up once
validated against a real multi-replica tenant; until then, drains are unobstructed by
design.

### 9.3 Stop and start (non-production cost saving)

The release tolerates a full cluster or namespace stop. Scale down in dependency order and
back up in reverse:

```bash
NS=<namespace>

# STOP — application first, then infrastructure
kubectl -n $NS scale deploy --replicas=0 -l app.kubernetes.io/part-of=assembly-platform
kubectl -n $NS scale deploy postgres postgres-temporal minio redis --replicas=0
# temporal deployments last

# START — infrastructure first, wait for readiness, then application
kubectl -n $NS scale deploy postgres postgres-temporal minio redis --replicas=1
kubectl -n $NS rollout status deploy/postgres --timeout=300s
# then temporal, then scale the application deployments back to their configured counts
```

Notes:
- Bring Postgres to Ready **before** Temporal, and Temporal before the workers; otherwise
  workers crash-loop on connection failure until their backoff catches up. They do recover
  on their own — the ordering just avoids noise.
- Temporal shard ownership is re-acquired automatically on start; no manual step.
- In-flight workflows survive: state lives in Postgres, and workflows resume when workers
  return.
- `infra.temporal.numHistoryShards` is **immutable** once the Temporal database is
  initialised. Changing it against an existing database breaks the cluster. Never let a
  stop/start turn into a value change.
- Do not flip `infra.enabled` to `false` on an existing release — it would prune the
  in-cluster Postgres. PVC `resource-policy: keep` is the second line of defence.

### 9.4 Post-maintenance verification

```bash
NS=<namespace>

# 1. Everything Ready, no restarts climbing, all Jobs Complete
kubectl -n $NS get pods
kubectl -n $NS get jobs

# 2. Backend health through the gateway
kubectl -n $NS exec deploy/apisix -- curl -sf localhost:9080/api/v1/health

# 3. Public endpoint end-to-end (TLS + OIDC discovery)
curl -sfI https://<publicHostname>/
curl -sf https://<publicHostname>/realms/<realm>/.well-known/openid-configuration | head -c 200

# 4. Temporal workers registered on their task queues
kubectl -n $NS logs deploy/assembly-engine-worker --tail=50 | grep -i "worker started"

# 5. Data intact — no unexpected loss
kubectl -n $NS get pvc          # all Bound, expected capacity
```

Then confirm functionally: log in through the UI, open an existing workflow (proves
Postgres reads and stored-credential decryption), and execute a trivial workflow
end-to-end (proves Temporal, the workers, and the sandbox).

---

## 10. Image sources

**Every image — first-party and third-party — is registry-overridable, and every pod
carries `imagePullSecrets`.** Nothing pulls anonymously from Docker Hub.

- First-party images resolve through `image.registry`.
- Third-party images resolve through `global.imageRegistry`, which rewrites the registry
  host while preserving repository path and tag.

Under `values-scp.yaml` all 14 images resolve to the configured mirror ACR — none to
`docker.io` or `quay.io`:

| Image | Upstream origin |
|---|---|
| `assembly-platform-{core,engine,frontend,llm-gateway,mcp-hub,sandbox}` | first-party |
| `apache/apisix:3.8.0-debian` | docker.io |
| `keycloak/keycloak:23.0` | quay.io |
| `postgres:16-alpine` | docker.io |
| `redis:7-alpine` | docker.io |
| `minio/minio`, `minio/mc` (pinned releases) | docker.io |
| `temporalio/auto-setup`, `temporalio/admin-tools` | docker.io |

(`temporalio/server` adds a 15th when `infra.temporal.mode: split`.)

Pull secrets reach **every** workload — application pods, infrastructure pods, Jobs, and
init containers alike. Verify on a running install:

```bash
kubectl -n <namespace> get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.imagePullSecrets}{"\n"}{end}'
```

Mirror the third-party images into the tenant ACR preserving repository path and tag, so
`global.imageRegistry` alone redirects them. Note that `global.imageRegistry` defaults to
empty: if it is not set, those eight images fall back to their public origins.

---

## 11. Ingress

One Ingress is created by the chart, when `apisix.tls.mode: ingress`.

- **Hostname** — `apisix.tls.publicHostname`. Use a single dot-free label plus the domain:
  `assembly-<customer>-<env>.symphonyai.cloud` is correct;
  `assembly.customer.env.symphonyai.cloud` is not, and breaks wildcard certificate
  matching. Use `symphonyai.cloud` for client-facing environments and `symphonyai.dev` for
  internal ones. The chart rejects an empty value.
- **TLS** — read from the `kubernetes.io/tls` Secret named by `apisix.tls.existingSecret`.
  No key material is ever placed in a ConfigMap, and none is committed to this chart.
  cert-manager is optional (`apisix.tls.ingress.clusterIssuer`) and unused on SCP, so the
  Secret must pre-exist.
- **IP allowlisting** — via `apisix.tls.ingress.ingressAllowList`:

  ```yaml
  apisix:
    tls:
      ingress:
        ingressAllowList:
          customerIPs: ["203.0.113.0/24"]   # tenant perimeter
          platformIPs: ["10.1.2.0/24"]      # SAI VDI / jumpbox / monitoring
  ```

  The lists are concatenated and deduplicated into a single
  `nginx.ingress.kubernetes.io/whitelist-source-range` annotation. Both empty (the
  default) emits no annotation, leaving the endpoint open — populate them for any
  internet-facing cluster. Arbitrary extra annotations remain available via
  `apisix.tls.ingress.annotations` and take precedence.

Defaults are aligned to the gateway's own limits (`proxy-body-size: 64m`,
`proxy-read-timeout: 300`, `proxy-buffering: off`, `ssl-redirect: true`) so large agent
build contexts and long SSE streams work without further tuning.

---

## 12. PVCs

All PVC names are **static string literals**. None contains the release name, the
namespace, or any environment-varying value, so a restore from one namespace into another
(production → preprod) works without renaming.

| PVC | Default class | Default size | Condition |
|---|---|---|---|
| `postgres-pvc` | `managed-csi` | 20Gi | `infra.enabled` |
| `postgres-temporal-pvc` | `managed-csi-premium` | 64Gi | `infra.postgresTemporal.enabled` |
| `minio-pvc` | `managed-csi` | 20Gi | `minio.enabled` |
| `assembly-mcp-hub-workspaces` | `managed-csi` | configurable | `mcpHub.persistence.enabled` |

There are no StatefulSets and no `volumeClaimTemplates` — so no ordinal-suffixed,
generated PVC names anywhere. All four carry `helm.sh/resource-policy: keep`.

---

## 13. Namespace naming

The chart is **fully namespace-agnostic**. No rendered object sets a `namespace:` field,
nothing derives a namespace, and all intra-cluster addressing uses bare same-namespace
service DNS (`http://assembly-core:8000`, `keycloak:8091`). There are no cross-namespace
dependencies.

It therefore drops into whatever namespace the pipeline creates, following the platform
convention `<solution>-<customer>[-<env>]`, ≤18 characters, with the Helm release name
equal to the namespace. Object names are release-independent (`postgres`, `apisix`,
`assembly-core`), so release name and namespace may match without collision.

> The Temporal-namespace values (`externalInfra.temporal.agentBuilderNamespace`) are
> Temporal's own namespaces, unrelated to Kubernetes namespaces.

---

## Upstream

Chart source of truth: [`SymphonySensa/sri-assembly`](https://github.com/SymphonySensa/sri-assembly)
under `helm/assembly-workflows` (the directory keeps the old name; the chart it
contains is named `assembly-platform`). Make changes **there** and re-vendor — do not edit this
copy in place, or the two will drift.

`Chart.yaml`, `values.yaml`, `values-scp.yaml`, `templates/` and `files/` here are a
**byte-identical** copy of upstream, so re-vendoring is a plain `cp` and verifying is a
plain `diff`:

```bash
SRC=<sri-assembly>/helm/assembly-workflows
diff -q  $SRC/Chart.yaml Chart.yaml && diff -q $SRC/values.yaml values.yaml \
  && diff -q $SRC/values-scp.yaml values-scp.yaml \
  && diff -rq $SRC/templates templates && diff -rq $SRC/files files \
  && echo "in sync with upstream"
```

Only `README.md`, `RELEASE-NOTES.md` and `.helmignore` are additions that exist solely
here. Because the chart files are copied verbatim, a few comments in `values-scp.yaml`
point at paths that exist only upstream — `docs/scp-deployment.md` (the SCP deployment
notes) and the per-cluster `values-*.yaml` overlays, which are internal and deliberately
not published. This document supersedes those references for anything SCP-related.

Upstream also holds material not vendored here: the chart's pytest suite (`tests/`, ~440
tests covering the guarantees described above, including
`test_endpoint_ip_allowlist.py` for §8 and `test_pdb_cannot_block_a_drain.py` for §9) and
`RUNBOOK.md`, whose §4 and §5 are the long-form source for the rotation and maintenance
sections here.
