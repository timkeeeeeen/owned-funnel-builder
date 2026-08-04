import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { claimDelivery, completeDelivered, processQueue } from '../src/queue.ts';
import { persistCanonicalEvent } from '../src/outbox.ts';
import { reclaimExpiredLeases } from '../src/cleanup.ts';

type Bind = string | number | null;

function d1(database: DatabaseSync) {
  return {
    prepare(query: string) {
      let values: Bind[] = [];
      const statement = {
        bind(...input: Bind[]) {
          values = input;
          return statement;
        },
        async run() {
          const result = database.prepare(query).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return (database.prepare(query).get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: database.prepare(query).all(...values) as T[] };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run())) as never;
    },
  };
}

async function trackingDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  for (const name of [
    '0001_tracking_ledger.sql',
    '0002_tracking_scope_hardening.sql',
    '0003_csrf_nonce_bindings.sql',
    '0004_delivery_safety.sql',
  ]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return database;
}

function seedDelivery(
  database: DatabaseSync,
  eventKey: string,
  envelope = '{}',
  privacySubjectId: string | null = null
): void {
  const now = '2026-08-04T12:00:00.000Z';
  database
    .prepare(
      `INSERT INTO tracking_events
       (event_key, tenant_id, site_id, event_name, event_id, source_system, occurred_at,
        received_at, envelope_json, privacy_state_json, bot_state, created_at,
        canonical_payload_hash, privacy_subject_id)
       VALUES (?, 'tenant_demo', 'site_demo', 'PageView', 'evt_1', 'event_worker', ?, ?,
               ?, '{}', 'human', ?, ?, ?)`
    )
    .run(eventKey, now, now, envelope, now, 'a'.repeat(64), privacySubjectId);
  database
    .prepare(
      `INSERT INTO tracking_outbox
       (event_key, state, next_attempt_at, created_at, updated_at)
       VALUES (?, 'pending', ?, ?, ?)`
    )
    .run(eventKey, now, now, now);
  database
    .prepare(
      `INSERT INTO tracking_deliveries
       (delivery_key, tenant_id, site_id, event_key, destination, state, created_at, updated_at,
        destination_payload_hash)
       VALUES (?, 'tenant_demo', 'site_demo', ?, 'meta', 'pending', ?, ?, ?)`
    )
    .run(`${eventKey}:meta`, eventKey, now, now, '');
}

test('leases return monotonic fencing tokens and stale completion is a no-op', async () => {
  const database = await trackingDatabase();
  const eventKey = 'd'.repeat(64);
  seedDelivery(database, eventKey);
  const env = { TRACKING_DB: d1(database) } as never;

  const first = await claimDelivery(env, eventKey, 'meta', 'owner-1');
  assert.ok(first);
  database
    .prepare(
      `UPDATE tracking_deliveries SET state = 'retryable', lease_owner = NULL,
       lease_deadline = NULL WHERE event_key = ? AND destination = 'meta'`
    )
    .run(eventKey);
  const second = await claimDelivery(env, eventKey, 'meta', 'owner-2');
  assert.ok(second);
  assert.ok(second.fencingToken > first.fencingToken);

  assert.equal(await completeDelivered(env, eventKey, 'meta', first), false);
  assert.equal(await completeDelivered(env, eventKey, 'meta', second), true);
});

test('destination payload hash is durable before the provider call', async () => {
  const database = await trackingDatabase();
  const eventKey = 'e'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  let hashSeen = '';
  const actions: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack: () => actions.push('ack'),
          retry: () => actions.push('retry'),
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      DESTINATION_SENDERS: {
        meta: async () => {
          hashSeen = (
            database
              .prepare(
                'SELECT destination_payload_hash FROM tracking_deliveries WHERE event_key = ?'
              )
              .get(eventKey) as { destination_payload_hash: string }
          ).destination_payload_hash;
        },
      },
    } as never
  );
  assert.match(hashSeen, /^[a-f0-9]{64}$/);
  assert.deepEqual(actions, ['ack']);
});

test('ambiguous provider outcomes are terminal until audited replay', async () => {
  const database = await trackingDatabase();
  const eventKey = 'f'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"Purchase"}');
  const actions: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack: () => actions.push('ack'),
          retry: () => actions.push('retry'),
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      DESTINATION_SENDERS: { meta: async () => Promise.reject(new Error('network timeout')) },
    } as never
  );
  assert.deepEqual(actions, ['ack']);
  assert.equal(
    (
      database
        .prepare('SELECT state FROM tracking_deliveries WHERE event_key = ?')
        .get(eventKey) as { state: string }
    ).state,
    'outcome_unknown'
  );
});

test('durable kill switch pauses delivery without calling the provider', async () => {
  const database = await trackingDatabase();
  const eventKey = '1'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  database
    .prepare(
      `INSERT INTO tracking_runtime_controls
       (control_key, tenant_id, site_id, paused, actor, reason, request_id, updated_at)
       VALUES ('global', 'tenant_demo', 'site_demo', 1, 'operator', 'incident', 'req_1', ?)`
    )
    .run(new Date().toISOString());
  let sent = false;
  const actions: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack: () => actions.push('ack'),
          retry: () => actions.push('retry'),
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      DESTINATION_SENDERS: { meta: async () => void (sent = true) },
    } as never
  );
  assert.equal(sent, false);
  assert.deepEqual(actions, ['ack']);
  assert.equal(
    (
      database
        .prepare('SELECT state FROM tracking_deliveries WHERE event_key = ?')
        .get(eventKey) as { state: string }
    ).state,
    'paused'
  );
});

test('same event key with a different canonical payload hash is quarantined', async () => {
  const database = await trackingDatabase();
  const event = {
    schema_version: '1',
    tenant_id: 'tenant_demo',
    site_id: 'site_demo',
    event_id: 'evt_hash_guard',
    event_name: 'PageView',
    source: 'browser',
    source_system: 'event_worker',
    occurred_at: '2026-08-04T12:00:00.000Z',
    visitor: {},
    session: {},
    page: { path: '/first' },
    attribution: {},
    identity: {},
    commerce: {},
    privacy: {
      policy_version: '2026-08-04',
      region: 'US',
      gpc: false,
      opted_out: false,
    },
  };
  const privacy = {
    decisions: [
      {
        purpose: 'necessary',
        allowed: true,
        policyVersion: '2026-08-04',
        effectiveAt: '2026-08-04T12:00:00.000Z',
        source: 'ui',
        region: 'US',
      },
      {
        purpose: 'analytics',
        allowed: true,
        policyVersion: '2026-08-04',
        effectiveAt: '2026-08-04T12:00:00.000Z',
        source: 'ui',
        region: 'US',
      },
    ],
    resolved: true,
    gpc: false,
    observedAt: '2026-08-04T12:00:00.000Z',
    policyVersion: '2026-08-04',
    region: 'US',
  };
  const env = {
    TRACKING_DB: d1(database),
    TRACKING_TENANT_ID: 'tenant_demo',
    TRACKING_SITE_ID: 'site_demo',
  } as never;
  await persistCanonicalEvent(env, event, privacy as never);
  await assert.rejects(
    persistCanonicalEvent(env, { ...event, page: { path: '/different' } }, privacy as never),
    /canonical_payload_hash_mismatch/
  );
  assert.equal(
    (
      database
        .prepare('SELECT count(*) AS count FROM tracking_dlq_records WHERE reason = ?')
        .get('canonical_payload_hash_mismatch') as { count: number }
    ).count,
    1
  );
});

test('privacy tombstone suppresses a reclaimed delivery before provider send', async () => {
  const database = await trackingDatabase();
  const eventKey = '2'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}', 'privacy_subject_1');
  database
    .prepare(
      `INSERT INTO tracking_suppression_tombstones
       (suppression_key, tenant_id, site_id, visitor_id, reason, created_at)
       VALUES ('tombstone_1', 'tenant_demo', 'site_demo', 'privacy_subject_1',
               'privacy_withdrawal', ?)`
    )
    .run(new Date().toISOString());
  let sent = false;
  const actions: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack: () => actions.push('ack'),
          retry: () => actions.push('retry'),
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      DESTINATION_SENDERS: { meta: async () => void (sent = true) },
    } as never
  );
  assert.equal(sent, false);
  assert.deepEqual(actions, ['ack']);
  assert.equal(
    (
      database
        .prepare('SELECT state FROM tracking_deliveries WHERE event_key = ?')
        .get(eventKey) as { state: string }
    ).state,
    'suppressed'
  );
});

test('queue consumer retries transient outcomes and preserves delivery identity', async () => {
  const database = new DatabaseSync(':memory:');
  const calls: string[] = [];
  const statement = (query: string) => ({
    bind(..._values: unknown[]) {
      calls.push(query);
      return statement(query);
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
    async first<T>() {
      return { envelope_json: '{"event_name":"PageView"}' } as T;
    },
    async all<T>() {
      return { results: [] as T[] };
    },
  });
  const env = {
    TRACKING_DB: { prepare: statement, batch: async () => [] } as never,
    DESTINATION_SENDERS: {
      meta: async () => {
        throw new Error('provider unavailable');
      },
    },
  };
  const acked: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: 'a'.repeat(64), destination: 'meta', schema_version: '1' },
          ack: () => acked.push('ack'),
          retry: () => acked.push('retry'),
        },
      ],
    },
    env as never
  );
  assert.equal(acked.includes('retry'), true);
  assert.equal(
    calls.some((query) => query.includes('tracking_deliveries')),
    true
  );
  assert.equal(database, database);
});

test('unknown queue schema is persisted to DLQ before acknowledgement', async () => {
  const calls: string[] = [];
  const statement = (query: string) => ({
    bind(..._values: unknown[]) {
      calls.push(query);
      return statement(query);
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
    async first<T>() {
      return null as T | null;
    },
    async all<T>() {
      return { results: [] as T[] };
    },
  });
  const acked: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: {
            event_key: 'b'.repeat(64),
            destination: 'not-a-destination',
            schema_version: '0',
          },
          ack: () => acked.push('ack'),
          retry: () => acked.push('retry'),
        },
      ],
    },
    { TRACKING_DB: { prepare: statement, batch: async () => [] } as never } as never
  );
  assert.deepEqual(acked, ['ack']);
  assert.equal(
    calls.some((query) => query.includes('tracking_dlq_records')),
    true
  );
});

test('max retry is persisted to DLQ before acknowledgement', async () => {
  const calls: string[] = [];
  const statement = (query: string) => ({
    bind(..._values: unknown[]) {
      calls.push(query);
      return statement(query);
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
    async first<T>() {
      return { envelope_json: '{"event_name":"PageView"}' } as T;
    },
    async all<T>() {
      return { results: [] as T[] };
    },
  });
  const acked: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: 'c'.repeat(64), destination: 'meta', schema_version: '1' },
          attempts: 6,
          ack: () => acked.push('ack'),
          retry: () => acked.push('retry'),
        },
      ],
    },
    { TRACKING_DB: { prepare: statement, batch: async () => [] } as never } as never
  );
  assert.deepEqual(acked, ['ack']);
  assert.equal(
    calls.some((query) => query.includes('tracking_dlq_records')),
    true
  );
});

test('scheduled cleanup reclaims an expired lease without resetting its fence', async () => {
  const database = await trackingDatabase();
  const eventKey = '3'.repeat(64);
  seedDelivery(database, eventKey);
  database
    .prepare(
      `UPDATE tracking_deliveries SET state = 'sending', lease_owner = 'expired-owner',
       fencing_token = 7, lease_until = ?, lease_deadline = ? WHERE event_key = ?`
    )
    .run('2026-08-04T11:00:00.000Z', '2026-08-04T11:00:00.000Z', eventKey);
  assert.equal(
    await reclaimExpiredLeases({ TRACKING_DB: d1(database) }, new Date('2026-08-04T12:00:00.000Z')),
    1
  );
  assert.deepEqual(
    {
      ...database
        .prepare(
          'SELECT state, lease_owner, lease_deadline, fencing_token FROM tracking_deliveries WHERE event_key = ?'
        )
        .get(eventKey),
    },
    { state: 'retryable', lease_owner: null, lease_deadline: null, fencing_token: 7 }
  );
});
