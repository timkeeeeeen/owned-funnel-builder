import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { previewExecution, PREVIEW_RESOURCES } from './tracking-preview-contract.mjs';

const contract = previewExecution();
const migrations = await Promise.all(
  ['migrations', 'workers/events/migrations'].map(async (directory) =>
    (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  )
);
if (migrations.some((names) => names.length === 0)) throw new Error('migration discovery failed');
let migrationEvidence = [];
if (contract.execute) {
  const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
  const run = promisify(execFile);
  const maxBuffer = 4 * 1024 * 1024;
  const pagesMigration = await run(
    wrangler,
    [
      'd1',
      'migrations',
      'apply',
      PREVIEW_RESOURCES.pagesDatabase,
      '--remote',
      '--config',
      'wrangler.jsonc',
      '--env',
      'preview',
    ],
    { maxBuffer }
  );
  const trackingMigration = await run(
    wrangler,
    [
      'd1',
      'migrations',
      'apply',
      PREVIEW_RESOURCES.trackingDatabase,
      '--remote',
      '--config',
      'workers/events/wrangler.jsonc',
    ],
    { maxBuffer }
  );
  migrationEvidence = [
    ['pages', pagesMigration],
    ['tracking', trackingMigration],
  ].map(([target, { stdout, stderr }]) => ({
    target,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }));
}
console.log(
  JSON.stringify({
    action: 'tracking_migrations',
    environment: 'preview',
    mode: contract.execute ? 'execute' : 'dry-run',
    mutations: contract.execute,
    migrations,
    migration_evidence: migrationEvidence,
  })
);
