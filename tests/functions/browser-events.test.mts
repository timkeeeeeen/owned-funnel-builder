import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onRequestPost } from '../../functions/api/funnel/browser-events.ts';

const flow = 'a'.repeat(43);
const purchase = {
  payment_id: 'pay_1',
  event_id: 'purchase_pay_1',
  value: 49,
  currency: 'USD',
  contents: [{ id: 'owned-funnel-builder', quantity: 1, item_price: 49 }],
};

test('browser claims are same-origin, flow-bound, and single-use at the Worker seam', async () => {
  let claims = 0;
  const bridge = {
    fetch: async (request: Request) => {
      assert.equal(request.headers.get('authorization'), 'Bearer bridge-secret');
      assert.deepEqual(await request.json(), { flow_token: flow });
      claims += 1;
      return Response.json({ purchases: claims === 1 ? [purchase] : [] });
    },
  };
  const request = () =>
    new Request('https://funnels.example/api/funnel/browser-events', {
      method: 'POST',
      headers: { Origin: 'https://funnels.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow }),
    });
  const env = { TRACKING_SOURCE_BRIDGE: bridge, TRACKING_SOURCE_BRIDGE_TOKEN: 'bridge-secret' };

  const first = await onRequestPost({ request: request(), env });
  const second = await onRequestPost({ request: request(), env });

  assert.equal(first.status, 200);
  assert.deepEqual((await first.json()).purchases, [
    {
      payment_id: 'pay_1',
      event_id: 'purchase_pay_1',
      custom_data: {
        content_ids: ['owned-funnel-builder'],
        content_type: 'product',
        value: 49,
        currency: 'USD',
        num_items: 1,
      },
    },
  ]);
  assert.deepEqual((await second.json()).purchases, []);
});

test('browser claims reject cross-origin and preflight requests', async () => {
  const env = { TRACKING_SOURCE_BRIDGE: { fetch: async () => Response.json({ purchases: [] }) } };
  for (const request of [
    new Request('https://funnels.example/api/funnel/browser-events', { method: 'POST' }),
    new Request('https://funnels.example/api/funnel/browser-events', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    }),
    new Request('https://funnels.example/api/funnel/browser-events', {
      method: 'POST',
      headers: { Origin: 'https://funnels.example', 'Access-Control-Request-Method': 'POST' },
    }),
  ]) {
    assert.equal((await onRequestPost({ request, env })).status, 403);
  }
});

test('browser claims fail closed without bridge credentials and strip untrusted Worker fields', async () => {
  let calls = 0;
  const bridge = {
    fetch: async () => {
      calls += 1;
      return Response.json({
        purchases: [
          {
            payment_id: 'pay_unsafe',
            event_id: 'event_unsafe',
            custom_data: {
              content_ids: ['product'],
              content_type: 'product',
              value: 49,
              currency: 'USD',
              num_items: 1,
              email: 'buyer@example.com',
            },
            buyer_context: { email: 'buyer@example.com' },
          },
        ],
      });
    },
  };
  const request = () =>
    new Request('https://funnels.example/api/funnel/browser-events', {
      method: 'POST',
      headers: { Origin: 'https://funnels.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow }),
    });

  assert.equal(
    (await onRequestPost({ request: request(), env: { TRACKING_SOURCE_BRIDGE: bridge } })).status,
    503
  );
  assert.equal(calls, 0);

  const response = await onRequestPost({
    request: request(),
    env: { TRACKING_SOURCE_BRIDGE: bridge, TRACKING_SOURCE_BRIDGE_TOKEN: 'bridge-secret' },
  });
  assert.deepEqual((await response.json()).purchases, [
    {
      payment_id: 'pay_unsafe',
      event_id: 'event_unsafe',
      custom_data: {
        content_ids: ['product'],
        content_type: 'product',
        value: 49,
        currency: 'USD',
        num_items: 1,
      },
    },
  ]);
});
