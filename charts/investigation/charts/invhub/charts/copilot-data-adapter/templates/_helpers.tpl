{{/*
Expand the name of the chart.
*/}}
{{- define "copilot-data-adapter.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "copilot-data-adapter.fullname" -}}
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
{{- define "copilot-data-adapter.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "copilot-data-adapter.labels" -}}
helm.sh/chart: {{ include "copilot-data-adapter.chart" . }}
{{ include "copilot-data-adapter.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "copilot-data-adapter.selectorLabels" -}}
app.kubernetes.io/name: {{ include "copilot-data-adapter.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "copilot-data-adapter.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "copilot-data-adapter.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
True when copilot-data-adapter pods should wait for infrastructure dependency endpoints.
*/}}
{{- define "copilot-data-adapter.waitDependenciesNeeded" -}}
{{- $dep := .Values.waitForDependencies -}}
{{- if and $dep.enabled $dep.postgres.enabled -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: wait for infrastructure dependency endpoints to be ready.
*/}}
{{- define "copilot-data-adapter.waitDependenciesInitContainer" -}}
{{- if not (include "copilot-data-adapter.waitDependenciesNeeded" . | trim) -}}
{{- else -}}
{{- $dep := .Values.waitForDependencies -}}
{{- $pgSvc  := $dep.postgres.service | default "cn-postgres-copilot-data-adapter-rw" -}}
{{- $pgPort := $dep.postgres.port    | default 5432 -}}
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
      wait_for_endpoint postgres {{ $pgSvc | quote }} {{ $pgPort }}
      echo "all dependencies ready"
{{- end -}}
{{- end -}}
