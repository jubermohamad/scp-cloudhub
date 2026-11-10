\pset null ''
\pset fieldsep '|'
\pset recordsep '#'
SELECT lower(file_name_prefix), coalesce(nullif(orgunit_code, 'empty'), '') as orgunit_code, pre_script, select_script, post_script, db_schema
FROM automated_exports WHERE upper(enabled)='Y' AND upper(deleted_flag) = 'N' AND lower(frequency) = :'frequency' AND coalesce(nullif(orgunit_code, 'empty'), '') = :'orgunit'
ORDER BY orgunit_code, name;