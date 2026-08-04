import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { healthResponse, alertPayload } from '../src/observability.ts';

test('health response is safe for external probes', async () => {
  const response = healthResponse();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', version: '1' });
});

test('alert payload never includes raw event data or credentials', () => {
  const payload = alertPayload({ oldestUnresolved: 3, dlqCount: 2, eventKeys: ['event_1'] });
  assert.deepEqual(payload, { oldest_unresolved: 3, dlq_count: 2, event_keys: ['event_1'] });
  assert.equal(JSON.stringify(payload).includes('secret'), false);
});

test('queue bindings pin retry, batching, concurrency, and DLQ safety values', async () => {
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  for (const value of [
    '"max_batch_size": 50',
    '"max_retries": 5',
    '"retry_delay": 15',
    '"max_concurrency": 4',
    '"dead_letter_queue": "maestro-events-preview-dlq"',
    '"dead_letter_queue": "maestro-events-live-dlq"',
  ]) {
    assert.ok(config.includes(value), `missing ${value}`);
  }
  assert.equal(
    /BUSINESS_DB|checkout_leads|DODO_API_KEY|META_ACCESS_TOKEN|TINYBIRD_TOKEN/.test(config),
    false
  );
  const cleanupBatchSizes = [...config.matchAll(/"TRACKING_CLEANUP_BATCH_SIZE": "(\d+)"/g)].map(
    (match) => Number(match[1])
  );
  assert.equal(cleanupBatchSizes.length, 2);
  assert.equal(
    cleanupBatchSizes.every((size) => size >= 1_200 && size <= 5_000),
    true,
    'preview and production cleanup capacity must clear the 1200-row/minute peak within the hard cap'
  );
  assert.ok((50 * 4 * 4) / 60 > 10, 'recorded 10 events/sec peak clears inside five minutes');
});
