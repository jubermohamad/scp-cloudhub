{{/*
Expand the name of the chart.
*/}}
{{- define "api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "api.fullname" -}}
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
{{- define "api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "api.labels" -}}
helm.sh/chart: {{ include "api.chart" . }}
{{ include "api.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "api.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Migration job name — unique per Helm revision so each upgrade/rollback creates a new
Job rather than patching the immutable existing one. Must match invhub.migrationJobName.
*/}}
{{- define "api.migrationJobName" -}}
{{- printf "%s-api-migrations-%d" .Release.Name .Release.Revision | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
ConfigMap used to durably record which Helm revision's migration has already been waited on,
so that pod restarts (including after pod deletion) skip re-waiting.
*/}}
{{- define "api.migrationStateConfigMapName" -}}
{{- printf "%s-api-migrations-state" .Release.Name | trunc 63 | trimSuffix "-" -}}
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

{{- define "global.externalHttpsPort" -}}
{{- $port := .Values.global.externalHttpsPort | default .Values.global.EXTERNAL_HTTPS_PORT | default 443 -}}
{{- printf "%v" $port -}}
{{- end }}

{{- define "global.externalHttpsPortSuffix" -}}
{{- $port := include "global.externalHttpsPort" . -}}
{{- if ne $port "443" -}}:{{ $port }}{{- end -}}
{{- end }}

{{- define "global.externalHost" -}}
{{- printf "%s.%s" (include "global.basename" .) (include "global.domain" .) -}}
{{- end }}

{{- define "global.externalHttpsOrigin" -}}
{{- printf "https://%s%s" (include "global.externalHost" .) (include "global.externalHttpsPortSuffix" .) -}}
{{- end }}

{{- define "global.remoteDataDbType" -}}
{{- .Values.global.remoteDataDbType | default .Values.global.REMOTE_DATA_DB_TYPE -}}
{{- end }}

{{- define "global.remoteDataDbHost" -}}
{{- .Values.global.remoteDataDbHost | default .Values.global.REMOTE_DATA_DB_HOST -}}
{{- end }}

{{- define "global.remoteDataDbPort" -}}
{{- .Values.global.remoteDataDbPort | default .Values.global.REMOTE_DATA_DB_PORT -}}
{{- end }}

{{- define "global.remoteDataDbName" -}}
{{- .Values.global.remoteDataDbName | default .Values.global.REMOTE_DATA_DB_NAME -}}
{{- end }}

{{- define "global.remoteDataDbUseSsl" -}}
{{- .Values.global.remoteDataDbUseSsl | default .Values.global.REMOTE_DATA_DB_USE_SSL -}}
{{- end }}

{{- define "global.remoteDataDbSslSelfSigned" -}}
{{- .Values.global.remoteDataDbSslSelfSigned | default .Values.global.REMOTE_DATA_DB_SSL_SELF_SIGNED -}}
{{- end }}

{{- define "global.remoteDataDbUsername" -}}
{{- .Values.global.remoteDataDbUsername | default .Values.global.REMOTE_DATA_DB_USERNAME -}}
{{- end }}

{{- define "global.remoteDataDbPassword" -}}
{{- .Values.global.remoteDataDbPassword | default .Values.global.REMOTE_DATA_DB_PASSWORD -}}
{{- end }}

{{- define "global.pendoAccountId" -}}
{{- .Values.global.pendoAccountId | default .Values.global.INVHUB_PENDO_ACCOUNTID -}}
{{- end }}

{{/*
Shared env vars for the api container and the migration-init init container.
SKIP_INIT, SKIP_MIGRATIONS and SKIP_APP_SERVER are intentionally excluded — callers append them
with the values appropriate for their role.
*/}}
{{- define "api.containerEnv" -}}
- name: HOME
  value: /tmp
- name: npm_config_cache
  value: /tmp/.npm
- name: SENSA_API_DOCS
  value: "{{ .Values.global.SENSA_API_DOCS }}"
- name: SENSA_SERVICE_USER
  value: {{ .Values.global.SENSA_SERVICE_USER }}
- name: COPILOT_SOCKET_CLIENT_URL
  value: "wss://{{ include "global.basename" . }}-copilot-ie.{{ include "global.domain" . }}{{ include "global.externalHttpsPortSuffix" . }}"
- name: SENSA_API_KEY_SECRET
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: sensa-api-key-secret
- name: INVESTIGATION_HUB_INSTALL_ADMIN_USER_API_KEY
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: investigation-hub-install-admin-user-api-key
- name: INVESTIGATION_HUB_DISCLOSURES_SERVICE_USER_API_KEY
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: investigation-hub-disclosures-service-user-api-key
- name: INVESTIGATION_HUB_COPILOT_SERVICE_USER_API_KEY
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: investigation-hub-copilot-service-user-api-key
- name: INVESTIGATION_HUB_TRANSACTIONS_SERVICE_USER_API_KEY
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: investigation-hub-transactions-service-user-api-key
- name: INVESTIGATION_HUB_ENTITY_RESOLUTION_SERVICE_USER_API_KEY
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: investigation-hub-entity-resolution-service-user-api-key
- name: INVESTIGATION_HUB_REPORTING_SERVICE_USER_API_KEY
  valueFrom:
    secretKeyRef:
      name: invhub-service-api-keys
      key: investigation-hub-reporting-service-user-api-key
- name: SENSA_API_URL
  value: {{ include "global.externalHttpsOrigin" . | quote }}
- name: SENSA_DB_URL
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: SENSA_DB_URL
- name: FLOWS_INVHUB_BASE_URL
  value: "{{ include "global.basename" . }}.{{ include "global.domain" . }}"
- name: SENSA_ENCRYPTION_SECRET
  valueFrom:
    secretKeyRef:
      name: invhub-encryption-secret
      key: encryption-key
- name: SENSA_JWT_ACCESS_SECRET
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: SENSA_JWT_ACCESS_SECRET
- name: SENSA_JWT_REFRESH_SECRET
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: SENSA_JWT_REFRESH_SECRET
- name: REMOTE_DATA_DB_TYPE
  value: "{{ include "global.remoteDataDbType" . }}"
- name: KAFKA_CONNECTOR_URL
  value: {{ .Values.global.KAFKA_CONNECTOR_URL }}
{{- if eq (include "global.remoteDataDbType" .) "postgres" }}
- name: REMOTE_DATA_DB_HOST
  value: "{{ include "global.remoteDataDbHost" . }}"
- name: REMOTE_DATA_DB_PORT
  value: "{{ include "global.remoteDataDbPort" . }}"
- name: REMOTE_DATA_DB_NAME
  value: "{{ include "global.remoteDataDbName" . }}"
- name: REMOTE_DATA_DB_USE_SSL
  value: "{{ include "global.remoteDataDbUseSsl" . }}"
- name: REMOTE_DATA_DB_SSL_SELF_SIGNED
  value: "{{ include "global.remoteDataDbSslSelfSigned" . }}"
{{- else }}
- name: REMOTE_DATA_DB_URL
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: REMOTE_DATA_DB_URL
{{- end }}
{{- if include "global.remoteDataDbUsername" . }}
- name: REMOTE_DATA_DB_USERNAME
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: REMOTE_DATA_DB_USERNAME
{{- end }}
{{- if include "global.remoteDataDbPassword" . }}
- name: REMOTE_DATA_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: REMOTE_DATA_DB_PASSWORD
{{- end }}
{{- if and (hasKey .Values.global "SERVICES_MANAGER_URL") (ne .Values.global.SERVICES_MANAGER_URL "") }}
- name: SERVICES_MANAGER_URL
  value: "{{ .Values.global.SERVICES_MANAGER_URL }}"
{{- end }}
- name: SERVICES_MANAGER_USERNAME
  valueFrom:
    secretKeyRef:
      name: services-manager-creds
      key: user
- name: SERVICES_MANAGER_PASSWORD
  valueFrom:
    secretKeyRef:
      name: services-manager-creds
      key: password
- name: SENSA_KAFKA_BOOTSTRAP
  value: {{ .Values.global.SENSA_KAFKA_BOOTSTRAP }}
- name: SENSA_KAFKA_SSL
  value: "{{ .Values.global.SENSA_KAFKA_SSL }}"
- name: SENSA_KAFKA_MAX_BYTES
  value: "{{ .Values.global.SENSA_KAFKA_MAX_BYTES }}"
- name: SENSA_KAFKA_INITIAL_RETRY_TIME
  value: "{{ .Values.global.SENSA_KAFKA_INITIAL_RETRY_TIME }}"
- name: SENSA_KAFKA_RETRIES
  value: "{{ .Values.global.SENSA_KAFKA_RETRIES }}"
- name: SENSA_KAFKA_SESSION_TIMEOUT
  value: "{{ .Values.global.SENSA_KAFKA_SESSION_TIMEOUT }}"
- name: SENSA_KAFKA_HEARTBEAT_INTERVAL
  value: "{{ .Values.global.SENSA_KAFKA_HEARTBEAT_INTERVAL }}"
- name: SENSA_KAFKA_SSL_CA_PATH
  value: {{ .Values.global.SENSA_KAFKA_SSL_CA_PATH }}
- name: MINIO_SSL_CA_PATH
  value: "{{ .Values.global.MINIO_SSL_CA_PATH }}"              
- name: SENSA_PROMETHEUS_URL
  value: {{ .Values.global.SENSA_PROMETHEUS_URL }}
- name: INVHUB_PENDO_ACCOUNTID
  value: "{{ include "global.pendoAccountId" . }}"
- name: INVHUB_EUREKA_VERSION
  value: {{ .Values.global.eurekaVersion }}
- name: SENSA_LOG_LEVEL
  value: {{ .Values.global.SENSA_LOG_LEVEL }}
- name: SENSA_THROTTLE_LIMIT
  value: "{{ .Values.global.SENSA_THROTTLE_LIMIT }}"
- name: AGENT_BATCH_MAX_CONCURRENT_REQUESTS
  value: "{{ .Values.global.AGENT_BATCH_MAX_CONCURRENT_REQUESTS }}"
- name: AGENT_REQUESTS_BATCH_CRON
  value: {{ .Values.global.AGENT_REQUESTS_BATCH_CRON | quote }}
- name: SENSA_REDIS_URL
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: SENSA_REDIS_URL
- name: SENSA_S3_URL
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: SENSA_S3_URL
- name: INVHUB_GOOGLE_MAPS_API_KEY
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: INVHUB_GOOGLE_MAPS_API_KEY
- name: INVHUB_PENDO_API_KEY
  valueFrom:
    secretKeyRef:
      name: sensa-global-secrets
      key: INVHUB_PENDO_API_KEY
{{- if .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH }}
- name: INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH
  value: {{ .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH | quote }}
- name: INVESTIGATION_HUB_OPEN_SEARCH_USER
  valueFrom:
    secretKeyRef:
      name: opensearch-basic-auth
      key: INVESTIGATION_HUB_OPEN_SEARCH_USER
- name: INVESTIGATION_HUB_OPEN_SEARCH_PASSWORD
  valueFrom:
    secretKeyRef:
      name: opensearch-basic-auth
      key: INVESTIGATION_HUB_OPEN_SEARCH_PASSWORD
- name: NODE_EXTRA_CA_CERTS
  value: "/os-ca-cert/ca.crt"
{{- end }}
- name: SENSA_WEB_URL
  value: {{ include "global.externalHttpsOrigin" . | quote }}
- name: SUBJECT_CONTENT_SUMMARY_MAX_LENGTH
  value: {{ .Values.global.SUBJECT_CONTENT_SUMMARY_MAX_LENGTH | default 4000 | quote }}
{{- if .Values.global.SENSA_JWT_EXPIRESIN }}
- name: SENSA_JWT_EXPIRESIN
  value: {{ .Values.global.SENSA_JWT_EXPIRESIN | quote }}
{{- end }}
{{- if .Values.global.SENSA_JWT_REFRESH_EXPIRESIN }}
- name: SENSA_JWT_REFRESH_EXPIRESIN
  value: {{ .Values.global.SENSA_JWT_REFRESH_EXPIRESIN | quote }}
{{- end }}
- name: MOCK_SERVER_URL
  value: {{ include "global.externalHttpsOrigin" . | quote }}
- name: NODE_ENV
  value: {{ .Values.global.NODE_ENV }}
- name: INVESTIGATION_HUB_OPEN_SEARCH_URL
  value: {{ .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_URL }}
- name: ENTITY_RESOLUTION_URL
  value: {{ .Values.global.ENTITY_RESOLUTION_URL }}
- name: CLAMAV_HOST
  value: {{ .Values.global.CLAMAV_HOST | default "clamavd" | quote }}
- name: CLAMAV_PORT
  value: {{ .Values.global.CLAMAV_PORT | default 3310 | quote }}
{{- $corsDefault := include "global.externalHttpsOrigin" . }}
- name: SENSA_CORS_ORIGIN
  value: {{ tpl (.Values.global.SENSA_CORS_ORIGIN | default $corsDefault) . | quote }}
- name: CSV_MAX_EXPORT_RECORDS
  value: "{{ .Values.global.csvMaxExportRecords | default 10000 }}"
- name: ENABLED_DISCLOSURE_TYPES
  value: "{{ .Values.global.ENABLED_DISCLOSURE_TYPES }}"
- name: EVENT_SCHEDULER_CRON
  value: "{{ .Values.global.EVENT_SCHEDULER_CRON }}"
- name: ENABLE_NODE_INSPECT
  value: "{{ .Values.global.enableNodeInspect | default false }}"            
{{- end }}

{{/*
Shared volume mounts for the api container and the migration-init init container.
*/}}
{{- define "api.containerVolumeMounts" -}}
- name: tmp
  mountPath: /tmp
- name: runtime
  mountPath: /usr/src/app/api.pid
  subPath: api.pid
- name: runtime
  mountPath: /usr/src/app/schema.graphql
  subPath: schema.graphql
- name: sensasecrets-volume
  mountPath: /sensasecrets-volume
{{- if ne .Values.dbRootCert.secretName "" }}
- name: db-root-cert
  mountPath: {{ .Values.dbRootCert.mountPath }}
{{- end }}
{{- if ne .Values.kafkaRootCert.secretName "" }}
- name: kafka-root-cert
  mountPath: {{ .Values.kafkaRootCert.mountPath }}
{{- end }}
{{- if and .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH (ne .Values.osRootCert.secretName "") }}
- name: os-ca-cert
  mountPath: {{ .Values.osRootCert.mountPath }}
{{- end }}
{{- end }}

{{/*
Volume mounts for the migration job container — same as api.containerVolumeMounts but
without the runtime subPath entries (api.pid, schema.graphql) which require the
init-runtime-files init container that only the deployment provides.
*/}}
{{- define "api.migrationVolumeMounts" -}}
- name: tmp
  mountPath: /tmp
- name: sensasecrets-volume
  mountPath: /sensasecrets-volume
{{- if ne .Values.dbRootCert.secretName "" }}
- name: db-root-cert
  mountPath: {{ .Values.dbRootCert.mountPath }}
{{- end }}
{{- if ne .Values.kafkaRootCert.secretName "" }}
- name: kafka-root-cert
  mountPath: {{ .Values.kafkaRootCert.mountPath }}
{{- end }}
{{- if and .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH (ne .Values.osRootCert.secretName "") }}
- name: os-ca-cert
  mountPath: {{ .Values.osRootCert.mountPath }}
{{- end }}
{{- end }}

{{/*
Shared volumes used by both the API deployment and the migration job:
tmp emptyDir, sensasecrets-volume secret, and the three conditional cert volumes.
The deployment adds the runtime emptyDir on top of this helper inline.
*/}}
{{- define "api.containerVolumes" -}}
- name: tmp
  emptyDir:
    sizeLimit: 256Mi
- name: sensasecrets-volume
  secret:
    secretName: sensa-global-secrets
{{- if ne .Values.dbRootCert.secretName "" }}
- name: db-root-cert
  secret:
    secretName: {{ .Values.dbRootCert.secretName }}
    items:
      - key: {{ .Values.dbRootCert.key }}
        path: {{ .Values.dbRootCert.key }}
{{- end }}
{{- if ne .Values.kafkaRootCert.secretName "" }}
- name: kafka-root-cert
  secret:
    secretName: {{ .Values.kafkaRootCert.secretName }}
    items:
      - key: {{ .Values.kafkaRootCert.key }}
        path: {{ .Values.kafkaRootCert.key }}
{{- end }}
{{- if and .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH (ne .Values.osRootCert.secretName "") }}
- name: os-ca-cert
  secret:
    secretName: {{ .Values.osRootCert.secretName }}
    items:
      - key: {{ .Values.osRootCert.key }}
        path: {{ .Values.osRootCert.key }}
{{- end }}
{{- end }}

{{/*
envFrom block for flows ConfigMap and Secret.
Pass (dict "ctx" . "optional" true) for the migration job,
or (dict "ctx" . "optional" false) for the deployment.
*/}}
{{- define "api.containerEnvFrom" -}}
- configMapRef:
    name: {{ .ctx.Values.flowsConfigMapName }}
    {{- if .optional }}
    optional: true
    {{- end }}
- secretRef:
    name: {{ .ctx.Values.flowsSecretName }}
    {{- if .optional }}
    optional: true
    {{- end }}
{{- end }}

{{/*
True when wait-for-secrets init should run (enables RBAC + init container).
*/}}
{{- define "api.waitTlsSecretsNeeded" -}}
{{- if not .Values.waitForTlsSecrets.enabled -}}
{{- else if and (eq .Values.dbRootCert.secretName "") (eq .Values.kafkaRootCert.secretName "") (not (and .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH (ne .Values.osRootCert.secretName ""))) -}}
{{- else -}}
true
{{- end -}}
{{- end -}}

{{/*
True when API pods should wait for migrations job completion.
Intentionally does NOT check migrations.enabled — the Job may be owned by the
parent invhub chart rather than this subchart instance.
*/}}
{{- define "api.waitMigrationsNeeded" -}}
{{- if not .Values.waitForMigrations.enabled -}}
{{- else -}}
true
{{- end -}}
{{- end -}}

{{/*
True when RBAC for pre-start polling is required.
*/}}
{{- define "api.waitPermissionsNeeded" -}}
{{- if or (include "api.waitTlsSecretsNeeded" . | trim) (include "api.waitMigrationsNeeded" . | trim) (include "api.waitDependenciesNeeded" . | trim) -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: poll API server until operator-created TLS secrets exist (avoids FailedMount races).
*/}}
{{- define "api.waitTlsSecretsInitContainer" -}}
{{- if not (include "api.waitTlsSecretsNeeded" . | trim) -}}
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
      {{- if and .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_BASIC_AUTH (ne .Values.osRootCert.secretName "") }}
      wait_one "{{ .Values.osRootCert.secretName }}"
      {{- end }}
      echo "all TLS CA secrets present"
{{- end -}}
{{- end -}}

{{/*
Init container: wait until this release's migrations job has completed successfully.
*/}}
{{- define "api.waitMigrationsInitContainer" -}}
{{- if not (include "api.waitMigrationsNeeded" . | trim) -}}
{{- else -}}
- name: wait-migrations
  image: {{ .Values.waitForMigrations.image | quote }}
  imagePullPolicy: {{ .Values.waitForMigrations.imagePullPolicy | default .Values.global.imagePullPolicy | default "Always" }}
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - ALL
  resources:
    {{- toYaml .Values.waitForMigrations.resources | nindent 4 }}
  command:
    - sh
    - -c
    - |
      set -eu
      REVISION="{{ .Release.Revision }}"
      MARKER_CM="{{ include "api.migrationStateConfigMapName" . }}"

      TOKEN="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"
      CACERT="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
      NS="$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)"
      API="https://kubernetes.default.svc"
      JOB="{{ include "api.migrationJobName" . }}"
      TIMEOUT={{ .Values.waitForMigrations.timeoutSeconds }}
      deadline=$(($(date +%s) + TIMEOUT))
      started_at=$(date +%s)

      # Durable path: check if a previous pod already waited for this revision
      cm_code=$(curl -sS -o /tmp/state-cm.json -w "%{http_code}" --connect-timeout 5 --max-time 15 \
        --cacert "$CACERT" -H "Authorization: Bearer $TOKEN" \
        "$API/api/v1/namespaces/$NS/configmaps/$MARKER_CM") || cm_code=000
      if [ "$cm_code" = "200" ] && \
         grep -qE '"completedRevision"[[:space:]]*:[[:space:]]*"'"$REVISION"'"' /tmp/state-cm.json; then
        echo "revision $REVISION migrations already completed (recorded in $MARKER_CM) — skipping"
        exit 0
      fi

      while [ "$(date +%s)" -lt "$deadline" ]; do
        code=$(curl -sS -o /tmp/job.json -w "%{http_code}" --connect-timeout 5 --max-time 15 \
          --cacert "$CACERT" -H "Authorization: Bearer $TOKEN" \
          "$API/apis/batch/v1/namespaces/$NS/jobs/$JOB") || code=000

        if [ "$code" = "404" ]; then
          elapsed=$(( $(date +%s) - started_at ))
          if [ "$elapsed" -gt 300 ]; then
            echo "migrations job $JOB not found after ${elapsed}s — job may not have been created yet or was already cleaned up" >&2
            exit 1
          fi
          echo "waiting for migrations job $JOB to be created (${elapsed}s elapsed)..."
          sleep 3
          continue
        fi

        if [ "$code" = "200" ]; then
          if grep -Eq '"succeeded"[[:space:]]*:[[:space:]]*[1-9]' /tmp/job.json; then
            echo "migrations job $JOB completed"
            patch_code=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
              --cacert "$CACERT" -H "Authorization: Bearer $TOKEN" \
              -X PATCH -H "Content-Type: application/merge-patch+json" \
              -d "{\"data\":{\"completedRevision\":\"$REVISION\"}}" \
              "$API/api/v1/namespaces/$NS/configmaps/$MARKER_CM") || patch_code=000
            if [ "$patch_code" != "200" ]; then
              echo "warning: failed to record completion in $MARKER_CM (HTTP $patch_code) — pod restarts will re-check the job" >&2
            fi
            exit 0
          fi

          if grep -qE '"reason"[[:space:]]*:[[:space:]]*"(BackoffLimitExceeded|DeadlineExceeded)"' /tmp/job.json; then
            echo "migrations job $JOB has permanently failed" >&2
            exit 1
          fi

          echo "migrations job $JOB is not complete yet"
          sleep 3
          continue
        fi

        echo "waiting for migrations job $JOB (HTTP $code)..."
        sleep 3
      done

      echo "timeout after ${TIMEOUT}s waiting for migrations job $JOB" >&2
      exit 1
{{- end -}}
{{- end -}}

{{/*
True when API pods should wait for infrastructure dependency endpoints.
*/}}
{{- define "api.waitDependenciesNeeded" -}}
{{- $dep := .Values.waitForDependencies -}}
{{- if and $dep.enabled (or $dep.postgres.enabled $dep.kafka.enabled $dep.opensearch.enabled $dep.minio.enabled $dep.redis.enabled) -}}
true
{{- end -}}
{{- end -}}

{{/*
Init container: wait for infrastructure dependency endpoints to be ready.
*/}}
{{- define "api.waitDependenciesInitContainer" -}}
{{- if not (include "api.waitDependenciesNeeded" . | trim) -}}
{{- else -}}
{{- $dep := .Values.waitForDependencies -}}
{{- $gs  := .Values.global.services | default dict -}}
{{- $pgSvc  := $dep.postgres.service   | default ($gs.postgresRw    | default "cn-postgres-rw") -}}
{{- $pgPort := $dep.postgres.port      | default ($gs.postgresPort  | default 5432) -}}
{{- /* Kafka: derive hostname from global.SENSA_KAFKA_BOOTSTRAP ("host:port") when not overridden */}}
{{- $kGlobal := first (splitList ":" (.Values.global.SENSA_KAFKA_BOOTSTRAP | default "invhub-kafka-bootstrap:9093")) -}}
{{- $kSvc   := $dep.kafka.service      | default ($gs.kafkaBootstrap  | default $kGlobal) -}}
{{- $kPort  := $dep.kafka.port         | default ($gs.kafkaPort        | default 9093) -}}
{{- /* OpenSearch: derive hostname from global.INVESTIGATION_HUB_OPEN_SEARCH_URL ("https://host:port") */}}
{{- $osUrl   := .Values.global.INVESTIGATION_HUB_OPEN_SEARCH_URL | default "https://opensearch-cluster-master:9200" -}}
{{- $osGlobal := first (splitList ":" ($osUrl | trimPrefix "https://" | trimPrefix "http://")) -}}
{{- $osSvc  := $dep.opensearch.service | default ($gs.opensearchMaster | default $osGlobal) -}}
{{- $osPort := $dep.opensearch.port    | default ($gs.opensearchPort   | default 9200) -}}
{{- $mSvc   := $dep.minio.service      | default ($gs.minio             | default "minio") -}}
{{- $mPort  := $dep.minio.port         | default ($gs.minioPort          | default 9000) -}}
{{- /* Redis: derive hostname from global.SENSA_REDIS_URL ("redis://host:port") */}}
{{- $rUrl   := .Values.global.SENSA_REDIS_URL | default "redis://redis-master:6379" -}}
{{- $rGlobal := first (splitList ":" ($rUrl | trimPrefix "redis://" | trimPrefix "rediss://")) -}}
{{- $rSvc   := $dep.redis.service      | default ($gs.redisMaster  | default $rGlobal) -}}
{{- $rPort  := $dep.redis.port         | default ($gs.redisPort    | default 6379) -}}
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
      {{- if $dep.opensearch.enabled }}
      wait_for_endpoint opensearch {{ $osSvc | quote }} {{ $osPort }}
      {{- end }}
      {{- if $dep.minio.enabled }}
      wait_for_endpoint minio {{ $mSvc | quote }} {{ $mPort }}
      {{- end }}
      {{- if $dep.redis.enabled }}
      wait_for_endpoint redis {{ $rSvc | quote }} {{ $rPort }}
      {{- end }}
      echo "all dependencies ready"
{{- end -}}
{{- end -}}