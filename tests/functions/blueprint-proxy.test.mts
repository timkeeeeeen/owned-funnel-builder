import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestPost as startCheckout } from '../../functions/api/blueprint/checkout-start.ts';
import { onRequestPost as statusCheckout } from '../../functions/api/blueprint/checkout-status.ts';

const token = `v1.${'a'.repeat(32)}.${'b'.repeat(43)}`;
const eventId = 'initiate_checkout:blueprint_session_1';

function request(path: string, body: unknown, method = 'POST') {
  return new Request(`https://shop.maestrogtm.com${path}`, {
    method,
    headers: {
      Origin: 'https://shop.maestrogtm.com',
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

function bridge(value: unknown) {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (outbound: Request) => {
      calls.push(outbound);
      return Response.json({ status: 'success', value });
    },
  };
}

const verifier = async (value: string, candidate: string) =>
  value === token && candidate.length > 0;

test('checkout-start proxies a fixed Convex operation and never places the token in the URL', async () => {
  const service = bridge({
    checkoutUrl: 'https://checkout.dodopayments.com/session_1',
    lead: { event_id: 'lead:blueprint_1', event_name: 'Lead' },
    initiateCheckout: {
      event_id: eventId,
      event_name: 'InitiateCheckout',
      custom_data: { content_name: 'Maestro Blueprint', content_ids: ['cmo-game-plan'] },
    },
  });
  const response = await startCheckout({
    request: request('/api/blueprint/checkout-start', {
      tracking_context_token: token,
      candidate_event_id: eventId,
      public_session_token: 'public-session-token',
      checkout_idempotency_key: 'checkout_1',
      turnstile_token: 'turnstile-token',
    }),
    env: { BLUEPRINT_CONVEX_BRIDGE: service, BLUEPRINT_CONTEXT_TOKEN_VERIFY: verifier },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    checkoutUrl: 'https://checkout.dodopayments.com/session_1',
    lead: { event_id: 'lead:blueprint_1', event_name: 'Lead' },
    initiateCheckout: {
      event_id: eventId,
      event_name: 'InitiateCheckout',
      custom_data: { content_name: 'Maestro Blueprint', content_ids: ['cmo-game-plan'] },
    },
  });
  assert.equal(service.calls.length, 1);
  const outbound = service.calls[0]!;
  assert.equal(new URL(outbound.url).search, '');
  assert.equal(new URL(outbound.url).pathname, '/internal/blueprint/checkout-start');
  assert.match(await outbound.text(), /trackingContextToken/);
  assert.ok(!outbound.url.includes(token));
});

test('checkout-status is POST-only, requires a candidate event and returns a safe status payload', async () => {
  const service = bridge({
    state: 'ready',
    checkoutUrl: 'https://checkout.dodopayments.com/session_1',
    initiateCheckout: { event_id: eventId, event_name: 'InitiateCheckout' },
  });
  const response = await statusCheckout({
    request: request('/api/blueprint/checkout-status', {
      tracking_context_token: token,
      candidate_event_id: eventId,
      public_session_token: 'public-session-token',
      checkout_idempotency_key: 'checkout_1',
    }),
    env: { BLUEPRINT_CONVEX_BRIDGE: service, BLUEPRINT_CONTEXT_TOKEN_VERIFY: verifier },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: 'ready',
    checkoutUrl: 'https://checkout.dodopayments.com/session_1',
    initiateCheckout: { event_id: eventId, event_name: 'InitiateCheckout' },
  });

  assert.equal(
    (
      await statusCheckout({
        request: request('/api/blueprint/checkout-status', {}, 'GET'),
        env: { BLUEPRINT_CONVEX_BRIDGE: service, BLUEPRINT_CONTEXT_TOKEN_VERIFY: verifier },
      })
    ).status,
    405
  );
});

test('proxy rejects cross-origin, preflight, missing token, and PII-bearing source responses', async () => {
  const service = bridge({
    state: 'ready',
    email: 'buyer@example.com',
    checkoutUrl: 'https://checkout.dodopayments.com/session_1',
  });
  const base = {
    BLUEPRINT_CONVEX_BRIDGE: service,
    BLUEPRINT_CONTEXT_TOKEN_VERIFY: verifier,
  };
  assert.equal(
    (
      await startCheckout({
        request: new Request('https://shop.maestrogtm.com/api/blueprint/checkout-start', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
        }),
        env: base,
      })
    ).status,
    403
  );
  assert.equal(
    (
      await startCheckout({
        request: new Request('https://shop.maestrogtm.com/api/blueprint/checkout-start', {
          method: 'POST',
          headers: {
            Origin: 'https://shop.maestrogtm.com',
            'Access-Control-Request-Method': 'POST',
          },
        }),
        env: base,
      })
    ).status,
    403
  );
  assert.equal(
    (
      await startCheckout({
        request: request('/api/blueprint/checkout-start', {
          candidate_event_id: eventId,
          public_session_token: 'public-session-token',
        }),
        env: base,
      })
    ).status,
    400
  );
  assert.equal(
    (
      await statusCheckout({
        request: request('/api/blueprint/checkout-status', {
          tracking_context_token: token,
          candidate_event_id: eventId,
          public_session_token: 'public-session-token',
          checkout_idempotency_key: 'checkout_1',
        }),
        env: base,
      })
    ).status,
    502
  );
});
