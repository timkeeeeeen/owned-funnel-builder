import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  corsHeaders,
  createCsrfNonce,
  sameOriginNoCors,
  verifyCsrfNonce,
} from '../../functions/_lib/tracking-cors.ts';
import { resolvePrivacy, type StoredPrivacyChoice } from '../../functions/_lib/tracking-privacy.ts';
import { TRACKING_SECURITY_CONTRACT } from '../../functions/_lib/tracking-security-contract.ts';

const policy = { region: 'US', failClosed: false, policyVersion: '2026-08' };
const priorConsent = { region: 'EEA', failClosed: true, policyVersion: '2026-08' };
const request = (headers: HeadersInit = {}) =>
  new Request('https://events.shop.maestrogtm.com/v1/events', { headers });
const choices = (...values: StoredPrivacyChoice[]) => values;
const allowed = (decisions: ReturnType<typeof resolvePrivacy>, purpose: string) =>
  decisions.find((decision) => decision.purpose === purpose)?.allowed;

test('GPC and stored opt-outs override stale opt-in while US defaults remain enabled', () => {
  const staleOptIn: StoredPrivacyChoice = {
    purpose: 'advertising',
    allowed: true,
    policyVersion: 'old',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    source: 'ui',
    region: 'US',
  };
  const optOut: StoredPrivacyChoice = {
    purpose: 'analytics',
    allowed: false,
    policyVersion: 'old',
    effectiveAt: '2026-01-02T00:00:00.000Z',
    source: 'ui',
    region: 'US',
  };
  const state = resolvePrivacy(request({ 'Sec-GPC': '1' }), choices(staleOptIn, optOut), policy);

  assert.equal(allowed(state, 'necessary'), true);
  assert.equal(allowed(state, 'analytics'), false);
  assert.equal(allowed(state, 'advertising'), false);
  assert.equal(allowed(state, 'identity_enrichment'), false);
  assert.equal(allowed(state, 'sale_share'), false);
});

test('prior-consent, withdrawal, and unknown-region policy fail closed', () => {
  const consent: StoredPrivacyChoice = {
    purpose: 'analytics',
    allowed: true,
    policyVersion: '2026-08',
    effectiveAt: '2026-08-01T00:00:00.000Z',
    source: 'ui',
    region: 'EEA',
  };
  const withdrawal: StoredPrivacyChoice = {
    ...consent,
    allowed: false,
    effectiveAt: '2026-08-02T00:00:00.000Z',
  };

  assert.equal(allowed(resolvePrivacy(request(), [], priorConsent), 'analytics'), false);
  assert.equal(allowed(resolvePrivacy(request(), [consent], priorConsent), 'analytics'), true);
  assert.equal(
    allowed(resolvePrivacy(request(), [consent, withdrawal], priorConsent), 'analytics'),
    false
  );
  assert.equal(
    allowed(
      resolvePrivacy(request(), [], {
        region: 'unknown',
        failClosed: true,
        policyVersion: '2026-08',
      }),
      'advertising'
    ),
    false
  );
  assert.equal(
    allowed(
      resolvePrivacy(request(), [], {
        region: 'unknown',
        failClosed: false,
        policyVersion: '2026-08',
      }),
      'analytics'
    ),
    false
  );
});

test('returns credentialed CORS only for the exact configured origin', () => {
  const allowedOrigin = 'https://shop.maestrogtm.com';
  assert.equal(
    corsHeaders(allowedOrigin, [allowedOrigin], undefined as never).get(
      'Access-Control-Allow-Origin'
    ),
    null
  );
  const good = corsHeaders(allowedOrigin, [allowedOrigin], {
    host: 'events.shop.maestrogtm.com',
    allowedHost: 'events.shop.maestrogtm.com',
    preflightMethod: 'POST',
    requestedHeaders: 'content-type',
  });
  assert.equal(good.get('Access-Control-Allow-Origin'), allowedOrigin);
  assert.equal(good.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal(good.get('Vary'), 'Origin');

  for (const origin of [
    null,
    'null',
    'https://evil.shop.maestrogtm.com',
    'https://shop.maestrogtm.com:443',
    'http://shop.maestrogtm.com',
  ]) {
    assert.equal(
      corsHeaders(origin, [allowedOrigin], {
        host: 'events.shop.maestrogtm.com',
        allowedHost: 'events.shop.maestrogtm.com',
      }).get('Access-Control-Allow-Origin'),
      null
    );
  }
  assert.equal(
    corsHeaders(allowedOrigin, [allowedOrigin], {
      host: 'evil.shop.maestrogtm.com',
      allowedHost: 'events.shop.maestrogtm.com',
    }).get('Access-Control-Allow-Origin'),
    null
  );
  assert.equal(
    corsHeaders(allowedOrigin, [allowedOrigin], { preflightMethod: 'GET' }).get(
      'Access-Control-Allow-Origin'
    ),
    null
  );
});

test('CSRF nonce contract accepts only same-origin POSTs with the exact nonce', () => {
  const nonce = createCsrfNonce();
  const headers = {
    origin: 'https://shop.maestrogtm.com',
    'sec-fetch-site': 'same-origin',
    'x-csrf-nonce': nonce,
  };
  const requestWithNonce = new Request(
    'https://shop.maestrogtm.com/api/tracking/source-browser-events',
    { method: 'POST', headers }
  );
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    sameOriginNoCors(requestWithNonce, 'https://shop.maestrogtm.com', 'shop.maestrogtm.com'),
    true
  );
  assert.equal(
    verifyCsrfNonce(requestWithNonce, nonce, 'https://shop.maestrogtm.com', 'shop.maestrogtm.com'),
    true
  );
  assert.equal(
    verifyCsrfNonce(
      requestWithNonce,
      'wrong',
      'https://shop.maestrogtm.com',
      'shop.maestrogtm.com'
    ),
    false
  );
  assert.equal(
    sameOriginNoCors(
      new Request(requestWithNonce, { headers: { ...headers, 'sec-fetch-site': 'cross-site' } }),
      'https://shop.maestrogtm.com',
      'shop.maestrogtm.com'
    ),
    false
  );
});

test('exports the Worker/Pages parity security contract', () => {
  assert.equal(TRACKING_SECURITY_CONTRACT.cookieVersion, 'v2');
  assert.equal(TRACKING_SECURITY_CONTRACT.forbidsTrackingDbInPages, true);
  assert.deepEqual(TRACKING_SECURITY_CONTRACT.authoritativeEvents, [
    'Lead',
    'InitiateCheckout',
    'Purchase',
  ]);
});
