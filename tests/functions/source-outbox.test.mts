import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toSafeBrowserPurchase, type VerifiedPurchase } from '../../functions/_lib/source-outbox.ts';

test('safe browser purchase projection removes buyer context and preserves commerce', () => {
  const purchase: VerifiedPurchase = {
    payment_id: 'pay_1',
    event_id: 'event_1',
    value: 68,
    currency: 'USD',
    contents: [
      { id: 'base', quantity: 1, item_price: 49 },
      { id: 'bump', quantity: 1, item_price: 19 },
    ],
  };

  assert.deepEqual(toSafeBrowserPurchase(purchase), {
    payment_id: 'pay_1',
    event_id: 'event_1',
    custom_data: {
      content_ids: ['base', 'bump'],
      content_type: 'product',
      value: 68,
      currency: 'USD',
      num_items: 2,
    },
  });
});
