import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { previewExecution, PREVIEW_APPROVAL } from '../../scripts/tracking-preview-contract.mjs';

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
  assert.match(migrations, /maxBuffer/);
  assert.match(migrations, /pagesMigration/);
  assert.match(migrations, /trackingMigration/);
});

test('tracking execution contract rejects live scope and requires exact preview approval and SHAs', () => {
  const sha = 'a'.repeat(40);
  assert.throws(
    () => previewExecution(['--execute', '--worker-sha', sha, '--source-sha', sha]),
    /--environment preview is required/
  );
  assert.throws(
    () =>
      previewExecution([
        '--execute',
        '--environment',
        'live',
        '--approval-id',
        PREVIEW_APPROVAL,
        '--worker-sha',
        sha,
        '--source-sha',
        sha,
      ]),
    /preview only/
  );
  assert.throws(
    () =>
      previewExecution([
        '--execute',
        '--environment',
        'preview',
        '--approval-id',
        PREVIEW_APPROVAL,
        '--worker-sha',
        sha,
        '--source-sha',
        'short',
      ]),
    /--execute requires --approval-id and exact preview SHAs/
  );
  assert.equal(
    previewExecution([
      '--execute',
      '--environment',
      'preview',
      '--approval-id',
      PREVIEW_APPROVAL,
      '--worker-sha',
      sha,
      '--source-sha',
      sha,
    ]).execute,
    true
  );
  assert.equal(previewExecution([]).execute, false);
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
