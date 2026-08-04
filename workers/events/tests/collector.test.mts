import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { default as worker } from '../src/index.ts';
import { sourceEnvelopeToCanonical, sourceRuntimeReady } from '../src/collector.ts';
import { issueSignedCookie } from '../../../functions/_lib/tracking-cookie.ts';
import { REQUIRED_TRACKING_MIGRATIONS } from '../src/safety.ts';

const TEST_MIGRATION_SET_SHA = '5'.repeat(64);
const TEST_RELEASE_SHA = '6'.repeat(40);
const TEST_INGRESS_CONFIG_SHA = '7'.repeat(64);

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

async function env() {
  const database = new DatabaseSync(':memory:');
  database.exec(await BunlessMigration());
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
  database
    .prepare(
      `INSERT INTO tracking_ingress_capabilities
       (capability_key, status, config_hash, release_sha, observed_at, expires_at)
       VALUES ('cloudflare_collector_abuse_protection', 'verified', ?, ?, ?, ?)`
    )
    .run(
      TEST_INGRESS_CONFIG_SHA,
      TEST_RELEASE_SHA,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString()
    );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('collector-cookie-signing-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  return {
    TRACKING_DB: d1(database),
    TRACKING_TENANT_ID: 'tenant_demo',
    TRACKING_SITE_ID: 'site_demo',
    TRACKING_ENVIRONMENT: 'preview',
    TRACKING_HOST: 'events.example.test',
    TRACKING_ALLOWED_ORIGINS: 'https://shop.example.test',
    TRACKING_COOKIE_SIGNING_KEY_CURRENT: key,
    TRACKING_COOKIE_SIGNING_KEY_ID_CURRENT: 'current',
    TRACKING_POLICY_VERSION: '2026-08',
    TRACKING_REGION: 'US',
    TRACKING_FAIL_CLOSED: false,
    TRACKING_MIGRATION_SET_SHA: TEST_MIGRATION_SET_SHA,
    TRACKING_RELEASE_SHA: TEST_RELEASE_SHA,
    TRACKING_CONTEXT_SIGNING_KEY_CURRENT: 'production-shaped-context-secret-key-2026',
    TRACKING_CONTEXT_SIGNING_KEY_ID_CURRENT: 'current',
    TRACKING_CONTEXT_VERIFY: (hash: string) =>
      hash === 'a'.repeat(64)
        ? {
            tenant_id: 'tenant_demo',
            site_id: 'site_demo',
            funnel_id: 'owned-funnel-builder',
            subject_id: 'worker-subject',
            subject_deleted: false,
            policy_version: '2026-08-04',
          }
        : null,
    __database: database,
  } as const;
}

async function BunlessMigration(): Promise<string> {
  const files = [
    new URL('../migrations/0001_tracking_ledger.sql', import.meta.url),
    new URL('../migrations/0002_tracking_scope_hardening.sql', import.meta.url),
    new URL('../migrations/0003_csrf_nonce_bindings.sql', import.meta.url),
    new URL('../migrations/0004_delivery_safety.sql', import.meta.url),
    new URL('../migrations/0005_runtime_safety.sql', import.meta.url),
    new URL('../migrations/0006_waf_capability.sql', import.meta.url),
    new URL('../migrations/0007_context_exchange.sql', import.meta.url),
    new URL('../migrations/0007_privacy_destinations.sql', import.meta.url),
    new URL('../migrations/0008_security_fix_wave.sql', import.meta.url),
  ];
  const chunks = [] as string[];
  for (const file of files)
    chunks.push(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  return chunks.join('\n');
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://events.example.test${path}`, {
    ...init,
    headers: {
      origin: 'https://shop.example.test',
      'content-type': 'application/json',
      'x-tracking-context-hash': 'a'.repeat(64),
      ...init.headers,
    },
  });
}

const pageView = (overrides: Record<string, unknown> = {}) => ({
  schema_version: '1',
  tenant_id: 'tenant_demo',
  site_id: 'site_demo',
  event_id: 'evt_page_1',
  event_name: 'PageView',
  source: 'browser',
  source_system: 'event_worker',
  occurred_at: '2026-08-04T12:00:00.000Z',
  visitor: { id: 'visitor_1' },
  session: { id: 'session_1' },
  page: { path: '/owned-funnel-builder', type: 'offer' },
  attribution: { fbclid: 'fbclid_1', fbp: 'fb.1.1', fbc: 'fb.1.2' },
  identity: {},
  commerce: {},
  privacy: { policy_version: '2026-08-04', region: 'US', gpc: false, opted_out: false },
  ...overrides,
});

const contextSecret = 'production-shaped-context-secret-key-2026';

function testBase64url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function productionContextToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const context = {
    tenant_id: 'tenant_demo',
    site_id: 'site_demo',
    funnel_id: 'owned-funnel-builder',
    subject_id: 'worker-subject',
    subject_deleted: false,
    policy_version: '2026-08-04',
    expires_at: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
  const payload = testBase64url(
    new TextEncoder().encode(
      JSON.stringify([
        context.tenant_id,
        context.site_id,
        context.funnel_id,
        context.subject_id,
        context.subject_deleted ? 1 : 0,
        context.policy_version,
        context.expires_at,
      ])
    )
  );
  const unsigned = `v1.current.${payload}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(contextSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ),
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${testBase64url(new Uint8Array(signature))}`;
}

test('bootstrap requires exact host/origin and returns non-cacheable signed cookies', async () => {
  const bindings = await env();
  const response = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /ma_privacy=v2\./);
  assert.equal(/ma_vid=v2\./.test(setCookie), false);
  assert.equal(/ma_sid=v2\./.test(setCookie), false);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal('visitor_id' in body, false);
  assert.equal(body.resolved, false);
  assert.equal('tracking_context_hash' in body, false);
  assert.equal('purposes' in body, false);
  assert.equal('privacy' in body, false);
  assert.equal('visitor_ready' in body, false);
  assert.equal(
    (
      bindings.__database.prepare('SELECT count(*) AS count FROM tracking_events').get() as {
        count: number;
      }
    ).count,
    0
  );
  assert.equal(response.headers.get('access-control-expose-headers'), 'x-csrf-nonce');

  const wrongOrigin = await worker.fetch(
    new Request('https://events.example.test/v1/bootstrap', {
      headers: { origin: 'https://evil.example.test' },
    }),
    bindings as never,
    {} as never
  );
  assert.equal(wrongOrigin.status, 403);
  const wrongHost = await worker.fetch(
    new Request('https://wrong.example.test/v1/bootstrap', {
      headers: { origin: 'https://shop.example.test', host: 'wrong.example.test' },
    }),
    bindings as never,
    {} as never
  );
  assert.equal(wrongHost.status, 403);
});

test('fetch fails closed while the migration lock or release SHA readback is not green', async () => {
  const bindings = await env();
  const mismatch = await worker.fetch(
    request('/v1/bootstrap'),
    { ...bindings, TRACKING_RELEASE_SHA: '7'.repeat(40) } as never,
    {} as never
  );
  assert.equal(mismatch.status, 503);
  bindings.__database.prepare('DELETE FROM tracking_runtime_release_state').run();
  const response = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'tracking_migrations_not_ready' });
  assert.equal(
    (
      bindings.__database.prepare('SELECT count(*) AS count FROM tracking_csrf_nonces').get() as {
        count: number;
      }
    ).count,
    0
  );
});

test('fetch fails closed before collector writes when ingress protection readback is absent', async () => {
  const bindings = await env();
  bindings.__database.prepare('DELETE FROM tracking_ingress_capabilities').run();
  const response = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'tracking_ingress_capability_not_ready' });
  assert.equal(
    (
      bindings.__database.prepare('SELECT count(*) AS count FROM tracking_csrf_nonces').get() as {
        count: number;
      }
    ).count,
    0
  );
});

test('one privacy action atomically consumes its bound nonce and returns server-effective purposes', async () => {
  const bindings = await env();
  const firstBootstrap = await worker.fetch(
    request('/v1/bootstrap'),
    bindings as never,
    {} as never
  );
  const privacyCookie =
    (firstBootstrap.headers.get('set-cookie') ?? '')
      .split(',')
      .find((cookie) => cookie.trim().startsWith('ma_privacy='))
      ?.split(';', 1)[0]
      ?.trim() ?? '';
  const nonce = firstBootstrap.headers.get('x-csrf-nonce') ?? '';
  const choiceId = `choice:${crypto.randomUUID()}`;
  const action = () =>
    request('/v1/privacy', {
      method: 'POST',
      headers: { cookie: privacyCookie, 'x-csrf-nonce': nonce },
      body: JSON.stringify({
        schema_version: '1',
        choice_id: choiceId,
        policy_version: '2026-08-04',
        action: 'customize',
        purposes: { analytics: true, advertising: false },
      }),
    });

  const accepted = await worker.fetch(action(), bindings as never, {} as never);
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {
    accepted: true,
    choice_id: choiceId,
    resolved: true,
    policy_version: '2026-08-04',
    purposes: ['necessary', 'analytics'],
  });
  assert.equal((await worker.fetch(action(), bindings as never, {} as never)).status, 409);
  const consumed = bindings.__database
    .prepare(
      'SELECT consumed_at, choice_id, policy_version, action FROM tracking_csrf_nonces WHERE nonce = ?'
    )
    .get(nonce) as Record<string, unknown>;
  assert.equal(typeof consumed.consumed_at, 'string');
  assert.equal(consumed.choice_id, choiceId);
  assert.equal(consumed.policy_version, '2026-08-04');
  assert.equal(consumed.action, 'customize');
  const choices = bindings.__database
    .prepare(
      'SELECT purpose, choice FROM tracking_privacy_choices WHERE choice_key LIKE ? ORDER BY purpose'
    )
    .all(`${choiceId}:%`) as Array<{ purpose: string; choice: string }>;
  assert.deepEqual(
    choices.map((choice) => ({ ...choice })),
    [
      { purpose: 'advertising', choice: 'deny' },
      { purpose: 'analytics', choice: 'allow' },
    ]
  );

  const secondBootstrap = await worker.fetch(
    request('/v1/bootstrap', { headers: { cookie: privacyCookie } }),
    bindings as never,
    {} as never
  );
  const contextHash = ((await secondBootstrap.clone().json()) as { tracking_context_hash: string })
    .tracking_context_hash;
  assert.match(contextHash, /^v1\.current\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(
    (
      await worker.fetch(
        request('/v1/events', {
          method: 'POST',
          headers: { cookie: privacyCookie, 'x-tracking-context-hash': contextHash },
          body: JSON.stringify(pageView({ event_id: 'evt_privacy_withdrawal' })),
        }),
        { ...bindings, TRACKING_CONTEXT_VERIFY: undefined } as never,
        {} as never
      )
    ).status,
    202
  );
  const withdrawId = `choice:${crypto.randomUUID()}`;
  const withdrawn = await worker.fetch(
    request('/v1/privacy', {
      method: 'POST',
      headers: {
        cookie: privacyCookie,
        'x-csrf-nonce': secondBootstrap.headers.get('x-csrf-nonce') ?? '',
      },
      body: JSON.stringify({
        schema_version: '1',
        choice_id: withdrawId,
        policy_version: '2026-08-04',
        action: 'withdraw',
        purposes: { analytics: false, advertising: false },
      }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(withdrawn.status, 202);
  assert.notEqual(withdrawId, choiceId);
  assert.deepEqual(((await withdrawn.json()) as { purposes: string[] }).purposes, ['necessary']);
  assert.deepEqual(
    bindings.__database
      .prepare(
        'SELECT action FROM tracking_csrf_nonces WHERE consumed_at IS NOT NULL ORDER BY consumed_at, action'
      )
      .all()
      .map((row) => ({ ...row })),
    [{ action: 'customize' }, { action: 'withdraw' }]
  );
  assert.equal(
    (bindings.__database.prepare('SELECT state FROM tracking_outbox').get() as { state: string })
      .state,
    'suppressed'
  );
  assert.deepEqual(
    bindings.__database
      .prepare('SELECT state FROM tracking_deliveries ORDER BY destination')
      .all()
      .map((row) => ({ ...row })),
    [{ state: 'suppressed' }]
  );
  assert.equal(
    (
      bindings.__database
        .prepare('SELECT count(*) AS count FROM tracking_suppression_tombstones WHERE reason = ?')
        .get('privacy_withdrawal') as { count: number }
    ).count,
    1
  );
});

test('privacy grants fail closed when the production context-signing secret is missing', async () => {
  const { TRACKING_CONTEXT_SIGNING_KEY_CURRENT: _missing, ...bindings } = await env();
  const bootstrap = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  const cookie = (bootstrap.headers.get('set-cookie') ?? '').split(';', 1)[0];
  const response = await worker.fetch(
    request('/v1/privacy', {
      method: 'POST',
      headers: { cookie, 'x-csrf-nonce': bootstrap.headers.get('x-csrf-nonce') ?? '' },
      body: JSON.stringify({
        schema_version: '1',
        choice_id: `choice:${crypto.randomUUID()}`,
        policy_version: '2026-08-04',
        action: 'accept',
        purposes: { analytics: true, advertising: true },
      }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 503);
});

test('production context verifier accepts a granted token and rejects tampering or a missing key', async () => {
  const { TRACKING_CONTEXT_VERIFY: _testVerifier, ...bindings } = await env();
  const bootstrap = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  const cookie = (bootstrap.headers.get('set-cookie') ?? '').split(';', 1)[0];
  const granted = await worker.fetch(
    request('/v1/privacy', {
      method: 'POST',
      headers: { cookie, 'x-csrf-nonce': bootstrap.headers.get('x-csrf-nonce') ?? '' },
      body: JSON.stringify({
        schema_version: '1',
        choice_id: `choice:${crypto.randomUUID()}`,
        policy_version: '2026-08-04',
        action: 'customize',
        purposes: { analytics: true, advertising: false },
      }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(granted.status, 202);
  const resolved = await worker.fetch(
    request('/v1/bootstrap', { headers: { cookie } }),
    bindings as never,
    {} as never
  );
  const token = ((await resolved.json()) as { tracking_context_hash: string })
    .tracking_context_hash;
  const collect = (contextHash: string, eventId: string, eventBindings = bindings) =>
    worker.fetch(
      request('/v1/events', {
        method: 'POST',
        headers: { 'x-tracking-context-hash': contextHash },
        body: JSON.stringify(pageView({ event_id: eventId })),
      }),
      eventBindings as never,
      {} as never
    );
  assert.equal((await collect(token, 'evt_production_context')).status, 202);
  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await collect(tampered, 'evt_tampered_context')).status, 403);
  const { TRACKING_CONTEXT_SIGNING_KEY_CURRENT: _missing, ...missingKeyBindings } = bindings;
  assert.equal((await collect(token, 'evt_missing_context_key', missingKeyBindings)).status, 403);
});

test('production context verifier rejects stale, expired, and deleted contexts', async () => {
  const { TRACKING_CONTEXT_VERIFY: _testVerifier, ...bindings } = await env();
  for (const [name, token] of [
    ['stale', await productionContextToken({ policy_version: '2026-08-03' })],
    ['expired', await productionContextToken({ expires_at: Math.floor(Date.now() / 1000) - 1 })],
    ['deleted', await productionContextToken({ subject_deleted: true })],
  ] as const) {
    const response = await worker.fetch(
      request('/v1/events', {
        method: 'POST',
        headers: { 'x-tracking-context-hash': token },
        body: JSON.stringify(pageView({ event_id: `evt_${name}_context` })),
      }),
      bindings as never,
      {} as never
    );
    assert.equal(response.status, 403);
  }
});

test('browser collector accepts PageView, is idempotent, and blocks authoritative events', async () => {
  const bindings = await env();
  const first = await worker.fetch(
    request('/v1/events', { method: 'POST', body: JSON.stringify(pageView()) }),
    bindings as never,
    {} as never
  );
  assert.equal(first.status, 202);
  const duplicate = await worker.fetch(
    request('/v1/events', { method: 'POST', body: JSON.stringify(pageView()) }),
    bindings as never,
    {} as never
  );
  assert.equal(duplicate.status, 202);
  const blocked = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      body: JSON.stringify(pageView({ event_name: 'Lead', event_id: 'lead_1' })),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(blocked.status, 403);
  assert.equal(
    (
      bindings.__database.prepare('SELECT count(*) AS count FROM tracking_events').get() as {
        count: number;
      }
    ).count,
    1
  );
});

test('collector applies the shared field policy before persistence', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/v1/events', { method: 'POST', body: JSON.stringify(pageView()) }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 202);
  const row = bindings.__database
    .prepare('SELECT envelope_json FROM tracking_events LIMIT 1')
    .get() as { envelope_json: string };
  const stored = JSON.parse(row.envelope_json) as Record<string, Record<string, unknown>>;
  assert.deepEqual(stored.attribution, {});
  assert.deepEqual(stored.visitor, {});
  assert.deepEqual(stored.session, {});
});

test('collector rejects a context binding that does not verify', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/v1/events', { method: 'POST', body: JSON.stringify(pageView()) }),
    { ...bindings, TRACKING_CONTEXT_VERIFY: () => false },
    {} as never
  );
  assert.equal(response.status, 403);
});

test('bootstrap policy version is accepted while a stale version is rejected', async () => {
  const { TRACKING_POLICY_VERSION: _legacyPolicyVersion, ...bindings } = await env();
  const bootstrap = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  const { policy_version: policyVersion } = (await bootstrap.json()) as { policy_version: string };
  assert.equal(policyVersion, '2026-08-04');

  const accepted = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      body: JSON.stringify(
        pageView({
          privacy: { policy_version: policyVersion, region: 'US', gpc: false, opted_out: false },
        })
      ),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(accepted.status, 202);

  const stale = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      body: JSON.stringify(
        pageView({
          privacy: { policy_version: '2026-08-03', region: 'US', gpc: false, opted_out: false },
        })
      ),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(stale.status, 403);
});

test('collector rejects stale, deleted, and cross-funnel context snapshots', async () => {
  const bindings = await env();
  for (const context of [
    { policy_version: 'old' },
    { subject_deleted: true },
    { funnel_id: 'other-funnel' },
  ]) {
    const response = await worker.fetch(
      request('/v1/events', { method: 'POST', body: JSON.stringify(pageView()) }),
      {
        ...bindings,
        TRACKING_CONTEXT_VERIFY: () => ({
          tenant_id: 'tenant_demo',
          site_id: 'site_demo',
          funnel_id: 'owned-funnel-builder',
          subject_id: 'worker-subject',
          subject_deleted: false,
          policy_version: '2026-08-04',
          ...context,
        }),
      },
      {} as never
    );
    assert.equal(response.status, 403);
  }
});

test('source runtime readiness requires the launch dependencies', () => {
  assert.equal(
    sourceRuntimeReady('pages', [
      {
        source: 'pages',
        source_sha: 'a'.repeat(40),
        status: 'enabled',
        context_verifier: 'signed',
        outbox_reconciliation_owner: 'maestro-platform',
        dodo_ownership_readback: 'verified',
      },
    ]),
    true
  );
});

test('source bridge rejects raw buyer context', () => {
  assert.throws(() =>
    sourceEnvelopeToCanonical(
      {
        schema_version: '1',
        event_id: 'initiate_checkout:session_1',
        event_name: 'InitiateCheckout',
        occurred_at: '2026-08-04T12:00:00.000Z',
        context_hash: 'a'.repeat(64),
        identity: { lead_id: 'lead_1', funnel_id: 'owned-funnel-builder' },
        commerce: { content_ids: ['owned-funnel-builder'], content_type: 'product' },
        privacy: { policy_version: '2026-08-04', region: 'US', gpc: false, opted_out: false },
        buyer_context: {
          attribution: { fbclid: 'browser-controlled' },
          event_source_url: 'https://evil.example.test/controlled-path',
        },
      },
      'pages',
      { TRACKING_TENANT_ID: 'tenant_demo', TRACKING_SITE_ID: 'site_demo' } as never
    )
  );
});

test('health output is probe-safe and never echoes secrets or raw identity', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    new Request('https://events.example.test/healthz'),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['status', 'version']);
  assert.equal(JSON.stringify(body).includes('tenant_demo'), false);
});

test('GPC suppresses advertising browser events without turning the signal into a user choice', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      headers: { 'sec-gpc': '1' },
      body: JSON.stringify(
        pageView({
          privacy: { policy_version: '2026-08-04', region: 'US', gpc: true, opted_out: false },
        })
      ),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, suppressed: true });
  const choices = bindings.__database
    .prepare('SELECT count(*) AS count FROM tracking_privacy_choices')
    .get() as { count: number };
  assert.equal(choices.count, 1);
  assert.equal(
    (
      bindings.__database.prepare('SELECT source FROM tracking_privacy_choices').get() as {
        source: string;
      }
    ).source,
    'gpc'
  );
});

test('privacy request returns only a request id and state', async () => {
  const bindings = await env();
  const firstBootstrap = await worker.fetch(
    request('/v1/bootstrap'),
    bindings as never,
    {} as never
  );
  const privacyCookie =
    (firstBootstrap.headers.get('set-cookie') ?? '')
      .split(',')
      .find((cookie) => cookie.trim().startsWith('ma_privacy='))
      ?.split(';', 1)[0]
      ?.trim() ?? '';
  const csrf = firstBootstrap.headers.get('x-csrf-nonce') ?? '';
  assert.match(privacyCookie, /^ma_privacy=v2\./);
  const forgedChoice = await worker.fetch(
    request('/v1/privacy', {
      method: 'POST',
      headers: { cookie: privacyCookie, 'x-csrf-nonce': 'a'.repeat(43) },
      body: JSON.stringify({
        schema_version: '1',
        choice_id: `choice:${crypto.randomUUID()}`,
        policy_version: '2026-08-04',
        action: 'accept',
        purposes: { analytics: true, advertising: true },
      }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(forgedChoice.status, 409);
  const choice = await worker.fetch(
    request('/v1/privacy', {
      method: 'POST',
      headers: { cookie: privacyCookie, 'x-csrf-nonce': csrf },
      body: JSON.stringify({
        schema_version: '1',
        choice_id: `choice:${crypto.randomUUID()}`,
        policy_version: '2026-08-04',
        action: 'accept',
        purposes: { analytics: true, advertising: true },
      }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(choice.status, 202);
  const bootstrap = await worker.fetch(
    request('/v1/bootstrap', { headers: { cookie: privacyCookie } }),
    bindings as never,
    {} as never
  );
  const cookies = bootstrap.headers.getSetCookie?.() ?? [bootstrap.headers.get('set-cookie') ?? ''];
  const visitorCookie =
    cookies
      .flatMap((cookie) => cookie.split(','))
      .find((cookie) => cookie.trim().startsWith('ma_vid='))
      ?.split(';', 1)[0]
      ?.trim() ?? '';
  assert.match(visitorCookie, /^ma_vid=v2\./);
  const visitor = ((await bootstrap.json()) as { visitor_ready: boolean }).visitor_ready;
  assert.equal(visitor, true);
  const response = await worker.fetch(
    request('/v1/privacy/requests', {
      method: 'POST',
      headers: { cookie: visitorCookie },
      body: JSON.stringify({ request_type: 'deletion', subject_key: 'self' }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 202);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(typeof body.request_id, 'string');
  assert.equal(body.state, 'received');
  assert.equal('subject_data' in body, false);
});

test('source bridge rejects a shadow runtime before persistence', async () => {
  const bindings = await env();
  const sourceKey = 'pages-source-bridge-key';
  const payload = JSON.stringify(
    pageView({
      event_id: 'lead_1',
      event_name: 'Lead',
      source: 'server',
      source_system: 'pages',
      commerce: { offer_id: 'owned-funnel-builder', value: 5, currency: 'USD' },
    })
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce-pages-1';
  const signature = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(sourceKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ),
    new TextEncoder().encode(`${timestamp}.${nonce}.${payload}`)
  );
  const hex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const response = await worker.fetch(
    request('/v1/source-events', {
      method: 'POST',
      headers: {
        'x-tracking-source': 'pages',
        'x-tracking-timestamp': timestamp,
        'x-tracking-nonce': nonce,
        'x-tracking-signature': hex,
        'x-tracking-bridge-key': sourceKey,
      },
      body: payload,
    }),
    { ...bindings, TRACKING_PAGES_BRIDGE_KEY_CURRENT: sourceKey },
    {} as never
  );
  assert.equal(response.status, 403);
  const forged = await worker.fetch(
    request('/v1/source-events', {
      method: 'POST',
      headers: {
        'x-tracking-source': 'pages',
        'x-tracking-timestamp': timestamp,
        'x-tracking-nonce': 'nonce-pages-2',
        'x-tracking-signature': hex,
      },
      body: payload,
    }),
    { ...bindings, TRACKING_PAGES_BRIDGE_KEY_CURRENT: sourceKey },
    {} as never
  );
  assert.equal(forged.status, 403);
});

test('source bridge rejects reduced envelopes while its runtime is shadow-only', async () => {
  const bindings = await env();
  const sourceKey = 'pages-source-bridge-key';
  const payload = JSON.stringify({
    schema_version: '1',
    event_id: 'initiate_checkout:session_1',
    event_name: 'InitiateCheckout',
    occurred_at: new Date().toISOString(),
    flow_token_hash: 'a'.repeat(64),
    identity: { lead_id: 'lead_1', funnel_id: 'funnel_1' },
    commerce: { content_ids: ['owned-funnel-builder'], content_type: 'product' },
    buyer_context: { attribution: { fbclid: 'fbclid_1' } },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce-pages-reduced-1';
  const signature = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(sourceKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ),
    new TextEncoder().encode(`${timestamp}.${nonce}.${payload}`)
  );
  const hex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const response = await worker.fetch(
    request('/v1/source-events', {
      method: 'POST',
      headers: {
        'x-tracking-source': 'pages',
        'x-tracking-timestamp': timestamp,
        'x-tracking-nonce': nonce,
        'x-tracking-signature': hex,
      },
      body: payload,
    }),
    { ...bindings, TRACKING_PAGES_BRIDGE_KEY_CURRENT: sourceKey },
    {} as never
  );
  assert.equal(response.status, 403);
});

test('scope mismatch is rejected and leaves a durable ignored-not-owner audit', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      body: JSON.stringify(pageView({ tenant_id: 'other_tenant' })),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 403);
  const audit = bindings.__database
    .prepare("SELECT result, reason FROM tracking_scope_audits WHERE result = 'ignored_not_owner'")
    .get() as { result: string; reason: string };
  assert.equal(audit.result, 'ignored_not_owner');
  assert.equal(audit.reason, 'event_scope_mismatch');
});

test('internal browser claims cannot be called without a Worker context signature', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/internal/browser-claims', {
      method: 'POST',
      body: JSON.stringify({ payment_ids: ['payment_1'] }),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 401);
});

test('operator kill switch is durable, attributed, and idempotently audited', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/internal/operator/kill-switch', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-secret' },
      body: JSON.stringify({
        enabled: true,
        actor: 'on-call@example.test',
        reason: 'provider mismatch',
        request_id: 'request_12345678',
        idempotency_key: 'idem_12345678',
      }),
    }),
    { ...bindings, TRACKING_OPERATOR_TOKEN: 'operator-secret' } as never,
    {} as never
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      ...(bindings.__database
        .prepare('SELECT paused, actor, reason, request_id FROM tracking_runtime_controls')
        .get() as Record<string, unknown>),
    },
    {
      paused: 1,
      actor: 'on-call@example.test',
      reason: 'provider mismatch',
      request_id: 'request_12345678',
    }
  );
  assert.equal(
    (
      bindings.__database
        .prepare('SELECT count(*) AS count FROM tracking_operator_audits')
        .get() as { count: number }
    ).count,
    1
  );
  const duplicate = await worker.fetch(
    request('/internal/operator/kill-switch', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-secret' },
      body: JSON.stringify({
        enabled: false,
        actor: 'on-call@example.test',
        reason: 'must not replace first decision',
        request_id: 'request_87654321',
        idempotency_key: 'idem_12345678',
      }),
    }),
    { ...bindings, TRACKING_OPERATOR_TOKEN: 'operator-secret' } as never,
    {} as never
  );
  assert.equal(duplicate.status, 200);
  assert.equal(
    (
      bindings.__database
        .prepare("SELECT paused FROM tracking_runtime_controls WHERE control_key = 'global'")
        .get() as { paused: number }
    ).paused,
    1
  );
  assert.equal(
    (
      bindings.__database
        .prepare('SELECT count(*) AS count FROM tracking_operator_audits')
        .get() as { count: number }
    ).count,
    1
  );
});

test('operator replay claims outcome_unknown once and rejects tombstoned or expired events', async () => {
  const bindings = await env();
  const now = new Date().toISOString();
  const seed = (eventKey: string, occurredAt: string, subject: string | null) => {
    bindings.__database
      .prepare(
        `INSERT INTO tracking_events
         (event_key, tenant_id, site_id, event_name, event_id, source_system, occurred_at,
          received_at, envelope_json, privacy_state_json, bot_state, created_at,
          canonical_payload_hash, privacy_subject_id)
         VALUES (?, 'tenant_demo', 'site_demo', 'Purchase', ?, 'pages', ?, ?,
                 '{"identity":{"funnel_id":"owned-funnel-builder"}}', '{}', 'human', ?, ?, ?)`
      )
      .run(
        eventKey,
        `purchase:${eventKey.slice(0, 8)}`,
        occurredAt,
        now,
        now,
        'a'.repeat(64),
        subject
      );
    bindings.__database
      .prepare(
        `INSERT INTO tracking_outbox
         (event_key, state, next_attempt_at, created_at, updated_at)
         VALUES (?, 'outcome_unknown', ?, ?, ?)`
      )
      .run(eventKey, now, now, now);
    bindings.__database
      .prepare(
        `INSERT INTO tracking_deliveries
         (delivery_key, tenant_id, site_id, event_key, destination, state, outcome,
          created_at, updated_at, destination_payload_hash)
         VALUES (?, 'tenant_demo', 'site_demo', ?, 'meta', 'outcome_unknown',
                 'outcome_unknown', ?, ?, ?)`
      )
      .run(`${eventKey}:meta`, eventKey, now, now, 'b'.repeat(64));
  };
  const sends: unknown[] = [];
  const replay = (eventKey: string, idempotencyKey: string) =>
    worker.fetch(
      request('/internal/operator/replay', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-secret' },
        body: JSON.stringify({
          event_key: eventKey,
          destination: 'meta',
          actor: 'on-call@example.test',
          second_approver: 'reviewer@example.test',
          reason: 'verified ambiguous provider outcome',
          request_id: `request_${idempotencyKey}`,
          idempotency_key: idempotencyKey,
        }),
      }),
      {
        ...bindings,
        TRACKING_OPERATOR_TOKEN: 'operator-secret',
        EVENTS_QUEUE: { send: async (message: unknown) => void sends.push(message) },
      } as never,
      {} as never
    );

  const claimableKey = '7'.repeat(64);
  seed(claimableKey, now, null);
  assert.equal((await replay(claimableKey, 'idem_replay_123')).status, 200);
  assert.equal((await replay(claimableKey, 'idem_replay_123')).status, 200);
  assert.equal(sends.length, 1);
  assert.equal(
    (
      bindings.__database
        .prepare('SELECT state FROM tracking_deliveries WHERE event_key = ?')
        .get(claimableKey) as { state: string }
    ).state,
    'replay_pending'
  );
  assert.equal(
    (
      bindings.__database
        .prepare(
          "SELECT count(*) AS count FROM tracking_operator_audits WHERE operation = 'replay_claim'"
        )
        .get() as { count: number }
    ).count,
    1
  );

  const tombstonedKey = '8'.repeat(64);
  seed(tombstonedKey, now, 'privacy_deleted');
  bindings.__database
    .prepare(
      `INSERT INTO tracking_suppression_tombstones
       (suppression_key, tenant_id, site_id, visitor_id, reason, created_at)
       VALUES ('deleted_subject', 'tenant_demo', 'site_demo', 'privacy_deleted', 'deletion', ?)`
    )
    .run(now);
  assert.equal((await replay(tombstonedKey, 'idem_replay_456')).status, 409);

  const expiredKey = '9'.repeat(64);
  seed(expiredKey, '2020-01-01T00:00:00.000Z', null);
  assert.equal((await replay(expiredKey, 'idem_replay_789')).status, 410);
});

test('operator replay enqueue failure restores durable retry state for scheduled recovery', async () => {
  const bindings = await env();
  const now = new Date().toISOString();
  const eventKey = 'e'.repeat(64);
  bindings.__database
    .prepare(
      `INSERT INTO tracking_events
       (event_key, tenant_id, site_id, event_name, event_id, source_system, occurred_at,
        received_at, envelope_json, privacy_state_json, bot_state, created_at,
        canonical_payload_hash)
       VALUES (?, 'tenant_demo', 'site_demo', 'PageView', 'replay_enqueue_failure', 'pages', ?, ?,
               '{"identity":{"funnel_id":"owned-funnel-builder"}}', '{}', 'human', ?, ?)`
    )
    .run(eventKey, now, now, now, 'a'.repeat(64));
  bindings.__database
    .prepare(
      `INSERT INTO tracking_outbox
       (event_key, state, next_attempt_at, created_at, updated_at)
       VALUES (?, 'outcome_unknown', ?, ?, ?)`
    )
    .run(eventKey, now, now, now);
  bindings.__database
    .prepare(
      `INSERT INTO tracking_deliveries
       (delivery_key, tenant_id, site_id, event_key, destination, state, outcome,
        created_at, updated_at, destination_payload_hash)
       VALUES (?, 'tenant_demo', 'site_demo', ?, 'meta', 'outcome_unknown',
               'outcome_unknown', ?, ?, ?)`
    )
    .run(`${eventKey}:meta`, eventKey, now, now, 'b'.repeat(64));

  const response = await worker.fetch(
    request('/internal/operator/replay', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-secret' },
      body: JSON.stringify({
        event_key: eventKey,
        destination: 'meta',
        actor: 'on-call@example.test',
        reason: 'verified enqueue recovery',
        request_id: 'request_replay_enqueue_failure',
        idempotency_key: 'idem_replay_enqueue_failure',
      }),
    }),
    {
      ...bindings,
      TRACKING_OPERATOR_TOKEN: 'operator-secret',
      EVENTS_QUEUE: { send: async () => Promise.reject(new Error('queue unavailable')) },
    } as never,
    {} as never
  );

  assert.equal(response.status, 503);
  const retryState = bindings.__database
    .prepare(
      `SELECT d.state AS delivery_state, o.state AS outbox_state,
                o.next_attempt_at, d.last_error AS delivery_error, o.last_error AS outbox_error
         FROM tracking_deliveries d JOIN tracking_outbox o ON o.event_key = d.event_key
         WHERE d.event_key = ? AND d.destination = 'meta'`
    )
    .get(eventKey) as Record<string, unknown>;
  assert.deepEqual(
    { ...retryState, next_attempt_at: undefined },
    {
      delivery_state: 'retryable',
      outbox_state: 'retryable',
      next_attempt_at: undefined,
      delivery_error: 'replay_enqueue_failed',
      outbox_error: 'replay_enqueue_failed',
    }
  );
  assert.ok(Date.parse(String(retryState.next_attempt_at)) <= Date.now());
  assert.equal(
    (
      bindings.__database
        .prepare(
          `SELECT count(*) AS count FROM tracking_operator_audits
           WHERE operation = 'replay_claim' AND event_key = ?`
        )
        .get(eventKey) as { count: number }
    ).count,
    1
  );

  const recovered: unknown[] = [];
  await worker.scheduled(
    {},
    {
      ...bindings,
      EVENTS_QUEUE: { send: async (message: unknown) => void recovered.push(message) },
    } as never,
    {}
  );
  assert.deepEqual(recovered, [{ event_key: eventKey, destination: 'meta', schema_version: '1' }]);
});

test('operator resume changes only the requested funnel and destination scope', async () => {
  const bindings = await env();
  const now = new Date().toISOString();
  for (const [eventKey, funnelId] of [
    ['a'.repeat(64), 'funnel_a'],
    ['b'.repeat(64), 'funnel_b'],
  ]) {
    bindings.__database
      .prepare(
        `INSERT INTO tracking_events
         (event_key, tenant_id, site_id, event_name, event_id, source_system, occurred_at,
          received_at, envelope_json, privacy_state_json, bot_state, created_at,
          canonical_payload_hash)
         VALUES (?, 'tenant_demo', 'site_demo', 'PageView', ?, 'event_worker', ?, ?, ?, '{}',
                 'human', ?, ?)`
      )
      .run(
        eventKey,
        `event:${funnelId}`,
        now,
        now,
        JSON.stringify({ identity: { funnel_id: funnelId } }),
        now,
        'c'.repeat(64)
      );
    bindings.__database
      .prepare(
        `INSERT INTO tracking_outbox
         (event_key, state, next_attempt_at, created_at, updated_at)
         VALUES (?, 'paused', ?, ?, ?)`
      )
      .run(eventKey, now, now, now);
    bindings.__database
      .prepare(
        `INSERT INTO tracking_deliveries
         (delivery_key, tenant_id, site_id, event_key, destination, state,
          created_at, updated_at, destination_payload_hash)
         VALUES (?, 'tenant_demo', 'site_demo', ?, 'meta', 'paused', ?, ?, '')`
      )
      .run(`${eventKey}:meta`, eventKey, now, now);
  }
  const response = await worker.fetch(
    request('/internal/operator/kill-switch', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-secret' },
      body: JSON.stringify({
        enabled: false,
        funnel_id: 'funnel_a',
        destination: 'meta',
        actor: 'on-call@example.test',
        reason: 'resume reviewed funnel scope',
        request_id: 'request_scope_123',
        idempotency_key: 'idem_scope_123',
      }),
    }),
    { ...bindings, TRACKING_OPERATOR_TOKEN: 'operator-secret' } as never,
    {} as never
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    bindings.__database
      .prepare(
        `SELECT json_extract(e.envelope_json, '$.identity.funnel_id') AS funnel_id, d.state
         FROM tracking_deliveries d JOIN tracking_events e ON e.event_key = d.event_key
         ORDER BY funnel_id`
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { funnel_id: 'funnel_a', state: 'retryable' },
      { funnel_id: 'funnel_b', state: 'paused' },
    ]
  );
});

test('collector rejects oversized request bodies before D1 work', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/v1/events', { method: 'POST', body: 'x'.repeat(70 * 1024) }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 400);
});
