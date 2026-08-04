import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = new Set(process.argv.slice(2));
const environment = args.has('--environment') ? process.argv[process.argv.indexOf('--environment') + 1] : 'preview';
const approvalId = args.has('--approval-id') ? process.argv[process.argv.indexOf('--approval-id') + 1] : '';
const project = args.has('--project') ? process.argv[process.argv.indexOf('--project') + 1] : process.env.CLOUDFLARE_PAGES_PROJECT;
const execute = args.has('--execute');

if (!['preview', 'live'].includes(environment)) throw new Error('invalid environment');
if (execute && !approvalId) throw new Error('--execute requires --approval-id');
if (execute) throw new Error('deployment blocked: provider, source, and CI readbacks are unverified');
if (!project || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(project)) throw new Error('pages project is required for dry-run validation');
await access('dist');
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
await promisify(execFile)(wrangler, ['pages', 'deploy', 'dist', '--project-name', project, '--dry-run'], { maxBuffer: 8 * 1024 * 1024 });
console.log(JSON.stringify({ action: 'pages_deploy', environment, project, mode: 'dry-run', mutations: false }));
