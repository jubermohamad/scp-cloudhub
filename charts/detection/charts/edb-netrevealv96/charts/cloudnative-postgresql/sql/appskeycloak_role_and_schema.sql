CREATE ROLE appskeycloak LOGIN PASSWORD '{{ .Values.global.baseConfigProperties.clusterdb.AppPassword}}';
CREATE SCHEMA appskeycloak AUTHORIZATION appskeycloak;
GRANT USAGE, CREATE ON SCHEMA public TO appskeycloak;
