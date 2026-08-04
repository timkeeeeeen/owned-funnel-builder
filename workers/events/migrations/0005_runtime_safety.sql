CREATE TABLE IF NOT EXISTS tracking_runtime_release_state (
  state_key TEXT PRIMARY KEY,
  migration_names_json TEXT NOT NULL,
  migration_set_sha TEXT NOT NULL,
  release_sha TEXT NOT NULL,
  lock_state TEXT NOT NULL CHECK (lock_state IN ('locked', 'ready')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_delivery_budgets (
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  used INTEGER NOT NULL,
  budget_limit INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE TABLE IF NOT EXISTS tracking_runtime_metrics (
  metric_key TEXT PRIMARY KEY,
  metric_value INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS tracking_events_privacy_subject_idx
  ON tracking_events (tenant_id, site_id, privacy_subject_id);
