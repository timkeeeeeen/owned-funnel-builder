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
  payload: Record<string, unknown>,
  context: { eventKey: string; destination: DestinationName }
) => Promise<unknown>;
export type DestinationTransform = (
  event: Record<string, unknown>
) => Record<string, unknown> | Promise<Record<string, unknown>>;
export type QueueEnv = Record<string, unknown> & {
  TRACKING_DB: D1Database;
  EVENTS_DLQ?: { send(message: TrackingQueueMessage): Promise<void> };
  DESTINATION_SENDERS?: Partial<Record<DestinationName, DestinationSender>>;
  DESTINATION_TRANSFORMS?: Partial<Record<DestinationName, DestinationTransform>>;
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
         AND state IN ('pending', 'retryable', 'replay_pending')
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
  payload: string,
  transformVersion: string
): Promise<boolean> {
  const payloadHash = await digest(payload);
  const result = await env.TRACKING_DB.prepare(
    `UPDATE tracking_deliveries
       SET destination_payload_hash = ?, transform_version = ?,
           transform_metadata_json = ?, updated_at = ?
       WHERE event_key = ? AND destination = ? AND state = 'sending'
         AND lease_owner = ? AND fencing_token = ?
         AND (destination_payload_hash = '' OR destination_payload_hash = ?)`
  )
    .bind(
      payloadHash,
      transformVersion,
      JSON.stringify({ destination, transform_version: transformVersion }),
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
  const now = new Date().toISOString();
  const policyVersion =
    typeof env.TRACKING_POLICY_VERSION === 'string' ? env.TRACKING_POLICY_VERSION : '';
  const region = typeof env.TRACKING_REGION === 'string' ? env.TRACKING_REGION : '';
  if (destination === 'meta') {
    const gpc = await env.TRACKING_DB.prepare(
      `SELECT 1 AS found FROM tracking_privacy_choices
       WHERE tenant_id = ? AND site_id = ? AND visitor_id = ?
         AND purpose = 'sale_share' AND choice = 'deny' AND source = 'gpc'
         AND policy_version = ? AND region_source = ?
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY effective_at DESC LIMIT 1`
    )
      .bind(tenantId, siteId, privacySubjectId, policyVersion, region, now)
      .first();
    if (gpc) return 'gpc_blocks_advertising';
  }
  const purpose = destination === 'meta' ? 'advertising' : 'analytics';
  const choice = await env.TRACKING_DB.prepare(
    `SELECT choice FROM tracking_privacy_choices
       WHERE tenant_id = ? AND site_id = ? AND visitor_id = ? AND purpose = ?
         AND policy_version = ? AND region_source = ?
         AND (expires_at IS NULL OR expires_at > ?)
         AND choice_key NOT IN (
           SELECT supersedes_choice_key FROM tracking_privacy_choices
           WHERE tenant_id = ? AND site_id = ? AND visitor_id = ?
             AND supersedes_choice_key IS NOT NULL)
       ORDER BY effective_at DESC LIMIT 1`
  )
    .bind(
      tenantId,
      siteId,
      privacySubjectId,
      purpose,
      policyVersion,
      region,
      now,
      tenantId,
      siteId,
      privacySubjectId
    )
    .first<{ choice: string }>();
  return choice?.choice === 'allow' ? null : 'privacy_not_allowed';
}

function positiveInteger(env: QueueEnv, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function consumeBudget(
  env: QueueEnv,
  bucketKey: string,
  limit: number,
  amount = 1,
  windowSeconds = 60
): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds;
  const result = await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_delivery_budgets
       (bucket_key, window_start, used, budget_limit, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bucket_key, window_start) DO UPDATE SET
         used = used + excluded.used, budget_limit = excluded.budget_limit,
         updated_at = excluded.updated_at
       WHERE used + excluded.used <= excluded.budget_limit`
  )
    .bind(bucketKey, windowStart, amount, limit, new Date(now).toISOString())
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function deliveryBudgetReason(
  env: QueueEnv,
  eventKey: string,
  destination: DestinationName
): Promise<string | null> {
  const checks: Array<[string, number, number]> = [
    ['queue:global', positiveInteger(env, 'TRACKING_QUEUE_BUDGET_PER_MINUTE', 10_000), 1],
    [
      `event:${eventKey}:${destination}`,
      positiveInteger(env, 'TRACKING_EVENT_DELIVERY_BUDGET', 5),
      1,
    ],
  ];
  if (destination === 'meta') {
    checks.push(
      ['destination:meta', positiveInteger(env, 'TRACKING_META_BUDGET_PER_MINUTE', 5_000), 1],
      [
        'spend:meta',
        positiveInteger(env, 'TRACKING_META_SPEND_LIMIT_MICROS_PER_MINUTE', 1_000_000_000),
        positiveInteger(env, 'TRACKING_META_EVENT_COST_MICROS', 1),
      ]
    );
  }
  for (const [key, limit, amount] of checks) {
    if (!(await consumeBudget(env, key, limit, amount))) return `${key}_budget_exhausted`;
  }
  return null;
}

function funnelSenderEnabled(
  env: QueueEnv,
  funnelId: string | null,
  destination: DestinationName
): boolean {
  if (!funnelId) return true;
  const raw = env.TRACKING_FUNNEL_SENDER_MANIFEST;
  let manifest: unknown = raw;
  try {
    if (typeof raw === 'string') manifest = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!manifest || typeof manifest !== 'object') return false;
  const funnels = (manifest as { funnels?: unknown }).funnels;
  if (!funnels || typeof funnels !== 'object') return false;
  const funnel = (funnels as Record<string, unknown>)[funnelId];
  return Boolean(
    funnel &&
    typeof funnel === 'object' &&
    (funnel as Record<string, unknown>)[destination] === true
  );
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
  if (!funnelSenderEnabled(env, funnelId, destination)) {
    if (await pauseDelivery(env, eventKey, destination, deliveryLease, 'funnel_sender_disabled'))
      message.ack();
    return;
  }
  const budgetReason = await deliveryBudgetReason(env, eventKey, destination);
  if (budgetReason) {
    if (await pauseDelivery(env, eventKey, destination, deliveryLease, budgetReason)) message.ack();
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
  const transform = env.DESTINATION_TRANSFORMS?.[destination];
  const transformedPayload = transform ? await transform(event) : event;
  const serializedPayload = JSON.stringify(transformedPayload);
  const transformVersion =
    typeof env.TRACKING_DESTINATION_TRANSFORM_VERSION === 'string'
      ? env.TRACKING_DESTINATION_TRANSFORM_VERSION
      : '1';
  if (
    !(await prepareDestinationPayload(
      env,
      eventKey,
      destination,
      deliveryLease,
      serializedPayload,
      transformVersion
    ))
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
  const finalPrivacySuppression = await privacySuppressionReason(
    env,
    row.tenant_id,
    row.site_id,
    row.privacy_subject_id,
    destination
  );
  if (finalPrivacySuppression) {
    if (await suppressDelivery(env, eventKey, destination, deliveryLease, finalPrivacySuppression))
      message.ack();
    return;
  }
  const finalPause = await durablePauseReason(
    env,
    row.tenant_id,
    row.site_id,
    destination,
    funnelId
  );
  if (finalPause || !funnelSenderEnabled(env, funnelId, destination)) {
    if (
      await pauseDelivery(
        env,
        eventKey,
        destination,
        deliveryLease,
        finalPause ? 'durable_kill_switch' : 'funnel_sender_disabled'
      )
    )
      message.ack();
    return;
  }
  try {
    await sender(transformedPayload, { eventKey, destination });
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
