-- Migration 006: Link deployment approvals to deployment records
-- Adds a durable deployment UUID to approval rows so approval history can be
-- traced back to the exact deployment that was eventually triggered.

ALTER TABLE control_plane_deployment_approvals
  ADD COLUMN IF NOT EXISTS deployment_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_dep_approval_deployment_id
  ON control_plane_deployment_approvals (deployment_id)
  WHERE deployment_id IS NOT NULL;