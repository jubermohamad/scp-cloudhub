-- 003_provisioning_integrity.sql
--
-- Request/approval integrity for AKS Infrastructure Requests:
--
--  * version            optimistic concurrency: every save is conditional on
--                       the version that was read, so concurrent writers can
--                       no longer silently overwrite each other.
--  * config_fingerprint sha256 of the canonical approved configuration;
--                       approvals record the fingerprint they were given for.
--  * claim_cluster_name / claim_address_space
--                       set while a request is in flight and cleared when it
--                       is rejected. The partial unique indexes make two
--                       concurrent CloudHub requests for the same cluster name
--                       or VNet range fail atomically. They do NOT cover
--                       allocations made outside CloudHub.
--
-- Idempotent and non-destructive: existing rows keep all data, get version 0
-- and NULL fingerprint/claims (legacy requests can be rejected but not
-- approved). Kept in sync with SCHEMA_SQL in
-- packages/backend/src/services/InfrastructureRequestStore.ts.

ALTER TABLE provisioning_infrastructure_requests
  ADD COLUMN IF NOT EXISTS version             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS config_fingerprint  VARCHAR(80),
  ADD COLUMN IF NOT EXISTS claim_cluster_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS claim_address_space VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_requests_claim_cluster
  ON provisioning_infrastructure_requests (claim_cluster_name)
  WHERE claim_cluster_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_requests_claim_cidr
  ON provisioning_infrastructure_requests (claim_address_space)
  WHERE claim_address_space IS NOT NULL;
