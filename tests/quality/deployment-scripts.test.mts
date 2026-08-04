import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('deployment scripts are dry-run first and execution is approval-gated', async () => {
  for (const file of ['scripts/publish-cloudflare.mjs', 'scripts/publish-events-worker.mjs', 'scripts/provision-preview-events.mjs', 'scripts/apply-tracking-migrations.mjs']) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /--execute requires --approval-id/);
    assert.match(source, /unverified/);
  }
  const migrations = await readFile('scripts/apply-tracking-migrations.mjs', 'utf8');
  assert.match(migrations, /readdir/);
  assert.match(migrations, /\.sort\(\)/);
});
