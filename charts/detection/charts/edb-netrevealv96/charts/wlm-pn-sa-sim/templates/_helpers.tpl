{{- define "wlmPnSaSim.pvcApplicationLogsStorage" -}}
{{ .Values.pvc.applicationLogsStorage }}
{{- end -}}

{{- define "wlmPnSaSim.pvcConfWlmStorage" -}}
{{ .Values.pvc.confWlmStorage }}
{{- end -}}

{{- define "wlmPnSaSim.pvcHsqldbStorage" -}}
{{ .Values.pvc.hsqldbStorage }}
{{- end -}}

{{- define "wlm.pn.sa.sim.log4j2.volume" }}
- name: {{ .Release.Name }}-wlm-pn-sa-sim-log4j2
  configMap:
    name: {{ .Release.Name }}-wlm-pn-sa-sim-log4j2
{{- end }}

{{- define "wlm.pn.sa.sim.log4j2.volume.mount" }}
- name: {{ .Release.Name }}-wlm-pn-sa-sim-log4j2
  mountPath: /opt/netreveal/standaloneHome/log4j2
{{- end }}