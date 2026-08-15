import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('tracking preview workflow is manual, environment-scoped, and preview-only', async () => {
  const workflow = await readFile('.github/workflows/tracking-preview.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: tracking-preview/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /test "\$WORKER_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /test "\$SOURCE_SHA" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /META_ACCESS_TOKEN|TINYBIRD_APPEND_TOKEN|production|Dodo/i);
  const contract = await readFile('scripts/tracking-preview-contract.mjs', 'utf8');
  for (const value of [
    'owner-preview-tracking-2026-08-15',
    'maestro-first-party-events',
    'maestro-tracking-preview',
    'owned-funnel-builder-preview',
    'maestro-events-preview',
    'maestro-events-preview-dlq',
    'events-preview.shop.maestrogtm.com',
  ])
    assert.match(contract, new RegExp(value));
  assert.match(contract, /\{40\}/);
});

test('preview execution rejects live scope or a missing exact source SHA before mutation', () => {
  const common = [
    'scripts/apply-tracking-migrations.mjs',
    '--approval-id',
    'owner-preview-tracking-2026-08-15',
    '--worker-sha',
    'a'.repeat(40),
    '--execute',
  ];
  assert.notEqual(spawnSync(process.execPath, [...common, '--environment', 'live']).status, 0);
  assert.notEqual(spawnSync(process.execPath, [...common, '--environment', 'preview']).status, 0);
});

test('readiness activation binds exact release and ingress evidence before deployment', async () => {
  const source = await readFile('scripts/activate-tracking-preview-readiness.mjs', 'utf8');
  assert.match(source, /tracking_runtime_release_state/);
  assert.match(source, /tracking_ingress_capabilities/);
  assert.match(source, /readFile\('workers\/events\/wrangler\.jsonc'/);
  assert.match(source, /git', \['rev-parse', 'HEAD'\]/);
  assert.match(source, /readback failed/);
});
