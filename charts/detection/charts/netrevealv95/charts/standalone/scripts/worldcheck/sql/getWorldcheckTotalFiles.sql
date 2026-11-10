select count(*)
FROM {{ .Values.global.baseConfigProperties.db.postgresql.userid | upper }}.WLM_LIST_REPORT
  WHERE LIST_NAME = 'WORLDCHECK'
  AND TO_CHAR(IMPORT_START_TIMESTAMP,'DD/MM/YYYY') = TO_CHAR(CURRENT_TIMESTAMP,'DD/MM/YYYY');