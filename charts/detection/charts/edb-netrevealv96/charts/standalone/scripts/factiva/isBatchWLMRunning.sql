select count(*)
  from {{ .Values.global.baseConfigProperties.db.postgresql.userid | upper }}.ACQ_BATCH_PROCESS
  where STATUS = 'in progress'
  and COMPONENT_TYPE = 'WLM'
;