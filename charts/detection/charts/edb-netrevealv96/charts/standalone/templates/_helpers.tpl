{{- define "standalone.pvcWlmIndexStorage" -}}
{{ .Values.pvc.wlmIndexStorage }}
{{- end -}}

{{- define "standalone.pvcApplicationLogsStorage" -}}
{{ .Values.pvc.applicationLogsStorage }}
{{- end -}}

{{- define "standalone.pvcApplicationAcquisitionStorage" -}}
{{ .Values.pvc.applicationAcquisitionStorage }}
{{- end -}}

{{- define "standalone.pvcConfWlmStorage" -}}
{{ .Values.pvc.confWlmStorage }}
{{- end -}}

{{- define "standalone.pvcDataStorage" -}}
{{ .Values.pvc.dataStorage }}
{{- end -}}

{{- define "standalone.pvcOverrideStorage" -}}
{{ .Values.pvc.overrideStorage }}
{{- end -}}

{{- define "standalone.factiva.pvcStorage" -}}
{{ .Values.factiva.pvc.pvcStorage }}
{{- end -}}

{{- define "standalone.aap.host" -}}
       {{ .Release.Name }}-aap.{{ .Values.global.namespace }}.svc.cluster.local
{{- end -}}

{{- define "standalone.docker.image" -}}
    {{- if .Values.global.saml.enabled -}}
{{ .Values.global.dockerRegistryName }}/{{ .Values.pod.samlStandaloneDockerImage }}
    {{- else -}}
{{ .Values.global.dockerRegistryName }}/{{ .Values.pod.standaloneDockerImage }}
    {{- end -}}
{{- end -}}

{{- define "standalone.config.map.name" -}}
{{- printf "%s-%s" .Release.Name "std-base-config-property" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "standalone.schema.import.base.config.property.name" -}}
{{- printf "%s-%s" .Release.Name "std-schema-import-base-config-property" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "config.map.saml.script.name" -}}
{{- printf "%s-%s" .Release.Name "saml-scripts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "config.map.standalone.sidecar.scripts.name" -}}
{{- printf "%s-%s" .Release.Name "std-sidecar-scripts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "config.map.standalone.eim.lst.name" -}}
{{- printf "%s-%s" .Release.Name "std-eim-lst" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "config.map.standalone.posteim.lst.name" -}}
{{- printf "%s-%s" .Release.Name "std-posteim-lst" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "config.map.standalone.scheduler.config.name" -}}
{{- printf "%s-%s" .Release.Name "std-scheduler-config" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "config.map.standalone.dbextract.automatedexport.sql.name" -}}
{{- printf "%s-%s" .Release.Name "std-dbextract-sql" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "secret.standalone.db.init.script.insert.license.name" -}}
{{- printf "%s-%s" .Release.Name "std-db-init-script-insert-license" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "job.standalone.license.schema.init.name" -}}
{{ $jobName := printf "%s-%s" .Release.Name "std-license-schema-import-job" | trunc 52 | trimSuffix "-" }}
{{- printf "%s-%s" $jobName (randAlphaNum 10 | lower) -}}
{{- end -}}

{{- define "job.standalone.override.name" -}}
{{ $jobName := printf "%s-%s" .Release.Name "override-job" | trunc 52 | trimSuffix "-" }}
{{- printf "%s-%s" $jobName (randAlphaNum 10 | lower) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "secret.standalone.dbextract.script.name" -}}
{{- printf "%s-%s" .Release.Name "std-dbextract-scripts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "secret.standalone.apps-schema-import.script.name" -}}
{{- printf "%s-%s" .Release.Name "std-apps-schema-import-scripts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "secret.standalone.worldcheck.script.name" -}}
{{- printf "%s-%s" .Release.Name "std-worldcheck-scripts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "secret.standalone.factiva.script.name" -}}
{{- printf "%s-%s" .Release.Name "std-factiva-scripts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "secret.s3.private.bucket.name" -}}
{{- printf "%s-%s" .Release.Name "s3-private-bucket-secret" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.apps-schema-import.name" -}}
{{- printf "%s-%s" .Release.Name "apps-schema-import-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}


{{- define "cron.job.dbextract.hourly.name" -}}
{{- printf "%s-%s" .Release.Name "dbextract-hourly-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.dbextract.daily.name" -}}
{{- printf "%s-%s" .Release.Name "dbextract-daily-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.dbextract.weekly.name" -}}
{{- printf "%s-%s" .Release.Name "dbextract-weekly-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.dbextract.monthly.name" -}}
{{- printf "%s-%s" .Release.Name "dbextract-monthly-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.worldcheck.daily.name" -}}
{{- printf "%s-%s" .Release.Name "worldcheck-daily-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.worldcheck.weekly.name" -}}
{{- printf "%s-%s" .Release.Name "worldcheck-weekly-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.worldcheck.smartdelete.name" -}}
{{- printf "%s-%s" .Release.Name "worldcheck-smartdelete-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.factiva.daily.name" -}}
{{- printf "%s-%s" .Release.Name "factiva-daily-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cron.job.factiva.weekly.name" -}}
{{- printf "%s-%s" .Release.Name "factiva-weekly-cronjob" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "std.log4j2.volume" }}
- name: {{ .Release.Name }}-std-log4j2
  configMap:
    name: {{ .Release.Name }}-std-log4j2
{{- end }}

{{- define "std.log4j2.volume.mount" }}
- name: {{ .Release.Name }}-std-log4j2
  mountPath: /opt/netreveal/standaloneHome/log4j2
{{- end }}
