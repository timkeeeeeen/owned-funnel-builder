import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deleteTrackingCookie,
  issueSignedCookie,
  trackingCookieNames,
  verifySignedCookie,
} from '../../functions/_lib/tracking-cookie.ts';

async function key(secret: string, usages: KeyUsage[] = ['sign', 'verify']): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

const context = { tenantId: 'tenant-a', siteId: 'shop', environment: 'live' } as const;

test('rejects cookie contexts outside the preview/live audience boundary', async () => {
  await assert.rejects(
    issueSignedCookie(
      { ...context, environment: 'production' as never, name: 'ma_vid', value: 'visitor-1', keyId: 'current', maxAge: 1 },
      await key('current-cookie-secret-that-is-long-enough', ['sign'])
    ),
    /Invalid tracking cookie/
  );
});

test('issues parent-domain, HttpOnly, secure tracking cookies for 400 days', async () => {
  const cookie = await issueSignedCookie({ ...context, name: 'ma_vid', value: 'visitor-1', keyId: 'current', maxAge: 34_560_000 }, await key('current-cookie-secret-that-is-long-enough', ['sign']));

  assert.match(cookie, /^ma_vid=v2\.current\./);
  assert.match(cookie, /Max-Age=34560000/);
  assert.match(cookie, /Domain=shop\.maestrogtm\.com/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(await verifySignedCookie(cookie, 'ma_vid', { current: await key('current-cookie-secret-that-is-long-enough', ['verify']) }, context), 'visitor-1');
});

test('accepts a previous signing key but rejects duplicate and forged cookies', async () => {
  const previous = await issueSignedCookie({ ...context, name: 'ma_vid', value: 'old-visitor', keyId: 'previous', maxAge: 34_560_000 }, await key('old-secret', ['sign']));
  const current = await issueSignedCookie({ ...context, name: 'ma_vid', value: 'new-visitor', keyId: 'current', maxAge: 34_560_000 }, await key('current-cookie-secret-that-is-long-enough', ['sign']));

  assert.equal(
    await verifySignedCookie(previous, 'ma_vid', { current: await key('current-cookie-secret-that-is-long-enough', ['verify']), previous: await key('old-secret', ['verify']) }, context),
    'old-visitor'
  );
  assert.equal(
    await verifySignedCookie(`${previous}; ${current}`, 'ma_vid', { current: await key('current-cookie-secret-that-is-long-enough', ['verify']), previous: await key('old-secret', ['verify']) }, context),
    null
  );
  assert.equal(
    await verifySignedCookie(
        current.replace(/(ma_vid=v2\.current\.[^.]+\.)[^;]+/, '$1forged'),
      'ma_vid',
      { current: await key('current-cookie-secret-that-is-long-enough', ['verify']) },
      context
    ),
    null
  );
  assert.equal(
    await verifySignedCookie(current.replace('ma_vid=', 'ma_sid='), 'ma_sid', { current: await key('current-cookie-secret-that-is-long-enough', ['verify']) }, context),
    null
  );
  assert.equal(
    await verifySignedCookie(current, 'ma_vid', { current: await key('current-cookie-secret-that-is-long-enough', ['verify']) }, { ...context, environment: 'preview' }),
    null
  );
});

test('issues only the privacy cookie before prior consent and deletes with the original scope', () => {
  assert.deepEqual(trackingCookieNames({ analytics: false, advertising: false }), ['ma_privacy']);
  assert.deepEqual(trackingCookieNames({ analytics: true, advertising: false }), [
    'ma_privacy',
    'ma_vid',
    'ma_sid',
  ]);

  const cleared = deleteTrackingCookie('ma_vid');
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Domain=shop\.maestrogtm\.com/);
  assert.match(cleared, /Path=\//);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Secure/);
  assert.match(cleared, /SameSite=Lax/);
});
