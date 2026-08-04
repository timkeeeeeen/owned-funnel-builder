import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sendMeta } from '../src/meta.ts';
import { sendTinybird } from '../src/tinybird.ts';

const event = {
  schema_version: '1', tenant_id: 'tenant_demo', site_id: 'site_demo', event_id: 'evt_1',
  event_name: 'Purchase', source: 'server', source_system: 'pages',
  occurred_at: '2026-08-04T12:00:00.000Z', visitor: {}, session: {}, page: { path: '/thanks' },
  attribution: { fbp: 'fb.1.1.abc', fbc: 'fb.1.1.def' }, identity: { order_id: 'ord_1' },
  commerce: { order_id: 'ord_1', payment_id: 'pay_1', content_ids: ['prod_1'], content_type: 'product', currency: 'USD', value: 12.5, quantity: 1 },
  privacy: { policy_version: '2026-01-01', region: 'US', gpc: false, opted_out: false },
} as const;

test('Meta emits a validated, redacted CAPI payload and accepts 2xx', async () => {
  let request: Request | undefined;
  const result = await sendMeta(event as never, {
    META_PIXEL_ID: '123', META_ACCESS_TOKEN: 'secret', META_GRAPH_VERSION: 'v23.0',
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init); return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace_1' }), { status: 200 });
    },
  }, { event_source_url: 'https://shop.maestrogtm.com/thanks', email: ' Buyer@Example.COM ', phone: '+1 (212) 555-0123', ip: '203.0.113.1', user_agent: 'Mozilla/5.0', meta_identity_version: 'meta-v1' });
  assert.equal(result.state, 'accepted');
  const payload = await request!.json() as { data: Array<Record<string, unknown>> };
  assert.equal(request!.url, 'https://graph.facebook.com/v23.0/123/events');
  assert.equal(payload.data[0].event_id, 'evt_1');
  assert.equal((payload.data[0].user_data as { em: string[] }).em[0], '6a6c26195c3682faa816966af789717c3bfa834eee6c599d667d2b3429c27cfd');
  assert.equal((payload.data[0].user_data as { client_ip_address: string }).client_ip_address, '203.0.113.1');
  assert.equal((payload.data[0].custom_data as { payment_id: string }).payment_id, 'pay_1');
  assert.equal('event_source_path' in payload.data[0], false);
});

test('Meta classifies throttles and Tinybird rejects invalid append responses', async () => {
  const meta = await sendMeta(event as never, { META_PIXEL_ID: '123', META_ACCESS_TOKEN: 'secret', fetch: async () => new Response('', { status: 429, headers: { 'retry-after': '9' } }) }, { event_source_url: 'https://shop.maestrogtm.com/thanks' });
  assert.deepEqual(meta, { state: 'retryable', retryAfterSeconds: 9 });
  const tinybird = await sendTinybird(event as never, { TINYBIRD_APPEND_URL: 'https://api.tinybird.co/v0/events', TINYBIRD_APPEND_TOKEN: 'secret', fetch: async () => new Response('bad', { status: 400 }) });
  assert.equal(tinybird.state, 'permanent');
});
