{{/* vim: set filetype=mustache: */}}
{{/*
Expand the name of the chart.
*/}}
{{- define "minio.name" -}}
  {{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "minio.fullname" -}}
  {{- if .Values.fullnameOverride -}}
    {{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
  {{- else -}}
    {{- $name := default .Chart.Name .Values.nameOverride -}}
    {{- if contains $name .Release.Name -}}
      {{- .Release.Name | trunc 63 | trimSuffix "-" -}}
    {{- else -}}
      {{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "minio.chart" -}}
  {{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for networkpolicy.
*/}}
{{- define "minio.networkPolicy.apiVersion" -}}
  {{- if semverCompare ">=1.4-0, <1.7-0" .Capabilities.KubeVersion.Version -}}
    {{- print "extensions/v1beta1" -}}
  {{- else if semverCompare ">=1.7-0, <1.16-0" .Capabilities.KubeVersion.Version -}}
    {{- print "networking.k8s.io/v1beta1" -}}
  {{- else if semverCompare "^1.16-0" .Capabilities.KubeVersion.Version -}}
    {{- print "networking.k8s.io/v1" -}}
  {{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for deployment.
*/}}
{{- define "minio.deployment.apiVersion" -}}
  {{- if semverCompare "<1.9-0" .Capabilities.KubeVersion.Version -}}
    {{- print "apps/v1beta2" -}}
  {{- else -}}
    {{- print "apps/v1" -}}
  {{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for statefulset.
*/}}
{{- define "minio.statefulset.apiVersion" -}}
  {{- if semverCompare "<1.16-0" .Capabilities.KubeVersion.Version -}}
    {{- print "apps/v1beta2" -}}
  {{- else -}}
    {{- print "apps/v1" -}}
  {{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for ingress.
*/}}
{{- define "minio.ingress.apiVersion" -}}
  {{- if semverCompare "<1.14-0" .Capabilities.KubeVersion.GitVersion -}}
    {{- print "extensions/v1beta1" -}}
  {{- else if semverCompare "<1.19-0" .Capabilities.KubeVersion.GitVersion -}}
    {{- print "networking.k8s.io/v1beta1" -}}
  {{- else -}}
    {{- print "networking.k8s.io/v1" -}}
  {{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for console ingress.
*/}}
{{- define "minio.consoleIngress.apiVersion" -}}
  {{- if semverCompare "<1.14-0" .Capabilities.KubeVersion.GitVersion -}}
    {{- print "extensions/v1beta1" -}}
  {{- else if semverCompare "<1.19-0" .Capabilities.KubeVersion.GitVersion -}}
    {{- print "networking.k8s.io/v1beta1" -}}
  {{- else -}}
    {{- print "networking.k8s.io/v1" -}}
  {{- end -}}
{{- end -}}

{{/*
Determine secret name.
*/}}
{{- define "minio.secretName" -}}
  {{- if .Values.existingSecret -}}
    {{- .Values.existingSecret }}
  {{- else -}}
    {{- include "minio.fullname" . -}}
  {{- end -}}
{{- end -}}

{{/*
Determine name for scc role and rolebinding
*/}}
{{- define "minio.sccRoleName" -}}
  {{- printf "%s-%s" "scc" (include "minio.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Properly format optional additional arguments to MinIO binary
*/}}
{{- define "minio.extraArgs" -}}
{{- range .Values.extraArgs -}}
{{ " " }}{{ . }}
{{- end -}}
{{- end -}}

{{/*
Formats volumeMount for MinIO TLS keys and trusted certs
*/}}
{{- define "minio.tlsKeysVolumeMount" -}}
{{- if .Values.tls.enabled }}
- name: cert-secret-volume
  mountPath: {{ .Values.certsPath }}
{{- end }}
{{- if or .Values.tls.enabled (ne .Values.trustedCertsSecret "") }}
{{- $casPath := printf "%s/CAs" .Values.certsPath | clean }}
- name: trusted-cert-secret-volume
  mountPath: {{ $casPath }}
{{- end }}
{{- end -}}

{{/*
Formats volume for MinIO TLS keys and trusted certs
*/}}
{{- define "minio.tlsKeysVolume" -}}
{{- if .Values.tls.enabled }}
- name: cert-secret-volume
  secret:
    secretName: {{ tpl .Values.tls.certSecret $ }}
    items:
    - key: {{ .Values.tls.publicCrt }}
      path: public.crt
    - key: {{ .Values.tls.privateKey }}
      path: private.key
{{- end }}
{{- if or .Values.tls.enabled (ne .Values.trustedCertsSecret "") }}
{{- $certSecret := eq .Values.trustedCertsSecret "" | ternary .Values.tls.certSecret .Values.trustedCertsSecret }}
{{- $publicCrt := eq .Values.trustedCertsSecret "" | ternary .Values.tls.publicCrt "" }}
- name: trusted-cert-secret-volume
  secret:
    secretName: {{ $certSecret }}
    {{- if ne $publicCrt "" }}
    items:
    - key: {{ $publicCrt }}
      path: public.crt
    {{- end }}
{{- end }}
{{- end -}}

{{/*
Returns the available value for certain key in an existing secret (if it exists),
otherwise it generates a random value.
*/}}
{{- define "minio.getValueFromSecret" }}
  {{- $len := (default 64 .Length) | int -}}
  {{- $obj := (lookup "v1" "Secret" .Namespace .Name).data -}}
  {{- if $obj }}
    {{- index $obj .Key | b64dec -}}
  {{- else -}}
    {{- randAlphaNum $len -}}
  {{- end -}}
{{- end }}

{{- define "minio.root.username" -}}
  {{- if .Values.rootUser }}
    {{- .Values.rootUser | toString }}
  {{- else }}
    {{- include "minio.getValueFromSecret" (dict "Namespace" .Release.Namespace "Name" (include "minio.fullname" .) "Length" 20 "Key" "rootUser") }}
  {{- end }}
{{- end -}}

{{- define "minio.root.password" -}}
  {{- if .Values.rootPassword }}
    {{- .Values.rootPassword | toString }}
  {{- else }}
    {{- include "minio.getValueFromSecret" (dict "Namespace" .Release.Namespace "Name" (include "minio.fullname" .) "Length" 64 "Key" "rootPassword") }}
  {{- end }}
{{- end -}}

{{- define "storage.pvc.annotations" }}
    {{- $ := index . 0 }}
    {{- $pvcType := index . 2 }}
    {{- $pvcStorageClass := index . 3 }}
    {{- $storageClassDefined := hasKey $.Values.global.pvc.annotations $pvcStorageClass  }}
    {{- if $storageClassDefined }}
    {{- $storageClassValue := get $.Values.global.pvc.annotations $pvcStorageClass }}
        {{- if $storageClassValue.annotations }}
            {{- if eq $pvcType "with-annotation-label" }}
annotations:
            {{- end }}
{{ toYaml $storageClassValue.annotations | indent 2 }}
        {{- end }}
    {{- end }}
{{- end }}

{{- define "minio.labels" -}}
helm.sh/chart: {{ include "minio.chart" . }}
{{ include "minio.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "minio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "minio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Replacement strings for launch templates
*/}}
{{- define "minio.templateReplacements" -}}
{{- $db := include "detectionhub.database" . | fromYaml }}
{{- if eq $db.ssl true }}
- name: "CERTS"
  value: {{ $db.sslSecret }}
- name: "CA_CERTS"
  value: {{ $db.sslCASecret }}
{{- end -}}
- name: "PROFILE_STORAGE"
  value: {{ .Values.global.pvc.profileStorage }}
- name: "DB_SECRET"
  value: {{ $db.existingSecret }}
- name: "DB_URL"
  value: {{ .Release.Name }}-config-secrets
{{- $pullSecretNames := list }}
{{- range ( .Values.global.imagePullSecrets | default list ) }}
{{- $pullSecretNames = append $pullSecretNames .name }}
{{- end }}
- name: PULL_SECRETS
  value: {{ join "\",\"" $pullSecretNames }}
- name: STORE_PVC
  value: {{ .Values.global.pvc.profileStorage }}
- name: EXT_API_SECRET
  value: {{ .Values.global.extApiSecret | default (printf "%s-core-api-ext-secrets" .Release.Name) }}
- name: EXT_API_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.extApiSecret | default (printf "%s-core-api-ext-secrets" .Release.Name) }}
      key: internal.url
- name: CORE_API_SECRET
  value: {{ .Values.global.coreApiSecret | default (printf "%s-core-api-secrets" .Release.Name) }}
- name: CORE_API_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.coreApiSecret | default (printf "%s-core-api-secrets" .Release.Name) }}
      key: internal.url
- name: KAFKA_URL
  value: {{ .Values.global.kafkaClusterName }}-kafka-bootstrap:9092
{{- end }}