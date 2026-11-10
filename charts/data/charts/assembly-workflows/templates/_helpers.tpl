{{/*
Expand the name of the chart.
*/}}
{{- define "aw.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Naming prefix for every resource this chart creates: <release>-data-assembly,
matching the platform convention (sri-qa-data-ontology-*, sri-qa-detection-*).
All resource names and in-chart service DNS go through this single helper.
*/}}
{{- define "aw.prefix" -}}
{{- .Release.Name }}-data-assembly
{{- end }}

{{/*
Keycloak upstream as host:port for APISIX `nodes:` entries — derived from
aw.keycloakServerUrl (scheme stripped, :80 appended when the URL names no
port) so the route table can never disagree with the URL the services use.
*/}}
{{- define "aw.keycloakUpstream" -}}
{{- $u := include "aw.keycloakServerUrl" . | trimPrefix "http://" | trimPrefix "https://" | trimSuffix "/" -}}
{{- if regexMatch ":[0-9]+$" $u }}{{ $u }}{{ else }}{{ printf "%s:80" $u }}{{ end -}}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "aw.labels" -}}
app.kubernetes.io/part-of: assembly-workflows
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
environment: {{ .Values.global.environment }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Resolve the Secret name — either existingSecret or the one we create.
*/}}
{{- define "aw.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{ .Values.secrets.existingSecret }}
{{- else -}}
{{ .Values.secrets.name }}
{{- end -}}
{{- end }}

{{/*
Resolve an image reference for a component.
Tag precedence: per-service tag > image.tag (chart-wide) > "latest".
Usage: {{ include "aw.image" (dict "registry" .Values.image.registry "repo" .Values.agents.image.repository "default" "agents" "tag" .Values.agents.image.tag "globalTag" .Values.image.tag) }}
*/}}
{{- define "aw.image" -}}
{{- $repo := .repo | default (printf "%s/%s" .registry .default) -}}
{{- if not (contains "/" $repo) -}}
{{- $repo = printf "%s/%s" .registry $repo -}}
{{- end -}}
{{ $repo }}:{{ .tag | default .globalTag | default "latest" }}
{{- end }}

{{/*
Resolve a THIRD-PARTY (bundled infra) image ref, optionally rewriting its
registry host to global.imageRegistry -- a private mirror ACR for air-gapped /
SCP clusters that cannot pull docker.io/quay.io directly. When
global.imageRegistry is empty the ref is returned BYTE-FOR-BYTE unchanged (the
default; guarded by test). The registry host is the first "/"-segment iff the
ref contains a "/" AND that segment looks like a host (has "." or ":" or is
"localhost") -- docker's own rule; short hub refs (postgres:16-alpine,
temporalio/server:x, apache/apisix:x) have no host and get the mirror prepended.
Usage: {{ include "aw.infraImage" (dict "ref" .Values.infra.postgres.image "ctx" $) }}
*/}}
{{- define "aw.infraImage" -}}
{{- $ref := .ref -}}
{{- $mirror := .ctx.Values.global.imageRegistry | default "" -}}
{{- if not $mirror -}}
{{- $ref -}}
{{- else -}}
{{- $rest := $ref -}}
{{- if contains "/" $ref -}}
{{- $first := splitList "/" $ref | first -}}
{{- if or (contains "." $first) (contains ":" $first) (eq $first "localhost") -}}
{{- $rest = trimPrefix (printf "%s/" $first) $ref -}}
{{- end -}}
{{- end -}}
{{- printf "%s/%s" $mirror $rest -}}
{{- end -}}
{{- end }}

{{/*
Worker Versioning (Build IDs) — playbook 39. SINGLE source of truth so that
EVERY main-queue workflow runner (agents web, agentsWorker, agentsSubflowWorker)
advertises the SAME build id and the SAME enable flag. Skew is a foot-gun: each
runner registers its build as the queue default (BuildIdOpAddNewDefault), so
mismatched ids mean the last writer wins and the other deployments' pollers
become INCOMPATIBLE with new workflows → mixed/unversioned behavior. Build id
defaults to the release image tag (unique per build); override only to pin.
*/}}
{{- define "aw.workerVersioning.enabled" -}}
{{- if .Values.workerVersioning.enabled }}true{{ else }}false{{ end }}
{{- end }}

{{- define "aw.workerVersioning.buildId" -}}
{{- .Values.workerVersioning.buildId | default .Values.image.tag -}}
{{- end }}

{{/*
imagePullSecrets list — merges created + referenced, deduplicating by name.
*/}}
{{- define "aw.imagePullSecrets" -}}
{{- $names := dict }}
{{- if .Values.image.createPullSecret.enabled }}
{{- $_ := set $names .Values.image.createPullSecret.name true }}
{{- end }}
{{- range .Values.image.pullSecrets }}
{{- $_ := set $names .name true }}
{{- end }}
{{- if $names }}
imagePullSecrets:
{{- range $name, $_ := $names }}
  - name: {{ $name }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Optional no-surge rolling update strategy for capacity-constrained clusters.
*/}}
{{- define "aw.noSurgeStrategy" -}}
{{- if .Values.rollout.noSurge }}
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 0
    maxUnavailable: 1
{{- end }}
{{- end }}

{{/*
Common scheduling: nodeSelector + tolerations + priorityClassName (app-tier pods).
#1600: app-tier pods previously got no priorityClassName at all, unlike infra-tier's
aw.infraScheduling (#1282/#1597) -- on a shared perf cluster where a foreign workload with no
priority also lands on the app node pool, kubelet's node-pressure eviction had no signal to prefer
evicting that foreign workload over assembly-workflows' own app-tier pods. Same gate
(scheduling.priorityClasses.enabled), same no-op-by-default behavior for non-perf installs.
*/}}
{{- define "aw.scheduling" -}}
{{- include "aw.priorityClassName" . }}
{{- with .Values.scheduling.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.scheduling.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
priorityClassName for infra-tier pods (postgres/postgres-temporal/redis/temporal/keycloak) — gated
by scheduling.priorityClasses.enabled (see priorityclass.yaml). Off by default (existing chart
behavior unchanged); the perf overlays turn it on so kubelet's node-pressure eviction ranks these
pods above default-priority (0) workloads sharing the infra node under memory pressure, instead of
evicting them first purely because they happen to exceed their own (deliberately lean) requests.
Real incident this fixes: #1282 — an unrelated foreign workload with no priorityClassName squatted
on assembly-perf-small's shared infra node; kubelet evicted the legitimate `temporal` pod instead of
the foreign one because eviction ranking only looked at requests-exceeded + usage, never priority
(the platform-services PriorityClass existed in the chart since its introduction but was never
actually attached to any pod spec — a no-op even when enabled).
*/}}
{{- define "aw.priorityClassName" -}}
{{- if .Values.scheduling.priorityClasses.enabled }}
priorityClassName: {{ include "aw.prefix" . }}-platform-services
{{- end }}
{{- end }}

{{/*
#1606: soft mutual anti-affinity for the singleton infra-tier pods (postgres, postgres-temporal,
redis, keycloak, minio) so they spread across the infra node pool instead of accidentally clumping
onto whichever node happened to exist when each was first scheduled. Real incident: assembly-perf-
medium's 2nd infra node (added by PR #1594) sat at 19% memory while ALL FIVE of these already-
running singleton pods (plus a foreign workload, #1600) stayed on the original node at 96%+ —
kubelet evicted postgres-temporal (the durable Temporal DB) twice under routine, non-extreme load.
Root cause: Kubernetes never proactively reschedules an already-Running pod just because a new node
joined the pool — nodeSelector alone (aw.infraScheduling matches EITHER infra node) doesn't force
an existing pod to move. PREFERRED (soft), not REQUIRED: with 5 singleton pods and only 2 infra
nodes on the small/medium tiers, a hard constraint would leave pods permanently Pending once the
first node fills past 2-3 of them.
*/}}
{{- define "aw.infraSingletonSpreadLabel" -}}
{{- if .Values.scheduling.infraSingletonSpread.enabled }}
infra-singleton: "true"
{{- end }}
{{- end }}

{{- define "aw.infraSingletonAntiAffinity" -}}
{{- if .Values.scheduling.infraSingletonSpread.enabled }}
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              infra-singleton: "true"
          topologyKey: kubernetes.io/hostname
{{- end }}
{{- end }}

{{/*
Infra scheduling: uses infra.nodeSelector/tolerations if set, else falls back to aw.scheduling.
*/}}
{{- define "aw.infraScheduling" -}}
{{- include "aw.priorityClassName" . }}
{{- if or .Values.infra.nodeSelector .Values.infra.tolerations }}
{{- with .Values.infra.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.infra.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- else }}
{{- include "aw.scheduling" . }}
{{- end }}
{{- end }}

{{/*
sandbox-execute scheduling: if sandboxExecute.nodeSelector/tolerations are set, use those
(with the app-tier priorityClassName); otherwise fall back to aw.scheduling.

This lets the privileged code-execution pods be pinned to a DEDICATED, tainted nodepool that
runs nothing else. The privileged sandbox pod can see the node's real block devices (all 41
caps + host /dev), so on a SHARED multi-tenant node a container/kernel escape reaches other
tenants' data on that node. Pinning sandbox-execute to its own nodepool (nodeSelector) plus a
matching toleration for that pool's taint means only sandbox pods land there, so an escape
reaches only other stateless code-execution pods — not colocated tenant data. It is a
blast-radius compensating control, NOT a substitute for removing privileged (see the rootless
execution work). Empty by default (falls back to aw.scheduling) — no behaviour change.
*/}}
{{- define "aw.sandboxExecuteScheduling" -}}
{{- if or .Values.sandboxExecute.nodeSelector .Values.sandboxExecute.tolerations }}
{{- include "aw.priorityClassName" . }}
{{- with .Values.sandboxExecute.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.sandboxExecute.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- else }}
{{- include "aw.scheduling" . }}
{{- end }}
{{- end }}

{{/*
PG-Temporal scheduling: if infra.postgresTemporal.nodeSelector is set, use that
(with its own tolerations); otherwise fall back to aw.infraScheduling.
This allows the Temporal PG pod to be pinned to a dedicated I/O-optimised node
while all other infra pods stay on the shared infra nodepool.
*/}}
{{- define "aw.pgTemporalScheduling" -}}
{{- if .Values.infra.postgresTemporal.nodeSelector }}
{{- include "aw.priorityClassName" . }}
nodeSelector:
  {{- toYaml .Values.infra.postgresTemporal.nodeSelector | nindent 2 }}
{{- with .Values.infra.postgresTemporal.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- else }}
{{- include "aw.infraScheduling" . }}
{{- end }}
{{- end }}

{{/*
The name of the Secret carrying the bundled Postgres credentials.

`postgres-secret` is an unqualified name in a shared namespace, and the SRI
platform's own platform-services chart creates a Secret by exactly that name for
its consumers — with POSTGRES_USER/POSTGRES_PASSWORD keys, not the username/
password ones this chart reads. In single-namespace mode both land in one release
and one namespace, the platform's wins, and every Assembly component that reads a
credential from it dies with

  Error: couldn't find key username in Secret <ns>/postgres-secret

which is a container that never starts rather than a helm failure, so the install
reports success. Overriding infra.postgres.secretName gives Assembly its own
name; the default keeps upstream behaviour byte-for-byte.
*/}}
{{/*
WHERE the components should look for Postgres, as host and database rather than
as a URL — psql-based init containers take PGHOST/PGDATABASE, not a DSN.

These MUST agree with aw.postgresUrl, so they are derived from the same value it
returns rather than restated. Two init containers used to hardcode `postgres`
and infra.postgres.databaseName; with the bundled server disabled that is a
Service which does not exist and a database which was never created, so
`wait-migrate` waited for a table in the wrong place FOR EVER — while the
migration it was waiting for had already succeeded against the shared server.
An empty external URL falls back to the bundled names, which is what a chart
installed the upstream way should see.
*/}}
{{- define "aw.pgHost" -}}
{{- if or (not .Values.infra.enabled) .Values.infra.postgres.enabled -}}
{{ include "aw.prefix" . }}-postgres
{{- else -}}
{{- $url := .Values.externalInfra.postgres.url | default "" -}}
{{- if $url -}}
{{- first (splitList ":" (first (splitList "/" (last (splitList "@" $url))))) -}}
{{- else -}}
{{ include "aw.prefix" . }}-postgres
{{- end -}}
{{- end -}}
{{- end }}

{{- define "aw.pgDatabase" -}}
{{- if or (not .Values.infra.enabled) .Values.infra.postgres.enabled -}}
{{ .Values.infra.postgres.databaseName }}
{{- else -}}
{{- $url := .Values.externalInfra.postgres.url | default "" -}}
{{- if $url -}}
{{- first (splitList "?" (last (splitList "/" $url))) -}}
{{- else -}}
{{ .Values.infra.postgres.databaseName }}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "aw.postgresSecretName" -}}
{{ .Values.infra.postgres.secretName | default "postgres-secret" }}
{{- end }}

{{/*
Infra URL resolvers — when the bundled component is enabled, use same-namespace
DNS; otherwise use externalInfra values. Keyed on the PER-COMPONENT flag
(infra.<svc>.enabled) so an environment can share the platform's Postgres,
Keycloak and Redis while keeping Temporal bundled here.
*/}}
{{- define "aw.postgresUrl" -}}
{{- if and .Values.infra.enabled .Values.infra.postgres.enabled -}}
{{- /* Derived from the explicit infra.postgres.password (which postgres-secret
       `required`s when infra.enabled). No lookup — helm template == helm upgrade. */ -}}
postgresql+asyncpg://assembly:{{ .Values.infra.postgres.password }}@{{ include "aw.prefix" . }}-postgres:5432/{{ .Values.infra.postgres.databaseName }}
{{- else -}}
{{ .Values.externalInfra.postgres.url }}
{{- end -}}
{{- end }}

{{- define "aw.redisUrl" -}}
{{- if and .Values.infra.enabled .Values.infra.redis.enabled -}}
redis://{{ include "aw.prefix" . }}-redis:6379/0
{{- else -}}
{{- /* Fall back to the in-cluster redis when no external URL is set: an EMPTY
       REDIS_URL silently breaks redis-backed rate-limiting (consumers do
       getenv("REDIS_URL","redis://redis:6379") — empty ≠ unset, so the code
       default never applies → limiter fails open). See playbook 36 §9. */ -}}
{{ .Values.externalInfra.redis.url | default (printf "redis://%s-redis:6379/0" (include "aw.prefix" .)) }}
{{- end -}}
{{- end }}

{{- define "aw.keycloakServerUrl" -}}
{{- if and .Values.infra.enabled .Values.infra.keycloak.enabled -}}
http://{{ include "aw.prefix" . }}-keycloak:8091
{{- else -}}
{{ .Values.externalInfra.keycloak.serverUrl }}
{{- end -}}
{{- end }}

{{- define "aw.temporalHost" -}}
{{- if and .Values.infra.enabled .Values.infra.temporal.enabled -}}
{{ include "aw.prefix" . }}-temporal:7233
{{- else -}}
{{ .Values.externalInfra.temporal.host }}
{{- end -}}
{{- end }}

{{/*
Expected Keycloak issuer for a PUBLIC deployment. A login token obtained via the public host
carries iss=https://<publicHostname>/realms/<realm>, but services default to validating the
internal issuer (KEYCLOAK_SERVER_URL). When publicHostname is set, services must expect the
public issuer. Empty (no env emitted) for non-public deploys. The deploy-time webhook smoke
sends X-Forwarded-Host:<publicHostname> so its in-cluster token also carries this issuer.
*/}}
{{- define "aw.keycloakExpectedIssuer" -}}
{{- /* An EXTERNAL Keycloak that pins its hostname issues iss=https://<its-own-host>/realms/<realm>
       no matter which host the login came through, so the publicHostname computation below is
       wrong for it (verified live: services rejected real tokens until the deployment env was
       overridden by hand). externalInfra.keycloak.expectedIssuer overrides when set. */ -}}
{{- if .Values.externalInfra.keycloak.expectedIssuer -}}
{{ .Values.externalInfra.keycloak.expectedIssuer }}
{{- else -}}
{{- with .Values.apisix.tls.publicHostname -}}
https://{{ . }}/realms/{{ $.Values.externalInfra.keycloak.realm | default "assembly-platform" }}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
aw.keycloak.* -- desired-state shapes for the Keycloak realm objects this chart
manages. Single source of truth consumed by BOTH the realm seed JSON
(templates/infra.yaml, applied by --import-realm on FRESH installs only) and
the keycloak-flows-integration reconcile Job (EXISTING realms, where
--import-realm is a no-op). Rendering both paths from the same helpers is what
keeps them incapable of drifting apart. toJson does all escaping, so
user-supplied values (clientId, webOrigins, hostname) can never produce
invalid JSON.
*/}}

{{/* The seeded clients' redirectUris, as a JSON array. */}}
{{- define "aw.keycloak.seedRedirectUris" -}}
{{- $uris := list "http://localhost/*" "http://localhost:9080/*" "https://*.app.github.dev/*" -}}
{{- with .Values.apisix.tls.publicHostname -}}
{{- $uris = append $uris (printf "https://%s/*" .) -}}
{{- end -}}
{{- toJson $uris -}}
{{- end }}

{{/* The seeded clients' webOrigins, as a JSON array. */}}
{{- define "aw.keycloak.seedWebOrigins" -}}
{{- $origins := list "http://localhost" "http://localhost:9080" "https://*.app.github.dev" -}}
{{- with .Values.apisix.tls.publicHostname -}}
{{- $origins = append $origins (printf "https://%s" .) -}}
{{- end -}}
{{- toJson $origins -}}
{{- end }}

{{/* Keycloak stores post-logout redirect URIs as ONE comma-joined attribute string. */}}
{{- define "aw.keycloak.seedPostLogoutRedirectUris" -}}
{{- $uris := list "http://localhost/*" "http://localhost:9080/*" "https://*.app.github.dev/*" -}}
{{- with .Values.apisix.tls.publicHostname -}}
{{- $uris = append $uris (printf "https://%s/*" .) -}}
{{- end -}}
{{- /* Keycloak's OIDCAdvancedConfigWrapper splits post.logout.redirect.uris on "##",
       never ",". A comma-joined value is one opaque URI that matches nothing, so every
       logout is rejected with "Invalid redirect uri" (confirmed live on dev-assembly,
       fc18fb15). Both the realm seed (infra.yaml) and the reconcile Job
       (frontendClientPatchJson) consume this helper, so the "##" join keeps them consistent. */ -}}
{{- join "##" $uris -}}
{{- end }}

{{/*
JSON merge body the reconcile Job PUTs onto assembly-platform-frontend to heal
the production-verified drift (redirect/webOrigins/post-logout missing the
public hostname on realms imported before TLS was enabled). attributes must be
sent complete -- a PUT replaces the map -- so PKCE is re-asserted here too.
*/}}
{{- define "aw.keycloak.frontendClientPatchJson" -}}
{"redirectUris": {{ include "aw.keycloak.seedRedirectUris" . }}, "webOrigins": {{ include "aw.keycloak.seedWebOrigins" . }}, "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": {{ include "aw.keycloak.seedPostLogoutRedirectUris" . | toJson }}}}
{{- end }}

{{/*
The InvHub flows-integration client (infra.keycloak.flowsIntegration): public
ROPC-only -- directAccessGrants on, standard flow OFF with no redirect URIs
(tighter than a kcadm-created client's defaults; the Job converges live
realms to this shape). webOrigins lets Keycloak itself CORS-allow the
browser-direct get-token POST.
*/}}
{{- define "aw.keycloak.flowsClientJson" -}}
{{- $fi := .Values.infra.keycloak.flowsIntegration -}}
{{- dict
      "clientId" $fi.clientId
      "name" "InvHub Flows Integration"
      "enabled" true
      "protocol" "openid-connect"
      "publicClient" true
      "directAccessGrantsEnabled" true
      "standardFlowEnabled" false
      "serviceAccountsEnabled" false
      "redirectUris" (list)
      "webOrigins" ($fi.webOrigins | default list)
      "fullScopeAllowed" true
  | toJson -}}
{{- end }}

{{/*
The InvHub flows-integration service user. Called with
(dict "ctx" $ "withPassword" <bool>): the realm-IMPORT variant carries
realmRoles + credentials inline (honored only by the import path); the Job
variant omits both because the admin REST POST /users silently IGNORES
realmRoles and credentials -- the Job assigns the role and sets the password
explicitly instead. The email fields matter: the realm is email-as-username
and WEBHOOK_RUN_ALLOWLIST matches the token's email claim.
*/}}
{{- define "aw.keycloak.flowsUserJson" -}}
{{- $ctx := .ctx -}}
{{- $fi := $ctx.Values.infra.keycloak.flowsIntegration -}}
{{- $user := dict
      "username" $fi.serviceUser
      "email" $fi.serviceUser
      "emailVerified" true
      "enabled" true
      "firstName" "InvHub"
      "lastName" "Service" -}}
{{- if .withPassword -}}
{{- $_ := set $user "realmRoles" (list "user") -}}
{{- $_ := set $user "credentials" (list (dict "type" "password" "value" ($ctx.Values.secrets.invhubServiceUserPassword | default "") "temporary" false)) -}}
{{- end -}}
{{- $user | toJson -}}
{{- end }}

{{- define "aw.temporalAgentBuilderHost" -}}
{{- if and .Values.infra.enabled .Values.infra.temporal.enabled -}}
{{ include "aw.prefix" . }}-temporal:7233
{{- else -}}
{{ .Values.externalInfra.temporal.agentBuilderHost | default .Values.externalInfra.temporal.host }}
{{- end -}}
{{- end }}

{{/*
aw.urlValidationAllowHosts -- the effective SSRF allowlist: the committed
baseline (urlValidation.allowHosts) plus operator-supplied extras
(urlValidation.extraAllowHosts, typically a `ref+op://` reference resolved by
`vals` at deploy time). Comma-joined; empty parts dropped, so either may be unset.

Two sources on purpose: the baseline stays visible in the overlay and reviewable
in a diff -- this is a security boundary -- while a domain that must not live in
this repo (a customer's internal zone on an SCP install) or that changes without a
release can come from 1Password.
*/}}
{{- define "aw.urlValidationAllowHosts" -}}
{{- $parts := list -}}
{{- with .Values.urlValidation.allowHosts -}}{{- $parts = append $parts (trim .) -}}{{- end -}}
{{- with .Values.urlValidation.extraAllowHosts -}}{{- $parts = append $parts (trim .) -}}{{- end -}}
{{- join "," $parts -}}
{{- end }}

{{/*
SSRF-guard allowlist env for outbound URL validation (assembly_shared.url_validation).
Its own define because EVERY service that calls the shared validator needs it, not
just the engine + workers: mcp-hub (remote MCP registration, OpenAPI spec fetch by
URL) and llm-gateway (gateway base URL) include it directly.

Entries are exact hostnames or `*.suffix` wildcards -- see values.yaml. Both
sources empty: env omitted entirely, fail-closed.
*/}}
{{- define "aw.urlValidationEnv" -}}
{{- with (include "aw.urlValidationAllowHosts" .) }}
- name: ASSEMBLY_URL_VALIDATION_ALLOW_HOSTS
  value: {{ . | quote }}
{{- end }}
{{- end }}

{{/*
Common agent env vars shared by agents-api, assembly-engine-worker, assembly-engine-code-worker, assembly-engine-subflow-worker.
*/}}
{{- define "aw.agentEnv" -}}
- name: ASSEMBLY_EDITION
  valueFrom:
    configMapKeyRef:
      name: {{ include "aw.prefix" . }}-platform-config
      key: assembly-edition
- name: DISABLED_WORKFLOW_NODE_TYPES
  valueFrom:
    configMapKeyRef:
      name: {{ include "aw.prefix" . }}-platform-config
      key: disabled-workflow-node-types
- name: LLM_GATEWAY_URL
  value: "http://{{ include "aw.prefix" . }}-llm-gateway:8006"
# The assembly-mcp-hub Service is exposed on port 8011 (targetPort 8000) — see
# assembly-mcp-hub.yaml and the APISIX upstreams, which all dial :8011. The
# engine's MCP consumers (in-product Agent Studio agent via AGENT_STUDIO_MCP_URL;
# standalone-runner / agent_tools via ASSEMBLY_MCP_HUB_URL) default to :8000 in
# code — correct for the docker-compose export path where the hub listens on
# :8000 directly, but WRONG against this Service. Without these overrides the
# in-cluster fetch ConnectTimeouts and Agent Studio tool discovery + token
# counting silently fail. Pin them to the Service port here.
- name: ASSEMBLY_MCP_HUB_URL
  value: "http://{{ include "aw.prefix" . }}-mcp-hub:8011"
- name: AGENT_STUDIO_MCP_URL
  value: "http://{{ include "aw.prefix" . }}-mcp-hub:8011/mcp/assembly-agent-studio"
- name: INTERNAL_SERVICE_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: internal-service-api-key
- name: FERNET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: fernet-key
- name: LLM_GATEWAY_USER_KEYS_INTERNAL_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: assembly-llm-gateway-user-keys-internal-api-key
# Per-service internal key for service "agents": the gateway prioritizes the per-service
# _AGENTS var for X-Service-Name: agents (config.py), so the agent workers MUST send the same
# key or every engine->gateway user-key call 401s -> resolve_user_gateway_key returns None ->
# agent LLM calls fail with "API key required, llm-gw- prefix". Without this, agent nodes do not
# work out-of-the-box (latent: non-agent workloads never hit the gateway).
- name: LLM_GATEWAY_USER_KEYS_INTERNAL_API_KEY_AGENTS
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: assembly-llm-gateway-user-keys-internal-api-key-agents
- name: SANDBOX_INTERNAL_SERVICE_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: sandbox-internal-service-api-key
# Sandbox workflow-MANAGEMENT API (deploy / deployments list / overview, etc).
# In the split sandbox topology those routes are served only by the trigger
# pod (SANDBOX_APP_MODE=trigger-only); the execute pods (execute-only) 404
# them. The engine default is "http://assembly-sandbox:8003" — a service that
# does not exist in this chart — so management calls (e.g. the deployments
# /overview endpoint, #572) fail with 503. Point them at the trigger service.
- name: ASSEMBLY_SANDBOX_URL
  value: {{ .Values.agents.sandboxManagementUrl | default (printf "http://%s-sandbox-trigger:8003" (include "aw.prefix" .)) | quote }}
# Sandbox code-EXECUTION API (/api/sandbox/api/v1/execute-code), served only by
# the execute pods. core/execution/sandbox.py reads this first and falls back to
# ASSEMBLY_SANDBOX_URL — which points at the trigger pod above, where the route
# 404s and the engine then tries the in-process Docker interpreter and fails with
# "Docker is required for secure code execution".
#
# This MUST be on every engine deployment, not just the code-worker: the agent
# node's `run_code` BUILT-IN TOOL executes inside the agent activity on the
# general worker, so wiring only the code-worker (which handles custom_code /
# code_interpreter *nodes*) left the agent-node code interpreter dead on every
# cluster.
- name: SANDBOX_EXECUTE_CODE_URL
  value: {{ .Values.agents.sandboxExecuteCodeUrl | default (printf "http://%s-sandbox-execute:8003" (include "aw.prefix" .)) | quote }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: database-url
- name: REDIS_URL
  valueFrom:
    configMapKeyRef:
      name: {{ include "aw.prefix" . }}-platform-config
      key: redis-url
- name: AUTH_MODE
  valueFrom:
    configMapKeyRef:
      name: {{ include "aw.prefix" . }}-platform-config
      key: auth-mode
- name: KEYCLOAK_SERVER_URL
  value: {{ include "aw.keycloakServerUrl" . | quote }}
{{- with (include "aw.keycloakExpectedIssuer" .) }}
- name: KEYCLOAK_EXPECTED_ISSUER
  value: {{ . | quote }}
{{- end }}
- name: TEMPORAL_HOST
  value: {{ include "aw.temporalHost" . | quote }}
- name: TEMPORAL_NAMESPACE
  value: {{ .Values.externalInfra.temporal.namespace | quote }}
- name: TEMPORAL_AGENT_BUILDER_NAMESPACE
  value: {{ .Values.externalInfra.temporal.agentBuilderNamespace | quote }}
- name: TEMPORAL_AGENT_BUILDER_HOST
  value: {{ include "aw.temporalAgentBuilderHost" . | quote }}
- name: ENABLE_TEMPORAL_WORKFLOWS
  value: "true"
- name: TEMPORAL_AGENT_BUILDER_TASK_QUEUE
  value: "agent-builder-tasks"
- name: ASSEMBLY_WORKFLOW_STREAM_TIMEOUT_SECONDS
  value: {{ .Values.workflowStreamTimeoutSeconds | quote }}
- name: ENVIRONMENT
  valueFrom:
    configMapKeyRef:
      name: {{ include "aw.prefix" . }}-platform-config
      key: environment
- name: WORKFLOW_RESOURCE_LIMITS_ENABLED
  value: {{ .Values.workflowResourceLimits.enabled | quote }}
- name: ASSEMBLY_AGENT_NODE_WORKFLOW_ENABLED
  value: {{ .Values.agentNodeWorkflow.enabled | quote }}
- name: TEMPORAL_PAYLOAD_COMPRESSION_ENABLED
  value: "true"
- name: TEMPORAL_PAYLOAD_COMPRESSION_THRESHOLD_BYTES
  value: "2048"
- name: TEMPORAL_PAYLOAD_COMPRESSION_LEVEL
  value: "1"
- name: TRACES_MAX_AGE_HOURS
  value: {{ .Values.traces.maxAgeHours | quote }}
- name: TRACES_MAX_COUNT
  value: {{ .Values.traces.maxCount | quote }}
# Hard cap on downloaded files-resource bytes when a workflow node resolves
# a resource's `content` field (resource_resolver.py). assembly-core's
# /download-url mints a signed URL without ever loading the bytes itself,
# so this worker-side check is the only cap on this path.
- name: RESOURCE_FILE_CONTENT_MAX_BYTES
  value: {{ .Values.resourceFileContentMaxBytes | quote }}
{{- include "aw.urlValidationEnv" . }}
{{- if .Values.secrets.tavilyApiKey }}
# API key for the agent-node built-in web_search tool (provider: tavily).
# Only injected when set; agent_tools.execute_web_search reads TAVILY_API_KEY.
- name: TAVILY_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "aw.secretName" . }}
      key: tavily-api-key
{{- end }}
{{- end }}

{{/*
Poller cap env vars for agent workers (prevents excessive matching contention).
*/}}
{{- define "aw.workerPollerEnv" -}}
- name: TEMPORAL_WORKFLOW_TASK_POLLER_MAX
  value: "20"
- name: TEMPORAL_ACTIVITY_TASK_POLLER_MAX
  value: "20"
{{- end }}

{{/*
Wait until the agent-builder Temporal frontend is reachable before starting
dedicated worker pods. Fresh installs can otherwise race Temporal frontend
startup and come up healthy without any active workers.
*/}}
{{- define "aw.waitForAgentBuilderTemporalInitContainer" -}}
initContainers:
  - name: wait-for-temporal
    image: {{ include "aw.infraImage" (dict "ref" .Values.infra.temporal.adminToolsImage "ctx" .) }}
    command:
      - /bin/sh
      - -c
      - |
        echo "Waiting for Temporal frontend at {{ include "aw.temporalAgentBuilderHost" . }}..."
        until temporal operator cluster health --address {{ include "aw.temporalAgentBuilderHost" . }} >/dev/null 2>&1; do
          sleep 5
        done
        echo "Temporal frontend reachable"
    resources:
      requests: { memory: 64Mi, cpu: 10m }
      limits: { memory: 128Mi, cpu: 200m }
{{- end }}

{{/*
aw.validate.noPlaceholders — recursively walk a values subtree and fail the
render on any string still carrying the sanitized "REDACTED_" placeholder
prefix. The committed values-dev/values-demo files ship placeholders by
design; deploying them verbatim would (a) crash services at runtime (e.g.
the 19-char fernet placeholder fails Fernet's 32-byte base64 contract on
first encrypt) and (b) on upgrade, OVERWRITE the cluster's real
platform-secrets with placeholders. Failing at render is the only safe
default. Escape hatch for render-only workflows: --set validation.allowPlaceholders=true.
Called with (list "<path>" <value>).
*/}}
{{- define "aw.validate.noPlaceholders" -}}
{{- $path := index . 0 -}}
{{- $val := index . 1 -}}
{{- if kindIs "map" $val -}}
{{- range $k, $v := $val }}{{ include "aw.validate.noPlaceholders" (list (printf "%s.%s" $path $k) $v) }}{{- end -}}
{{- else if kindIs "slice" $val -}}
{{- range $i, $v := $val }}{{ include "aw.validate.noPlaceholders" (list (printf "%s[%d]" $path $i) $v) }}{{- end -}}
{{- else if kindIs "string" $val -}}
{{- if hasPrefix "REDACTED_" $val -}}
{{- fail (printf "values validation: %s is the sanitized placeholder %q — supply the real value (values file out of band, or --set). Render-only escape hatch: --set validation.allowPlaceholders=true" $path $val) -}}
{{- end -}}
{{- if hasPrefix "ref+op://" $val -}}
{{- fail (printf "values validation: %s is an UNRESOLVED 1Password reference (%q) — it must be resolved with `vals eval` before helm sees it (deploy.yml does this). A plain `helm install -f <overlay>` skips vals and would deploy the literal ref. Render-only escape hatch: --set validation.allowPlaceholders=true" $path $val) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
aw.validate.secrets — structural checks on chart-managed secrets. Only runs
when the chart renders its own Secret (secrets.existingSecret unset); an
existing secret is the operator's contract. Skipped entirely by
validation.allowPlaceholders for render-only use.
*/}}
{{- define "aw.validate.secrets" -}}
{{- if not .Values.secrets.existingSecret -}}
{{- if not .Values.secrets.jwtSecret -}}
{{- fail "values validation: secrets.jwtSecret is empty. Every service validates JWTs against it; source it (1Password / bootstrap.sh) or set secrets.existingSecret." -}}
{{- end -}}
{{- if not .Values.secrets.fernetKey -}}
{{- fail "values validation: secrets.fernetKey is empty. Generate one: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" (or set secrets.existingSecret)." -}}
{{- end -}}
{{- if and .Values.secrets.fernetKey (not (regexMatch "^[A-Za-z0-9_+/=-]{44}$" .Values.secrets.fernetKey)) -}}
{{- fail (printf "values validation: secrets.fernetKey must be a 44-char urlsafe-base64 Fernet key (32 bytes), got %d chars. Generate one: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"" (len .Values.secrets.fernetKey)) -}}
{{- end -}}
{{- /* Internal shared keys were previously self-generated by the chart; they are
       now sourced explicitly (1Password for persistent clusters, bootstrap.sh for
       throwaway perf). Fail closed so a deploy that forgets one cannot ship an
       empty key → execute-launch 401 with 0 executions (the old silent-killer). */ -}}
{{- range $path, $val := dict
      "secrets.internalServiceApiKey" .Values.secrets.internalServiceApiKey
      "secrets.sandboxInternalServiceApiKey" .Values.secrets.sandboxInternalServiceApiKey
      "secrets.workspaceManagerInternalServiceApiKey" .Values.secrets.workspaceManagerInternalServiceApiKey
      "secrets.llmGateway.userKeysInternalApiKey" .Values.secrets.llmGateway.userKeysInternalApiKey
      "secrets.llmGateway.adminKey" .Values.secrets.llmGateway.adminKey -}}
{{- if not $val -}}
{{- fail (printf "values validation: %s is empty — it must be supplied explicitly (1Password / bootstrap.sh); an empty internal key makes execute-launch 401 with 0 executions." $path) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
aw.validate.adminPasswords — reject the world-known default admin passwords when
this chart deploys Keycloak (infra.enabled seeds the realm + admin identities).
The bootstrap user admin@assembly.dev is a realm-admin loginable via the PUBLIC
auth flow, and the Keycloak console admin gates the whole realm — a deploy that
leaves either at its repo default is trivially compromised. Same fail-closed
posture as jwtSecret/fernetKey (#259/#1345/#1396); the caller in validate.yaml
already skips all checks under validation.allowPlaceholders for render-only use.
*/}}
{{- define "aw.validate.adminPasswords" -}}
{{- if .Values.infra.enabled -}}
{{- $boot := .Values.secrets.bootstrapAdminPassword | default "" -}}
{{- if or (not $boot) (eq $boot "assembly-admin-rotateme") -}}
{{- fail "values validation: secrets.bootstrapAdminPassword is empty or the known repo default 'assembly-admin-rotateme'. The seeded bootstrap user admin@assembly.dev is a realm-admin loginable via the public auth flow — set a strong, unique value (or secrets.existingSecret)." -}}
{{- end -}}
{{- $kc := .Values.infra.keycloak.adminPassword | default "" -}}
{{- if or (not $kc) (eq $kc "changeme") -}}
{{- fail "values validation: infra.keycloak.adminPassword is empty or the known repo default 'changeme'. This gates the entire Keycloak realm — set a strong, unique value." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
aw.validate.codeExecution — the code-worker's execution backend must exist.
agentsCodeWorker.codeExecutionTarget=sandbox-service delegates /execute-code to
the assembly-sandbox-execute Deployment; if that service is disabled there is no
backend and execution falls through to a Docker-requiring path that fails at
RUNTIME ("Docker is required for secure code execution") rather than at render.
Caught live on the SCP dev cluster, where the overlay pins sandbox-service while
sandboxExecute was disabled to avoid the privileged pod.
*/}}
{{/*
aw.webhookRunAllowlist — subjects allowed to invoke a deployment they do NOT own
(sandbox authenticates them, then relays an owner-delegated identity).

The flows service user is DERIVED from infra.keycloak.flowsIntegration.serviceUser
rather than restated here. The two were previously separate values that had to match
exactly: the realm seeds one identity, this allowlist names another, and a drift
between them fails at RUNTIME as a 403 on every cross-owner run — the caller
authenticates fine, so nothing points at the mismatch. Deriving it removes that
failure mode, and makes a `ref+op://` on serviceUser reach both consumers at once.

sandboxTrigger.webhookRunAllowlist stays for ADDITIONAL subjects and is unioned in.
Empty result => the env is omitted entirely and the guard stays fail-closed.
*/}}
{{- define "aw.webhookRunAllowlist" -}}
{{- $subjects := list -}}
{{- $fi := .Values.infra.keycloak.flowsIntegration -}}
{{- if and $fi.enabled $fi.serviceUser -}}
{{- $subjects = append $subjects (trim $fi.serviceUser) -}}
{{- end -}}
{{- range (splitList "," (.Values.sandboxTrigger.webhookRunAllowlist | default "")) -}}
{{- with trim . -}}{{- $subjects = append $subjects . -}}{{- end -}}
{{- end -}}
{{- join "," (uniq $subjects) -}}
{{- end }}

{{- define "aw.validate.codeExecution" -}}
{{- if and (eq .Values.agentsCodeWorker.codeExecutionTarget "sandbox-service") (not .Values.sandboxExecute.enabled) -}}
{{- fail "values validation: agentsCodeWorker.codeExecutionTarget=sandbox-service requires sandboxExecute.enabled=true — the code-worker delegates /execute-code to assembly-sandbox-execute, and with that service absent code execution fails at RUNTIME with 'Docker is required for secure code execution' (custom_code, code_interpreter and the agent run_code tool). Either enable sandboxExecute or set codeExecutionTarget=local-nsjail." -}}
{{- end -}}
{{- end -}}

{{/*
aw.validate.flowsIntegration — fail-closed checks for the InvHub flows
integration (infra.keycloak.flowsIntegration). The realm seed and the
keycloak-flows-integration Job only manage the in-chart Keycloak, and the
service-user password is a shared contract with InvHub's `flows` Secret that
must never be silently empty (an empty kcadm set-password would lock InvHub
out). Skipped by validation.allowPlaceholders like every other check.
*/}}
{{- define "aw.validate.flowsIntegration" -}}
{{- if .Values.infra.keycloak.flowsIntegration.enabled -}}
{{- if not .Values.infra.enabled -}}
{{- fail "values validation: infra.keycloak.flowsIntegration.enabled=true requires infra.enabled=true — the realm seed and the keycloak-flows-integration Job only manage the in-chart Keycloak." -}}
{{- end -}}
{{- if not .Values.secrets.invhubServiceUserPassword -}}
{{- fail "values validation: secrets.invhubServiceUserPassword is empty. flowsIntegration provisions the InvHub ROPC service user; set it to the exact password in InvHub's `flows` Secret (a shared contract, never generated here)." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
APISIX TLS mode predicates. apisix.tls.mode selects HOW HTTPS is terminated
when apisix.tls.enabled:
  apisix  — APISIX terminates on :443 from the mounted existingSecret.
  ingress — an ingress-nginx Ingress terminates; APISIX stays plain HTTP.
Each helper emits "true" or "" so it reads cleanly as `{{- if (include ...) }}`.
Default mode is "apisix" (the historical behaviour) when unset.
*/}}
{{- define "aw.apisixTerminatesTls" -}}
{{- if and .Values.apisix.tls.enabled (eq (.Values.apisix.tls.mode | default "apisix") "apisix") -}}true{{- end -}}
{{- end -}}
{{- define "aw.apisixIngressTls" -}}
{{- if and .Values.apisix.tls.enabled (eq (.Values.apisix.tls.mode | default "apisix") "ingress") -}}true{{- end -}}
{{- end -}}

{{/*
aw.validate.tls — fail closed on an incoherent TLS config. mode must be one of
apisix|ingress, and any enabled TLS needs a publicHostname (the Keycloak issuer,
the redirect, and the Ingress host all derive from it). Skipped by
validation.allowPlaceholders like every other check.
*/}}
{{- define "aw.validate.tls" -}}
{{- if .Values.apisix.tls.enabled -}}
{{- $mode := .Values.apisix.tls.mode | default "apisix" -}}
{{- if not (has $mode (list "apisix" "ingress")) -}}
{{- fail (printf "values validation: apisix.tls.mode must be \"apisix\" or \"ingress\", got %q." $mode) -}}
{{- end -}}
{{- if not .Values.apisix.tls.publicHostname -}}
{{- fail "values validation: apisix.tls.enabled=true requires apisix.tls.publicHostname (the external HTTPS host driving the Keycloak issuer, redirect, and Ingress host)." -}}
{{- end -}}
{{- if eq $mode "ingress" -}}
{{- if not .Values.apisix.tls.ingress.className -}}
{{- fail "values validation: apisix.tls.mode=ingress requires apisix.tls.ingress.className (e.g. nginx)." -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
