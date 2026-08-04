CREATE TABLE IF NOT EXISTS tracking_visitors (
  visitor_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  person_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_people (
  person_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_person_redirects (
  from_person_id TEXT PRIMARY KEY,
  to_person_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_identity_conflicts (
  conflict_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  left_person_id TEXT,
  right_person_id TEXT,
  state TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS tracking_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_touch_json TEXT NOT NULL,
  latest_touch_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_aliases (
  alias_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  issuer_namespace TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  keyed_digest TEXT NOT NULL,
  hmac_key_id TEXT NOT NULL,
  person_id TEXT,
  visitor_id TEXT,
  verification_class TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, identifier_type, issuer_namespace, normalization_version, keyed_digest)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  event_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  privacy_state_json TEXT NOT NULL,
  bot_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, event_name, event_id)
);

CREATE TABLE IF NOT EXISTS tracking_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE REFERENCES tracking_events(event_key),
  state TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_key)
);

CREATE TABLE IF NOT EXISTS tracking_provider_event_mappings (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_key TEXT NOT NULL REFERENCES tracking_events(event_key),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider, provider_object_id, event_name)
);

CREATE TABLE IF NOT EXISTS tracking_source_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_key TEXT NOT NULL REFERENCES tracking_events(event_key),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, source_system, source_event_id)
);

CREATE TABLE IF NOT EXISTS tracking_nonces (
  nonce TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_deliveries (
  delivery_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  destination TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_request_id TEXT,
  payload_hash TEXT,
  outcome TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_key, destination)
);

CREATE TABLE IF NOT EXISTS tracking_buyer_context (
  context_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  funnel_id TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  fbp TEXT,
  fbc TEXT,
  external_id TEXT,
  browser_ip TEXT,
  browser_user_agent TEXT,
  event_source_url TEXT,
  attribution_json TEXT NOT NULL,
  identity_hmac_json TEXT NOT NULL,
  meta_identity_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, lead_id, funnel_id)
);

CREATE TABLE IF NOT EXISTS tracking_purchase_browser_claims (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  funnel_token_hash TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, payment_id)
);

CREATE TABLE IF NOT EXISTS tracking_privacy_choices (
  choice_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT,
  purpose TEXT NOT NULL,
  choice TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  region_source TEXT NOT NULL,
  source TEXT NOT NULL,
  supersedes_choice_key TEXT,
  effective_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_suppression_tombstones (
  suppression_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  alias_key TEXT,
  visitor_id TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_deletion_requests (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  request_type TEXT NOT NULL,
  state TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  audit_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_outbox_due_idx
  ON tracking_outbox (state, next_attempt_at);
CREATE INDEX IF NOT EXISTS tracking_events_occurred_idx
  ON tracking_events (occurred_at);
