{{/*
Expand the name of the chart.
*/}}
{{- define "copilotv2.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "copilotv2.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "copilotv2.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "copilotv2.labels" -}}
helm.sh/chart: {{ include "copilotv2.chart" . }}
{{ include "copilotv2.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "copilotv2.selectorLabels" -}}
app.kubernetes.io/name: {{ include "copilotv2.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "copilotv2.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "copilotv2.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
True when copilotv2 pods should wait for infrastructure dependency endpoints.
*/}}
{{- define "copilotv2.waitDependenciesNeeded" -}}
{{- $dep := .Values.waitForDependencies -}}
{{- if and $dep.enabled (or $dep.postgres.enabled $dep.terrarium.enabled) -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: wait for infrastructure dependency endpoints to be ready.
*/}}
{{- define "copilotv2.waitDependenciesInitContainer" -}}
{{- if not (include "copilotv2.waitDependenciesNeeded" . | trim) -}}
{{- else -}}
{{- $dep := .Values.waitForDependencies -}}
{{- $gs  := .Values.global.services | default dict -}}
{{- /* in-tree patch: the same three-tier fallback copilot/api/disc-api use —
     per-chart explicit, then the shared global.services.* map, then the bare
     literal. Without the middle tier a renamed service can only be corrected
     by setting it once per copilot alias, and copilotv2 had no middle tier at
     all (Risk #8, docs/NAMING-MIGRATION.md §4). */}}
{{- $pgSvc  := $dep.postgres.service  | default ($gs.postgresCopilotv2Rw | default "cn-postgres-copilotv2-rw") -}}
{{- $pgPort := $dep.postgres.port     | default ($gs.postgresPort | default 5432) -}}
{{- $tSvc   := $dep.terrarium.service | default ($gs.terrarium | default "terrarium") -}}
{{- $tPort  := $dep.terrarium.port             | default 8080 -}}
- name: wait-dependencies
  image: {{ $dep.image | quote }}
  imagePullPolicy: {{ $dep.imagePullPolicy | default .Values.global.imagePullPolicy | default "Always" }}
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - ALL
  resources:
    {{- toYaml $dep.resources | nindent 4 }}
  command:
    - sh
    - -c
    - |
      set -eu
      NS="$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)"
      TIMEOUT={{ $dep.timeoutSeconds }}
      deadline=$(($(date +%s) + TIMEOUT))

      wait_for_endpoint() {
        local name="$1" host="$2" port="$3"
        # accept both a bare service name and a namespace-qualified FQDN
        # (<svc>.<ns>.svc.cluster.local): the EndpointSlice lookup needs the
        # service NAME and its namespace separately.
        local svc ns
        svc="${host%%.*}"
        ns="$NS"
        case "$host" in *.*) ns="$(echo "${host#*.}" | cut -d. -f1)" ;; esac
        local api="https://kubernetes.default.svc"
        local token cacert
        token="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"
        cacert="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
        while [ "$(date +%s)" -lt "$deadline" ]; do
          code=$(curl -sS -o /tmp/ep.json -w "%{http_code}" --connect-timeout 5 --max-time 15 \
            --cacert "$cacert" -H "Authorization: Bearer $token" \
            "$api/apis/discovery.k8s.io/v1/namespaces/$ns/endpointslices?labelSelector=kubernetes.io%2Fservice-name%3D$svc") || code=000
          if [ "$code" = "200" ] && \
             grep -qE '"ready"[[:space:]]*:[[:space:]]*true' /tmp/ep.json; then
            echo "$name ($host:$port) is ready"
            return 0
          fi
          echo "waiting for $name ($host:$port) to be ready (HTTP $code)..."
          sleep 5
        done
        echo "timeout waiting for $name ($host:$port)" >&2
        exit 1
      }
      {{- if $dep.terrarium.enabled }}
      wait_for_endpoint terrarium {{ $tSvc | quote }} {{ $tPort }}
      {{- end }}
      {{- if $dep.postgres.enabled }}
      wait_for_endpoint postgres {{ $pgSvc | quote }} {{ $pgPort }}
      {{- end }}
      echo "all dependencies ready"
{{- end -}}
{{- end -}}
