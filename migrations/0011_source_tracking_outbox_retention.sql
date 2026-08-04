PRAGMA foreign_keys = OFF;

ALTER TABLE source_tracking_provider_mappings RENAME TO source_tracking_provider_mappings_legacy;
ALTER TABLE source_tracking_outbox RENAME TO source_tracking_outbox_legacy;

CREATE TABLE source_tracking_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'delivered', 'retryable', 'quarantined', 'expired')),
  next_attempt_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  expires_at TEXT NOT NULL,
  lease_until TEXT,
  lease_owner TEXT,
  bridge_accepted_at TEXT,
  redacted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, source_event_id)
);

INSERT INTO source_tracking_outbox (
  outbox_id, tenant_id, site_id, source_event_id, source_system, event_name, payload_json,
  payload_hash, state, next_attempt_at, attempt_count, last_error, expires_at, created_at, updated_at
)
SELECT outbox_id, tenant_id, site_id, source_event_id, source_system, event_name, payload_json,
  '', state, next_attempt_at, attempt_count, last_error,
  datetime(created_at, '+7 days'), created_at, updated_at
FROM source_tracking_outbox_legacy;

DROP TABLE source_tracking_outbox_legacy;

CREATE TABLE source_tracking_provider_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, provider, provider_object_id, event_name)
);

INSERT INTO source_tracking_provider_mappings (
  tenant_id, site_id, provider, provider_object_id, event_name, source_event_id, created_at
)
SELECT tenant_id, site_id, provider, provider_object_id, event_name, source_event_id, created_at
FROM source_tracking_provider_mappings_legacy;

DROP TABLE source_tracking_provider_mappings_legacy;

CREATE INDEX source_tracking_outbox_due_idx
  ON source_tracking_outbox (state, next_attempt_at, expires_at);

CREATE TABLE IF NOT EXISTS source_tracking_delivery_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  owner TEXT,
  result TEXT NOT NULL CHECK (result IN ('accepted', 'retryable', 'ignored_not_owner', 'quarantined')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS source_tracking_delivery_audit_event_idx
  ON source_tracking_delivery_audit (tenant_id, site_id, source_event_id, created_at);

PRAGMA foreign_keys = ON;
