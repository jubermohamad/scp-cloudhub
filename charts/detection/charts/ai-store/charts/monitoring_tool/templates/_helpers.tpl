{{- define "monitoring-tool.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "monitoring-tool.fullname" -}}
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
{{- end }}

{{- define "monitoring-tool.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "monitoring-tool.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "monitoring-tool.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ default (include "monitoring-tool.fullname" .) .Values.serviceAccount.name }}
{{- else -}}
{{ default "default" .Values.serviceAccount.name }}
{{- end -}}
{{- end }}

{{- define "monitoring-tool.containerEnv" -}}
- name: UV_PROJECT_ENVIRONMENT
  value: {{ .Values.uvProjectEnvironment | default "/app/.venv" | quote }}
- name: PATH
  value: "/app/.venv/bin:/usr/local/bin:/usr/bin:/bin"
- name: VIRTUAL_ENV
  value: {{ .Values.uvProjectEnvironment | default "/app/.venv" | quote }}
- name: K8S_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
- name: APP_PORT
  value: {{ .Values.service.httpPort | quote }}
- name: MONITORING_SERVER_PORT
  value: {{ .Values.service.mcpPort | quote }}
- name: API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.apiKey }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.databaseUrl }}
- name: MINIO_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.minioAccessKey }}
- name: MINIO_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.minioSecretKey }}
- name: MLFLOW_TRACKING_USERNAME
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.mlflowTrackingUsername }}
- name: MLFLOW_TRACKING_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.mlflowTrackingPassword }}
- name: AWS_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.awsAccessKeyId }}
- name: AWS_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.awsSecretAccessKey }}
- name: MONITORING_WORKER_IMAGE
  value: "{{ .Values.workerImage.repository }}:{{ .Values.workerImage.tag }}"
- name: AI_STORE_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.apiKey }}
{{- if .Values.aiStoreApiUrl }}
- name: AI_STORE_API_URL
  value: {{ .Values.aiStoreApiUrl | quote }}
{{- end }}
{{- if .Values.ociRegistryUrl }}
- name: OCI_REGISTRY_URL
  value: {{ .Values.ociRegistryUrl | quote }}
- name: OCI_REGISTRY_USERNAME
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.ociRegistryUsername }}
      optional: true
- name: OCI_REGISTRY_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.global.secretName }}
      key: {{ .Values.secretKeys.ociRegistryPassword }}
      optional: true
{{- end }}
{{- with .Values.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end }}
