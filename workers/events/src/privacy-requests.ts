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
  await env.TRACKING_DB.batch([
    env.TRACKING_DB.prepare(`INSERT INTO tracking_suppression_tombstones (suppression_key, tenant_id, site_id, visitor_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(suppression_key) DO NOTHING`).bind(`request:${id}`, tenant, site, request.subjectId, `privacy_${request.action}`, now),
    env.TRACKING_DB.prepare(`INSERT INTO tracking_privacy_requests (request_id, tenant_id, site_id, subject_id, action, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(id, tenant, site, request.subjectId, request.action, now, now),
  ]);
  return id;
}
