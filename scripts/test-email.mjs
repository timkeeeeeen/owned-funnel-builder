import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const settings = await readLocalSettings();
const token = requireSetting(settings, 'POSTMARK_SERVER_TOKEN');
const from = requireSetting(settings, 'EMAIL_TRANSACTIONAL_FROM');
const recipient = settings.FUNNEL_TEST_EMAIL || 'test@blackhole.postmarkapp.com';

const response = await fetch('https://api.postmarkapp.com/email', {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Postmark-Server-Token': token,
  },
  body: JSON.stringify({
    From: from,
    To: recipient,
    Subject: 'Your funnel email is connected',
    TextBody: 'Success. Postmark can deliver transactional email for your funnel.',
    HtmlBody:
      '<h1>Your funnel email is connected.</h1><p>Success. Postmark can deliver transactional email for your funnel.</p>',
    MessageStream: 'outbound',
    TrackOpens: false,
    TrackLinks: 'None',
  }),
  signal: AbortSignal.timeout(10_000),
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result.ErrorCode) {
  throw new Error(result.Message || `Postmark returned ${response.status}.`);
}
console.log(`Postmark accepted the test message for ${recipient}.`);
