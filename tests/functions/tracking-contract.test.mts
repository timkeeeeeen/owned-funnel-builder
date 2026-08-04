import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  validateCanonicalEvent,
  validateDestinationProjection,
} from '../../functions/_lib/tracking-contract.ts';

const event = {
  schema_version: '1',
  tenant_id: 'maestro',
  site_id: 'shop',
  event_id: crypto.randomUUID(),
  event_name: 'PageView',
  source: 'browser',
  source_system: 'pages',
  occurred_at: new Date().toISOString(),
  visitor: {},
  session: {},
  page: {},
  attribution: {},
  identity: {},
  commerce: {},
  privacy: {},
} as const;

test('accepts only the four version-one canonical events', () => {
  for (const event_name of ['PageView', 'Lead', 'InitiateCheckout', 'Purchase']) {
    assert.equal(validateCanonicalEvent({ ...event, event_name }).event_name, event_name);
  }
  assert.throws(() => validateCanonicalEvent({ ...event, event_name: 'ViewContent' }));
});

test('applies event-specific commerce allowlists', () => {
  const lead = validateCanonicalEvent({
    ...event,
    event_name: 'Lead',
    commerce: {
      offer_id: 'blueprint',
      content_ids: ['blueprint'],
      content_type: 'product',
      value: 5,
      currency: 'USD',
      num_items: 1,
    },
  });
  assert.deepEqual(lead.commerce.content_ids, ['blueprint']);
  assert.throws(() => validateCanonicalEvent({ ...event, commerce: { offer_id: 'blueprint' } }));
  assert.throws(() =>
    validateCanonicalEvent({ ...event, event_name: 'Lead', commerce: { payment_id: 'pmt' } })
  );
  assert.throws(() =>
    validateCanonicalEvent({
      ...event,
      event_name: 'Purchase',
      commerce: { content_ids: 'blueprint' },
    })
  );
});

test('rejects unknown, sensitive, and oversized event fields', () => {
  assert.throws(() => validateCanonicalEvent({ ...event, properties: { email: 'x' } }));
  assert.throws(() =>
    validateCanonicalEvent({ ...event, attribution: { fbclid: 'x'.repeat(257) } })
  );
  assert.throws(() =>
    validateCanonicalEvent({ ...event, identity: { email: 'buyer@example.com' } })
  );
  assert.throws(() =>
    validateCanonicalEvent({ ...event, page: { path: 'https://example.com/path' } })
  );
  assert.throws(() => validateCanonicalEvent({ ...event, page: { path: '//example.com/path' } }));
  assert.throws(() =>
    validateCanonicalEvent({ ...event, page: { path: 'ftp://example.com/path' } })
  );
  assert.throws(() => validateCanonicalEvent({ ...event, session: { flow_token: 'secret' } }));
  assert.throws(() => validateCanonicalEvent({ ...event, commerce: { properties: {} } }));
});

test('accepts only closed destination projections', () => {
  assert.equal(
    validateDestinationProjection({
      destination: 'meta',
      event_name: 'PageView',
      event_id: event.event_id,
      occurred_at: event.occurred_at,
      payload: {
        event_name: 'PageView',
        event_time: Math.floor(Date.parse(event.occurred_at) / 1000),
        event_id: event.event_id,
        action_source: 'website',
      },
    }).destination,
    'meta'
  );
  assert.throws(() =>
    validateDestinationProjection({
      destination: 'meta',
      event_name: 'PageView',
      event_id: event.event_id,
      occurred_at: event.occurred_at,
      payload: { event_name: 'PageView', properties: { email: 'buyer@example.com' } },
    })
  );
  for (const field of ['client_ip_address', 'client_user_agent']) {
    assert.throws(() =>
      validateDestinationProjection({
        destination: 'meta',
        event_name: 'PageView',
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        payload: {
          event_name: 'PageView',
          event_time: Math.floor(Date.parse(event.occurred_at) / 1000),
          event_id: event.event_id,
          action_source: 'website',
          user_data: { [field]: '+1 212 555 0123' },
        },
      })
    );
  }
  for (const client_ip_address of ['212:555:0123', 'a:b']) {
    assert.throws(() =>
      validateDestinationProjection({
        destination: 'meta',
        event_name: 'PageView',
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        payload: {
          event_name: 'PageView',
          event_time: Math.floor(Date.parse(event.occurred_at) / 1000),
          event_id: event.event_id,
          action_source: 'website',
          user_data: { client_ip_address },
        },
      })
    );
  }
});

test('rejects phone-like values in opaque event and commerce identifiers', () => {
  assert.throws(() => validateCanonicalEvent({ ...event, event_id: '+1 212 555 0123' }));
  assert.throws(() =>
    validateCanonicalEvent({
      ...event,
      event_name: 'Purchase',
      commerce: { payment_id: '+1 212 555 0123' },
    })
  );
  assert.throws(() =>
    validateCanonicalEvent({
      ...event,
      event_name: 'Purchase',
      commerce: { contents: [{ id: '+1 212 555 0123', quantity: 1 }] },
    })
  );
});

test('rejects cross-event Meta custom data and the legacy source path', () => {
  assert.throws(() =>
    validateDestinationProjection({
      destination: 'meta',
      event_name: 'PageView',
      event_id: event.event_id,
      occurred_at: event.occurred_at,
      payload: {
        event_name: 'PageView',
        event_time: Math.floor(Date.parse(event.occurred_at) / 1000),
        event_id: event.event_id,
        action_source: 'website',
        event_source_path: '/checkout',
      },
    })
  );
  assert.throws(() =>
    validateDestinationProjection({
      destination: 'meta',
      event_name: 'PageView',
      event_id: event.event_id,
      occurred_at: event.occurred_at,
      payload: {
        event_name: 'PageView',
        event_time: Math.floor(Date.parse(event.occurred_at) / 1000),
        event_id: event.event_id,
        action_source: 'website',
        custom_data: { value: 1 },
      },
    })
  );
});

test('accepts Purchase commerce identifiers and strict Meta numeric fields', () => {
  const purchase = {
    ...event,
    event_name: 'Purchase' as const,
    commerce: {
      order_id: 'order-1',
      payment_id: 'payment-1',
      value: 1,
      currency: 'USD',
      quantity: 1,
      num_items: 1,
    },
  };
  assert.equal(
    validateDestinationProjection({
      destination: 'meta',
      event_name: 'Purchase',
      event_id: purchase.event_id,
      occurred_at: purchase.occurred_at,
      payload: {
        event_name: 'Purchase',
        event_time: Math.floor(Date.parse(purchase.occurred_at) / 1000),
        event_id: purchase.event_id,
        action_source: 'website',
        event_source_url: 'https://shop.maestrogtm.com/checkout/complete',
        custom_data: {
          order_id: 'order-1',
          payment_id: 'payment-1',
          value: 1,
          currency: 'USD',
          quantity: 1,
          num_items: 1,
        },
      },
    }).destination,
    'meta'
  );
  assert.throws(() =>
    validateDestinationProjection({
      destination: 'meta',
      event_name: 'Purchase',
      event_id: purchase.event_id,
      occurred_at: purchase.occurred_at,
      payload: {
        event_name: 'Purchase',
        event_time: 1.5,
        event_id: purchase.event_id,
        action_source: 'website',
      },
    })
  );
  assert.throws(() =>
    validateCanonicalEvent({
      ...event,
      event_name: 'Purchase',
      commerce: { quantity: 1.5, currency: 'US' },
    })
  );
});
