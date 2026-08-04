import type { D1Database } from '../../../functions/_lib/runtime.ts';

export type PrivacyRequest = { action: 'access' | 'correction' | 'deletion' | 'opt_out'; subjectId: string; verified: true };
export function privacyRequestBody(value: unknown): PrivacyRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid_privacy_request');
  const body = value as Record<string, unknown>;
  if (!['access', 'correction', 'deletion', 'opt_out'].includes(String(body.action)) || typeof body.subject_id !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(body.subject_id) || body.verified !== true) throw new TypeError('privacy_verification_required');
  return { action: body.action as PrivacyRequest['action'], subjectId: body.subject_id, verified: true };
}
export async function createPrivacyRequest(env: Record<string, unknown> & { TRACKING_DB: D1Database }, request: PrivacyRequest): Promise<string> {
  if (!request.verified) throw new TypeError('privacy_verification_required');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const tenant = String(env.TRACKING_TENANT_ID ?? 'default'), site = String(env.TRACKING_SITE_ID ?? 'default');
  const tombstone = request.action === 'deletion' || request.action === 'opt_out';
  const tinybirdUrl = typeof env.TINYBIRD_TOMBSTONE_APPEND_URL === 'string' ? env.TINYBIRD_TOMBSTONE_APPEND_URL : '';
  const tinybirdToken = typeof env.TINYBIRD_TOMBSTONE_APPEND_TOKEN === 'string' ? env.TINYBIRD_TOMBSTONE_APPEND_TOKEN : '';
  if (tombstone && (!tinybirdUrl || !tinybirdToken)) throw new Error('tinybird_tombstone_unconfigured');
  const statements = [
    ...(tombstone ? [env.TRACKING_DB.prepare(`INSERT INTO tracking_suppression_tombstones (suppression_key, tenant_id, site_id, visitor_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(suppression_key) DO NOTHING`).bind(`request:${id}`, tenant, site, request.subjectId, `privacy_${request.action}`, now)] : []),
    env.TRACKING_DB.prepare(`INSERT INTO tracking_privacy_requests (request_id, tenant_id, site_id, subject_id, action, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, tenant, site, request.subjectId, request.action, tombstone ? 'tombstone_committed' : 'pending', now, now),
    env.TRACKING_DB.prepare(`INSERT INTO tracking_deletion_requests (request_id, tenant_id, subject_key, request_type, state, verification_state, created_at, audit_json) VALUES (?, ?, ?, ?, ?, 'verified', ?, ?)`).bind(id, tenant, request.subjectId, request.action, tombstone ? 'tombstone_committed' : 'pending', now, JSON.stringify({ source: 'worker', request_id: id })),
  ];
  await env.TRACKING_DB.batch(statements);
  if (tombstone) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`privacy-v1:${request.subjectId}`));
    const privacySubjectKey = `v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const response = await fetch(`${tinybirdUrl}${tinybirdUrl.includes('?') ? '&' : '?'}wait=true`, { method: 'POST', headers: { authorization: `Bearer ${tinybirdToken}`, 'content-type': 'application/x-ndjson' }, body: JSON.stringify({ privacy_subject_key: privacySubjectKey, tombstoned_at: now, expires_at: new Date(Date.now() + 10 * 365 * 86_400_000).toISOString(), request_id: id }) + '\n' });
    if (!response.ok) throw new Error('tinybird_tombstone_failed');
  }
  return id;
}
