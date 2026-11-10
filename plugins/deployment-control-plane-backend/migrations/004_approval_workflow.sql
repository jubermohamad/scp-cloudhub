-- Migration 004: Approval Workflow Infrastructure
-- Adds support for deployment approvals with state machine, audit trail, and temporal tracking

-- Extended control_plane_portal_deployments table with approval workflow fields
ALTER TABLE control_plane_portal_deployments
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'PENDING_APPROVAL' COMMENT 'PENDING_APPROVAL, APPROVED, REJECTED',
  ADD COLUMN IF NOT EXISTS approval_comment TEXT COMMENT 'Comment from approver',
  ADD COLUMN IF NOT EXISTS requested_by VARCHAR(255) COMMENT 'User who requested the deployment',
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT NOW() COMMENT 'When deployment was requested',
  ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(255) COMMENT 'User who rejected the deployment',
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP COMMENT 'When deployment was rejected',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT COMMENT 'Reason for rejection',
  ADD COLUMN IF NOT EXISTS deployment_status VARCHAR(50) DEFAULT 'PENDING' COMMENT 'PENDING, APPROVED, DEPLOYING, SUCCESS, FAILED',
  ADD COLUMN IF NOT EXISTS deployment_message TEXT COMMENT 'Message about deployment status',
  ADD COLUMN IF NOT EXISTS deployment_started_at TIMESTAMP COMMENT 'When deployment actually started',
  ADD COLUMN IF NOT EXISTS deployment_completed_at TIMESTAMP COMMENT 'When deployment completed',
  ADD COLUMN IF NOT EXISTS chart_values JSONB DEFAULT '{}' COMMENT 'Custom chart value overrides',
  ADD COLUMN IF NOT EXISTS temp_branch VARCHAR(100) COMMENT 'Temporary GitHub branch name for helmfile commit';

-- Deployment Approvals Table - tracks all approval actions
CREATE TABLE IF NOT EXISTS control_plane_deployment_approvals (
  id UUID PRIMARY KEY,
  deployment_id UUID NOT NULL REFERENCES control_plane_portal_deployments(id) ON DELETE CASCADE,
  approved_by VARCHAR(255) NOT NULL,
  approved_at TIMESTAMP DEFAULT NOW(),
  approval_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Deployment Audit Events Table - complete audit trail for all deployment actions
CREATE TABLE IF NOT EXISTS control_plane_deployment_audit_events (
  id UUID PRIMARY KEY,
  deployment_id UUID NOT NULL REFERENCES control_plane_portal_deployments(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL COMMENT 'CREATED, SUBMITTED_FOR_APPROVAL, APPROVED, REJECTED, DEPLOYING, SUCCESS, FAILED, ROLLBACK',
  actor VARCHAR(255) NOT NULL COMMENT 'User who triggered the event',
  actor_role VARCHAR(100) COMMENT 'Role of the actor (platform-engineer, app-engineering, etc)',
  previous_status VARCHAR(50) COMMENT 'Previous deployment status',
  new_status VARCHAR(50) COMMENT 'New deployment status',
  details JSONB DEFAULT '{}' COMMENT 'Event-specific metadata',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Deployment Definitions Table - stores deployment config as source of truth
-- This replaces the need for GitHub feature branches
CREATE TABLE IF NOT EXISTS control_plane_deployment_definitions (
  id UUID PRIMARY KEY,
  deployment_id UUID UNIQUE REFERENCES control_plane_portal_deployments(id) ON DELETE CASCADE,
  
  -- Identity
  application VARCHAR(100) NOT NULL COMMENT 'e.g., detectionhub, flows, invhub',
  instance_name VARCHAR(63) NOT NULL COMMENT 'e.g., dt-juber-poc',
  environment VARCHAR(50) NOT NULL COMMENT 'dev, qa, sandbox, prod',
  customer VARCHAR(100) NOT NULL COMMENT 'e.g., acme-corp',
  
  -- Cluster Info
  cluster_name VARCHAR(100) NOT NULL,
  subscription_id UUID,
  resource_group VARCHAR(100),
  
  -- Chart Configuration
  chart_version VARCHAR(50) NOT NULL,
  chart_source VARCHAR(50) DEFAULT 'cloudhub-native' COMMENT 'cloudhub-native',
  chart_values JSONB DEFAULT '{}' COMMENT 'Custom values overrides',
  ai_store_integration BOOLEAN DEFAULT FALSE,
  
  -- Approval Workflow State
  approval_status VARCHAR(50) DEFAULT 'PENDING_APPROVAL' COMMENT 'PENDING_APPROVAL, APPROVED_BY, REJECTED_BY',
  approval_comment TEXT,
  requested_by VARCHAR(255) NOT NULL,
  requested_at TIMESTAMP DEFAULT NOW(),
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  rejected_by VARCHAR(255),
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  
  -- Execution Details
  helmfile_content TEXT COMMENT 'Generated helmfile content (on approval)',
  github_branch VARCHAR(100) COMMENT 'Temporary branch name',
  github_commit_sha VARCHAR(40),
  workflow_run_id VARCHAR(100),
  workflow_run_url TEXT,
  
  -- Status Tracking
  deployment_status VARCHAR(50) DEFAULT 'PENDING' COMMENT 'PENDING, QUEUED, DEPLOYING, SUCCESS, FAILED',
  deployment_message TEXT,
  deployment_started_at TIMESTAMP,
  deployment_completed_at TIMESTAMP,
  
  -- Audit & Versioning
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP COMMENT 'Soft delete for audit trail'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deployment_approvals_deployment_id
  ON control_plane_deployment_approvals (deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_approvals_approved_by
  ON control_plane_deployment_approvals (approved_by);

CREATE INDEX IF NOT EXISTS idx_deployment_audit_events_deployment_id
  ON control_plane_deployment_audit_events (deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_events_actor
  ON control_plane_deployment_audit_events (actor);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_events_event_type
  ON control_plane_deployment_audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_events_created_at
  ON control_plane_deployment_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deployment_definitions_application
  ON control_plane_deployment_definitions (application);
CREATE INDEX IF NOT EXISTS idx_deployment_definitions_approval_status
  ON control_plane_deployment_definitions (approval_status);
CREATE INDEX IF NOT EXISTS idx_deployment_definitions_requested_by
  ON control_plane_deployment_definitions (requested_by);
CREATE INDEX IF NOT EXISTS idx_deployment_definitions_created_at
  ON control_plane_deployment_definitions (created_at DESC);

-- View: Pending Approvals Dashboard
-- Helps approvers see all deployments awaiting their decision
CREATE OR REPLACE VIEW control_plane_pending_approvals AS
SELECT
  dd.id,
  dd.deployment_id,
  dd.application,
  dd.instance_name,
  dd.customer,
  dd.environment,
  dd.chart_version,
  dd.requested_by,
  dd.requested_at,
  dd.approval_status,
  COUNT(cda.id) AS total_events,
  MAX(cda.created_at) AS last_event_at
FROM control_plane_deployment_definitions dd
LEFT JOIN control_plane_deployment_audit_events cda ON dd.id = cda.deployment_id
WHERE dd.approval_status = 'PENDING_APPROVAL'
GROUP BY dd.id, dd.deployment_id, dd.application, dd.instance_name, dd.customer, 
         dd.environment, dd.chart_version, dd.requested_by, dd.requested_at, dd.approval_status
ORDER BY dd.requested_at ASC;

-- View: Deployment Status Overview
-- Helps operators track deployment progress
CREATE OR REPLACE VIEW control_plane_deployment_status_overview AS
SELECT
  dd.id,
  dd.application,
  dd.instance_name,
  dd.customer,
  dd.environment,
  dd.deployment_status,
  dd.approval_status,
  dd.requested_at,
  dd.approved_at,
  dd.deployment_started_at,
  dd.deployment_completed_at,
  EXTRACT(EPOCH FROM (dd.deployment_completed_at - dd.deployment_started_at)) AS deployment_duration_seconds,
  EXTRACT(EPOCH FROM (dd.approved_at - dd.requested_at)) AS approval_duration_seconds
FROM control_plane_deployment_definitions dd
WHERE dd.deleted_at IS NULL
ORDER BY dd.requested_at DESC;

-- Comments for audit and clarity
COMMENT ON TABLE control_plane_deployment_approvals IS 'Tracks all approval decisions and comments for deployments';
COMMENT ON TABLE control_plane_deployment_audit_events IS 'Complete audit trail of all deployment lifecycle events';
COMMENT ON TABLE control_plane_deployment_definitions IS 'Source of truth for deployment configurations - replaces GitHub feature branches';
COMMENT ON COLUMN control_plane_portal_deployments.approval_status IS 'Deployment approval workflow status';
COMMENT ON COLUMN control_plane_portal_deployments.deployment_status IS 'Actual deployment execution status';
COMMENT ON COLUMN control_plane_deployment_definitions.chart_source IS 'Which chart registry to pull from: cloudhub-native (default)';
