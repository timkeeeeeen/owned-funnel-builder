import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const utm = 'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign=<slug>&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}';

test('five funnel readiness remains copy-draft, paused, and canonical-ledger controlled', async () => {
  const [copy, campaigns, launch, matrix] = await Promise.all([
    readFile(new URL('docs/launch/five-funnel-copy-deck.md', root), 'utf8'),
    readFile(new URL('docs/launch/meta-campaign-ledger.md', root), 'utf8'),
    readFile(new URL('docs/launch/five-funnel-launch-ledger.md', root), 'utf8'),
    readFile(new URL('config/five-funnel-canary-matrix.json', root), 'utf8'),
  ]);
  assert.match(copy, /Status: draft/);
  assert.match(campaigns, /five-funnel-launch-ledger\.md/);
  assert.equal((campaigns.match(/not created \/ paused/g) ?? []).length, 5);
  assert.match(campaigns, new RegExp(utm.replace(/[{}?]/g, '\\$&')));
  assert.doesNotMatch(campaigns, /campaign_enabled/);
  assert.match(launch, /Campaign gate: not created \/ paused/);
  const parsed = JSON.parse(matrix) as { rows: Array<{ state: string }>; gate_records: Array<Record<string, unknown>> };
  const rows = parsed.rows;
  assert.equal(rows.length, 13);
  assert.equal(parsed.gate_records.length, 13);
  for (const row of rows) {
    assert.equal(row.state, 'shadow');
  }
  for (const gate of parsed.gate_records) {
    assert.equal(gate.status, 'unverified');
    assert.equal(gate.approver, '');
    for (const key of ['exact_software_sha', 'exact_source_sha', 'preview_evidence_id', 'minimum_event_sample', 'maximum_duplicate_rate', 'maximum_source_latency', 'maximum_queue_latency', 'maximum_destination_latency', 'field_presence_floor', 'privacy_dsar_status', 'canary_refund_status']) assert.equal(gate[key], '');
  }
});
