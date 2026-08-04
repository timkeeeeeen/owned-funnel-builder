import type { CanonicalEvent } from '../../../functions/_lib/tracking-contract.ts';
import type { DeliveryResult, EventsEnv } from './meta.ts';

export async function sendTinybird(event: CanonicalEvent, env: EventsEnv): Promise<DeliveryResult> {
  const url = typeof env.TINYBIRD_APPEND_URL === 'string' ? env.TINYBIRD_APPEND_URL : '';
  const token = typeof env.TINYBIRD_APPEND_TOKEN === 'string' ? env.TINYBIRD_APPEND_TOKEN : '';
  if (!/^https:\/\//.test(url) || !token) return { state: 'permanent' };
  const key = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([event.tenant_id, event.site_id, event.event_name, event.event_id].join('\0')));
  const canonical_key = Array.from(new Uint8Array(key), byte => byte.toString(16).padStart(2, '0')).join('');
  const subject = event.identity.visitor_id ?? event.identity.person_id ?? '';
  const subjectDigest = subject ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`privacy-v1:${subject}`))), byte => byte.toString(16).padStart(2, '0')).join('') : '';
  const commerce = event.commerce as Record<string, unknown>;
  const row = { canonical_key, privacy_subject_key: subjectDigest ? `v1:${subjectDigest}` : '', event_name: event.event_name, event_id: event.event_id, occurred_at: event.occurred_at, tenant_id: event.tenant_id, site_id: event.site_id, source_system: event.source_system, page_path: event.page.path ?? '', currency: typeof commerce.currency === 'string' ? commerce.currency : '', value: typeof commerce.value === 'number' ? commerce.value : null, quantity: typeof commerce.quantity === 'number' ? commerce.quantity : null };
  try {
    const response = await (env.fetch ?? fetch)(url + (url.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-ndjson' }, body: JSON.stringify(row) + '\n' });
    if (response.status >= 500 || response.status === 429) return { state: 'retryable', retryAfterSeconds: Math.min(300, Math.max(1, Number(response.headers.get('retry-after')) || 30)) };
    return response.ok ? { state: 'accepted' } : { state: 'permanent' };
  } catch { return { state: 'outcome_unknown' }; }
}
