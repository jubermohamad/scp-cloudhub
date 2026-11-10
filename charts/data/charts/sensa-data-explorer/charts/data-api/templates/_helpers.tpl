{{- define "data-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "data-api.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{/* platform naming convention: <release>-data-explorer-<component> */}}
{{- printf "%s-data-explorer-api" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "data-api.labels" -}}
app.kubernetes.io/name: {{ include "data-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "data-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "data-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "data-api.secretName" -}}
{{- if .Values.database.existingSecret -}}
{{- .Values.database.existingSecret -}}
{{- else -}}
{{- printf "%s-db" (include "data-api.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "data-api.writeStore.secretName" -}}
{{- if .Values.writeStore.existingSecret -}}
{{- .Values.writeStore.existingSecret -}}
{{- else -}}
{{- printf "%s-write-db" (include "data-api.fullname" .) -}}
{{- end -}}
{{- end -}}
