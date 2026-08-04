ALTER TABLE source_tracking_provider_mappings ADD COLUMN claim_owner TEXT;
ALTER TABLE source_tracking_provider_mappings ADD COLUMN claim_until TEXT;
ALTER TABLE source_tracking_provider_mappings ADD COLUMN claim_state TEXT NOT NULL DEFAULT 'committed';

CREATE INDEX IF NOT EXISTS source_tracking_provider_claim_idx
  ON source_tracking_provider_mappings (tenant_id, site_id, provider, provider_object_id, claim_state, claim_until);
