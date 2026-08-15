import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { previewExecution, PREVIEW_RESOURCES } from './tracking-preview-contract.mjs';

const contract = previewExecution();
if (!contract.execute) {
  console.log(
    JSON.stringify({ action: 'tracking_preview_readiness', mode: 'dry-run', mutations: false })
  );
  process.exit(0);
}
const migrationSetSha = process.env.TRACKING_MIGRATION_SET_SHA ?? '';
if (!/^[a-f0-9]{64}$/.test(migrationSetSha)) throw new Error('migration set SHA is required');
const names = [
  '0001_tracking_ledger.sql',
  '0002_tracking_scope_hardening.sql',
  '0003_csrf_nonce_bindings.sql',
  '0004_delivery_safety.sql',
  '0005_runtime_safety.sql',
  '0006_waf_capability.sql',
  '0007_context_exchange.sql',
  '0007_privacy_destinations.sql',
  '0008_security_fix_wave.sql',
];
const now = new Date();
const capabilityHash = createHash('sha256')
  .update(`preview-worker-counter:${contract.workerSha}`)
  .digest('hex');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = `
INSERT INTO tracking_runtime_release_state
  (state_key, migration_names_json, migration_set_sha, release_sha, lock_state, updated_at)
VALUES ('active', ${quote(JSON.stringify(names))}, ${quote(migrationSetSha)}, ${quote(contract.workerSha)}, 'ready', ${quote(now.toISOString())})
ON CONFLICT(state_key) DO UPDATE SET migration_names_json=excluded.migration_names_json,
  migration_set_sha=excluded.migration_set_sha, release_sha=excluded.release_sha,
  lock_state=excluded.lock_state, updated_at=excluded.updated_at;
INSERT INTO tracking_ingress_capabilities
  (capability_key, status, config_hash, release_sha, observed_at, expires_at)
VALUES ('cloudflare_collector_abuse_protection', 'verified', ${quote(capabilityHash)}, ${quote(contract.workerSha)},
  ${quote(now.toISOString())}, ${quote(new Date(now.getTime() + 86_400_000).toISOString())})
ON CONFLICT(capability_key) DO UPDATE SET status=excluded.status, config_hash=excluded.config_hash,
  release_sha=excluded.release_sha, observed_at=excluded.observed_at, expires_at=excluded.expires_at;`;
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
const run = promisify(execFile);
await run(wrangler, [
  'd1',
  'execute',
  PREVIEW_RESOURCES.trackingDatabase,
  '--remote',
  '--config',
  'workers/events/wrangler.jsonc',
  '--command',
  sql,
]);
const { stdout } = await run(wrangler, [
  'd1',
  'execute',
  PREVIEW_RESOURCES.trackingDatabase,
  '--remote',
  '--config',
  'workers/events/wrangler.jsonc',
  '--json',
  '--command',
  "SELECT migration_set_sha, release_sha, lock_state FROM tracking_runtime_release_state WHERE state_key='active'; SELECT status, config_hash, release_sha, expires_at FROM tracking_ingress_capabilities WHERE capability_key='cloudflare_collector_abuse_protection';",
]);
const readback = JSON.parse(stdout).flatMap((result) => result.results ?? []);
if (
  !readback.some(
    (row) =>
      row.migration_set_sha === migrationSetSha &&
      row.release_sha === contract.workerSha &&
      row.lock_state === 'ready'
  ) ||
  !readback.some(
    (row) =>
      row.status === 'verified' &&
      row.config_hash === capabilityHash &&
      row.release_sha === contract.workerSha &&
      Date.parse(row.expires_at) > Date.now()
  )
)
  throw new Error('preview readiness readback failed');
console.log(
  JSON.stringify({
    action: 'tracking_preview_readiness',
    mode: 'execute',
    mutations: true,
    release_sha: contract.workerSha,
    migration_set_sha: migrationSetSha,
    ingress: 'worker-counter',
  })
);
