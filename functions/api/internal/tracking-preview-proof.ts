import {
  drainSourceEvent,
  sourceOutboxStatement,
  sourcePayloadHash,
} from '../../_lib/source-outbox.ts';
import { cleanString, json, readEnvironmentValue, type PagesContext } from '../../_lib/runtime.ts';
import { validatePrivacySnapshot } from '../../../workers/events/src/source-bridge.ts';

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const token = readEnvironmentValue(env, 'TRACKING_PREVIEW_PROOF_TOKEN');
  if (
    readEnvironmentValue(env, 'TRACKING_ENVIRONMENT') !== 'preview' ||
    readEnvironmentValue(env, 'TRACKING_PREVIEW_NON_PAYMENT_PROOF') !== 'true' ||
    !token ||
    cleanString(request.headers.get('authorization'), 4096) !== `Bearer ${token}`
  )
    return json({ error: 'not_authorized' }, 401);
  if (!env.LEADS || !env.TRACKING_SOURCE_BRIDGE)
    return json({ error: 'tracking_unavailable' }, 503);
  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const contextHash = cleanString(input.context_hash, 64);
  const contextExpiresAt = cleanString(input.context_expires_at, 64);
  const snapshot = validatePrivacySnapshot(input.privacy_snapshot);
  if (
    !/^[a-f0-9]{64}$/.test(contextHash) ||
    !snapshot ||
    !Number.isFinite(Date.parse(contextExpiresAt)) ||
    Date.parse(contextExpiresAt) <= Date.now()
  )
    return json({ error: 'invalid_request' }, 400);
  const tenantId = readEnvironmentValue(env, 'TRACKING_TENANT_ID');
  const siteId = readEnvironmentValue(env, 'TRACKING_SITE_ID');
  if (!tenantId || !siteId) return json({ error: 'tracking_unavailable' }, 503);
  const now = new Date().toISOString();
  const events = [
    {
      eventName: 'Lead' as const,
      sourceEventId: `lead_preview_${crypto.randomUUID()}`,
      extra: { lead_id: `lead_preview_${crypto.randomUUID()}` },
    },
    {
      eventName: 'InitiateCheckout' as const,
      sourceEventId: `checkout_preview_${crypto.randomUUID()}`,
      extra: { checkout_session_id: `checkout_preview_${crypto.randomUUID()}` },
    },
  ];
  const outbox = await Promise.all(
    events.map(async (event) => {
      const payload = {
        schema_version: '1',
        source_system: 'pages',
        source_event_id: event.sourceEventId,
        event_name: event.eventName,
        occurred_at: now,
        context_hash: contextHash,
        context_expires_at: contextExpiresAt,
        funnel_slug: 'owned-funnel-builder',
        ...event.extra,
        privacy_snapshot: snapshot,
      };
      return {
        ...event,
        statement: sourceOutboxStatement(env.LEADS!, {
          tenantId,
          siteId,
          sourceEventId: event.sourceEventId,
          eventName: event.eventName,
          occurredAt: now,
          payload,
          payloadHash: await sourcePayloadHash(payload),
        }),
      };
    })
  );
  const written = await env.LEADS.batch(outbox.map((event) => event.statement));
  if (written.some((result) => !result.success))
    return json({ error: 'tracking_unavailable' }, 503);
  for (const event of outbox) {
    if (
      !(await drainSourceEvent(env.LEADS, env, {
        tenantId,
        siteId,
        sourceEventId: event.sourceEventId,
      }))
    )
      return json({ error: 'tracking_unavailable' }, 502);
  }
  return json(
    {
      events: outbox.map(({ eventName, sourceEventId }) => ({
        event_name: eventName,
        event_id: sourceEventId,
      })),
    },
    202
  );
}

export function onRequest(): Response {
  return json({ error: 'not_allowed' }, 403);
}
