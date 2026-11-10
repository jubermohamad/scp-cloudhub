{{/*
    Multi Org Units functions
*/}}

{{- define "get.organisation.units.list" }}
  {{- $orgUnits := list }}
  {{- if and .Values.global.orgUnitWithMultiplePods (not (empty .Values.global.nrOrgUnits)) }}
    {{- range .Values.global.nrOrgUnits }}
      {{- $orgUnits = append $orgUnits .orgUnitCode }}
    {{- end }}
  {{- else }}
    {{- $orgUnits = append $orgUnits "" }}
  {{- end }}
{{- $orgUnits | toJson }}
{{- end }}
