{{/* Platform naming: every resource is {{ .Release.Name }}-data-fin-pipeline-svc-<component>.
     "fin-pipeline-svc", NOT "pipeline": the sibling fin-pipeline chart already
     renders <release>-data-pipeline-* (its componentNames tier) — colliding
     prefixes in the shared namespace are the exact incident class the SRI naming
     convention exists to prevent.

     STILL DIVERGENT FROM THE PRE-RE-VENDOR COPY, deliberately: the `app:` labels
     read `pipeline-<component>` here where they used to read
     `fin-pipeline-svc-<component>`, and valkey's StatefulSet serviceName is the
     bare `valkey`. Both are IMMUTABLE fields on live objects — a Deployment's
     spec.selector and a StatefulSet's serviceName cannot be patched — so
     correcting them in place makes helm fail the upgrade instead of fixing it,
     and needs the affected workloads deleted first. They are internally
     consistent and working as they stand; the cost is only that a generic
     `app: valkey` selector could collide in a shared namespace.

     RE-APPLY THIS AFTER EVERY RE-VENDOR. Upstream hardcodes generic names
     (pipeline-config-svc, valkey, ...) because it installs into a namespace of
     its own; a wholesale copy silently reverts the prefix and the collision risk
     comes straight back. */}}
{{- define "finPipeline.prefix" -}}
{{- .Release.Name }}-data-fin-pipeline-svc
{{- end -}}

{{/* Full image ref for a platform service. */}}
{{/* Component image. `tag` is OPTIONAL and falls back to the stack-wide
     image.tag — so one service can be moved to a branch build (a feature image,
     a hotfix) without dragging its siblings off the shared tag. */}}
{{- define "finPipeline.image" -}}
{{ .root.Values.image.registry }}/{{ .root.Values.image.prefix }}/{{ .name }}:{{ .tag | default .root.Values.image.tag }}
{{- end -}}

{{/* Pod annotations block (gitSha stamp etc.) — rendered into EVERY pod
     template so a CD-stamped annotation rolls every service. */}}
{{- define "finPipeline.podAnnotations" -}}
{{- with .Values.podAnnotations }}
annotations:
{{- range $k, $v := . }}
  {{ $k }}: {{ $v | quote }}
{{- end }}
{{- end }}
{{- end -}}
