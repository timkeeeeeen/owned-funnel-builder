CREATE TABLE IF NOT EXISTS checkout_leads (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  offer_slug TEXT NOT NULL,
  placement TEXT NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 1 CHECK (marketing_consent IN (0, 1)),
  consent_version TEXT NOT NULL,
  attribution_json TEXT NOT NULL DEFAULT '{}',
  referrer TEXT,
  country TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('captured', 'session_created', 'session_failed', 'converted', 'unsubscribed')
  ),
  dodo_session_id TEXT,
  dodo_payment_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS checkout_leads_offer_created_idx
  ON checkout_leads (offer_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS checkout_leads_email_idx
  ON checkout_leads (email);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_leads_dodo_session_idx
  ON checkout_leads (dodo_session_id)
  WHERE dodo_session_id IS NOT NULL;
