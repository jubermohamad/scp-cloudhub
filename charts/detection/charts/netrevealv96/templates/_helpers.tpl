
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

{{- define "db.host" -}}
    {{- if and (ne .Values.global.database.bootstrapType "initdb") (ne .Values.global.database.bootstrapType "recovery") -}}
    {{ fail (printf "'global.database.bootstrapType' can be defined with 'initdb' or 'recovery' value. Current value: %s" .Values.global.database.bootstrapType) }}
    {{- end -}}
    {{- if eq .Values.global.database.bootstrapType "recovery" -}}
    {{ include "generate.name.with.release.name" (list $ . .Values.global.database.dbBackUpInstanceName) }}-rw.{{ .Values.global.namespace }}.svc.cluster.local
    {{- else -}}
    {{ include "generate.name.with.release.name" (list $ . .Values.global.database.dbMainInstanceName) }}-rw.{{ .Values.global.namespace }}.svc.cluster.local
    {{- end -}}
{{- end -}}

{{- define "db.host.r" -}}
    {{- if and (ne .Values.global.database.bootstrapType "initdb") (ne .Values.global.database.bootstrapType "recovery") -}}
    {{ fail (printf "'global.database.bootstrapType' can be defined with 'initdb' or 'recovery' value. Current value: %s" .Values.global.database.bootstrapType) }}
    {{- end -}}
    {{- if eq .Values.global.database.bootstrapType "recovery" -}}
    {{ include "generate.name.with.release.name" (list $ . .Values.global.database.dbBackUpInstanceName) }}-r.{{ .Values.global.namespace }}.svc.cluster.local
    {{- else -}}
    {{ include "generate.name.with.release.name" (list $ . .Values.global.database.dbMainInstanceName) }}-r.{{ .Values.global.namespace }}.svc.cluster.local
    {{- end -}}
{{- end -}}

{{- define "db.url" -}}
    {{ include "db.host" . }}:{{ .Values.global.baseConfigProperties.db.postgresql.port }}
{{- end -}}

{{- define "db.jdbc.url" }}
{{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") -}}
    jdbc:postgresql://{{ include "db.url" . }}/{{ .Values.global.baseConfigProperties.db.postgresql.database }}?sslmode={{ .Values.global.baseConfigProperties.db.postgresql.sslmode }}&sslrootcert={{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}
{{- else -}}
    jdbc:postgresql://{{ include "db.url" . }}/{{ .Values.global.baseConfigProperties.db.postgresql.database }}
{{- end -}}
{{- end -}}

{{- define "postgres.server.secret-volume" -}}
{{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") -}}
- name: postgresql-cert-ca
  secret:
    secretName: {{ .Release.Name }}-postgres-server-cert
    items:
    - key: ca.crt
      path: ca.crt
{{- end -}}
{{- end -}}

{{- define "postgres.server.secret-mount" -}}
{{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") -}}
- name: postgresql-cert-ca
  mountPath: {{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}
  subPath: ca.crt
{{- end -}}
{{- end -}}

{{- define "kafka.bootstrap.servers.service.name" -}}
    {{- if eq .Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" -}}
        {{- if not .Values.global.baseConfigProperties.kafka.useExternalKafka -}}
            {{ include "generate.name.with.release.name" (list $ . "kafka") }}-kafka-bootstrap.{{ .Values.global.namespace }}.svc:9092
        {{- else -}}
            {{ .Values.global.baseConfigProperties.kafka.bootstrapServersPlaintext }}
        {{- end -}}
    {{- else if eq .Values.global.baseConfigProperties.kafka.securityProtocol "SSL" -}}
        {{- if not .Values.global.baseConfigProperties.kafka.useExternalKafka -}}
            {{ include "generate.name.with.release.name" (list $ . "kafka") }}-kafka-bootstrap.{{ .Values.global.namespace }}.svc:9093
        {{- else -}}
            {{ .Values.global.baseConfigProperties.kafka.bootstrapServersSsl }}
        {{- end -}}
    {{- else -}}
        {{- fail "Invalid Kafka security protocol." }}
    {{- end -}}
{{- end -}}

{{- define "kafka.bootstrap.servers" }}
    kafka.bootstrap.servers={{ include "kafka.bootstrap.servers.service.name" . }}
{{- end }}

{{- define "kafka.defult.consumer.security" }}
    {{- $ := index . 0 }}
    {{- $applicationHome := index . 2 }}
    {{- if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
    kafka.consumer.config.DEFAULT.security.protocol=PLAINTEXT
    {{- else if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "SSL" }}
    kafka.consumer.config.DEFAULT.security.protocol=SSL
    kafka.consumer.config.DEFAULT.ssl.truststore.location={{ $applicationHome }}/conf/keys/kafka.truststore.jks
    kafka.consumer.config.DEFAULT.ssl.truststore.password={{ $.Values.global.baseConfigProperties.kafka.sslTrustorePassword }}
    kafka.consumer.config.DEFAULT.ssl.keystore.location={{ $applicationHome }}/conf/keys/kafka.keystore.jks
    kafka.consumer.config.DEFAULT.ssl.keystore.password={{ $.Values.global.baseConfigProperties.kafka.sslKeystorePassword }}
    kafka.consumer.config.DEFAULT.ssl.key.password={{ $.Values.global.baseConfigProperties.kafka.sslKeyPassword }}
    {{- else }}
        {{- fail "Invalid Kafka security protocol." }}
    {{- end }}
{{- end }}

{{- define "rtde.kafka.security" }}
{{- if eq .Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
#PLAINTEXT MODE
    {{- else if eq .Values.global.baseConfigProperties.kafka.securityProtocol "SSL" }}
kafka.customConfig.kafka.security.protocol=SSL
kafka.customConfig.kafka.ssl.truststore.location=/opt/rtde/conf/kafka.truststore.jks
kafka.customConfig.kafka.ssl.truststore.password="{{ .Values.global.baseConfigProperties.kafka.sslTrustorePassword | trimPrefix "ENC:" }}"
kafka.customConfig.kafka.ssl.keystore.location=/opt/rtde/conf/kafka.keystore.jks
kafka.customConfig.kafka.ssl.keystore.password="{{ .Values.global.baseConfigProperties.kafka.sslKeystorePassword | trimPrefix "ENC:" }}"
kafka.customConfig.kafka.ssl.key.password="{{ .Values.global.baseConfigProperties.kafka.sslKeyPassword | trimPrefix "ENC:" }}"
#kafka.customConfig.kafka.ssl.endpoint.identification.algorithm=

{{- if .Values.global.baseConfigProperties.kafka.rtde.encryptedTruststorePassword }}
kafka.customConfigEncrypted.kafka.ssl.truststore.password=true
{{- end }}
{{- if .Values.global.baseConfigProperties.kafka.rtde.encryptedKeystorePassword }}
kafka.customConfigEncrypted.kafka.ssl.keystore.password=true
{{- end }}
{{- if .Values.global.baseConfigProperties.kafka.rtde.encryptedKeystorePassword }}
kafka.customConfigEncrypted.kafka.ssl.key.password=true
{{- end }}
    {{- else }}
        {{- fail "Invalid Kafka security protocol." }}
    {{- end }}
{{- end }}

{{- define "kafka.default.producer.security" }}
    {{- $ := index . 0 }}
    {{- $applicationHome := index . 2 }}
    {{- if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
    kafka.producer.EIM-Default-Producer.security.protocol=PLAINTEXT
    {{- else if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "SSL" }}
    kafka.producer.EIM-Default-Producer.security.protocol=SSL
    kafka.producer.EIM-Default-Producer.ssl.truststore.location={{ $applicationHome }}/conf/keys/kafka.truststore.jks
    kafka.producer.EIM-Default-Producer.ssl.truststore.password={{ $.Values.global.baseConfigProperties.kafka.sslTrustorePassword }}
    kafka.producer.EIM-Default-Producer.ssl.keystore.location={{ $applicationHome }}/conf/keys/kafka.keystore.jks
    kafka.producer.EIM-Default-Producer.ssl.keystore.password={{ $.Values.global.baseConfigProperties.kafka.sslKeystorePassword }}
    kafka.producer.EIM-Default-Producer.ssl.key.password={{ $.Values.global.baseConfigProperties.kafka.sslKeyPassword }}
    {{- else }}
        {{- fail "Invalid Kafka security protocol." }}
    {{- end }}
{{- end }}

{{- define "kafka.filtering.security" }}
    {{- $ := index . 0 }}
    {{- $applicationHome := index . 2 }}
    {{- if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
    filtering.kafka.security.protocol=PLAINTEXT
    {{- else if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "SSL" }}
    filtering.kafka.security.protocol=SSL
    filtering.kafka.ssl.truststore.location={{ $applicationHome }}/conf/keys/kafka.truststore.jks
    filtering.kafka.ssl.truststore.password={{ $.Values.global.baseConfigProperties.kafka.sslTrustorePassword }}
    filtering.kafka.ssl.keystore.location={{ $applicationHome }}/conf/keys/kafka.keystore.jks
    filtering.kafka.ssl.keystore.password={{ $.Values.global.baseConfigProperties.kafka.sslKeystorePassword }}
    filtering.kafka.ssl.key.password={{ $.Values.global.baseConfigProperties.kafka.sslKeyPassword }}
    {{- else }}
        {{- fail "Invalid Kafka security protocol." }}
    {{- end }}
{{- end }}

{{- define "kafka.filtering.24x7.processing.node.swift.mt.linking.security.protocol" }}
    {{- $ := index . 0 }}
    {{- $applicationHome := index . 2 }}
    {{- if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
    filtering.24x7.processing.node.swift.mt.linking.kafka.security.protocol=PLAINTEXT
    {{- else if eq $.Values.global.baseConfigProperties.kafka.securityProtocol "SSL" }}
    filtering.24x7.processing.node.swift.mt.linking.kafka.security.protocol=SSL
    filtering.24x7.processing.node.swift.mt.linking.kafka.ssl.truststore.location={{ $applicationHome }}/conf/keys/kafka.truststore.jks
    filtering.24x7.processing.node.swift.mt.linking.kafka.ssl.truststore.password={{ $.Values.global.baseConfigProperties.kafka.sslTrustorePassword }}
    filtering.24x7.processing.node.swift.mt.linking.kafka.ssl.keystore.location={{ $applicationHome }}/conf/keys/kafka.keystore.jks
    filtering.24x7.processing.node.swift.mt.linking.kafka.ssl.keystore.password={{ $.Values.global.baseConfigProperties.kafka.sslKeystorePassword }}
    filtering.24x7.processing.node.swift.mt.linking.kafka.ssl.key.password={{ $.Values.global.baseConfigProperties.kafka.sslKeyPassword }}
    {{- else }}
        {{- fail "Invalid Kafka security protocol." }}
    {{- end }}
{{- end }}

{{- define "minio.url" -}}
    http://minio.{{ .Values.global.namespace }}.svc.cluster.local:9000
{{- end -}}

{{- define "secret-volumes.kafka.jks" -}}
  {{- $solution := .solution -}}
  {{- $defineExternalKeystores := false }}
  {{- if or (eq $solution "nr-ui") (eq $solution "standalone") (eq $solution "wlm-pn-rt") (eq $solution "wlm-pn-sa") }}
    {{- $defineExternalKeystores = true }}
  {{- end }}
  {{- if ne .Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
- name: "{{ .Release.Name }}-kafka-{{ $solution }}-jks-volume"
  emptyDir: {}
- name: {{ .Release.Name }}-kafka-user
  secret:
    secretName: {{ .Release.Name }}-kafka-user
- name: {{ .Release.Name }}-kafka-cluster-ca-cert
  secret:
    secretName: {{ include "generate.name.with.release.name" (list $ . "kafka") }}-cluster-ca-cert
    {{- if and $defineExternalKeystores .Values.global.kafka.externalKafkaCertificates }}
      {{- if gt (len .Values.global.kafka.externalKafkaCertificates) 0 }}
        {{- range $key, $value := .Values.global.kafka.externalKafkaCertificates }}
- name: {{ $.Release.Name }}-{{ $key | replace "_" "-" }}-kafka-external-cert
  secret:
    secretName: {{ $value.secretName }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end -}}

{{- define "init-container.kafka.jks" -}}
{{- $solution := .solution -}}
{{- $defineExternalKeystores := false }}
{{- if or (eq $solution "nr-ui") (eq $solution "standalone") (eq $solution "wlm-pn-rt") (eq $solution "wlm-pn-sa") }}
  {{- $defineExternalKeystores = true }}
{{- end }}
{{- if ne .Values.global.baseConfigProperties.kafka.securityProtocol "PLAINTEXT" }}
- name: kafka-jks-cert-init
  image: "{{ .Values.global.dockerRegistryName }}/{{ .Values.global.toolsDockerImage }}"
  imagePullPolicy: IfNotPresent
  command:
    - /bin/sh
    - -c
    - |
      set +x
      set -e

      echo "$(date +"%Y-%m-%d %H:%M:%S") - Creating truststore"
      if [ -f /jks/kafka.truststore.jks ];
      then
        rm /jks/kafka.truststore.jks
      fi
      keytool -import -file /cluster-ca-cert/ca.crt -alias clusterCARoot -keystore /jks/kafka.truststore.jks -storepass $KEYSTORE_PASS -noprompt

      if [ -f /jks/kafka.keystore.jks ];
      then
        rm /jks/kafka.keystore.jks
      fi
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Converting user certificate to PKCS12 format"
      openssl pkcs12 -export -in /user/user.crt -inkey /user/user.key -out /jks/user.p12 -name user -passout pass:$KEYSTORE_PASS
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Importing keystore"
      keytool -importkeystore -srckeystore /jks/user.p12 -srcstorepass $KEYSTORE_PASS -destkeystore /jks/kafka.keystore.jks -deststorepass $KEYSTORE_PASS -noprompt
      rm /jks/user.p12
  {{- if and $defineExternalKeystores .Values.global.kafka.externalKafkaCertificates }}
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Define external trustore/kestore."
    {{- if gt (len .Values.global.kafka.externalKafkaCertificates) 0 }}
      {{- range $key, $value := .Values.global.kafka.externalKafkaCertificates }}
        {{- if and ($value.truststoreCertP12) (ne $value.truststoreCertP12 "") ($value.truststoreCertP12Password) (ne $value.truststoreCertP12Password "") }}
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Creating {{ $key }}.kafka.truststore.jks..."
      if [ -f /jks/{{ $key }}.kafka.truststore.jks ];
      then
        rm /jks/{{ $key }}.kafka.truststore.jks
      fi
      keytool -importkeystore -srckeystore /{{ $key }}/{{ $value.truststoreCertP12 }} -srcstorepass $(cat /{{ $key }}/{{ $value.truststoreCertP12Password }}) -srcstoretype PKCS12 -destkeystore /jks/{{ $key }}.kafka.truststore.jks -deststorepass $KEYSTORE_PASS -noprompt
        {{- else }}
          {{- if and ($value.secretName) (ne $value.secretName "") }}
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Creating {{ $key }}.kafka.truststore.jks..."
      if [ -f /jks/{{ $key }}.kafka.truststore.jks ];
      then
        rm /jks/{{ $key }}.kafka.truststore.jks
      fi
      keytool -import -alias clusterCARoot -trustcacerts -keystore /jks/{{ $key }}.kafka.truststore.jks -file /{{ $key }}/{{ $value.truststoreCert }} -storepass $KEYSTORE_PASS -noprompt
          {{- else }}
            {{- fail (printf "'global.kafka.externalKafkaCertificates' key '%s' must have defined (truststoreCert and secretName) or (truststoreCertP12 and truststoreCertP12Password)." $key) }}
          {{- end }}
        {{- end }}
        {{- if and ($value.keystoreCertP12) (ne $value.keystoreCertP12 "") ($value.keystoreCertP12Password) (ne $value.keystoreCertP12Password "") }}
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Creating {{ $key }}.kafka.keystore.jks..."
      if [ -f /jks/{{ $key }}.kafka.keystore.jks ];
      then
        rm /jks/{{ $key }}.kafka.keystore.jks
      fi
      keytool -importkeystore -srckeystore /{{ $key }}/{{ $value.keystoreCertP12 }} -srcstorepass $(cat /{{ $key }}/{{ $value.keystoreCertP12Password }}) -srcstoretype PKCS12 -destkeystore /jks/{{ $key }}.kafka.keystore.jks -deststorepass $KEYSTORE_PASS -noprompt
        {{- else }}
          {{- if and ($value.keystoreCert) (ne $value.keystoreCert "") ($value.keystoreCertKey) (ne $value.keystoreCertKey "") }}
      if [ -f /jks/{{ $key }}.kafka.keystore.jks ];
      then
        rm /jks/{{ $key }}.kafka.keystore.jks
      fi
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Converting user certificate to PKCS12 format"
      openssl pkcs12 -export -in /{{ $key }}/{{ $value.keystoreCert }} -inkey /{{ $key }}/{{ $value.keystoreCertKey }} -out /jks/{{ $key }}.user.p12 -name user -passout pass:$KEYSTORE_PASS
      echo "$(date +"%Y-%m-%d %H:%M:%S") - Importing keystore"
      keytool -importkeystore -srckeystore /jks/{{ $key }}.user.p12 -srcstorepass $KEYSTORE_PASS -destkeystore /jks/{{ $key }}.kafka.keystore.jks -deststorepass $KEYSTORE_PASS -noprompt
      rm /jks/{{ $key }}.user.p12
          {{- else }}
            {{- fail (printf "'global.kafka.externalKafkaCertificates' key '%s' must have defined (keystoreCert and keystoreCertKey) or (keystoreCertP12 and keystoreCertP12Password)." $key) }}
          {{- end }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
  env:
  - name: KEYSTORE_PASS
    valueFrom:
      secretKeyRef:
        name: {{ .Release.Name }}-jks-password
        key: password
  volumeMounts:
  - name: "{{ .Release.Name }}-kafka-{{ $solution }}-jks-volume"
    mountPath: /jks
  - name: {{ .Release.Name }}-kafka-user
    mountPath: /user
  - name: {{ .Release.Name }}-kafka-cluster-ca-cert
    mountPath: /cluster-ca-cert
  {{- if and $defineExternalKeystores .Values.global.kafka.externalKafkaCertificates }}
    {{- if gt (len .Values.global.kafka.externalKafkaCertificates) 0 }}
      {{- range $key, $value := .Values.global.kafka.externalKafkaCertificates }}
  - name: {{ $.Release.Name }}-{{ $key | replace "_" "-" }}-kafka-external-cert
    mountPath: /{{ $key }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}
{{- end -}}

# https://netreveal.atlassian.net/browse/FCENGX-2759
{{- define "jdk17.java.opts" -}}
    {{- if (ne .Values.global.java.java_opts "") -}}
{{ printf " %s " .Values.global.java.java_opts }}
    {{- else -}}
{{ printf " %s " "--add-opens java.base/java.lang=ALL-UNNAMED --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.io=ALL-UNNAMED --add-opens java.base/java.nio=ALL-UNNAMED --add-opens java.base/java.lang.invoke=ALL-UNNAMED --add-opens java.base/sun.security.util=ALL-UNNAMED --add-opens java.base/sun.security.action=ALL-UNNAMED --add-opens java.xml/com.sun.org.apache.xerces.internal.dom=ALL-UNNAMED --add-opens java.xml/com.sun.org.apache.xerces.internal.jaxp=ALL-UNNAMED --add-opens java.xml/com.sun.org.apache.xerces.internal.util=ALL-UNNAMED -Djdk.serialFilter=com.norkom.*" }}
    {{- end -}}
{{- end -}}

{{- define "log4j2.xml" }}
{{- if ne .Values.log4j2.overrideLog4j2 "" }}
{{ .Values.log4j2.overrideLog4j2 }}
{{- else }}
<?xml version="1.0"?>
<Configuration monitorInterval="60">
    <Appenders>
        <RollingFile name="NETREVEAL" fileName="${sys:application.home}/logs/application.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/application.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="KAFKA" fileName="${sys:application.home}/logs/kafka.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/kafka.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <Console name="Console" target="SYSTEM_OUT">
            <PatternLayout pattern="app - %d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n" />
        </Console>

        <Console name="ConsoleMsg" target="SYSTEM_OUT">
            <PatternLayout pattern="appmsg - %d{yyyy-MM-dd HH:mm:ss,SSS},%m%ex%n" />
        </Console>

        <Console name="ConsoleFun" target="SYSTEM_OUT">
            <PatternLayout pattern="appfunc - %d{yyyy-MM-dd HH:mm:ss,SSS},%m%ex%n" />
        </Console>

        <RollingFile name="fts" fileName="${sys:application.home}/logs/search.log" append="false" ignoreExceptions="false" filePattern="${sys:application.home}/logs/search.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} %-5p %c{1}:%L - %m%ex%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="importexport" fileName="${sys:application.home}/logs/importexport.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/importexport.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="acquisition" fileName="${sys:application.home}/logs/acquisition/applicationACQ.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/acquisition/applicationACQ.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="performance" fileName="${sys:application.home}/logs/performance.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/performance.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
             <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="wlm" fileName="${sys:application.home}/logs/wlm/applicationWLM.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/wlm/applicationWLM.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="cdd" fileName="${sys:application.home}/logs/cdd/applicationCDD.log" ignoreExceptions="false" filePattern="${sys:application.home}/logs/cdd/applicationCDD.log.%i.gz">
            <PatternLayout pattern="%d{dd-MMM-yyyy HH:mm:ss,SSS} - %X{userId} - %X{sessionId} %-5p %c{1}:%L - %m%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="messagestats" fileName="${sys:application.home}/logs/services/messagestats.log" append="false" ignoreExceptions="false" filePattern="${sys:application.home}/logs/services/messagestats.log.%i.gz">
            <PatternLayout pattern="%d{yyyy-MM-dd HH:mm:ss,SSS},%m%ex%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>

        <RollingFile name="functionstats" fileName="${sys:application.home}/logs/services/functionstats.log" append="false" ignoreExceptions="false" filePattern="${sys:application.home}/logs/services/functionstats.log.%i.gz">
            <PatternLayout pattern="%d{yyyy-MM-dd HH:mm:ss,SSS},%m%ex%n"/>
            <Policies>
                <SizeBasedTriggeringPolicy size="10MB"/>
            </Policies>
            <DefaultRolloverStrategy max="50"/>
        </RollingFile>
    </Appenders>
    <Loggers>
        <Root level="info">
            <AppenderRef ref="Console"/>
            <AppenderRef ref="NETREVEAL"/>
        </Root>

        <Logger name="com.detica.netreveal.search" level="info">
            <AppenderRef ref="Console"/>
            <AppenderRef ref="fts"/>
        </Logger>

        <Logger name="org.apache.kafka.clients.consumer.internals.ConsumerCoordinator" level="error"/>
        <logger name="org.apache.kafka.clients.NetworkClient" level="error"/>

        <Logger name="org.hibernate.util.JDBCExceptionReporter" level="fatal"/>

        <Logger name="org.quartz.plugins" level="warn"/>
        <Logger name="org.apache.struts.taglib" level="fatal"/>
        <Logger name="org.springframework" level="warn"/>
        <Logger name="org.hibernate" level="warn"/>
        <Logger name="com" level="info"/>
        <Logger name="org" level="info"/>
        <Logger name="net" level="info"/>
        <Logger name="com.norkom" level="info"/>

        <Logger name="com.norkom.base.web.util.MenuBuilder" level="error"/>

        <Logger name="com.norkom.base.business.facades.impl.PermissionLogicFacadeImpl" level="info"/>

        <Logger name="com.norkom.base.util.ImportExportUtil" level="info" additivity="true">
            <AppenderRef ref="Console"/>
            <AppenderRef ref="importexport"/>
        </Logger>
        <Logger name="com.norkom.base.business.jobs.ImportExportJob" level="info" additivity="true">
            <AppenderRef ref="Console"/>
            <AppenderRef ref="importexport"/>
        </Logger>

        <Logger name="com.norkom.acquisition" level="info" additivity="true"/>
        <Logger name="com.norkom.acquisition" level="info" additivity="true">
            <AppenderRef ref="acquisition"/>
        </Logger>

        <Logger name="com.norkom.configurator" level="info" additivity="true"/>

        <Logger name="com.norkom.configurator.business.facades.impl.AutomatedWorkflowExecutorLogicFacadeImpl" level="warn" additivity="true"/>

        <Logger name="com.norkom.configurator.business.facades.impl.WorkflowExecutionLogicFacadeImpl" level="info" additivity="true"/>

        <Logger name="com.norkom.wlm.controller.FuzzyIndexManager" level="info" additivity="true"/>
        <Logger name="com.norkom.wlm.controller.FuzzyIndexManager" level="info" additivity="true">
            <AppenderRef ref="wlm"/>
        </Logger>
        <Logger name="com.norkom.wlm.business.alert.AlertSaverExtension" level="info" additivity="true"/>
        <Logger name="com.norkom.wlm.business.alert.AlertSaverExtension" level="info" additivity="true">
            <AppenderRef ref="wlm"/>
        </Logger>
        <Logger name="com.norkom.acquisition.business.realtime.impl.DumpRealTimeFunction" level="info" additivity="true">
            <AppenderRef ref="wlm"/>
        </Logger>

        <Logger name="com.norkom.cdd" level="info" additivity="true"/>
        <Logger name="com.norkom.cdd" level="info" additivity="true">
            <AppenderRef ref="cdd"/>
        </Logger>

        <Logger name="services.manager.messagestats" level="{{ .Values.log4j2.messagestatsLogLevel }}" additivity="false">
            <AppenderRef ref="ConsoleMsg"/>
            <AppenderRef ref="messagestats"/>
        </Logger>

        <Logger name="services.manager.functionstats" level="{{ .Values.log4j2.functionstatsLogLevel }}" additivity="false">
            <AppenderRef ref="ConsoleFun"/>
            <AppenderRef ref="functionstats"/>
        </Logger>

        <!-- Kafka logging -->
        <Logger name="org.apache.kafka" level="error" additivity="false"/>
        <Logger name="org.apache.kafka" level="info" additivity="false">
            <AppenderRef ref="KAFKA"/>
        </Logger>

        <Logger name="com.norkom.acquisition.services.impl.KafkaProducerContainerImpl" level="error" additivity="false"/>
        <Logger name="com.norkom.acquisition.services.impl.KafkaProducerContainerImpl" level="info" additivity="false">
            <AppenderRef ref="KAFKA"/>
        </Logger>

        <Logger name="com.norkom.acquisition.services.impl.KafkaConsumerContainerImpl" level="error" additivity="false"/>
        <Logger name="com.norkom.acquisition.services.impl.KafkaConsumerContainerImpl" level="info" additivity="false">
            <AppenderRef ref="KAFKA"/>
        </Logger>

        <Logger name="com.norkom.acquisition.services.impl.KafkaConsumerRunner" level="error" additivity="false"/>
        <Logger name="com.norkom.acquisition.services.impl.KafkaConsumerRunner" level="info" additivity="false">
            <AppenderRef ref="KAFKA"/>
        </Logger>

        <Logger name="com.norkom.acquisition.services.impl.KafkaConsumerPropertyFilter" level="error" additivity="false"/>
        <Logger name="com.norkom.acquisition.services.impl.KafkaConsumerPropertyFilter" level="info" additivity="false">
            <AppenderRef ref="KAFKA"/>
        </Logger>

        <Logger name="com.norkom.acquisition.services.impl.KafkaProducerPropertyFilter" level="error" additivity="false"/>
        <Logger name="com.norkom.acquisition.services.impl.KafkaProducerPropertyFilter" level="info" additivity="false">
            <AppenderRef ref="KAFKA"/>
        </Logger>

    </Loggers>
</Configuration>
{{- end }}
{{- end }}

{{- define "base.config.properties.custom.parameters" }}
{{- if ne .Values.baseConfigProperties.extraParameters "" }}
{{ tpl .Values.baseConfigProperties.extraParameters . }}
{{- end }}
{{- end }}

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

{{- define "common.helm.metadata.labels" }}
app.kubernetes.io/managed-by: {{.Release.Service | quote }}
app.kubernetes.io/instance: {{.Release.Name | quote }}
helm.sh/chart: "{{.Chart.Name}}-{{.Chart.Version}}"
    {{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
    {{- end }}
{{- end }}

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

{{- define "definition.external.certificates" }}
  {{- $ := index . 0 }}
  {{- $service := index . 2 }}
  {{- $keystorePath := "" }}
  {{- if or (eq $service "nr-ui") (eq $service "wlm-pn-rt") }}
    {{- $keystorePath = "/opt/wildfly/netreveal/configuration/server.jks" }}
  {{- else }}
    {{- if or (eq $service "standalone") (eq $service "wlm-pn-sa") }}
      {{- $keystorePath = "/opt/netreveal/standaloneHome/server.jks" }}
    {{- else }}
      {{- fail (printf "Unsupported service '%s' for external certificates." $service) }}
    {{- end }}
  {{- end }}
  {{- if $.Values.global.externalCertificates }}
echo "$(date +"%Y-%m-%d %H:%M:%S") - Adding external certificates into application keystore..."
    {{- if gt (len $.Values.global.externalCertificates) 0 }}
      {{- range $key, $value := $.Values.global.externalCertificates }}
        {{- if and ($value.secretName) (ne $value.secretName "") }}
          {{- if and ($value.signedCertificate) (ne $value.signedCertificate "") }}
echo "$(date +"%Y-%m-%d %H:%M:%S") - Adding '{{ $key }}' certificate using PKCS12 format..."
keytool -import -alias {{ $key }} -keystore {{ $keystorePath }} -file /{{ $key }}/{{ $value.signedCertificate }} -storepass $KEYSTORE_PASS -noprompt
          {{- else }}
            {{- if and ($value.cert) (ne $value.cert "") ($value.key) (ne $value.key "") }}
echo "$(date +"%Y-%m-%d %H:%M:%S") - Adding '{{ $key }}'' certificate using Certificate and Key..."
openssl pkcs12 -export -in /{{ $key }}/{{ $value.cert }} -inkey /{{ $key }}/{{ $value.key }} -out /tmp/external-certificates/{{ $key }}.p12 -name {{ $key }} -passout pass:$KEYSTORE_PASS
echo "$(date +"%Y-%m-%d %H:%M:%S") - Importing keystore"
keytool -importkeystore -srckeystore /tmp/external-certificates/{{ $key }}.p12 -srcstorepass $KEYSTORE_PASS -destkeystore {{ $keystorePath }} -deststorepass $KEYSTORE_PASS -noprompt
rm /tmp/external-certificates/{{ $key }}.p12
            {{- else }}
              {{- fail (printf "'.Values.global.externalCertificates' key '%s' must have defined (cert and key) or (signedCertificate)." $key) }}
            {{- end }}
          {{- end }}
        {{- else }}
          {{- fail (printf "'.Values.global.externalCertificates' key '%s' must have defined secretName." $key) }}
        {{- end }}
      {{- end }}
    {{- end }}
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


{{- define "zeppelin-server.name" -}} 
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}} 
{{- end }}

{{- define "zeppelin-server.chart" -}} 
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}} 
{{- end }}

{{- define "zeppelin-server.labels" -}}
app.kubernetes.io/name: {{ include "zeppelin-server.name" . }}
helm.sh/chart: {{ include "zeppelin-server.chart" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}