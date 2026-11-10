# AKS Cluster Creation Workflow — Audit

**Status:** Phase 1 deliverable (audit only — no code changed)
**Date:** 2026-10-13
**Scope:** CloudHub `/create/aks` wizard, the `provisioning` backend plugin, and the external contracts it must drive (`SymphonySensa/scp-infra-as-code`, `SymphonyFS/tailscale`, `SymphonyFS/scripts`, Terraform Cloud, Platform Registry).

> **Headline:** The wizard *presents* a complete five-stage lifecycle, but only the
> approval chain, the Tailscale PR, and the infrastructure PR are real operations.
> The PR targets the wrong repository and module root, the "plan" never runs
> Terraform, nothing observes Terraform Cloud, and the bootstrap/validation/
> registry stages are log lines written without executing anything. CloudHub
> today is not an orchestration layer over the SCP AKS process; it is a PR
> generator against a sandbox directory plus a scripted progress display.

---

## 0. Corrections to the task brief

The brief made assumptions that the code and repositories contradict. These change the implementation plan:

| Brief assumption | Actual | Evidence |
|---|---|---|
| React/Vite JS frontend + FastAPI backend | **Backstage TypeScript monorepo.** Frontend: `plugins/platform-home` (MUI). Backend: Node/Express Backstage plugins using raw `pg.Pool`. No Python service exists. | `packages/backend/src/provisioningPlugin.ts`, `plugins/*` |
| AKS values live in `azure-kubernetes-service/values/` | That root is **legacy, "DO NOT ADD NEW CLUSTERS HERE"** (renamed `azure-kubernetes-service-legacy` on `main`). New clusters go in **`azure-kubernetes-service-standard/values/<cluster>.tfvars`**. | `scp-infra-as-code` `main@6bc941b`, `workspacemanager/workspaces.tfvars` |
| Naming `{type}-scp-{env}-{region}-{tenantType}-{tenantId}-[seq]` | `aks-scp-{env}-{reg}-{st\|mt}-{tenantId}`. **`seq2` is not part of the AKS name** (only affects the `mc-rg` node RG). | `NAMING_CONVENTIONS.yaml:198-203`; AKS module `main.tf:1-10` |
| Region code `aue` (e.g. `aks-scp-ppd-aue-st-visa`) | Map and every real cluster use **`ae`** for australiaeast. Explicit per-cluster overrides exist (`spc` for spaincentral, `gec`). | `azure-kubernetes-service-standard/locals.tf` `region_shortnames` |
| "Existing vs new resource group" | The standard root **always creates** `rg-scp-…`; `create_resource_group` / `resource_group_name` were removed. Existing-RG is unsupported. | standard root `main.tf`, `module.resource_group` v1.5.0 |
| Subnet allocations are request inputs | Subnets are **derived** from `address_space[0]` (`cidrsubnet` in `locals.tf:7-12`). Only the /16 is an input. | standard root `locals.tf` |
| Owner / cost-centre tags | Tag convention is `{created, customer, env, terraform}` only. `tags` is a free `map(string)`, so extra tags are *possible* but not established. | 40 values files on `main` |
| Tailscale repo `SymphonyFS/tailscale` | Correct — but CloudHub is configured for **`SymphonySensa/tailscale`**. | `app-config.yaml:79-83`, `.env.example:81` |
| Supplied SCP AKS SOP | **Not present** in any local repo; likely Confluence (Atlassian connector not authorised in this session). This audit traces against the six SOP phases enumerated in the brief. | — |

Local clones of `scp-infra-as-code` are ~4 months stale and on feature branches; contract facts above were read from GitHub `main` (`6bc941b`, 2026-10-12).

---

## 1. Existing implementation map

### 1.1 Frontend — `plugins/platform-home/src/components/AksWorkflowPage.tsx` (5,856 lines, single component)

Route: `/create/aks` (`plugins/platform-home/src/plugin.tsx:231`). One React component holds ~60 `useState` hooks; **no request state is persisted outside React** (no URL param, no reload-from-backend). Refreshing the page loses the request.

| Phase (`WIZARD_PHASES`, l.282) | What it does | Backend calls | Real? |
|---|---|---|---|
| **1 Configure** | Identity & Environment, Compute & Network, Access & Jumpbox. Profile (free/dev/single/active-passive/active-active), flavor (small/medium/large → fixed VM size), K8s version, min/max nodes, cluster admins (GitHub usernames). | none | Local only. Subscriptions (1 hard-coded), resource groups (11 hard-coded `rg-sensa-*`), cost centres (`FS001-5`) are constants (l.150-171). |
| **2 Review** | Shows derived cluster name, tfvars preview, cost, resource count. | `POST /plan`, poll `GET /plan/status/:runId` | **Not real.** See §3.3. On any backend error the UI falls back to a local estimate and sets `planStatus='completed'` (l.2662-2666). |
| **3 Platform Approval** | Submits request; renders approval chain with Approve/Reject buttons **inside the requester's wizard**; then waits for Tailscale PR merge. | `GET /preflight`, `POST /submit`, `POST /request/:id/approve\|reject`, poll `GET /request/:id/access-status` | Partly real (persisted, permission-checked). Approver identity is spoofable (§4). |
| **4 Pull Request** | Shows branch/commit/PR link; polls merge. | poll `GET /request/:id/pr-status`; `POST /request/:id/create-pr` (legacy path) | PR is real; target repo is wrong (§3.4). |
| **5 Provision & Configure** | 11-step timeline (Validate, Terraform Init, Terraform Plan, Resource Group, Networking, Identity & RBAC, AKS Cluster, Secondary Region, Validation, Register, GitOps Bootstrap, Cluster Ready) from `buildProvisionSteps` (l.431). | poll `GET /task/:taskId` | **Scripted.** Steps are client constants; backend `progress.current` is only ever 2/3/4 of 4. `complete-access` is never called by the UI, so after merge the page sits in `runState='draft'` forever. |

Other frontend observations:

- **Naming preview ≠ backend name.** Frontend `derivedClusterName` (l.342): `aks-{customer alnum, ≤10}-{env}-{region}`. Backend `buildClusterName`: `aks-{customer sanitised w/ hyphens, ≤24}-{env}-{region}`. `"Acme-Corp Retail"` → UI `aks-acmecorpre-dev-cnc`, backend `aks-acme-corp-retail-dev-cnc`. Neither conforms to SCP naming.
- **Fields silently dropped:** `existingResourceGroup`, `newResourceGroupName`, `resourceGroupMode`, the secondary region (emitted only as an HCL comment), any VNet CIDR (no UI field; backend defaults `10.0.0.0/16`, which is already allocated).
- **Approvals rendered to the requester** with `approver: form.owner` in the body (l.2798) — the requester's own owner email is recorded as the approver.
- **Stepper back-navigation** (l.3036) lets the user return to Configure and edit after submission; the edits diverge from the persisted payload with no warning.
- **No duplicate-submit guard** on `goSubmit` beyond the preflight busy flag; client-generated `requestId` (l.335) is sent but ignored by the backend.
- **Polling, not streaming** (6–12 s intervals); errors are swallowed (`.catch(() => undefined)`).
- **No tests** for `AksWorkflowPage`.

### 1.2 Backend — `provisioning` plugin (`packages/backend/src`)

| File | Role |
|---|---|
| `provisioningPlugin.ts` | Registers router, `jumpbox.approve` permission, store, services. Adds `httpRouter.addAuthPolicy({ path: '/api/provisioning', allow: 'unauthenticated' })` (l.95-100) — intent is unauthenticated access; because Backstage auth-policy paths are plugin-relative, this path likely matches nothing and default auth applies. **Needs verification either way.** |
| `createProvisioningRouter.ts` (1,223 l.) | All routes (below). Holds `provisioningTasks` and `planCache` as **in-memory `Map`s** (l.118-119). |
| `services/InfrastructureProvisioningService.ts` | Name derivation, validation, cost estimate, tfvars generation, GitHub branch/commit/PR, `aks-plan.yaml` dispatch. |
| `services/InfrastructureRequestStore.ts` | `provisioning_infrastructure_requests` (Postgres; in-memory fallback). |
| `services/JumpboxAccessProvisioningService.ts` | Tailscale `policy.hujson` mutation + PR. |
| `services/PlatformRegistryUpdater.ts` | `UPDATE pr_clusters SET status=…` by name. |
| `permissions.ts` / `cloudhubPermissionPolicy.ts:308` | `jumpbox.approve` → ALLOW for `JUMPBOX_APPROVER_GROUPS` (`group:default/platform-approvers` default). |

Routes:

| Route | Behaviour | Authz |
|---|---|---|
| `GET /preflight` | Checks GitHub token can read repo, `main` ref, and `aks-plan.yaml`. | none |
| `POST /plan` | Generates tfvars, dispatches `aks-plan.yaml`, correlates run as "any `workflow_dispatch` run created in the last 10 s". | none |
| `GET /plan/status/:runId` | Reads `plan-runs/<id>.json` from `plan-output` branch. | none |
| `POST /submit` | Validates mandatory fields + admins, creates request `pending_approval`, approval chain by profile. Rejects in `sim` mode. | none — `requestor` taken from body |
| `GET /requests`, `GET /request/:id` | Read. | none |
| `POST /request/:id/approve` | Advances one stage. On final approval: registry → "Pending Access", opens Tailscale PR, status `awaiting_tailscale_merge`. | `jumpbox.approve`; **approver name from body** |
| `POST /request/:id/reject` | Rejects pending request. | `jumpbox.approve` |
| `GET /request/:id/access-status` | Polls Tailscale PR; **on merge, as a side-effect of a GET**, creates the infra feature branch, commits tfvars + workspace entry, opens infra PR. | none |
| `POST /request/:id/create-pr` | Legacy: expects `branch_ready`, which nothing sets. Dead. | none |
| `GET /request/:id/pr-status` | On merge sets status `provisioning`. | none |
| `POST /request/:id/provision-access` | Legacy ordering (access after apply); expects `awaiting_pr_merge`. Unreachable from UI. | none |
| `POST /request/:id/complete-access` | **Fabricates** bootstrap ("ArgoCD installed…") and validation ("— OK") log lines, sets registry `Ready`, status `completed`. Executes nothing. Not called by UI. | none |
| `GET/POST /task/:taskId[/logs\|/cancel]` | In-memory task view; cancel only flips an in-memory flag. | none |
| `GET /mode` | Config echo. | none |

### 1.3 Request state machine (actual)

```
POST /submit ─► pending_approval ──approve×N──► awaiting_tailscale_merge
                     │                              │ (GET access-status sees merge;
                     └─reject─► rejected            │  creates branch + PR inline)
                                                    ▼
                                              awaiting_pr_merge ──(GET pr-status sees merge)──► provisioning ─╳ (nothing advances it)
                                                    
  [unreachable from UI]  complete-access: * ─► bootstrapping ─► validating ─► completed   (all simulated, same request)
  [unused enum values]   approved, branch_ready
  any GitHub error in approve ─► failed  (no retry path)
```

`provisioning` is effectively terminal. Nothing observes Terraform Cloud.

### 1.4 Persistence

- `InfrastructureRequestStore.save()` is a full-row overwrite with **no optimistic concurrency** (no version / `WHERE status=`). Concurrent approves or concurrent `access-status` polls race.
- **Postgres init failure silently degrades to in-memory** (l.~215) — production could lose all requests on restart without alerting.
- Logs are a JSONB string array on the row; no structured events, no audit table, no cursor.
- Approved configuration is held in `payload` and is not modified by `save()` — good, but there is no explicit amendment flow and nothing prevents the UI diverging.

---

## 2. Reusable capabilities elsewhere in CloudHub (to reuse, not rebuild)

From `plugins/deployment-control-plane-backend` (DCP):

| Capability | Location | Notes for reuse |
|---|---|---|
| Atomic approval decision (`UPDATE … WHERE status IN (PENDING…) RETURNING`) → 409 on duplicate | `deploymentPortalService.ts:1991-2025` | Pattern to copy into the AKS store. |
| Self-approval block (`ALLOW_SELF_APPROVAL`) | `deploymentPortalService.ts:52, 933, 1021` | Same policy should apply to AKS. |
| Audit: `deployment_events` + `control_plane_audit_logs` | `controlPlaneService.ts:6522`, `deploymentPortalService.ts:345-405` | Reuse `control_plane_audit_logs`. |
| Dispatch idempotency: persist inputs + `dispatch_initiated_at` before dispatch; reconcile without redispatch | `scriptsPipelineDeploymentService.ts:60-69` | Exactly what Operation C needs. |
| Run correlation by run-name `[app]/[instance]` + `created_at ≥ dispatchInitiatedAt`, ambiguity detection, 5-min deadline | `githubActionsService.ts:496-574` | Matches the `SymphonyFS/scripts` run-name contract. |
| Restart recovery `reconcileNonTerminalDeployments()` | `controlPlaneService.ts:1427` | Pattern for AKS. |
| Incremental GitHub job logs with `last_log_line` cursor | `deploymentPortalService.ts:1691`, `control_plane_deployment_jobs` | Reuse for scripts runs. |
| SSE log stream with heartbeat; client via `fetchApi` + polling fallback | `router.ts:3006-3126`; `DeploymentWizard.tsx:2210-2330` | Lacks `id:`/Last-Event-ID; per-process EventEmitter. Must be extended for resume. |
| Terraform Cloud client: project/workspace find/create, runs, status, logs | `services/terraformCloudService.ts` | Usable for observing runs. **Falls back to simulated runs** when unconfigured or on 404 — must be disabled for AKS. |
| Cluster deploy-eligibility via Azure tags `cloudhub-enabled`/`cloudhub-onboarded`; `POST /clusters/onboard` | `utils/clusterTagValidator.ts:46-75`, `router.ts:4203` | This — not `pr_clusters` — is what deployments use. |

Known defects in those components that must be fixed before reliance: `completed` run with `null` conclusion treated as success (`applyRunStatus`, `reconcileMissingRun:1588`); `retry()` has no CAS; TFC `policy_override`/`policy_soft_failed` map to in-progress forever; GitHub webhook has no HMAC check; DCP default scripts repo is `SymphonyFS/pipeline-internal`, not `SymphonyFS/scripts`.

---

## 3. External contracts (actual)

### 3.1 Infrastructure — `SymphonySensa/scp-infra-as-code` (`main`)

**Files a new cluster requires**

1. `azure-kubernetes-service-standard/values/<cluster>.tfvars` (HCL). Required keys in practice: `kubernetes_version`, `address_space`, `env`, `tenancy`, `tenant_id`, `location`, `region_code` (optional; falls back to map), `tags{created,customer,env,terraform}`, `default_node_pool{min_count,max_count,vm_size,orchestrator_version}`, `usernp01{…}`. Optional: `usernp02/03`, `systemnp02`, `netapp_pool_size_in_tb`, `private_cluster_enabled`, CMK block (`enable_cmk`, `cmk_key_vault_key_id`, `cmk_federated_client_id`, `key_vault_*`, `des_*`, `disk_encryption_set_id`), `paired_cluster_vnet`/`service_cidr`/`dns_service_ip` (active-active), `active_passive_netapp`, `sku_tier`, `jumpbox_enable_tailscale` (default true).
2. `workspacemanager/workspaces.tfvars` entry under `"azure-kubernetes-service-standard"`: `"<cluster>" = {}` (defaults: VCS `main`, `TF_CLI_ARGS=-var-file=values/<cluster>.tfvars`, `auto_apply=false`, project derived from env segment → `SCP-DEV-AKS` / `SCP-PRD-AKS`, org `sensa-cloud-platform`).

**Variable validations** (naming module): `env ∈ {prd,ppd,dev,test,stg,uat,qa}`, `tenancy ∈ {mt,st}`, `tenant_id = all | ^[a-z0-9]{2,24}$`. Node pools have no validation. System pool defaults: `Standard_D8ds_v5`, 2–5, zones 1-3, ephemeral OS disk. User pool defaults: `Standard_E16ds_v5`, 2–30, zones 1-3.

**Process**

- Branches `<type>/SCP-<ticket>-<desc>` from `main`, PR into `main` (`CONTRIBUTING.md`).
- Ruleset: 1 approval, **CODEOWNERS (`@SymphonySensa/azure-team`) review required**, last-push approval, required check **"Terraform Quality Gate"** (fmt, tflint, docs, Trivy, Gitleaks — **no plan**).
- **No GitHub Action applies.** TFC is VCS-driven: merge → `workspacemanager` workspace run creates the cluster workspace → cluster workspace queues a run on `main` → **manual confirm** (`auto_apply=false`).
- **A new workspace does not exist until the workspacemanager change is applied**, so a PR cannot get a speculative plan for a brand-new cluster from TFC. The first real plan appears post-merge. (The SOP's workaround — point the new workspace at the feature branch, plan/apply, then switch `vcs_branch` back to `main` — is visible in history, e.g. `feature/cloudhub-iac`, commit `26ca355` "pointing to main".)
- **VNet CIDR registry is Confluence only** ("Virtual Network Information", CDOPSNROD/320504089). Every cluster has a unique `10.X.0.0/16`; highest in use 10.221. No machine-readable source.
- Outputs: `aks_cluster_id`, `cluster_fqdn`, `kube_config` (sensitive), `identity_principal_id`, `kubelet_identity_object_id`, `velero_storage_*`, `netapp_*`, `des_id`, …

### 3.2 Access — `SymphonyFS/tailscale`

- `policy.hujson` is comment-free JSON (4,086 l.), edited by `jq` in other workflows.
- New cluster = 4 edits (template: commit `ce4c426`): `tagOwners["tag:jumpbox-<x>"] = []`, `groups["group:jumpbox-<x>"] = ["<gh>@github", …]`, ACL `group→tag:22`, SSH `aksuser` with `tag:session-recorder` enforced, where `<x>` = cluster name minus `aks-`.
- CI `tailscale.yml`: `gitops-acl-action` **test on PR, apply on push to main**. CODEOWNERS `@symphonyfs/cloud-operations`.
- Also likely needed: `tag:k8s-operator-<cluster>` (tailscale operator in `scripts/apps/tailscale`).

CloudHub's `applyJumpboxPolicy` matches the 4-edit shape except `tagOwners` uses `["autogroup:admin"]` vs the repo's `[]`, and it re-serialises the whole file (`JSON.stringify(…, 2)`), likely producing formatting churn. **It is pointed at `SymphonySensa/tailscale`.**

### 3.3 "Plan" — `.github/workflows/aks-plan.yaml` (this repo)

Runs no Terraform. Greps tfvars for 4 keys, computes `MONTHLY = (300*min_count+275)/50*50`, hard-codes `resourcesToCreate=28`, commits JSON to a `plan-output` branch. Also: `${{ inputs.tfvars_base64 }}` / `${{ inputs.tfvars_path }}` interpolated directly into `run:` (**script injection**).

### 3.4 Infrastructure PR target (this repo, not scp-infra-as-code)

`INFRA_REPOSITORY` defaults to `jubermohamad/platform_cloudhub`, `infra/aks/values/`, `infra/workspacemanager/workspaces.tfvars` (commits `634f6f6` "aks create pr moved to cloudhub repo", `fd9de20` "tf inside ch"). That directory has **no Terraform module and no TFC workspace manager**: merging the PR provisions nothing. tfvars are built by string interpolation of user input (owner, businessUnit, costCenter) → **HCL injection**. `tenancy` is the first two letters of business unit; `location` code map uses `ae` but also unmapped codes pass through raw.

### 3.5 Core services — `SymphonyFS/scripts`

- Workflow `deploy-with-dynamic-runners.yml` (`workflow_dispatch`): inputs `appName` (choice incl. `common-res`, `datadog`, `velero`, `tailscale`), `appInstance` (= AKS cluster name), `triggerFailover` (`no`), `actionValidation`, `acceptance`, `configureSkupper`.
- Run-name: `🚀 [attempt]:[Deploy App][v20260415]-[<app>]/[<instance>] initiated by [<actor>]` — the only correlation handle. No artifacts, no step summary.
- **Preconditions per cluster:**
  1. `apps/{common-res,datadog,velero}/<cluster>/helmfile.yaml` (+ common-res `overrides.gotmpl`) committed to `scripts` `main` (templates exist for common-res and datadog; **none for velero**). CODEOWNERS `@SymphonyFS/clouddevops`.
  2. 1Password vault `grtvfcx3xngyha55vu4ptg2j3y`: sections `HELMV-COMMON-RES/<cluster>/{helm_chart_version,helm_chart_values_file_ref}` and `HELMV-VELERO/<cluster>/helm_chart_version` — **manual; no code writes them**.
  3. Cluster must be visible to the workflow's SP in the **single** `AZURE_SUBSCRIPTION_ID`; private clusters use `private-cluster-runners`. A missing cluster silently selects the public runner then fails at credentials.
- Related: `github-actions-iac.yml` (`iacType=cluster-create`, `aksInstance`) writes `AKS-SSH-KEYS` and ANF details into 1Password from `iac/<cluster>/vars.env` — likely an SOP post-provisioning step; to confirm.

### 3.6 Platform Registry

- `pr_clusters.status` is `EntityStatus = active|inactive|pending|error`. CloudHub writes `'Pending Access'` / `'Ready'` (invalid), by name with no platform scope, and only `UPDATE`s — **a new cluster is never onboarded**.
- `createCluster` requires an onboarded `cloudAccountId`.
- **Deploy eligibility actually comes from Azure tags** `cloudhub-enabled=true` + `cloudhub-onboarded=true`, written via DCP `POST /clusters/onboard` (platform-admin).

---

## 4. Security & integrity findings (fix first)

| # | Severity | Finding | Location |
|---|---|---|---|
| S1 | High | Approver identity taken from request body; wizard sends requester's `form.owner`. Same principal can approve every stage; no self-approval block. | `createProvisioningRouter.ts:490-511`; `AksWorkflowPage.tsx:2798` |
| S2 | High | State-changing routes (`submit`, `create-pr`, `complete-access`, `provision-access`, `task/cancel`, and the mutating GET `access-status`) have no permission check; `requestor` from body. Plus `allow: 'unauthenticated'` intent on the plugin. | router; `provisioningPlugin.ts:95` |
| S3 | High | `complete-access` marks clusters `completed`/`Ready` with fabricated validation. | `createProvisioningRouter.ts:1102-1186` |
| S4 | High | HCL injection via unescaped user strings in generated tfvars. | `InfrastructureProvisioningService.generateTfvars` |
| S5 | High | GitHub Actions script injection in `aks-plan.yaml`. | `.github/workflows/aks-plan.yaml` "Resolve tfvars content" |
| S6 | Medium | GET with side-effects creates branch + PR; concurrent pollers can duplicate. No CAS on save. | `access-status` handler; store `save()` |
| S7 | Medium | Plan run correlation picks any run in last 10 s. | `triggerPlanReview` |
| S8 | Medium | Postgres failure silently degrades to in-memory store. | `InfrastructureRequestStore.init` |
| S9 | Medium | `CLOUDHUB_AUTO_MERGE_ENABLED`/`provisioning.github.autoMerge.enabled: true` in production auto-merges both infra and Tailscale PRs once checks pass. Acceptable only where branch rules require human review (true for scp-infra-as-code; unverified for tailscale). | `app-config.production.yaml:88-92` |

---

## 5. SOP-to-code traceability matrix

Legend: ✅ implemented & real · ◐ partial / incorrect · ✗ missing · 🎭 simulated (displayed but not executed)

| SOP phase / requirement | CloudHub today | Gap |
|---|---|---|
| **1. Regional capacity & compliance** (AKS, ANF, AOAI, PG flexible, Firewall availability; AZ support) | ✗ | No region-capability check. Region list is 7 hard-coded codes. |
| 1. Quota (`Σ max_nodes × vCPU` across all pools) | ✗ | Not computed; cost uses *min* nodes and ignores system pool. |
| 1. Naming | ◐ | Wrong pattern; preview ≠ backend; no `-scp-`, no tenancy/tenantId inputs; tenancy derived from BU. |
| 1. Network (CIDR vs VNet registry, overlap) | ✗ | Hard-coded `10.0.0.0/16` (collides). Registry is Confluence-only. |
| 1. Governance (owner, cost centre, compliance, encryption) | ◐ | Required-field checks only; CMK not modelled; compliance/data-jurisdiction absent. |
| **2. Tailscale jumpbox access** | ◐ ✅ | Real PR + status tracking. Wrong repo owner; `tagOwners` mismatch; k8s-operator tag absent; no post-merge apply verification (gitops-acl-action run). |
| **3. Terraform config & workspace registration** | ◐ | Real branch/commit/PR — **to the wrong repo and directory**, wrong module key semantics, wrong tfvars shape (missing `region_code`, `orchestrator_version`; uses `os_disk_type=Managed` vs root defaults). No Quality Gate. |
| **4. TFC workspace creation, plan, apply** | 🎭 | Fake plan workflow; no TFC observation; no workspacemanager run tracking; no apply confirmation gate; no outputs captured. |
| 4. Branch lifecycle (feature → main; switch back) | ◐ | Entry written with `vcs_branch=main` (correct for merge-first model) but in the wrong file. |
| **5. Core services** (common-res, Datadog, Velero via `scripts`) | 🎭 | Bootstrap list is ArgoCD/ingress/ESO/Prometheus — not the SOP set — and is only logged. No helmfile PR to `scripts`, no 1Password registration, no dispatch, no run tracking. |
| **6. Final validation** | 🎭 | Five checks logged as "OK" without execution. |
| 6. Platform Registry onboarding | ◐ | Writes invalid statuses to a row that never exists; no `cloudhub-*` tag onboarding. |
| Approval (durable, authorised, non-bypassable, audited) | ◐ | Durable + permission-checked; spoofable approver, no self-approval block, no CAS, no audit table, no approval of *specific config version*. |
| Restart recovery | ◐ | Request rows survive; tasks/plan cache do not; no reconciler. |
| Log streaming / resume | ✗ | Polling of a JSONB log array; no cursor. |
| Partial failure & per-operation retry | ✗ | Single `failed` status, no operation model, no retry. |

---

## 6. Capabilities to preserve

- Five-stage wizard UX, profile/flavor cards, cost panel, naming preview, cluster-admin chip input.
- `InfrastructureRequestStore` table (extend via `ADD COLUMN IF NOT EXISTS`; it is the established pattern — no migration framework exists).
- Approval-before-Git ordering and `jumpbox.approve` permission + `platform-approvers` group.
- Tailscale-before-infra ordering (jumpbox access PR merged before the infra PR) — keep unless the SOP says otherwise.
- `JumpboxAccessProvisioningService` validation (`validateJumpboxPolicy`), admin normalisation.
- `asyncRoute` JSON error envelope.
- Existing 68 passing backend tests in the four provisioning suites (baseline run 2026-10-13).
- Other features sharing these modules: Tailscale jumpbox self-service pages reference `createProvisioningRouter` (per `SymphonyFS/tailscale/docs/jumpbox-access-self-service.md`).

---

## 7. Decisions required before implementation

These are owner decisions; the code cannot answer them.

> **Resolved 2026-10-13:** D1 → (A) `scp-infra-as-code` standard root · D2 → (A) merge-first on `main` ·
> D3 → operator confirms apply in TFC; CloudHub observes only · D4 → manual checklist gates, CloudHub
> dispatches and tracks the scripts runs. D5–D8: see §12.2 (D7, D8 resolved; D5, D6 partially
> resolved with explicit remaining dependencies).

**D1 — Infrastructure target repository.** *(blocking)*
- **(A) Recommended:** Target `SymphonySensa/scp-infra-as-code` `azure-kubernetes-service-standard/` + `workspacemanager/workspaces.tfvars` — the SOP path, real modules, real TFC, CODEOWNERS + Quality Gate.
- (B) Keep `jubermohamad/platform_cloudhub/infra/aks` — requires vendoring/consuming the standard root and wiring a TFC workspace manager here, duplicating the SCP pipeline. Contradicts "do not implement a new provisioning engine."

**D2 — Workspace branch lifecycle.**
- **(A) Recommended — merge-first:** PR adds values + `"<cluster>" = {}` (implicit `main`). After merge, CloudHub observes the `workspacemanager` run, then the cluster workspace's first run on `main`; the **TFC plan review + manual Confirm & Apply is the technical gate**. No temporary branches, nothing to switch back.
- (B) SOP-literal — pin `vcs_branch` to the feature branch, plan/apply pre-merge, then a second PR removing `vcs_branch`. Gives a pre-merge plan, but applies unmerged code and requires a cleanup PR.

**D3 — Who confirms the TFC apply.** CloudHub calling `POST /runs/:id/actions/apply` (needs a TFC token with apply rights on `SCP-*-AKS`) vs. CloudHub only *observing* while an operator confirms in TFC. Recommend observe-only initially.

**D4 — Core-services prerequisites.** CloudHub opening a PR to `SymphonyFS/scripts` with the three helmfiles (from templates; velero has none) and writing the 1Password `HELMV-*` sections (needs an `op` service account with write to vault `grtvfcx3…`) — or tracking these as **manual checklist gates** that an operator ticks with evidence. Recommend manual gates first, automate later.

**D5 — VNet CIDR source of truth.** Confluence page is not machine-readable. Options: (a) derive used ranges from `address_space` in all `values/*.tfvars` on `main` + live Azure VNet query, and require operator confirmation against Confluence; (b) create a registry table. Recommend (a) with explicit "unverified against Confluence" state.

**D6 — Tags.** Add `owner`/`costCentre` tags (deviates from established 4-tag convention) or keep them only on the CloudHub request.

**D7 — Tailscale repo.** Confirm `SymphonyFS/tailscale` (the clone's remote) vs. the configured `SymphonySensa/tailscale`.

**D8 — DCP scripts repo default.** `SymphonyFS/pipeline-internal` vs `SymphonyFS/scripts` for `deploy-with-dynamic-runners.yml`.

---

## 8. Proposed minimal refactoring plan (assuming D1-A, D2-A, D3 observe, D4 manual gates)

Small, reviewable PRs, in order:

1. **Security hardening (no behaviour change for valid users).** Approver/requestor from `httpAuth`+`userInfo`; self-approval block; one-decision-per-principal per request; permission checks on every mutating route; remove the unauthenticated auth policy; convert `access-status` to read-only; CAS (`WHERE status=$expected`) in `save`; fail closed when Postgres is configured but unavailable in production; delete `complete-access` fabrication (return 501 until real); fix `aks-plan.yaml` injection or retire it.
2. **Canonical request + naming.** Inputs `tenancy`, `tenantId`, `env` (validated against module rules), `region` (from `region_shortnames` incl. overrides), node pools (system + up to 3 user), CMK flag/refs, `address_space`. One shared naming module used by preview, persisted request, tfvars and workspace key. Remove existing-RG UI. Add `config_version` + `config_hash`; approvals bind to the hash; edits after approval require amendment.
3. **Backend preflight** (`POST /requests/:id/preflight`, persisted with source + timestamp): naming/uniqueness against `values/` on `main`; CIDR overlap against all `values/*.tfvars` + Azure VNets (verified/blocked/unknown); quota via Azure Compute usages API (`Σ max × vCPU` per family, all pools, all regions); region capability via Azure providers/SKU APIs; policy checks; cost with stated assumptions. Unknown ⇒ requires explicit operator acknowledgement.
4. **Operation model.** New table `provisioning_operations` (request_id, kind, status, external_id, external_url, attempt, started/finished, error, cursor) + `provisioning_events` (monotonic id for SSE resume) + audit to `control_plane_audit_logs`. Request status derived from operations. Reconciler on startup + scheduler tick (`coreServices.scheduler`).
5. **Infra PR to scp-infra-as-code.** HCL generated via a safe writer (escaped strings); file `azure-kubernetes-service-standard/values/<cluster>.tfvars`; workspace entry via structural insert; branch `feature/SCP-<ticket>-create-aks-<cluster>` (ticket required input); PR body with request id, config hash, approvals, cost assumptions; track Quality Gate check + reviews + merge.
6. **TFC observation** (reuse `terraformCloudService`, sim fallback disabled): workspacemanager run → workspace exists → cluster run; surface plan resource counts and policy checks from TFC; wait for confirm/apply; capture outputs (`aks_cluster_id`, `cluster_fqdn`, `kubelet_identity_object_id`, …). Fix `policy_*` status mapping.
7. **Infrastructure verification** via Azure ARM (AKS provisioningState, pools, version, zones, DES) and Tailscale apply-run status; API reachability marked *unverifiable from CloudHub* unless a private-network runner is available.
8. **Core services** via DCP `ScriptsPipelineDeploymentService` (correct repo), sequential common-res → datadog → velero, gated on D4 checklist; per-op retry.
9. **Readiness + registry**: create/activate `pr_clusters` row (valid `EntityStatus`), `POST /clusters/onboard` tags; `COMPLETED` only when all mandatory ops succeeded; otherwise `PARTIALLY_FAILED` with failed op identified.
10. **Frontend**: request id in URL; hydrate from `GET /requests/:id`; render operations/timeline from backend; remove local simulation and local cost/plan fallbacks; approvals moved to the approvers' view (keep read-only status in wizard); SSE with Last-Event-ID resume; retry buttons gated by `retryable`.
11. **Tests**: unit (naming, HCL writer, quota, CIDR), router (authz, CAS, transitions, amendment), integration with fetch-router fakes (GitHub, TFC, Tailscale, scripts, registry), frontend (`AksWorkflowPage` rendering per state), mocked E2E.

---

## 9. Integration risks & required configuration

| Integration | Credential / config | Risk |
|---|---|---|
| scp-infra-as-code PRs | GitHub token/App with `contents:write`, `pull_requests:write` on `SymphonySensa/scp-infra-as-code` | Org policy may forbid bot branches; CODEOWNERS review is human. |
| Terraform Cloud | `TFC_TOKEN` read on org `sensa-cloud-platform`, projects `SCP-DEV-AKS`/`SCP-PRD-AKS`, and `workspacemanager` | Token with apply rights is high-privilege (D3). |
| Azure preflight & verification | SP/MI with Reader + `Microsoft.Compute/locations/usages/read` across target subscriptions | Single-subscription assumption in scripts pipeline. |
| Tailscale | Token on `SymphonyFS/tailscale` | Repo owner mismatch (D7). |
| SymphonyFS/scripts dispatch | Token with `actions:write` on `SymphonyFS/scripts` | Repo default mismatch (D8); run-name correlation only; `inputs.debug` referenced but undefined. |
| 1Password | `op` service account (if D4 automated) | Write access to shared CLOUDAPPS vault. |
| Platform Registry | Postgres; onboarded cloud account for subscription | `createCluster` requires `cloudAccountId`. |
| Private clusters | API reachability only via jumpbox/private runners | CloudHub cannot verify kube API directly. |

---

## 10. Explicitly unverified

- Content of the SCP AKS SOP itself (not located).
- Whether `addAuthPolicy({path:'/api/provisioning'})` currently opens the routes (path semantics).
- Branch protection on `SymphonyFS/tailscale` and `SymphonyFS/scripts` (not visible from clones).
- `workspacemanager` workspace's own `auto_apply` setting.
- Whether the SOP expects `github-actions-iac.yml cluster-create` as part of post-provisioning.

---

## 11. Implementation log

### Step 1 — Security hardening (done, uncommitted)

| Finding | Change |
|---|---|
| S1 | Approver/rejecter/requestor resolved from `httpAuth.credentials({allow:['user']})` → `userEntityRef`; body values ignored. Requester self-approval → 403 unless `ALLOW_SELF_APPROVAL=true`. One approver per stage (409 on a second stage by the same user). Wizard no longer sends `approver`. |
| S2 | `requireUser` on `/plan`, `/submit`, `create-pr`, `provision-access`, `complete-access`, `task/:id/cancel`; no-op `allow: 'unauthenticated'` policy removed (default Backstage auth applies). |
| S3 | `complete-access` returns **501** and changes nothing; fabricated `BOOTSTRAP_STEPS`/`VALIDATION_CHECKS` removed. |
| S4 | `hclString()` escapes `"`, `\`, control chars, `${`, `%{` for every user value in generated tfvars. |
| S5 | `aks-plan.yaml`: inputs passed via job `env`, validated by regex, never `${{ }}`-interpolated in `run:`. |
| S6 | `version` column + conditional `UPDATE … WHERE version=$n`; `ConcurrentModificationError` → 409. Final approval and the Tailscale-merge transition persist a claim (`approved` / `preparing_infra_pr`) **before** calling GitHub; branch/PR failure after the claim → `failed`. Migration `003_provisioning_version.sql`. |
| S8 | Postgres init failure throws when `NODE_ENV=production`. |

Tests: 16 new (identity, self-approval, separation of duties, genuine concurrent approve/poll races via barriers, 501, HCL injection, CAS in memory + postgres, fail-closed). Provisioning suites 84/84; full backend 334/334; `tsc` clean; backend lint clean.

Not addressed yet: S7 (plan-run correlation — the plan workflow is replaced in step 5/6), approval stage roles beyond `Platform Team` still have no group mapping (`Cloud Architect`, `Operations` are satisfiable by any `platform-approvers` member), `TailscaleJumpboxApprovalsPage` (unrouted) still uses raw `fetch` without a token.

---

## 12. Review gate 2 — security review, decisions D5–D8, approval integrity, canonical model

All changes uncommitted. Evidence sources: `SymphonySensa/scp-infra-as-code` `main@6bc941b` (2026-10-12),
`SymphonySensa/scp-azure-terraform-modules` `main@7db1b47` (2026-10-10), GitHub API metadata for
`SymphonyFS/{tailscale,scripts,pipeline-internal,pipeline-clients}` and `SymphonySensa/tailscale`
(read-only, 2026-10-13). Confluence (`netreveal.atlassian.net`) returned **403 "app not installed"**:
the *Virtual Network Information* page and the SCP AKS SOP could not be read.

### 12.1 Phase A — security review of step 1

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Actor from Backstage identity on every state-changing route | **Pass**, with one caveat | `requireUser`/`requireApprover` resolve `httpAuth.credentials({allow:['user']}).principal.userEntityRef` on `/plan`, `/submit`, `/amend`, `/approve`, `/reject`, `/create-pr`, `/provision-access`, `/complete-access`, `/task/:id/cancel`; body `requestor`/`approver` ignored (tests "records the authenticated user…", "requires a user for…"). **Caveat:** `GET /access-status` and `GET /pr-status` still perform state transitions driven by *observed GitHub merge state*; they require Backstage auth (user or service) but record no actor. To be replaced by a reconciler (step 4). |
| 2 | No self-approval unless explicitly configured | **Pass** | 403 unless `ALLOW_SELF_APPROVAL=true` (same switch as the deployment control plane); each use now writes a request log line and a `logger.warn`. |
| 3 | Per-stage authorization and separation of duties | **Was failing → fixed** | **Pre-existing critical hole:** `cloudhubPermissionPolicy.ts` returned ALLOW for `jumpbox.approve` to any user whose only group was `cloudhub-login-allow` (every signed-in production user) because the login-allow branch ran first and `jumpbox.approve` was not on its deny list. Reproduced by a failing test, fixed by deciding approval permissions first (`aksApprovalStages.ts`). Stages now have distinct permissions, are decided in order, and one user cannot approve two stages. See §12.3. |
| 4 | No duplicate PRs / external operations | **Pass** (after fixes) | Versioned CAS + claim-before-call for final approval (Tailscale PR) and Tailscale-merge transition (infra PR); legacy `provision-access` now refuses when a Tailscale PR exists; re-approval after an integrity reset reuses the existing Tailscale PR. Race tests use barriers and were mutation-checked. |
| 5 | CAS covers every read-modify-write | **Pass** | Every `store.save` is `UPDATE … WHERE version=$n`; `ConcurrentModificationError` → 409 (incl. `pr-status`, previously 500). In-memory `provisioningTasks` map is not request state of record and is untouched. |
| 6 | Terraform values cannot inject syntax | **Pass** | Single `hclString` (shared) escapes `\ " \r \n \t`, all C0/C1/U+2028/2029 as `\uNNNN`, `${`→`$${`, `%{`→`%%{`. Verified with Terraform 1.15.1 (`hashicorp/terraform` image): `terraform fmt -check` passes and `terraform console` decodes a hostile `customer` value to the identical string. Structural fields are allow-list validated (regexes in `aksCluster.ts`). |
| 7 | Shell inputs validated and passed safely | **Pass** | `aks-plan.yaml` inputs via `env`, regex-validated, quoted. The workflow is no longer dispatched (pre-merge plan removed, §12.4). No backend subprocesses. |
| 8 | Production fails safely without persistence | **Pass** | Throws when `NODE_ENV=production` and `POSTGRES_HOST` is unset (matches the deployment control plane rule) or schema init fails. |
| 9 | Migration on existing installation | **Pass** | `003_provisioning_integrity.sql` is additive/idempotent. Opt-in integration test against a throwaway **Postgres 16** (separate container; the local dev DB was not touched): 001+002 database with live and **duplicate-name legacy rows** upgrades in place, rows preserved, re-run is a no-op, CAS and claim indexes enforced. Run with `PROVISIONING_PG_TEST_URL=…`. |
| 10 | 501 `complete-access` shows no false success | **Pass** (after fixes) | The UI never called it. Found and removed other false-success paths: dormant client-side provisioning simulation, "cancel" with no task showing *cancelled*, "Monitoring backend task status" text, and a local plan estimate shown as *completed* on `/plan` failure. |

Other findings fixed in this round:

- **Registry clobbering:** final approval ran `UPDATE pr_clusters SET status='Pending Access' WHERE cluster_name=$1`. With no uniqueness check, an approval for a name that already exists would rewrite a live cluster's registry status (and the value is not a valid `EntityStatus`). Removed; registration moves to verified readiness.
- **Fabricated log line** in the legacy `provision-access` path ("Terraform apply complete — AKS cluster and jumpbox created") removed.

Remaining (not fixed, tracked): GET routes with side effects (→ reconciler); no audit table yet
(decisions are in the request log and app logs); `TailscaleJumpboxApprovalsPage` (unrouted) uses
raw `fetch` without a token; `CLOUDHUB_AUTO_MERGE_ENABLED=true` in production config (safe only
while branch rules require human review).

### 12.2 Phase B — decisions D5–D8

**D5 — Network allocation: PARTIALLY RESOLVED (registry inaccessible).**
- *Evidence:* no machine-readable registry, reservation file, IPAM or CIDR CI check exists in
  `scp-infra-as-code` or the modules repo (exhaustive grep). The only reference is a Confluence link
  (`CDOPSNROD/pages/320504089`) — **403, unreadable from here**. De-facto allocation = next free
  `10.X.0.0/16` in a values file (highest in use: 10.221). Every standard cluster peers with hub VNets
  (AWX `uss-enterprise-vnet` 10.2/16, runner `production-devops/Default` — CIDR not in repo, ArgoCD
  `vnet-scp-prd-argocd-frc-scp`), so a new range must be unique across standard **and** legacy clusters,
  VDI (10.85, 10.121–10.125), service layer (10.165–10.178 /22s) and the hubs. Existing overlaps found:
  `aks-scp-dev-uks-st-scratch` 10.125/16 vs `vdi-scp-prd-san-mt-all` 10.125/16; legacy 10.8 ×2, 10.82 ×3.
- *Reservations / atomicity:* none exist in the SCP system. **Implemented (CloudHub-side guard only):**
  partial unique indexes on `claim_address_space` / `claim_cluster_name` make two concurrent CloudHub
  requests for the same /16 or cluster fail atomically (409). This is not an allocation guarantee against
  out-of-band changes.
- *Selected:* input = explicit `/16` inside `10.0.0.0/8`, never `10.0.0.0/16`; subnets derived exactly as
  `locals.tf` (`cidrsubnet(/16,2,0)`, `(2,2)`, `(8,192)`, `(11,2040)`).
- *Remaining dependency (step 3 preflight):* overlap check against every `address_space` /
  `vnet_address_space` on `main` (all roots) + live Azure VNet query + the runner VNet CIDR, reported as
  verified/blocked/unknown; the Confluence registry stays a manual confirmation until it is readable.

**D6 — Ownership / cost-centre tags: PARTIALLY RESOLVED.**
- *Evidence:* no tagging convention document and **no Azure Policy requiring tags** in either repo. The
  values template's 4 keys `created, customer, env, terraform` are the de-facto convention (present in
  ≥32/40 files). An unused `tags` module defines `CostCenter1`, `ManagedBy`, … ; `CostCenter1` is the only
  cost-centre key in use (`aks-scp-prd-eus-mt-all` = `P64358`, `azure-mail-infra` = `CC2002`). No owner key
  is established (`owner`/`Owner` appear only in two unrelated roots).
- *Where tags land:* `var.tags` → RG, VNet, AKS cluster (**creation only** — module `ignore_changes = [tags]`),
  jumpbox VM/NIC/NSG/PIP, storage accounts, NetApp account/pool, DES, VPN, flow logs. **Not** node pools,
  subnets, containers, peerings, private DNS links.
- *Selected:* emit `created` (ISO date), `customer` (request display name), `env`, `terraform="true"`,
  `CostCenter1` (request cost centre, validated `^[A-Za-z0-9][A-Za-z0-9-]{1,31}$`). Owner email is kept on
  the CloudHub request only. The invented `FS001–FS005` cost-centre list was removed.
- *Remaining:* authoritative cost-centre source (none found) and whether an owner tag key should be
  standardised — needs an SCP platform decision; node-pool tagging would need a root change.

**D7 — Tailscale repository: RESOLVED → `SymphonyFS/tailscale` `main`.**
- `SymphonySensa/tailscale` (id 344325264) is **archived**, default branch `master` (no `main`),
  policy 17 months stale, zero Actions runs. `SymphonyFS/tailscale` (id 756367318, distinct org
  "SymphonyAI Financial Services") applies via `gitops-acl-action` on push to `main`
  (2,054 runs; latest successful apply 2026-10-13T10:12Z); 632 jumpbox PRs (sensabot). No
  CloudHub-opened PR exists in either repo.
- *Changed:* `app-config.yaml`, `.env.example`, service default → `SymphonyFS`; commit message →
  conventional (`chore: grant jumpbox access for …`) per the `main` ruleset.
- *Remaining dependencies:* ruleset also requires commit author email `<id>+<login>@users.noreply.github.com`,
  linear history, 1 code-owner review (`@symphonyfs/cloud-operations`); `allow_auto_merge=false`.
  The CloudHub token identity's commit email is unverified. Tailscale-operator tag
  `tag:k8s-operator-<cluster>` is not yet generated.

**D8 — Post-provisioning pipeline: RESOLVED → `SymphonyFS/scripts`.**
- `pipeline-internal` / `pipeline-clients` are forks auto-synced from `scripts`
  (`push-changes-to-forks.yml`); `deploy-with-dynamic-runners.yml` is byte-identical in all three and
  branches on `github.repository`. The fork split is **client-facing vs internal by instance-name
  suffix, and only for project apps**; for the forks, any non-project app (`common-res`, `datadog`,
  `velero`, `tailscale`) fails "non-project apps CANNOT be processed". Run history confirms all cluster
  add-on runs (prd and dev) go through `scripts`; the one `pipeline-clients` common-res attempt failed.
  **The stated "internal = non-prod, clients = prod" rule does not hold for cluster add-ons.**
- *Contract:* `appName` ∈ {`common-res`,`datadog`,`velero`}, `appInstance` = AKS cluster name; requires a
  pre-existing `apps/<app>/<cluster>/helmfile.yaml` with `kubeContext: <cluster>` on `scripts` `main`
  (404 otherwise; no CI creates instances); cluster must be in the single org-level `AZURE_SUBSCRIPTION_ID`
  (value not visible); runner chosen by private-cluster flag. Run correlation only via run-name
  `…-[<app>]/[<instance>] initiated by [<actor>]`.
- *Selected:* the AKS add-on stage will dispatch to `SymphonyFS/scripts` explicitly (not via the deployment
  control plane's `SYMPHONYFS_SCRIPTS_REPOSITORY`, whose default `pipeline-internal` would reject platform
  apps). DCP default left unchanged (other features depend on it) — flagged.
- *Remaining:* helmfile instances + 1Password `HELMV-COMMON-RES/<cluster>`, `HELMV-VELERO/<cluster>`
  remain manual gates (D4); confirm the org subscription equals `b0799078-…` (the standard root's
  `provider.tf` subscription).

### 12.3 Phase C — approval integrity

- **Fingerprint:** `sha256` over canonical JSON (recursively sorted keys) of `{request, clusterAdministrators
  (lower-cased, sorted)}` — every Terraform input, governance field, profile and jumpbox admin.
  Persisted as `config_fingerprint`; each approval stores the fingerprint it was given for.
- **Verified** before each approval decision, before the Tailscale PR, before the infrastructure branch/PR,
  and on `create-pr`. Any mismatch (tampering or stale approval) resets every stage to pending, re-binds
  to the current configuration and returns 409; no external call is made.
- **Amendments:** `POST /request/:id/amend` — requester only, only while `pending_approval`, validated by
  the shared model; a changed fingerprint resets all approvals (logged per invalidated stage); an
  unchanged one keeps them. After full approval: reject and resubmit.
- **Stage authorization** (`aksApprovalStages.ts`): Platform Team → `jumpbox.approve` → groups from
  `CLOUDHUB_APPROVER_GROUP_REF` (default `group:default/platform-approvers`); Cloud Architect →
  `provisioning.aks.approve.cloud-architect` → `CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS`; Operations →
  `provisioning.aks.approve.operations` → `CLOUDHUB_AKS_OPERATIONS_GROUP_REFS`. **No defaults and no
  fallback** for the last two: no such groups exist in the catalog, policy or Entra mapping, so those
  stages are disabled and profiles needing them are refused at submit (422).
  **Decision needed:** production tokens carry only `cloudhub-login-allow` and `cloudhubplatformowners`
  (`symphonyMicrosoftSignInResolver.ts`). `platform-approvers` is never issued unless
  `CLOUDHUB_APPROVER_GROUP_REF` is set in the deployment (not in the repo) — otherwise **no one can
  approve in production**. New approver groups require Entra groups + resolver entitlements.
- **Legacy requests:** a free-text requestor (not `user:<ns>/<name>`) or a missing fingerprint → approval
  refused (409) with "reject and resubmit"; rejection still works.

### 12.4 Phase D — canonical naming and configuration model

`plugins/platform-common/src/aksCluster.ts` (exported via `./backend` and the root) is the single source
for the wizard preview, backend validation, persistence and the PR contents.

- **Names** = naming module v1.12.0 generic style, no `seq2` (the AKS/RG module calls never pass it):
  `aks-scp-{env}-{region}-{st|mt}-{tenant}`, `rg-…`, `vnet-…`, `mc-rg-…-node-rg`, `jumpbox-…`. Region code
  from the verbatim `region_shortnames` map (`australiaeast` → `ae`; no `aue`). Reproduces existing
  cluster names (tested).
- **Inputs** validated to module rules: env ∈ {dev,test,stg,uat,qa,ppd,prd}; tenancy st|mt; tenant
  `all` or `[a-z0-9]{2,24}`; full K8s version; `/16` address space; pools (system min ≥1, user min ≥0,
  max ≤1000, Spot only for user pools outside prd/ppd); Jira change ticket (branch/commit convention).
- **Not offered:** existing resource group (root always creates it), subnet inputs (derived),
  subscription (fixed in `provider.tf`: `b0799078-…`), multi-region profiles (paired clusters not yet
  generated — rejected instead of silently dropping the secondary region).
- **Output:** `azure-kubernetes-service-standard/values/<cluster>.tfvars` (explicit `region_code`,
  `orchestrator_version` per pool, `usernp01 = null` when no user pool since the variable defaults to `{}`)
  and `"<cluster>" = {}` in the `workspacemanager/workspaces.tfvars` standard block (no `vcs_branch` ⇒
  `main`; merge-first lifecycle, nothing to switch back). Both are `terraform fmt`-clean (verified against
  the real `main` file, including whole-run re-alignment). Existing values file or workspace → refused.
- **Repository:** `INFRA_REPO` default `SymphonySensa/scp-infra-as-code`; the fallbacks to the CloudHub
  repo were removed. Branch `feature/<SCP-ticket>-create-aks-<cluster>`; PR into `main` with request id,
  fingerprint and approvers.
- **Removed fake plan:** `/plan` is now a pure validate-and-preview endpoint (exact values file, names,
  subnets); `/plan/status` → 410; no `aks-plan.yaml` dispatch. The plan comes from Terraform Cloud
  post-merge.
- **Consistency test** (`createProvisioningRouter.test.ts`, "preview, persisted request, values file and PR
  input agree") proves preview name = persisted name = values-file content = `prepareFeatureBranch` input.

- **Wizard** (`AksWorkflowPage.tsx` + `aksWizardRequest.ts`): the form maps 1:1 onto the canonical request
  (`toAksClusterRequest`). Removed: subscription selector, existing/new RG choice, secondary region, free
  node-size choice, cost-centre list, local region maps, local cost/plan calculator, local name and tfvars
  builders, plan-run polling. Subscription/RG are read-only; subnets are shown derived; multi-region
  profiles are disabled ("not yet supported"); review calls `/plan` and blocks Submit on failure; cost reads
  "Not estimated yet"; submit is single-flight and only advances after a successful response; backend
  `fieldErrors` are shown on the matching inputs.

**Compatibility:** in-flight legacy requests (old payload shape, no fingerprint) cannot be approved and
will fail at the infrastructure-PR step; they must be rejected and resubmitted. The `aks-plan.yaml`
workflow file remains in the repo but is unused.

### 12.5 Next stage (blocked on review) — infrastructure execution tracking

PR / Terraform Cloud integration (plan step 5–6): track Quality Gate + CODEOWNERS review + merge on
`scp-infra-as-code`, then the `workspacemanager` run, workspace creation and first run on
`sensa-cloud-platform` (read-only TFC token, operator confirms apply), capture outputs. Dependencies: TFC
read token for `workspacemanager` + `SCP-DEV-AKS`/`SCP-PRD-AKS`; GitHub token with PR rights on
`scp-infra-as-code` and `SymphonyFS/tailscale`; `CLOUDHUB_APPROVER_GROUP_REF` production value; step 3
preflight (D5 overlap, quota) before enabling submission in production.


## 13. Stage 3 — read-only infrastructure execution tracking

### 13.1 Facts confirmed from the real configuration (scp-infra-as-code main, 2026-10-13)

| Fact | Source |
| --- | --- |
| TFC organization `sensa-cloud-platform`; the workspace manager runs in TFC workspace `workspacemanager` | `workspacemanager/providers.tf`, `README.md` (backend note) |
| One TFC workspace per `workspaces.tfvars` entry, **named exactly as the entry key** (= cluster name), `working_directory = azure-kubernetes-service-standard`, `TF_CLI_ARGS=-var-file=values/<name>.tfvars`, VCS `SymphonySensa/scp-infra-as-code` `main` | `workspacemanager/main.tf`, `locals.tf`, `variables.tf` |
| Project = `project_name_override`, else env parsed from the **workspace name** (3rd `-` segment before `__`): dev/test/stg/uat/qa → `SCP-DEV-AKS`, prd/ppd → `SCP-PRD-AKS`, else `SCP-IAC` | `workspacemanager/locals.tf` `effective_project_name` |
| `auto_apply = false`, `queue_all_runs = true` by default → a run is queued on workspace creation and an operator must confirm apply | `variables.tf`, README "Enforced defaults" |
| Required status check on main: **`Terraform Quality Gate`** from GitHub Actions (integration 15368); 1 approval, **CODEOWNERS review required** (`@SymphonySensa/azure-team`), last-push approval, thread resolution | ruleset `default-branch-protection` (id 23944830), `.github/CODEOWNERS` |
| TFC speculative plans are posted as commit statuses `Terraform Cloud/...` and are **advisory** (not required) | `docs/branch-protection.md` (SCP-8719) |
| Cluster subscription is fixed for every env | `azure-kubernetes-service-standard/provider.tf` L26 |
| Non-sensitive root outputs (`aks_cluster_id`, `cluster_fqdn`, pools, identities, velero/netapp names, CMK ids); `kube_config` is sensitive | `azure-kubernetes-service-standard/outputs.tf` |

Not verifiable without a TFC token (none available locally): whether the `workspacemanager` workspace itself
auto-applies, its trigger patterns, and the exact VCS ingress attributes. The tracker therefore attributes the
workspacemanager run by merge-commit SHA, falls back to "first run after merge" (never treated as a failure), and
treats the cluster workspace's **existence** — not the run — as the proof of creation.

### 13.2 Status mapping (implemented in `services/aksExecutionStatus.ts`)

GitHub (pre-merge; request status `awaiting_pr_merge`):

| Observation | Phase |
| --- | --- |
| PR closed, not merged | `pr_closed` → request `failed`, claims released |
| Quality Gate check (Actions app only) concluded failure / timed_out / cancelled / action_required / startup_failure / stale | `quality_gate_failed` |
| `reviewDecision = CHANGES_REQUESTED` | `changes_requested` |
| Quality Gate not reported / queued / in progress (unknown conclusions count as pending) | `pr_checks_pending` |
| Gate passed (success/neutral/skipped), `reviewDecision` ≠ APPROVED | `awaiting_review` |
| Gate passed and APPROVED, not merged | `awaiting_merge` |

Post-merge (request status `provisioning` for every non-final phase, including failures, so operator retries are still
observed):

| Observation | Phase |
| --- | --- |
| Merged, no workspacemanager run yet | `pr_merged` |
| Merged commit lacks the workspaces.tfvars entry or the values file | `workspace_mapping_mismatch` |
| Workspace absent; workspacemanager run planning / awaiting confirmation / applying | `workspace_creation_pending` |
| Workspace absent; workspacemanager run errored / cancelled / discarded / no changes, or applied (matched by merge commit) | `workspace_creation_failed` |
| Workspace present but project / working dir / repo / branch differ from the definition, or auto-apply on | `workspace_mapping_mismatch` |
| Workspace present, no run | `plan_pending` |
| TFC run `pending…planning`, `cost_estimating`, `policy_checking`, `post_plan_running`, or planned but not confirmable | `plan_pending` |
| `planned` / `cost_estimated` / `policy_checked` / `policy_override` / `policy_soft_failed` / `post_plan_completed` / `planned_and_saved` **and confirmable** | `awaiting_operator_apply` |
| `confirmed` / `apply_queued` / `applying` / `post_apply_running` | `apply_running` |
| `applied` / `post_apply_completed` | `apply_succeeded` (not complete) |
| `applied` and outputs read from the state version of that run (with `aks_cluster_id`) | `outputs_available` → request `infrastructure_ready` |
| `errored` before / after confirmation | `plan_failed` / `apply_failed` |
| `canceled`/`force_canceled` before / after confirmation | `plan_cancelled` / `apply_cancelled` |
| `discarded` | `apply_discarded` |
| `planned_and_finished` | `plan_no_changes` |
| Unrecognised status | `unknown` |
| Any read fails | last verified phase kept; `refresh.error` set; API reports `freshness: stale` (or `never_verified`) |

Plan-only (speculative) and destroy runs are ignored. A merge, a successful plan, a workflow dispatch or the existence of
a workspace never maps to success.

### 13.3 Consistency rules
- Facts merge monotonically: a merged PR is never re-read; a run's status only moves forward (lower-ranked observations
  of the same run are ignored); a different run replaces the tracked one only if created later (operator retry).
- One refresh per request at a time in-process; across processes the store's version check lets only one writer persist
  (the loser re-reads). Phase changes append exactly one history entry and one log line.
- Polls inside 15 s reuse stored state; a scheduled task (`provisioning-aks-execution-tracking`, 60 s, global scope)
  resumes every `awaiting_pr_merge` / `provisioning` request after a restart.
- Legacy rows (no fingerprint), rows without `pr_repository`, or PRs in another repository are never tracked (their PR
  number may belong to the old CloudHub repository).

### 13.4 Execution boundary (evidence)
- All tracking and gate traffic goes through `ReadOnlyHttpClient`: `get()` always sends GET; `readQuery()` POSTs only to
  registered query endpoints (GitHub GraphQL — single `query` operation, mutation/subscription refused; Azure Resource
  Graph — KQL query + scope only); cross-origin URLs refused. There is no PUT/PATCH/DELETE path.
- Source-level test: the tracking/gate modules import no Octokit, no write service, no other HTTP client, and contain no
  `fetch(` / `method:` outside the transport.
- Lifecycle tests assert every recorded request is a read (`assertReadOnly`), including through the HTTP routes.
- The TFC token is a separate variable (`CLOUDHUB_AKS_TFC_READ_TOKEN`) intended to be read-only; it is never the
  write-capable `CLOUDHUB_TFC_TOKEN`.

Pre-existing writes outside the tracker (unchanged, listed for completeness): approval opens the Tailscale PR;
`GET /access-status` creates the infrastructure branch + PR after the Tailscale merge; `createPullRequest` enables
GitHub auto-merge when `provisioning.github.autoMerge.enabled` (true in `app-config.production.yaml`).

### 13.5 Production gates (`services/aksSubmissionGates.ts`)
Run on `/plan` (preview), `/submit`, `/amend` and again at the final approval. Every check must be `passed`; `failed`
and `unverified` both block (HTTP 412).

| Gate | Source |
| --- | --- |
| `cidr_repository` | every `address_space`, `vnet_address_space`, `address_space_cidr` and Cloudflare route `prefix` in all `.tfvars` on scp-infra-as-code main (cached per commit); truncated tree ⇒ unverified |
| `cidr_azure` | Azure Resource Graph, all VNets visible to the reader (optionally a management group); zero VNets ⇒ unverified |
| `compute_quota` | Resource SKUs (offered / restricted) + Compute usages in the fixed subscription and region; node-pool **minimums** must fit family, regional `cores` and Spot `lowPriorityCores`; maximum overflow is a warning; jumpbox size (module default) not included |
| `github_permissions` | the write token has push on scp-infra-as-code and SymphonyFS/tailscale, neither archived |
| `approver_groups` | every stage of the chain has groups configured |
| `production_enabled` | prd/ppd only: `provisioning.aks.productionSubmissions.enabled` (default false) |

Legacy requests: `GET /legacy-requests` (approvers) lists them with their PR URLs; `POST /request/:id/retire-legacy`
(Platform Team approvers) closes them in CloudHub only and logs the PRs to close manually.

Read authorization: `/requests`, `/request/:id`, `/execution`, `/execution/refresh`, `/pr-status`, `/access-status`
require a user; non-approvers see only their own requests.

Owner tag: still no convention (governance gap, §12.2 D6); nothing invented.

### 13.6 Verification (2026-10-13)
- Automated: backend 489 passed / 6 skipped (opt-in PG suite), PG16 migration suite 6/6 (001+002 → 003 → 004,
  restart recovery), platform-common 72/72, platform-home 85/85; repo `tsc` 0 errors; eslint clean (wizard's two
  pre-existing jsx-a11y errors fixed); backend and app production builds succeed.
- Mutation checks: removing the same-run ordering rule, the outputs requirement, the merged-PR guard, single-flight, or
  the log-once rule each fails exactly one tracker test; reverting the error/record spread order fails its test.
- Browser smoke (local only): real app + a minimal backend (auth guest provider, CloudHub permission policy,
  provisioning plugin), throwaway Postgres, and a local stub answering GitHub/TFC reads from the same fake as the unit
  tests. Verified navigation, client validation, `/plan` preflight (real overlap found in the stub inventory, unverified
  Azure checks blocking Submit), approval status + 403 message, resumption via `?request=` (own requests; 403 for
  others), tracking panels for awaiting review, awaiting operator apply (TFC link only), stale (503) and outputs
  available (sensitive output named only), and a legacy request (not tracked). The stub saw only GETs and GraphQL
  queries. Fixed during the smoke: error messages lost behind `...serializeRequest(record)` (pre-existing), wizard copy
  claiming the CloudHub repo, an unobserved "Open" PR state, registry updates and cluster bootstrap.

## 14. Remediation before live end-to-end testing (2026-10-13)

### 14.1 No side effects from GET
- `GET /access-status` is strictly read-only: one GitHub read of the Tailscale PR, no persistence, no branch/PR
  creation. It reports `merged` and `infraPrActionAvailable`.
- The infrastructure branch + PR are created only by **`POST /request/:id/infrastructure-pr`** (`create-pr` is an
  alias). It requires the requester or an AKS approver, a non-legacy request, intact approvals for the current
  fingerprint, a **live-verified merged Tailscale PR**, and passing preflight gates (re-run). It claims
  `preparing_infra_pr` with a versioned save (concurrent duplicates → 409), persists `infra_pr_operation`
  (state, attempt, actor, branch/commit/PR ids) after each step, and on failure records `infra_pr_failed`
  (retryable explicitly; a claim older than 10 min may be taken over).
- Service idempotency: deterministic branch name (no timestamp suffix); an existing branch is resumed only if its values
  file matches the approved one (the `created` tag may differ); the workspace entry is inserted once; an open or
  merged PR from the branch is adopted; a closed-unmerged PR is not replaced.
- `GET /pr-status` returns stored tracking only; refresh is `POST /execution/refresh`.
- GET audit (all provisioning GET routes): `/preflight` (GitHub reads), `/plan/status/:id` (410), `/requests`,
  `/request/:id`, `/request/:id/execution`, `/request/:id/pr-status`, `/request/:id/access-status`, `/task/:id`,
  `/task/:id/logs`, `/mode`, `/legacy-requests` — none writes to the store or to an external system (regression test
  polls all of them and asserts the record is unchanged and no write service is called).
- Legacy `POST /provision-access` now requires the Platform Team approval permission.
- Wizard: polling shows status only; after the Tailscale merge it shows a **Create infrastructure PR** button
  (Retry after a failure; preflight results on 412).

### 14.2 Auto-merge
- The infrastructure service has no auto-merge or merge code and takes no auto-merge configuration (removed
  `enablePullRequestAutoMerge` and `CLOUDHUB_AUTO_MERGE_*` handling). Effective production config
  (`app-config.yaml` + `app-config.production.yaml`, per both Dockerfiles) still sets
  `provisioning.github.autoMerge.enabled: true`, which now reaches only the Tailscale policy PR service.

### 14.3 Credentials
- `buildReadOnlyIntegrations`: tracking reads GitHub only with `CLOUDHUB_AKS_GITHUB_READ_TOKEN` (no fallback to the
  write token), TFC only with `CLOUDHUB_AKS_TFC_READ_TOKEN`, and Azure with canonical `AZURE_*`; a read token equal
  to a write token is refused. The write token is used for one GET (the push-permission gate).
- Write-client (Octokit) base URL override `CLOUDHUB_GITHUB_API_URL` exists for local smoke tests and is ignored when
  `NODE_ENV=production` (tested).

### 14.4 Verification
- tsc 0 errors (`--pretty false`; the previous round's "0" was miscounted from coloured output and two test-file type
  errors existed then — fixed), backend 514 passed / 6 skipped, PG16 suite 6/6, platform-common 72/72,
  platform-home 85/85, eslint clean, backend + app builds succeed; built bundle checked (tracker/readers use
  `ReadOnlyHttpClient`; `enablePullRequestAutoMerge` only in the Tailscale service).
- Browser: polling `access-status` after the Tailscale merge for 30 s + 25 s → 0 writes at the stub; click with Azure
  unconfigured → 412, 0 writes; click with a stubbed Azure reader → exactly 4 writes (createRef, 2 commits,
  createPullRequest); repeated action ×3 + reload → 0 writes (`alreadyCreated`).

## 15. Non-production E2E readiness (2026-10-13) — nothing submitted, no PRs, no runs

### 15.1 Changes in this round (uncommitted)
- `app-config.production.yaml`: `provisioning.github.autoMerge.enabled: false`. Evidence: SymphonyFS/tailscale
  `docs/jumpbox-access-self-service.md` ("The repository owner or designated approver reviews and merges the PR"),
  ruleset 391804 (CODEOWNERS `@symphonyfs/cloud-operations` review required, last-push approval, linear history),
  repository `allow_auto_merge=false` — with auto-merge on, every Tailscale PR creation would have thrown after the PR
  was opened (latent production bug).
- Tailscale commits: explicit author/committer, the configured one or `<id>+<login>@users.noreply.github.com` of the
  token's user; refused (before any branch is created) unless it matches the ruleset regex.
- github_permissions gate probes each repository with the token its writer actually uses (infra:
  `GITHUB_ACTIONS_TOKEN`, else `GITHUB_TOKEN`; Tailscale: `GITHUB_TOKEN`, which `index.ts` fills from
  `CLOUDHUB_GITHUB_TOKEN`). `CLOUDHUB_GITHUB_TOKEN` is also refused as a read token.
- compute_quota includes the jumpbox (`Standard_B2s`: module `azure-linux-virtual-machine` v1.6.0 default, not
  overridden by the AKS root).
- Terraform Cloud outputs are read with "read state outputs" only (`current-state-version-outputs`); binding to the run
  uses the workspace `current-run` relationship. `current-state-version` is never fetched.

### 15.2 Effective production configuration (App Service `cloudhub-backend`, rg-cfe-apps-mj; names only)
Loaded: `app-config.yaml` + `app-config.production.yaml` + `APP_CONFIG_*` settings (none touch `provisioning`).
- Infra repo: `INFRA_REPO` unset → `SymphonySensa/scp-infra-as-code`. Tailscale: `TAILSCALE_*` unset → config
  `SymphonyFS/tailscale@main`.
- Auto-merge: no `CLOUDHUB_AUTO_MERGE_*` settings; config false after this change (infra PR has no code path).
- Production submissions: `provisioning.aks.productionSubmissions.enabled` false everywhere.
- Write tokens: `GITHUB_ACTIONS_TOKEN` (infra PR) and `CLOUDHUB_GITHUB_TOKEN` → `GITHUB_TOKEN` (Tailscale PR) are both
  set and are **different** classic PATs; `CLOUDHUB_TFC_TOKEN` set (write-capable, not used by tracking).
- Not set: `CLOUDHUB_AKS_GITHUB_READ_TOKEN`, `CLOUDHUB_AKS_TFC_READ_TOKEN`,
  `CLOUDHUB_APPROVER_GROUP_REF`, `CLOUDHUB_AKS_CLOUD_ARCHITECT_GROUP_REFS`, `CLOUDHUB_AKS_OPERATIONS_GROUP_REFS`.
- Observation: `CLOUDHUB_STRICT_AUTH=false`.
- The deployed app runs committed `main`, i.e. none of the changes in §11–§15.

### 15.3 Evidence gathered (read-only)
- Entra: groups `CloudHubPlatformOwners` (9 members), `cloudhub-login-allow`, `CloudHubAppEng/PS/SRE` exist; no group
  for Cloud Architect or Operations was found; the catalog ingests only `cloudhubplatformowners`
  (`CATALOG_APPROVER_GROUP_FILTER`), so the default Platform Team ref `group:default/platform-approvers` cannot resolve.
- GitHub reader verified against real PR #824 (merged): Quality Gate `passed` (Actions app), `reviewDecision`
  APPROVED, merged-commit mapping found entry + values file, expected project SCP-PRD-AKS — 14 calls, all reads.
- CIDR: `10.248.0.0/16` overlaps none of the 100 ranges declared on scp-infra-as-code main (6bc941b) nor the 112 VNet
  prefixes Resource Graph returns for the current user (3 subscriptions only — not tenant-wide).
- Quota (uksouth, subscription b0799078): `standardBSFamily` 16/350, `cores` 2532/10044; `Standard_B2s` unrestricted.
- Old CloudHub PRs open in scp-infra-as-code: #595, #596, #597 (`feature/create-aks-*`), #568, #569 (`scaffold/aks-*`).
  SymphonySensa/tailscale is archived. Local CloudHub DB: no requests; production DB not inspected.

### 15.4 Proposed test request (not submitted)
`dev`, `uksouth` (uks), `st`, tenant `e2etest01`, profile `free-tier`, flavor small (system Standard_B2s 1–2, user
Standard_B2s 0–2, Regular), Kubernetes `1.36.2`, address space `10.248.0.0/16` → cluster/workspace
`aks-scp-dev-uks-st-e2etest01`, RG `rg-scp-dev-uks-st-e2etest01`, VNet `vnet-scp-dev-uks-st-e2etest01`, node RG
`mc-rg-scp-dev-uks-st-e2etest01-node-rg`, jumpbox `jumpbox-scp-dev-uks-st-e2etest01`, subnets 10.248.0.0/18,
10.248.128.0/18, 10.248.192.0/24, 10.248.255.0/27, TFC project SCP-DEV-AKS. Ticket, cost centre, owner, approvers
and cluster administrators to be supplied by the owners.
