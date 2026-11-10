##
# Sensa AI Sanctions helper functions
##

{{- define "sai.define.topology.spread.constraints" }}
  {{- if .Values.enableTopologySpreadConstraints }}
  topologySpreadConstraints:
    - maxSkew: 1
      #minDomains: 1                                                            # optional, define when whenUnsatisfiable=DoNotSchedule
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: ScheduleAnyway                                         # DoNotSchedule | ScheduleAnyway
      labelSelector:
        matchLabels:
          app: "{{ .Release.Name }}-sensaai-sanctions-inference-pod"
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchExpressions:
                - key: {{ .Release.Name }}-sensaai-sanctions-inference-pod
                  operator: In
                  values:
                    - {{ .Release.Name }}-sensaai-sanctions-inference-pod
            topologyKey: topology.kubernetes.io/zone
  {{- end }}
{{- end }}
