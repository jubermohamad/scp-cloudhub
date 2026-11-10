{{/*
Render a tags list safely, whether .Values.tags is a list or a string.
Usage:
  {{ include "tailscale.tags" . | indent 4 }}
*/}}
{{- define "tailscale.tags" -}}
{{- if kindIs "slice" .Values.tags }}
{{- toYaml .Values.tags | nindent 0 }}
{{- else if .Values.tags }}
- {{ .Values.tags }}
{{- else }}
[]
{{- end -}}
{{- end }}
