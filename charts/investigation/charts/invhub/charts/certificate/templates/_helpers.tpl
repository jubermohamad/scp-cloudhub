{{/*
Expand the name of the chart.
*/}}
{{- define "certificate.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Convert dots to dashes to create appropriate resource names.
*/}}
{{- define "certificate.convertHostToDashes" -}}
{{- .Values.host | replace "." "-" -}}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "certificate.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "certificate.labels" -}}
helm.sh/chart: {{ include "certificate.chart" . }}
{{ include "certificate.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "certificate.selectorLabels" -}}
app.kubernetes.io/name: {{ include "certificate.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
