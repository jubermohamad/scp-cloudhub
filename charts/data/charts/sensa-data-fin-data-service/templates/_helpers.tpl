{{/*
Fully qualified release name. Trims "<name>-sensa-data-fin-data-service" →
"<name>" when the chart name is already in the release name.
*/}}
{{- define "finDataService.fullname" -}}
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
Common labels applied to every resource.
*/}}
{{- define "finDataService.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/part-of: sensa-data-fin-data-service
{{- end }}

{{/*
DEST_DSN (password injected at runtime via $(POSTGRES_PASSWORD) env
substitution — requires POSTGRES_PASSWORD to be defined earlier in the same
container's env list).
*/}}
{{- define "finDataService.destDsn" -}}
postgresql://{{ .Values.postgres.username }}:$(POSTGRES_PASSWORD)@{{ include "finDataService.postgresHost" . }}:{{ .Values.postgres.port }}/{{ .Values.postgres.database }}
{{- end }}

{{/*
Image pull secrets — always derived from imageCredentials.secretName so the
pull secret and the Secret resource name can never diverge.
*/}}
{{- define "finDataService.imagePullSecrets" -}}
- name: {{ .Values.imageCredentials.secretName }}
{{- end }}

{{/*
Postgres service hostname. Uses the existing host when postgres.enabled is
false, otherwise the Helm-managed StatefulSet service.
*/}}
{{- define "finDataService.postgresHost" -}}
{{- if .Values.postgres.enabled }}
{{- printf "%s-postgres" (include "finDataService.fullname" .) }}
{{- else }}
{{- .Values.postgres.host }}
{{- end }}
{{- end }}
