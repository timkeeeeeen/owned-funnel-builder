import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSourceEventEnvelope, sourceSignatureInput, verifySignedBridge } from '../src/source-bridge.ts';
import { sourcePayloadHash } from '../../../functions/_lib/source-outbox.ts';

const snapshot = {
  schema_version: '1',
  server_subject_ref: 'subject_1',
  subject_ref_version: 'v1',
  snapshot_issued_at: new Date().toISOString(),
  snapshot_expires_at: new Date(Date.now() + 60_000).toISOString(),
  snapshot_key_id: 'privacy-current',
  snapshot_signature: 'signature_123456',
  purposes: { necessary: 'granted', analytics: 'granted', advertising: 'granted', identity_enrichment: 'unknown', sale_share: 'denied' },
  policy_version: '2026-08-04',
  choice_id: 'choice_1',
  decision_source: 'banner',
  notice_locale: 'en-US',
  region: 'US',
  region_source: 'cf',
  gpc: false,
  observed_at: new Date().toISOString(),
} as const;

function envelope() {
  return {
    schema_version: '1', source_system: 'pages', source_event_id: 'lead:1', event_name: 'Lead',
    occurred_at: new Date().toISOString(), context_hash: 'a'.repeat(64),
    context_expires_at: new Date(Date.now() + 60_000).toISOString(), funnel_slug: 'owned-funnel-builder',
    lead_id: 'lead_1', product_id: 'owned-funnel-builder', privacy_snapshot: snapshot,
  };
}

test('source envelope is strict and excludes raw buyer context', () => {
  assert.equal(parseSourceEventEnvelope(envelope(), 'pages').source_event_id, 'lead:1');
  assert.throws(() => parseSourceEventEnvelope({ ...envelope(), buyer_context: { email: 'a@b.test' } }, 'pages'));
  assert.throws(() => parseSourceEventEnvelope({ ...envelope(), source_system: 'blueprint' }, 'pages'));
});

test('source outboxes reject raw buyer context and legacy context aliases', async () => {
  await assert.rejects(() => sourcePayloadHash({ buyer_context: { email: 'a@b.test' } }));
  await assert.rejects(() => sourcePayloadHash({ tracking_context_hash: 'a'.repeat(64) }));
});

test('canonical bridge signature binds raw body bytes and nonce', async () => {
  const body = JSON.stringify(envelope());
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'A'.repeat(43);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('pages-secret-key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(await sourceSignatureInput(timestamp, nonce, body)));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const request = new Request('https://events.example.test/v1/source-events', {
    headers: {
      'X-Maestro-Issuer': 'pages', 'X-Maestro-Key-Id': 'pages-current',
      'X-Maestro-Timestamp': timestamp, 'X-Maestro-Nonce': nonce, 'X-Maestro-Signature': encoded,
    },
  });
  assert.equal(await verifySignedBridge(request, body, { TRACKING_PAGES_BRIDGE_KEY_CURRENT: 'pages-secret-key' }, 'pages', 'source-events'), true);
  assert.equal(await verifySignedBridge(request, `${body} `, { TRACKING_PAGES_BRIDGE_KEY_CURRENT: 'pages-secret-key' }, 'pages', 'source-events'), false);
});
