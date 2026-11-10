{{/*
Expand the name of the chart.
*/}}
{{- define "web.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "web.fullname" -}}
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
{{- define "web.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "web.labels" -}}
helm.sh/chart: {{ include "web.chart" . }}
{{ include "web.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "web.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "web.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Generate a SHA-256 hash from String.
*/}}
{{- define "web.variableHash" -}}
{{- $ctx := index . 0 -}}
{{- $varName := index . 1 -}}
{{- $var := index $ctx.Values.global $varName -}}
{{- if $var -}}
{{- printf "%s" $var | trunc 64 -}}
{{- else -}}
{{- $basename := default "" (index $ctx.Values.global "basename") -}}
{{- $domain := default "" (index $ctx.Values.global "domain") -}}
{{- printf "%s%s" $basename $domain | sha256sum | trunc 64 -}}
{{- end -}}
{{- end -}}

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
