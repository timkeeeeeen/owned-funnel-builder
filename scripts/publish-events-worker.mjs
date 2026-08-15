import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { previewExecution } from './tracking-preview-contract.mjs';

const contract = previewExecution();
const migrationSetSha = process.env.TRACKING_MIGRATION_SET_SHA ?? '';
if (contract.execute && !/^[a-f0-9]{64}$/.test(migrationSetSha))
  throw new Error('TRACKING_MIGRATION_SET_SHA is required');

const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
const wranglerArgs = [
  'deploy',
  '--config',
  'workers/events/wrangler.jsonc',
  ...(contract.execute
    ? [
        '--var',
        `TRACKING_RELEASE_SHA:${contract.workerSha}`,
        '--var',
        `TRACKING_MIGRATION_SET_SHA:${migrationSetSha}`,
        '--var',
        `TRACKING_PAGES_SOURCE_SHA:${contract.sourceSha}`,
      ]
    : ['--dry-run']),
];
await promisify(execFile)(wrangler, wranglerArgs, {
  maxBuffer: 8 * 1024 * 1024,
});
console.log(
  JSON.stringify({
    action: 'events_worker_deploy',
    environment: 'preview',
    mode: contract.execute ? 'execute' : 'dry-run',
    mutations: contract.execute,
  })
);
