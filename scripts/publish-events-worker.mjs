import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = new Set(process.argv.slice(2));
const environment = args.has('--environment') ? process.argv[process.argv.indexOf('--environment') + 1] : 'preview';
const approvalId = args.has('--approval-id') ? process.argv[process.argv.indexOf('--approval-id') + 1] : '';
const execute = args.has('--execute');
if (!['preview', 'live'].includes(environment)) throw new Error('invalid environment');
if (execute && !approvalId) throw new Error('--execute requires --approval-id');
if (execute) throw new Error('deployment blocked: provider, source, and CI readbacks are unverified');

const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
await promisify(execFile)(wrangler, ['deploy', '--config', 'workers/events/wrangler.jsonc', '--dry-run'], {
  maxBuffer: 8 * 1024 * 1024,
});
console.log(JSON.stringify({ action: 'events_worker_deploy', environment, mode: 'dry-run', mutations: false }));
