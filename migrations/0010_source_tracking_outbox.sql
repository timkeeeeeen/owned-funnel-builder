CREATE TABLE IF NOT EXISTS source_tracking_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL UNIQUE,
  source_system TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_tracking_provider_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  source_event_id TEXT NOT NULL REFERENCES source_tracking_outbox(source_event_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, provider, provider_object_id, event_name)
);

CREATE INDEX IF NOT EXISTS source_tracking_outbox_due_idx
  ON source_tracking_outbox (state, next_attempt_at);
