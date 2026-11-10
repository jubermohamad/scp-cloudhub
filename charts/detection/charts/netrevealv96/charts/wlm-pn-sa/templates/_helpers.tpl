{{- define "wlmPnSa.pvcApplicationLogsStorage" -}}
{{ .Values.pvc.applicationLogsStorage }}
{{- end -}}

{{- define "wlmPnSa.pvcConfWlmStorage" -}}
{{ .Values.pvc.confWlmStorage }}
{{- end -}}

{{- define "wlmPnSa.pvcHsqldbStorage" -}}
{{ .Values.pvc.hsqldbStorage }}
{{- end -}}

{{- define "wlm.pn.sa.log4j2.volume" }}
- name: {{ .Release.Name }}-wlm-pn-sa-log4j2
  configMap:
    name: {{ .Release.Name }}-wlm-pn-sa-log4j2
{{- end }}

{{- define "wlm.pn.sa.log4j2.volume.mount" }}
- name: {{ .Release.Name }}-wlm-pn-sa-log4j2
  mountPath: /opt/netreveal/standaloneHome/log4j2
{{- end }}
