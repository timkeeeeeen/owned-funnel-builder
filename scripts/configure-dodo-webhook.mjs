import DodoPayments from 'dodopayments';
import { readLocalSettings, requireSetting, writeLocalSettings } from './lib/local-settings.mjs';

const settings = await readLocalSettings();
const apiKey = requireSetting(settings, 'DODO_PAYMENTS_API_KEY');
const environment = requireSetting(settings, 'DODO_PAYMENTS_ENVIRONMENT');
const siteUrl = requireSetting(settings, 'PUBLIC_SITE_URL').replace(/\/$/, '');
const webhookUrl = `${siteUrl}/api/webhooks/dodo`;
const client = new DodoPayments({ bearerToken: apiKey, environment });
const DODO_WEBHOOK_EVENTS = [
  'payment.succeeded',
  'payment.failed',
  'refund.succeeded',
  'dispute.opened',
  'dispute.accepted',
  'dispute.won',
  'dispute.lost',
  'entitlement_grant.delivered',
  'entitlement_grant.failed',
  'entitlement_grant.revoked',
];
const webhookConfig = {
  url: webhookUrl,
  description: 'Owned Funnel Builder payment fulfillment',
  filter_types: DODO_WEBHOOK_EVENTS,
  metadata: { owned_funnel_builder: 'true' },
};

let webhook;
for await (const item of client.webhooks.list()) {
  if (item.url === webhookUrl && item.metadata?.owned_funnel_builder === 'true') {
    webhook = item;
    break;
  }
}
if (!webhook) {
  webhook = await client.webhooks.create(webhookConfig);
  console.log('Created the verified Dodo payment webhook.');
} else {
  webhook = await client.webhooks.update(webhook.id, webhookConfig);
  console.log('Reconciled the verified Dodo payment webhook.');
}

const secret = await client.webhooks.retrieveSecret(webhook.id);
settings.DODO_PAYMENTS_WEBHOOK_KEY = secret.secret;
await writeLocalSettings(settings);
console.log('Saved the webhook signing key locally without printing it.');
