import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const settings = await readLocalSettings();
const apiKey = requireSetting(settings, 'RESEND_API_KEY');
const from = requireSetting(settings, 'RESEND_FROM_EMAIL');
const recipient = settings.FUNNEL_TEST_EMAIL || requireSetting(settings, 'SUPPORT_EMAIL');

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from,
    to: [recipient],
    subject: 'Your funnel email is connected',
    text: 'Success. Resend can deliver purchase access emails for your funnel.',
    html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px"><p style="color:#2563eb;font-weight:700;text-transform:uppercase;letter-spacing:.12em">Setup check</p><h1>Your funnel email is connected.</h1><p style="font-size:18px;line-height:1.6;color:#4b5563">Success. Resend can deliver purchase access emails for your funnel.</p></div>',
  }),
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) {
  const result = await response.json().catch(() => ({}));
  throw new Error(result.message || `Resend returned ${response.status}.`);
}
console.log(`Resend sent a test access email to ${recipient}.`);
