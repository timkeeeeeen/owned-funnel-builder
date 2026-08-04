CREATE TABLE IF NOT EXISTS tracking_context_exchanges (
  context_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  funnel_slug TEXT NOT NULL,
  flow_binding TEXT NOT NULL,
  server_subject_ref TEXT NOT NULL,
  privacy_snapshot_json TEXT NOT NULL,
  buyer_context_json TEXT NOT NULL DEFAULT '{}',
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS tracking_context_exchanges_scope_idx
  ON tracking_context_exchanges (tenant_id, site_id, funnel_slug, flow_binding, expires_at);
