ALTER TABLE tracking_events ADD COLUMN buyer_context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tracking_context_exchanges ADD COLUMN consumed_event_id TEXT;
ALTER TABLE tracking_context_exchanges ADD COLUMN consumed_flow_binding TEXT;
ALTER TABLE tracking_purchase_browser_claims ADD COLUMN funnel_id TEXT;
CREATE INDEX IF NOT EXISTS tracking_context_exchanges_consumed_idx
  ON tracking_context_exchanges (context_hash, consumed_at, expires_at);
