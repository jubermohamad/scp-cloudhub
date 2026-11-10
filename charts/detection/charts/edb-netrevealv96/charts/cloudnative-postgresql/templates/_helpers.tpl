{{- define "postgresql-hba-config" -}}
{{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") }}
pg_hba:
- hostssl {{ .Values.global.baseConfigProperties.db.postgresql.database }} all all scram-sha-256
{{- end }}
{{- end -}}

{{- define "initdb" -}}
database: netreveal
owner: apps
secret:
  name: postgres-credential-apps-user-cnpg
postInitApplicationSQLRefs:
  secretRefs:
  - name: postgres-credential-users-sql
    key: aap_role_and_schema.sql
  - name: postgres-credential-users-sql
    key: apps_schema.sql
  - name: postgres-credential-users-sql
    key: appskeycloak_role_and_schema.sql
  - name: postgres-credential-users-sql
    key: apps_import_schema.sql
{{- if .Values.global.nrSubChartSwitches.enableER }}
  - name: {{ .Release.Name }}-er-role-sql-secret
    key: er_role.sql
  - name: {{ .Release.Name }}-er-user-sql-secret
    key: er_user.sql
{{- end }}
{{- end }}

{{- define "postgresql.dnsNames" -}}
{{- $clusterName := include "generate.name.with.release.name" (list $ . .Values.global.database.dbMainInstanceName) -}}
{{- $clusterNameBackup := include "generate.name.with.release.name" (list $ . .Values.global.database.dbBackUpInstanceName) -}}
{{- $namespace := .Values.global.namespace -}}
- localhost
{{- range $role := list "rw" "ro" "r" }}
- {{ $clusterName }}-{{ $role }}
- {{ $clusterName }}-{{ $role }}.{{ $namespace }}
- {{ $clusterName }}-{{ $role }}.{{ $namespace }}.svc
- {{ $clusterName }}-{{ $role }}.{{ $namespace }}.svc.cluster.local
- {{ $clusterNameBackup }}-{{ $role }}
- {{ $clusterNameBackup }}-{{ $role }}.{{ $namespace }}
- {{ $clusterNameBackup }}-{{ $role }}.{{ $namespace }}.svc
- {{ $clusterNameBackup }}-{{ $role }}.{{ $namespace }}.svc.cluster.local
{{- end }}
{{- end }}

{{- define "postgresql.service.name" -}}
  {{- if eq .Values.global.database.bootstrapType "recovery" -}}
{{- include "generate.name.with.release.name" (list $ . .Values.global.database.dbBackUpInstanceName) | quote -}}
  {{- else }}
{{- include "generate.name.with.release.name" (list $ . .Values.global.database.dbMainInstanceName) | quote -}}
  {{- end -}}
{{- end -}}

{{- define "postgresql.service.name.no.quotes" -}}
  {{- if eq .Values.global.database.bootstrapType "recovery" -}}
{{- include "generate.name.with.release.name" (list $ . .Values.global.database.dbBackUpInstanceName) -}}
  {{- else }}
{{- include "generate.name.with.release.name" (list $ . .Values.global.database.dbMainInstanceName) -}}
  {{- end -}}
{{- end -}}
