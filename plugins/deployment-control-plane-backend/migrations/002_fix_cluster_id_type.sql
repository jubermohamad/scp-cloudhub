-- Migration: Fix cluster_id column type to support composite IDs
-- Issue: control_plane_platform_deployments.cluster_id is defined as UUID but stores composite strings (subscriptionId:resourceGroup:clusterName)
-- This causes "Invalid input syntax for type uuid" PostgreSQL errors on deployment

-- Step 1: Drop the foreign key constraint on control_plane_platform_deployments
ALTER TABLE control_plane_platform_deployments
  DROP CONSTRAINT IF EXISTS control_plane_platform_deployments_cluster_id_fkey;

-- Step 2: Change cluster_id column type from UUID to VARCHAR(255) for composite ID storage
ALTER TABLE control_plane_platform_deployments
  ALTER COLUMN cluster_id TYPE VARCHAR(255);

-- Step 3: Drop the foreign key constraint on control_plane_tenant_overlays
ALTER TABLE control_plane_tenant_overlays
  DROP CONSTRAINT IF EXISTS control_plane_tenant_overlays_cluster_id_fkey;

-- Step 4: Change cluster_id column type from UUID to VARCHAR(255) for composite ID storage
ALTER TABLE control_plane_tenant_overlays
  ALTER COLUMN cluster_id TYPE VARCHAR(255);

-- Note: These tables now store composite cluster identifiers (subscriptionId:resourceGroup:clusterName)
-- rather than direct UUID references to control_plane_clusters table.
