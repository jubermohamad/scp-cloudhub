{{/* Shared helpers for platform-services */}}

{{- define "platform-services.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: platform-services
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Read-write service host, namespace-qualified. */}}
{{- define "platform-services.postgresHost" -}}
{{- printf "%s-rw.%s.svc.cluster.local" .Values.postgres.clusterName .Release.Namespace -}}
{{- end }}

{{/*
Resolve owner role + password for a database entry.
Input: dict "root" . "db" <dbname>
Output: YAML {owner: ..., password: ...}
*/}}
{{- define "platform-services.dbCreds" -}}
{{- $root := .root -}}
{{- $db := .db -}}
{{- $spec := index $root.Values.databases $db | default dict -}}
{{- $owner := $spec.owner | default $db -}}
{{- $password := index $root.Values.rolePasswords $owner -}}
{{- if not $password -}}
{{- fail (printf "platform-services: rolePasswords.%s is required (database %s)" $owner $db) -}}
{{- end -}}
owner: {{ $owner }}
password: {{ $password | quote }}
{{- end }}

{{/*
P6(b): human-readable "<ns>/<name>, <ns>/<name>" list of the Deployment
candidates a preflight check looked for (used in the failure message).
*/}}
{{- define "platform-services.preflightCandidates" -}}
{{- $out := list -}}
{{- range .deployments -}}
{{- $out = append $out (printf "%s/%s" (.namespace | default "<release-ns>") .name) -}}
{{- end -}}
{{- join ", " $out -}}
{{- end -}}
