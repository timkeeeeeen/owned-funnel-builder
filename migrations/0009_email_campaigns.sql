CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  offer_slug TEXT,
  subject TEXT NOT NULL,
  preheader TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'partial', 'failed')),
  recipient_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS email_campaigns_created_idx
  ON email_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES email_campaigns(id),
  subscriber_id TEXT NOT NULL REFERENCES email_subscribers(id),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'accepted', 'transient_failure', 'permanent_failure')),
  provider_message_id TEXT,
  error_code INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS email_campaign_recipients_status_idx
  ON email_campaign_recipients (campaign_id, status);
