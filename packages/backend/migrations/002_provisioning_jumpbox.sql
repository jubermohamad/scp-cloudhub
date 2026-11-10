-- 002_provisioning_jumpbox.sql
--
-- Adds Tailscale jumpbox access tracking to Infrastructure Requests. These
-- columns support the end-to-end workflow that continues after AKS provisioning:
-- registering cluster administrators, opening the Tailscale policy PR, tracking
-- its approval, and recording the Platform Registry lifecycle.
--
-- Idempotent: safe to run against an already-migrated database. Kept in sync
-- with the embedded SCHEMA_SQL in
-- packages/backend/src/services/InfrastructureRequestStore.ts.

ALTER TABLE provisioning_infrastructure_requests
  ADD COLUMN IF NOT EXISTS cluster_administrators JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS jumpbox_name           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tailscale_pr_url       TEXT,
  ADD COLUMN IF NOT EXISTS tailscale_pr_number    INTEGER,
  ADD COLUMN IF NOT EXISTS tailscale_pr_status    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS access_status          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS registry_status        VARCHAR(50);
