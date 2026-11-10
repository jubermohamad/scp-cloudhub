{{/* Common naming + labels. */}}

{{- define "cpr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cpr.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{/* platform naming convention: <release>-data-cpr-<component> */}}
{{- printf "%s-data-cpr" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "cpr.labels" -}}
app.kubernetes.io/name: {{ include "cpr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* imagePullSecrets block for pod specs. Empty (the minikube default) renders nothing. On AKS,
     prefer attaching the ACR to the cluster's kubelet identity (`az aks update --attach-acr`) so no
     secret is needed at all; set images.pullSecrets only for a private registry authed by a secret. */}}
{{- define "cpr.imagePullSecrets" -}}
{{- with .Values.images.pullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{/* Component-scoped names (stable service DNS the images/templates rely on). */}}
{{- define "cpr.postgres.fullname" -}}{{ printf "%s-postgres" (include "cpr.fullname" .) }}{{- end -}}
{{- define "cpr.api.fullname"      -}}{{ printf "%s-api" (include "cpr.fullname" .) }}{{- end -}}
{{- define "cpr.web.fullname"      -}}{{ printf "%s-web" (include "cpr.fullname" .) }}{{- end -}}

{{/* ── Postgres wiring ────────────────────────────────────────────────────────────────────────────
     The serving store is a CloudNativePG `Cluster` by default; an `existingSecret` escape hatch points
     at a pre-existing / external managed Postgres instead. Both resolve through these helpers so the
     api / backfill / R38-build env is sourced identically:
       - `cpr.pg.conninfo`   → a libpq string WITH NO PASSWORD (safe to render as a plain value)
       - `cpr.pg.secretName` / `cpr.pg.secretKey` → where the password lives (secretKeyRef → PGPASSWORD)
     No password is ever rendered into values or the helm-release history — CNPG generates + owns it. */}}

{{/* CNPG Cluster name → the -rw / -ro / -r Services and the <name>-app / <name>-superuser Secrets. */}}
{{- define "cpr.pg.clusterName" -}}
{{- default (printf "%s-pg" (include "cpr.fullname" .)) .Values.postgres.cnpg.clusterName -}}
{{- end -}}

{{/* True when using an external (non-CNPG) Postgres via a pre-existing secret. */}}
{{- define "cpr.pg.external" -}}
{{- if .Values.postgres.existingSecret.name }}true{{- end -}}
{{- end -}}

{{- define "cpr.pg.host" -}}
{{- if .Values.postgres.existingSecret.name -}}
{{- .Values.postgres.existingSecret.host -}}
{{- else -}}
{{- printf "%s-rw" (include "cpr.pg.clusterName" .) -}}
{{- end -}}
{{- end -}}

{{- define "cpr.pg.port" -}}
{{- if .Values.postgres.existingSecret.name -}}{{ .Values.postgres.existingSecret.port }}{{- else -}}{{ .Values.postgres.service.port }}{{- end -}}
{{- end -}}

{{- define "cpr.pg.user" -}}
{{- if .Values.postgres.existingSecret.name -}}{{ .Values.postgres.existingSecret.user }}{{- else -}}{{ .Values.postgres.cnpg.owner }}{{- end -}}
{{- end -}}

{{- define "cpr.pg.database" -}}
{{- if .Values.postgres.existingSecret.name -}}{{ .Values.postgres.existingSecret.database }}{{- else -}}{{ .Values.postgres.cnpg.database }}{{- end -}}
{{- end -}}

{{/* Secret + key holding the password (CNPG's generated <cluster>-app, or the external secret). */}}
{{- define "cpr.pg.secretName" -}}
{{- if .Values.postgres.existingSecret.name -}}{{ .Values.postgres.existingSecret.name }}{{- else -}}{{ printf "%s-app" (include "cpr.pg.clusterName" .) }}{{- end -}}
{{- end -}}

{{- define "cpr.pg.secretKey" -}}
{{- if .Values.postgres.existingSecret.name -}}{{ .Values.postgres.existingSecret.passwordKey }}{{- else -}}password{{- end -}}
{{- end -}}

{{/* libpq conninfo pointing at the Postgres service (password comes from PGPASSWORD in the pod env). */}}
{{- define "cpr.pg.conninfo" -}}
host={{ include "cpr.pg.host" . }} port={{ include "cpr.pg.port" . }} user={{ include "cpr.pg.user" . }} dbname={{ include "cpr.pg.database" . }}
{{- end -}}

{{/* ── Iceberg wiring (R69) ────────────────────────────────────────────────────────────────────────
     One definition of the catalog surface, reused by the backfill SparkApplication (driver AND
     executors — the executors do the distributed write), the api Deployment (which propagates it onto
     the on-demand build CRs) and the warehouse volume. Rendered only when EITHER seam selects Iceberg:
     the write side needs it to write, the read side to read, and the volume must exist for both.

     NB the mount path is deliberately the same value everywhere. Iceberg manifests hold ABSOLUTE file
     paths, so a warehouse is only readable at the path it was written at (spike finding 2) — a
     driver/api mount mismatch is not a slow read, it is a failed one. */}}

{{- define "cpr.iceberg.enabled" -}}
{{- if or (eq .Values.storage.backend "iceberg") (eq .Values.query.backend "iceberg") }}true{{- end -}}
{{- end -}}

{{- define "cpr.iceberg.claimName" -}}
{{- default (printf "%s-warehouse" (include "cpr.fullname" .)) .Values.storage.iceberg.persistence.existingClaim -}}
{{- end -}}

{{/* Env block: the catalog surface as CPR_ICEBERG_* (read by cpr.storage.iceberg.IcebergConfig). */}}
{{- define "cpr.iceberg.env" -}}
{{- if include "cpr.iceberg.enabled" . }}
{{- $i := .Values.storage.iceberg }}
- name: CPR_ICEBERG_WAREHOUSE
  value: {{ $i.warehouse | quote }}
- name: CPR_ICEBERG_CATALOG
  value: {{ $i.catalog | quote }}
- name: CPR_ICEBERG_NAMESPACE
  value: {{ $i.namespace | quote }}
- name: CPR_ICEBERG_CATALOG_TYPE
  value: {{ $i.catalogType | quote }}
- name: CPR_ICEBERG_BUCKETS
  value: {{ $i.buckets | quote }}
- name: CPR_ICEBERG_WRITE_MODE
  value: {{ $i.writeMode | quote }}
- name: CPR_STORAGE_LIGHTS_OUT
  value: {{ $i.lightsOut | quote }}
{{- end }}
{{- end -}}

{{/* The warehouse volume (pod spec `volumes:` entry). */}}
{{- define "cpr.iceberg.volume" -}}
{{- if include "cpr.iceberg.enabled" . }}
- name: warehouse
  {{- if eq .Values.storage.iceberg.persistence.type "pvc" }}
  persistentVolumeClaim:
    claimName: {{ include "cpr.iceberg.claimName" . }}
  {{- else }}
  hostPath:
    path: {{ .Values.storage.iceberg.persistence.hostPath | quote }}
    type: DirectoryOrCreate
  {{- end }}
{{- end }}
{{- end -}}

{{/* The warehouse volumeMount. `readOnly` for the api (it only ever reads); RW for Spark pods. */}}
{{- define "cpr.iceberg.volumeMount" -}}
{{- if include "cpr.iceberg.enabled" . }}
- name: warehouse
  mountPath: {{ .Values.storage.iceberg.mountPath | quote }}
{{- end }}
{{- end -}}
