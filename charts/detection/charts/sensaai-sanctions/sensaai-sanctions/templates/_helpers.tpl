{{- define "minio.url" -}}
    http://minio.{{ .Values.global.namespace }}.svc.cluster.local:9000
{{- end -}}

{{- define "storage.pvc.annotations" -}}
    {{- $ := index . 0 }}
    {{- $pvcType := index . 2 }}

    {{- if or (eq $.Values.global.clusterType "aks-netapp") (eq $.Values.global.clusterType "aks") }}
        {{- if eq $pvcType "nfs" }}
annotations:
  velero.io/csi-volumesnapshot-class: "trident-snapshotclass"
        {{- else }}
            {{- if eq $pvcType "standard-without-main-label" }}
  velero.io/csi-volumesnapshot-class: "azure-disk-csi-snapshotclass"
            {{- else }}
annotations:
  velero.io/csi-volumesnapshot-class: "azure-disk-csi-snapshotclass"
            {{- end }}
        {{- end }}
    {{- end }}
{{- end -}}


##
# Sensa AI Sanctions helper functions
##

{{- define "sai.generate.user.password" }}
  {{- if not (tpl .Values.userPasswordSecretName .) }}
    {{- $userPassword := "" }}
    {{- $iter := 0 }}
    {{- range $user, $value := .Values.users }}
      {{- if ne $value.pass "" }}
        {{- if ne $userPassword "" }}
          {{- $userPassword = print $userPassword ", " }}
        {{- end }}
        {{- $userPassword = print $userPassword "\"" $user "\": {\"password\": \"" $value.pass "\", \"is_hashed\": false" }}
        {{- if $value.role }}
          {{- $userPassword = print $userPassword ", \"role\": \"" $value.role "\"" }}
        {{- end }}
        {{- $userPassword = print $userPassword "}" }}
      {{- end }}
    {{- end }}
{{ print "{" $userPassword "}" }}
  {{- end }}
{{- end }}

{{- define "sai.user.secret.definition" }}
  {{- if and (tpl .Values.userPasswordSecretName .) (tpl .Values.userPasswordSecretKey .) }}
  - name: {{ .Release.Name }}-sensaai-users
    secret:
      secretName: {{ tpl .Values.userPasswordSecretName . }}
      items:
      - key: {{ tpl .Values.userPasswordSecretKey . }}
        path: password.json
  {{- else }}
  - name: {{ .Release.Name }}-sensaai-users
    secret:
      secretName: {{ .Release.Name }}-sensaai-users
      items:
      - key: password.json
        path: password.json
  {{- end }}
{{- end }}

{{- define "sai.certificate.secret.definition" }}
  - name: {{ .Release.Name }}-sensaai-sanctions-cert
    secret:
      secretName: {{ .Release.Name }}-sensaai-sanctions-cert
      items:
      - key: tls.crt
        path: server.crt
      - key: tls.key
        path: server.key
{{- end }}

{{- define "sai.issuer.ca.issuerRef.name" -}}
  {{- if .Values.global.ca.generate -}}
  {{ .Release.Name }}-ca
  {{- else -}}
  {{ tpl .Values.global.ca.issuerRefName . }}
  {{- end -}}
{{- end -}}
