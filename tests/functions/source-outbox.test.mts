import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  toSafeBrowserPurchase,
  drainSourceEvent,
  recoverSourceOutbox,
  type BrowserPurchaseClaim,
  type VerifiedPurchase,
} from '../../functions/_lib/source-outbox.ts';

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

test('safe browser projection reconstructs the allowlist from a Worker claim', () => {
  const unsafe: BrowserPurchaseClaim = {
    payment_id: 'pay_1',
    event_id: 'event_1',
    custom_data: {
      content_ids: ['base'],
      content_type: 'product',
      value: 49,
      currency: 'USD',
      num_items: 1,
      // @ts-expect-error Worker JSON is untrusted at this boundary.
      email: 'buyer@example.com',
    },
  };
  assert.deepEqual(toSafeBrowserPurchase(unsafe), {
    payment_id: 'pay_1',
    event_id: 'event_1',
    custom_data: {
      content_ids: ['base'],
      content_type: 'product',
      value: 49,
      currency: 'USD',
      num_items: 1,
    },
  });
});

test('outbox leases and redacts only the requested tenant/site/source-event row', async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          calls.push({ query, values });
          return statement;
        },
        async first() {
          return query.startsWith('SELECT')
            ? {
                tenant_id: 'tenant_b',
                site_id: 'site_b',
                source_event_id: 'same-id',
                payload_json: '{"event_id":"event_b"}',
              }
            : null;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  };
  let body = '';
  const delivered = await drainSourceEvent(
    database as never,
    {
      TRACKING_SOURCE_BRIDGE_TOKEN: 'bridge-secret',
      TRACKING_SOURCE_BRIDGE: {
        fetch: async (request: Request) => {
          body = await request.text();
          return new Response(null, { status: 202 });
        },
      },
    },
    { tenantId: 'tenant_b', siteId: 'site_b', sourceEventId: 'same-id' },
    'owner_b'
  );

  assert.equal(delivered, true);
  assert.equal(body, '{"event_id":"event_b"}');
  assert.deepEqual(calls[0]?.values.slice(0, 3), ['tenant_b', 'site_b', 'same-id']);
  assert.equal(
    calls.every(
      (call) =>
        !call.query.includes('source_tracking_outbox') ||
        call.values.includes('tenant_b') ||
        call.query.includes('WHERE expires_at <=')
    ),
    true
  );
});

test('scheduled recovery reclaims stale sending leases and expires/redacts overdue rows', async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          calls.push({ query, values });
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  };
  assert.equal(await recoverSourceOutbox(database as never, {}), 0);
  assert.equal(calls[0]?.query.includes("state = 'expired'"), true);
  assert.equal(calls[0]?.query.includes("payload_json = '{}'"), true);
  assert.equal(calls[1]?.query.includes("state = 'sending' AND lease_until < ?"), true);
});
