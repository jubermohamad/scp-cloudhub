{{/*
P10: platform-local copies of the three helpers this chart used to inherit from
its old PARENT (detectionhub). The chart now renders from `common`, which in
multi-namespace mode is a release WITHOUT detectionhub — the inherited helpers
would simply not exist and the render would fail.

RENAMED rather than copied under the original names on purpose: Helm template
helper names are GLOBAL PER RELEASE, so re-defining `detectionhub.*` here would
silently override detectionhub's own copies wherever both charts are in one
release (single-namespace mode). See the root README's collision rules.
*/}}
{{- define "platform.solutionsLabel" -}}
{{- if .Values.global.SRIsolutions }}
SRIsolutions: {{ join "_" .Values.global.SRIsolutions | trunc 63 }}
{{- end }}
{{- end }}
{{- define "platform.imagePullSecrets" -}}
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
{{- define "platform.database" -}}
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
