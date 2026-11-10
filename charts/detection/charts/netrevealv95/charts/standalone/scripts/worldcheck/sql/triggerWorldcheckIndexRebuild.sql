do $$
<<worldcheck_index_rebuild>>
declare
  l_update_count int;
begin
  UPDATE {{ .Values.global.baseConfigProperties.db.postgresql.userid | upper }}.SERVER_STATES
    SET NEW_STATE=CURRENT_STATE+1
    WHERE TOPIC='WLM_WORLDCHECK_INDEXES'
    AND SERVER_NAME='nrod_batch';

    get diagnostics l_update_count = row_count;
    RAISE NOTICE 'Updated % rows', l_update_count;

    -- Do blocks cannot return :(
    -- return l_update_count;
end worldcheck_index_rebuild $$;