import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('tracking preview workflow is manual, environment-scoped, and preview-only', async () => {
  const workflow = await readFile('.github/workflows/tracking-preview.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: tracking-preview/);
  assert.match(workflow, /node-version: 22/);
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
