import { readdir } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const environment = args.has('--environment') ? process.argv[process.argv.indexOf('--environment') + 1] : '';
const approvalId = args.has('--approval-id') ? process.argv[process.argv.indexOf('--approval-id') + 1] : '';
const sha = args.has('--sha') ? process.argv[process.argv.indexOf('--sha') + 1] : '';
const execute = args.has('--execute');
if (!['preview', 'live'].includes(environment)) throw new Error('invalid environment');
if (execute && (!approvalId || !/^[a-f0-9]{40,64}$/i.test(sha))) throw new Error('--execute requires --approval-id and exact --sha');
const migrations = await Promise.all(
  ['migrations', 'workers/events/migrations'].map(async (directory) =>
    (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort().map((name) => `${directory}/${name}`)
  )
);
if (migrations.some((names) => names.length === 0)) throw new Error('migration discovery failed');
if (execute) throw new Error('migration blocked: resource, CI, and migration-lock readbacks are unverified');
console.log(JSON.stringify({ action: 'tracking_migrations', environment, mode: 'dry-run', mutations: false, migrations }));
