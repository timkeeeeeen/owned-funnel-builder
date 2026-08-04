import type { D1Database } from '../../../functions/_lib/runtime.ts';
import type { DestinationName } from '../../../functions/_lib/tracking-contract.ts';
import { redactError } from './observability.ts';
import { safeEventKey, type TrackingQueueMessage } from './outbox.ts';

export type QueueMessage = {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
  attempts?: number;
};
export type QueueBatch = { queue?: string; messages: QueueMessage[] };
export type DestinationSender = (
  event: Record<string, unknown>,
  context: { eventKey: string; destination: DestinationName }
) => Promise<unknown>;
export type QueueEnv = Record<string, unknown> & {
  TRACKING_DB: D1Database;
  EVENTS_DLQ?: { send(message: TrackingQueueMessage): Promise<void> };
  DESTINATION_SENDERS?: Partial<Record<DestinationName, DestinationSender>>;
};

const MAX_RETRIES = 5;

export type DeliveryLease = {
  owner: string;
  fencingToken: number;
  deadline: string;
};

function timestampAfter(seconds: number): string {
  return new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function persistDlq(
  env: QueueEnv,
  body: unknown,
  reason: string,
  attempts: number
): Promise<void> {
  const key =
    body && typeof body === 'object' && 'event_key' in body && typeof body.event_key === 'string'
      ? body.event_key
      : null;
  const destination =
    body &&
    typeof body === 'object' &&
    'destination' in body &&
    typeof body.destination === 'string'
      ? body.destination
      : null;
  const schemaVersion =
    body &&
    typeof body === 'object' &&
    'schema_version' in body &&
    typeof body.schema_version === 'string'
      ? body.schema_version
      : null;
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(body).slice(0, 4096))
  );
  const payloadHash = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_dlq_records
       (dlq_id, event_key, destination, schema_version, reason, attempt_count, payload_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      key,
      destination,
      schemaVersion,
      reason.slice(0, 256),
      attempts,
      payloadHash,
      new Date().toISOString()
    )
    .run();
}

export async function claimDelivery(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  owner = crypto.randomUUID()
): Promise<DeliveryLease | null> {
  const now = new Date().toISOString();
  const deadline = timestampAfter(60);
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = 'sending', lease_until = ?, lease_deadline = ?, lease_owner = ?,
           fencing_token = fencing_token + 1, attempt_count = attempt_count + 1, updated_at = ?
       WHERE event_key = ? AND destination = ?
         AND state IN ('pending', 'retryable')
         AND (lease_deadline IS NULL OR lease_deadline < ?)`
  )
    .bind(deadline, deadline, owner, now, eventKey, destination, now)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  const row = await env.TRACKING_DB.prepare(
    `SELECT fencing_token, lease_deadline FROM tracking_deliveries
       WHERE event_key = ? AND destination = ? AND state = 'sending' AND lease_owner = ?`
  )
    .bind(eventKey, destination, owner)
    .first<{ fencing_token: number; lease_deadline: string }>();
  return row
    ? { owner, fencingToken: Number(row.fencing_token), deadline: row.lease_deadline }
    : null;
}

export async function completeDelivered(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  lease: DeliveryLease
): Promise<boolean> {
  const now = new Date().toISOString();
  const completed = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = 'delivered', lease_until = NULL, lease_deadline = NULL, lease_owner = NULL,
           outcome = 'delivered', updated_at = ?
       WHERE event_key = ? AND destination = ? AND state = 'sending'
         AND lease_owner = ? AND fencing_token = ?`
  )
    .bind(now, eventKey, destination, lease.owner, lease.fencingToken)
    .run();
  if ((completed.meta?.changes ?? 0) !== 1) return false;
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_outbox SET state = 'delivered', updated_at = ?
       WHERE event_key = ?
         AND NOT EXISTS (SELECT 1 FROM tracking_deliveries WHERE event_key = ? AND state NOT IN ('delivered', 'permanent'))`
  )
    .bind(now, eventKey, eventKey)
    .run();
  return true;
}

async function prepareDestinationPayload(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  lease: DeliveryLease,
  payload: string
): Promise<boolean> {
  const payloadHash = await digest(payload);
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET destination_payload_hash = ?, transform_version = '1',
           transform_metadata_json = '{}', updated_at = ?
       WHERE event_key = ? AND destination = ? AND state = 'sending'
         AND lease_owner = ? AND fencing_token = ?
         AND (destination_payload_hash = '' OR destination_payload_hash = ?)`
  )
    .bind(
      payloadHash,
      new Date().toISOString(),
      eventKey,
      destination,
      lease.owner,
      lease.fencingToken,
      payloadHash
    )
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function pauseDelivery(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  lease: DeliveryLease,
  reason: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = 'paused', lease_until = NULL, lease_deadline = NULL, lease_owner = NULL,
           outcome = 'paused', last_error = ?, updated_at = ?
       WHERE event_key = ? AND destination = ? AND state = 'sending'
         AND lease_owner = ? AND fencing_token = ?`
  )
    .bind(reason, now, eventKey, destination, lease.owner, lease.fencingToken)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return false;
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_outbox SET state = 'paused', updated_at = ? WHERE event_key = ?`
  )
    .bind(now, eventKey)
    .run();
  return true;
}

async function suppressDelivery(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  lease: DeliveryLease,
  reason: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = 'suppressed', lease_until = NULL, lease_deadline = NULL, lease_owner = NULL,
           outcome = 'suppressed', last_error = ?, updated_at = ?
       WHERE event_key = ? AND destination = ? AND state = 'sending'
         AND lease_owner = ? AND fencing_token = ?`
  )
    .bind(reason, now, eventKey, destination, lease.owner, lease.fencingToken)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return false;
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_outbox SET state = 'suppressed', last_error = ?, updated_at = ?
       WHERE event_key = ?`
  )
    .bind(reason, now, eventKey)
    .run();
  return true;
}

async function privacySuppressionReason(
  env: QueueEnv,
  tenantId: string,
  siteId: string,
  privacySubjectId: string | null,
  destination: DestinationName
): Promise<string | null> {
  if (!privacySubjectId) return null;
  const tombstone = await env.TRACKING_DB.prepare(
    `SELECT reason FROM tracking_suppression_tombstones
       WHERE tenant_id = ? AND site_id = ? AND visitor_id = ? LIMIT 1`
  )
    .bind(tenantId, siteId, privacySubjectId)
    .first<{ reason: string }>();
  if (tombstone) return 'privacy_tombstone';
  const purpose = destination === 'meta' ? 'advertising' : 'analytics';
  const choice = await env.TRACKING_DB.prepare(
    `SELECT choice FROM tracking_privacy_choices
       WHERE tenant_id = ? AND site_id = ? AND visitor_id = ? AND purpose = ?
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY effective_at DESC LIMIT 1`
  )
    .bind(tenantId, siteId, privacySubjectId, purpose, new Date().toISOString())
    .first<{ choice: string }>();
  return choice?.choice === 'allow' ? null : 'privacy_not_allowed';
}

async function durablePauseReason(
  env: QueueEnv,
  tenantId: string,
  siteId: string,
  destination: DestinationName,
  funnelId: string | null
): Promise<string | null> {
  const row = await env.TRACKING_DB.prepare(
    `SELECT reason FROM tracking_runtime_controls
       WHERE tenant_id = ? AND site_id = ? AND paused = 1
         AND (destination IS NULL OR destination = ?)
         AND (funnel_id IS NULL OR funnel_id = ?)
       ORDER BY funnel_id IS NOT NULL DESC, destination IS NOT NULL DESC LIMIT 1`
  )
    .bind(tenantId, siteId, destination, funnelId)
    .first<{ reason: string }>();
  return row?.reason ?? null;
}

async function markFailure(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  outcome: 'retryable' | 'permanent' | 'outcome_unknown',
  error: unknown,
  lease?: DeliveryLease
): Promise<boolean> {
  const now = new Date().toISOString();
  const message = redactError(error);
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = ?, lease_until = NULL, lease_deadline = NULL, lease_owner = NULL,
           outcome = ?, last_error = ?, updated_at = ?
       WHERE event_key = ? AND destination = ?
         ${lease ? "AND state = 'sending' AND lease_owner = ? AND fencing_token = ?" : ''}`
  )
    .bind(
      outcome,
      outcome,
      message,
      now,
      eventKey,
      destination,
      ...(lease ? [lease.owner, lease.fencingToken] : [])
    )
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return false;
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_outbox SET state = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE event_key = ?`
  )
    .bind(outcome, timestampAfter(outcome === 'permanent' ? 3600 : 30), message, now, eventKey)
    .run();
  return true;
}

async function processMessage(env: QueueEnv, message: QueueMessage, isDlq: boolean): Promise<void> {
  const body = message.body as Partial<TrackingQueueMessage>;
  const attempts = Number.isSafeInteger(message.attempts) ? Number(message.attempts) : 1;
  const eventKey = safeEventKey(body?.event_key);
  const destination = body?.destination;
  if (
    body?.schema_version !== '1' ||
    !eventKey ||
    (destination !== 'meta' && destination !== 'tinybird')
  ) {
    await persistDlq(env, body, 'invalid_queue_message', attempts);
    message.ack();
    return;
  }
  if (isDlq) {
    await persistDlq(env, body, 'dlq_replayed', attempts);
    message.ack();
    return;
  }
  if (attempts > MAX_RETRIES) {
    await persistDlq(env, body, 'max_retries_exhausted', attempts);
    await markFailure(env, eventKey, destination, 'permanent', new Error('max_retries_exhausted'));
    message.ack();
    return;
  }
  const deliveryLease = await claimDelivery(env, eventKey, destination);
  if (!deliveryLease) {
    message.ack();
    return;
  }
  const row = await env.TRACKING_DB.prepare(
    `SELECT e.envelope_json, e.privacy_subject_id, d.tenant_id, d.site_id
       FROM tracking_events e JOIN tracking_deliveries d ON d.event_key = e.event_key
       WHERE e.event_key = ? AND d.destination = ? LIMIT 1`
  )
    .bind(eventKey, destination)
    .first<{
      envelope_json: string;
      privacy_subject_id: string | null;
      tenant_id: string;
      site_id: string;
    }>();
  if (!row) {
    await persistDlq(env, body, 'event_not_found', attempts);
    await markFailure(
      env,
      eventKey,
      destination,
      'permanent',
      new Error('event_not_found'),
      deliveryLease
    );
    message.ack();
    return;
  }
  const sender = env.DESTINATION_SENDERS?.[destination];
  const event = JSON.parse(row.envelope_json) as Record<string, unknown>;
  const identity =
    event.identity && typeof event.identity === 'object'
      ? (event.identity as Record<string, unknown>)
      : {};
  const funnelId = typeof identity.funnel_id === 'string' ? identity.funnel_id : null;
  const privacySuppression = await privacySuppressionReason(
    env,
    row.tenant_id,
    row.site_id,
    row.privacy_subject_id,
    destination
  );
  if (privacySuppression) {
    if (await suppressDelivery(env, eventKey, destination, deliveryLease, privacySuppression))
      message.ack();
    return;
  }
  const durablePause = await durablePauseReason(
    env,
    row.tenant_id,
    row.site_id,
    destination,
    funnelId
  );
  if (
    durablePause ||
    env.TRACKING_KILL_SWITCH === true ||
    env.TRACKING_KILL_SWITCH === 'true' ||
    env.TRACKING_DESTINATION_KILL_SWITCH === true ||
    env.TRACKING_DESTINATION_KILL_SWITCH === 'true'
  ) {
    if (
      await pauseDelivery(
        env,
        eventKey,
        destination,
        deliveryLease,
        durablePause ? 'durable_kill_switch' : 'destination_kill_switch'
      )
    )
      message.ack();
    return;
  }
  if (!sender) {
    await markFailure(
      env,
      eventKey,
      destination,
      'retryable',
      new Error('destination_unconfigured'),
      deliveryLease
    );
    message.retry({ delaySeconds: 30 });
    return;
  }
  if (
    !(await prepareDestinationPayload(env, eventKey, destination, deliveryLease, row.envelope_json))
  ) {
    await markFailure(
      env,
      eventKey,
      destination,
      'outcome_unknown',
      new Error('destination_payload_hash_mismatch'),
      deliveryLease
    );
    message.ack();
    return;
  }
  try {
    await sender(event, { eventKey, destination });
    if (await completeDelivered(env, eventKey, destination, deliveryLease)) message.ack();
  } catch (error) {
    const ambiguous = error instanceof Error && /ambiguous|timeout|network/i.test(error.message);
    await markFailure(
      env,
      eventKey,
      destination,
      ambiguous ? 'outcome_unknown' : 'retryable',
      error,
      deliveryLease
    );
    if (ambiguous) {
      message.ack();
    } else if (attempts >= MAX_RETRIES) {
      await persistDlq(env, body, 'max_retries_exhausted', attempts);
      message.ack();
    } else {
      message.retry({ delaySeconds: Math.min(300, 2 ** attempts * 5) });
    }
  }
}

export async function processQueue(batch: QueueBatch, env: QueueEnv): Promise<void> {
  const isDlq = Boolean(env.EVENTS_DLQ_NAME && batch.queue === env.EVENTS_DLQ_NAME);
  for (const message of batch.messages.slice(0, 100)) await processMessage(env, message, isDlq);
}

export { persistDlq };
