import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { deliverPurchase } from '../../functions/_lib/fulfillment.ts';
import { nextFunnelPath, type FunnelState } from '../../functions/_lib/funnel.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1RunResult,
  Environment,
} from '../../functions/_lib/runtime.ts';
import { onRequestPost as createCheckout } from '../../functions/api/checkout.ts';
import { onRequestPost as decideUpsell } from '../../functions/api/funnel/decision.ts';
import { onRequestGet as getFunnelStatus } from '../../functions/api/funnel/status.ts';
import { onRequestPost as receiveWebhook } from '../../functions/api/webhooks/dodo.ts';

type Method = 'run' | 'first' | 'all';
type Handler = (
  query: string,
  values: Array<string | number | null>,
  method: Method
) => unknown | Promise<unknown>;

class FakeStatement implements D1PreparedStatement {
  private values: Array<string | number | null> = [];

  constructor(
    private readonly query: string,
    private readonly handler: Handler
  ) {}

  bind(...values: Array<string | number | null>): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1RunResult> {
    return (await this.handler(this.query, this.values, 'run')) as D1RunResult;
  }

  async first<T>(): Promise<T | null> {
    return (await this.handler(this.query, this.values, 'first')) as T | null;
  }

  async all<T>(): Promise<{ results?: T[] }> {
    return (await this.handler(this.query, this.values, 'all')) as { results?: T[] };
  }
}

class FakeDatabase implements D1Database {
  readonly calls: Array<{ query: string; values: Array<string | number | null>; method: Method }> =
    [];

  constructor(private readonly handler: Handler) {}

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(query, async (statement, values, method) => {
      this.calls.push({ query: statement, values, method });
      return this.handler(statement, values, method);
    });
  }
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function checkoutRequest(body: Record<string, unknown>): Request {
  return new Request('https://funnels.example/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://funnels.example' },
    body: JSON.stringify(body),
  });
}

function checkoutDatabase(products: Record<string, string>): FakeDatabase {
  return new FakeDatabase((query, values, method) => {
    if (query.includes('SELECT dodo_product_id FROM offer_products')) {
      const productId = products[String(values[0])];
      return productId ? { dodo_product_id: productId } : null;
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    if (method === 'all') return { results: [] };
    return null;
  });
}

test('checkout creates the configured cart, bump, steps, and first upsell return path', async () => {
  const database = checkoutDatabase({
    'owned-funnel-builder': 'prod_main',
    'owned-funnel-conversion-copy-swipe-file': 'prod_bump',
  });
  let providerBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      checkout_url: 'https://checkout.dodopayments.com/session/test',
      session_id: 'session_123',
    });
  };

  const response = await createCheckout({
    request: checkoutRequest({
      email: 'OWNER@example.com',
      offerSlug: 'owned-funnel-builder',
      placement: 'hero',
      consentVersion: 'v1',
      bumpAccepted: true,
      attribution: { utm_source: 'newsletter', ignored: 'nope' },
      admaxxerVisitorId: 'admx_visitor_123',
    }),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((providerBody?.product_cart as unknown[]).length, 2);
  assert.deepEqual(providerBody?.customer, { email: 'owner@example.com' });
  assert.equal(providerBody?.show_saved_payment_methods, true);
  assert.equal((providerBody?.feature_flags as Record<string, unknown>).redirect_immediately, true);
  const returnUrl = new URL(String(providerBody?.return_url));
  assert.equal(returnUrl.pathname, '/checkout/upsell/funnel-blueprints/');
  assert.equal(returnUrl.searchParams.get('offer'), 'owned-funnel-builder');
  assert.match(returnUrl.searchParams.get('flow') ?? '', /^[A-Za-z0-9_-]{43}$/);
  const metadata = providerBody?.metadata as Record<string, string>;
  assert.equal(metadata.bump_product_key, 'owned-funnel-conversion-copy-swipe-file');
  assert.equal(metadata.admx_visitor_id, 'admx_visitor_123');
  const leadInsert = database.calls.find((call) =>
    call.query.includes('INSERT INTO checkout_leads')
  );
  assert.equal(leadInsert?.values.includes('admx_visitor_123'), true);
  assert.equal(
    database.calls.filter((call) => call.query.includes('INSERT INTO funnel_step_runs')).length,
    2
  );
});

test('checkout fails closed when a configured product has no Dodo mapping', async () => {
  const database = checkoutDatabase({});
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };
  const response = await createCheckout({
    request: checkoutRequest({
      email: 'owner@example.com',
      offerSlug: 'owned-funnel-builder',
      consentVersion: 'v1',
    }),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  assert.equal(response.status, 503);
  assert.equal(fetchCalls, 0);
  assert.equal((await response.json()).code, 'configuration_product');
});

test('checkout ignores an invalid Admaxxer visitor id instead of forwarding it', async () => {
  const database = checkoutDatabase({ 'owned-funnel-builder': 'prod_main' });
  let providerBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      checkout_url: 'https://checkout.dodopayments.com/session/test',
      session_id: 'session_123',
    });
  };

  const response = await createCheckout({
    request: checkoutRequest({
      email: 'owner@example.com',
      offerSlug: 'owned-funnel-builder',
      consentVersion: 'v1',
      admaxxerVisitorId: '<script>alert(1)</script>',
    }),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });

  assert.equal(response.status, 200);
  const metadata = providerBody?.metadata as Record<string, string>;
  assert.equal(metadata.admx_visitor_id, undefined);
});

function funnelState(stepStatuses: Array<FunnelState['steps'][number]['status']>): FunnelState {
  return {
    run: {
      id: 'funnel_1',
      lead_id: 'lead_1',
      offer_slug: 'owned-funnel-builder',
      token_hash: 'hash',
      base_status: 'succeeded',
      base_payment_id: 'pay_base',
      dodo_customer_id: 'customer_1',
      dodo_payment_method_id: 'method_from_payment',
      dodo_session_id: 'session_base',
      bump_selected: 1,
      admaxxer_visitor_id: 'admx_visitor_123',
    },
    steps: stepStatuses.map((status, ordinal) => ({
      id: `step_${ordinal}`,
      funnel_id: 'funnel_1',
      step_key: ordinal === 0 ? 'funnel-blueprints' : 'agency-toolkit',
      ordinal,
      status,
      dodo_session_id: null,
      dodo_payment_id: null,
      checkout_url: null,
    })),
  };
}

function stateDatabase(state: FunnelState): FakeDatabase {
  return new FakeDatabase((query, values, method) => {
    if (query.includes('SELECT f.*, l.dodo_session_id')) return state.run;
    if (query.includes('SELECT * FROM funnel_step_runs')) return { results: state.steps };
    if (query.includes('SELECT dodo_product_id FROM offer_products')) {
      return { dodo_product_id: `product_${String(values[0])}` };
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    if (method === 'all') return { results: [] };
    return null;
  });
}

function decisionRequest(offer: string, decision: 'accept' | 'decline'): Request {
  return new Request('https://funnels.example/api/funnel/decision', {
    method: 'POST',
    headers: { Origin: 'https://funnels.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow: 'a'.repeat(43), offer, decision }),
  });
}

test('upsells enforce ordering and declines are idempotent', async () => {
  const blocked = await decideUpsell({
    request: decisionRequest('agency-toolkit', 'decline'),
    env: {
      LEADS: stateDatabase(funnelState(['offered', 'offered'])),
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  assert.equal(blocked.status, 409);

  const acceptedState = funnelState(['accepted', 'offered']);
  const database = stateDatabase(acceptedState);
  const repeated = await decideUpsell({
    request: decisionRequest('funnel-blueprints', 'decline'),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), {
    state: 'accepted',
    nextUrl: 'https://funnels.example/checkout/upsell/agency-toolkit/?flow=' + 'a'.repeat(43),
  });
  assert.equal(
    database.calls.some((call) => call.query.includes("SET status = 'declined'")),
    false
  );
});

test('upsell prefers the original payment method for a true one-click charge', async () => {
  const database = stateDatabase(funnelState(['offered', 'offered']));
  const providerBodies: Array<Record<string, unknown>> = [];
  let paymentMethodQueries = 0;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/payment-methods')) {
      paymentMethodQueries += 1;
      return Response.json({ items: [] });
    }
    providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ session_id: 'session_upsell', payment_id: 'payment_upsell' });
  };

  const response = await decideUpsell({
    request: decisionRequest('funnel-blueprints', 'accept'),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(payload.state, 'processing');
  assert.equal(paymentMethodQueries, 0);
  assert.equal(providerBodies[0]?.payment_method_id, 'method_from_payment');
  assert.equal(providerBodies[0]?.confirm, true);
  assert.equal(
    (providerBodies[0]?.metadata as Record<string, string>).admx_visitor_id,
    'admx_visitor_123'
  );
});

test('upsell retains secure checkout fallback when no reusable method exists', async () => {
  const state = funnelState(['offered', 'offered']);
  state.run.dodo_payment_method_id = null;
  const database = stateDatabase(state);
  const providerBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/payments/pay_base')) {
      return Response.json({
        payment_id: 'pay_base',
        status: 'succeeded',
        customer: { customer_id: 'customer_1' },
        payment_method_id: null,
      });
    }
    if (path.endsWith('/payment-methods')) {
      return Response.json({ items: [] });
    }
    providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      checkout_url: 'https://checkout.dodopayments.com/session/upsell',
      session_id: 'session_upsell',
    });
  };

  const response = await decideUpsell({
    request: decisionRequest('funnel-blueprints', 'accept'),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(payload.state, 'redirect');
  assert.equal(providerBodies[0]?.payment_method_id, undefined);
  assert.equal(providerBodies[0]?.confirm, undefined);
});

test('funnel routing advances only after completed decisions', () => {
  assert.equal(
    nextFunnelPath(funnelState(['offered', 'offered'])),
    '/checkout/upsell/funnel-blueprints/'
  );
  assert.equal(
    nextFunnelPath(funnelState(['declined', 'offered'])),
    '/checkout/upsell/agency-toolkit/'
  );
  assert.equal(nextFunnelPath(funnelState(['accepted', 'declined'])), '/checkout/complete/');
  const pending = funnelState(['offered', 'offered']);
  pending.run.base_status = 'pending';
  assert.equal(nextFunnelPath(pending), null);
});

test('status returns the purchased base, bump, upsells, and completion copy', async () => {
  const state = funnelState(['accepted', 'declined']);
  const response = await getFunnelStatus({
    request: new Request(`https://funnels.example/api/funnel/status?flow=${'a'.repeat(43)}`),
    env: {
      LEADS: stateDatabase(state),
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.deepEqual(payload.baseProduct, {
    key: 'owned-funnel-builder',
    name: 'Owned Funnel Builder',
  });
  assert.deepEqual(payload.bump, {
    key: 'owned-funnel-conversion-copy-swipe-file',
    name: 'Conversion Copy Swipe File',
    accepted: true,
  });
  assert.equal(payload.nextPath, '/checkout/complete/');
  assert.equal(
    (payload.completion as Record<string, string>).backLabel,
    'Back to Owned Funnel Builder'
  );
});

class FulfillmentDatabase extends FakeDatabase {
  fulfillment:
    | {
        id: string;
        status: string;
        updated_at: string;
        attempt_count: number;
        error_message?: string;
      }
    | undefined;

  constructor() {
    super((query, values, method) => {
      if (query.includes('SELECT email FROM checkout_leads')) return { email: 'buyer@example.com' };
      if (query.includes('INSERT OR IGNORE INTO fulfillments')) {
        this.fulfillment ??= {
          id: String(values[0]),
          status: 'pending',
          updated_at: String(values[5]),
          attempt_count: 0,
        };
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('SELECT id, status, updated_at FROM fulfillments')) {
        return this.fulfillment ?? null;
      }
      if (query.includes("SET status = 'sending'")) {
        if (!this.fulfillment || this.fulfillment.status === 'sent') {
          return { success: true, meta: { changes: 0 } };
        }
        this.fulfillment.status = 'sending';
        this.fulfillment.attempt_count += 1;
        this.fulfillment.updated_at = String(values[0]);
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes("SET status = 'sent'")) {
        if (this.fulfillment) this.fulfillment.status = 'sent';
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes("SET status = 'failed'")) {
        if (this.fulfillment) {
          this.fulfillment.status = 'failed';
          this.fulfillment.error_message = String(values[0]);
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (method === 'run') return { success: true, meta: { changes: 1 } };
      if (method === 'all') return { results: [] };
      return null;
    });
  }
}

const emailEnvironment: Environment = {
  RESEND_API_KEY: 'resend_test',
  RESEND_FROM_EMAIL: 'Offers <offers@example.com>',
};

test('fulfillment sends once for duplicate payment events', async () => {
  const database = new FulfillmentDatabase();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ id: 'email_1' });
  };
  const input = {
    paymentId: 'payment_1',
    productKey: 'owned-funnel-builder',
    leadId: 'lead_1',
  };
  await deliverPurchase(emailEnvironment, database, input);
  await deliverPurchase(emailEnvironment, database, input);
  assert.equal(fetchCalls, 1);
  assert.equal(database.fulfillment?.status, 'sent');
  assert.equal(database.fulfillment?.attempt_count, 1);
});

test('Dodo-native delivery completes without a separate Resend credential', async () => {
  const database = new FulfillmentDatabase();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Resend should not be called.');
  };
  await deliverPurchase({}, database, {
    paymentId: 'payment_dodo_native',
    productKey: 'owned-funnel-builder',
    leadId: 'lead_1',
  });
  assert.equal(fetchCalls, 0);
  assert.equal(database.fulfillment?.status, 'sent');
  assert.equal(database.fulfillment?.attempt_count, 1);
});

test('failed email delivery can retry without creating a second payment', async () => {
  const database = new FulfillmentDatabase();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return fetchCalls === 1
      ? Response.json({ message: 'Temporary failure' }, { status: 500 })
      : Response.json({ id: 'email_2' });
  };
  const input = {
    paymentId: 'payment_retry',
    productKey: 'owned-funnel-builder',
    leadId: 'lead_1',
  };
  await assert.rejects(deliverPurchase(emailEnvironment, database, input), /Temporary failure/);
  assert.equal(database.fulfillment?.status, 'failed');
  await deliverPurchase(emailEnvironment, database, input);
  assert.equal(database.fulfillment?.status, 'sent');
  assert.equal(database.fulfillment?.attempt_count, 2);
  assert.equal(fetchCalls, 2);
});

test('webhook rejects missing and invalid signatures before changing payment state', async () => {
  const database = new FakeDatabase((_query, _values, method) =>
    method === 'run' ? { success: true, meta: { changes: 1 } } : null
  );
  const missing = await receiveWebhook({
    request: new Request('https://funnels.example/api/webhooks/dodo', {
      method: 'POST',
      body: '{}',
    }),
    env: { LEADS: database },
  });
  assert.equal(missing.status, 400);

  const invalid = await receiveWebhook({
    request: new Request('https://funnels.example/api/webhooks/dodo', {
      method: 'POST',
      headers: {
        'webhook-id': 'event_1',
        'webhook-signature': 'invalid',
        'webhook-timestamp': String(Date.now()),
      },
      body: '{}',
    }),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_WEBHOOK_KEY: 'test_webhook_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  assert.equal(invalid.status, 401);
});
