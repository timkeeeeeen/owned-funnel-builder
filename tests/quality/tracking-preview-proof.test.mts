import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertTrackingPreviewRows } from '../../scripts/lib/tracking-preview-proof.mjs';

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
    '/api/internal/tracking-preview-proof',
  ])
    assert.match(source, new RegExp(value.replaceAll('/', '\\/')));
  assert.match(source, /getSetCookie/);
  assert.match(source, /cookieHeader/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /destination_deliveries: deliveredCount/);
  assert.doesNotMatch(source, /META_ACCESS_TOKEN|TINYBIRD_APPEND_TOKEN|DODO/i);
});

test('proof readback requires exact events, no Purchase, and zero delivered destinations', () => {
  const expected = [
    { event_name: 'PageView', event_id: 'pageview_1' },
    { event_name: 'Lead', event_id: 'lead_1' },
    { event_name: 'InitiateCheckout', event_id: 'checkout_1' },
  ];
  const valid = [{ results: expected }, { results: [{ delivered_count: 0 }] }];
  assert.equal(assertTrackingPreviewRows(valid, expected), 0);
  assert.throws(() =>
    assertTrackingPreviewRows(
      [
        { results: [...expected, { event_name: 'Purchase', event_id: 'purchase_1' }] },
        { results: [{ delivered_count: 0 }] },
      ],
      expected
    )
  );
  assert.throws(() =>
    assertTrackingPreviewRows(
      [{ results: expected }, { results: [{ delivered_count: 1 }] }],
      expected
    )
  );
});
