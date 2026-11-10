{{/*
Expand the name of the chart.
*/}}
{{- define "rtde.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}


{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "rtde.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}


{{/*
Create chart name and version as used by the chart label.
*/}}

{{- define "rtde.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}


{{/*
Common labels
*/}}

{{- define "rtde.labels" -}}
helm.sh/chart: {{ include "rtde.chart" . }}
app.kubernetes.io/name: {{ include "rtde.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{- define "rtde.config-volumes" -}}
{{- $solution := .solution -}}
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $solution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $solution }}-configs"
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $solution }}-secret-configs"
  secret:
    secretName: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $solution }}-secret-configs"
{{- end -}}

{{- define "rtde.qa-volumes" -}}
{{- $solution := .solution -}}
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml-{{ $solution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml-{{ $solution }}-configs"
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml2-{{ $solution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml2-{{ $solution }}-configs"
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-model-{{ $solution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-model-{{ $solution }}-configs"
{{- end -}}


{{- define "rtde.cm-mount" -}}
{{- $solution := .solution -}}
{{- $releaseName := .Release.Name -}}
{{- range $path, $bytes := .Files.Glob  (printf "data/conf/%s/**" $solution) -}}
{{- if not (or (hasSuffix "application.conf" $path) (hasSuffix "environment.conf" $path) (hasPrefix "data/conf/aml" $path)  (hasPrefix "data/conf/model" $path)) }}
  - name: {{ printf  "%s-%s-%s-configs" $.Release.Name $.Chart.Name $solution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s" (trimPrefix (printf "data/conf/%s/" $solution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $solution) $path| replace "/" "__" |  replace " " "--" | quote }}
{{- end }}
{{ end }}
{{- end -}}

{{- define "rtde.aml-cm-mount" -}}
{{- $solution := .solution -}}
{{- $releaseName := .Release.Name -}}
{{- range $path, $bytes := .Files.Glob  (printf "data/conf/%s/aml/**" $solution) -}}
  - name: {{ printf  "%s-%s-%s-aml-configs" $.Release.Name $.Chart.Name $solution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s/aml" (trimPrefix (printf "data/conf/%s/aml" $solution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $solution) $path| replace "/" "__" |  replace " " "--" | quote }}
{{ end }}
{{- end -}}

{{- define "rtde.aml2-cm-mount" -}}
{{- $solution := .solution -}}
{{- $releaseName := .Release.Name -}}
{{- range $path, $bytes := .Files.Glob  (printf "data/conf/%s/aml2/**" $solution) -}}
  - name: {{ printf  "%s-%s-%s-aml2-configs" $.Release.Name $.Chart.Name $solution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s/aml2" (trimPrefix (printf "data/conf/%s/aml2" $solution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $solution) $path| replace "/" "__" |  replace " " "--" | quote }}
{{ end }}
{{- end -}}

{{- define "rtde.model-cm-mount" -}}
{{- $solution := .solution -}}
{{- $releaseName := .Release.Name -}}
{{- range $path, $bytes := .Files.Glob  (printf "data/conf/%s/model/**" $solution) -}}
{{- if not (hasSuffix "RiskScore.pmml" $path) }}
  - name: {{ printf  "%s-%s-%s-model-configs" $.Release.Name $.Chart.Name $solution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s/model" (trimPrefix (printf "data/conf/%s/model" $solution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $solution) $path| replace "/" "__" |  replace " " "--" | quote }}
{{- end }}
{{ end }}
{{- end -}}

{{- define "rtde.secret-mount" -}}
{{- $solution := .solution -}}
{{- $releaseName := .Release.Name -}}
{{- range $path, $bytes := .Files.Glob  (printf "data/conf/%s/**" $solution) -}}
 {{- if or (hasSuffix "application.conf" $path) (hasSuffix "environment.conf" $path) }}
  - name: {{ printf  "%s-%s-%s-secret-configs" $.Release.Name $.Chart.Name $solution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s" (trimPrefix (printf "data/conf/%s/" $solution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $solution) $path| replace "/" "__" |  replace " " "--" | quote }}
{{- end }}
{{ end }}
{{- end -}}


{{- define "rtde.secret-mount.kafka.jks" -}}
{{- $solution := .solution -}}
{{- if ne .Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
  - name: "{{ .Release.Name }}-kafka-{{ $solution }}-jks-volume"
    mountPath: "/opt/tmpConf/kafka.keystore.jks"
    subPath: "kafka.keystore.jks"
  - name: "{{ .Release.Name }}-kafka-{{ $solution }}-jks-volume"
    mountPath: "/opt/tmpConf/kafka.truststore.jks"
    subPath: "kafka.truststore.jks"
  - name: {{ .Release.Name }}-kafka-user
    mountPath: /user
  - name: {{ .Release.Name }}-kafka-cluster-ca-cert
    mountPath: /cluster-ca-cert
{{- end }}
{{- end -}}

{{- define "rtde.application.conf.extra.params" -}}
{{- $params := . -}}
{{- range $item := $params -}}
{{ println $item }}
{{- end -}}
{{- end -}}

{{- define "rtde.environment.conf.kafka.extra.params" -}}
{{- $params := . -}}
{{- range $item := $params -}}
{{ println $item }}
{{- end -}}
{{- end -}}