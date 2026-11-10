{{/*
Expand the name of the chart.
*/}}
{{- define "disc-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "disc-api.fullname" -}}
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
{{- define "disc-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "disc-api.labels" -}}
helm.sh/chart: {{ include "disc-api.chart" . }}
{{ include "disc-api.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "disc-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "disc-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "disc-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "disc-api.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Backward compatible helper functions for global configuration keys
Each function checks for the new camelCase key first, then falls back to the old SCREAMING_SNAKE_CASE key
*/}}

{{- define "global.basename" -}}
{{- .Values.global.basename | default .Values.global.BASENAME -}}
{{- end }}

{{- define "global.domain" -}}
{{- .Values.global.domain | default .Values.global.DOMAIN -}}
{{- end }}

{{- define "disc-api.waitTlsSecretsNeeded" -}}
{{- if not .Values.waitForTlsSecrets.enabled -}}
{{- else if and (eq .Values.dbRootCert.secretName "") (eq .Values.kafkaRootCert.secretName "") -}}
{{- else -}}
true
{{- end -}}
{{- end -}}

{{- define "disc-api.waitTlsSecretsInitContainer" -}}
{{- if not (include "disc-api.waitTlsSecretsNeeded" . | trim) -}}
{{- else -}}
- name: wait-tls-secrets
  image: {{ .Values.waitForTlsSecrets.image | quote }}
  imagePullPolicy: {{ .Values.waitForTlsSecrets.imagePullPolicy | default .Values.global.imagePullPolicy | default "Always" }}
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - ALL
  resources:
    {{- toYaml .Values.waitForTlsSecrets.resources | nindent 4 }}
  command:
    - sh
    - -c
    - |
      set -eu
      TOKEN="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"
      CACERT="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
      NS="$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)"
      API="https://kubernetes.default.svc"
      TIMEOUT={{ .Values.waitForTlsSecrets.timeoutSeconds }}
      deadline=$(($(date +%s) + TIMEOUT))
      wait_one() {
        sec="$1"
        while [ "$(date +%s)" -lt "$deadline" ]; do
          code=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
            --cacert "$CACERT" -H "Authorization: Bearer $TOKEN" \
            "$API/api/v1/namespaces/$NS/secrets/$sec") || code=000
          if [ "$code" = "200" ]; then
            echo "secret $sec is ready"
            return 0
          fi
          echo "waiting for secret $sec (HTTP $code)..."
          sleep 3
        done
        echo "timeout after ${TIMEOUT}s waiting for secret $sec" >&2
        exit 1
      }
      {{- if ne .Values.dbRootCert.secretName "" }}
      wait_one "{{ .Values.dbRootCert.secretName }}"
      {{- end }}
      {{- if ne .Values.kafkaRootCert.secretName "" }}
      wait_one "{{ .Values.kafkaRootCert.secretName }}"
      {{- end }}
      echo "all TLS CA secrets present"
{{- end -}}
{{- end -}}

{{- define "disc-api.waitPermissionsNeeded" -}}
{{- if or (include "disc-api.waitTlsSecretsNeeded" . | trim) (include "disc-api.waitDependenciesNeeded" . | trim) -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: wait for infrastructure dependency endpoints to be ready.
*/}}
{{- define "disc-api.waitDependenciesNeeded" -}}
{{- $dep := .Values.waitForDependencies -}}
{{- if and $dep.enabled (or $dep.postgres.enabled $dep.kafka.enabled $dep.minio.enabled $dep.api.enabled) -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: wait for all dependency endpoints (postgres, kafka, minio, api) to be ready.
*/}}
{{- define "disc-api.waitDependenciesInitContainer" -}}
{{- if not (include "disc-api.waitDependenciesNeeded" . | trim) -}}
{{- else -}}
{{- $dep := .Values.waitForDependencies -}}
{{- $gs  := .Values.global.services | default dict -}}
{{- $pgSvc  := $dep.postgres.service | default ($gs.postgresRw    | default "cn-postgres-rw") -}}
{{- $pgPort := $dep.postgres.port    | default ($gs.postgresPort  | default 5432) -}}
{{- /* Kafka: derive hostname from global.SENSA_KAFKA_BOOTSTRAP ("host:port") when not overridden */}}
{{- $kGlobal := first (splitList ":" (.Values.global.SENSA_KAFKA_BOOTSTRAP | default "invhub-kafka-bootstrap:9093")) -}}
{{- $kSvc   := $dep.kafka.service    | default ($gs.kafkaBootstrap | default $kGlobal) -}}
{{- $kPort  := $dep.kafka.port       | default ($gs.kafkaPort      | default 9093) -}}
{{- $mSvc   := $dep.minio.service    | default ($gs.minio           | default "minio") -}}
{{- $mPort  := $dep.minio.port       | default ($gs.minioPort        | default 9000) -}}
{{- /* API: derive from global.internalApiBaseUrl or auto-detect based on separateApiResponsibilities */}}
{{- $sep     := ((.Values.global).separateApiResponsibilities) | default false -}}
{{- $autoUrl := ternary "http://api-for-ui:3001" "http://api:3001" $sep -}}
{{- $apiUrl  := ((.Values.global).internalApiBaseUrl) | default $autoUrl -}}
{{- $apiSvc  := $dep.api.service | default ((urlParse $apiUrl).host | splitList ":" | first) -}}
{{- $apiPort := $dep.api.port    | default 3001 -}}
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
      {{- if $dep.kafka.enabled }}
      wait_for_endpoint kafka {{ $kSvc | quote }} {{ $kPort }}
      {{- end }}
      {{- if $dep.minio.enabled }}
      wait_for_endpoint minio {{ $mSvc | quote }} {{ $mPort }}
      {{- end }}
      {{- if $dep.api.enabled }}
      wait_for_endpoint api {{ $apiSvc | quote }} {{ $apiPort }}
      {{- end }}
      echo "all dependencies ready"
{{- end -}}
{{- end -}}