{{- define "opensearch.pvcStorage" -}}
{{ .Values.persistence.size }}
{{- end -}}

{{- define "opensearch.dnsNames" -}}
{{- $clusterName := "opensearch-cluster" -}}
{{- $namespace := .Values.global.namespace -}}
{{- $replicas := default 1 (int .Values.replicas) -}}
- localhost
- {{ $clusterName }}-master.{{ $namespace }}.svc.cluster.local
- {{ $clusterName }}-master-headless.{{ $namespace }}.svc.cluster.local
{{- range $i, $role := until $replicas }}
- {{ $clusterName }}-{{ $role }}
- {{ $clusterName }}-{{ $role }}.{{ $namespace }}.svc.cluster.local
{{- end }}
{{- end }}
