{{/*
Expand the name of the chart.
*/}}
{{- define "smbd.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}



{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "smbd.fullname" -}}
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

{{- define "smbd.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}


{{/*
Common labels
*/}}

{{- define "smbd.labels" -}}
helm.sh/chart: {{ include "smbd.chart" . }}
app.kubernetes.io/name: {{ include "smbd.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{- define "smbd.config-volumes" -}}
{{- $helmSolution := .Values.helmSolution -}}
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $helmSolution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $helmSolution }}-configs"
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $helmSolution }}-secret-configs"
  secret:
    secretName: "{{ .Release.Name }}-{{ .Chart.Name }}-{{ $helmSolution }}-secret-configs"
{{- end -}}

{{- define "smbd.qa-volumes" -}}
{{- $helmSolution := .Values.helmSolution -}}
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml-{{ $helmSolution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml-{{ $helmSolution }}-configs"
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml2-{{ $helmSolution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-aml2-{{ $helmSolution }}-configs"
- name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-model-{{ $helmSolution }}-configs"
  configMap:
    name: "{{ .Release.Name }}-{{ .Chart.Name }}-dir-model-{{ $helmSolution }}-configs"
{{- end -}}

{{- define "smbd.cm-mount" -}}
{{- $helmSolution := .Values.helmSolution -}}
{{- $releaseName := .Release.Name -}}
{{- $chartName := .Chart.Name -}}
{{ range $path, $bytes := .Files.Glob (printf "data/conf/%s/**" $helmSolution) }}
{{- if not (or (hasSuffix "application.conf" $path) (hasSuffix "environment.conf" $path) (hasPrefix (printf "data/conf/%s/aml" $helmSolution) $path) (hasPrefix (printf "data/conf/%s/model" $helmSolution) $path)) }}
  - name: {{ printf "%s-%s-%s-configs" $releaseName $chartName $helmSolution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s" (trimPrefix (printf "data/conf/%s/" $helmSolution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $helmSolution) $path | replace "/" "__" |  replace " " "--" | quote }}
{{- end }}
{{ end }}
{{- end -}}

{{- define "smbd.aml-cm-mount" -}}
{{- $helmSolution := .Values.helmSolution -}}
{{- $releaseName := .Release.Name -}}
{{- $chartName := .Chart.Name -}}
{{ range $path, $bytes := .Files.Glob (printf "data/conf/%s/aml/**" $helmSolution) }}

  - name: {{ printf "%s-%s-dir-aml-%s-configs" $releaseName $chartName  $helmSolution | quote }}
    mountPath: {{ printf "/opt/tmpConf/aml/%s" (trimPrefix (printf "data/conf/%s/aml/" $helmSolution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $helmSolution) $path | replace "/" "__" |  replace " " "--" | quote }}
{{ end }}
{{- end -}}

{{- define "smbd.aml2-cm-mount" -}}
{{- $helmSolution := .Values.helmSolution -}}
{{- $releaseName := .Release.Name -}}
{{- $chartName := .Chart.Name -}}
{{ range $path, $bytes := .Files.Glob (printf "data/conf/%s/aml2/**" $helmSolution) }}
  - name: {{ printf "%s-%s-dir-aml2-%s-configs" $releaseName $chartName  $helmSolution | quote }}
    mountPath: {{ printf "/opt/tmpConf/aml2/%s" (trimPrefix (printf "data/conf/%s/aml2/" $helmSolution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $helmSolution) $path | replace "/" "__" |  replace " " "--" | quote }}
{{ end }}
{{- end -}}

{{- define "smbd.model-cm-mount" -}}
{{- $helmSolution := .Values.helmSolution -}}
{{- $releaseName := .Release.Name -}}
{{- $chartName := .Chart.Name -}}
{{ range $path, $bytes := .Files.Glob (printf "data/conf/%s/model/**" $helmSolution) }}
{{- if not (hasSuffix "RiskScore.pmml" $path) }}
  - name: {{ printf "%s-%s-model-%s-configs" $releaseName $chartName $helmSolution | quote }}
    mountPath: {{ printf "/opt/tmpConf/model/%s" (trimPrefix (printf "data/conf/%s/model/" $helmSolution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $helmSolution) $path | replace "/" "__" |  replace " " "--" | quote }}
{{- end }}
{{ end }}
{{- end -}}

{{- define "smbd.secret-mount" -}}
{{- $helmSolution := .Values.helmSolution -}}
{{- $releaseName := .Release.Name -}}
{{- $chartName := .Chart.Name -}}
{{ range $path, $bytes := .Files.Glob (printf "data/conf/%s/**" $helmSolution) }}
 {{- if or (hasSuffix "application.conf" $path) (hasSuffix "environment.conf" $path) }}
  - name: {{ printf "%s-%s-%s-secret-configs" $releaseName $chartName $helmSolution | quote }}
    mountPath: {{ printf "/opt/tmpConf/%s" (trimPrefix (printf "data/conf/%s/" $helmSolution) $path) | quote }}
    subPath: {{ trimPrefix (printf "data/conf/%s/" $helmSolution) $path | replace "/" "__" |  replace " " "--" | quote }}
{{- end }}
{{ end }}
{{- end -}}

{{- define "smbd.application.conf.extra.params" -}}
{{- $params := . -}}
{{- range $item := $params -}}
{{ println $item }}
{{- end -}}
{{- end -}}
