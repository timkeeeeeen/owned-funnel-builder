import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const execute = promisify(execFile);
const settings = await readLocalSettings();
const projectName = requireSetting(settings, 'FUNNEL_CLOUDFLARE_PROJECT');
for (const key of ['DODO_PAYMENTS_API_KEY', 'DODO_PAYMENTS_ENVIRONMENT', 'SUPPORT_EMAIL']) {
  requireSetting(settings, key);
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
