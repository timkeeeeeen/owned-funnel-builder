ALTER TABLE webhook_events ADD COLUMN attempt_started_at TEXT;

CREATE INDEX IF NOT EXISTS webhook_events_attempt_idx
  ON webhook_events (status, attempt_started_at);

CREATE TABLE IF NOT EXISTS payment_revocations (
  payment_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
