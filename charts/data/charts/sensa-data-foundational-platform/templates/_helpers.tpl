{{/*
Naming, labels, and the in-cluster endpoints Prism's components dial.

Everything that resolves a hostname goes through a helper here, so a
release-prefixed install still works and so flipping infra.<x>.enabled to false
redirects every consumer at once. The raw manifests in deploy/remote hardcoded
`bolt://neo4j:7687`, `@ledger-postgres:5432` and `-h warehouse-postgres`; those
three strings are now computed in one place each.
*/}}

{{- define "prism.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* fullname = fullnameOverride, else <release>-<namePrefix>. */}}
{{- define "prism.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else -}}
{{- printf "%s-%s" .Release.Name (.Values.namePrefix | default "data-prism") | trunc 63 | trimSuffix "-" }}
{{- end -}}
{{- end }}

{{/* Common labels. `app:` is set per component by the caller, scoped
     `prism-<component>` — never a bare generic value. */}}
{{- define "prism.labels" -}}
app.kubernetes.io/part-of: sensa-data-foundational-platform
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/* Image pull policy: component value -> global knob -> Always. */}}
{{- define "prism.pullPolicy" -}}
{{- $ctx := .ctx -}}
{{- .policy | default $ctx.Values.global.imagePullPolicy | default "Always" }}
{{- end }}

{{/* Pull secrets: SRI's global.pullSecrets if set, else the chart's own list. */}}
{{- define "prism.imagePullSecrets" -}}
{{- /* `global.pullSecrets` IS NOT A LIST OF NAMES in the SRI umbrella: it is a
       map describing how the pull secret gets CREATED — {enabled,
       dockerconfigjson} and optionally {names}. Ranging a map yields its
       VALUES, so reading `.name` off each element died with "can't evaluate
       field name in type interface {}" the moment this chart was enabled inside
       the umbrella. Read `names` when it is a map, accept a plain list from any
       caller that passes one, and otherwise use this chart's own
       imagePullSecrets — which is what an umbrella install wants, because the
       platform names the secret it creates in the chart's own values. */}}
{{- $g := .Values.global.pullSecrets -}}
{{- $secrets := .Values.imagePullSecrets -}}
{{- if kindIs "map" $g -}}
{{-   with $g.names }}{{ $secrets = . }}{{ end -}}
{{- else if kindIs "slice" $g -}}
{{-   $secrets = $g -}}
{{- end -}}
{{- with $secrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ if kindIs "string" . }}{{ . }}{{ else }}{{ .name }}{{ end }}
{{- end }}
{{- end }}
{{- end }}

{{/* First-party image reference: <registry>/<repository>/<name>:<tag> */}}
{{/* First-party image reference: <registry>/<repository>/<name>:<tag>.

     registry and repository are per-component OPTIONAL overrides, falling back to
     image.* for all three components — which is the normal case, since CI
     publishes them together. The override exists for the abnormal one: pinning a
     single component to a build that lives somewhere else, without dragging its
     siblings to a registry that has no copy of them. An environment mid-migration
     between registries hits exactly that, and without this the only expressible
     choices are "move everything" or "move nothing". */}}
{{- define "prism.image" -}}
{{- $reg := .registry | default .ctx.Values.image.registry -}}
{{- $repo := .repository | default .ctx.Values.image.repository -}}
{{- printf "%s/%s/%s:%s" $reg $repo .name .tag }}
{{- end }}

{{/* ── Endpoints ──────────────────────────────────────────────────────────── */}}

{{- define "prism.neo4jHost" -}}
{{- if .Values.infra.neo4j.enabled -}}
{{ include "prism.fullname" . }}-neo4j
{{- else -}}
{{ required "externalInfra.neo4j.uri is required when infra.neo4j.enabled is false" .Values.externalInfra.neo4j.uri }}
{{- end -}}
{{- end }}

{{- define "prism.neo4jUri" -}}
{{- if .Values.infra.neo4j.enabled -}}
bolt://{{ include "prism.fullname" . }}-neo4j:7687
{{- else -}}
{{ required "externalInfra.neo4j.uri is required when infra.neo4j.enabled is false" .Values.externalInfra.neo4j.uri }}
{{- end -}}
{{- end }}

{{- define "prism.neo4jUser" -}}
{{- if .Values.infra.neo4j.enabled -}}neo4j{{- else -}}{{ .Values.externalInfra.neo4j.user }}{{- end -}}
{{- end }}

{{- define "prism.neo4jDatabase" -}}
{{- if .Values.infra.neo4j.enabled -}}neo4j{{- else -}}{{ .Values.externalInfra.neo4j.database | default "neo4j" }}{{- end -}}
{{- end }}

{{- define "prism.ledgerHost" -}}
{{- if .Values.infra.ledgerPostgres.enabled -}}
{{ include "prism.fullname" . }}-ledger-postgres
{{- else -}}
{{ required "externalInfra.ledgerPostgres.host is required when infra.ledgerPostgres.enabled is false" .Values.externalInfra.ledgerPostgres.host }}
{{- end -}}
{{- end }}

{{- define "prism.ledgerUser" -}}
{{- if .Values.infra.ledgerPostgres.enabled -}}{{ .Values.infra.ledgerPostgres.user }}{{- else -}}{{ .Values.externalInfra.ledgerPostgres.user }}{{- end -}}
{{- end }}

{{- define "prism.ledgerDatabase" -}}
{{- if .Values.infra.ledgerPostgres.enabled -}}{{ .Values.infra.ledgerPostgres.database }}{{- else -}}{{ .Values.externalInfra.ledgerPostgres.database }}{{- end -}}
{{- end }}

{{/* The ledger DSN. `$(LEDGER_PG_PASSWORD)` is deliberate: kubernetes expands
     it from the sibling env var at container start, so the password reaches the
     process without ever being written into a manifest, a ConfigMap, or this
     chart. Keep LEDGER_PG_PASSWORD declared BEFORE this var. */}}
{{- define "prism.ledgerDsn" -}}
{{- if and (not .Values.infra.ledgerPostgres.enabled) .Values.externalInfra.ledgerPostgres.dsn -}}
{{ .Values.externalInfra.ledgerPostgres.dsn }}
{{- else -}}
{{- $port := 5432 -}}
{{- if not .Values.infra.ledgerPostgres.enabled -}}{{- $port = .Values.externalInfra.ledgerPostgres.port | default 5432 -}}{{- end -}}
postgresql://{{ include "prism.ledgerUser" . }}:$(LEDGER_PG_PASSWORD)@{{ include "prism.ledgerHost" . }}:{{ $port }}/{{ include "prism.ledgerDatabase" . }}
{{- end -}}
{{- end }}

{{- define "prism.warehouseHost" -}}
{{- if .Values.infra.warehousePostgres.enabled -}}
{{ include "prism.fullname" . }}-warehouse-postgres
{{- else -}}
{{ required "externalInfra.warehousePostgres.host is required when infra.warehousePostgres.enabled is false" .Values.externalInfra.warehousePostgres.host }}
{{- end -}}
{{- end }}

{{- define "prism.warehouseUser" -}}
{{- if .Values.infra.warehousePostgres.enabled -}}{{ .Values.infra.warehousePostgres.user }}{{- else -}}{{ .Values.externalInfra.warehousePostgres.user }}{{- end -}}
{{- end }}

{{/* The env block every ledger+graph consumer needs (api, reproject,
     reset-world). One definition so the DSN and the password can never drift. */}}
{{- define "prism.graphAndLedgerEnv" -}}
- name: NEO4J_URI
  value: {{ include "prism.neo4jUri" . | quote }}
- name: NEO4J_USER
  value: {{ include "prism.neo4jUser" . | quote }}
- name: NEO4J_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.neo4jAuth }}
      key: password
- name: LEDGER_PG_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.ledgerPg }}
      key: password
- name: PRISM_LEDGER_PG_DSN
  value: {{ include "prism.ledgerDsn" . | quote }}
{{- end }}

{{/*
DESTRUCTIVE-JOB GUARD.

The operational jobs destroy data on whichever server they are pointed at, and
`infra.<store>.enabled: false` points them at somebody else's. The intended
external target is the platform's SHARED Postgres (and potentially a shared
Neo4j), so a values typo — one line in an environment overlay — would drop a
database or wipe a graph that every other product on that server depends on.
`enabled: true` is not consent to that: it was written when the only possible
target was this release's own bundled server.

So each destructive job carries a SECOND gate that only applies in external
mode, and a missing opt-in FAILS THE RENDER rather than skipping the job.
Skipping silently would be its own trap: the operator sees a successful upgrade
and believes the rebuild ran.

Usage: pass the job's allow flag and one target per store the job destroys.
  {{ include "prism.destructiveGuard" (dict "ctx" $ "job" "rebuild-warehouse"
     "allowPath" "jobs.rebuildWarehouse.allowExternalDestructive"
     "allow" .Values.jobs.rebuildWarehouse.allowExternalDestructive
     "targets" (list (dict "external" (not .Values.infra.warehousePostgres.enabled)
                          "store" "warehouse Postgres"
                          "endpoint" (include "prism.warehouseHost" .)
                          "does" "DROP DATABASE foundation_warehouse"))) }}
*/}}
{{- define "prism.destructiveGuard" -}}
{{- if not .allow -}}
{{- range .targets -}}
{{- if .external -}}
{{- fail (printf "\n\nREFUSING TO RENDER the %s job.\n\nIt runs %s against an EXTERNAL %s (%s) — a server this release does not own.\nThe intended external target is the platform's shared Postgres/Neo4j, where that\nstatement would destroy data other products depend on.\n\nIf that is genuinely what you want, opt in explicitly:\n    --set %s=true\n\nOtherwise leave the store bundled (infra.*.enabled: true), or disable the job.\n" $.job .does .store .endpoint $.allowPath) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* Scheduling shared by every workload. */}}
{{- define "prism.scheduling" -}}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
