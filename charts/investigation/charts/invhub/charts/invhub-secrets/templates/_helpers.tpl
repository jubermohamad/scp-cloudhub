{{/*
Expand the name of the chart.
*/}}
{{- define "invhub-secrets.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Validate that the password meets our criteria - minimum of 12 alpha-numeric characters
*/}}
{{- define "validPass" -}}
{{ $error := "PASSWORD must contain only alpha-numeric characters and be at least 12 characters long.  Please update the PASSWORD in values.yaml." }}
{{ $pass := .Values.global.PASSWORD }}
{{- if eq ( regexMatch "^[A-Za-z0-9]{12,}$" $pass ) false }}
{{ fail ( $error ) }}
{{- end }}
{{- end }}


{{- define "invhub-secrets.getApiKeyValue" -}}
{{- $envVarName := .key -}}
{{- $secretKey := .secretKey -}}
{{- $root := .root -}}
{{- $existingData := .existingData -}}
{{- $shouldRotate := .shouldRotate | default false -}}
{{- if and (hasKey $root.Values.global $envVarName) (ne (get $root.Values.global $envVarName) "") -}}
{{- get $root.Values.global $envVarName -}}
{{- else if and (not $shouldRotate) (hasKey $existingData $secretKey) -}}
{{- index $existingData $secretKey | b64dec -}}
{{- else -}}
{{- randAlphaNum 32 -}}
{{- end -}}
{{- end }}

{{/*
Backward compatible helper functions for global configuration keys
Each function checks for the new camelCase key first, then falls back to the old SCREAMING_SNAKE_CASE key
*/}}

{{- define "global.emailPassword" -}}
{{- .Values.global.emailPassword | default .Values.global.SENSA_EMAIL_PASSWORD -}}
{{- end }}

{{- define "global.googleMapsApiKey" -}}
{{- .Values.global.googleMapsApiKey | default .Values.global.INVHUB_GOOGLE_MAPS_API_KEY  -}}
{{- end }}

{{- define "global.pendoApiKey" -}}
{{- .Values.global.pendoApiKey | default .Values.global.INVHUB_PENDO_API_KEY -}}
{{- end }}

{{- define "global.pendoAccountId" -}}
{{- .Values.global.pendoAccountId | default .Values.global.INVHUB_PENDO_ACCOUNTID -}}
{{- end }}

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

{{/*
Get a secret value from (in priority order):
1) an explicitly provided value
2) the existing Secret data (via lookup)
*/}}
{{- define "invhub-secrets.getOrGenerateSecretValue" -}}
{{- $value := .value | default "" -}}
{{- $existingData := .existingData | default dict -}}
{{- $secretKey := .secretKey -}}
{{- if ne $value "" -}}
{{- $value -}}
{{- else if hasKey $existingData $secretKey -}}
{{- index $existingData $secretKey | b64dec -}}
{{- else -}}
{{- $secretName := .secretName | default "<unknown>" -}}
{{- fail (printf "Missing required value for Secret %s key %s; set global.PASSWORD or pre-create the Secret." $secretName $secretKey) -}}
{{- end -}}
{{- end -}}

{{/*
Get a secret value from (in priority order):
1) an explicitly provided value
2) the existing Secret data (via lookup), unless rotation is requested
3) generate a new random value
*/}}
{{- define "invhub-secrets.getOrRotateRandomSecretValue" -}}
{{- $value := .value | default "" -}}
{{- $existingData := .existingData | default dict -}}
{{- $secretKey := .secretKey -}}
{{- $shouldRotate := .shouldRotate | default false -}}
{{- $length := .length | default 32 -}}
{{- if ne $value "" -}}
{{- $value -}}
{{- else if and (not $shouldRotate) (hasKey $existingData $secretKey) -}}
{{- index $existingData $secretKey | b64dec -}}
{{- else -}}
{{- randAlphaNum $length -}}
{{- end -}}
{{- end -}}
