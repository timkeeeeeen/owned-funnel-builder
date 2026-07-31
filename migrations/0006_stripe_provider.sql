ALTER TABLE offer_products RENAME TO offer_products_dodo_only;

CREATE TABLE offer_products (
  product_key TEXT PRIMARY KEY,
  dodo_product_id TEXT UNIQUE,
  stripe_price_id TEXT UNIQUE,
  name TEXT NOT NULL,
  price_amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (dodo_product_id IS NOT NULL OR stripe_price_id IS NOT NULL)
);

INSERT INTO offer_products (
  product_key, dodo_product_id, stripe_price_id, name, price_amount, currency,
  created_at, updated_at
)
SELECT
  product_key, dodo_product_id, NULL, name, price_amount, currency,
  created_at, updated_at
FROM offer_products_dodo_only;

DROP TABLE offer_products_dodo_only;

ALTER TABLE checkout_leads ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'dodo'
  CHECK (payment_provider IN ('dodo', 'stripe'));
ALTER TABLE checkout_leads ADD COLUMN stripe_session_id TEXT;
ALTER TABLE checkout_leads ADD COLUMN stripe_payment_intent_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS checkout_leads_stripe_session_idx
  ON checkout_leads (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

ALTER TABLE funnel_runs ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'dodo'
  CHECK (payment_provider IN ('dodo', 'stripe'));
ALTER TABLE funnel_runs ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE funnel_runs ADD COLUMN stripe_payment_method_id TEXT;

ALTER TABLE funnel_step_runs ADD COLUMN stripe_session_id TEXT;
ALTER TABLE funnel_step_runs ADD COLUMN stripe_payment_intent_id TEXT;
