{{- define "wlmPnRt.pvcServerLogsStorage" -}}
{{ .Values.pvc.serverLogsStorage }}
{{- end -}}

{{- define "wlmPnRt.pvcServerConfigurationHistoryStorage" -}}
{{ .Values.pvc.serverConfigurationHistoryStorage }}
{{- end -}}

{{- define "wlmPnRt.pvcServerDeploymentsStorage" -}}
{{ .Values.pvc.serverLogsStorage }}
{{- end -}}

{{- define "wlmPnRt.pvcApplicationLogsStorage" -}}
{{ .Values.pvc.applicationLogsStorage }}
{{- end -}}

{{- define "wlmPnRt.pvcConfWlmStorage" -}}
{{ .Values.pvc.confWlmStorage }}
{{- end -}}

{{- define "wlmPnRt.pvcHsqldbStorage" -}}
{{ .Values.pvc.hsqldbStorage }}
{{- end -}}

{{- define "wlm.pn.rt.log4j2.volume" }}
- name: {{ .Release.Name }}-wlm-pn-rt-log4j2
  configMap:
    name: {{ .Release.Name }}-wlm-pn-rt-log4j2
    items:
    - key: log4j2.xml
      path: log4j2.xml
{{- end }}

{{- define "wlm.pn.rt.log4j2.volume.mount" }}
- name: {{ .Release.Name }}-wlm-pn-rt-log4j2
  mountPath: /opt/netreveal/uiHome/log4j2
{{- end }}
