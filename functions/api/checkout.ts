import { assertFunnelDefinition } from '../_lib/funnel';
import { getProductId, getStripePrice } from '../_lib/products';
import {
  cleanString,
  dodoRequest,
  getDodoConfig,
  getPaymentProvider,
  hashFlowToken,
  json,
  randomFlowToken,
  readEnvironmentValue,
  RequestError,
  type PagesContext,
} from '../_lib/runtime';
import {
  appendStripeLineItems,
  appendStripeMetadata,
  assertStripeFulfillmentConfig,
  getStripeConfig,
  stripeRequest,
  validateStripeCheckoutUrl,
} from '../_lib/stripe';
import { drainSourceEvent, sourceOutboxStatement, sourcePayloadHash } from '../_lib/source-outbox';
import { verifySignedCookie } from '../_lib/tracking-cookie';
import { MARKETING_CONSENT_COPY, MARKETING_CONSENT_VERSION } from '../../src/data/emailConsent';

interface CheckoutRequest {
  email?: unknown;
  offerSlug?: unknown;
  placement?: unknown;
  consentVersion?: unknown;
  marketingOptIn?: unknown;
  website?: unknown;
  attribution?: unknown;
  referrer?: unknown;
  bumpAccepted?: unknown;
  admaxxerVisitorId?: unknown;
}

interface DodoCheckoutResponse {
  checkout_url?: unknown;
  session_id?: unknown;
}

interface DodoCustomer {
  customer_id?: unknown;
  email?: unknown;
}

interface DodoCustomerListResponse {
  items?: DodoCustomer[];
}

interface StripeCheckoutResponse {
  id?: unknown;
  url?: unknown;
}

const MAX_BODY_BYTES = 16 * 1024;
const DODO_TIMEOUT_MS = 15_000;
const OFFER_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMAXXER_VISITOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,180}$/;
const ATTRIBUTION_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
  'ttclid',
  'msclkid',
]);
const MARKETING_PLACEMENTS = new Set([
  'header',
  'hero',
  'outcomes',
  'pricing',
  'final',
  'mobile-sticky',
]);

function sanitizeAttribution(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const attribution: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!ATTRIBUTION_KEYS.has(key)) continue;
    const cleanedValue = cleanString(rawValue, 256);
    if (cleanedValue) attribution[key] = cleanedValue;
  }
  return attribution;
}

function sanitizeAdmaxxerVisitorId(value: unknown): string {
  const visitorId = cleanString(value, 181);
  return ADMAXXER_VISITOR_ID_PATTERN.test(visitorId) ? visitorId : '';
}

function trackingCookie(request: Request, name: 'fbp' | 'fbc'): string {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === `_${name}`)?.[1];
  return value && /^[A-Za-z0-9._-]{1,256}$/.test(value) ? value : '';
}

function safeSourceUrl(value: string, expectedOrigin: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === expectedOrigin ? `${url.origin}${url.pathname}` : '';
  } catch {
    return '';
  }
}

async function verifiedBuyerIdentity(
  request: Request,
  env: PagesContext['env'],
  scope: { tenantId: string; siteId: string }
): Promise<Record<string, string>> {
  const keys = env.TRACKING_COOKIE_VERIFY_KEYS;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return {};
  const externalId = await verifySignedCookie(
    request.headers.get('cookie'),
    'ma_vid',
    keys as Record<string, CryptoKey>,
    {
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      environment: readEnvironmentValue(env, 'TRACKING_ENVIRONMENT') === 'preview' ? 'preview' : 'live',
    }
  );
  return externalId ? { signed_external_id: externalId } : {};
}

function sourceScope(env: PagesContext['env'], requestUrl: URL): { tenantId: string; siteId: string } {
  return {
    tenantId: cleanString(env.TRACKING_TENANT_ID, 128) || 'owned-funnel-builder',
    siteId: cleanString(env.TRACKING_SITE_ID, 128) || requestUrl.hostname,
  };
}

async function parseRequest(request: Request): Promise<CheckoutRequest> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    throw new RequestError('Checkout request is too large.', 413);
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    throw new RequestError('Checkout request is too large.', 413);
  }

  try {
    return JSON.parse(body) as CheckoutRequest;
  } catch {
    throw new RequestError('Checkout request is invalid.', 400);
  }
}

function validateCheckoutUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Dodo response did not contain a checkout URL.');

  const checkoutUrl = new URL(value);
  if (
    checkoutUrl.protocol !== 'https:' ||
    (checkoutUrl.hostname !== 'dodopayments.com' &&
      !checkoutUrl.hostname.endsWith('.dodopayments.com'))
  ) {
    throw new Error('Dodo returned an unexpected checkout URL.');
  }
  return checkoutUrl.toString();
}

async function getOrCreateDodoCustomer(env: PagesContext['env'], email: string): Promise<string> {
  const customers = await dodoRequest<DodoCustomerListResponse>(
    env,
    `/customers?email=${encodeURIComponent(email)}&page_size=100&page_number=0`
  );
  const existingCustomer = customers.items?.find(
    (customer) =>
      cleanString(customer.email, 254).toLowerCase() === email &&
      Boolean(cleanString(customer.customer_id, 160))
  );
  const existingCustomerId = cleanString(existingCustomer?.customer_id, 160);
  if (existingCustomerId) return existingCustomerId;

  const createdCustomer = await dodoRequest<DodoCustomer>(env, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      email,
      name: 'Customer',
      metadata: { source: 'owned-funnel-builder' },
    }),
  });
  const createdCustomerId = cleanString(createdCustomer.customer_id, 160);
  if (!createdCustomerId) throw new Error('Dodo did not return a customer ID.');
  return createdCustomerId;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');

  if (origin && origin !== requestUrl.origin) {
    return json({ error: 'Checkout request origin is not allowed.' }, 403);
  }

  let leadId = '';
  let offerSlug = '';
  let leadEvent: { event_id: string; event_name: 'Lead' } | null = null;

  try {
    const input = await parseRequest(request);
    const email = cleanString(input.email, 254).toLowerCase();
    offerSlug = cleanString(input.offerSlug, 80);
    const requestedPlacement = cleanString(input.placement, 80);
    const placement = MARKETING_PLACEMENTS.has(requestedPlacement) ? requestedPlacement : 'unknown';
    const requestedConsentVersion = cleanString(input.consentVersion, 80);
    const marketingOptIn = input.marketingOptIn === true;
    const consentVersion = marketingOptIn ? MARKETING_CONSENT_VERSION : '';
    const honeypot = cleanString(input.website, 200);
    const referrer = cleanString(input.referrer, 1024);
    const attribution = sanitizeAttribution(input.attribution);
    const requestedBump = input.bumpAccepted === true;
    const admaxxerVisitorId = sanitizeAdmaxxerVisitorId(input.admaxxerVisitorId);

    if (honeypot) return json({ error: 'Checkout request is invalid.' }, 400);
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new RequestError('Enter a valid email address.', 400);
    }
    if (!OFFER_SLUG_PATTERN.test(offerSlug) || offerSlug.length > 80) {
      throw new RequestError('Offer is invalid.', 400);
    }
    if (marketingOptIn && requestedConsentVersion !== MARKETING_CONSENT_VERSION) {
      throw new RequestError('Marketing consent version is invalid.', 400);
    }
    if (!env.LEADS) {
      throw new RequestError('Checkout is not configured yet.', 503, 'configuration_storage');
    }

    const definition = assertFunnelDefinition(offerSlug);
    const bumpAccepted = requestedBump && Boolean(definition.bump);
    const paymentProvider = getPaymentProvider(env);
    const dodoConfig = paymentProvider === 'dodo' ? getDodoConfig(env) : null;
    const checkoutMode =
      paymentProvider === 'dodo' ? dodoConfig?.checkoutMode : getStripeConfig(env).checkoutMode;
    if (paymentProvider === 'stripe') assertStripeFulfillmentConfig(env);

    const dodoProductIds: string[] = [];
    const stripePriceIds: string[] = [];
    if (paymentProvider === 'dodo') {
      dodoProductIds.push(await getProductId(env.LEADS, definition.base.productKey));
      if (bumpAccepted && definition.bump) {
        dodoProductIds.push(await getProductId(env.LEADS, definition.bump.productKey));
      }
    } else {
      stripePriceIds.push((await getStripePrice(env.LEADS, definition.base.productKey)).priceId);
      if (bumpAccepted && definition.bump) {
        stripePriceIds.push((await getStripePrice(env.LEADS, definition.bump.productKey)).priceId);
      }
    }

    leadId = crypto.randomUUID();
    const funnelId = crypto.randomUUID();
    const flowToken = randomFlowToken();
    const flowTokenHash = await hashFlowToken(flowToken);
    const now = new Date().toISOString();
    const country = cleanString(
      (request as Request & { cf?: { country?: unknown } }).cf?.country,
      2
    ).toUpperCase();
    const scope = sourceScope(env, requestUrl);
    const buyerContext = {
      ...(trackingCookie(request, 'fbp') ? { fbp: trackingCookie(request, 'fbp') } : {}),
      ...(trackingCookie(request, 'fbc') ? { fbc: trackingCookie(request, 'fbc') } : {}),
      ...(cleanString(request.headers.get('cf-connecting-ip'), 64)
        ? { client_ip_address: cleanString(request.headers.get('cf-connecting-ip'), 64) }
        : {}),
      ...(cleanString(request.headers.get('user-agent'), 512)
        ? { client_user_agent: cleanString(request.headers.get('user-agent'), 512) }
        : {}),
      ...(safeSourceUrl(request.headers.get('referer') ?? '', requestUrl.origin)
        ? { source_url: safeSourceUrl(request.headers.get('referer') ?? '', requestUrl.origin) }
        : {}),
      attribution,
      captured_at: now,
      meta_identity_version: '1',
      ...(await verifiedBuyerIdentity(request, env, scope)),
    };
    const leadSourceEventId = `lead:${leadId}`;
    const leadPayload = {
      schema_version: '1',
      event_id: leadSourceEventId,
      event_name: 'Lead',
      occurred_at: now,
      flow_token_hash: flowTokenHash,
      identity: { lead_id: leadId, funnel_id: funnelId },
      buyer_context: buyerContext,
    };
    leadEvent = { event_id: leadSourceEventId, event_name: 'Lead' };
    const leadStatement = env.LEADS.prepare(
      `INSERT INTO checkout_leads (
        id, email, offer_slug, placement, marketing_consent, consent_version,
        attribution_json, referrer, country, status, bump_selected, admaxxer_visitor_id,
        payment_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, ?)`
    )
      .bind(
        leadId,
        email,
        offerSlug,
        placement,
        marketingOptIn ? 1 : 0,
        consentVersion,
        JSON.stringify(attribution),
        referrer || null,
        country || null,
        bumpAccepted ? 1 : 0,
        admaxxerVisitorId || null,
        paymentProvider,
        now,
        now
      );

    const businessStatements = [leadStatement];

    if (marketingOptIn) {
      businessStatements.push(env.LEADS.prepare(
        `INSERT INTO email_subscribers (
          id, email, offer_slug, status, consent_version, consent_copy,
          source_placement, consented_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'subscribed', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email, offer_slug) DO UPDATE SET
          status = 'subscribed', consent_version = excluded.consent_version,
          consent_copy = excluded.consent_copy, source_placement = excluded.source_placement,
          consented_at = excluded.consented_at, updated_at = excluded.updated_at`
      )
        .bind(
          crypto.randomUUID(),
          email,
          offerSlug,
          consentVersion,
          MARKETING_CONSENT_COPY,
          placement,
          now,
          now,
          now
        ));
      businessStatements.push(env.LEADS.prepare(
        "DELETE FROM email_suppressions WHERE email = ? AND reason = 'unsubscribe'"
      )
        .bind(email));
    }

    businessStatements.push(env.LEADS.prepare(
      `INSERT INTO funnel_runs (
        id, lead_id, offer_slug, token_hash, payment_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(funnelId, leadId, offerSlug, flowTokenHash, paymentProvider, now, now));

    for (const step of definition.upsells) {
      businessStatements.push(env.LEADS.prepare(
        `INSERT INTO funnel_step_runs (
          id, funnel_id, step_key, ordinal, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), funnelId, step.key, step.ordinal, now, now));
    }
    businessStatements.push(
      sourceOutboxStatement(env.LEADS, {
        tenantId: scope.tenantId,
        siteId: scope.siteId,
        sourceEventId: leadSourceEventId,
        eventName: 'Lead',
        occurredAt: now,
        payload: leadPayload,
        payloadHash: await sourcePayloadHash(leadPayload),
      })
    );
    const businessResult = await env.LEADS.batch(businessStatements);
    if (businessResult.some((result) => !result.success)) throw new Error('Lead capture failed.');
    if (env.TRACKING_SOURCE_BRIDGE)
      await drainSourceEvent(env.LEADS, env, { ...scope, sourceEventId: leadSourceEventId });

    const configuredReturnUrl =
      paymentProvider === 'dodo' ? readEnvironmentValue(env, 'DODO_PAYMENTS_RETURN_URL') : '';
    const firstStep = definition.upsells[0];
    const returnUrl = new URL(
      firstStep
        ? `/checkout/upsell/${firstStep.key}/`
        : configuredReturnUrl || '/checkout/complete/',
      requestUrl.origin
    );
    returnUrl.searchParams.set('offer', offerSlug);
    returnUrl.searchParams.set('flow', flowToken);

    const metadata = {
      offer_slug: offerSlug,
      product_key: definition.base.productKey,
      lead_id: leadId,
      funnel_id: funnelId,
      placement,
      bump_selected: bumpAccepted ? 'true' : 'false',
      bump_product_key: bumpAccepted && definition.bump ? definition.bump.productKey : '',
      source: 'owned-funnel-builder',
      ...(admaxxerVisitorId ? { admx_visitor_id: admaxxerVisitorId } : {}),
    };

    if (paymentProvider === 'stripe') {
      const checkoutBody = new URLSearchParams({
        mode: 'payment',
        success_url: returnUrl.toString(),
        cancel_url: new URL(`/${offerSlug}/`, requestUrl.origin).toString(),
        customer_email: email,
        customer_creation: 'always',
        client_reference_id: leadId,
        'payment_method_types[0]': 'card',
        'payment_intent_data[setup_future_usage]': 'off_session',
        'payment_intent_data[receipt_email]': email,
      });
      appendStripeLineItems(checkoutBody, stripePriceIds);
      appendStripeMetadata(checkoutBody, metadata);
      appendStripeMetadata(checkoutBody, metadata, 'payment_intent_data[metadata]');

      const session = await stripeRequest<StripeCheckoutResponse>(env, '/checkout/sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': `checkout:${funnelId}` },
        body: checkoutBody,
      });
      const checkoutUrl = validateStripeCheckoutUrl(session.url);
      const sessionId = cleanString(session.id, 180);
      if (!sessionId) throw new Error('Stripe did not return a checkout session ID.');

      const initiateEventId = `initiate_checkout:${sessionId}`;
      const initiatePayload = {
        schema_version: '1', event_id: initiateEventId, event_name: 'InitiateCheckout', occurred_at: new Date().toISOString(),
        flow_token_hash: flowTokenHash, identity: { lead_id: leadId, funnel_id: funnelId }, buyer_context: buyerContext,
      };
      await env.LEADS.batch([
        env.LEADS.prepare(
        `UPDATE checkout_leads
         SET status = 'session_created', stripe_session_id = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(sessionId, new Date().toISOString(), leadId),
        sourceOutboxStatement(env.LEADS, {
          tenantId: scope.tenantId, siteId: scope.siteId, sourceEventId: initiateEventId,
          eventName: 'InitiateCheckout', occurredAt: initiatePayload.occurred_at, payload: initiatePayload,
          payloadHash: await sourcePayloadHash(initiatePayload),
        }),
      ]);
      if (env.TRACKING_SOURCE_BRIDGE)
        await drainSourceEvent(env.LEADS, env, { ...scope, sourceEventId: initiateEventId });

      return json({ checkoutUrl, mode: checkoutMode, provider: paymentProvider });
    }

    if (!dodoConfig) throw new Error('Dodo checkout configuration is unavailable.');
    const productCart = dodoProductIds.map((productId) => ({
      product_id: productId,
      quantity: 1,
    }));

    // Dodo's saved-card flow is documented against an explicitly attached
    // customer. Resolve that customer before checkout so the first card can be
    // associated with the same customer used by the post-purchase upsells.
    const dodoCustomerId = await getOrCreateDodoCustomer(env, email);
    await env.LEADS.prepare(
      `UPDATE funnel_runs SET dodo_customer_id = ?, updated_at = ? WHERE id = ?`
    )
      .bind(dodoCustomerId, new Date().toISOString(), funnelId)
      .run();

    const providerResponse = await fetch(`${dodoConfig.apiBaseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dodoConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: productCart,
        customer: { customer_id: dodoCustomerId },
        show_saved_payment_methods: true,
        return_url: returnUrl.toString(),
        customization: {
          theme: 'light',
          show_order_details: true,
          show_on_demand_tag: false,
          theme_config: {
            radius: '12px',
            font_size: 'lg',
            font_weight: 'medium',
            pay_button_text: 'Complete purchase',
            light: {
              bg_primary: '#ffffff',
              bg_secondary: '#f6f7fb',
              border_primary: '#d8deea',
              border_secondary: '#2563eb',
              button_primary: '#2563eb',
              button_primary_hover: '#1d4ed8',
              button_secondary: '#eef2f7',
              button_secondary_hover: '#e2e8f0',
              button_text_primary: '#ffffff',
              button_text_secondary: '#111827',
              input_focus_border: '#2563eb',
              text_error: '#b91c1c',
              text_placeholder: '#6b7280',
              text_primary: '#111827',
              text_secondary: '#4b5563',
              text_success: '#047857',
            },
          },
        },
        feature_flags: {
          allow_currency_selection: false,
          allow_discount_code: false,
          allow_phone_number_collection: false,
          allow_tax_id: false,
          always_create_new_customer: false,
          redirect_immediately: true,
        },
        metadata,
      }),
      signal: AbortSignal.timeout(DODO_TIMEOUT_MS),
    });

    if (!providerResponse.ok) {
      console.error('Dodo checkout creation failed.', {
        leadId,
        offerSlug,
        providerStatus: providerResponse.status,
      });
      throw new Error('Dodo checkout creation failed.');
    }

    const providerPayload = (await providerResponse.json()) as DodoCheckoutResponse;
    const checkoutUrl = validateCheckoutUrl(providerPayload.checkout_url);
    const sessionId = cleanString(providerPayload.session_id, 160);
    if (!sessionId) throw new Error('Dodo response did not contain a session ID.');

    const initiateEventId = `initiate_checkout:${sessionId}`;
    const initiatePayload = {
      schema_version: '1', event_id: initiateEventId, event_name: 'InitiateCheckout', occurred_at: new Date().toISOString(),
      flow_token_hash: flowTokenHash, identity: { lead_id: leadId, funnel_id: funnelId }, buyer_context: buyerContext,
    };
    await env.LEADS.batch([
      env.LEADS.prepare(
      `UPDATE checkout_leads
       SET status = 'session_created', dodo_session_id = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(sessionId, new Date().toISOString(), leadId),
      sourceOutboxStatement(env.LEADS, {
        tenantId: scope.tenantId, siteId: scope.siteId, sourceEventId: initiateEventId,
        eventName: 'InitiateCheckout', occurredAt: initiatePayload.occurred_at, payload: initiatePayload,
        payloadHash: await sourcePayloadHash(initiatePayload),
      }),
    ]);
    if (env.TRACKING_SOURCE_BRIDGE)
      await drainSourceEvent(env.LEADS, env, { ...scope, sourceEventId: initiateEventId });

    return json({ checkoutUrl, mode: checkoutMode, provider: paymentProvider });
  } catch (error) {
    if (leadId && env.LEADS) {
      try {
        await env.LEADS.prepare(
          `UPDATE checkout_leads
           SET status = 'session_failed', error_code = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(
            error instanceof RequestError
              ? (error.code ?? `http_${error.status}`)
              : 'provider_error',
            new Date().toISOString(),
            leadId
          )
          .run();
      } catch {
        console.error('Failed to update checkout lead status.', { leadId, offerSlug });
      }
    }

    if (error instanceof RequestError) {
      return json(
        { error: error.message, code: error.code ?? `http_${error.status}` },
        error.status
      );
    }

    console.error('Checkout request failed.', { leadId, offerSlug });
    return json(
      {
        error: 'Checkout is temporarily unavailable. Please try again.',
        ...(leadEvent ? { lead: leadEvent } : {}),
      },
      502
    );
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}
