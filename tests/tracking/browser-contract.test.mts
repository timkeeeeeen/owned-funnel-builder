import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFile(new URL(path, `file://${repositoryRoot}/`), 'utf8');

test('the browser has one consent-gated tracker and no legacy Admaxxer pixel boundary', async () => {
  const [tracker, consent, layout, analytics] = await Promise.all([
    read('src/components/FirstPartyTracking.astro'),
    read('src/components/ConsentBanner.astro'),
    read('src/layouts/OfferLayout.astro'),
    read('src/components/offers/OfferAnalytics.astro'),
  ]);

  assert.match(tracker, /PUBLIC_META_PIXEL_ID/);
  assert.match(tracker, /events\.shop\.maestrogtm\.com\/v1\/events/);
  assert.match(tracker, /eventID/);
  assert.match(tracker, /collectPageView/);
  assert.match(tracker, /v1\/bootstrap/);
  assert.match(tracker, /source_system:\s*['"]event_worker['"]/);
  assert.match(tracker, /x-csrf-nonce/);
  assert.match(tracker, /x-tracking-context-hash/);
  assert.match(tracker, /policy_version/);
  assert.match(tracker, /pathname\}/);
  assert.doesNotMatch(tracker, /location\.hash/);
  assert.match(tracker, /credentials:\s*['"]include['"]/);
  assert.match(tracker, /keepalive/);
  assert.doesNotMatch(tracker, /sendBeacon/);
  assert.doesNotMatch(tracker, /sessionStorage/);
  assert.match(tracker, /fbclid/);
  assert.match(tracker, /_fbp/);
  assert.match(tracker, /_fbc/);
  assert.doesNotMatch(tracker, /identify\s*\(|email|phone|password/i);
  assert.doesNotMatch(layout, /AdmaxxerPixel/);
  assert.doesNotMatch(analytics, /admaxxer/i);

  for (const label of ['Accept all', 'Reject all', 'Customize']) {
    assert.match(consent, new RegExp(label));
  }
  assert.match(consent, /aria-(?:modal|live|label)/);
  assert.match(consent, /globalPrivacyControl|sec-gpc/i);
  assert.match(consent, /withdraw|reopen|preferences/i);
  assert.match(consent, /v1\/privacy/);
  assert.match(consent, /x-csrf-nonce/);
});

test('checkout emits non-PII Lead and InitiateCheckout payloads from the server response', async () => {
  const source = await read('src/components/offers/OfferCheckoutDialog.astro');
  assert.match(source, /\.track\(\s*['"]Lead['"]/);
  assert.match(source, /\.track\(\s*['"]InitiateCheckout['"]/);
  assert.match(source, /result\.(?:lead|leadEvent)/);
  assert.match(source, /result\.(?:initiateCheckout|initiate_checkout)/);
  assert.match(source, /event_id/);
  assert.doesNotMatch(source, /tracker\.(?:track|identify)[^\n]*(?:email|phone)/i);
  assert.doesNotMatch(source, /events\.shop\.maestrogtm\.com/);
});

test('completion claims purchases once and only sends newly returned claims to Pixel', async () => {
  const source = await read('src/pages/checkout/complete.astro');
  assert.match(source, /\/api\/funnel\/browser-events/);
  assert.match(source, /method:\s*['"]POST['"]/);
  assert.match(source, /credentials:\s*['"]same-origin['"]/);
  assert.match(source, /\.track\(['"]Purchase['"]/);
  assert.match(source, /event_id/);
  assert.match(source, /setTimeout|retry|attempt/i);
  assert.doesNotMatch(source, /events\.shop\.maestrogtm\.com/);
});

test('Blueprint checkout uses same-origin proxy routes and keeps bearer tokens out of URLs', async () => {
  const source = await read('src/scripts/blueprint-funnel-client.ts');
  assert.match(source, /\/api\/blueprint\/\$\{operation\}/);
  assert.match(source, /'checkout-start'/);
  assert.match(source, /'checkout-status'/);
  assert.match(source, /tracking_context_token/);
  assert.match(source, /candidate_event_id/);
  assert.doesNotMatch(source, /callConvex\(config,\s*['"]action['"]\s*,\s*CHECKOUT_START_PATH/);
  assert.doesNotMatch(source, /callConvex\(config,\s*['"]query['"]\s*,\s*CHECKOUT_STATUS_PATH/);
  assert.doesNotMatch(source, /[?&](?:token|tracking_context_token|authorization)=/i);
});
