ALTER TABLE checkout_leads ADD COLUMN bump_selected INTEGER NOT NULL DEFAULT 0
  CHECK (bump_selected IN (0, 1));

CREATE TABLE IF NOT EXISTS checkout_funnels (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL UNIQUE REFERENCES checkout_leads(id),
  token_hash TEXT NOT NULL UNIQUE,
  base_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (base_status IN ('pending', 'succeeded', 'failed')),
  base_payment_id TEXT,
  dodo_customer_id TEXT,
  blueprints_status TEXT NOT NULL DEFAULT 'offered'
    CHECK (blueprints_status IN ('offered', 'charging', 'accepted', 'declined', 'failed')),
  blueprints_session_id TEXT,
  blueprints_payment_id TEXT,
  blueprints_checkout_url TEXT,
  launch_status TEXT NOT NULL DEFAULT 'offered'
    CHECK (launch_status IN ('offered', 'charging', 'accepted', 'declined', 'failed')),
  launch_session_id TEXT,
  launch_payment_id TEXT,
  launch_checkout_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS checkout_funnels_lead_idx ON checkout_funnels (lead_id);

CREATE TABLE IF NOT EXISTS offer_products (
  product_key TEXT PRIMARY KEY,
  dodo_product_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
