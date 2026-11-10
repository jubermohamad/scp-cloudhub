{{- define "app-bootstrap.name" -}}
{{- if not .Values.application -}}{{- fail "app-bootstrap: 'application' is required" -}}{{- end -}}
{{- .Values.application -}}
{{- end -}}

{{- define "app-bootstrap.namespace" -}}
{{- if not .Values.namespace -}}{{- fail "app-bootstrap: 'namespace' is required" -}}{{- end -}}
{{- .Values.namespace -}}
{{- end -}}

{{- define "app-bootstrap.labels" -}}
app.kubernetes.io/name: {{ include "app-bootstrap.name" . }}
app.kubernetes.io/managed-by: helm
application: {{ include "app-bootstrap.name" . }}
owner: {{ .Values.owner | quote }}
business-unit: {{ .Values.businessUnit | quote }}
environment: {{ .Values.environment | quote }}
cost-center: {{ .Values.costCenter | quote }}
platform: cloudhub
{{- end -}}

{{- define "app-bootstrap.selectorLabels" -}}
app.kubernetes.io/name: {{ include "app-bootstrap.name" . }}
{{- end -}}
