import { getProductId, PRODUCT_KEYS } from '../_lib/products';
import {
  cleanString,
  getDodoConfig,
  hashFlowToken,
  json,
  randomFlowToken,
  readEnvironmentValue,
  RequestError,
  type PagesContext,
} from '../_lib/runtime';

interface CheckoutRequest {
  email?: unknown;
  offerSlug?: unknown;
  placement?: unknown;
  consentVersion?: unknown;
  website?: unknown;
  attribution?: unknown;
  referrer?: unknown;
  bumpAccepted?: unknown;
}

interface DodoCheckoutResponse {
  checkout_url?: unknown;
  session_id?: unknown;
}

const MAX_BODY_BYTES = 16 * 1024;
const DODO_TIMEOUT_MS = 15_000;
const OFFER_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRODUCT_ID_PATTERN = /^(?:pdt|prod)_[A-Za-z0-9]+$/;
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

function productEnvironmentKey(offerSlug: string): string {
  return `DODO_PRODUCT_${offerSlug.toUpperCase().replaceAll('-', '_')}`;
}

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
  if (typeof value !== 'string') {
    throw new Error('Dodo response did not contain a checkout URL.');
  }

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

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');

  if (origin && origin !== requestUrl.origin) {
    return json({ error: 'Checkout request origin is not allowed.' }, 403);
  }

  let leadId = '';
  let offerSlug = '';

  try {
    const input = await parseRequest(request);
    const email = cleanString(input.email, 254).toLowerCase();
    offerSlug = cleanString(input.offerSlug, 80);
    const placement = cleanString(input.placement, 80) || 'unknown';
    const consentVersion = cleanString(input.consentVersion, 80);
    const honeypot = cleanString(input.website, 200);
    const referrer = cleanString(input.referrer, 1024);
    const attribution = sanitizeAttribution(input.attribution);
    const bumpAccepted = input.bumpAccepted === true;
    const hasFunnel = offerSlug === 'vibe-code-anything';

    if (honeypot) return json({ error: 'Checkout request is invalid.' }, 400);
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new RequestError('Enter a valid email address.', 400);
    }
    if (!OFFER_SLUG_PATTERN.test(offerSlug) || offerSlug.length > 80) {
      throw new RequestError('Offer is invalid.', 400);
    }
    if (!consentVersion) {
      throw new RequestError('Email consent is required.', 400);
    }
    if (!env.LEADS) {
      console.error('Checkout configuration is incomplete.', {
        offerSlug,
        missingBinding: 'LEADS',
      });
      throw new RequestError('Checkout is not configured yet.', 503, 'configuration_storage');
    }

    const { apiKey, apiBaseUrl, checkoutMode } = getDodoConfig(env);
    const productEnvironmentVariable = productEnvironmentKey(offerSlug);
    const productId = readEnvironmentValue(env, productEnvironmentVariable);
    if (!PRODUCT_ID_PATTERN.test(productId)) {
      console.error('Checkout configuration is incomplete.', {
        offerSlug,
        productEnvironmentVariable,
        hasProductId: Boolean(productId),
      });
      throw new RequestError('Checkout is not configured yet.', 503, 'configuration_product');
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

    const insertResult = await env.LEADS.prepare(
      `INSERT INTO checkout_leads (
        id,
        email,
        offer_slug,
        placement,
        marketing_consent,
        consent_version,
        attribution_json,
        referrer,
        country,
        status,
        bump_selected,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'captured', ?, ?, ?)`
    )
      .bind(
        leadId,
        email,
        offerSlug,
        placement,
        consentVersion,
        JSON.stringify(attribution),
        referrer || null,
        country || null,
        bumpAccepted ? 1 : 0,
        now,
        now
      )
      .run();

    if (!insertResult.success) {
      throw new Error('Lead capture failed.');
    }

    if (hasFunnel) {
      const funnelResult = await env.LEADS.prepare(
        `INSERT INTO checkout_funnels (id, lead_id, token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(funnelId, leadId, flowTokenHash, now, now)
        .run();
      if (!funnelResult.success) throw new Error('Checkout funnel initialization failed.');
    }

    const configuredReturnUrl = readEnvironmentValue(env, 'DODO_PAYMENTS_RETURN_URL');
    const returnUrl = new URL(
      hasFunnel ? '/checkout/upsell/blueprints/' : configuredReturnUrl || '/checkout/success/',
      requestUrl.origin
    );
    returnUrl.searchParams.set('offer', offerSlug);
    if (hasFunnel) returnUrl.searchParams.set('flow', flowToken);
    else returnUrl.searchParams.set('lead', leadId);

    const productCart = [{ product_id: productId, quantity: 1 }];
    if (hasFunnel && bumpAccepted) {
      productCart.push({
        product_id: await getProductId(env.LEADS, PRODUCT_KEYS.promptPack),
        quantity: 1,
      });
    }

    const providerResponse = await fetch(`${apiBaseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: productCart,
        customer: { email },
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
        },
        metadata: {
          offer_slug: offerSlug,
          lead_id: leadId,
          placement,
          bump_selected: bumpAccepted ? 'true' : 'false',
          source: 'maestro-offers',
        },
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

    await env.LEADS.prepare(
      `UPDATE checkout_leads
       SET status = 'session_created', dodo_session_id = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(sessionId, new Date().toISOString(), leadId)
      .run();

    return json({ checkoutUrl, mode: checkoutMode });
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
    return json({ error: 'Checkout is temporarily unavailable. Please try again.' }, 502);
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}
