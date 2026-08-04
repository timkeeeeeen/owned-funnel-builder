import assert from 'node:assert/strict';
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
