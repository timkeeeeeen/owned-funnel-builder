import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = new Set(process.argv.slice(2));
const environment = args.has('--environment') ? process.argv[process.argv.indexOf('--environment') + 1] : 'preview';
const approvalId = args.has('--approval-id') ? process.argv[process.argv.indexOf('--approval-id') + 1] : '';
const sha = args.has('--sha') ? process.argv[process.argv.indexOf('--sha') + 1] : '';
const project = args.has('--project') ? process.argv[process.argv.indexOf('--project') + 1] : process.env.CLOUDFLARE_PAGES_PROJECT;
const execute = args.has('--execute');

if (!['preview', 'live'].includes(environment)) throw new Error('invalid environment');
if (execute && (!approvalId || !sha)) throw new Error('--execute requires --approval-id and --sha');
if (execute && !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('--sha must be a full commit SHA');
if (!project || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(project)) throw new Error('pages project is required for dry-run validation');
await access('dist');
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
if (execute) {
  await promisify(execFile)(
    wrangler,
    ['pages', 'deploy', 'dist', '--project-name', project, '--commit-hash', sha],
    { maxBuffer: 8 * 1024 * 1024 }
  );
  console.log(JSON.stringify({ action: 'pages_deploy', environment, project, mode: 'execute', sha, mutations: true }));
} else {
  // Wrangler 4 removed `pages deploy --dry-run`; probing help keeps this path
  // non-mutating while still proving the installed CLI accepts Pages deploy.
  await promisify(execFile)(wrangler, ['pages', 'deploy', 'dist', '--project-name', project, '--help'], { maxBuffer: 8 * 1024 * 1024 });
  console.log(JSON.stringify({ action: 'pages_deploy', environment, project, mode: 'dry-run', mutations: false }));
}
