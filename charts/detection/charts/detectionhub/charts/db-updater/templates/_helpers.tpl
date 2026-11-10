{{/*
Expand the name of the chart.
*/}}
{{- define "db-updater.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "db-updater.fullname" -}}
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
{{- define "db-updater.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "db-updater.labels" -}}
helm.sh/chart: {{ include "db-updater.chart" . }}
{{ include "db-updater.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: db-updater
app.kubernetes.io/part-of: detectionhub
{{- end }}

{{/*
Selector labels
*/}}
{{- define "db-updater.selectorLabels" -}}
app.kubernetes.io/name: {{ include "db-updater.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Get database URL
*/}}
{{- define "db-updater.dbUrl" -}}
{{- $db := include "detectionhub.database" . | fromYaml }}
{{- if eq $db.ssl true }}
{{- printf "jdbc:postgresql://%s:%d/%s?ssl=true&sslmode=%s&sslrootcert=/cacertificates/ca.crt&sslcert=/certificates/tls.crt&sslkey=/certificates/tls.key" $db.host (int $db.port) $db.name $db.sslMode -}}
{{- else }}
{{- printf "jdbc:postgresql://%s:%d/%s" $db.host (int $db.port) $db.name -}}
{{- end }}
{{- end }}