CREATE TABLE IF NOT EXISTS funnel_runs (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL UNIQUE REFERENCES checkout_leads(id),
  offer_slug TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  base_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (base_status IN ('pending', 'succeeded', 'failed')),
  base_payment_id TEXT,
  dodo_customer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS funnel_runs_offer_idx ON funnel_runs (offer_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS funnel_step_runs (
  id TEXT PRIMARY KEY,
  funnel_id TEXT NOT NULL REFERENCES funnel_runs(id),
  step_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'charging', 'accepted', 'declined', 'failed')),
  dodo_session_id TEXT,
  dodo_payment_id TEXT,
  checkout_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (funnel_id, step_key),
  UNIQUE (funnel_id, ordinal)
);

CREATE INDEX IF NOT EXISTS funnel_step_runs_funnel_idx
  ON funnel_step_runs (funnel_id, ordinal);

CREATE TABLE IF NOT EXISTS webhook_events (
  webhook_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS fulfillments (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES checkout_leads(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  resend_email_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (payment_id, product_key)
);

CREATE INDEX IF NOT EXISTS fulfillments_status_idx ON fulfillments (status, updated_at);
