{{/*
Validate required values and produce shared metadata.
*/}}
{{- define "namespace-bootstrap.requiredString" -}}
{{- $val := index . 0 -}}
{{- $name := index . 1 -}}
{{- if not $val -}}
{{- fail (printf "namespace-bootstrap: required value '%s' is empty" $name) -}}
{{- end -}}
{{- $val -}}
{{- end -}}

{{- define "namespace-bootstrap.namespace" -}}
{{ list .Values.namespace "namespace" | include "namespace-bootstrap.requiredString" }}
{{- end -}}

{{- define "namespace-bootstrap.labels" -}}
owner: {{ list .Values.owner "owner" | include "namespace-bootstrap.requiredString" | quote }}
business-unit: {{ list .Values.businessUnit "businessUnit" | include "namespace-bootstrap.requiredString" | quote }}
environment: {{ list .Values.environment "environment" | include "namespace-bootstrap.requiredString" | quote }}
application: {{ list .Values.application "application" | include "namespace-bootstrap.requiredString" | quote }}
cost-center: {{ list .Values.costCenter "costCenter" | include "namespace-bootstrap.requiredString" | quote }}
managed-by: "helm"
platform: "cloudhub"
{{- range $k, $v := .Values.extraLabels }}
{{ $k }}: {{ $v | quote }}
{{- end }}
{{- end -}}

{{- define "namespace-bootstrap.annotations" -}}
{{- range $k, $v := .Values.extraAnnotations }}
{{ $k }}: {{ $v | quote }}
{{- end }}
{{- end -}}
