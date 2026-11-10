\pset null ''
SELECT count(1)
FROM information_schema.tables
WHERE lower(table_name) = 'automated_exports';
