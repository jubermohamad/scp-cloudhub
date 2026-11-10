{{- define "wlmIgsSa.pvcApplicationLogsStorage" -}}
{{ .Values.pvc.applicationLogsStorage }}
{{- end -}}

{{- define "wlmIgsSa.pvcConfWlmStorage" -}}
{{ .Values.pvc.confWlmStorage }}
{{- end -}}

{{- define "wlmIgsSa.pvcHsqldbStorage" -}}
{{ .Values.pvc.hsqldbStorage }}
{{- end -}}

{{- define "wlm.igs.docker.image" -}}
    {{- if .Values.global.saml.enabled -}}
{{ .Values.global.dockerRegistryName }}/{{ .Values.pod.samlWlmIgsDockerImage }}
    {{- else -}}
{{ .Values.global.dockerRegistryName }}/{{ .Values.pod.wlmIgsDockerImage }}
    {{- end -}}
{{- end -}}

{{- define "wlm.igs.sa.log4j2.volume" }}
- name: {{ .Release.Name }}-wlm-igs-sa-log4j2
  configMap:
    name: {{ .Release.Name }}-wlm-igs-sa-log4j2
{{- end }}

{{- define "wlm.igs.sa.log4j2.volume.mount" }}
- name: {{ .Release.Name }}-wlm-igs-sa-log4j2
  mountPath: /opt/netreveal/standaloneHome/log4j2
{{- end }}
