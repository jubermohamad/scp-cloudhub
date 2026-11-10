CREATE USER {{ .Values.er.entresUser }} WITH
    PASSWORD '{{ .Values.global.baseConfigProperties.clusterdb.EntresPassword }}' CREATEDB;

GRANT {{ .Values.er.entresRole }} TO {{ .Values.er.entresUser }};

CREATE SCHEMA NR_ER AUTHORIZATION {{ .Values.er.entresUser }};

alter role {{ .Values.er.entresUser }} set search_path = NR_ER,"$user";

GRANT USAGE ON SCHEMA NR_ER TO {{ .Values.er.entresRole }};
