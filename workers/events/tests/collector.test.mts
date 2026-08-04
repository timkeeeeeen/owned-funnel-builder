import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { default as worker } from '../src/index.ts';
import { sourceEnvelopeToCanonical, sourceRuntimeReady } from '../src/collector.ts';
import { issueSignedCookie } from '../../../functions/_lib/tracking-cookie.ts';

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
    TRACKING_CONTEXT_VERIFY: (hash: string) => hash === 'a'.repeat(64)
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

test('bootstrap requires exact host/origin and returns non-cacheable signed cookies', async () => {
  const bindings = await env();
  const response = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie') ?? '', /ma_vid=v2\./);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);

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
  const bootstrap = await worker.fetch(
    request('/v1/bootstrap'),
    bindings as never,
    {} as never
  );
  const { policy_version: policyVersion } = (await bootstrap.json()) as { policy_version: string };
  assert.equal(policyVersion, '2026-08-04');

  const accepted = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      body: JSON.stringify(pageView({
        privacy: { policy_version: policyVersion, region: 'US', gpc: false, opted_out: false },
      })),
    }),
    bindings as never,
    {} as never
  );
  assert.equal(accepted.status, 202);

  const stale = await worker.fetch(
    request('/v1/events', {
      method: 'POST',
      body: JSON.stringify(pageView({
        privacy: { policy_version: '2026-08-03', region: 'US', gpc: false, opted_out: false },
      })),
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
  assert.equal(sourceRuntimeReady('pages', [{
    source: 'pages',
    source_sha: 'a'.repeat(40),
    status: 'enabled',
    context_verifier: 'signed',
    outbox_reconciliation_owner: 'maestro-platform',
    dodo_ownership_readback: 'verified',
  }]), true);
});

test('source bridge rejects raw buyer context', () => {
  assert.throws(() => sourceEnvelopeToCanonical(
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
  ));
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
  const bootstrap = await worker.fetch(request('/v1/bootstrap'), bindings as never, {} as never);
  const cookies = bootstrap.headers.getSetCookie?.() ?? [bootstrap.headers.get('set-cookie') ?? ''];
  const visitorCookie =
    cookies.find((cookie) => cookie.startsWith('ma_vid='))?.split(';', 1)[0] ?? '';
  assert.match(visitorCookie, /^ma_vid=v2\./);
  const visitor = ((await bootstrap.json()) as { visitor_id: string }).visitor_id;
  const response = await worker.fetch(
    request('/v1/privacy/requests', {
      method: 'POST',
      headers: { cookie: visitorCookie },
      body: JSON.stringify({ request_type: 'deletion', subject_key: visitor }),
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

test('collector rejects oversized request bodies before D1 work', async () => {
  const bindings = await env();
  const response = await worker.fetch(
    request('/v1/events', { method: 'POST', body: 'x'.repeat(70 * 1024) }),
    bindings as never,
    {} as never
  );
  assert.equal(response.status, 400);
});
