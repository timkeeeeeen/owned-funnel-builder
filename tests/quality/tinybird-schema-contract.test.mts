import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Tinybird projection is versioned, keyed, deduplicated, and tombstone-filtered', async () => {
  const root = new URL('../../', import.meta.url);
  const schema = await readFile(new URL('tinybird/datasources/first_party_events.datasource', root), 'utf8');
  const dedup = await readFile(new URL('tinybird/pipes/first_party_events_dedup.pipe', root), 'utf8');
  const tombstones = await readFile(new URL('tinybird/pipes/privacy_tombstone_filter.pipe', root), 'utf8');
  assert.match(schema, /canonical_key String/);
  assert.match(schema, /privacy_subject_key String/);
  assert.match(dedup, /PARTITION BY canonical_key/);
  assert.match(tombstones, /LEFT ANTI JOIN privacy_tombstones/);
});
