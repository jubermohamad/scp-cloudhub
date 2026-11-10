-- Migration: Fix all cluster_id UUID type issues across all tables
-- Issue: Multiple tables define cluster_id as UUID but store cluster name strings
-- causing "Invalid input syntax for type uuid" errors

-- Comprehensive fix for all tables with cluster_id columns

-- control_plane_node_pools
ALTER TABLE IF EXISTS control_plane_node_pools
  DROP CONSTRAINT IF EXISTS control_plane_node_pools_cluster_id_fkey;

ALTER TABLE IF EXISTS control_plane_node_pools
  ALTER COLUMN cluster_id TYPE VARCHAR(255);

-- control_plane_platform_deployments (already fixed in 002, but verify)
ALTER TABLE IF EXISTS control_plane_platform_deployments
  DROP CONSTRAINT IF EXISTS control_plane_platform_deployments_cluster_id_fkey;

ALTER TABLE IF EXISTS control_plane_platform_deployments
  ALTER COLUMN cluster_id TYPE VARCHAR(255);

-- control_plane_tenant_overlays (already fixed in 002, but verify)
ALTER TABLE IF EXISTS control_plane_tenant_overlays
  DROP CONSTRAINT IF EXISTS control_plane_tenant_overlays_cluster_id_fkey;

ALTER TABLE IF EXISTS control_plane_tenant_overlays
  ALTER COLUMN cluster_id TYPE VARCHAR(255);

-- control_plane_developer_environments
ALTER TABLE IF EXISTS control_plane_developer_environments
  DROP CONSTRAINT IF EXISTS control_plane_developer_environments_cluster_id_fkey;

ALTER TABLE IF EXISTS control_plane_developer_environments
  ALTER COLUMN cluster_id TYPE VARCHAR(255);

-- Verify all cluster_id columns are now VARCHAR(255)
-- SELECT table_name, column_name, data_type 
-- FROM information_schema.columns 
-- WHERE column_name = 'cluster_id'
-- ORDER BY table_name;
