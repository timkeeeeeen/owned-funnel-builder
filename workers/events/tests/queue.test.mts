import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { claimDelivery, completeDelivered, processQueue } from '../src/queue.ts';
import { persistCanonicalEvent } from '../src/outbox.ts';
import { reclaimExpiredLeases, runCleanup } from '../src/cleanup.ts';
import worker from '../src/index.ts';
import { REQUIRED_TRACKING_MIGRATIONS } from '../src/safety.ts';

const TEST_MIGRATION_SET_SHA = '5'.repeat(64);
const TEST_RELEASE_SHA = '6'.repeat(40);

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
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results as never;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function trackingDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  for (const name of [
    '0001_tracking_ledger.sql',
    '0002_tracking_scope_hardening.sql',
    '0003_csrf_nonce_bindings.sql',
    '0004_delivery_safety.sql',
    '0005_runtime_safety.sql',
    '0006_waf_capability.sql',
    '0007_context_exchange.sql',
    '0007_privacy_destinations.sql',
    '0008_security_fix_wave.sql',
  ]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return database;
}

function readyRuntime(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO tracking_runtime_release_state
       (state_key, migration_names_json, migration_set_sha, release_sha, lock_state, updated_at)
       VALUES ('active', ?, ?, ?, 'ready', ?)`
    )
    .run(
      JSON.stringify(REQUIRED_TRACKING_MIGRATIONS),
      TEST_MIGRATION_SET_SHA,
      TEST_RELEASE_SHA,
      new Date().toISOString()
    );
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
       VALUES (?, 'tenant_demo', 'site_demo', 'PageView', ?, 'event_worker', ?, ?,
               ?, '{}', 'human', ?, ?, ?)`
    )
    .run(
      eventKey,
      `event:${eventKey.slice(0, 8)}`,
      now,
      now,
      envelope,
      now,
      'a'.repeat(64),
      privacySubjectId
    );
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

test('queue and scheduled handlers fail closed before migration release readback', async () => {
  const database = await trackingDatabase();
  const eventKey = '4'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  let sent = false;
  const env = {
    TRACKING_DB: d1(database),
    DESTINATION_SENDERS: { meta: async () => void (sent = true) },
  } as never;
  await assert.rejects(
    worker.queue(
      {
        queue: 'events',
        messages: [
          {
            body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
            ack() {},
            retry() {},
          },
        ],
      },
      env
    ),
    /tracking_release_binding_missing|tracking_migrations_not_ready/
  );
  await assert.rejects(worker.scheduled({}, env, {}), /tracking_release_binding_missing/);
  assert.equal(sent, false);
});

test('destination payload hash is durable before the provider call', async () => {
  const database = await trackingDatabase();
  const eventKey = 'e'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  let hashSeen = '';
  let transformedSeen = false;
  const transformed = { event_name: 'PageView', provider: 'meta', transformed: true };
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
        meta: async (payload: Record<string, unknown>) => {
          transformedSeen = payload.transformed === true;
          hashSeen = (
            database
              .prepare(
                'SELECT destination_payload_hash FROM tracking_deliveries WHERE event_key = ?'
              )
              .get(eventKey) as { destination_payload_hash: string }
          ).destination_payload_hash;
        },
      },
      DESTINATION_TRANSFORMS: { meta: () => transformed },
    } as never
  );
  assert.equal(transformedSeen, true);
  assert.equal(hashSeen, await sha256(JSON.stringify(transformed)));
  assert.deepEqual(actions, ['ack']);
});

test('current GPC and policy-region choices are re-resolved before Meta send', async () => {
  const database = await trackingDatabase();
  const eventKey = '5'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}', 'privacy_gpc');
  const now = new Date().toISOString();
  const choice = database.prepare(
    `INSERT INTO tracking_privacy_choices
     (choice_key, tenant_id, site_id, visitor_id, purpose, choice, policy_version,
      region_source, source, effective_at, observed_at, expires_at)
     VALUES (?, 'tenant_demo', 'site_demo', 'privacy_gpc', ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  choice.run('choice_allow', 'advertising', 'allow', '2026-08-04', 'US', 'ui', now, now, null);
  choice.run(
    'choice_gpc',
    'sale_share',
    'deny',
    '2026-08-04',
    'US',
    'gpc',
    now,
    now,
    new Date(Date.now() + 60_000).toISOString()
  );
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
      TRACKING_POLICY_VERSION: '2026-08-04',
      TRACKING_REGION: 'US',
      DESTINATION_SENDERS: { meta: async () => void (sent = true) },
    } as never
  );
  assert.equal(sent, false);
  assert.deepEqual(actions, ['ack']);
});

test('queue ignores stale-region grants and honors the unsuperseded current choice', async () => {
  for (const scenario of ['stale_grant', 'superseded_deny'] as const) {
    const database = await trackingDatabase();
    const eventKey = scenario === 'stale_grant' ? 'e'.repeat(64) : 'f'.repeat(64);
    const subject = `privacy_${scenario}`;
    seedDelivery(database, eventKey, '{"event_name":"PageView"}', subject);
    const insert = database.prepare(
      `INSERT INTO tracking_privacy_choices
       (choice_key, tenant_id, site_id, visitor_id, purpose, choice, policy_version,
        region_source, source, supersedes_choice_key, effective_at, observed_at)
       VALUES (?, 'tenant_demo', 'site_demo', ?, 'advertising', ?, ?, ?, 'ui', ?, ?, ?)`
    );
    const early = new Date(Date.now() - 1_000).toISOString();
    const late = new Date().toISOString();
    if (scenario === 'stale_grant') {
      insert.run('current_deny', subject, 'deny', '2026-08-04', 'US', null, early, early);
      insert.run('stale_allow', subject, 'allow', '2026-08-03', 'EU', null, late, late);
    } else {
      insert.run('old_deny', subject, 'deny', '2026-08-04', 'US', null, early, early);
      insert.run('current_allow', subject, 'allow', '2026-08-04', 'US', 'old_deny', late, late);
    }
    let sent = false;
    await processQueue(
      {
        queue: 'events',
        messages: [
          {
            body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
            ack() {},
            retry() {},
          },
        ],
      },
      {
        TRACKING_DB: d1(database),
        TRACKING_POLICY_VERSION: '2026-08-04',
        TRACKING_REGION: 'US',
        DESTINATION_SENDERS: { meta: async () => void (sent = true) },
      } as never
    );
    assert.equal(sent, scenario === 'superseded_deny');
  }
});

test('privacy is re-resolved after transform immediately before provider send', async () => {
  const database = await trackingDatabase();
  const eventKey = '0'.repeat(64);
  const subject = 'privacy_race';
  seedDelivery(database, eventKey, '{"event_name":"PageView"}', subject);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO tracking_privacy_choices
       (choice_key, tenant_id, site_id, visitor_id, purpose, choice, policy_version,
        region_source, source, effective_at, observed_at)
       VALUES ('allow_before_transform', 'tenant_demo', 'site_demo', ?, 'advertising', 'allow',
               '2026-08-04', 'US', 'ui', ?, ?)`
    )
    .run(subject, now, now);
  let sent = false;
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      TRACKING_POLICY_VERSION: '2026-08-04',
      TRACKING_REGION: 'US',
      DESTINATION_TRANSFORMS: {
        meta: async (event: Record<string, unknown>) => {
          database
            .prepare(
              `INSERT INTO tracking_suppression_tombstones
               (suppression_key, tenant_id, site_id, visitor_id, reason, created_at)
               VALUES ('race_tombstone', 'tenant_demo', 'site_demo', ?, 'withdrawal', ?)`
            )
            .run(subject, new Date().toISOString());
          return event;
        },
      },
      DESTINATION_SENDERS: { meta: async () => void (sent = true) },
    } as never
  );
  assert.equal(sent, false);
  assert.equal(
    (
      database
        .prepare('SELECT state FROM tracking_deliveries WHERE event_key = ?')
        .get(eventKey) as { state: string }
    ).state,
    'suppressed'
  );
});

test('per-event delivery budget stops repeated retry cost', async () => {
  const database = await trackingDatabase();
  const eventKey = '6'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  let sends = 0;
  const env = {
    TRACKING_DB: d1(database),
    TRACKING_EVENT_DELIVERY_BUDGET: 1,
    DESTINATION_SENDERS: {
      meta: async () => {
        sends += 1;
        throw new Error('provider unavailable');
      },
    },
  } as never;
  const action = () => {
    const actions: string[] = [];
    return {
      actions,
      run: processQueue(
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
        env
      ),
    };
  };
  const first = action();
  await first.run;
  const second = action();
  await second.run;
  assert.equal(sends, 1);
  assert.deepEqual(first.actions, ['retry']);
  assert.deepEqual(second.actions, ['ack']);
});

test('global Queue, Meta, and spend breakers each bound distinct event cost', async () => {
  for (const limits of [
    { TRACKING_QUEUE_BUDGET_PER_MINUTE: 1 },
    { TRACKING_META_BUDGET_PER_MINUTE: 1 },
    { TRACKING_META_SPEND_LIMIT_MICROS_PER_MINUTE: 1, TRACKING_META_EVENT_COST_MICROS: 1 },
  ]) {
    const database = await trackingDatabase();
    const firstKey = 'b'.repeat(64);
    const secondKey = 'c'.repeat(64);
    seedDelivery(database, firstKey, '{"event_name":"PageView"}');
    seedDelivery(database, secondKey, '{"event_name":"PageView"}');
    let sends = 0;
    const env = {
      TRACKING_DB: d1(database),
      ...limits,
      DESTINATION_SENDERS: { meta: async () => void (sends += 1) },
    } as never;
    for (const eventKey of [firstKey, secondKey]) {
      await processQueue(
        {
          queue: 'events',
          messages: [
            {
              body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
              ack() {},
              retry() {},
            },
          ],
        },
        env
      );
    }
    assert.equal(sends, 1);
  }
});

test('an impossible Meta spend reservation writes no budget rows and never calls the provider', async () => {
  const database = await trackingDatabase();
  const eventKey = 'f'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  let sends = 0;
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      TRACKING_META_SPEND_LIMIT_MICROS_PER_MINUTE: 1,
      TRACKING_META_EVENT_COST_MICROS: 2,
      DESTINATION_SENDERS: { meta: async () => void (sends += 1) },
    } as never
  );
  assert.equal(sends, 0);
  assert.equal(
    (
      database.prepare('SELECT count(*) AS count FROM tracking_delivery_budgets').get() as {
        count: number;
      }
    ).count,
    0
  );
});

test('a later exhausted budget rolls back the complete multi-bucket reservation', async () => {
  const database = await trackingDatabase();
  const eventKey = '1'.repeat(64);
  seedDelivery(database, eventKey, '{"event_name":"PageView"}');
  const now = Date.now();
  const windowStart = Math.floor(now / 60_000) * 60;
  database
    .prepare(
      `INSERT INTO tracking_delivery_budgets
       (bucket_key, window_start, used, budget_limit, updated_at)
       VALUES ('spend:meta', ?, 1, 1, ?)`
    )
    .run(windowStart, new Date(now).toISOString());

  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: eventKey, destination: 'meta', schema_version: '1' },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      TRACKING_DB: d1(database),
      TRACKING_META_SPEND_LIMIT_MICROS_PER_MINUTE: 1,
      TRACKING_META_EVENT_COST_MICROS: 1,
      DESTINATION_SENDERS: { meta: async () => assert.fail('provider must not be called') },
    } as never
  );

  assert.deepEqual(
    database
      .prepare(
        `SELECT bucket_key, used FROM tracking_delivery_budgets
         WHERE window_start = ? ORDER BY bucket_key`
      )
      .all(windowStart)
      .map((row) => ({ ...row })),
    [{ bucket_key: 'spend:meta', used: 1 }]
  );
});

test('an explicitly audited replay_pending delivery can acquire a new fence', async () => {
  const database = await trackingDatabase();
  const eventKey = 'd'.repeat(64);
  seedDelivery(database, eventKey);
  database
    .prepare("UPDATE tracking_deliveries SET state = 'replay_pending' WHERE event_key = ?")
    .run(eventKey);
  const lease = await claimDelivery({ TRACKING_DB: d1(database) } as never, eventKey, 'meta');
  assert.ok(lease);
  assert.equal(lease.fencingToken, 1);
});

test('per-funnel sender manifest is enforced atomically at send time', async () => {
  const database = await trackingDatabase();
  const eventKey = 'a'.repeat(64);
  seedDelivery(
    database,
    eventKey,
    '{"event_name":"Purchase","identity":{"funnel_id":"funnel_disabled"}}'
  );
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
      TRACKING_FUNNEL_SENDER_MANIFEST: JSON.stringify({
        funnels: { funnel_disabled: { meta: false, tinybird: true } },
      }),
      DESTINATION_SENDERS: { meta: async () => void (sent = true) },
    } as never
  );
  assert.equal(sent, false);
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

test('budget cleanup clears a full 1200-row peak minute by default', async () => {
  const database = await trackingDatabase();
  const insert = database.prepare(
    `INSERT INTO tracking_delivery_budgets
     (bucket_key, window_start, used, budget_limit, updated_at)
     VALUES (?, 1, 1, 1, '2020-01-01T00:00:00.000Z')`
  );
  for (let index = 0; index < 1_200; index += 1) insert.run(`peak_budget_${index}`);

  await runCleanup({ TRACKING_DB: d1(database) }, new Date('2026-08-04T12:00:00.000Z'));

  assert.equal(
    (
      database.prepare('SELECT count(*) AS count FROM tracking_delivery_budgets').get() as {
        count: number;
      }
    ).count,
    0
  );
});

test('budget cleanup hard-caps an oversized batch override', async () => {
  const database = await trackingDatabase();
  const insert = database.prepare(
    `INSERT INTO tracking_delivery_budgets
     (bucket_key, window_start, used, budget_limit, updated_at)
     VALUES (?, 1, 1, 1, '2020-01-01T00:00:00.000Z')`
  );
  for (let index = 0; index < 5_001; index += 1) insert.run(`bounded_budget_${index}`);

  await runCleanup(
    { TRACKING_DB: d1(database), TRACKING_CLEANUP_BATCH_SIZE: 1_000_000 },
    new Date('2026-08-04T12:00:00.000Z')
  );

  assert.equal(
    (
      database.prepare('SELECT count(*) AS count FROM tracking_delivery_budgets').get() as {
        count: number;
      }
    ).count,
    1
  );
});

test('scheduled work bounds cleanup and persists watermark, oldest age, and missed-cron metrics', async () => {
  const database = await trackingDatabase();
  readyRuntime(database);
  const expired = database.prepare(
    `INSERT INTO tracking_dlq_records
     (dlq_id, reason, attempt_count, created_at) VALUES (?, 'expired', 1, '2020-01-01T00:00:00.000Z')`
  );
  for (let index = 0; index < 150; index += 1) expired.run(`expired_${index}`);
  const expiredBudget = database.prepare(
    `INSERT INTO tracking_delivery_budgets
     (bucket_key, window_start, used, budget_limit, updated_at)
     VALUES (?, 1, 1, 1, '2020-01-01T00:00:00.000Z')`
  );
  for (let index = 0; index < 150; index += 1) expiredBudget.run(`expired_budget_${index}`);
  database
    .prepare(
      `INSERT INTO tracking_runtime_metrics
       (metric_key, metric_value, observed_at) VALUES ('cron_last_completed_at', ?, ?)`
    )
    .run(Math.floor(Date.now() / 1000) - 180, new Date(Date.now() - 180_000).toISOString());
  await worker.scheduled(
    {},
    {
      TRACKING_DB: d1(database),
      TRACKING_MIGRATION_SET_SHA: TEST_MIGRATION_SET_SHA,
      TRACKING_RELEASE_SHA: TEST_RELEASE_SHA,
      TRACKING_RETENTION_DAYS: 1,
      TRACKING_CLEANUP_BATCH_SIZE: 25,
    } as never,
    {}
  );
  assert.equal(
    (
      database.prepare('SELECT count(*) AS count FROM tracking_dlq_records').get() as {
        count: number;
      }
    ).count,
    125
  );
  assert.equal(
    (
      database.prepare('SELECT count(*) AS count FROM tracking_delivery_budgets').get() as {
        count: number;
      }
    ).count,
    125
  );
  const metrics = database
    .prepare('SELECT metric_key, metric_value FROM tracking_runtime_metrics ORDER BY metric_key')
    .all() as Array<{ metric_key: string; metric_value: number }>;
  assert.deepEqual(
    metrics.map(({ metric_key }) => metric_key),
    [
      'cleanup_watermark_ms',
      'cron_last_completed_at',
      'cron_missed',
      'oldest_unresolved_age_seconds',
    ]
  );
  assert.equal(metrics.find(({ metric_key }) => metric_key === 'cron_missed')?.metric_value, 1);
});
