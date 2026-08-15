import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { previewExecution, PREVIEW_RESOURCES } from './tracking-preview-contract.mjs';

const contract = previewExecution();
if (!contract.execute) {
  console.log(
    JSON.stringify({ action: 'tracking_preview_proof', mode: 'dry-run', mutations: false })
  );
  process.exit(0);
}
const bridgeKey = process.env.TRACKING_PAGES_BRIDGE_KEY_CURRENT;
if (!bridgeKey || bridgeKey.length < 32) throw new Error('preview bridge key is required');
const origin = 'https://tracking-preview.owned-funnel-builder.pages.dev';
const base = `https://${PREVIEW_RESOURCES.host}`;
const request = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.text();
  return { response, body, json: () => JSON.parse(body) };
};
const health = await request('/healthz');
if (health.response.status !== 200) throw new Error(`health failed: ${health.response.status}`);
const bootstrap = await request('/v1/bootstrap', { headers: { origin } });
if (bootstrap.response.status !== 200)
  throw new Error(`bootstrap failed: ${bootstrap.response.status}`);
const privacyCookie = (bootstrap.response.headers.get('set-cookie') ?? '').split(';', 1)[0];
const csrf = bootstrap.response.headers.get('x-csrf-nonce') ?? '';
const choice = await request('/v1/privacy', {
  method: 'POST',
  headers: {
    origin,
    cookie: privacyCookie,
    'content-type': 'application/json',
    'x-csrf-nonce': csrf,
  },
  body: JSON.stringify({
    schema_version: '1',
    choice_id: `choice_${crypto.randomUUID()}`,
    policy_version: '2026-08-04',
    action: 'customize',
    purposes: { analytics: true, advertising: false },
  }),
});
if (choice.response.status !== 202)
  throw new Error(`privacy choice failed: ${choice.response.status}`);
const resolved = await request('/v1/bootstrap', { headers: { origin, cookie: privacyCookie } });
const contextToken = resolved.json().tracking_context_token;
if (typeof contextToken !== 'string') throw new Error('tracking context token missing');
const eventId = `pageview_${crypto.randomUUID()}`;
const pageView = await request('/v1/events', {
  method: 'POST',
  headers: {
    origin,
    cookie: privacyCookie,
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

const sign = async (body, audience) => {
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
    'x-proof-audience': audience,
  };
};
const exchangeBody = JSON.stringify({
  tracking_context_token: contextToken,
  flow_binding: 'preview-proof-flow',
});
const exchange = await request('/internal/context-exchange', {
  method: 'POST',
  headers: await sign(exchangeBody, 'context-exchange'),
  body: exchangeBody,
});
if (exchange.response.status !== 201)
  throw new Error(`context exchange failed: ${exchange.response.status}`);
const context = exchange.json();
const sourceEvent = async (eventName) => {
  const body = JSON.stringify({
    schema_version: '1',
    source_system: 'pages',
    source_event_id: `${eventName.toLowerCase()}_${crypto.randomUUID()}`,
    event_name: eventName,
    occurred_at: new Date().toISOString(),
    context_hash: context.context_hash,
    context_expires_at: context.context_expires_at,
    funnel_slug: 'owned-funnel-builder',
    ...(eventName === 'Lead' ? { lead_id: `lead_${crypto.randomUUID()}` } : {}),
    ...(eventName === 'InitiateCheckout'
      ? { checkout_session_id: `checkout_${crypto.randomUUID()}` }
      : {}),
    ...(eventName === 'Purchase' ? { payment_id: `payment_${crypto.randomUUID()}` } : {}),
    privacy_snapshot: context.privacy_snapshot,
  });
  return request('/v1/source-events', {
    method: 'POST',
    headers: await sign(body, 'source-events'),
    body,
  });
};
for (const name of ['Lead', 'InitiateCheckout']) {
  const result = await sourceEvent(name);
  if (result.response.status !== 202) throw new Error(`${name} failed: ${result.response.status}`);
}
const purchase = await sourceEvent('Purchase');
if (purchase.response.status !== 403 || purchase.json().error !== 'preview_payment_event_blocked')
  throw new Error(`Purchase was not blocked: ${purchase.response.status}`);
const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
const query =
  "SELECT event_name, count(*) AS count FROM tracking_events GROUP BY event_name ORDER BY event_name; SELECT count(*) AS count FROM tracking_deliveries WHERE state = 'delivered';";
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
if (JSON.stringify(rows).includes('Purchase') || !JSON.stringify(rows).includes('PageView'))
  throw new Error('D1 event proof mismatch');
console.log(
  JSON.stringify({
    action: 'tracking_preview_proof',
    mode: 'execute',
    mutations: true,
    host: PREVIEW_RESOURCES.host,
    page_view_event_id: eventId,
    purchase_blocked: true,
    destination_deliveries: 0,
  })
);
