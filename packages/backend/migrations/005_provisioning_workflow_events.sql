-- 005_provisioning_workflow_events.sql
--
-- Event storage and readiness tracking for AKS Infrastructure Requests:
--
--  * provisioning_execution_events: durable timeline of normalized events
--    from GitHub, Terraform Cloud, Azure, and scripts runner.
--  * readiness_status: four-tier readiness model (infrastructureReady,
--    addonsReady, operationallyReady, completed).

CREATE TABLE IF NOT EXISTS provisioning_execution_events (
  id                     BIGSERIAL PRIMARY KEY,
  request_id             VARCHAR(64) NOT NULL REFERENCES provisioning_infrastructure_requests(request_id) ON DELETE CASCADE,
  config_fingerprint     VARCHAR(80),
  event_id               VARCHAR(128) NOT NULL,
  source_system          VARCHAR(64) NOT NULL,
  external_ref           TEXT,
  event_type             VARCHAR(64) NOT NULL,
  normalized_status      VARCHAR(64) NOT NULL,
  message                TEXT NOT NULL,
  source_timestamp       TIMESTAMP,
  ingestion_timestamp    TIMESTAMP NOT NULL DEFAULT NOW(),
  step                   VARCHAR(64),
  severity               VARCHAR(20) NOT NULL DEFAULT 'info',
  details                JSONB,
  source_url             TEXT,
  metadata               JSONB
);

CREATE INDEX IF NOT EXISTS idx_provisioning_events_request_id_id
  ON provisioning_execution_events (request_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_events_request_event_id
  ON provisioning_execution_events (request_id, event_id);

ALTER TABLE provisioning_infrastructure_requests
  ADD COLUMN IF NOT EXISTS readiness_status JSONB;
