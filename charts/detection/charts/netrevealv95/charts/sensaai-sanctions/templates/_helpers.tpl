##
# Sensa AI Sanctions helper functions
##

{{- define "generate.user.password" }}
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

{{- define "user.secret.definition" }}
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

{{- define "certificate.secret.definition" }}
  - name: {{ .Release.Name}}-sensaai-sanctions-cert
    secret:
      secretName: {{ .Release.Name}}-sensaai-sanctions-cert
      items:
      - key: tls.crt
        path: server.crt
      - key: tls.key
        path: server.key
{{- end }}

{{- define "define.topology.spread.constraints" }}
  {{- if .Values.enableTopologySpreadConstraints }}
  topologySpreadConstraints:
    - maxSkew: 1
      #minDomains: 1                                                            # optional, define when whenUnsatisfiable=DoNotSchedule
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: ScheduleAnyway                                         # DoNotSchedule | ScheduleAnyway
      labelSelector:
        matchLabels:
          app: "{{ .Release.Name }}-sensaai-sanctions-pod"
    {{- if or (eq .Values.pod.antiAffinity "hard") (eq .Values.pod.antiAffinity "soft") (eq .Values.pod.antiAffinity "custom") }}
  affinity:
    podAntiAffinity:
    {{- end }}
    {{- if eq .Values.pod.antiAffinity "soft" }}
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchLabels:
                app: {{ .Release.Name }}-sensaai-sanctions-pod
            topologyKey: topology.kubernetes.io/zone
    {{- else if eq .Values.pod.antiAffinity "hard" }}
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app: {{ .Release.Name }}-sensaai-sanctions-pod
          topologyKey: topology.kubernetes.io/zone
    {{- else if eq .Values.pod.antiAffinity "custom" }}
{{- tpl (toYaml .Values.pod.customAffinityRules) . | nindent 6 }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "issuer.ca.issuerRef.name" -}}
  {{- if .Values.ca.generate -}}
  {{ .Release.Name }}-ca
  {{- else -}}
  {{ tpl .Values.ca.issuerRefName . }}
  {{- end -}}
{{- end -}}
