{{- define "global.validation" -}}
{{- $_ := required ".Values.global.domain or .Values.global.DOMAIN required ! " (include "global.domain" .) }}
{{- $_ := required ".Values.global.basename or .Values.global.BASENAME required ! " (include "global.basename" .) }}
{{- if and .Values.api.enabled (index .Values.tags "separate-api-responsibilities") -}}
{{- fail "api.enabled must be false when tags.separate-api-responsibilities=true; set api.enabled=false to use role-based containers" -}}
{{- end -}}
{{- end }}

{{/*
Backward compatible helper functions for global configuration keys
Each function checks for the new camelCase key first, then falls back to the old SCREAMING_SNAKE_CASE key
*/}}

{{- define "global.googleMapsApiKey" -}}
{{- .Values.global.googleMapsApiKey | default .Values.global.INVHUB_GOOGLE_MAPS_API_KEY -}}
{{- end }}

{{- define "global.remoteDataDbType" -}}
{{- .Values.global.remoteDataDbType | default .Values.global.REMOTE_DATA_DB_TYPE -}}
{{- end }}

{{- define "global.remoteDataDbHost" -}}
{{- .Values.global.remoteDataDbHost | default .Values.global.REMOTE_DATA_DB_HOST -}}
{{- end }}

{{- define "global.remoteDataDbName" -}}
{{- .Values.global.remoteDataDbName | default .Values.global.REMOTE_DATA_DB_NAME -}}
{{- end }}

{{- define "global.remoteDataDbPort" -}}
{{- .Values.global.remoteDataDbPort | default .Values.global.REMOTE_DATA_DB_PORT -}}
{{- end }}

{{- define "global.remoteDataDbUsername" -}}
{{- .Values.global.remoteDataDbUsername | default .Values.global.REMOTE_DATA_DB_USERNAME -}}
{{- end }}

{{- define "global.remoteDataDbPassword" -}}
{{- .Values.global.remoteDataDbPassword | default .Values.global.REMOTE_DATA_DB_PASSWORD -}}
{{- end }}

{{- define "global.remoteDataDbUseSsl" -}}
{{- .Values.global.remoteDataDbUseSsl | default .Values.global.REMOTE_DATA_DB_USE_SSL -}}
{{- end }}

{{- define "global.remoteDataDbSslSelfSigned" -}}
{{- .Values.global.remoteDataDbSslSelfSigned | default .Values.global.REMOTE_DATA_DB_SSL_SELF_SIGNED -}}
{{- end }}

{{- define "global.emailFrom" -}}
{{- .Values.global.emailFrom | default .Values.global.EMAIL_FROM -}}
{{- end }}

{{- define "global.emailHost" -}}
{{- .Values.global.emailHost | default .Values.global.EMAIL_HOST -}}
{{- end }}

{{- define "global.emailPort" -}}
{{- .Values.global.emailPort | default .Values.global.EMAIL_PORT -}}
{{- end }}

{{- define "global.emailUsername" -}}
{{- .Values.global.emailUsername | default .Values.global.EMAIL_USERNAME -}}
{{- end }}

{{- define "global.emailFromName" -}}
{{- .Values.global.emailFromName | default .Values.global.EMAIL_FROM_NAME -}}
{{- end }}

{{- define "global.emailPassword" -}}
{{- .Values.global.emailPassword | default .Values.global.SENSA_EMAIL_PASSWORD -}}
{{- end }}

{{- define "global.pendoAccountId" -}}
{{- .Values.global.pendoAccountId | default .Values.global.INVHUB_PENDO_ACCOUNTID -}}
{{- end }}

{{- define "global.pendoApiKey" -}}
{{- .Values.global.pendoApiKey | default .Values.global.INVHUB_PENDO_API_KEY -}}
{{- end }}

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

{{/*
Migration job name — unique per Helm revision so each upgrade/rollback creates a new
Job rather than patching the immutable existing one. Must match api.migrationJobName.
*/}}
{{- define "invhub.migrationJobName" -}}
{{- printf "%s-api-migrations-%d" .Release.Name .Release.Revision | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Resolves TLS CA secret names for the migration job.
Priority:
  1. migrations.*.secretName non-empty            — explicit operator override
  2. tags.separate-api-responsibilities=true      → api-for-ui.*.secretName
  3. default                                      → api.*.secretName
*/}}
{{- define "invhub.migrations.dbCertName" -}}
{{- $m := .Values.migrations -}}
{{- if ne $m.dbRootCert.secretName "" -}}
{{- $m.dbRootCert.secretName -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $cert := index $src "dbRootCert" | default dict -}}
{{- index $cert "secretName" | default "" -}}
{{- else -}}
{{- $src := .Values.api | default dict -}}
{{- $cert := index $src "dbRootCert" | default dict -}}
{{- index $cert "secretName" | default "" -}}
{{- end -}}
{{- end }}

{{- define "invhub.migrations.kafkaCertName" -}}
{{- $m := .Values.migrations -}}
{{- if ne $m.kafkaRootCert.secretName "" -}}
{{- $m.kafkaRootCert.secretName -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $cert := index $src "kafkaRootCert" | default dict -}}
{{- index $cert "secretName" | default "" -}}
{{- else -}}
{{- $src := .Values.api | default dict -}}
{{- $cert := index $src "kafkaRootCert" | default dict -}}
{{- index $cert "secretName" | default "" -}}
{{- end -}}
{{- end }}

{{- define "invhub.migrations.osCertName" -}}
{{- $m := .Values.migrations -}}
{{- if ne $m.osRootCert.secretName "" -}}
{{- $m.osRootCert.secretName -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $cert := index $src "osRootCert" | default dict -}}
{{- index $cert "secretName" | default "" -}}
{{- else -}}
{{- $src := .Values.api | default dict -}}
{{- $cert := index $src "osRootCert" | default dict -}}
{{- index $cert "secretName" | default "" -}}
{{- end -}}
{{- end }}

{{/*
Resolves the cert mountPath for the migration job.
Priority:
  1. migrations.*.mountPath non-empty             → explicit override for migrations only
  2. tags.separate-api-responsibilities=true      → api-for-ui.*.mountPath
  3. default                                      → api.*.mountPath
*/}}
{{- define "invhub.migrations.dbCertMount" -}}
{{- $m := .Values.migrations -}}
{{- if ne $m.dbRootCert.mountPath "" -}}
{{- $m.dbRootCert.mountPath -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $cert := index $src "dbRootCert" | default dict -}}
{{- index $cert "mountPath" | default "" -}}
{{- else -}}
{{- $src := .Values.api | default dict -}}
{{- $cert := index $src "dbRootCert" | default dict -}}
{{- index $cert "mountPath" | default "" -}}
{{- end -}}
{{- end }}

{{- define "invhub.migrations.kafkaCertMount" -}}
{{- $m := .Values.migrations -}}
{{- if ne $m.kafkaRootCert.mountPath "" -}}
{{- $m.kafkaRootCert.mountPath -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $cert := index $src "kafkaRootCert" | default dict -}}
{{- index $cert "mountPath" | default "" -}}
{{- else -}}
{{- $src := .Values.api | default dict -}}
{{- $cert := index $src "kafkaRootCert" | default dict -}}
{{- index $cert "mountPath" | default "" -}}
{{- end -}}
{{- end }}

{{- define "invhub.migrations.osCertMount" -}}
{{- $m := .Values.migrations -}}
{{- if ne $m.osRootCert.mountPath "" -}}
{{- $m.osRootCert.mountPath -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $cert := index $src "osRootCert" | default dict -}}
{{- index $cert "mountPath" | default "" -}}
{{- else -}}
{{- $src := .Values.api | default dict -}}
{{- $cert := index $src "osRootCert" | default dict -}}
{{- index $cert "mountPath" | default "" -}}
{{- end -}}
{{- end }}

{{/*
Resolves the container image repository, tag, and pull policy for the migration job.
Priority for each field:
  1. migrations.image.*                         — explicit override
  2. tags.separate-api-responsibilities=true  → api-for-ui.image.*
  3. default                                  → api.image.*
  4. tag only: .Chart.AppVersion              — final fallback
*/}}
{{- define "invhub.migrations.imageRepository" -}}
{{- $m := .Values.migrations -}}
{{- if ne ($m.image.repository | default "") "" -}}
{{- $m.image.repository -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $img := index $src "image" | default dict -}}
{{- $repo := index $img "repository" | default "" -}}
{{- if ne $repo "" -}}
{{- $repo -}}
{{- else -}}
{{- .Values.api.image.repository -}}
{{- end -}}
{{- else -}}
{{- .Values.api.image.repository -}}
{{- end -}}
{{- end }}

{{- define "invhub.migrations.imageTag" -}}
{{- $m := .Values.migrations -}}
{{- if ne ($m.image.tag | default "") "" -}}
{{- $m.image.tag -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $img := index $src "image" | default dict -}}
{{- $tag := index $img "tag" | default "" -}}
{{- if ne $tag "" -}}
{{- $tag -}}
{{- else -}}
{{- .Values.api.image.tag | default .Chart.AppVersion -}}
{{- end -}}
{{- else -}}
{{- .Values.api.image.tag | default .Chart.AppVersion -}}
{{- end -}}
{{- end }}

{{- define "invhub.migrations.imagePullPolicy" -}}
{{- $m := .Values.migrations -}}
{{- if ne ($m.image.pullPolicy | default "") "" -}}
{{- $m.image.pullPolicy -}}
{{- else if index .Values.tags "separate-api-responsibilities" | default false -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $img := index $src "image" | default dict -}}
{{- $pull := index $img "pullPolicy" | default "" -}}
{{- if ne $pull "" -}}
{{- $pull -}}
{{- else -}}
{{- .Values.api.image.pullPolicy | default "" -}}
{{- end -}}
{{- else -}}
{{- .Values.api.image.pullPolicy | default "" -}}
{{- end -}}
{{- end }}

{{/*
Service name helpers — derive Kubernetes service names from infra sub-chart configuration.
Each helper follows a nil-safe index chain so disabled/absent sub-charts don't panic.
These are used by migration-job (parent-chart context) for the triple-fallback resolution:
  1. migrations.waitForDependencies.*.service  (explicit per-job override)
  2. global.services.*                         (shared operator override → flows to subcharts)
  3. these helpers                             (auto-derived from chart config)
*/}}

{{/* postgres RW service: cn-postgres.clusterName + "-rw" */}}
{{- define "invhub.postgresRwService" -}}
{{- $pg := index .Values "cn-postgres" | default dict -}}
{{- $name := index $pg "clusterName" | default "cn-postgres" -}}
{{- printf "%s-rw" $name -}}
{{- end -}}

{{/* kafka bootstrap service: kafka-cluster.name + "-kafka-bootstrap" */}}
{{- define "invhub.kafkaBootstrapService" -}}
{{- $kc := index .Values "kafka-cluster" | default dict -}}
{{- $name := index $kc "name" | default "invhub" -}}
{{- printf "%s-kafka-bootstrap" $name -}}
{{- end -}}

{{/* OpenSearch master service: opensearch.masterService */}}
{{- define "invhub.opensearchMasterService" -}}
{{- $os := index .Values "opensearch" | default dict -}}
{{- index $os "masterService" | default "opensearch-cluster-master" -}}
{{- end -}}

{{/* MinIO tenant service: minioop.tenant.name */}}
{{- define "invhub.minioTenantService" -}}
{{- $minioop := index .Values "minioop" | default dict -}}
{{- $tenant := index $minioop "tenant" | default dict -}}
{{- index $tenant "name" | default "minio" -}}
{{- end -}}

{{/* Redis master service: redis.fullnameOverride + "-master" */}}
{{- define "invhub.redisMasterService" -}}
{{- $redis := index .Values "redis" | default dict -}}
{{- $name := index $redis "fullnameOverride" | default "redis" -}}
{{- printf "%s-master" $name -}}
{{- end -}}

{{/*
Naming seam (SRI naming migration, invhub Step 2): per-component service-name
helpers, resolved straight from the sibling chart's own fullnameOverride
value (falling back to the literal name live today when unset). Only usable
from parent-chart-scoped templates (this file, configurator.yaml) — the
parent is the only context that can see sibling subchart values directly.
Deliberately NOT routed through global.services.*: that map propagates to
every subchart via Helm's global merge, including pgadmin4, whose
`checksum/pgadmin-values` (values.yaml) hashes its entire resolved Values —
so adding a key here would perturb that checksum (and force a pod restart)
for a component that has no relationship to api/interaction-engine naming.
Subchart-local templates that need these same names (disc-api, copilot,
reporting-dashboard, flows, ...) still only have their own literal fallback
for this reason — flagged in the migration report rather than wired here.
*/}}
{{- define "invhub.apiService" -}}
{{- .Values.api.fullnameOverride | default "api" -}}
{{- end -}}

{{- define "invhub.apiForUiService" -}}
{{- $src := index .Values "api-for-ui" | default dict -}}
{{- $src.fullnameOverride | default "api-for-ui" -}}
{{- end -}}

{{- define "invhub.interactionEngineService" -}}
{{- $src := index .Values "interaction-engine" | default dict -}}
{{- $src.fullnameOverride | default "invhub-interaction-engine" -}}
{{- end -}}

{{/*
Naming seam (SRI naming migration): configurator.yaml's own Job had no
override mechanism at all — metadata.name was the bare literal
"configurator". Resolves from config.fullnameOverride, falling back to
today's literal, so this chart's own default stays render-neutral; the
env-prefixed name (sri-<env>-investigation-configurator) is a deploy-values
override only, never a chart edit.
*/}}
{{- define "invhub.configuratorJobName" -}}
{{- .Values.config.fullnameOverride | default "configurator" -}}
{{- end -}}

{{/*
Returns the internal (cluster-local) base URL for the InvHub API — no trailing slash.
Auto-detects the correct service based on the active deployment topology:
  - global.separateApiResponsibilities=true OR api.enabled=false → http://api-for-ui:3001
  - default → http://api:3001
Set global.internalApiBaseUrl explicitly only to override the auto-detected value (e.g. a custom
port or hostname). Subcharts receive global.separateApiResponsibilities and global.internalApiBaseUrl
via Helm global propagation and use them directly for URL resolution.
*/}}
{{- define "global.internalApiBaseUrl" -}}
{{- if or (not .Values.api.enabled) (.Values.global.separateApiResponsibilities | default false) -}}
{{- .Values.global.internalApiBaseUrl | default (printf "http://%s:3001" (include "invhub.apiForUiService" .)) | trimSuffix "/" -}}
{{- else -}}
{{- .Values.global.internalApiBaseUrl | default (printf "http://%s:3001" (include "invhub.apiService" .)) | trimSuffix "/" -}}
{{- end -}}
{{- end }}
