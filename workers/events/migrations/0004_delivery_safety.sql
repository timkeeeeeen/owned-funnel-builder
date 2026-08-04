ALTER TABLE tracking_events
  ADD COLUMN canonical_payload_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE tracking_events
  ADD COLUMN privacy_subject_id TEXT;

ALTER TABLE tracking_deliveries
  ADD COLUMN destination_payload_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE tracking_deliveries
  ADD COLUMN transform_version TEXT NOT NULL DEFAULT '1';
ALTER TABLE tracking_deliveries
  ADD COLUMN transform_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tracking_deliveries
  ADD COLUMN lease_owner TEXT;
ALTER TABLE tracking_deliveries
  ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracking_deliveries
  ADD COLUMN lease_deadline TEXT;

CREATE TABLE IF NOT EXISTS tracking_runtime_controls (
  control_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  funnel_id TEXT,
  destination TEXT,
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  second_approver TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, funnel_id, destination)
);

CREATE TABLE IF NOT EXISTS tracking_operator_audits (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  second_approver TEXT,
  event_key TEXT,
  destination TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS tracking_deliveries_lease_idx
  ON tracking_deliveries (state, lease_deadline);
