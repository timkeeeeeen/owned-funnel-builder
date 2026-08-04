import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequestPost } from '../../functions/api/tracking/source-browser-events.ts';

test('source browser claims are same-origin and require the HttpOnly flow cookie', async () => {
  const env = {} as never;
  const crossOrigin = await onRequestPost({
    request: new Request('https://shop.example.test/api/tracking/source-browser-events', {
      method: 'POST',
      headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ funnel_slug: 'owned-funnel-builder', payment_ids: ['payment_1'] }),
    }),
    env,
  } as never);
  assert.equal(crossOrigin.status, 403);

  const publicToken = await onRequestPost({
    request: new Request('https://shop.example.test/api/tracking/source-browser-events', {
      method: 'POST',
      headers: { origin: 'https://shop.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ funnel_slug: 'owned-funnel-builder', payment_ids: ['payment_1'], flow: 'A'.repeat(43) }),
    }),
    env,
  } as never);
  assert.equal(publicToken.status, 400);
});

test('source browser claims reject the legacy bridge token', async () => {
  const response = await onRequestPost({
    request: new Request('https://shop.example.test/api/tracking/source-browser-events', {
      method: 'POST',
      headers: {
        origin: 'https://shop.example.test',
        'content-type': 'application/json',
        cookie: `ma_flow=${'A'.repeat(43)}`,
      },
      body: JSON.stringify({ funnel_slug: 'owned-funnel-builder', payment_ids: ['payment_1'] }),
    }),
    env: {
      TRACKING_SOURCE_BRIDGE_TOKEN: 'legacy-bridge-secret',
      TRACKING_SOURCE_BRIDGE: { fetch: async () => new Response(JSON.stringify({ claims: [] })) },
    },
  } as never);

  assert.equal(response.status, 503);
});

test('source browser claims expose only the canonical claim fields', async () => {
  const response = await onRequestPost({
    request: new Request('https://shop.example.test/api/tracking/source-browser-events', {
      method: 'POST',
      headers: {
        origin: 'https://shop.example.test',
        'content-type': 'application/json',
        cookie: `ma_flow=${'A'.repeat(43)}`,
      },
      body: JSON.stringify({ funnel_slug: 'owned-funnel-builder', payment_ids: ['payment_1'] }),
    }),
    env: {
      TRACKING_PAGES_BRIDGE_KEY_CURRENT: 'pages-bridge-secret',
      TRACKING_FLOW_BINDING_VERIFY: async () => true,
      TRACKING_SOURCE_BRIDGE: {
        fetch: async () => new Response(JSON.stringify({ claims: [{
          event_name: 'Purchase',
          event_id: 'purchase_1',
          payment_id: 'payment_1',
          custom_data: { value: 1, email: 'buyer@example.test' },
        }] })),
      },
    },
  } as never);

  assert.deepEqual(await response.json(), {
    claims: [{ event_name: 'Purchase', event_id: 'purchase_1', custom_data: { value: 1 } }],
  });
});
