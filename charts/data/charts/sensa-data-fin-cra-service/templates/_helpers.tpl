{{/* Platform naming: every resource is {{ .Release.Name }}-data-cra-<component>
     (SRI convention — generic names collide in shared namespaces). */}}
{{- define "craService.prefix" -}}
{{- .Release.Name }}-data-cra
{{- end -}}

{{/* Full image ref for a component. */}}
{{- define "craService.image" -}}
{{ .root.Values.image.registry }}/{{ .root.Values.image.prefix }}/{{ .name }}:{{ .root.Values.image.tag }}
{{- end -}}

{{/* Pod annotations block (gitSha stamp etc.) — rendered into EVERY pod template so a
     CD-stamped annotation rolls every component even when the image tag itself is a
     mutable branch tag that didn't change string value. */}}
{{- define "craService.podAnnotations" -}}
{{- with .Values.podAnnotations }}
annotations:
{{- range $k, $v := . }}
  {{ $k }}: {{ $v | quote }}
{{- end }}
{{- end }}
{{- end -}}
