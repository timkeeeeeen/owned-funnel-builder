import {
  claimUnseenPurchases,
  toSafeBrowserPurchase,
  type BrowserPurchaseClaim,
} from '../../_lib/source-outbox.ts';
import { cleanString, json, validFlowToken, type PagesContext } from '../../_lib/runtime.ts';

type SourceBridge = { fetch(request: Request): Promise<Response> };

function readBoundFlowToken(request: Request, body: unknown): string {
  const fromBody =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { flow?: unknown }).flow
      : undefined;
  const fromCookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === 'ma_flow')?.[1];
  const flow = typeof fromBody === 'string' ? fromBody : fromCookie;
  return validFlowToken(flow) ? flow : '';
}

function bridge(env: PagesContext['env']): SourceBridge | null {
  const value = env.TRACKING_SOURCE_BRIDGE;
  return value && typeof value === 'object' && 'fetch' in value ? (value as SourceBridge) : null;
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const origin = new URL(request.url).origin;
  if (request.method !== 'POST' || request.headers.get('origin') !== origin)
    return json({ error: 'not_allowed' }, 403);
  if (request.headers.get('access-control-request-method'))
    return json({ error: 'preflight_not_allowed' }, 403);
  let body: unknown;
  try {
    body = request.headers.get('content-type')?.includes('application/json') ? await request.json() : null;
  } catch {
    return json({ error: 'invalid_flow' }, 400);
  }
  const flow = readBoundFlowToken(request, body);
  if (!flow) return json({ error: 'invalid_flow' }, 400);
  const sourceBridge = bridge(env);
  if (!sourceBridge) return json({ error: 'tracking_unavailable' }, 503);
  const token = cleanString(env.TRACKING_SOURCE_BRIDGE_TOKEN, 4096);
  if (!token) return json({ error: 'tracking_unavailable' }, 503);
  try {
    const purchases = await claimUnseenPurchases(flow, async (flowToken) => {
      const response = await sourceBridge.fetch(
        new Request('https://tracking.internal/private/browser-purchases/claim', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ flow_token: flowToken }),
        })
      );
      if (!response.ok) throw new Error('claim_failed');
      const payload = (await response.json()) as { purchases?: BrowserPurchaseClaim[] };
      return Array.isArray(payload.purchases) ? payload.purchases : [];
    });
    return json({ purchases: purchases.map(toSafeBrowserPurchase).filter(Boolean) });
  } catch {
    return json({ error: 'tracking_unavailable' }, 503);
  }
}

export function onRequest(): Response {
  return json({ error: 'not_allowed' }, 403);
}
