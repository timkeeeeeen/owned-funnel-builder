import { execFile } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const execute = promisify(execFile);
const settings = await readLocalSettings();
const projectName = requireSetting(settings, 'FUNNEL_CLOUDFLARE_PROJECT');
const databaseName = requireSetting(settings, 'FUNNEL_D1_DATABASE');
const paymentProvider = settings.PAYMENTS_PROVIDER || 'dodo';
if (!['dodo', 'stripe'].includes(paymentProvider)) {
  throw new Error('Choose Dodo or Stripe for payments.');
}
const environment = { ...process.env, ...settings };
const node = process.execPath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;

async function run(file, args, options = {}) {
  const result = await execute(file, args, {
    cwd: process.cwd(),
    env: environment,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (options.showOutput && result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout;
}

await run(npm, ['run', 'validate:config', '--', '--publish'], { showOutput: true });
await run(npm, ['run', 'build'], { showOutput: true });
await run(npm, ['run', 'check:functions'], { showOutput: true });
await copyFile('.wrangler/functions-build/index.js', 'dist/client/_worker.js');
await run(wrangler, ['d1', 'migrations', 'apply', databaseName, '--remote'], {
  showOutput: true,
});
if (paymentProvider === 'stripe') {
  await run(node, ['scripts/run-friendly.mjs', 'configure-stripe.mjs'], {
    showOutput: true,
  });
}
await run(node, ['scripts/run-friendly.mjs', 'upload-cloudflare-settings.mjs'], {
  showOutput: true,
});

await run(
  wrangler,
  ['pages', 'deploy', 'dist/client', '--project-name', projectName, '--branch', 'main'],
  { showOutput: true }
);
console.log(`Published the site at https://${projectName}.pages.dev/.`);

if (paymentProvider === 'dodo') {
  await run(node, ['scripts/run-friendly.mjs', 'configure-dodo-webhook.mjs'], {
    showOutput: true,
  });
  await run(node, ['scripts/run-friendly.mjs', 'upload-cloudflare-settings.mjs'], {
    showOutput: true,
  });
  await run(
    wrangler,
    ['pages', 'deploy', 'dist/client', '--project-name', projectName, '--branch', 'main'],
    { showOutput: false }
  );
}
console.log('Payment verification and access-email delivery are live.');
