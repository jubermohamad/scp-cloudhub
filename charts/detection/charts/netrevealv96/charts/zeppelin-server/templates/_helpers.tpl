{{- define "zeppelin-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "zeppelin-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end }}

{{- define "zeppelin-server.labels" -}}
app.kubernetes.io/name: {{ include "zeppelin-server.name" . }}
helm.sh/chart: {{ include "zeppelin-server.chart" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Generate or retrieve password for a user from existing secret
*/}}
{{- define "zeppelin-server.getPassword" -}}
{{- $secret := (lookup "v1" "Secret" .context.Release.Namespace "zeppelin-shiro-config") -}}
{{- if and $secret $secret.data -}}
  {{- if hasKey $secret.data .username -}}
    {{- index $secret.data .username | b64dec -}}
  {{- else -}}
    {{- randAlphaNum 16 -}}
  {{- end -}}
{{- else -}}
  {{- if .password -}}
    {{- .password -}}
  {{- else -}}
    {{- randAlphaNum 16 -}}
  {{- end -}}
{{- end -}}
{{- end }}
