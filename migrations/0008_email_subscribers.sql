CREATE TABLE IF NOT EXISTS email_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  offer_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'subscribed'
    CHECK (status IN ('subscribed', 'unsubscribed', 'suppressed')),
  consent_version TEXT NOT NULL,
  consent_copy TEXT NOT NULL,
  source_placement TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  soft_bounce_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (email, offer_slug)
);

CREATE INDEX IF NOT EXISTS email_subscribers_offer_status_idx
  ON email_subscribers (offer_slug, status, consented_at DESC);

CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  suppressed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_provider_events (
  fingerprint TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  message_id TEXT,
  message_stream TEXT,
  recipient_hash TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
