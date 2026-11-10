{{- define "nrUi.pvcServerLogsStorage" -}}
{{ .Values.pvc.serverLogsStorage }}
{{- end -}}

{{- define "nrUi.pvcServerConfigurationHistoryStorage" -}}
{{ .Values.pvc.serverConfigurationHistoryStorage }}
{{- end -}}

{{- define "nrUi.pvcServerDeploymentsStorage" -}}
{{ .Values.pvc.serverLogsStorage }}
{{- end -}}

{{- define "nrUi.pvcApplicationLogsStorage" -}}
{{ .Values.pvc.applicationLogsStorage }}
{{- end -}}

{{- define "nrUi.pvcConfWlmStorage" -}}
{{ .Values.pvc.confWlmStorage }}
{{- end -}}

{{- define "nrUi.pvcConfFtsStorage" -}}
{{ .Values.pvc.confFtsStorage }}
{{- end -}}

{{- define "nrUi.pvcDataStorage" -}}
{{ .Values.pvc.dataStorage }}
{{- end -}}

{{- define "nrUi.pvcConfSamlStorage" -}}
{{ .Values.pvc.samlDataStorage }}
{{- end -}}

{{- define "nr.ui.elasticsearch.url" -}}
  {{- $namespace := .Values.global.namespace }}
    netreveal.search.url={{ .Values.baseConfigProperties.elasticsearch.protocol }}://opensearch-cluster-master-headless.{{ $namespace }}.svc.cluster.local:{{ .Values.baseConfigProperties.elasticsearch.port }}
{{- end -}}

{{- define "saml.base.config.properties" }}
  {{- if .Values.global.saml.enabled }}
    system.authentication=EXTERNAL
    system.authentication.external.mode=SAML
    saml.config.authentication.flow={{ .Values.saml.authenticationFlow }}
    saml.config.keystore.password={{ .Values.saml.keystorePassword }}
    saml.config.key.alias.name={{ .Values.saml.keyAliasName }}
    saml.config.key.alias.password={{ .Values.saml.keyAliasPassword }}
    {{- if ne .Values.saml.spOptionalDefaultIDP "" }}
    saml.config.sp.optional.defaultIDP={{ tpl .Values.saml.spOptionalDefaultIDP . }}
    {{- end }}
    {{- if .Values.saml.singleIDP }}
    {{- /* Single IDP */}}
    saml.config.idp.metadata.url={{ tpl .Values.saml.idpMetadataUrl . }}
    saml.config.idp.metadata.file=/opt/netreveal/uiHome/conf/saml/idp-metadata.xml
    {{- else }}
      {{- /* Multiple IDPs */}}
      {{- if ne (len .Values.saml.multipleIdpDefinition) 0 }}
        {{- $currentScope := .}}
        {{- $url := "" }}
        {{- $file := "" }}
        {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
          {{- if not (hasKey $value "idpMetadataUrl") }}
            {{- fail "NR-UI: Multiple IDPs 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataUrl' is not defined." }}
          {{- end }}
          {{- if eq $value.idpMetadataUrl "" }}
            {{- fail "NR-UI: Multiple IDPs 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataUrl' is empty." }}
          {{- end }}
          {{- if eq (len $url) 0 }}
            {{- with $currentScope }}
              {{- $url = (tpl $value.idpMetadataUrl .) }}
              {{- $file = print "/opt/netreveal/uiHome/conf/saml/idp-metadata-" $key ".xml" }}
            {{- end }}
          {{- else }}
            {{- with $currentScope }}
              {{- $url = print $url ", " (tpl $value.idpMetadataUrl .) }}
              {{- $file = print $file ", " "/opt/netreveal/uiHome/conf/saml/idp-metadata-" $key ".xml" }}
            {{- end }}
          {{- end }}
        {{- end }}
    saml.config.idp.metadata.url={{ $url }}
    saml.config.idp.metadata.file={{ $file}}
      {{- else }}
        {{ fail "NR-UI: 'nr-ui.saml.multipleIdpDefinition' is not defined." }}
      {{- end }}
    {{- end }}
    saml.config.sp.alias.name={{ .Values.saml.spAliasName }}
    saml.config.sp.endpoint.url={{ tpl .Values.saml.spEndpointUrl . }}
    saml.config.sp.optional.idpDiscoveryEnabled={{ .Values.saml.spOptionalIdpDiscoveryEnabled }}
    saml.user.groupSync={{ .Values.saml.userGroupSync }}
  {{- if .Values.saml.userDefaultGroupList }}
    saml.user.defaultGroupList={{ .Values.saml.userDefaultGroupList }}
  {{- end }}
    saml.config.sp.signature.algorithm.name={{ .Values.saml.spSignatureAlgorithmName }}
    saml.config.sp.signature.algorithm.uri={{ .Values.saml.spSignatureAlgorithmUri }}
    saml.config.sp.digest.algorithm.uri={{ .Values.saml.spDigestAlgorithmUri }}
    saml.config.username.with.domain={{ .Values.saml.usernameWithDomain }}
    saml.config.logger.logMessages={{ .Values.saml.loggerLogMessages }}
    saml.config.logger.logErrors={{ .Values.saml.loggerLogErrors }}
  {{- else }}
    system.authentication=INTERNAL
  {{- end }}
{{- end }}

{{- define "nr.ui.docker.image" -}}
  {{- if .Values.global.saml.enabled -}}
{{ .Values.global.dockerRegistryName }}/{{ .Values.pod.samlNrUiDockerImageName }}
  {{- else -}}
{{ .Values.global.dockerRegistryName }}/{{ .Values.pod.nrUiDockerImageName }}
  {{- end -}}
{{- end -}}

{{- define "saml.init.idp.file" }}
  {{- $defineMetadataFiles := false }}
  {{- $copyCommand := list }}
  {{- if .Values.saml.singleIDP }}
    {{- /* Single IDP */}}
    {{- if and .Values.global.saml.enabled .Values.saml.idpMetadataFile.generateFile }}
      {{- if and (ne .Values.saml.idpMetadataFile.secretName "") (ne .Values.saml.idpMetadataFile.secretKey "") }}
- name: saml-idp-metadata-file
  image: "{{- include "nr.ui.docker.image" . -}}"
  imagePullPolicy: IfNotPresent
  securityContext:
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    runAsNonRoot: true
  command:
    - /bin/bash
    - -exec
    - |
      cp /tmp/saml/idp-metadata.xml /opt/netreveal/uiHome/conf/saml/idp-metadata.xml

  {{- include "saml.volume.mount.idp.file" . | nindent 2 }}
      {{- else }}
      {{ fail "NR-UI: '.Values.saml.idpMetadataFile.secretName' or '.Values.saml.idpMetadataFile.secretKey' is not defined." }}
      {{- end }}
    {{- end }}
  {{- else }}
    {{- /* Multiple IDPs */}}
    {{- if ne (len .Values.saml.multipleIdpDefinition) 0 }}
      {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
        {{- if not (hasKey $value "idpMetadataFile") }}
          {{- fail "NR-UI: Multiple IDPs defintion 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile' is not defined." }}
        {{- end }}
        {{- if or (not (hasKey $value.idpMetadataFile "generateFile")) (not (hasKey $value.idpMetadataFile "secretName")) (not (hasKey $value.idpMetadataFile "secretKey")) }}
          {{- fail "NR-UI: Multiple IDPs defintion 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.generateFile', 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.secretName' or ''nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.secretKey' is not defined." }}
        {{- end }}
        {{- if $value.idpMetadataFile.generateFile }}
          {{- if and (ne $value.idpMetadataFile.secretName "") (ne $value.idpMetadataFile.secretKey "") }}
            {{- $defineMetadataFiles = true }}
            {{- $copyCommand = append $copyCommand (print "cp /tmp/saml/idp-metadata-" $key ".xml /opt/netreveal/uiHome/conf/saml/idp-metadata-" $key ".xml") }}
          {{- else }}
            {{ fail "NR-UI: Multiple IDPs defintion 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.secretName' or 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.secretKey' is not defined." }}
          {{- end }}
        {{- end }}
      {{- end }}
    {{- end }}
    {{- if $defineMetadataFiles }}
- name: saml-idp-metadata-file
  image: "{{- include "nr.ui.docker.image" . -}}"
  imagePullPolicy: IfNotPresent
  securityContext:
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    runAsNonRoot: true
  command:
    - /bin/bash
    - -exec
    - |
      {{- range $copyCommand }}
      {{ . }}
      {{- end }}

  {{- include "saml.volume.mount.idp.file" . | nindent 2 }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "saml.volume.mount.idp.file" }}
  {{- $generateFiles := false }}
  {{- if .Values.saml.singleIDP }}
    {{- /* Single IDP */}}
    {{- if and .Values.global.saml.enabled .Values.saml.idpMetadataFile.generateFile  }}
      {{- if and (ne .Values.saml.idpMetadataFile.secretName "") (ne .Values.saml.idpMetadataFile.secretKey "") }}
volumeMounts:
- name: {{ .Release.Name }}-saml-idp-metadata-file
  mountPath: /tmp/saml/idp-metadata.xml
  subPath: idp-metadata.xml
- name: {{ include "generate.name.with.release.name" (list $ . "ui-conf-saml") | quote }}
  mountPath: /opt/netreveal/uiHome/conf/saml
      {{- else }}
      {{ fail "NR-UI: '.Values.saml.idpMetadataFile.secretName' or '.Values.saml.idpMetadataFile.secretKey' is not defined." }}
      {{- end }}
    {{- end }}
  {{- else }}
    {{- /* Multiple IDPs */}}
    {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
      {{- if $value.idpMetadataFile.generateFile }}
        {{- $generateFiles = true }}
      {{- end }}
    {{- end }}
    {{- if $generateFiles }}
volumeMounts:
- name: {{ include "generate.name.with.release.name" (list $ . "ui-conf-saml") | quote }}
  mountPath: /opt/netreveal/uiHome/conf/saml
      {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
        {{- if $value.idpMetadataFile.generateFile }}
- name: {{ $.Release.Name }}-saml-idp-metadata-file-{{ $key }}
  mountPath: /tmp/saml/idp-metadata-{{ $key }}.xml
  subPath: idp-metadata-{{ $key }}.xml
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "saml.volume.idp.file" }}
  {{- if .Values.saml.singleIDP }}
    {{- /* Single IDP */}}
    {{- if and .Values.global.saml.enabled .Values.saml.idpMetadataFile.generateFile }}
      {{- if and (ne .Values.saml.idpMetadataFile.secretName "") (ne .Values.saml.idpMetadataFile.secretKey "") }}
- name: {{ .Release.Name }}-saml-idp-metadata-file
  secret:
    secretName: "{{ .Values.saml.idpMetadataFile.secretName }}"
    items:
    - key: "{{ .Values.saml.idpMetadataFile.secretKey }}"
      path: idp-metadata.xml
      {{- else }}
        {{ fail "NR-UI: '.Values.saml.idpMetadataFile.secretName' or '.Values.saml.idpMetadataFile.secretKey' is not defined." }}
      {{- end }}
    {{- end }}
  {{- else }}
  {{- /* Multiple IDPs */}}
    {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
      {{- if $value.idpMetadataFile.generateFile }}
        {{- if and (ne $value.idpMetadataFile.secretName "") (ne $value.idpMetadataFile.secretKey "") }}
- name: {{ $.Release.Name }}-saml-idp-metadata-file-{{ $key }}
  secret:
    secretName: "{{ $value.idpMetadataFile.secretName }}"
    items:
    - key: "{{ $value.idpMetadataFile.secretKey }}"
      path: idp-metadata-{{ $key }}.xml
        {{- else }}
          {{ fail "NR-UI: 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.secretName' or 'nr-ui.saml.multipleIdpDefinition[*].idpMetadataFile.secretKey' is not defined." }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "nr.ui.log4j2.volume" }}
- name: {{ .Release.Name }}-ui-log4j2
  configMap:
    name: {{ .Release.Name }}-ui-log4j2
{{- end }}

{{- define "nr.ui.log4j2.volume.mount" }}
- name: {{ .Release.Name }}-ui-log4j2
  mountPath: /opt/netreveal/uiHome/log4j2
{{- end }}

{{- define "nr.ui.saml.volumes.ui" }}
  {{- if not .Values.saml.useExternalKeystore }}
- name: {{ .Release.Name }}-saml-application-crt
  secret:
    secretName: "{{ .Release.Name }}-application-keycloak-crt"
    items:
    - key: "keystore.p12"
      path: app-saml.jks
  {{- else }}
    {{- if eq .Values.saml.samlNrUiCertificate.secretName "" -}}
      {{- fail "NR-UI: 'nr-ui.saml.samlNrUiCertificate.secretName' is empty." }}
    {{- end }}
    {{- if or (eq .Values.saml.samlNrUiCertificate.keyForCertificateKey "") (eq .Values.saml.samlNrUiCertificate.keyForCertificate "") -}}
      {{- fail "NR-UI: 'nr-ui.saml.samlNrUiCertificate.keyForCertificateKey' and/or 'nr-ui.saml.samlNrUiCertificate.keyForCertificate' is empty." }}
    {{- end }}
- name: {{ .Release.Name }}-saml-nr-ui-cert
  secret:
    secretName: "{{ tpl .Values.saml.samlNrUiCertificate.secretName . }}"
    items:
    - key: "{{ tpl .Values.saml.samlNrUiCertificate.keyForCertificateKey . }}"
      path: tls.key
    - key: "{{ tpl .Values.saml.samlNrUiCertificate.keyForCertificate . }}"
      path: tls.crt
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.volumes.idp" }}
  {{- $currentScope := .}}
  {{- if .Values.saml.singleIDP }}
    {{- /* Single IDP */}}
    {{- if not .Values.saml.useExternalKeystore }}
- name: {{ .Release.Name }}-idp-crt
  secret:
    secretName: "{{ .Release.Name }}-keycloak-crt"
    items:
    - key: "keystore.p12"
      path: idp.jks
    {{- else }}
      {{- if ne .Values.saml.samlIdpCertificate.secretName "" }}
        {{- if ne .Values.saml.samlIdpCertificate.keyForSignedCertificate "" }}
- name: {{ .Release.Name }}-saml-idp-cert
  secret:
    secretName: "{{ tpl .Values.saml.samlIdpCertificate.secretName . }}"
    items:
    - key: "{{ tpl .Values.saml.samlIdpCertificate.keyForSignedCertificate . }}"
      path: tls.cer
        {{- else }}
          {{- if and (ne .Values.saml.samlIdpCertificate.keyForCertificateKey "") (ne .Values.saml.samlIdpCertificate.keyForCertificate "") }}
- name: {{ .Release.Name }}-saml-idp-cert
  secret:
    secretName: "{{ tpl .Values.saml.samlIdpCertificate.secretName . }}"
    items:
    - key: "{{ tpl .Values.saml.samlIdpCertificate.keyForCertificateKey . }}"
      path: tls.key
    - key: "{{ tpl .Values.saml.samlIdpCertificate.keyForCertificate . }}"
      path: tls.crt
          {{- else }}
            {{ fail "NR-UI: 'nr-ui.saml.samlIdpCertificate.keyForCertificateKey' and/or 'nr-ui.saml.samlIdpCertificate.keyForCertificate' are not defined." }}
          {{- end }}
        {{- end }}
      {{- else }}
        {{ fail "NR-UI: 'nr-ui.saml.samlIdpCertificate.secretName' is empty." }}
      {{- end }}
    {{- end }}
  {{- else }}
    {{- /* Multiple IDPs */}}
    {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
      {{- if not $value.useExternalKeystore }}
- name: {{ $.Release.Name }}-idp-crt-{{ $key }}
  secret:
    secretName: "{{ $.Release.Name }}-keycloak-crt"
    items:
    - key: "keystore.p12"
      path: idp.jks
      {{- else }}
        {{- if not (hasKey $value.samlIdpCertificate "secretName") }}
          {{- fail "NR-UI: 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.secretName' is not defined." }}
        {{- end }}
        {{- if ne $value.samlIdpCertificate.secretName "" }}
          {{- if or (not (hasKey $value.samlIdpCertificate "keyForCertificateKey")) (not (hasKey $value.samlIdpCertificate "keyForCertificate")) (not (hasKey $value.samlIdpCertificate "keyForSignedCertificate")) }}
            {{- fail "NR-UI: 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.keyForCertificateKey', 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.keyForCertificate' and/or 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.keyForSignedCertificate' is not defined." }}
          {{- end }}
          {{- if ne $value.samlIdpCertificate.keyForSignedCertificate "" }}
            {{- with $currentScope }}
- name: {{ .Release.Name }}-saml-idp-cert-{{ $key }}
  secret:
    secretName: "{{ tpl $value.samlIdpCertificate.secretName . }}"
    items:
    - key: "{{ tpl $value.samlIdpCertificate.keyForSignedCertificate . }}"
      path: tls-{{ $key }}.cer
            {{- end }}
          {{- else }}
            {{- if and (ne $value.samlIdpCertificate.keyForCertificateKey "") (ne $value.samlIdpCertificate.keyForCertificate "") }}
              {{- with $currentScope }}
- name: {{ .Release.Name }}-saml-idp-cert-{{ $key }}
  secret:
    secretName: "{{ tpl $value.samlIdpCertificate.secretName . }}"
    items:
    - key: "{{ tpl $value.samlIdpCertificate.keyForCertificateKey . }}"
      path: tls-{{ $key }}.key
    - key: "{{ tpl $value.samlIdpCertificate.keyForCertificate . }}"
      path: tls-{{ $key }}.crt
              {{- end }}
            {{- else }}
              {{ fail "NR-UI: 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.keyForCertificateKey' and/or 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.keyForCertificate' are not defined." }}
            {{- end }}
          {{- end }}
        {{- else }}
          {{- fail "NR-UI: 'nr-ui.saml.multipleIdpDefinition[*].samlIdpCertificate.secretName' is empty." }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.volumes" }}
  {{- if .Values.global.saml.enabled }}
- name: {{ .Release.Name }}-tmp-saml-keystore
  emptyDir: {}
{{- include "saml.volume.idp.file" . }}
{{- include "nr.ui.saml.volumes.ui" . }}
{{- include "nr.ui.saml.volumes.idp" . }}
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.volumeMounts.certInit.ui" }}
- name: {{ .Release.Name }}-tmp-saml-keystore
  mountPath: /tmp/saml
  {{- if not .Values.saml.useExternalKeystore }}
- name: {{ .Release.Name }}-saml-application-crt
  mountPath: /tmp/app-saml.jks
  subPath: app-saml.jks
  {{- else }}
- name: {{ .Release.Name }}-saml-nr-ui-cert
  mountPath: /tmp/ui-tls.key
  subPath: tls.key
- name: {{ .Release.Name }}-saml-nr-ui-cert
  mountPath: /tmp/ui-tls.crt
  subPath: tls.crt
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.volumeMounts.certInit.idp" }}
  {{- if .Values.saml.singleIDP }}
    {{- /* Single IDP */}}
    {{- if not .Values.saml.useExternalKeystore }}
- name: {{ .Release.Name }}-idp-crt
  mountPath: /tmp/idp.jks
  subPath: idp.jks
    {{- else }}
      {{- if ne .Values.saml.samlIdpCertificate.keyForSignedCertificate "" }}
- name: {{ .Release.Name }}-saml-idp-cert
  mountPath: /tmp/idp-tls.cer
  subPath: tls.cer
      {{- else }}
- name: {{ .Release.Name }}-saml-idp-cert
  mountPath: /tmp/idp-tls.key
  subPath: tls.key
- name: {{ .Release.Name }}-saml-idp-cert
  mountPath: /tmp/idp-tls.crt
  subPath: tls.crt
      {{- end }}
    {{- end }}
  {{- else }}
    {{- /* Multiple IDPs */}}
    {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
      {{- if not $value.useExternalKeystore }}
- name: {{ $.Release.Name }}-idp-crt-{{ $key }}
  mountPath: /tmp/idp-{{ $key }}.jks
  subPath: idp.jks
      {{- else }}
        {{- if ne $value.samlIdpCertificate.keyForSignedCertificate "" }}
- name: {{ $.Release.Name }}-saml-idp-cert-{{ $key }}
  mountPath: /tmp/idp-tls-{{ $key }}.cer
  subPath: tls-{{ $key }}.cer
        {{- else }}
- name: {{ $.Release.Name }}-saml-idp-cert-{{ $key }}
  mountPath: /tmp/idp-tls-{{ $key }}.key
  subPath: tls-{{ $key }}.key
- name: {{ $.Release.Name }}-saml-idp-cert-{{ $key }}
  mountPath: /tmp/idp-tls-{{ $key }}.crt
  subPath: tls-{{ $key }}.crt
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.volumeMounts.certInit" }}
  {{- if .Values.global.saml.enabled }}
{{- include "nr.ui.saml.volumeMounts.certInit.ui" . }}
{{- include "nr.ui.saml.volumeMounts.certInit.idp" . }}
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.command.initKeysore.ui" }}
cp /opt/tools/java/lib/security/cacerts /tmp/saml/samlKeystore.jks
keytool -storepasswd -new $KEYSTORE_PASS -keystore /tmp/saml/samlKeystore.jks -storepass changeit
  {{- if not .Values.saml.useExternalKeystore }}
/opt/tools/java/bin/keytool -importkeystore -srckeystore /tmp/app-saml.jks -srcalias 1 -destkeystore /tmp/saml/samlKeystore.jks -destalias {{ .Values.saml.keyAliasName }} -srcstorepass $KEYSTORE_PASS -deststorepass $KEYSTORE_PASS -noprompt
  {{- else }}
openssl pkcs12 -export -in /tmp/ui-tls.crt -inkey /tmp/ui-tls.key -out /tmp/saml/saml-ui.p12 -password pass:$KEYSTORE_PASS
/opt/tools/java/bin/keytool -importkeystore -srckeystore /tmp/saml/saml-ui.p12 -srcalias 1 -destkeystore /tmp/saml/samlKeystore.jks -destalias {{ .Values.saml.keyAliasName }} -srcstorepass $KEYSTORE_PASS -deststorepass $KEYSTORE_PASS -noprompt
rm /tmp/saml/saml-ui.p12
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.command.initKeysore" }}
  {{- if .Values.global.saml.enabled }}
{{- include "nr.ui.saml.command.initKeysore.ui" . }}
    {{- if .Values.saml.singleIDP }}
      {{- /* Single IDP */}}
      {{- if not .Values.saml.useExternalKeystore }}
/opt/tools/java/bin/keytool -importkeystore -srckeystore /tmp/idp.jks -srcalias 1 -destkeystore /tmp/saml/samlKeystore.jks -destalias idp -srcstorepass $KEYSTORE_PASS -deststorepass $KEYSTORE_PASS -noprompt
      {{- else }}
        {{- if ne .Values.saml.samlIdpCertificate.keyForSignedCertificate "" }}
/opt/tools/java/bin/keytool -import -alias idp -keystore /tmp/saml/samlKeystore.jks -file /tmp/idp-tls.cer -storepass $KEYSTORE_PASS -noprompt
        {{- else }}
openssl pkcs12 -export -in /tmp/idp-tls.crt -inkey /tmp/idp-tls.key -out /tmp/saml/saml-idp.p12 -password pass:$KEYSTORE_PASS
/opt/tools/java/bin/keytool -importkeystore -srckeystore /tmp/saml/saml-idp.p12 -srcalias 1 -destkeystore /tmp/saml/samlKeystore.jks -destalias idp -srcstorepass $KEYSTORE_PASS -deststorepass $KEYSTORE_PASS -noprompt
rm /tmp/saml/saml-idp.p12
        {{- end }}
      {{- end }}
    {{- else }}
      {{- /* Multiple IDPs */}}
      {{- range $key, $value := .Values.saml.multipleIdpDefinition }}
        {{- if not $value.useExternalKeystore }}
/opt/tools/java/bin/keytool -importkeystore -srckeystore /tmp/idp-{{ $key }}.jks -srcalias 1 -destkeystore /tmp/saml/samlKeystore.jks -destalias idp-{{ $key }} -srcstorepass $KEYSTORE_PASS -deststorepass $KEYSTORE_PASS -noprompt
        {{- else }}
          {{- if ne $value.samlIdpCertificate.keyForSignedCertificate "" }}
/opt/tools/java/bin/keytool -import -alias idp-{{ $key }} -keystore /tmp/saml/samlKeystore.jks -file /tmp/idp-tls-{{ $key }}.cer -storepass $KEYSTORE_PASS -noprompt
          {{- else }}
openssl pkcs12 -export -in /tmp/idp-tls-{{ $key }}.crt -inkey /tmp/idp-tls-{{ $key }}.key -out /tmp/saml/saml-idp-{{ $key }}.p12 -password pass:$KEYSTORE_PASS
/opt/tools/java/bin/keytool -importkeystore -srckeystore /tmp/saml/saml-idp-{{ $key }}.p12 -srcalias 1 -destkeystore /tmp/saml/samlKeystore.jks -destalias idp-{{ $key }} -srcstorepass $KEYSTORE_PASS -deststorepass $KEYSTORE_PASS -noprompt
rm /tmp/saml/saml-idp-{{ $key }}.p12
          {{- end }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{- define "nr.ui.saml.volumeMounts.nrUi" }}
  {{- if .Values.global.saml.enabled }}
- name: {{ include "generate.name.with.release.name" (list $ . "ui-conf-saml") | quote }}
  mountPath: /opt/netreveal/uiHome/conf/saml
- name: {{ .Release.Name }}-tmp-saml-keystore
  mountPath: /opt/netreveal/uiHome/conf/saml/security/samlKeystore.jks
  subPath: samlKeystore.jks
  {{- end }}
{{- end }}


{{- define "saml.secret.reloader.list" -}}
  {{- $labels := "" }}
  {{- $currentScope := .}}

  {{- if .Values.global.saml.enabled }}
    {{- if not .Values.saml.useExternalKeystore }}
      {{- if eq (len $labels) 0 -}}
        {{- $labels = (print .Release.Name "-application-keycloak-crt") }}
      {{- else -}}
        {{- $labels = (print $labels "," .Release.Name "-application-keycloak-crt") }}
      {{- end -}}
    {{- else -}}
      {{- if eq (len $labels) 0 -}}
        {{- $labels = (print (tpl .Values.saml.samlNrUiCertificate.secretName . )) }}
      {{- else -}}
        {{- $labels = (print $labels "," (tpl .Values.saml.samlNrUiCertificate.secretName . )) }}
      {{- end -}}
    {{- end -}}
    {{- if .Values.saml.singleIDP -}}
      {{- if not .Values.saml.useExternalKeystore }}
        {{- if eq (len $labels) 0 -}}
          {{- $labels = (print .Release.Name "-keycloak-crt") }}
        {{- else -}}
          {{- $labels = (print $labels "," .Release.Name "-keycloak-crt") }}
        {{- end -}}
      {{- else -}}
        {{- if eq (len $labels) 0 -}}
          {{- $labels = (print (tpl .Values.saml.samlIdpCertificate.secretName .)) }}
        {{- else -}}
          {{- $labels = (print $labels "," (tpl .Values.saml.samlIdpCertificate.secretName .)) }}
        {{- end -}}
      {{- end -}}
      {{- if .Values.saml.idpMetadataFile.generateFile  -}}
        {{- if and (ne .Values.saml.idpMetadataFile.secretName "") (ne .Values.saml.idpMetadataFile.secretKey "") -}}
          {{- if eq (len $labels) 0 -}}
            {{- $labels = .Values.saml.idpMetadataFile.secretName }}
          {{- else -}}
            {{- $labels = (print $labels "," .Values.saml.idpMetadataFile.secretName) }}
          {{- end -}}
        {{- end -}}
      {{- end -}}
    {{- else -}}
      {{- range $key, $value := .Values.saml.multipleIdpDefinition -}}
        {{- if $value.idpMetadataFile.generateFile -}}
          {{- if eq (len $labels) 0 -}}
            {{- $labels = $value.idpMetadataFile.secretName }}
          {{- else -}}
            {{- $labels = (print $labels "," $value.idpMetadataFile.secretName) }}
          {{- end -}}
        {{- end -}}
        {{- if not $value.useExternalKeystore -}}
          {{- if eq (len $labels) 0 }}
            {{- $labels = (print $.Release.Name "-keycloak-crt") }}
          {{- else -}}
            {{- $labels = (print $labels "," $.Release.Name "-keycloak-crt") }}
          {{- end -}}
        {{- else -}}
          {{- if eq (len $labels) 0 -}}
            {{- with $currentScope -}}
              {{- $labels = (print (tpl $value.samlIdpCertificate.secretName .)) }}
            {{- end -}}
          {{- else -}}
            {{- with $currentScope -}}
              {{- $labels = (print $labels "," (tpl $value.samlIdpCertificate.secretName .)) }}
            {{- end -}}
          {{- end -}}
        {{- end -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}

  {{- if ne (len $labels) 0 -}}
{{- (print "," $labels) -}}
  {{- end -}}
{{- end -}}
