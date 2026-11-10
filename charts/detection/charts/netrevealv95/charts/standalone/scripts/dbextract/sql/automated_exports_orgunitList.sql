\pset null ''
\pset recordsep '#'
SELECT DISTINCT coalesce(nullif(orgunit_code, ''), 'empty') as orgunit_code
FROM automated_exports WHERE upper(enabled)='Y' AND upper(deleted_flag) = 'N' AND LOWER(frequency) = :'frequency'
ORDER BY orgunit_code;
