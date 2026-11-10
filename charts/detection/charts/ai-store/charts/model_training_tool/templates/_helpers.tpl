{{- define "model-training-tool.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "model-training-tool.fullname" -}}
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
{{- end }}

{{- define "model-training-tool.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "model-training-tool.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "model-training-tool.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ default (include "model-training-tool.fullname" .) .Values.serviceAccount.name }}
{{- else -}}
{{ default "default" .Values.serviceAccount.name }}
{{- end -}}
{{- end }}

{{/*
In-cluster ai-store control-plane URL: http://{global.namePrefix}{global.componentNames.backend}:8000
(componentNames.backend defaults to "backend" — naming-migration seam, docs/NAMING-MIGRATION.md Step 2).
*/}}
{{- define "model-training-tool.aistoreControlPlaneUrl" -}}
{{- $g := .Values.global | default dict -}}
{{- $prefix := $g.namePrefix | default "" -}}
{{- $names := $g.componentNames | default dict -}}
{{- $backend := $names.backend | default "backend" -}}
{{- printf "http://%s%s:8000" $prefix $backend -}}
{{- end -}}
