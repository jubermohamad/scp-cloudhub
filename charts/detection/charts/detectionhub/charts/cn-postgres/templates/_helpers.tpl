{{/*
Expand the name of the chart.
*/}}
{{- define "cn-postgres.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "cn-postgres.fullname" -}}
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
{{- define "cn-postgres.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "cn-postgres.labels" -}}
helm.sh/chart: {{ include "cn-postgres.chart" . }}
{{ include "cn-postgres.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "cn-postgres.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cn-postgres.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Get database configuration from global settings
*/}}
{{- define "cn-postgres.config" -}}
{{- if .Values.bootstrap }}
{{- with .Values.bootstrap }}
  bootstrap:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- else }}
bootstrap:
  initdb:
    database: {{ .Values.global.database.database }}
    owner: {{ .Values.global.database.username }}
{{- end }}
{{- end }}