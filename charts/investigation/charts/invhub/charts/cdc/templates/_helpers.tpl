{{/*
Backward compatible helper functions for global configuration keys
Each function checks for the new camelCase key first, then falls back to the old SCREAMING_SNAKE_CASE key
*/}}

{{- define "global.remoteDataDbType" -}}
{{- .Values.global.remoteDataDbType | default .Values.global.REMOTE_DATA_DB_TYPE -}}
{{- end }}

{{- define "global.remoteDataDbHost" -}}
{{- .Values.global.remoteDataDbHost | default .Values.global.REMOTE_DATA_DB_HOST -}}
{{- end }}

{{- define "global.remoteDataDbPort" -}}
{{- .Values.global.remoteDataDbPort | default .Values.global.REMOTE_DATA_DB_PORT -}}
{{- end }}

{{- define "global.remoteDataDbName" -}}
{{- .Values.global.remoteDataDbName | default .Values.global.REMOTE_DATA_DB_NAME -}}
{{- end }}

{{- define "global.remoteDataDbUsername" -}}
{{- .Values.global.remoteDataDbUsername | default .Values.global.REMOTE_DATA_DB_USERNAME -}}
{{- end }}

{{- define "global.remoteDataDbPassword" -}}
{{- .Values.global.remoteDataDbPassword | default .Values.global.REMOTE_DATA_DB_PASSWORD -}}
{{- end }}

{{- define "global.remoteDataDbUseSsl" -}}
{{- .Values.global.remoteDataDbUseSsl | default .Values.global.REMOTE_DATA_DB_USE_SSL -}}
{{- end }}

{{- define "global.remoteDataDbSslSelfSigned" -}}
{{- .Values.global.remoteDataDbSslSelfSigned | default .Values.global.REMOTE_DATA_DB_SSL_SELF_SIGNED -}}
{{- end }}
