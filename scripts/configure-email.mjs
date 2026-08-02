import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';
import { postmarkTemplates, postmarkWebhookDefinitions } from './lib/postmark-setup.mjs';

const settings = await readLocalSettings();
const token = requireSetting(settings, 'POSTMARK_SERVER_TOKEN');
const siteUrl = requireSetting(settings, 'PUBLIC_SITE_URL');
const username = requireSetting(settings, 'POSTMARK_WEBHOOK_USERNAME');
const password = requireSetting(settings, 'POSTMARK_WEBHOOK_PASSWORD');

const request = async (path, init = {}) => {
  const response = await fetch(`https://api.postmarkapp.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ErrorCode) {
    throw new Error(payload.Message || `Postmark returned ${response.status}.`);
  }
  return payload;
};

const existingTemplates = await request('/templates?count=100&offset=0');
for (const template of postmarkTemplates()) {
  const exists = existingTemplates.Templates?.some((item) => item.Alias === template.Alias);
  await request(exists ? `/templates/${encodeURIComponent(template.Alias)}` : '/templates', {
    method: exists ? 'PUT' : 'POST',
    body: JSON.stringify(template),
  });
  console.log(`${exists ? 'Updated' : 'Created'} Postmark template: ${template.Alias}.`);
}

for (const definition of postmarkWebhookDefinitions({ siteUrl, username, password })) {
  const existing = await request(`/webhooks?messageStream=${definition.MessageStream}`);
  const webhook = existing.Webhooks?.find(
    (item) => item.Url === definition.Url && item.MessageStream === definition.MessageStream
  );
  await request(webhook ? `/webhooks/${encodeURIComponent(webhook.ID)}` : '/webhooks', {
    method: webhook ? 'PUT' : 'POST',
    body: JSON.stringify(definition),
  });
  console.log(`${webhook ? 'Updated' : 'Created'} ${definition.MessageStream} email webhook.`);
}

console.log('Postmark templates and authenticated webhooks are configured.');
