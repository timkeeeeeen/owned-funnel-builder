CREATE TABLE IF NOT EXISTS tracking_privacy_requests (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tracking_privacy_requests_subject_idx
  ON tracking_privacy_requests (tenant_id, site_id, subject_id, state);
CREATE TABLE IF NOT EXISTS tracking_privacy_tombstone_journal (
  journal_id TEXT PRIMARY KEY,
  suppression_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
