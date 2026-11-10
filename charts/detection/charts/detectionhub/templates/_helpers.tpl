{{/*
Expand the name of the chart.
*/}}
{{- define "detectionhub.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "detectionhub.fullname" -}}
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
{{- define "detectionhub.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "detectionhub.labels" -}}
helm.sh/chart: {{ include "detectionhub.chart" . }}
{{ include "detectionhub.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: detectionhub
{{- end }}

{{/*
Selector labels
*/}}
{{- define "detectionhub.selectorLabels" -}}
app.kubernetes.io/name: {{ include "detectionhub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
DetectionHub solutions label: enumerates all solutions from global.SRIsolutions.
Use on Deployment/Job/StatefulSet metadata and pod template so every workload is labeled.
Label value is comma-separated list, truncated to 63 chars (Kubernetes limit).
*/}}
{{- define "detectionhub.detectionhubsolutionsLabel" -}}
{{- if .Values.global.SRIsolutions }}
SRIsolutions: {{ join "_" .Values.global.SRIsolutions | trunc 63 }}
{{- end }}
{{- end }}

{{/*
Create the name of a component
*/}}
{{- define "detectionhub.componentName" -}}
{{- $name := include "detectionhub.fullname" . -}}
{{- $component := default "component" .component -}}
{{- printf "%s-%s" $name $component | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Return the proper Docker Image Registry Secret Names
*/}}
{{- define "detectionhub.imagePullSecrets" -}}
{{/*
Helm 2.11 supports the assignment of a value to a variable defined in a different scope,
but Helm 2.9 and 2.10 does not support it, so we need to implement this if-else logic.
Also, we can not use a single if because lazy evaluation is not an option
*/}}
{{- if .Values.global }}
{{- if .Values.global.imagePullSecrets }}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2}}
{{- end }}
{{- else if .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml .Values.imagePullSecrets | nindent 2 }}
{{- end -}}
{{- else if .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml .Values.imagePullSecrets | nindent 2 }}
{{- end -}}
{{- end -}}

{{/*
Database configuration helper
*/}}
{{- define "detectionhub.database" -}}
{{- $db := .Values.global.database | default dict }}
{{- $dbssl := .Values.global.database.ssl | default dict }}
{{- $dbcred := .Values.global.database.credentials | default dict }}
{{ if hasKey .Values "database" }}
host: {{ .Values.database.host | default $db.host | default "localhost" }}
port: {{ .Values.database.port | default $db.port | default 5432 }}
name: {{ .Values.database.name | default $db.database | default "app" }}
user: {{ .Values.database.user | default $db.username | default "app" }}
ssl: {{ if ( hasKey .Values.database "ssl" ) }} {{ .Values.database.ssl.enabled | default false }} {{ else }} {{ $dbssl.enabled | default false }} {{ end }}
sslMode: {{ if ( hasKey .Values.database "ssl" ) }} {{ .Values.database.ssl.mode | default "verify-full" }} {{ else }} {{ $dbssl.mode | default "verify-full" }} {{ end }}
sslSecret: {{ if ( hasKey .Values.database "ssl" ) }} {{ .Values.database.ssl.secretName | default "" }} {{ else }} {{ $dbssl.secretName | default "" }} {{ end }}
sslCASecret: {{ if ( hasKey .Values.database "ssl" ) }} {{ .Values.database.ssl.secretCAName | default "" }} {{ else }} {{ $dbssl.secretCAName | default "" }} {{ end }}
existingSecret: {{ if ( hasKey .Values.database "credentials" ) }} {{ .Values.database.credentials.existingSecret | default $dbcred.secretName | default "" }} {{ else }} {{ $dbcred.secretName | default "" }} {{ end }}
secretKey: {{ if ( hasKey .Values.database "credentials" ) }} {{ .Values.database.credentials.secretKey | default $dbcred.secretKey | default "" }} {{ else }} {{ $dbcred.secretKey | default "" }} {{ end }}
{{- else }}
host: {{ $db.host | default "localhost" }}
port: {{ $db.port | default 5432 }}
name: {{ $db.database | default "app" }}
user: {{ $db.username | default "app" }}
ssl: {{ $dbssl.enabled | default false }}
sslMode: {{ $dbssl.mode | default false }}
sslSecret: {{ $dbssl.secretName | default "" }}
sslCASecret: {{ $dbssl.secretCAName | default "" }}
existingSecret: {{ $dbcred.secretName | default "" }}
secretKey: {{ $dbcred.secretKey | default "" }}
{{- end }}
{{- end }}

{{/*
Get database URL for tomcat
*/}}
{{- define "detectionhub.dbUrlTomcat" -}}
{{- $db := include "detectionhub.database" . | fromYaml }}
{{- if eq $db.ssl true }}
{{- printf "jdbc:postgresql://%s:%d/%s?ssl=true\\&amp;sslmode=%s\\&amp;sslrootcert=/cacertificates/ca.crt\\&amp;sslcert=/certificates/tls.crt\\&amp;sslkey=/certificates/tls.key" $db.host (int $db.port) $db.name $db.sslMode -}}
{{- else }}
{{- printf "jdbc:postgresql://%s:%d/%s" $db.host (int $db.port) $db.name -}}
{{- end }}
{{- end }}

{{/*
Modelhub secret
*/}}
{{- define "detectionhub.modelHub" -}}
{{- $global := .Values.global.modelhub | default dict }}
{{ if hasKey .Values "modelhub" }}
enabled: true
existingSecretName: {{ .Values.modelhub.existingSecretName | default $global.existingSecretName | default "" }}
existingSecretUrl: {{ .Values.modelhub.existingSecretUrl | default $global.existingSecretUrl | default "" }}
existingSecretKey: {{ .Values.modelhub.existingSecretKey | default $global.existingSecretKey | default "" }}
{{- else }}
enabled: {{ hasKey .Values.global "modelhub" }}
existingSecretName: {{ $global.existingSecretName | default "" }}
existingSecretUrl: {{ $global.existingSecretUrl | default "" }}
existingSecretKey: {{ $global.existingSecretKey | default "" }}
{{- end }}
{{- end }}


{{/*
Trainingtool secret
*/}}
{{- define "detectionhub.trainingTool" -}}
{{- $global := .Values.global.trainingtool | default dict }}
{{ if hasKey .Values "trainingtool" }}
enabled: true
existingSecretName: {{ .Values.trainingtool.existingSecretName | default $global.existingSecretName | default "" }}
existingSecretMinioId: {{ .Values.trainingtool.existingSecretMinioId | default $global.existingSecretMinioId | default "" }}
existingSecretMinioUrl: {{ .Values.trainingtool.existingSecretMinioUrl | default $global.existingSecretMinioUrl | default "" }}
existingSecretMinioKey: {{ .Values.trainingtool.existingSecretMinioKey | default $global.existingSecretMinioKey | default "" }}
existingSecretMinioBucket: {{ .Values.trainingtool.existingSecretMinioBucket | default $global.existingSecretMinioBucket | default "" }}
existingSecretTTUrl: {{ .Values.trainingtool.existingSecretTTUrl | default $global.existingSecretTTUrl | default "" }}
existingSecretTTToken: {{ .Values.trainingtool.existingSecretTTToken | default $global.existingSecretTTToken | default "" }}
{{- else }}
enabled: {{ hasKey .Values.global "trainingtool" }}
existingSecretName: {{ $global.existingSecretName | default "" }}
existingSecretMinioId: {{ $global.existingSecretMinioId | default "" }}
existingSecretMinioUrl: {{ $global.existingSecretMinioUrl | default "" }}
existingSecretMinioKey: {{ $global.existingSecretMinioKey | default "" }}
existingSecretMinioBucket: {{ $global.existingSecretMinioBucket | default "" }}
existingSecretTTUrl: {{ $global.existingSecretTTUrl | default "" }}
existingSecretTTToken: {{ $global.existingSecretTTToken | default "" }}
{{- end }}
{{- end }}