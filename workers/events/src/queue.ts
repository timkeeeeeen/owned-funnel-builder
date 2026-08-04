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

function timestampAfter(seconds: number): string {
  return new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();
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

async function lease(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName
): Promise<boolean> {
  const now = new Date().toISOString();
  const leaseUntil = timestampAfter(60);
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = 'sending', lease_until = ?, attempt_count = attempt_count + 1, updated_at = ?
       WHERE event_key = ? AND destination = ?
         AND state IN ('pending', 'retryable')
         AND (lease_until IS NULL OR lease_until < ?)`
  )
    .bind(leaseUntil, now, eventKey, destination, now)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function markDelivered(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName
): Promise<void> {
  const now = new Date().toISOString();
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = 'delivered', lease_until = NULL, outcome = 'delivered', updated_at = ?
       WHERE event_key = ? AND destination = ?`
  )
    .bind(now, eventKey, destination)
    .run();
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_outbox SET state = 'delivered', updated_at = ?
       WHERE event_key = ?
         AND NOT EXISTS (SELECT 1 FROM tracking_deliveries WHERE event_key = ? AND state NOT IN ('delivered', 'permanent'))`
  )
    .bind(now, eventKey, eventKey)
    .run();
}

async function markFailure(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName,
  outcome: 'retryable' | 'permanent' | 'outcome_unknown',
  error: unknown
): Promise<void> {
  const now = new Date().toISOString();
  const message = redactError(error);
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET state = ?, lease_until = NULL, outcome = ?, last_error = ?, updated_at = ?
       WHERE event_key = ? AND destination = ?`
  )
    .bind(outcome, outcome, message, now, eventKey, destination)
    .run();
  await env.TRACKING_DB.prepare(
    `UPDATE tracking_outbox SET state = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE event_key = ?`
  )
    .bind(outcome, timestampAfter(outcome === 'permanent' ? 3600 : 30), message, now, eventKey)
    .run();
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
  if (!(await lease(env, eventKey, destination))) {
    message.ack();
    return;
  }
  const row = await env.TRACKING_DB.prepare(
    'SELECT envelope_json FROM tracking_events WHERE event_key = ? LIMIT 1'
  )
    .bind(eventKey)
    .first<{ envelope_json: string }>();
  if (!row) {
    await persistDlq(env, body, 'event_not_found', attempts);
    await markFailure(env, eventKey, destination, 'permanent', new Error('event_not_found'));
    message.ack();
    return;
  }
  const sender = env.DESTINATION_SENDERS?.[destination];
  if (
    env.TRACKING_KILL_SWITCH === true ||
    env.TRACKING_KILL_SWITCH === 'true' ||
    env.TRACKING_DESTINATION_KILL_SWITCH === true ||
    env.TRACKING_DESTINATION_KILL_SWITCH === 'true'
  ) {
    await markFailure(
      env,
      eventKey,
      destination,
      'retryable',
      new Error('destination_kill_switch')
    );
    message.retry({ delaySeconds: 60 });
    return;
  }
  if (!sender) {
    await markFailure(
      env,
      eventKey,
      destination,
      'retryable',
      new Error('destination_unconfigured')
    );
    message.retry({ delaySeconds: 30 });
    return;
  }
  try {
    const event = JSON.parse(row.envelope_json) as Record<string, unknown>;
    await sender(event, { eventKey, destination });
    await markDelivered(env, eventKey, destination);
    message.ack();
  } catch (error) {
    const ambiguous = error instanceof Error && /ambiguous|timeout|network/i.test(error.message);
    await markFailure(
      env,
      eventKey,
      destination,
      ambiguous ? 'outcome_unknown' : 'retryable',
      error
    );
    if (attempts >= MAX_RETRIES) {
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
