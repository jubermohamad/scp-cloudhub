-- 001_provisioning.sql
--
-- control_plane-style schema for CloudHub AKS Infrastructure Requests.
--
-- Persists the CloudHub Infrastructure Request + approval workflow so that pending
-- approvals and provisioning state survive backend restarts. This mirrors the
-- embedded schema executed by InfrastructureRequestStore.init(); keep both in
-- sync. Safe to run repeatedly (idempotent via IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS provisioning_infrastructure_requests (
  request_id             VARCHAR(64) PRIMARY KEY,
  requestor              VARCHAR(255) NOT NULL,
  customer               VARCHAR(255) NOT NULL,
  environment            VARCHAR(100) NOT NULL,
  subscription           VARCHAR(255),
  cluster_name           VARCHAR(255) NOT NULL,
  cluster_profile        VARCHAR(50)  NOT NULL,
  regions                VARCHAR(255),
  node_size              VARCHAR(100),
  kubernetes_version     VARCHAR(50),
  estimated_monthly_cost INTEGER      NOT NULL DEFAULT 0,
  plan_summary           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status                 VARCHAR(50)  NOT NULL DEFAULT 'pending_approval',
  approval_chain         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  logs                   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  payload                JSONB        NOT NULL DEFAULT '{}'::jsonb,
  task_id                VARCHAR(128),
  pr_url                 TEXT,
  pr_number              INTEGER,
  branch_name            VARCHAR(255),
  tfvars_path            VARCHAR(512),
  error                  TEXT,
  created_at             TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_status
  ON provisioning_infrastructure_requests (status);

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_cluster_name
  ON provisioning_infrastructure_requests (cluster_name);

CREATE INDEX IF NOT EXISTS idx_provisioning_requests_created_at
  ON provisioning_infrastructure_requests (created_at DESC);
