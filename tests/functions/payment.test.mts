import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';

import { minorUnitsToMajor, recordAdmaxxerPayment } from '../../functions/_lib/admaxxer.ts';
import { deliverPurchase } from '../../functions/_lib/fulfillment.ts';
import { nextFunnelPath, refreshFunnel, type FunnelState } from '../../functions/_lib/funnel.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1RunResult,
  Environment,
} from '../../functions/_lib/runtime.ts';
import { onRequestPost as createCheckout } from '../../functions/api/checkout.ts';
import { onRequestPost as decideUpsell } from '../../functions/api/funnel/decision.ts';
import { onRequestGet as getFunnelStatus } from '../../functions/api/funnel/status.ts';
import {
  onRequestPost as receiveWebhook,
  processDodoWebhookPayload,
} from '../../functions/api/webhooks/dodo.ts';
import { onRequestPost as receiveStripeWebhook } from '../../functions/api/webhooks/stripe.ts';
import { verifyStripeSignature } from '../../functions/_lib/stripe.ts';
import {
  collectStripePages,
  requireExistingWebhookSecret,
  stripeMinorAmount,
  stripeWebhookBody,
  validateStripeAccessUrl,
  validateStripeSetupCredentials,
} from '../../scripts/lib/stripe-setup.mjs';

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

  private assertBindings(): void {
    assert.equal(
      this.query.match(/\?/g)?.length ?? 0,
      this.values.length,
      `SQL placeholder count does not match bound values: ${this.query}`
    );
  }

  async run(): Promise<D1RunResult> {
    this.assertBindings();
    return (await this.handler(this.query, this.values, 'run')) as D1RunResult;
  }

  async first<T>(): Promise<T | null> {
    this.assertBindings();
    return (await this.handler(this.query, this.values, 'first')) as T | null;
  }

  async all<T>(): Promise<{ results?: T[] }> {
    this.assertBindings();
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

test('Admaxxer payment attribution normalizes Dodo minor units and preserves identity', async () => {
  let requestUrl = '';
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ received: true });
  };

  const sent = await recordAdmaxxerPayment(
    { ADMAXXER_API_KEY: 'workspace_test_key' },
    {
      paymentId: 'pay_immutable_123',
      totalAmount: 2999,
      currency: 'usd',
      visitorId: 'admx_visitor_123',
      email: 'OWNER@example.com',
    }
  );

  assert.equal(sent, true);
  assert.equal(requestUrl, 'https://admaxxer.com/api/v1/payments');
  assert.equal(requestHeaders?.get('authorization'), 'Bearer workspace_test_key');
  assert.deepEqual(requestBody, {
    amount: 29.99,
    currency: 'USD',
    transaction_id: 'pay_immutable_123',
    admaxxer_visitor_id: 'admx_visitor_123',
    email: 'owner@example.com',
  });
});

test('Admaxxer payment attribution supports zero- and three-decimal currencies', () => {
  assert.equal(minorUnitsToMajor(3000, 'JPY'), 3000);
  assert.equal(minorUnitsToMajor(1234, 'KWD'), 1.234);
});

test('Admaxxer payment attribution is optional but retries provider failures', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ error: 'temporary' }, { status: 503 });
  };

  assert.equal(
    await recordAdmaxxerPayment({}, { paymentId: '', totalAmount: null, currency: '' }),
    false
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    recordAdmaxxerPayment(
      { ADMAXXER_API_KEY: 'workspace_test_key' },
      { paymentId: 'pay_retry', totalAmount: 1900, currency: 'USD' }
    ),
    /status 503/
  );
  assert.equal(fetchCalls, 1);
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
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/customers') {
      return Response.json({
        items: [{ customer_id: 'customer_owner', email: 'owner@example.com' }],
      });
    }
    assert.equal(url.pathname, '/checkouts');
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
  assert.deepEqual(providerBody?.customer, { customer_id: 'customer_owner' });
  assert.equal(providerBody?.show_saved_payment_methods, true);
  assert.equal(
    (providerBody?.feature_flags as Record<string, unknown>).always_create_new_customer,
    false
  );
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

test('checkout creates and attaches a Dodo customer before the first payment', async () => {
  const database = checkoutDatabase({ 'owned-funnel-builder': 'prod_main' });
  const providerCalls: Array<{ method: string; path: string }> = [];
  let checkoutBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    providerCalls.push({ method, path: url.pathname });
    if (url.pathname === '/customers' && method === 'GET') {
      return Response.json({ items: [] });
    }
    if (url.pathname === '/customers' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.email, 'new-buyer@example.com');
      return Response.json({
        customer_id: 'customer_new',
        email: 'new-buyer@example.com',
      });
    }
    assert.equal(url.pathname, '/checkouts');
    checkoutBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      checkout_url: 'https://checkout.dodopayments.com/session/test',
      session_id: 'session_123',
    });
  };

  const response = await createCheckout({
    request: checkoutRequest({
      email: 'new-buyer@example.com',
      offerSlug: 'owned-funnel-builder',
      consentVersion: 'v1',
    }),
    env: {
      LEADS: database,
      DODO_PAYMENTS_API_KEY: 'test_key',
      DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(providerCalls, [
    { method: 'GET', path: '/customers' },
    { method: 'POST', path: '/customers' },
    { method: 'POST', path: '/checkouts' },
  ]);
  assert.deepEqual(checkoutBody?.customer, { customer_id: 'customer_new' });
  assert.equal(
    database.calls.some(
      (call) =>
        call.query.includes('UPDATE funnel_runs SET dodo_customer_id') &&
        call.values.includes('customer_new')
    ),
    true
  );
});

test('checkout ignores an invalid Admaxxer visitor id instead of forwarding it', async () => {
  const database = checkoutDatabase({ 'owned-funnel-builder': 'prod_main' });
  let providerBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/customers') {
      return Response.json({
        items: [{ customer_id: 'customer_owner', email: 'owner@example.com' }],
      });
    }
    assert.equal(url.pathname, '/checkouts');
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

function stripeCheckoutDatabase(
  products: Record<string, { priceId: string | null; amount: number; currency: string }>
): FakeDatabase {
  return new FakeDatabase((query, values, method) => {
    if (query.includes('SELECT stripe_price_id, price_amount, currency')) {
      const product = products[String(values[0])];
      return product
        ? {
            stripe_price_id: product.priceId,
            price_amount: product.amount,
            currency: product.currency,
          }
        : null;
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    if (method === 'all') return { results: [] };
    return null;
  });
}

const stripeEnvironment = {
  PAYMENTS_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_template_key',
  STRIPE_PAYMENTS_ENVIRONMENT: 'test_mode',
  RESEND_API_KEY: 'resend_test',
  RESEND_FROM_EMAIL: 'Offers <offers@example.com>',
} as const;

test('Stripe checkout creates the base and bump cart and saves a card for off-session upsells', async () => {
  const database = stripeCheckoutDatabase({
    'owned-funnel-builder': { priceId: 'price_main', amount: 4900, currency: 'USD' },
    'owned-funnel-conversion-copy-swipe-file': {
      priceId: 'price_bump',
      amount: 1900,
      currency: 'USD',
    },
  });
  let checkoutBody: URLSearchParams | undefined;
  let idempotencyKey = '';
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/v1/checkout/sessions');
    checkoutBody = new URLSearchParams(String(init?.body));
    idempotencyKey = new Headers(init?.headers).get('idempotency-key') ?? '';
    return Response.json({
      id: 'cs_test_main',
      url: 'https://checkout.stripe.com/c/pay/cs_test_main',
    });
  };

  const response = await createCheckout({
    request: checkoutRequest({
      email: 'OWNER@example.com',
      offerSlug: 'owned-funnel-builder',
      placement: 'hero',
      consentVersion: 'v1',
      bumpAccepted: true,
      admaxxerVisitorId: 'admx_visitor_123',
    }),
    env: { LEADS: database, ...stripeEnvironment },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).provider, 'stripe');
  assert.match(idempotencyKey, /^checkout:[0-9a-f-]{36}$/);
  assert.equal(checkoutBody?.get('mode'), 'payment');
  assert.equal(checkoutBody?.get('line_items[0][price]'), 'price_main');
  assert.equal(checkoutBody?.get('line_items[1][price]'), 'price_bump');
  assert.equal(checkoutBody?.get('customer_email'), 'owner@example.com');
  assert.equal(checkoutBody?.get('customer_creation'), 'always');
  assert.equal(checkoutBody?.get('payment_method_types[0]'), 'card');
  assert.equal(checkoutBody?.get('payment_intent_data[setup_future_usage]'), 'off_session');
  assert.equal(checkoutBody?.get('metadata[admx_visitor_id]'), 'admx_visitor_123');
  assert.equal(
    checkoutBody?.get('payment_intent_data[metadata][admx_visitor_id]'),
    'admx_visitor_123'
  );
  assert.equal(
    database.calls.some(
      (call) => call.query.includes('INSERT INTO checkout_leads') && call.values.includes('stripe')
    ),
    true
  );
  assert.equal(
    database.calls.some(
      (call) =>
        call.query.includes("SET status = 'session_created', stripe_session_id") &&
        call.values.includes('cs_test_main')
    ),
    true
  );
});

test('Stripe checkout fails closed for a missing price mapping or access-email connection', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };

  const missingPrice = await createCheckout({
    request: checkoutRequest({
      email: 'owner@example.com',
      offerSlug: 'owned-funnel-builder',
      consentVersion: 'v1',
    }),
    env: {
      LEADS: stripeCheckoutDatabase({}),
      ...stripeEnvironment,
    },
  });
  assert.equal(missingPrice.status, 503);
  assert.equal((await missingPrice.json()).code, 'configuration_product');

  const missingResend = await createCheckout({
    request: checkoutRequest({
      email: 'owner@example.com',
      offerSlug: 'owned-funnel-builder',
      consentVersion: 'v1',
    }),
    env: {
      LEADS: stripeCheckoutDatabase({
        'owned-funnel-builder': { priceId: 'price_main', amount: 4900, currency: 'USD' },
      }),
      PAYMENTS_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_template_key',
      STRIPE_PAYMENTS_ENVIRONMENT: 'test_mode',
    },
  });
  assert.equal(missingResend.status, 503);
  assert.equal((await missingResend.json()).code, 'configuration_fulfillment');
  assert.equal(fetchCalls, 0);
});

test('Stripe setup validates mode, delivery URLs, webhook recovery, and pagination', async () => {
  assert.doesNotThrow(() => validateStripeSetupCredentials('sk_test_template_key', 'test_mode'));
  assert.throws(
    () => validateStripeSetupCredentials('sk_live_template_key', 'test_mode'),
    /does not match/
  );
  assert.doesNotThrow(() =>
    validateStripeAccessUrl({
      name: 'Template',
      accessUrl: 'https://members.example.com/download/template',
    })
  );
  assert.throws(
    () =>
      validateStripeAccessUrl({
        name: 'Template',
        accessUrl: 'https://customer.dodopayments.com',
      }),
    /still points to Dodo/
  );
  assert.throws(
    () =>
      validateStripeAccessUrl({
        name: 'Template',
        accessUrl: 'https://buyer:password@members.example.com/download/template',
      }),
    /valid HTTPS/
  );
  assert.equal(stripeMinorAmount(29.99, 'USD'), 2999);
  assert.equal(stripeMinorAmount(2900, 'JPY'), 2900);
  assert.equal(stripeMinorAmount(29.999, 'KWD'), 29999);
  assert.throws(() => stripeMinorAmount(29.5, 'JPY'), /too many decimal places/);
  assert.throws(
    () => requireExistingWebhookSecret({ id: 'we_existing' }, ''),
    /signing secret is not saved/
  );
  assert.throws(
    () => requireExistingWebhookSecret({ id: 'we_existing' }, 'not-a-webhook-secret'),
    /signing secret is invalid/
  );

  const webhookBody = stripeWebhookBody('https://funnels.example/api/webhooks/stripe');
  assert.deepEqual(webhookBody.getAll('enabled_events[0]'), ['checkout.session.completed']);
  assert.equal(webhookBody.get('enabled_events[3]'), 'payment_intent.payment_failed');

  const pageRequests: string[] = [];
  const items = await collectStripePages(async (requestPath: string) => {
    pageRequests.push(requestPath);
    return pageRequests.length === 1
      ? { data: [{ id: 'prod_first' }], has_more: true }
      : { data: [{ id: 'prod_second' }], has_more: false };
  }, '/products');
  assert.deepEqual(
    items.map((item: { id: string }) => item.id),
    ['prod_first', 'prod_second']
  );
  assert.equal(
    new URL(pageRequests[1], 'https://api.stripe.com').searchParams.get('starting_after'),
    'prod_first'
  );
});

function funnelState(stepStatuses: Array<FunnelState['steps'][number]['status']>): FunnelState {
  return {
    run: {
      id: 'funnel_1',
      lead_id: 'lead_1',
      email: 'buyer@example.com',
      offer_slug: 'owned-funnel-builder',
      token_hash: 'hash',
      payment_provider: 'dodo',
      base_status: 'succeeded',
      base_payment_id: 'pay_base',
      dodo_customer_id: 'customer_1',
      dodo_payment_method_id: 'method_from_payment',
      dodo_session_id: 'session_base',
      stripe_customer_id: null,
      stripe_payment_method_id: null,
      stripe_session_id: null,
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
      stripe_session_id: null,
      stripe_payment_intent_id: null,
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
    if (query.includes('SELECT stripe_price_id, price_amount, currency')) {
      return {
        stripe_price_id: 'price_upselltest',
        price_amount: 3900,
        currency: 'USD',
      };
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    if (method === 'all') return { results: [] };
    return null;
  });
}

function stripeFunnelState(
  stepStatuses: Array<FunnelState['steps'][number]['status']>
): FunnelState {
  const state = funnelState(stepStatuses);
  state.run.payment_provider = 'stripe';
  state.run.dodo_customer_id = null;
  state.run.dodo_payment_method_id = null;
  state.run.dodo_session_id = null;
  state.run.stripe_customer_id = 'cus_saved';
  state.run.stripe_payment_method_id = 'pm_saved';
  state.run.stripe_session_id = 'cs_test_base';
  return state;
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

test('upsell validates the payment method against the customer list for one-click charge', async () => {
  const database = stateDatabase(funnelState(['offered', 'offered']));
  const providerBodies: Array<Record<string, unknown>> = [];
  let paymentMethodQueries = 0;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/payment-methods')) {
      paymentMethodQueries += 1;
      return Response.json({
        items: [{ payment_method_id: 'saved_customer_method', recurring_enabled: false }],
      });
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
  assert.equal(paymentMethodQueries, 1);
  assert.equal(providerBodies[0]?.payment_method_id, 'saved_customer_method');
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

test('Stripe upsell confirms the saved card off-session with a stable idempotency key', async () => {
  const database = stateDatabase(stripeFunnelState(['offered', 'offered']));
  let paymentBody: URLSearchParams | undefined;
  let idempotencyKey = '';
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/v1/payment_intents');
    paymentBody = new URLSearchParams(String(init?.body));
    idempotencyKey = new Headers(init?.headers).get('idempotency-key') ?? '';
    return Response.json({ id: 'pi_upsell', status: 'succeeded' });
  };

  const response = await decideUpsell({
    request: decisionRequest('funnel-blueprints', 'accept'),
    env: { LEADS: database, ...stripeEnvironment },
  });
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.state, 'processing');
  assert.equal(idempotencyKey, 'upsell:funnel_1:funnel-blueprints');
  assert.equal(paymentBody?.get('amount'), '3900');
  assert.equal(paymentBody?.get('currency'), 'usd');
  assert.equal(paymentBody?.get('customer'), 'cus_saved');
  assert.equal(paymentBody?.get('payment_method'), 'pm_saved');
  assert.equal(paymentBody?.get('confirm'), 'true');
  assert.equal(paymentBody?.get('off_session'), 'true');
  assert.equal(paymentBody?.get('error_on_requires_action'), 'true');
  assert.equal(paymentBody?.get('metadata[admx_visitor_id]'), 'admx_visitor_123');
  assert.equal(
    database.calls.some(
      (call) =>
        call.query.includes('SET status = ?, stripe_payment_intent_id') &&
        call.values[0] === 'accepted' &&
        call.values[1] === 'pi_upsell'
    ),
    true
  );
});

for (const fallback of ['authentication_required', 'card_declined', 'missing_method'] as const) {
  test(`Stripe upsell uses hosted Checkout after ${fallback}`, async () => {
    const state = stripeFunnelState(['offered', 'offered']);
    if (fallback === 'missing_method') state.run.stripe_payment_method_id = null;
    const database = stateDatabase(state);
    const requests: Array<{ path: string; body: URLSearchParams; idempotencyKey: string }> = [];
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = new URLSearchParams(String(init?.body));
      requests.push({
        path,
        body,
        idempotencyKey: new Headers(init?.headers).get('idempotency-key') ?? '',
      });
      if (path === '/v1/checkout/sessions/cs_test_base') {
        return Response.json({
          id: 'cs_test_base',
          status: 'complete',
          payment_status: 'paid',
          customer: 'cus_saved',
          payment_intent: { id: 'pi_base', status: 'succeeded', customer: 'cus_saved' },
        });
      }
      if (path === '/v1/payment_intents') {
        return Response.json(
          {
            error: {
              code: fallback,
              payment_intent: {
                id: 'pi_failed',
                status:
                  fallback === 'authentication_required'
                    ? 'requires_action'
                    : 'requires_payment_method',
              },
            },
          },
          { status: 402 }
        );
      }
      assert.equal(path, '/v1/checkout/sessions');
      return Response.json({
        id: 'cs_test_fallback',
        url: 'https://checkout.stripe.com/c/pay/cs_test_fallback',
      });
    };

    const response = await decideUpsell({
      request: decisionRequest('funnel-blueprints', 'accept'),
      env: { LEADS: database, ...stripeEnvironment },
    });
    const payload = (await response.json()) as Record<string, unknown>;
    const checkoutRequest = requests.at(-1);

    assert.equal(response.status, 200);
    assert.equal(payload.state, 'redirect');
    assert.equal(payload.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_fallback');
    assert.equal(checkoutRequest?.path, '/v1/checkout/sessions');
    assert.equal(
      checkoutRequest?.idempotencyKey,
      'upsell-fallback:funnel_1:funnel-blueprints:initial'
    );
    assert.equal(checkoutRequest?.body.get('customer'), 'cus_saved');
    assert.equal(checkoutRequest?.body.get('line_items[0][price]'), 'price_upselltest');
    assert.equal(
      checkoutRequest?.body.get('payment_intent_data[setup_future_usage]'),
      'off_session'
    );
    assert.equal(checkoutRequest?.body.get('metadata[admx_visitor_id]'), 'admx_visitor_123');
    assert.equal(
      requests.filter((providerRequest) => providerRequest.path === '/v1/payment_intents').length,
      fallback === 'missing_method' ? 0 : 1
    );
    assert.equal(
      database.calls.some(
        (call) =>
          call.query.includes("SET status = 'charging', stripe_session_id") &&
          call.values.includes('cs_test_fallback')
      ),
      true
    );
  });
}

for (const previousAttempt of ['payment_intent', 'checkout_session'] as const) {
  test(`Stripe upsell does not repeat a failed ${previousAttempt} attempt`, async () => {
    const state = stripeFunnelState(['failed', 'offered']);
    if (previousAttempt === 'payment_intent') {
      state.steps[0].stripe_payment_intent_id = 'pi_failed_async';
    } else {
      state.steps[0].stripe_session_id = 'cs_expired';
      state.steps[0].checkout_url = 'https://checkout.stripe.com/c/pay/cs_expired';
    }
    const database = stateDatabase(state);
    const requests: Array<{ path: string; idempotencyKey: string }> = [];
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({
        path,
        idempotencyKey: new Headers(init?.headers).get('idempotency-key') ?? '',
      });
      assert.equal(path, '/v1/checkout/sessions');
      return Response.json({
        id: 'cs_test_retry',
        url: 'https://checkout.stripe.com/c/pay/cs_test_retry',
      });
    };

    const response = await decideUpsell({
      request: decisionRequest('funnel-blueprints', 'accept'),
      env: { LEADS: database, ...stripeEnvironment },
    });
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.idempotencyKey,
      `upsell-fallback:funnel_1:funnel-blueprints:${
        previousAttempt === 'checkout_session' ? 'cs_expired' : 'initial'
      }`
    );
  });
}

test('duplicate Stripe upsell accepts return the existing secure checkout without another charge', async () => {
  const state = stripeFunnelState(['charging', 'offered']);
  state.steps[0].checkout_url = 'https://checkout.stripe.com/c/pay/cs_existing';
  const database = stateDatabase(state);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };

  const response = await decideUpsell({
    request: decisionRequest('funnel-blueprints', 'accept'),
    env: { LEADS: database, ...stripeEnvironment },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: 'redirect',
    checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_existing',
  });
  assert.equal(fetchCalls, 0);
  assert.equal(
    database.calls.some((call) => call.query.includes("SET status = 'charging'")),
    false
  );
});

class MutableFunnelDatabase extends FakeDatabase {
  constructor(readonly state: FunnelState) {
    super((query, values, method) => {
      if (query.includes('SELECT f.*, l.dodo_session_id')) return { ...this.state.run };
      if (query.includes('SELECT * FROM funnel_step_runs')) {
        return { results: this.state.steps.map((step) => ({ ...step })) };
      }
      if (query.includes("SET base_status = 'succeeded'")) {
        this.state.run.base_status = 'succeeded';
        this.state.run.base_payment_id = String(values[0]);
        this.state.run.stripe_customer_id = String(values[1]);
        this.state.run.stripe_payment_method_id = String(values[2]);
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes("SET status = 'accepted', stripe_payment_intent_id")) {
        const step = this.state.steps.find((item) => item.id === values[2]);
        if (step) {
          step.status = 'accepted';
          step.stripe_payment_intent_id = String(values[0]);
        }
        return { success: true, meta: { changes: step ? 1 : 0 } };
      }
      if (query.includes('SET stripe_customer_id = ?, stripe_payment_method_id = ?')) {
        this.state.run.stripe_customer_id = String(values[0]);
        this.state.run.stripe_payment_method_id = String(values[1]);
        return { success: true, meta: { changes: 1 } };
      }
      if (method === 'run') return { success: true, meta: { changes: 1 } };
      if (method === 'all') return { results: [] };
      return null;
    });
  }
}

test('Stripe funnel refresh verifies the base Checkout Session and an upsell PaymentIntent', async () => {
  const state = stripeFunnelState(['charging', 'offered']);
  state.run.base_status = 'pending';
  state.run.base_payment_id = null;
  state.run.stripe_customer_id = null;
  state.run.stripe_payment_method_id = null;
  state.steps[0].stripe_payment_intent_id = 'pi_upsell_refresh';
  const database = new MutableFunnelDatabase(state);
  const providerPaths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    providerPaths.push(path);
    if (path === '/v1/checkout/sessions/cs_test_base') {
      return Response.json({
        id: 'cs_test_base',
        status: 'complete',
        payment_status: 'paid',
        customer: 'cus_refreshed',
        payment_intent: {
          id: 'pi_base_refresh',
          status: 'succeeded',
          customer: 'cus_refreshed',
          payment_method: 'pm_refreshed',
        },
      });
    }
    assert.equal(path, '/v1/payment_intents/pi_upsell_refresh');
    return Response.json({
      id: 'pi_upsell_refresh',
      status: 'succeeded',
      customer: 'cus_refreshed',
      payment_method: 'pm_replacement',
    });
  };

  const refreshed = await refreshFunnel({ ...stripeEnvironment }, database, 'a'.repeat(43));

  assert.equal(refreshed.run.base_status, 'succeeded');
  assert.equal(refreshed.run.base_payment_id, 'pi_base_refresh');
  assert.equal(refreshed.run.stripe_customer_id, 'cus_refreshed');
  assert.equal(refreshed.run.stripe_payment_method_id, 'pm_replacement');
  assert.equal(refreshed.steps[0].status, 'accepted');
  assert.deepEqual(providerPaths, [
    '/v1/checkout/sessions/cs_test_base',
    '/v1/payment_intents/pi_upsell_refresh',
  ]);
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
    provider: 'dodo' as const,
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
    provider: 'dodo',
  });
  assert.equal(fetchCalls, 0);
  assert.equal(database.fulfillment?.status, 'sent');
  assert.equal(database.fulfillment?.attempt_count, 1);
});

test('Stripe delivery fails closed without Resend and remains retryable', async () => {
  const database = new FulfillmentDatabase();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };

  await assert.rejects(
    deliverPurchase({}, database, {
      paymentId: 'payment_stripe_missing_resend',
      productKey: 'owned-funnel-builder',
      leadId: 'lead_1',
      provider: 'stripe',
    }),
    /Stripe delivery requires/
  );
  assert.equal(fetchCalls, 0);
  assert.equal(database.fulfillment?.status, 'failed');
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
    provider: 'dodo' as const,
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

test('diagnostic Dodo payments are acknowledged without funnel processing', async () => {
  const database = new FakeDatabase((query, values, method) => {
    if (query.includes('INSERT OR IGNORE INTO webhook_events')) {
      return { success: true, meta: { changes: 1 } };
    }
    if (query.includes('SELECT status FROM webhook_events')) return null;
    if (query.includes("SET status = 'processed'")) {
      assert.equal(values[1], 'event_diagnostic_1');
      return { success: true, meta: { changes: 1 } };
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    return null;
  });

  const result = await processDodoWebhookPayload({}, database, 'event_diagnostic_1', {
    type: 'payment.succeeded',
    data: {
      payment_id: 'pay_diagnostic_1',
      metadata: { source: 'owned-funnel-diagnostic' },
    },
  });

  assert.equal(result, 'processed');
  assert.equal(
    database.calls.some(({ query }) => query.includes('UPDATE funnel_runs')),
    false
  );
});

test('active duplicate Dodo webhooks remain retryable instead of being acknowledged', async () => {
  const database = new FakeDatabase((query, _values, method) => {
    if (query.includes('INSERT OR IGNORE INTO webhook_events')) {
      return { success: true, meta: { changes: 0 } };
    }
    if (query.includes('SELECT status, attempt_started_at')) {
      return { status: 'received', attempt_started_at: new Date().toISOString() };
    }
    if (query.includes("SET status = 'received'")) {
      return { success: true, meta: { changes: 0 } };
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    return null;
  });

  const result = await processDodoWebhookPayload({}, database, 'event_active_duplicate', {
    type: 'payment.succeeded',
    data: { metadata: { source: 'owned-funnel-diagnostic' } },
  });

  assert.equal(result, 'busy');
});

test('failed Dodo webhook claims are reclaimed and processed again', async () => {
  const database = new FakeDatabase((query, values, method) => {
    if (query.includes('INSERT OR IGNORE INTO webhook_events')) {
      return { success: true, meta: { changes: 0 } };
    }
    if (query.includes('SELECT status, attempt_started_at')) return { status: 'failed' };
    if (query.includes("SET status = 'received'")) {
      assert.equal(values[1], 'event_failed_retry');
      return { success: true, meta: { changes: 1 } };
    }
    if (query.includes("SET status = 'processed'")) {
      assert.equal(values[1], 'event_failed_retry');
      return { success: true, meta: { changes: 1 } };
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    return null;
  });

  const result = await processDodoWebhookPayload({}, database, 'event_failed_retry', {
    type: 'payment.succeeded',
    data: { metadata: { source: 'owned-funnel-diagnostic' } },
  });

  assert.equal(result, 'processed');
});

test('owned Dodo refunds and disputes are recorded once by payment ID', async () => {
  const revocations: Array<Array<string | number | null>> = [];
  const database = new FakeDatabase((query, values, method) => {
    if (query.includes('INSERT OR IGNORE INTO webhook_events')) {
      return { success: true, meta: { changes: 1 } };
    }
    if (query.includes('INSERT OR IGNORE INTO payment_revocations')) {
      revocations.push(values);
      return { success: true, meta: { changes: 1 } };
    }
    if (query.includes("SET status = 'processed'")) {
      return { success: true, meta: { changes: 1 } };
    }
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    return null;
  });

  await processDodoWebhookPayload({}, database, 'event_refund_1', {
    type: 'refund.succeeded',
    data: {
      payment_id: 'pay_owned_1',
      metadata: { source: 'owned-funnel-builder' },
    },
  });

  assert.equal(revocations.length, 1);
  assert.deepEqual(revocations[0]?.slice(0, 3), [
    'pay_owned_1',
    'refund.succeeded',
    'event_refund_1',
  ]);
});

function stripeSignature(secret: string, rawBody: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('Stripe webhook signatures accept the raw payload and reject invalid or stale signatures', async () => {
  const secret = 'whsec_template_test';
  const rawBody = '{"id":"evt_signature"}';
  const now = 1_700_000_000;

  assert.equal(
    await verifyStripeSignature(rawBody, stripeSignature(secret, rawBody, now), secret, now),
    true
  );
  assert.equal(
    await verifyStripeSignature(rawBody, `t=${now},v1=${'0'.repeat(64)}`, secret, now),
    false
  );
  assert.equal(
    await verifyStripeSignature(rawBody, stripeSignature(secret, rawBody, now - 301), secret, now),
    false
  );
});

class StripeWebhookDatabase extends FakeDatabase {
  readonly events = new Map<string, string>();
  fulfillment:
    | {
        id: string;
        status: string;
        updated_at: string;
        attempt_count: number;
      }
    | undefined;
  convertedPaymentId = '';
  acceptedStepKey = '';
  savedCustomerId = '';
  savedPaymentMethodId = '';

  constructor() {
    super((query, values, method) => {
      if (query.includes('INSERT OR IGNORE INTO webhook_events')) {
        if (!this.events.has(String(values[0]))) this.events.set(String(values[0]), 'received');
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('SELECT status FROM webhook_events')) {
        const status = this.events.get(String(values[0]));
        return status ? { status } : null;
      }
      if (query.includes("SET status = 'processed'")) {
        this.events.set(String(values[1]), 'processed');
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes("SET status = 'failed'") && query.includes('webhook_events')) {
        this.events.set(String(values[2]), 'failed');
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes("SET status = 'accepted'") && query.includes('funnel_step_runs')) {
        this.acceptedStepKey = String(values[3]);
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('UPDATE funnel_runs') && query.includes('stripe_customer_id')) {
        if (query.includes('SET stripe_customer_id = ?')) {
          this.savedCustomerId = String(values[0]);
          this.savedPaymentMethodId = String(values[1]);
        } else {
          this.convertedPaymentId = String(values[0]);
          this.savedCustomerId = String(values[1]);
          this.savedPaymentMethodId = String(values[2]);
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('SELECT email FROM checkout_leads')) {
        return { email: 'buyer@example.com' };
      }
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
        if (this.fulfillment) this.fulfillment.status = 'failed';
        return { success: true, meta: { changes: 1 } };
      }
      if (method === 'run') return { success: true, meta: { changes: 1 } };
      if (method === 'all') return { results: [] };
      return null;
    });
  }
}

test('Stripe webhook fulfills and attributes a successful purchase exactly once per event', async () => {
  const database = new StripeWebhookDatabase();
  const secret = 'whsec_template_test';
  const event = {
    id: 'evt_payment_succeeded',
    livemode: false,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_base_webhook',
        status: 'succeeded',
        amount: 4900,
        amount_received: 4900,
        currency: 'usd',
        customer: 'cus_webhook',
        payment_method: 'pm_webhook',
        receipt_email: 'buyer@example.com',
        metadata: {
          lead_id: 'lead_1',
          funnel_id: 'funnel_1',
          product_key: 'owned-funnel-builder',
          offer_slug: 'owned-funnel-builder',
          admx_visitor_id: 'admx_visitor_123',
        },
      },
    },
  };
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = stripeSignature(secret, rawBody, timestamp);
  let resendCalls = 0;
  let admaxxerCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      resendCalls += 1;
      return Response.json({ id: 'email_stripe_1' });
    }
    assert.equal(url, 'https://admaxxer.com/api/v1/payments');
    admaxxerCalls += 1;
    return Response.json({ received: true });
  };
  const env = {
    LEADS: database,
    STRIPE_SECRET_KEY: 'sk_test_template_key',
    STRIPE_PAYMENTS_ENVIRONMENT: 'test_mode',
    STRIPE_WEBHOOK_SECRET: secret,
    RESEND_API_KEY: 'resend_test',
    RESEND_FROM_EMAIL: 'Offers <offers@example.com>',
    ADMAXXER_API_KEY: 'workspace_test_key',
  };
  const makeRequest = () =>
    new Request('https://funnels.example/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: rawBody,
    });

  const first = await receiveStripeWebhook({ request: makeRequest(), env });
  const duplicate = await receiveStripeWebhook({ request: makeRequest(), env });

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(database.convertedPaymentId, 'pi_base_webhook');
  assert.equal(database.savedCustomerId, 'cus_webhook');
  assert.equal(database.savedPaymentMethodId, 'pm_webhook');
  assert.equal(database.fulfillment?.status, 'sent');
  assert.equal(database.events.get('stripe:evt_payment_succeeded'), 'processed');
  assert.equal(resendCalls, 1);
  assert.equal(admaxxerCalls, 1);
});

test('Stripe hosted upsell fallback saves the replacement card for the next upsell', async () => {
  const database = new StripeWebhookDatabase();
  const secret = 'whsec_template_test';
  const event = {
    id: 'evt_checkout_fallback_succeeded',
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_upsell_fallback',
        payment_status: 'paid',
        payment_intent: 'pi_upsell_fallback',
        metadata: {
          lead_id: 'lead_1',
          funnel_id: 'funnel_1',
          product_key: 'owned-funnel-ten-blueprints',
          offer_slug: 'owned-funnel-builder',
          step_key: 'funnel-blueprints',
        },
      },
    },
  };
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = stripeSignature(secret, rawBody, timestamp);
  let paymentIntentReads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://api.stripe.com/v1/payment_intents/pi_upsell_fallback') {
      paymentIntentReads += 1;
      return Response.json({
        id: 'pi_upsell_fallback',
        status: 'succeeded',
        amount: 4900,
        amount_received: 4900,
        currency: 'usd',
        customer: 'cus_webhook',
        payment_method: 'pm_replacement',
        receipt_email: 'buyer@example.com',
        metadata: event.data.object.metadata,
      });
    }
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email_stripe_2' });
    if (url === 'https://admaxxer.com/api/v1/payments') {
      return Response.json({ received: true });
    }
    throw new Error(`Unexpected request to ${url}`);
  };

  const response = await receiveStripeWebhook({
    request: new Request('https://funnels.example/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: rawBody,
    }),
    env: {
      LEADS: database,
      STRIPE_SECRET_KEY: 'sk_test_template_key',
      STRIPE_PAYMENTS_ENVIRONMENT: 'test_mode',
      STRIPE_WEBHOOK_SECRET: secret,
      RESEND_API_KEY: 'resend_test',
      RESEND_FROM_EMAIL: 'Offers <offers@example.com>',
      ADMAXXER_API_KEY: 'workspace_test_key',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(paymentIntentReads, 1);
  assert.equal(database.acceptedStepKey, 'funnel-blueprints');
  assert.equal(database.savedCustomerId, 'cus_webhook');
  assert.equal(database.savedPaymentMethodId, 'pm_replacement');
  assert.equal(database.fulfillment?.status, 'sent');
  assert.equal(database.events.get('stripe:evt_checkout_fallback_succeeded'), 'processed');
});
