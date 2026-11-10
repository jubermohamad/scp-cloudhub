{{/*
Fully qualified release name. Trims "<name>-lens" → "<name>" when chart name is already in release name.
*/}}
{{- define "lens.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "lens.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/part-of: lens
{{- end }}

{{/*
Base DATABASE_URL (password injected at runtime via $(POSTGRES_PASSWORD) env substitution).
*/}}
{{- define "lens.databaseUrl" -}}
postgresql://{{ .Values.postgres.username }}:$(POSTGRES_PASSWORD)@{{ include "lens.postgresHost" . }}:{{ .Values.postgres.port }}/{{ .Values.postgres.database }}
{{- end }}

{{/*
Image pull secrets — always derived from imageCredentials.secretName so
the pull secret and the Secret resource name can never diverge.
*/}}
{{- define "lens.imagePullSecrets" -}}
- name: {{ .Values.imageCredentials.secretName }}
{{- end }}

{{/*
Postgres service hostname. Uses the existing service name when postgres.enabled
is false, otherwise the Helm-managed StatefulSet service.
*/}}
{{- define "lens.postgresHost" -}}
{{- if .Values.postgres.enabled }}
{{- printf "%s-postgres" (include "lens.fullname" .) }}
{{- else }}
{{- .Values.postgres.host }}
{{- end }}
{{- end }}

{{/*
The pull secret's .dockerconfigjson, ALREADY base64 — three sources, in order.

WHY THIS EXISTS. Lens required three values of its own to pull its images —
`imageCredentials.registry`, `.username` and `.password` — and every one of them
duplicated the platform pull secret the operator ALSO had to supply as
`global.pullSecrets.dockerconfigjson`. Verified in a live cluster: the four
Secrets `symphonyfs-acr-secret`, `lens-acr-secret`, `regcred` and `regcred-acr`
were byte-identical, same registry, same user, same token. Four copies of one
credential, and a new environment had to be told the same secret twice, in two
different files, in two different shapes.

Duplication of a credential is not just tedious. It is the failure this platform
has already had twice this week in another form: two keys that must hold one
value, drifting apart silently, and the symptom arriving much later as a 401 that
names nothing. Rotating the token means remembering the second copy.

ORDER, most specific first, so nothing that works today stops working:
  1. imageCredentials.dockerConfigJson — an explicit blob, PLAIN json, encoded here.
  2. imageCredentials.username        — the legacy three-field form, still honoured
                                        for a registry that genuinely differs from
                                        the platform's.
  3. global.pullSecrets.dockerconfigjson — the platform pull secret, ALREADY
                                        base64, so it is passed through untouched
                                        rather than double-encoded.
*/}}
{{- define "lens.dockerConfigJsonB64" -}}
{{- $ic := .Values.imageCredentials -}}
{{- if $ic.dockerConfigJson -}}
{{- $ic.dockerConfigJson | b64enc -}}
{{- else if $ic.username -}}
{{- printf "{\"auths\":{\"%s\":{\"username\":\"%s\",\"password\":\"%s\",\"auth\":\"%s\"}}}" $ic.registry $ic.username $ic.password (printf "%s:%s" $ic.username $ic.password | b64enc) | b64enc -}}
{{- else -}}
{{- $global := (((.Values.global | default dict).pullSecrets) | default dict).dockerconfigjson | default "" -}}
{{- if not $global -}}
{{- fail "lens needs a pull secret: set global.pullSecrets.dockerconfigjson (the platform one — normal), or imageCredentials.dockerConfigJson / .username+.password for a registry of its own." -}}
{{- end -}}
{{- $global -}}
{{- end -}}
{{- end }}
