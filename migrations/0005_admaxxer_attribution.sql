ALTER TABLE checkout_leads ADD COLUMN admaxxer_visitor_id TEXT;

CREATE INDEX IF NOT EXISTS checkout_leads_admaxxer_visitor_idx
  ON checkout_leads (admaxxer_visitor_id);
