import type { CanonicalEvent } from '../../../functions/_lib/tracking-contract.ts';

export type DeliveryResult = {
  state: 'accepted' | 'retryable' | 'permanent' | 'outcome_unknown';
  providerRequestId?: string;
  retryAfterSeconds?: number;
  redactedDiagnostics?: Record<string, string>;
};

export type EventsEnv = Record<string, unknown> & { fetch?: typeof fetch };

const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const hashed = (value: string) => /^[a-f\d]{64}$/i.test(value);
const normalizeEmail = (value: unknown) => text(value).toLowerCase();
const normalizePhone = (value: unknown) => text(value).replace(/\D/g, '');
const retryAfter = (response: Response) => Math.min(300, Math.max(1, Number(response.headers.get('retry-after')) || 30));

export async function sendMeta(event: CanonicalEvent, env: EventsEnv, context: Record<string, unknown> = {}): Promise<DeliveryResult> {
  const pixelId = text(env.META_PIXEL_ID);
  const token = text(env.META_ACCESS_TOKEN);
  const version = text(env.META_GRAPH_VERSION) || 'v23.0';
  if (!/^[\d]+$/.test(pixelId) || !/^v\d+\.\d+$/.test(version) || !token) return { state: 'permanent' };
  const identityBearing = Boolean(context.email || context.phone || context.external_id);
  if (identityBearing && context.meta_identity_version !== 'meta-v1') return { state: 'permanent' };
  const email = normalizeEmail(context.email);
  const phone = normalizePhone(context.phone);
  if (hashed(email) || hashed(phone)) return { state: 'permanent' };
  const sourceUrl = text(context.event_source_url || context.source_url);
  if (!sourceUrl) return { state: 'retryable', retryAfterSeconds: 30 };
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'shop.maestrogtm.com' || url.search || url.hash) return { state: 'permanent' };
  } catch { return { state: 'permanent' }; }
  const commerce = event.commerce as Record<string, unknown>;
  const custom_data = Object.fromEntries(Object.entries(commerce).filter(([key]) => ['order_id', 'payment_id', 'content_ids', 'content_type', 'contents', 'currency', 'quantity', 'num_items', 'value'].includes(key)));
  const user_data: Record<string, unknown> = {
    ...(email ? { em: [await sha256(email)] } : {}),
    ...(phone ? { ph: [await sha256(phone)] } : {}),
    ...(text(context.fbp) || text(event.attribution.fbp) ? { fbp: text(context.fbp) || text(event.attribution.fbp) } : {}),
    ...(text(context.fbc) || text(event.attribution.fbc) ? { fbc: text(context.fbc) || text(event.attribution.fbc) } : {}),
    ...(text(context.ip) ? { client_ip_address: text(context.ip) } : {}),
    ...(text(context.user_agent) ? { client_user_agent: text(context.user_agent) } : {}),
  };
  const payload = { data: [{ event_name: event.event_name, event_time: Math.floor(Date.parse(event.occurred_at) / 1000), event_id: event.event_id, action_source: 'website', event_source_url: sourceUrl, ...(Object.keys(custom_data).length ? { custom_data } : {}), ...(Object.keys(user_data).length ? { user_data } : {}) }], ...(env.META_OPERATOR_VALIDATION === true && text(env.META_TEST_EVENT_CODE) ? { test_event_code: text(env.META_TEST_EVENT_CODE) } : {}) };
  try {
    const response = await (env.fetch ?? fetch)(`https://graph.facebook.com/${version}/${pixelId}/events`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (response.status === 429 || response.status >= 500) return { state: 'retryable', retryAfterSeconds: retryAfter(response) };
    if (!response.ok) return { state: 'permanent' };
    const body = await response.json().catch(() => null) as { fbtrace_id?: unknown; events_received?: unknown } | null;
    if (!body || typeof body.events_received !== 'number') return { state: 'outcome_unknown' };
    return { state: 'accepted', ...(typeof body.fbtrace_id === 'string' ? { providerRequestId: body.fbtrace_id } : {}) };
  } catch { return { state: 'outcome_unknown' }; }
}
