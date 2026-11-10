# assembly-platform — release notes

## 0.18.2

Initial SCP onboarding of the Assembly Platform Workflows Module. The chart is vendored
from [`SymphonySensa/sri-assembly`](https://github.com/SymphonySensa/sri-assembly)
(`helm/assembly-platform`) for publication to `https://helm.symphonyfs.net`.

Assembly is a **new product**, not a replacement release of the legacy
`charts/flow/eureka-workflows` (Eureka Flows) chart. It can serve the InvHub Copilot Flows
contract, but those integration knobs ship **off** by default.

### Deployment shape

- Single self-contained release into one namespace. No subchart dependencies, nothing
  fetched at install time, no cross-namespace dependencies.
- Pure Helm: all bootstrap work (schema migration, database/bucket creation, Temporal
  namespace registration) runs as in-chart Jobs. No scripts, `az` CLI, or `kubectl` steps
  in the deploy path.
- APISIX is the single front door; every other service is `ClusterIP`. Under
  `values-scp.yaml` no `LoadBalancer` or `NodePort` is rendered.
- Renders **zero** cluster-scoped resources with the SCP values. `common-res` is consumed
  (ingress-nginx, StorageClasses), never duplicated.
- Namespace-agnostic; Helm release name may equal the namespace.

### Requires DevOps approval

- **`assembly-sandbox-execute` runs privileged.** It executes untrusted user-authored code
  under **nsjail**, which requires privileged mode; it does not require Docker. This cannot
  be disabled from values without disabling code execution entirely. A PodSecurity
  exception must be agreed per target cluster (Azure Policy `K8sAzureV2NoPrivilege`,
  CIS 5.2.1). See README §3.1.
- StorageClasses `managed-csi` and `managed-csi-premium` must exist on the target cluster.

### Included in this release

- `values-scp.yaml` — the SCP baseline overlay, credential-free (every secret is a
  `REDACTED_*` placeholder resolved at deploy time). Pin its commit hash in the
  [Helm Chart Version + Helm Params File Hash](https://netreveal.atlassian.net/wiki/spaces/CDOPSNROD/pages/561479772)
  table.
- `README.md` — the onboarding reference, answering each requirement of
  [Requirements for adding any New Apps to the SCP Deployment Pipeline](https://netreveal.atlassian.net/wiki/spaces/CDOPSNROD/pages/595067185):
  required secrets, password rotation, endpoint protection, maintenance procedures
  (rolling restart, stop/start, post-maintenance verification), image sources, PVCs, and
  namespace conventions.
- **IP allowlisting from values, both gateway modes** (SCP requirement 8, and Ingress
  requirements page 751042881):
  - `apisix.tls.ingress.ingressAllowList.customerIPs` / `.platformIPs` — concatenated and
    deduplicated into `nginx.ingress.kubernetes.io/whitelist-source-range`.
  - `apisix.service.loadBalancerSourceRanges` — for a dedicated-LoadBalancer install,
    where there is no Ingress to annotate.

  Both default to empty and then render nothing, so an existing install is unchanged.
- All images registry-overridable to a mirror ACR (`image.registry` for first-party,
  `global.imageRegistry` for the bundled third-party images), with `imagePullSecrets`
  reaching **every** pod including Jobs and init containers — nothing pulls anonymously
  from Docker Hub.
- All four PVC names static (`postgres-pvc`, `postgres-temporal-pvc`, `minio-pvc`,
  `assembly-mcp-hub-workspaces`), each with `helm.sh/resource-policy: keep`. No
  StatefulSets, so no generated PVC names — a cross-namespace restore needs no renaming.
- TLS read from a `kubernetes.io/tls` Secret (`apisix.tls.existingSecret`). No certificate
  or private key is committed to this chart, and no key material is ever written to a
  ConfigMap.
- Fail-closed values validation: the render is refused on an empty required secret, a known
  repository default (`changeme`, `assembly-admin-rotateme`, `minioadmin`), an unresolved
  `ref+op://` reference, a `REDACTED_*` placeholder, or a `:latest` image tag in
  production/staging.

### Known deferrals

- `podDisruptionBudgets.enabled: false` — the chart defines 14 PDBs, each gated on
  `replicas > 1` (a single-replica PDB blocks a node drain indefinitely). Disabled for SCP
  until validated against a multi-replica tenant. Consequence: nothing in this release
  obstructs a drain. See README §9.2.
- `networkPolicies.enabled: false` — the gateway path is covered, but default-deny plus the
  same-namespace allow both match *pod* sources, so node-sourced kubelet health probes are
  not yet covered. Needs a node/CIDR-sourced allow validated against the cluster CNI.
- `image.tag` is intentionally not pinned here; pin it in the per-instance pipeline overlay
  so chart and image versions move together.
- Verify the exact wildcard TLS Secret name (`apisix.tls.existingSecret`) against a real
  onboarded instance — a wrong name means no TLS on first deploy.

### Verification

Manually validated on a DEV SCP AKS cluster before onboarding (requirement 1): 18/18 pods
Ready, all Jobs Complete, `/api/v1/health` 200, reached end-to-end through the shared
ingress-nginx with a wildcard certificate, in both `apisix.tls.mode: ingress` and
client-facing `.symphonyai.cloud` configurations. No manual workarounds were required.
