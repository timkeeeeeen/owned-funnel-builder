-- Tracking D1 scope hardening. This migration is additive and safe to run once.
-- Every lookup path remains tenant/site scoped; no business-D1 tables belong here.
ALTER TABLE tracking_provider_event_mappings RENAME TO tracking_provider_event_mappings_legacy;
CREATE TABLE tracking_provider_event_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_key TEXT NOT NULL REFERENCES tracking_events(event_key),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, provider, provider_object_id, event_name)
);
INSERT INTO tracking_provider_event_mappings
  (tenant_id, provider, provider_object_id, event_name, event_key, created_at)
SELECT tenant_id, provider, provider_object_id, event_name, event_key, created_at
FROM tracking_provider_event_mappings_legacy;
DROP TABLE tracking_provider_event_mappings_legacy;

ALTER TABLE tracking_nonces RENAME TO tracking_nonces_legacy;
CREATE TABLE tracking_nonces (
  nonce TEXT NOT NULL,
  source_system TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_system, nonce)
);
INSERT INTO tracking_nonces (nonce, source_system, expires_at, created_at)
SELECT nonce, source_system, expires_at, created_at FROM tracking_nonces_legacy;
DROP TABLE tracking_nonces_legacy;

CREATE TABLE IF NOT EXISTS tracking_scope_audits (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('accepted', 'ignored_not_owner', 'rejected_scope')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_scope_audits_lookup_idx
  ON tracking_scope_audits (tenant_id, site_id, created_at);

ALTER TABLE tracking_privacy_choices ADD COLUMN observed_at TEXT;
ALTER TABLE tracking_privacy_choices ADD COLUMN expires_at TEXT;

CREATE TABLE IF NOT EXISTS tracking_dlq_records (
  dlq_id TEXT PRIMARY KEY,
  event_key TEXT,
  destination TEXT,
  schema_version TEXT,
  reason TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_dlq_created_idx
  ON tracking_dlq_records (created_at);
