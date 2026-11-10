-- 004_provisioning_execution_tracking.sql
--
-- Read-only infrastructure execution tracking for AKS Infrastructure Requests:
--
--  * pr_repository       owner/name of the repository pr_number belongs to.
--                        Rows created before this migration keep NULL: their
--                        PR may live in a different repository, so they are
--                        never tracked against scp-infra-as-code by number.
--  * execution_tracking  last verified GitHub / Terraform Cloud observations
--                        (PR, Quality Gate, reviews, workspacemanager run,
--                        workspace, cluster run, outputs), the derived phase,
--                        and refresh/staleness metadata.
--  * infra_pr_operation  the explicit "create infrastructure PR" action:
--                        state, attempt, actor, and the branch / PR
--                        identifiers recorded as each step succeeds, so a
--                        retry resumes instead of creating duplicates.
--
-- Idempotent and non-destructive. Kept in sync with SCHEMA_SQL in
-- packages/backend/src/services/InfrastructureRequestStore.ts.

ALTER TABLE provisioning_infrastructure_requests
  ADD COLUMN IF NOT EXISTS pr_repository      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS execution_tracking JSONB,
  ADD COLUMN IF NOT EXISTS infra_pr_operation JSONB;
