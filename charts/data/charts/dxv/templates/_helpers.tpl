
{{- define "storage.storageClassName" -}}
{{ .Values.global.pv.storageClassName | default "default" }}
{{- end -}}

{{- define "storage.rwmStorageClassName" -}}
{{ .Values.global.pv.rwmStorageClassName }}
{{- end -}}

{{- define "storage.class.name.selectStorageClassName" -}}
    {{- if eq .Values.global.clusterType "nfs" -}}
{{ printf "\"%s\"" ""}}
    {{- else -}}
{{ include "storage.storageClassName" . }}
    {{- end -}}
{{- end -}}

{{- define "storage.selectStorageClassName" }}
storageClassName: {{ include "storage.class.name.selectStorageClassName" . }}
{{- end }}

{{- define "storage.class.name.selectRwmStorageClassName" }}
    {{- if (or (eq .Values.global.clusterType "nfs") (eq .Values.global.clusterType "minikube")) -}}
{{ include "storage.storageClassName" . }}
    {{ else -}}
{{ include "storage.rwmStorageClassName" . }}
    {{- end -}}
{{- end -}}

{{- define "storage.selectRwmStorageClassName" }}
storageClassName: {{ include "storage.class.name.selectRwmStorageClassName" . }}
{{- end }}

{{- define "storage.pvc.annotations" }}
    {{- $ := index . 0 }}
    {{- $pvcType := index . 2 }}
    {{- $pvcStorageClass := index . 3 }}
    {{- $storageClassDefined := hasKey $.Values.global.pvcAnnotations $pvcStorageClass  }}
    {{- if $storageClassDefined }}
    {{- $storageClassValue := get $.Values.global.pvcAnnotations $pvcStorageClass }}
        {{- if $storageClassValue.annotations }}
            {{- if eq $pvcType "with-annotation-label" }}
annotations:
            {{- end }}
{{ toYaml $storageClassValue.annotations | indent 2 }}
        {{- end }}
    {{- end }}
{{- end }}

{{- define "secret.s3.private.bucket.name" -}}
{{- printf "minio-sftp-creds" -}}
{{- end -}}


{{- define "minio.url" -}}
    {{- /* the bundled minio chart ignores global.namespace (deploys into the
         release namespace) and is renamed away from the minio-operator
         tenant's minio/minio-console Services. The NAME is global because this
         helper is included from the minio-provisioner subchart's context,
         which cannot see dxv's `minio.fullnameOverride` (naming migration). */ -}}
    http://{{ (.Values.global).minioServiceName | default "dxv-minio" }}.{{ .Release.Namespace }}.svc.cluster.local:9000
{{- end -}}


{{- define "ingress.host.name" -}}
    {{- $ := index . 0 }}
    {{- $subChart := index . 2 }}

    {{- if ne $subChart "" -}}
      {{- $subChart = print "-" $subChart -}}
    {{- end -}}

    {{- if and (ne $.Values.global.envType "production") (ne $.Values.global.envType "prod") (ne $.Values.global.envType "") -}}
{{ $.Values.global.ingressPrefix }}{{ $subChart }}-{{ $.Values.global.envType }}-{{ $.Values.global.clientSubDomain }}.{{ $.Values.global.ingressWildCardDns }}
    {{- else -}}
{{ $.Values.global.ingressPrefix }}{{ $subChart }}-{{ $.Values.global.clientSubDomain }}.{{ $.Values.global.ingressWildCardDns }}
    {{- end -}}
{{- end -}}


{{- define "generate.name.with.release.name" -}}
    {{- $ := index . 0 -}}
    {{- $name := index . 2 -}}
    {{- if $.Values.global.prefixPvcWithReleaseName -}}
{{- print $.Release.Name "-" $name -}}
    {{- else -}}
{{- print $name -}}
    {{- end -}}
{{- end -}}

{{- define "secret-volumes.external.certificates" }}
  {{- $importExternalCertificated := false }}
  {{- if .Values.global.externalCertificates }}
    {{- if gt (len .Values.global.externalCertificates) 0 }}
      {{- range $key, $value := .Values.global.externalCertificates }}
        {{- $importExternalCertificated = true }}
- name: {{ $.Release.Name }}-{{ $key | replace "_" "-" }}-external-cert
  secret:
    secretName: {{ $value.secretName }}
      {{- end -}}
    {{- end -}}
  {{- end -}}
  {{- if $importExternalCertificated }}
- name: {{ $.Release.Name }}-tmp-external-cert
  emptyDir: {}
  {{- end }}
{{- end }}

{{- define "secret-volume-mounts.external.certificates" }}
  {{- $importExternalCertificated := false }}
  {{- if .Values.global.externalCertificates }}
    {{- if gt (len .Values.global.externalCertificates) 0 }}
      {{- range $key, $value := .Values.global.externalCertificates }}
        {{- $importExternalCertificated = true }}
- name: {{ $.Release.Name }}-{{ $key | replace "_" "-" }}-external-cert
  mountPath: /{{ $key }}
      {{- end }}
    {{- end }}
  {{- end }}
  {{- if $importExternalCertificated }}
- name: {{ $.Release.Name }}-tmp-external-cert
  mountPath: /tmp/external-certificates
  {{- end }}
{{- end }}



{{- define "image.pull.secrets" }}
  {{- if eq .Values.global.useImagePullSecrets "true" }}
    {{- if .Values.global.netreveal.imagePullSecrets }}
imagePullSecrets:
  {{ toYaml .Values.global.netreveal.imagePullSecrets}}
    {{- end }}
  {{- end }}
{{- end }}

