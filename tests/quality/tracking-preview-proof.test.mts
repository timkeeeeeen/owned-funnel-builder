import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('preview proof covers non-payment events and proves destinations remain dark', async () => {
  const source = await readFile('scripts/prove-tracking-preview.mjs', 'utf8');
  for (const value of [
    '/healthz',
    '/v1/bootstrap',
    'PageView',
    'Lead',
    'InitiateCheckout',
    'Purchase',
    'preview_payment_event_blocked',
    'tracking_deliveries',
  ])
    assert.match(source, new RegExp(value.replaceAll('/', '\\/')));
  assert.match(source, /destination_deliveries: 0/);
  assert.doesNotMatch(source, /META_ACCESS_TOKEN|TINYBIRD_APPEND_TOKEN|DODO/i);
});
