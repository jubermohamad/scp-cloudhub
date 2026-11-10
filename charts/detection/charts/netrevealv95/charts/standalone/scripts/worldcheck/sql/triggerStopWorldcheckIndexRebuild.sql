-- Do blocks returns nothing
do $$
<<stop_worldcheck_index_rebuild>>
declare
  l_target_index varchar;

  c_target_list_definitions CURSOR FOR
    SELECT ID, LIST_DEFINITION_NAME AS NAME
      FROM {{ .Values.global.baseConfigProperties.db.postgresql.userid | upper }}.LIST_DEFINITION
      WHERE
        WORLDCHECK_LIST > 0
        AND IS_DELETED = 0;
begin
  FOR r_list_definition IN c_target_list_definitions
  LOOP
      -- Using a LIKE condition as given the following results
      --   1139 EUFSR-RUS
      --   1005 WORLDCHECK
      --   1009 DJ Applicable Sanctions Group

      -- Some of the list definition is just the list_definition
        -- WLM_CUSTOMLIST_INDEXES.1139

      -- Some of the list definition has list_definition.index_ids
      --   WLM_CUSTOMLIST_INDEXES.1005
      --   WLM_CUSTOMLIST_INDEXES.1005.1030
      --   WLM_CUSTOMLIST_INDEXES.1009
      --   WLM_CUSTOMLIST_INDEXES.1009.1105

      l_target_index := '%' || 'WLM_CUSTOMLIST_INDEXES.' || r_list_definition.id || '%';
      RAISE NOTICE 'Updating index (set current_state=new_state) for list definition (wildcard): % -- %', r_list_definition.name, l_target_index;

      -- Example
      -- Updating index (wildcard): NGEFCC  --  %WLM_CUSTOMLIST_INDEXES.1030%
      -- Updating index (wildcard): EUMY-LTM  --  %WLM_CUSTOMLIST_INDEXES.1031%

      UPDATE {{ .Values.global.baseConfigProperties.db.postgresql.userid | upper }}.SERVER_STATES
        SET CURRENT_STATE=NEW_STATE
        WHERE TOPIC LIKE l_target_index;

  END LOOP;

  UPDATE {{ .Values.global.baseConfigProperties.db.postgresql.userid | upper }}.SERVER_STATES
    SET CURRENT_STATE=NEW_STATE
    WHERE TOPIC='WLM_WORLDCHECK_INDEXES';

  RAISE NOTICE 'Updating index (set current_state=new_state) for WLM_WORLDCHECK_INDEXES';

end stop_worldcheck_index_rebuild $$;