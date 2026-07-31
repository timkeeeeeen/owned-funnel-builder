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
  requireSetting(settings, 'RESEND_API_KEY');
  requireSetting(settings, 'RESEND_FROM_EMAIL');
}
if (Boolean(settings.RESEND_API_KEY) !== Boolean(settings.RESEND_FROM_EMAIL)) {
  throw new Error('Resend needs both its API key and From address, or neither one.');
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
