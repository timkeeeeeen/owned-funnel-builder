import DodoPayments from 'dodopayments';
import { readLocalSettings, requireSetting, writeLocalSettings } from './lib/local-settings.mjs';

const settings = await readLocalSettings();
const apiKey = requireSetting(settings, 'DODO_PAYMENTS_API_KEY');
const environment = requireSetting(settings, 'DODO_PAYMENTS_ENVIRONMENT');
const siteUrl = requireSetting(settings, 'PUBLIC_SITE_URL').replace(/\/$/, '');
const webhookUrl = `${siteUrl}/api/webhooks/dodo`;
const client = new DodoPayments({ bearerToken: apiKey, environment });

let webhook;
for await (const item of client.webhooks.list()) {
  if (item.url === webhookUrl && item.metadata?.owned_funnel_builder === 'true') {
    webhook = item;
    break;
  }
}
if (!webhook) {
  webhook = await client.webhooks.create({
    url: webhookUrl,
    description: 'Owned Funnel Builder payment fulfillment',
    filter_types: ['payment.succeeded', 'payment.failed'],
    metadata: { owned_funnel_builder: 'true' },
  });
  console.log('Created the verified Dodo payment webhook.');
} else {
  console.log('The Dodo payment webhook is already connected.');
}

const secret = await client.webhooks.retrieveSecret(webhook.id);
settings.DODO_PAYMENTS_WEBHOOK_KEY = secret.secret;
await writeLocalSettings(settings);
console.log('Saved the webhook signing key locally without printing it.');
