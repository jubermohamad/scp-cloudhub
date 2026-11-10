--
-- Role and tablespace script for Entity Resolution
-- ================================================
--
-- If required, the database objects can be laid out using a different set of
-- tablespaces.  If this is required, then the creation script
-- and the schema objects will need to be edited to place items in appropriate
-- tablespaces.
--
-- Note that the following commands are indicative only, they will need to be amended
-- appropriately to take into account the environment in which NetReveal will be running.
--

create role {{ .Values.er.entresRole }};
