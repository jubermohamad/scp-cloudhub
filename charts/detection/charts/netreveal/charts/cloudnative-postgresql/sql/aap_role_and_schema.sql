CREATE ROLE aapsparkuser LOGIN PASSWORD '{{ .Values.global.baseConfigProperties.clusterdb.AapsparkuserPassword}}';
CREATE SCHEMA aapsparkuser AUTHORIZATION aapsparkuser;