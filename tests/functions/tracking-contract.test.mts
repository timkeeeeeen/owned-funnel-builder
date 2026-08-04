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
  assert.equal(validateCanonicalEvent(event).event_name, 'PageView');
  assert.throws(() => validateCanonicalEvent({ event_name: 'ViewContent' }));
  for (const event_name of ['ViewContent', 'InitiateCheckout', 'Purchase']) {
    assert.equal(validateCanonicalEvent({ ...event, event_name }).event_name, event_name);
  }
  assert.throws(() => validateCanonicalEvent({ ...event, event_name: 'Lead' }));
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
        event_time: 1,
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
          event_time: 1,
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
          event_time: 1,
          event_id: event.event_id,
          action_source: 'website',
          user_data: { client_ip_address },
        },
      })
    );
  }
});
