import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { readLocalSettings, requireSetting, writeLocalSettings } from './lib/local-settings.mjs';

const execute = promisify(execFile);
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
const settings = await readLocalSettings();
const projectName = requireSetting(settings, 'FUNNEL_CLOUDFLARE_PROJECT');
const databaseName = requireSetting(settings, 'FUNNEL_D1_DATABASE');
const safeName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
if (!safeName.test(projectName) || !safeName.test(databaseName)) {
  throw new Error(
    'Cloudflare site and database names must use lowercase letters, numbers, and dashes.'
  );
}

async function run(args, options = {}) {
  try {
    const result = await execute(wrangler, args, {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
    return result.stdout;
  } catch (error) {
    const message = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    throw new Error(message || `Cloudflare command failed: ${args.slice(0, 3).join(' ')}`, {
      cause: error,
    });
  }
}

try {
  await run(['whoami']);
} catch {
  throw new Error(
    'Cloudflare is not connected yet. Ask your agent to open the Cloudflare sign-in, approve it in your browser, and run setup again.'
  );
}

const projects = JSON.parse(await run(['pages', 'project', 'list', '--json']));
if (!projects.some((project) => project.name === projectName)) {
  await run(['pages', 'project', 'create', projectName, '--production-branch', 'main']);
  console.log(`Created the Cloudflare Pages site ${projectName}.`);
} else {
  console.log(`Cloudflare Pages site ${projectName} is already connected.`);
}

const databases = JSON.parse(await run(['d1', 'list', '--json']));
let database = databases.find((item) => item.name === databaseName);
if (!database) {
  await run(['d1', 'create', databaseName, '--location', 'enam']);
  const refreshed = JSON.parse(await run(['d1', 'list', '--json']));
  database = refreshed.find((item) => item.name === databaseName);
  console.log(`Created the private order database ${databaseName}.`);
}
if (!database?.uuid) throw new Error('Cloudflare created the database but did not return its ID.');

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
config.name = projectName;
config.d1_databases = [
  {
    binding: 'LEADS',
    database_name: databaseName,
    database_id: database.uuid,
    migrations_dir: 'migrations',
  },
];
await writeFile('wrangler.jsonc', `${JSON.stringify(config, null, 2)}\n`);

await run(['d1', 'migrations', 'apply', databaseName, '--remote']);
console.log('The order database is ready.');

settings.PUBLIC_SITE_URL = `https://${projectName}.pages.dev`;
await writeLocalSettings(settings);
console.log('Cloudflare setup complete. No secrets were printed.');
