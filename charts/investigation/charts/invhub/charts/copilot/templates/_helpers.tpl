{{/*
Expand the name of the chart.
*/}}
{{- define "copilot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "copilot.fullname" -}}
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
{{- define "copilot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "copilot.labels" -}}
helm.sh/chart: {{ include "copilot.chart" . }}
{{ include "copilot.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "copilot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "copilot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "copilot.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "copilot.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Classify sensitive env keys that must never be stored in a ConfigMap.
*/}}
{{- define "copilot.isSensitiveEnvKey" -}}
{{- $key := (. | toString) -}}
{{- if regexMatch "(?i)(PASSWORD|API_KEY|SECRET|TOKEN)" $key -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{/*
True when this copilot engine should wait for infrastructure dependency endpoints.
*/}}
{{- define "copilot.waitDependenciesNeeded" -}}
{{- $dep := .Values.waitForDependencies -}}
{{- if and $dep.enabled (or $dep.postgres.enabled $dep.redis.enabled $dep.terrarium.enabled) -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: wait for infrastructure dependency endpoints to be ready.
*/}}
{{- define "copilot.waitDependenciesInitContainer" -}}
{{- if not (include "copilot.waitDependenciesNeeded" . | trim) -}}
{{- else -}}
{{- $dep := .Values.waitForDependencies -}}
{{- $gs  := .Values.global.services | default dict -}}
{{- /* in-tree patch: fall back to global.services.* like api/disc-api do — the
     bare chart defaults break as soon as the shared services are renamed
     (there is no "redis-master" Service in the SRI release; invhub's is
     invhub-redis-master). */}}
{{- $pgSvc  := $dep.postgres.service  | default ($gs.postgresCopilotRw | default "cn-postgres-copilot-rw") -}}
{{- $pgPort := $dep.postgres.port     | default ($gs.postgresPort | default 5432) -}}
{{- $rdSvc  := $dep.redis.service     | default ($gs.redisMaster | default "redis-master") -}}
{{- $rdPort := $dep.redis.port        | default ($gs.redisPort | default 6379) -}}
{{- $tSvc   := $dep.terrarium.service | default ($gs.terrarium | default "terrarium") -}}
{{- $tPort  := $dep.terrarium.port    | default 8080 -}}
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
      {{- if $dep.postgres.enabled }}
      wait_for_endpoint postgres {{ $pgSvc | quote }} {{ $pgPort }}
      {{- end }}
      {{- if $dep.redis.enabled }}
      wait_for_endpoint redis {{ $rdSvc | quote }} {{ $rdPort }}
      {{- end }}
      {{- if $dep.terrarium.enabled }}
      wait_for_endpoint terrarium {{ $tSvc | quote }} {{ $tPort }}
      {{- end }}
      echo "all dependencies ready"
{{- end -}}
{{- end -}}
