import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertTrackingPreviewRows } from './lib/tracking-preview-proof.mjs';
import { previewExecution, PREVIEW_RESOURCES } from './tracking-preview-contract.mjs';

const contract = previewExecution();
if (!contract.execute) {
  console.log(
    JSON.stringify({ action: 'tracking_preview_proof', mode: 'dry-run', mutations: false })
  );
  process.exit(0);
}
const bridgeKey = process.env.TRACKING_PAGES_BRIDGE_KEY_CURRENT;
const proofToken = process.env.TRACKING_PREVIEW_PROOF_TOKEN;
const contextKey = process.env.TRACKING_CONTEXT_SIGNING_KEY_CURRENT;
if (!bridgeKey || bridgeKey.length < 32) throw new Error('preview bridge key is required');
if (!proofToken || proofToken.length < 32) throw new Error('preview proof token is required');
if (!contextKey || contextKey.length < 32) throw new Error('preview context key is required');
const origin = 'https://tracking-preview.owned-funnel-builder.pages.dev';
const base = `https://${PREVIEW_RESOURCES.host}`;
const request = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  return { response, body, json: () => JSON.parse(body) };
};
const health = await request('/healthz');
if (health.response.status !== 200) throw new Error(`health failed: ${health.response.status}`);
const bootstrap = await request('/v1/bootstrap', { headers: { origin } });
if (bootstrap.response.status !== 200)
  throw new Error(`bootstrap failed: ${bootstrap.response.status}`);
const cookiePairs = bootstrap.response.headers
  .getSetCookie()
  .map((value) => value.split(';', 1)[0])
  .filter(Boolean);
const privacyCookie = cookiePairs.find((value) => /^ma_privacy=v2\./.test(value)) ?? '';
if (!/^ma_privacy=v2\./.test(privacyCookie)) throw new Error('signed bootstrap cookie missing');
const cookieHeader = cookiePairs.join('; ');
const encodedContext = Buffer.from(
  JSON.stringify([
    'tenant_demo',
    'site_demo',
    'owned-funnel-builder',
    `preview_subject_${crypto.randomUUID()}`,
    0,
    '2026-08-04',
    Math.floor(Date.now() / 1000) + 300,
  ])
).toString('base64url');
const unsignedContext = `v1.preview-current.${encodedContext}`;
const importedContextKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(contextKey),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign']
);
const contextSignature = Buffer.from(
  await crypto.subtle.sign('HMAC', importedContextKey, new TextEncoder().encode(unsignedContext))
).toString('base64url');
const contextToken = `${unsignedContext}.${contextSignature}`;
const eventId = `pageview_${crypto.randomUUID()}`;
const pageView = await request('/v1/events', {
  method: 'POST',
  headers: {
    origin,
    cookie: cookieHeader,
    'content-type': 'application/json',
    'x-tracking-context-hash': contextToken,
  },
  body: JSON.stringify({
    schema_version: '1',
    tenant_id: 'tenant_demo',
    site_id: 'site_demo',
    event_id: eventId,
    event_name: 'PageView',
    source: 'browser',
    source_system: 'event_worker',
    occurred_at: new Date().toISOString(),
    visitor: {},
    session: {},
    page: { path: '/preview-proof', type: 'offer' },
    attribution: {},
    identity: {},
    commerce: {},
    privacy: { policy_version: '2026-08-04', region: 'US', gpc: false, opted_out: false },
  }),
});
if (pageView.response.status !== 202)
  throw new Error(`PageView failed: ${pageView.response.status}`);

const sign = async (body) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const bodyDigest = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  ).toString('base64url');
  const input = `v1\n${timestamp}\n${nonce}\n${bodyDigest}\n${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(bridgeKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = Buffer.from(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))
  ).toString('base64url');
  return {
    'content-type': 'application/json',
    'x-maestro-issuer': 'pages',
    'x-maestro-key-id': 'pages-current',
    'x-maestro-timestamp': timestamp,
    'x-maestro-nonce': nonce,
    'x-maestro-signature': signature,
  };
};
const exchangeBody = JSON.stringify({
  tracking_context_token: contextToken,
  flow_binding: 'preview-proof-flow',
});
const exchange = await request('/internal/context-exchange', {
  method: 'POST',
  headers: await sign(exchangeBody),
  body: exchangeBody,
});
if (exchange.response.status !== 201)
  throw new Error(`context exchange failed: ${exchange.response.status}`);
const context = exchange.json();
const pagesProof = await fetch(`${origin}/api/internal/tracking-preview-proof`, {
  method: 'POST',
  headers: { authorization: `Bearer ${proofToken}`, 'content-type': 'application/json' },
  signal: AbortSignal.timeout(15_000),
  body: JSON.stringify({
    context_hash: context.context_hash,
    context_expires_at: context.context_expires_at,
    privacy_snapshot: context.privacy_snapshot,
  }),
});
if (pagesProof.status !== 202) throw new Error(`Pages source proof failed: ${pagesProof.status}`);
const expected = (await pagesProof.json()).events;
if (
  !Array.isArray(expected) ||
  expected.length !== 2 ||
  expected.some(
    (event) =>
      !['Lead', 'InitiateCheckout'].includes(event?.event_name) ||
      typeof event?.event_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,180}$/.test(event.event_id)
  )
)
  throw new Error('Pages source proof response invalid');
if (
  expected
    .map((event) => event.event_name)
    .sort()
    .join(',') !== 'InitiateCheckout,Lead'
)
  throw new Error('Pages source proof event set invalid');
const purchaseBody = JSON.stringify({
  schema_version: '1',
  source_system: 'pages',
  source_event_id: `purchase_${crypto.randomUUID()}`,
  event_name: 'Purchase',
  occurred_at: new Date().toISOString(),
  context_hash: context.context_hash,
  context_expires_at: context.context_expires_at,
  funnel_slug: 'owned-funnel-builder',
  payment_id: `payment_${crypto.randomUUID()}`,
  privacy_snapshot: context.privacy_snapshot,
});
const purchase = await request('/v1/source-events', {
  method: 'POST',
  headers: await sign(purchaseBody),
  body: purchaseBody,
});
if (purchase.response.status !== 403 || purchase.json().error !== 'preview_payment_event_blocked')
  throw new Error(`Purchase was not blocked: ${purchase.response.status}`);
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
const exactIds = [eventId, ...expected.map((event) => event.event_id)];
const query = `SELECT event_name, event_id FROM tracking_events WHERE event_id IN (${exactIds.map((id) => `'${id}'`).join(',')}); SELECT count(*) AS delivered_count FROM tracking_deliveries WHERE state = 'delivered';`;
const { stdout } = await promisify(execFile)(wrangler, [
  'd1',
  'execute',
  PREVIEW_RESOURCES.trackingDatabase,
  '--remote',
  '--config',
  'workers/events/wrangler.jsonc',
  '--json',
  '--command',
  query,
]);
const rows = JSON.parse(stdout);
const deliveredCount = assertTrackingPreviewRows(rows, [
  { event_name: 'PageView', event_id: eventId },
  ...expected,
]);
console.log(
  JSON.stringify({
    action: 'tracking_preview_proof',
    mode: 'execute',
    mutations: true,
    host: PREVIEW_RESOURCES.host,
    page_view_event_id: eventId,
    source_event_ids: expected.map((event) => event.event_id),
    purchase_blocked: true,
    destination_deliveries: deliveredCount,
  })
);
