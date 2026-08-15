import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../../functions/api/internal/tracking-preview-proof.ts';

type Row = {
  tenant_id: string;
  site_id: string;
  source_event_id: string;
  payload_json: string;
  state: string;
  lease_owner: string | null;
};

function database() {
  const rows = new Map<string, Row>();
  const prepare = (query: string) => {
    let values: unknown[] = [];
    const statement = {
      bind(...input: unknown[]) {
        values = input;
        return statement;
      },
      async run() {
        if (query.includes('INSERT INTO source_tracking_outbox')) {
          rows.set(String(values[2]), {
            tenant_id: String(values[0]),
            site_id: String(values[1]),
            source_event_id: String(values[2]),
            payload_json: String(values[4]),
            state: 'pending',
            lease_owner: null,
          });
        } else if (query.includes("SET state = 'sending'")) {
          const row = rows.get(String(values[5]));
          if (row) {
            row.state = 'sending';
            row.lease_owner = String(values[0]);
          }
        } else if (query.includes("SET state = 'delivered'")) {
          const row = rows.get(String(values[5]));
          if (row) {
            row.state = 'delivered';
            row.lease_owner = null;
          }
        }
        return { success: true, meta: { changes: 1 } };
      },
      async first() {
        return rows.get(String(values[2])) ?? null;
      },
      async all() {
        return { results: [] };
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    rows,
  };
}

const snapshot = () => ({
  schema_version: '1',
  server_subject_ref: 'preview-subject',
  subject_ref_version: 'v1',
  snapshot_issued_at: new Date().toISOString(),
  snapshot_expires_at: new Date(Date.now() + 60_000).toISOString(),
  snapshot_key_id: 'preview-current',
  snapshot_signature: 's'.repeat(43),
  purposes: {
    necessary: 'granted',
    analytics: 'granted',
    advertising: 'denied',
    identity_enrichment: 'denied',
    sale_share: 'denied',
  },
  policy_version: '2026-08-04',
  choice_id: 'choice_preview',
  decision_source: 'banner',
  notice_locale: 'en-US',
  region: 'US',
  region_source: 'banner',
  gpc: false,
  observed_at: new Date().toISOString(),
});

test('Pages preview proof route is fail-closed outside the explicit preview gate', async () => {
  const request = new Request(
    'https://tracking-preview.owned-funnel-builder.pages.dev/api/internal/tracking-preview-proof',
    {
      method: 'POST',
      headers: { authorization: 'Bearer proof-secret', 'content-type': 'application/json' },
      body: '{}',
    }
  );
  assert.equal((await onRequestPost({ request, env: {} })).status, 401);
  assert.equal(
    (
      await onRequestPost({
        request,
        env: {
          TRACKING_ENVIRONMENT: 'preview',
          TRACKING_PREVIEW_NON_PAYMENT_PROOF: 'true',
          TRACKING_PREVIEW_PROOF_TOKEN: 'proof-secret',
        },
      })
    ).status,
    503
  );
});

test('Pages preview proof writes and signs exactly Lead and InitiateCheckout through its binding', async () => {
  const db = database();
  const bridged: string[] = [];
  const request = new Request(
    'https://tracking-preview.owned-funnel-builder.pages.dev/api/internal/tracking-preview-proof',
    {
      method: 'POST',
      headers: { authorization: 'Bearer proof-secret', 'content-type': 'application/json' },
      body: JSON.stringify({
        context_hash: 'a'.repeat(64),
        context_expires_at: new Date(Date.now() + 60_000).toISOString(),
        privacy_snapshot: snapshot(),
      }),
    }
  );
  const response = await onRequestPost({
    request,
    env: {
      LEADS: db as never,
      TRACKING_ENVIRONMENT: 'preview',
      TRACKING_PREVIEW_NON_PAYMENT_PROOF: 'true',
      TRACKING_PREVIEW_PROOF_TOKEN: 'proof-secret',
      TRACKING_TENANT_ID: 'tenant_demo',
      TRACKING_SITE_ID: 'site_demo',
      TRACKING_PAGES_BRIDGE_KEY_CURRENT: 'pages-preview-bridge-secret-at-least-32-bytes',
      TRACKING_SOURCE_BRIDGE: {
        async fetch(input: Request) {
          assert.equal(new URL(input.url).host, 'tracking.internal');
          assert.match(input.headers.get('x-maestro-signature') ?? '', /^[A-Za-z0-9_-]{43}$/);
          bridged.push((JSON.parse(await input.text()) as { event_name: string }).event_name);
          return Response.json({ accepted: true }, { status: 202 });
        },
      },
    },
  });
  assert.equal(response.status, 202, await response.clone().text());
  assert.deepEqual(bridged.sort(), ['InitiateCheckout', 'Lead']);
  assert.deepEqual(
    [...db.rows.values()].map((row) => row.state),
    ['delivered', 'delivered']
  );
});
