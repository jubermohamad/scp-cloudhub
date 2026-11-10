-- Unified scripts-pipeline deployment metadata.
-- Additive only: historical deployment rows remain readable.
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS workflow_repository VARCHAR(255),
  ADD COLUMN IF NOT EXISTS workflow_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS workflow_ref VARCHAR(255),
  ADD COLUMN IF NOT EXISTS workflow_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_run_attempt INTEGER,
  ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS workflow_conclusion VARCHAR(50),
  ADD COLUMN IF NOT EXISTS correlation_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS correlation_message TEXT,
  ADD COLUMN IF NOT EXISTS correlation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correlation_deadline TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_log_line INTEGER NOT NULL DEFAULT 0;
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS instance_status VARCHAR(20) NOT NULL DEFAULT 'EXISTING';
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS instance_mode VARCHAR(20) NOT NULL DEFAULT 'auto';
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS requested_by VARCHAR(255);
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP;
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS sri_deploy_source VARCHAR(50) DEFAULT 'cloudhub-native';
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS backend_source VARCHAR(50) DEFAULT 'cloudhub-native';

ALTER TABLE control_plane_deployment_approvals
  ADD COLUMN IF NOT EXISTS deployment_id UUID;

CREATE TABLE IF NOT EXISTS control_plane_deployment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES control_plane_portal_deployments(id) ON DELETE CASCADE,
  github_job_id BIGINT NOT NULL,
  job_name VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  conclusion VARCHAR(50),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_log_line INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (deployment_id, github_job_id)
);

CREATE INDEX IF NOT EXISTS idx_control_plane_deployment_jobs_deployment
  ON control_plane_deployment_jobs (deployment_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_portal_deployments_run
  ON control_plane_portal_deployments (workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_portal_deployments_reconcile
  ON control_plane_portal_deployments (status, correlation_status, workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_portal_deployments_correlation
  ON control_plane_portal_deployments (correlation_status);
