import { json, type PagesContext } from '../../_lib/runtime';

type Bridge = { fetch(request: Request): Promise<Response> };
type EventName = 'Lead' | 'InitiateCheckout';
type BrowserEvent = {
  event_id: string;
  event_name: EventName;
  custom_data?: Record<string, unknown>;
};

const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{16,2048}\.[A-Za-z0-9_-]{32,512}$/;
const EVENT_ID_PATTERN = /^(?:lead|initiate_checkout):[A-Za-z0-9:_-]{1,128}$/;
const SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/;
const IDP_PATTERN = /^[A-Za-z0-9._:-]{1,180}$/;
const CHECKOUT_HOST = /^(?:[a-z0-9-]+\.)*dodopayments\.com$/i;

export type BlueprintProxyOperation = 'checkout-start' | 'checkout-status';

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}

function bridge(env: PagesContext['env']): Bridge | null {
  const value = env.BLUEPRINT_CONVEX_BRIDGE;
  return value && typeof value === 'object' && 'fetch' in value ? (value as Bridge) : null;
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES || !request.headers.get('content-type')?.includes('application/json'))
    return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function validBody(body: Record<string, unknown>, operation: BlueprintProxyOperation): boolean {
  const allowed =
    operation === 'checkout-start'
      ? [
          'tracking_context_token',
          'candidate_event_id',
          'public_session_token',
          'checkout_idempotency_key',
          'turnstile_token',
        ]
      : [
          'tracking_context_token',
          'candidate_event_id',
          'public_session_token',
          'checkout_idempotency_key',
        ];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return false;
  if (
    typeof body.tracking_context_token !== 'string' ||
    !TOKEN_PATTERN.test(body.tracking_context_token)
  )
    return false;
  if (
    typeof body.candidate_event_id !== 'string' ||
    !EVENT_ID_PATTERN.test(body.candidate_event_id)
  )
    return false;
  if (
    typeof body.public_session_token !== 'string' ||
    !SESSION_PATTERN.test(body.public_session_token)
  )
    return false;
  if (
    typeof body.checkout_idempotency_key !== 'string' ||
    !IDP_PATTERN.test(body.checkout_idempotency_key)
  )
    return false;
  return (
    operation !== 'checkout-start' ||
    (typeof body.turnstile_token === 'string' &&
      body.turnstile_token.length <= 4096 &&
      body.turnstile_token.length > 0)
  );
}

async function verifyContextToken(
  env: PagesContext['env'],
  token: string,
  eventId: string
): Promise<boolean> {
  const verifier = env.BLUEPRINT_CONTEXT_TOKEN_VERIFY;
  if (typeof verifier !== 'function') return false;
  try {
    return (
      (await (verifier as (value: string, candidateEventId: string) => Promise<unknown>)(
        token,
        eventId
      )) === true
    );
  } catch {
    return false;
  }
}

function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      CHECKOUT_HOST.test(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function safeCustomData(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const allowed = [
    'content_name',
    'content_ids',
    'content_type',
    'contents',
    'currency',
    'num_items',
    'value',
  ];
  if (
    Object.keys(input).some(
      (key) => !allowed.includes(key) || /email|phone|token|password|cookie/i.test(key)
    )
  )
    return undefined;
  const output: Record<string, unknown> = {};
  if (input.tracking_context_token !== undefined) {
    if (
      typeof input.tracking_context_token !== 'string' ||
      !TOKEN_PATTERN.test(input.tracking_context_token)
    )
      return undefined;
    output.tracking_context_token = input.tracking_context_token;
  }
  if (typeof input.content_name === 'string' && input.content_name.length <= 256)
    output.content_name = input.content_name;
  if (
    Array.isArray(input.content_ids) &&
    input.content_ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(id))
  )
    output.content_ids = input.content_ids.slice(0, 50);
  if (input.content_type === 'product') output.content_type = input.content_type;
  if (typeof input.currency === 'string' && /^[A-Za-z]{3}$/.test(input.currency))
    output.currency = input.currency.toUpperCase();
  if (typeof input.num_items === 'number' && Number.isFinite(input.num_items))
    output.num_items = input.num_items;
  if (typeof input.value === 'number' && Number.isFinite(input.value)) output.value = input.value;
  if (Array.isArray(input.contents)) {
    if (
      !input.contents.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as { id?: unknown }).id === 'string' &&
          typeof (item as { quantity?: unknown }).quantity === 'number'
      )
    )
      return undefined;
    output.contents = input.contents.slice(0, 50).map((item) => ({
      id: String((item as { id: string }).id).slice(0, 180),
      quantity: Number((item as { quantity: number }).quantity),
    }));
  }
  return output;
}

function safeEvent(value: unknown): BrowserEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    !EVENT_ID_PATTERN.test(String(input.event_id ?? '')) ||
    !['Lead', 'InitiateCheckout'].includes(String(input.event_name ?? ''))
  )
    return undefined;
  const customData = safeCustomData(input.custom_data);
  if (input.custom_data !== undefined && !customData) return undefined;
  return {
    event_id: String(input.event_id),
    event_name: input.event_name as EventName,
    ...(customData ? { custom_data: customData } : {}),
  };
}

function safeValue(
  value: unknown,
  operation: BlueprintProxyOperation,
  candidateEventId: string
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const allowed =
    operation === 'checkout-start'
      ? ['checkoutUrl', 'checkout_url', 'lead', 'initiateCheckout', 'tracking_context_token']
      : ['state', 'checkoutUrl', 'checkout_url', 'initiateCheckout', 'tracking_context_token'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) return undefined;
  const output: Record<string, unknown> = {};
  if (operation === 'checkout-status') {
    if (!['pending', 'ready', 'paid', 'expired', 'canceled'].includes(String(input.state ?? '')))
      return undefined;
    output.state = input.state;
  }
  const checkoutUrl = input.checkoutUrl ?? input.checkout_url;
  if (checkoutUrl !== undefined) {
    if (!validCheckoutUrl(checkoutUrl)) return undefined;
    output.checkoutUrl = checkoutUrl;
  }
  for (const key of ['lead', 'initiateCheckout']) {
    if (input[key] === undefined) continue;
    const event = safeEvent(input[key]);
    if (!event || (key === 'initiateCheckout' && event.event_id !== candidateEventId))
      return undefined;
    output[key] = event;
  }
  if (operation === 'checkout-start' && !output.checkoutUrl) return undefined;
  return output;
}

export async function proxyCheckout(
  context: PagesContext,
  operation: BlueprintProxyOperation
): Promise<Response> {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameOrigin(request) || request.headers.get('access-control-request-method'))
    return json({ error: 'not_allowed' }, 403);
  const body = await parseBody(request);
  if (!body || !validBody(body, operation)) return json({ error: 'invalid_request' }, 400);
  const token = body.tracking_context_token as string;
  const candidateEventId = body.candidate_event_id as string;
  if (!(await verifyContextToken(env, token, candidateEventId)))
    return json({ error: 'invalid_context' }, 403);
  const service = bridge(env);
  if (!service) return json({ error: 'blueprint_unavailable' }, 503);
  try {
    const outbound = new Request(`https://blueprint.internal/internal/blueprint/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingContextToken: token,
        candidateEventId,
        publicSessionToken: body.public_session_token,
        checkoutIdempotencyKey: body.checkout_idempotency_key,
        ...(operation === 'checkout-start'
          ? {
              returnPath: '/blueprint/checkout/return',
              turnstileToken: body.turnstile_token,
            }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const response = await service.fetch(outbound);
    if (!response.ok) return json({ error: 'blueprint_unavailable' }, 502);
    const payload = (await response.json()) as unknown;
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      (payload as { status?: unknown }).status !== 'success'
    )
      return json({ error: 'blueprint_unavailable' }, 502);
    const safe = safeValue((payload as { value?: unknown }).value, operation, candidateEventId);
    return safe ? json(safe) : json({ error: 'blueprint_invalid_response' }, 502);
  } catch {
    return json({ error: 'blueprint_unavailable' }, 502);
  }
}
