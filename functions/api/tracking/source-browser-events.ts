import { cleanString, hashFlowToken, json, validFlowToken, type PagesContext } from '../../_lib/runtime';

type Bridge = { fetch(request: Request): Promise<Response> };

function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}

function bridge(env: PagesContext['env']): Bridge | null {
  const value = env.TRACKING_SOURCE_BRIDGE;
  return value && typeof value === 'object' && 'fetch' in value ? (value as Bridge) : null;
}

function flowCookie(request: Request): string {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === 'ma_flow')?.[1];
  return validFlowToken(value) ? value : '';
}

function base64url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signHeaders(env: PagesContext['env'], body: string): Promise<Headers | null> {
  const keyValue = env.TRACKING_PAGES_BRIDGE_KEY_CURRENT;
  if (typeof keyValue !== 'string' || keyValue.length < 16) return null;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = base64url(nonceBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const digestB64 = base64url(new Uint8Array(digest));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v1\n${timestamp}\n${nonce}\n${digestB64}\n${body}`)
  );
  return new Headers({
    'Content-Type': 'application/json',
    'X-Maestro-Issuer': 'pages',
    'X-Maestro-Key-Id': cleanString(env.TRACKING_PAGES_BRIDGE_KEY_ID_CURRENT, 64) || 'pages-current',
    'X-Maestro-Timestamp': timestamp,
    'X-Maestro-Nonce': nonce,
    'X-Maestro-Signature': base64url(new Uint8Array(signature)),
  });
}

function claim(value: unknown): { event_name: string; event_id: string; custom_data: Record<string, unknown> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.event_name !== 'string' || typeof input.event_id !== 'string' ||
      !input.custom_data || typeof input.custom_data !== 'object' || Array.isArray(input.custom_data)) return null;
  const customData = input.custom_data as Record<string, unknown>;
  return {
    event_name: input.event_name,
    event_id: input.event_id,
    custom_data: Object.fromEntries(
      Object.entries(customData).filter(([key]) =>
        ['content_ids', 'content_type', 'contents', 'currency', 'num_items', 'value'].includes(key)
      )
    ),
  };
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (request.headers.get('access-control-request-method') || !sameOrigin(request))
    return json({ error: 'not_allowed' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return json({ error: 'invalid_request' }, 400);
  let input: Record<string, unknown>;
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    input = value as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (Object.keys(input).some((key) => !['funnel_slug', 'payment_ids'].includes(key)))
    return json({ error: 'invalid_request' }, 400);
  const flow = flowCookie(request);
  if (!flow) return json({ error: 'invalid_flow' }, 400);
  const funnel = input.funnel_slug;
  const paymentIds = Array.isArray(input.payment_ids)
    ? input.payment_ids.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value)).slice(0, 50)
    : [];
  if (typeof funnel !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(funnel) || !paymentIds.length)
    return json({ error: 'invalid_request' }, 400);
  const flowBinding = await hashFlowToken(flow);
  const payload = JSON.stringify({ funnel_slug: funnel, flow_binding: flowBinding, payment_ids: paymentIds });
  const headers = await signHeaders(env, payload);
  const sourceBridge = bridge(env);
  if (!headers || !sourceBridge) return json({ error: 'tracking_unavailable' }, 503);
  try {
    const response = await sourceBridge.fetch(
      new Request('https://tracking.internal/internal/browser-claims', {
        method: 'POST',
        headers,
        body: payload,
      })
    );
    if (!response.ok) return json({ error: 'tracking_unavailable' }, 502);
    const result = (await response.json()) as unknown;
    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray((result as { claims?: unknown }).claims))
      return json({ error: 'tracking_unavailable' }, 502);
    return json({ claims: (result as { claims: unknown[] }).claims.map(claim).filter(Boolean) });
  } catch {
    return json({ error: 'tracking_unavailable' }, 503);
  }
}

export function onRequest(): Response {
  return json({ error: 'not_allowed' }, 403);
}
