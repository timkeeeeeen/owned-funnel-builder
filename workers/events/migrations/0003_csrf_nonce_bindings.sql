CREATE TABLE IF NOT EXISTS tracking_csrf_nonces (
  nonce TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT,
  privacy_subject_id TEXT,
  consumed_at TEXT,
  choice_id TEXT,
  policy_version TEXT NOT NULL,
  context_hash TEXT,
  action TEXT,
  analytics_allowed INTEGER,
  advertising_allowed INTEGER,
  region_source TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_csrf_nonces_subject_idx
  ON tracking_csrf_nonces (tenant_id, site_id, visitor_id, privacy_subject_id, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS tracking_csrf_nonces_choice_idx
  ON tracking_csrf_nonces (tenant_id, site_id, choice_id) WHERE choice_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS tracking_csrf_nonce_choice_ledger
AFTER UPDATE OF consumed_at ON tracking_csrf_nonces
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
  INSERT INTO tracking_privacy_choices
    (choice_key, tenant_id, site_id, visitor_id, purpose, choice, policy_version,
     region_source, source, supersedes_choice_key, effective_at, observed_at, expires_at)
  VALUES
    (NEW.choice_id || ':analytics', NEW.tenant_id, NEW.site_id, NEW.privacy_subject_id,
     'analytics', CASE NEW.analytics_allowed WHEN 1 THEN 'allow' ELSE 'deny' END,
     NEW.policy_version, NEW.region_source, 'ui', NULL, NEW.consumed_at, NEW.consumed_at, NULL),
    (NEW.choice_id || ':advertising', NEW.tenant_id, NEW.site_id, NEW.privacy_subject_id,
     'advertising', CASE NEW.advertising_allowed WHEN 1 THEN 'allow' ELSE 'deny' END,
     NEW.policy_version, NEW.region_source, 'ui', NULL, NEW.consumed_at, NEW.consumed_at, NULL);
END;
