import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deleteTrackingCookie,
  issueSignedCookie,
  trackingCookieNames,
  verifySignedCookie,
} from '../../functions/_lib/tracking-cookie.ts';

const secret = 'current-cookie-secret-that-is-long-enough';

test('issues parent-domain, HttpOnly, secure tracking cookies for 400 days', async () => {
  const cookie = await issueSignedCookie('ma_vid', 'visitor-1', 'current', 34_560_000, secret);

  assert.match(cookie, /^ma_vid=v1\.current\./);
  assert.match(cookie, /Max-Age=34560000/);
  assert.match(cookie, /Domain=shop\.maestrogtm\.com/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(await verifySignedCookie(cookie, 'ma_vid', { current: secret }), 'visitor-1');
});

test('accepts a previous signing key but rejects duplicate and forged cookies', async () => {
  const previous = await issueSignedCookie('ma_vid', 'old-visitor', 'previous', 34_560_000, 'old-secret');
  const current = await issueSignedCookie('ma_vid', 'new-visitor', 'current', 34_560_000, secret);

  assert.equal(
    await verifySignedCookie(previous, 'ma_vid', { current: secret, previous: 'old-secret' }),
    'old-visitor'
  );
  assert.equal(
    await verifySignedCookie(`${previous}; ${current}`, 'ma_vid', { current: secret, previous: 'old-secret' }),
    null
  );
  assert.equal(
    await verifySignedCookie(
      current.replace(/(ma_vid=v1\.current\.[^.]+\.)[^;]+/, '$1forged'),
      'ma_vid',
      { current: secret }
    ),
    null
  );
  assert.equal(
    await verifySignedCookie(current.replace('ma_vid=', 'ma_sid='), 'ma_sid', { current: secret }),
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
