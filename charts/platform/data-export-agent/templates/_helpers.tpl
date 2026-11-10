{{- define "dxa.name" -}}data-export-agent{{- end -}}

{{- define "dxa.namespace" -}}
{{- default "cloudhub-system" .Values.namespace -}}
{{- end -}}

{{- define "dxa.serviceAccountName" -}}
{{- default "data-export-agent" .Values.serviceAccount.name -}}
{{- end -}}

{{- define "dxa.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dxa.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "dxa.labels" -}}
{{ include "dxa.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: cloudhub
app.kubernetes.io/component: data-export-agent
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Release-scoped name for cluster-wide RBAC objects. */}}
{{- define "dxa.clusterRoleName" -}}
{{- printf "%s-%s" (include "dxa.namespace" .) (include "dxa.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
