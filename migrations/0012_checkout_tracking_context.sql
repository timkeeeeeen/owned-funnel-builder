ALTER TABLE checkout_leads ADD COLUMN context_hash TEXT;
ALTER TABLE checkout_leads ADD COLUMN context_expires_at TEXT;
ALTER TABLE checkout_leads ADD COLUMN flow_binding TEXT;
ALTER TABLE checkout_leads ADD COLUMN privacy_snapshot_json TEXT;
ALTER TABLE funnel_runs ADD COLUMN context_hash TEXT;
ALTER TABLE funnel_runs ADD COLUMN context_expires_at TEXT;
ALTER TABLE funnel_runs ADD COLUMN flow_binding TEXT;
ALTER TABLE funnel_runs ADD COLUMN privacy_snapshot_json TEXT;
