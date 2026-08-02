import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const execute = promisify(execFile);
const settings = await readLocalSettings();
const projectName = requireSetting(settings, 'FUNNEL_CLOUDFLARE_PROJECT');
const provider = settings.PAYMENTS_PROVIDER || 'dodo';
if (!['dodo', 'stripe'].includes(provider)) throw new Error('Choose Dodo or Stripe for payments.');
requireSetting(settings, 'SUPPORT_EMAIL');
if (provider === 'dodo') {
  requireSetting(settings, 'DODO_PAYMENTS_API_KEY');
  requireSetting(settings, 'DODO_PAYMENTS_ENVIRONMENT');
} else {
  requireSetting(settings, 'STRIPE_SECRET_KEY');
  requireSetting(settings, 'STRIPE_PAYMENTS_ENVIRONMENT');
  requireSetting(settings, 'STRIPE_WEBHOOK_SECRET');
  requireSetting(settings, 'POSTMARK_SERVER_TOKEN');
  requireSetting(settings, 'EMAIL_TRANSACTIONAL_FROM');
}
if (Boolean(settings.POSTMARK_SERVER_TOKEN) !== Boolean(settings.EMAIL_TRANSACTIONAL_FROM)) {
  throw new Error(
    'Email needs both its Postmark token and transactional From address, or neither one.'
  );
}
if (settings.POSTMARK_SERVER_TOKEN) {
  requireSetting(settings, 'EMAIL_MARKETING_FROM');
  requireSetting(settings, 'EMAIL_OPERATOR_SECRET');
  requireSetting(settings, 'EMAIL_UNSUBSCRIBE_SECRET');
  requireSetting(settings, 'POSTMARK_WEBHOOK_USERNAME');
  requireSetting(settings, 'POSTMARK_WEBHOOK_PASSWORD');
}

const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
try {
  await execute(wrangler, ['pages', 'secret', 'bulk', '.dev.vars', '--project-name', projectName], {
    cwd: process.cwd(),
    maxBuffer: 4 * 1024 * 1024,
  });
  console.log(
    'Cloudflare received the private payment and email settings. No values were printed.'
  );
} catch (error) {
  throw new Error(error?.stderr?.trim() || 'Cloudflare could not save the private settings.', {
    cause: error,
  });
}
