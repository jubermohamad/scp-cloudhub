{{- define "model-store.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "model-store.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "model-store.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "model-store.labels" -}}
app.kubernetes.io/name: {{ include "model-store.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}

{{- define "model-store.namespace" -}}
{{- if .Values.namespaceOverride -}}
{{- .Values.namespaceOverride -}}
{{- else -}}
{{- .Release.Namespace -}}
{{- end -}}
{{- end -}}

{{- define "model-store.defaultNamespace" -}}
{{- if .Values.singleNamespace.defaultNamespace -}}
{{- .Values.singleNamespace.defaultNamespace -}}
{{- else -}}
{{- include "model-store.namespace" . -}}
{{- end -}}
{{- end -}}

{{/*
in-tree patch (P5): the in-cluster S3 endpoint URL for every MinIO consumer
(mlflow-s3-endpoint-url, zot's storageDriver.regionendpoint, the zot bucket
job). internalServices.minio.url wins; otherwise the bundled MinIO's own
Service. Every consumer MUST go through this so a shared/platform object store
is a one-value change.
*/}}
{{- define "model-store.minioEndpoint" -}}
{{- $is := .Values.internalServices | default dict -}}
{{- $m  := index $is "minio" | default dict -}}
{{- with index $m "url" -}}
{{- . -}}
{{- else -}}
{{- printf "http://%s:9000" (.Values.minio.fullnameOverride | default "minio") -}}
{{- end -}}
{{- end -}}

{{/*
in-tree patch (naming migration): in-cluster MLflow tracking endpoint. Was the
bare literal "http://mlflow-tracking:5000" in shared-secrets.yaml, which is the
mlflow subchart's fullnameOverride spelled a second time — so renaming MLflow
left modelhub-secrets pointing at a Service that no longer exists, and nothing
failed at render. Same shape as model-store.minioEndpoint above.
*/}}
{{- define "model-store.mlflowEndpoint" -}}
{{- $is := .Values.internalServices | default dict -}}
{{- $m  := index $is "mlflow" | default dict -}}
{{- with index $m "url" -}}
{{- . -}}
{{- else -}}
{{- printf "http://%s:5000" ((.Values.mlflow | default dict).fullnameOverride | default "mlflow-tracking") -}}
{{- end -}}
{{- end -}}

{{/*
in-tree patch: per-component name override seam (naming-migration Step 2 —
"one naming helper per chart, default = current name", docs/NAMING-MIGRATION.md).
$component is still the literal call-site string used as the dict key AND as
the fallback value, so componentNames unset (or a component missing from it)
renders byte-identical to the old "%s%s" namePrefix+component form.
*/}}
{{- define "model-store.componentName" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{- $names := $root.Values.componentNames | default dict -}}
{{- $resolved := index $names $component | default $component -}}
{{- printf "%s%s" (default "" $root.Values.namePrefix) $resolved -}}
{{- end -}}

{{/*
When global.rolloutOnHelmUpgrade is true, add these lines under pod template metadata.annotations so every
helm upgrade changes the pod spec (new ReplicaSet) even if image.repository:tag is unchanged — required
for :latest plus imagePullPolicy: Always to actually pull on upgrade.
*/}}
{{- define "model-store.helmRolloutPodAnnotations" -}}
{{- $g := .Values.global | default dict -}}
{{- if $g.rolloutOnHelmUpgrade }}
modelhub.dev/helm-release-revision: {{ .Release.Revision | quote }}
modelhub.dev/helm-release-name: {{ .Release.Name | quote }}
{{- end }}
{{- end -}}

{{- define "model-store.modelhubTlsSecret" -}}
{{- if .Values.domain.modelhubTlsSecret -}}
{{- .Values.domain.modelhubTlsSecret -}}
{{- else -}}
{{- .Values.domain.tlsSecret -}}
{{- end -}}
{{- end -}}

{{- define "model-store.mcpTlsSecret" -}}
{{- if .Values.domain.mcpTlsSecret -}}
{{- .Values.domain.mcpTlsSecret -}}
{{- else -}}
{{- .Values.domain.tlsSecret -}}
{{- end -}}
{{- end -}}

{{/*
Strip scheme/path from domain.zotRegistryHost for parsing (may include :port).
*/}}
{{- define "model-store.zotPublicRegistryHostRaw" -}}
{{- .Values.domain.zotRegistryHost | default "" | trim | replace "https://" "" | replace "http://" "" | trimSuffix "/" -}}
{{- end -}}

{{/*
TLS/Ingress host rule only (no port). Empty if domain.zotRegistryHost unset.
*/}}
{{- define "model-store.zotPublicRegistryHostname" -}}
{{- $raw := include "model-store.zotPublicRegistryHostRaw" . | trim -}}
{{- if $raw -}}
{{- if contains ":" $raw -}}
{{- index (splitList ":" $raw) 0 -}}
{{- else -}}
{{- $raw -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Host[:port] for Zot in image refs and ZOT_REGISTRY_URL (no scheme).
1) zot.registryUrlOverride if set
2) else domain.zotRegistryHost (public DNS; HTTPS on 443 when no port — kubelet-friendly on AKS)
3) else in-cluster Service FQDN:port
*/}}
{{- define "model-store.zotRegistryHost" -}}
{{- if .Values.zot.registryUrlOverride -}}
{{- .Values.zot.registryUrlOverride -}}
{{- else -}}
{{- $raw := include "model-store.zotPublicRegistryHostRaw" . | trim -}}
{{- if $raw -}}
{{- $raw -}}
{{- else -}}
{{- $zh := .Values.zot.fullnameOverride | default "zot" -}}
{{- $zp := .Values.zot.service.port | default 5000 -}}
{{- $zns := include "model-store.namespace" . -}}
{{- printf "%s.%s.svc.cluster.local:%v" $zh $zns $zp -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Namespace for deployed model/agent/MCP workloads (from global.secrets or singleNamespace default).
*/}}
{{- define "model-store.modelsNamespace" -}}
{{- if .Values.global.secrets.modelsNamespace -}}
{{- .Values.global.secrets.modelsNamespace -}}
{{- else -}}
{{- include "model-store.defaultNamespace" . -}}
{{- end -}}
{{- end -}}

{{/*
Zot registry username: zot.auth.username override, else internalServices.secrets.zotRegistryUser, else zot-user.
*/}}
{{- define "model-store.zotAuthUsername" -}}
{{- $override := .Values.zot.auth.username | default "" | trim -}}
{{- if $override -}}
{{- $override -}}
{{- else -}}
{{- index .Values "internalServices" "secrets" "zotRegistryUser" | default "zot-user" | trim -}}
{{- end -}}
{{- end -}}

{{/*
Zot registry password: zot.auth.password override, else internalServices.secrets.zotRegistryPassword.
*/}}
{{- define "model-store.zotAuthPassword" -}}
{{- $override := .Values.zot.auth.password | default "" | trim -}}
{{- if $override -}}
{{- $override -}}
{{- else -}}
{{- index .Values "internalServices" "secrets" "zotRegistryPassword" | default "" | trim -}}
{{- end -}}
{{- end -}}

{{/*
Kubernetes Secret data map for zot-auth (base64 values; toYaml avoids #/$ in passwords breaking YAML).
*/}}
{{- define "model-store.zotAuthSecretData" -}}
{{- $user := include "model-store.zotAuthUsername" . -}}
{{- $pass := required "internalServices.secrets.zotRegistryPassword (or zot.auth.password) is required when zot.auth.enabled" (include "model-store.zotAuthPassword" .) -}}
{{- dict "htpasswd" (htpasswd $user $pass | b64enc) "ZOT_REGISTRY_USERNAME" ($user | b64enc) "ZOT_REGISTRY_PASSWORD" ($pass | b64enc) | toYaml -}}
{{- end -}}

{{/*
Kubernetes Secret data map for zot-registry-pull (.dockerconfigjson).
*/}}
{{- define "model-store.zotPullSecretData" -}}
{{- dict ".dockerconfigjson" (include "model-store.zotDockerConfigJson" . | b64enc) | toYaml -}}
{{- end -}}

{{/*
Zot htpasswd auth Secret name (templates/zot-auth.yaml).
*/}}
{{- define "model-store.zotAuthSecretName" -}}
{{- .Values.zot.auth.secretName | default "zot-auth" -}}
{{- end -}}

{{/*
Docker registry pull Secret name for kubelet (templates/zot-auth.yaml).
*/}}
{{- define "model-store.zotPullSecretName" -}}
{{- .Values.zot.auth.pullSecretName | default "zot-registry-pull" -}}
{{- end -}}

{{/*
.dockerconfigjson body for Zot registry auth (keyed by model-store.zotRegistryHost).
*/}}
{{- define "model-store.zotDockerConfigJson" -}}
{{- $host := include "model-store.zotRegistryHost" . | trim -}}
{{- $user := include "model-store.zotAuthUsername" . -}}
{{- $pass := required "internalServices.secrets.zotRegistryPassword (or zot.auth.password) is required when zot.auth.enabled" (include "model-store.zotAuthPassword" .) -}}
{{- $auth := printf "%s:%s" $user $pass | b64enc -}}
{{- dict "auths" (dict $host (dict "username" $user "password" $pass "auth" $auth)) | toJson -}}
{{- end -}}

{{/*
ACR registry host (no scheme) from global.secrets.acrUrl.
*/}}
{{- define "model-store.acrHost" -}}
{{- .Values.global.secrets.acrUrl | replace "https://" "" | replace "http://" "" | trim -}}
{{- end -}}

{{/*
.dockerconfigjson body for ACR image pulls (keyed by model-store.acrHost).
*/}}
{{- define "model-store.acrDockerConfigJson" -}}
{{- $host := required "global.secrets.acrUrl is required when global.manageImagePullSecrets is true" (include "model-store.acrHost" .) -}}
{{- $user := required "global.secrets.acrUsername is required when global.manageImagePullSecrets is true" .Values.global.secrets.acrUsername -}}
{{- $pass := required "global.secrets.acrPassword is required when global.manageImagePullSecrets is true" .Values.global.secrets.acrPassword -}}
{{- $auth := printf "%s:%s" $user $pass | b64enc -}}
{{- dict "auths" (dict $host (dict "username" $user "password" $pass "auth" $auth)) | toJson -}}
{{- end -}}

{{/*
Kubernetes Secret data map for ACR docker pull secrets (.dockerconfigjson).
*/}}
{{- define "model-store.acrPullSecretData" -}}
{{- dict ".dockerconfigjson" (include "model-store.acrDockerConfigJson" . | b64enc) | toYaml -}}
{{- end -}}

{{/*
Pod imagePullSecrets from global.imagePullSecrets.
Supports both {name: ...} objects and bare string names (same as backend/frontend).
*/}}
{{- define "model-store.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- range . }}
  - name: {{ .name | default . }}
  {{- end }}
{{- end }}
{{- end -}}

{{/*
Zot http block (JSON) for config.json: compat docker2s2 + optional TLS + optional htpasswd auth.
*/}}
{{- define "model-store.zotHttpJson" -}}
{{- $http := dict "address" "0.0.0.0" "port" "5000" "compat" (list "docker2s2") -}}
{{- if .Values.zot.tls.enabled -}}
{{- $cert := printf "%s/%s" .Values.zot.tls.mountPath .Values.zot.tls.certFile -}}
{{- $key := printf "%s/%s" .Values.zot.tls.mountPath .Values.zot.tls.keyFile -}}
{{- $_ := set $http "tls" (dict "cert" $cert "key" $key) -}}
{{- end -}}
{{- if .Values.zot.auth.enabled -}}
{{- $_ := set $http "auth" (dict
    "htpasswd" (dict "path" (.Values.zot.auth.htpasswd.path | default "/etc/zot/auth/htpasswd"))
    "failDelay" (.Values.zot.auth.failDelay | default 5)
) -}}
{{- end -}}
{{- $http | toJson -}}
{{- end -}}

{{/*
Zot registry config: S3/MinIO + optional Redis cacheDriver for dedupe (requires .Values.redis.enabled).
Subchart ConfigMap is disabled via zot.configFiles: false so this parent ConfigMap supplies {{ .Release.Name }}-config.
*/}}
{{- define "model-store.zotConfigJson" }}
{{- $minioEp := include "model-store.minioEndpoint" . }}
{{- $bucket := .Values.zot.s3Bucket | default "zot-oci" }}
{{- $redisHost := include "model-store.componentName" (list . "redis") }}
{{- /* in-tree patch: zot.redisCacheUrl points the dedupe cache at an
     external/shared Redis when the bundled one is disabled */}}
{{- $redisUrl := .Values.zot.redisCacheUrl | default (printf "redis://%s:6379/1" $redisHost) }}
{{- if or .Values.redis.enabled .Values.zot.redisCacheUrl }}
{
  "distSpecVersion": "1.1.0",
  "storage": {
    "rootDirectory": "/var/lib/registry",
    "dedupe": true,
    "cacheDriver": {
      "name": "redis",
      "url": {{ $redisUrl | quote }},
      "keyprefix": "zot"
    },
    "storageDriver": {
      "name": "s3",
      "region": "us-east-1",
      "regionendpoint": {{ $minioEp | quote }},
      "bucket": {{ $bucket | quote }},
      "rootdirectory": "/zot",
      "encrypt": false,
      "secure": false,
      "forcepathstyle": true
    }
  },
  "http": {{ include "model-store.zotHttpJson" . }},
  "log": { "level": "info" }
}
{{ else }}
{
  "distSpecVersion": "1.1.0",
  "storage": {
    "rootDirectory": "/var/lib/registry",
    "dedupe": false,
    "storageDriver": {
      "name": "s3",
      "region": "us-east-1",
      "regionendpoint": {{ $minioEp | quote }},
      "bucket": {{ $bucket | quote }},
      "rootdirectory": "/zot",
      "encrypt": false,
      "secure": false,
      "forcepathstyle": true
    }
  },
  "http": {{ include "model-store.zotHttpJson" . }},
  "log": { "level": "info" }
}
{{- end }}
{{- end }}

{{/* nginx.ingress.kubernetes.io/add-headers: namespace/name — ConfigMaps rendered in ingress-headers-configmaps.yaml */}}
{{- define "model-store.ingressAddHeadersAuthRef" -}}
{{- printf "%s/%s" (include "model-store.namespace" .) (printf "%s-ingress-hdr-auth" (include "model-store.fullname" .)) -}}
{{- end -}}
{{- define "model-store.ingressAddHeadersMcpRef" -}}
{{- printf "%s/%s" (include "model-store.namespace" .) (printf "%s-ingress-hdr-mcp" (include "model-store.fullname" .)) -}}
{{- end -}}
{{- define "model-store.ingressAddHeadersAppRef" -}}
{{- printf "%s/%s" (include "model-store.namespace" .) (printf "%s-ingress-hdr-app" (include "model-store.fullname" .)) -}}
{{- end -}}

{{/*
in-tree patch: single source of truth for the Redis URL. Uses
global.secrets.redisUrl when set (external/shared Redis, e.g.
redis://sri-redis-master.<ns>.svc.cluster.local:6379/0), otherwise the
bundled redis component. backend/celery/celery-beat REDIS_URL,
CELERY_BROKER_URL, CELERY_RESULT_BACKEND and the celery exporter all
previously hardcoded the component name.
*/}}
{{- define "model-store.redisUrl" -}}
{{- .Values.global.secrets.redisUrl | default (printf "redis://%s:6379/0" (include "model-store.componentName" (list . "redis"))) -}}
{{- end -}}
