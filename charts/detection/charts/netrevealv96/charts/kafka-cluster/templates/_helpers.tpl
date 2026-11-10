{{- define "kafkaCluster.kafka.pvcStorage" -}}
{{ .Values.kafka.pvc.storage }}
{{- end -}}

{{- define "kafkaCluster.zookeeper.pvcStorage" -}}
{{ .Values.zookeeper.pvc.storage }}
{{- end -}}

{{- define "kafka.topics" }}
{{ $currentScope := . }}
{{- if gt (len .Values.topics) 0 }}
{{- range $key, $value := .Values.topics }}
---
apiVersion: {{ $.Values.apiVersion }}
kind: KafkaTopic
metadata:
  name: "{{ $.Values.global.baseConfigProperties.kafka.topicNamePrefix }}{{ $key | replace "_" "-" | lower }}"
  labels:
    {{- with $currentScope }}
    strimzi.io/cluster: {{ include "generate.name.with.release.name" (list $ . "kafka") | quote }}
    {{- end }}
  namespace: {{ $.Values.global.namespace }}
spec:
  topicName: {{ $.Values.global.baseConfigProperties.kafka.topicNamePrefix }}{{ $key }}
  partitions: {{ $value.partitions }}
  {{- if $value.replicas }}
  replicas: {{ $value.replicas }}
  {{- end }}
  {{- if $value.config }}
  {{- if gt (len $value.config) 0 }}
  config:
  {{- range $configKey, $configValue := $value.config}}
    {{ $configKey }}: "{{ $configValue }}"
  {{- end }}
  {{- end }}
  {{- end }}
{{- end }}
{{- end }}
{{- end }}

{{- define "entityOperator.topicOperator" }}
  {{- if eq .Values.global.useResourceConstraints "false" }}
topicOperator: {}
  {{- else }}
    {{- $defineTopicOperator := false }}

    {{- $addRequestsMemory := false }}
    {{- $addRequestsCpu := false }}
    {{- $addLimitsMemory := false }}
    {{- $addLimitsCpu := false }}

    {{- if ne .Values.entityOperator.topicOperator.resources.requests.memory "" }}
      {{- $defineTopicOperator = true }}
      {{- $addRequestsMemory = true }}
    {{- end }}

    {{- if ne .Values.entityOperator.topicOperator.resources.requests.cpu "" }}
      {{- $defineTopicOperator = true }}
      {{- $addRequestsCpu = true }}
    {{- end }}

    {{- if ne .Values.entityOperator.topicOperator.resources.limits.memory "" }}
      {{- $defineTopicOperator = true }}
      {{- $addLimitsMemory = true }}
    {{- end }}

    {{- if ne .Values.entityOperator.topicOperator.resources.limits.cpu "" }}
      {{- $defineTopicOperator = true }}
      {{- $addLimitsCpu = true }}
    {{- end }}

    {{- if $defineTopicOperator }}
topicOperator:
  resources:
      {{- if or $addRequestsMemory $addRequestsCpu  }}
    requests:
        {{- if $addRequestsMemory }}
      memory: {{ .Values.entityOperator.topicOperator.resources.requests.memory }}
        {{- end }}
        {{- if $addRequestsCpu }}
      cpu: {{ .Values.entityOperator.topicOperator.resources.requests.cpu }}
        {{- end }}
      {{- end }}
      {{- if or $addLimitsMemory $addLimitsCpu  }}
    limits:
        {{- if $addLimitsMemory }}
      memory: {{ .Values.entityOperator.topicOperator.resources.limits.memory }}
        {{- end }}
        {{- if $addLimitsCpu }}
      cpu: {{ .Values.entityOperator.topicOperator.resources.limits.cpu }}
        {{- end }}
      {{- end }}
    {{- else }}
topicOperator: {}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "entityOperator.userOperator" }}
  {{- if eq .Values.global.useResourceConstraints "false" }}
userOperator: {}
  {{- else }}
    {{- $defineUserOperator := false }}

    {{- $addRequestsMemory := false }}
    {{- $addRequestsCpu := false }}
    {{- $addLimitsMemory := false }}
    {{- $addLimitsCpu := false }}

    {{- if ne .Values.entityOperator.userOperator.resources.requests.memory "" }}
      {{- $defineUserOperator = true }}
      {{- $addRequestsMemory = true }}
    {{- end }}

    {{- if ne .Values.entityOperator.userOperator.resources.requests.cpu "" }}
      {{- $defineUserOperator = true }}
      {{- $addRequestsCpu = true }}
    {{- end }}

    {{- if ne .Values.entityOperator.userOperator.resources.limits.memory "" }}
      {{- $defineUserOperator = true }}
      {{- $addLimitsMemory = true }}
    {{- end }}

    {{- if ne .Values.entityOperator.userOperator.resources.limits.cpu "" }}
      {{- $defineUserOperator = true }}
      {{- $addLimitsCpu = true }}
    {{- end }}

    {{- if $defineUserOperator }}
userOperator:
  resources:
      {{- if or $addRequestsMemory $addRequestsCpu  }}
    requests:
        {{- if $addRequestsMemory }}
      memory: {{ .Values.entityOperator.userOperator.resources.requests.memory }}
        {{- end }}
        {{- if $addRequestsCpu }}
      cpu: {{ .Values.entityOperator.userOperator.resources.requests.cpu }}
        {{- end }}
      {{- end }}
      {{- if or $addLimitsMemory $addLimitsCpu  }}
    limits:
        {{- if $addLimitsMemory }}
      memory: {{ .Values.entityOperator.userOperator.resources.limits.memory }}
        {{- end }}
        {{- if $addLimitsCpu }}
      cpu: {{ .Values.entityOperator.userOperator.resources.limits.cpu }}
        {{- end }}
      {{- end }}
    {{- else }}
userOperator: {}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "kafka.jvmOptions" }}
jvmOptions:
  -Xms: {{ .Values.kafka.jvmOptions.xms }}
  -Xmx: {{ .Values.kafka.jvmOptions.xmx }}
  {{- if .Values.kafka.jvmOptions.xx }}
    {{- if gt (len .Values.kafka.jvmOptions.xx) 0 }}
  -XX:
      {{- range $key, $value := .Values.kafka.jvmOptions.xx }}
    {{ $value.name | quote }}: {{ $value.value | quote }}
      {{- end }}
    {{- end }}
  {{- end }}
  {{- if .Values.kafka.jvmOptions.javaSystemProperties }}
    {{- if gt (len .Values.kafka.jvmOptions.javaSystemProperties) 0 }}
  javaSystemProperties:
      {{- range $value := .Values.kafka.jvmOptions.javaSystemProperties }}
    - name: {{ $value.name | quote }}
      value: {{ $value.value | quote }}
      {{- end }}
    {{- end }}
  {{- end }}
  gcLoggingEnabled: {{ .Values.kafka.jvmOptions.gcLoggingEnabled }}
{{- end }}

{{- define "zookeeper.jvmOptions" }}
jvmOptions:
  {{- if ne .Values.zookeeper.jvmOptions.xms "" }}
  -Xms: {{ .Values.zookeeper.jvmOptions.xms }}
  {{- end }}
  {{- if ne .Values.zookeeper.jvmOptions.xmx ""}}
  -Xmx: {{ .Values.zookeeper.jvmOptions.xmx }}
  {{- end }}
  {{- if .Values.zookeeper.jvmOptions.xx }}
    {{- if gt (len .Values.zookeeper.jvmOptions.xx) 0 }}
  -XX:
      {{- range $key, $value := .Values.zookeeper.jvmOptions.xx }}
    {{ $value.name | quote }}: {{ $value.value | quote }}
      {{- end }}
    {{- end }}
  {{- end }}
  {{- if .Values.zookeeper.jvmOptions.javaSystemProperties }}
    {{- if gt (len .Values.kafka.jvmOptions.javaSystemProperties) 0 }}
  javaSystemProperties:
      {{- range $value := .Values.zookeeper.jvmOptions.javaSystemProperties }}
    - name: {{ $value.name | quote }}
      value: {{ $value.value | quote }}
      {{- end }}
    - name: zookeeper.ssl.hostnameVerification
      value: "{{ .Values.zookeeper.ssl.hostnameVerification }}"
    - name: zookeeper.ssl.quorum.hostnameVerification
      value: "{{ .Values.zookeeper.ssl.quorum.hostnameVerification }}"
    {{- end }}
  {{- else }}
  javaSystemProperties:
    - name: zookeeper.ssl.hostnameVerification
      value: "{{ .Values.zookeeper.ssl.hostnameVerification }}"
    - name: zookeeper.ssl.quorum.hostnameVerification
      value: "{{ .Values.zookeeper.ssl.quorum.hostnameVerification }}"
  {{- end }}
  gcLoggingEnabled: {{ .Values.zookeeper.jvmOptions.gcLoggingEnabled }}
{{- end }}
