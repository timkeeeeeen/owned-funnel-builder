import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const evidenceFields = ['approval_id', 'validation_session_id', 'exact_sha', 'product_id', 'payment_id', 'webhook_id', 'canonical_event_key', 'delivery_id', 'refund_id', 'revocation_id', 'deactivation_id', 'owner_signoff'];

function assertValidRow(row: Record<string, unknown>): void {
  assert.equal(row.is_canary, true);
  assert.ok(['shadow', 'test_purchase', 'live_purchase_validated', 'campaign_ready', 'failed', 'paused', 'rolled_back'].includes(String(row.state)));
  if (row.state !== 'shadow') for (const field of evidenceFields) assert.notEqual(row[field], '', `${field} is required before advancement`);
}

test('pending canary matrix is complete, shadow-only, and evidence-free', async () => {
  const matrix = JSON.parse(await readFile(new URL('config/five-funnel-canary-matrix.json', root), 'utf8')) as { rows: Array<Record<string, unknown>> };
  assert.equal(matrix.rows.length, 13);
  for (const row of matrix.rows) {
    assert.equal(row.state, 'shadow');
    assert.equal(row.is_canary, true);
    for (const key of ['approval_id', 'validation_session_id', 'product_id', 'payment_id', 'webhook_id', 'canonical_event_key', 'delivery_id', 'refund_id', 'revocation_id', 'deactivation_id']) assert.equal(row[key], '');
    assertValidRow(row);
  }
  assert.deepEqual(matrix.rows.map(({ funnel, stage }) => [funnel, stage]), [
    ['owned-funnel-builder', 'owned-funnel-builder'], ['owned-funnel-builder', 'owned-funnel-conversion-copy-swipe-file'], ['owned-funnel-builder', 'owned-funnel-ten-blueprints'], ['owned-funnel-builder', 'owned-funnel-agency-toolkit'],
    ['talking-head-ad-machine', 'talking-head-ad-machine'], ['talking-head-ad-machine', 'talking-head-hook-recording-pack'], ['talking-head-ad-machine', 'talking-head-ad-test-lab'],
    ['vibe-code-anything', 'vibe-code-anything'], ['vibe-code-anything', 'vibe-code-prompt-pack'], ['vibe-code-anything', 'vibe-code-five-app-blueprints'], ['vibe-code-anything', 'vibe-code-production-launch-pack'],
    ['blueprint', 'blueprint_game_plan'], ['app-idea-evaluator', 'Complete Build Pack'],
  ]);
});

test('checklist rejects an evidence-free rollout advancement', () => {
  assert.throws(() => assertValidRow({ state: 'test_purchase', is_canary: true }), /approval_id is required/);
});

test('checklist keeps unverified source runtimes fail-closed and requires advancement evidence', async () => {
  const [matrix, rollout, gates, evidence] = await Promise.all([
    readFile(new URL('config/five-funnel-canary-matrix.json', root), 'utf8'), readFile(new URL('config/rollout-state.json', root), 'utf8'), readFile(new URL('config/source-runtime-gates.json', root), 'utf8'), readFile(new URL('docs/launch/first-party-event-pipeline-evidence.md', root), 'utf8'),
  ]);
  assert.match(matrix, /"required_evidence"/);
  assert.match(rollout, /"shadow"/);
  assert.match(gates, /"app_idea"[\s\S]*"unverified"/);
  assert.match(gates, /"blueprint"[\s\S]*"unverified"/);
  assert.match(evidence, /No provider readback has been performed|UNVERIFIED/);
});
