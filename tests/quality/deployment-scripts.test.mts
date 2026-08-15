import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('deployment scripts are dry-run first and execution is approval-gated', async () => {
  for (const file of [
    'scripts/publish-cloudflare.mjs',
    'scripts/publish-events-worker.mjs',
    'scripts/provision-preview-events.mjs',
    'scripts/apply-tracking-migrations.mjs',
  ]) {
    const source = await readFile(file, 'utf8');
    if (file === 'scripts/publish-cloudflare.mjs')
      assert.match(source, /--execute requires --approval-id/);
    else assert.match(source, /tracking-preview-contract/);
  }
  const migrations = await readFile('scripts/apply-tracking-migrations.mjs', 'utf8');
  assert.match(migrations, /readdir/);
  assert.match(migrations, /\.sort\(\)/);
});

test('tracking execution contract rejects live scope and requires exact preview approval and SHAs', async () => {
  const source = await readFile('scripts/tracking-preview-contract.mjs', 'utf8');
  assert.match(source, /owner-preview-tracking-2026-08-15/);
  assert.match(source, /preview only/);
  assert.match(source, /\{40\}/);
  assert.doesNotMatch(source, /production|maestro-tracking-live|maestro-events-live/);
});

test('Pages dry-run probes the installed Wrangler CLI without the removed dry-run flag', async () => {
  const source = await readFile('scripts/publish-cloudflare.mjs', 'utf8');
  assert.match(source, /'--help'/);
  assert.doesNotMatch(source, /'--dry-run'/);
});

test('live Pages execution is explicitly approval- and SHA-bound', async () => {
  const source = await readFile('scripts/publish-cloudflare.mjs', 'utf8');
  assert.match(source, /--execute requires --approval-id and --sha/);
  assert.match(source, /--branch', 'main'/);
  assert.match(source, /pages', 'deploy', 'dist\/client'/);
  assert.match(source, /--commit-hash/);
});
