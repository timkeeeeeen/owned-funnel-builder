CREATE TABLE IF NOT EXISTS tracking_csrf_nonces (
  nonce TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT,
  privacy_subject_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_csrf_nonces_subject_idx
  ON tracking_csrf_nonces (tenant_id, site_id, visitor_id, privacy_subject_id, expires_at);
