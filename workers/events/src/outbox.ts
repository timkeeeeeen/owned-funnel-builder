import type { CanonicalEvent, DestinationName } from '../../../functions/_lib/tracking-contract.ts';
import { validateCanonicalEvent } from '../../../functions/_lib/tracking-contract.ts';
import type { D1Database, D1PreparedStatement } from '../../../functions/_lib/runtime.ts';
import type { PrivacyState } from './privacy.ts';
import { allows, privacySnapshot } from './privacy.ts';
import { redactError } from './observability.ts';

export type TrackingQueueMessage = {
  event_key: string;
  destination: DestinationName;
  schema_version: '1';
};

export type QueueLike = { send(message: TrackingQueueMessage): Promise<void> };

export type PersistResult = {
  eventKey: string;
  accepted: boolean;
  suppressed: boolean;
  destinations: DestinationName[];
};

export type OutboxEnv = Record<string, unknown> & {
  TRACKING_DB: D1Database;
  EVENTS_QUEUE?: QueueLike;
};

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function eventKey(event: CanonicalEvent): Promise<string> {
  return digest([event.tenant_id, event.site_id, event.event_name, event.event_id].join('\u0000'));
}

function statement(
  database: D1Database,
  sql: string,
  values: Array<string | number | null>
): D1PreparedStatement {
  return database.prepare(sql).bind(...values);
}

function destinations(event: CanonicalEvent, privacy: PrivacyState): DestinationName[] {
  const result: DestinationName[] = [];
  if (allows(privacy, 'advertising')) result.push('meta');
  if (allows(privacy, 'analytics')) result.push('tinybird');
  return result;
}

function destinationKillSwitch(env: Record<string, unknown>): boolean {
  return (
    env.TRACKING_KILL_SWITCH === true ||
    env.TRACKING_KILL_SWITCH === 'true' ||
    env.TRACKING_DESTINATION_KILL_SWITCH === true ||
    env.TRACKING_DESTINATION_KILL_SWITCH === 'true'
  );
}

export async function persistCanonicalEvent(
  env: OutboxEnv,
  input: unknown,
  privacy: PrivacyState,
  now = new Date()
): Promise<PersistResult> {
  const event = validateCanonicalEvent(input);
  if (
    event.tenant_id !== String(env.TRACKING_TENANT_ID ?? '') ||
    event.site_id !== String(env.TRACKING_SITE_ID ?? '')
  ) {
    throw new TypeError('event_scope_mismatch');
  }
  const key = await eventKey(event);
  const selected = destinationKillSwitch(env) ? [] : destinations(event, privacy);
  const suppressed = selected.length === 0 || !allows(privacy, 'advertising');
  const timestamp = now.toISOString();
  const database = env.TRACKING_DB;
  const payload = JSON.stringify({ ...event, privacy: privacySnapshot(privacy) });
  const existing = await database
    .prepare('SELECT event_key FROM tracking_events WHERE event_key = ? LIMIT 1')
    .bind(key)
    .first<{ event_key: string }>();
  if (existing) return { eventKey: key, accepted: true, suppressed, destinations: selected };
  const statements: D1PreparedStatement[] = [
    statement(
      database,
      `INSERT INTO tracking_events
       (event_key, tenant_id, site_id, event_name, event_id, source_system, occurred_at,
        received_at, envelope_json, privacy_state_json, bot_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO NOTHING`,
      [
        key,
        event.tenant_id,
        event.site_id,
        event.event_name,
        event.event_id,
        event.source_system,
        event.occurred_at,
        timestamp,
        payload,
        JSON.stringify(privacySnapshot(privacy)),
        'unknown',
        timestamp,
      ]
    ),
    statement(
      database,
      `INSERT INTO tracking_outbox
       (event_key, state, next_attempt_at, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(event_key) DO NOTHING`,
      [key, selected.length ? 'pending' : 'suppressed', timestamp, timestamp, timestamp]
    ),
    ...selected.map((destination) =>
      statement(
        database,
        `INSERT INTO tracking_deliveries
         (delivery_key, tenant_id, site_id, event_key, destination, state,
          attempt_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
         ON CONFLICT(event_key, destination) DO NOTHING`,
        [
          `${key}:${destination}`,
          event.tenant_id,
          event.site_id,
          key,
          destination,
          timestamp,
          timestamp,
        ]
      )
    ),
  ];
  const results = await database.batch(statements);
  if (!results[0]?.success || !results[1]?.success) throw new Error('tracking_event_write_failed');
  if (env.EVENTS_QUEUE && selected.length) {
    await Promise.all(
      selected.map(async (destination) => {
        try {
          await env.EVENTS_QUEUE!.send({ event_key: key, destination, schema_version: '1' });
        } catch (error) {
          console.warn(redactError(error));
        }
      })
    );
  }
  return { eventKey: key, accepted: true, suppressed, destinations: selected };
}

export async function enqueueDueOutbox(env: OutboxEnv, limit = 100): Promise<number> {
  const queue = env.EVENTS_QUEUE;
  if (!queue) return 0;
  const rows = await env.TRACKING_DB.prepare(
    `SELECT d.event_key, d.destination
       FROM tracking_deliveries d
       JOIN tracking_outbox o ON o.event_key = d.event_key
       WHERE d.state IN ('pending', 'retryable') AND o.next_attempt_at <= ?
       ORDER BY o.next_attempt_at ASC LIMIT ?`
  )
    .bind(new Date().toISOString(), Math.min(Math.max(limit, 1), 500))
    .all<{ event_key: string; destination: DestinationName }>();
  let count = 0;
  for (const row of rows.results ?? []) {
    await queue.send({
      event_key: row.event_key,
      destination: row.destination,
      schema_version: '1',
    });
    count += 1;
  }
  return count;
}

export function safeEventKey(value: unknown): string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '';
}
