import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { renderEmailSenderPage } from '../../scripts/email-sender-page.mjs';

test('local email sender renders preview and explicit confirmation without secrets', () => {
  const html = renderEmailSenderPage({
    token: 'browser-session-token',
    values: {
      offerSlug: 'owned-funnel-builder',
      subject: 'A useful update',
      preheader: 'Short preview',
      textBody: 'Plain text',
      htmlBody: '<p>HTML</p>',
    },
    preview: { eligibleRecipients: 14, capped: false },
  });
  assert.match(html, /14 eligible subscribers/);
  assert.match(html, /Confirm and send/);
  assert.match(html, /name="confirmation" value="SEND"/);
  assert.doesNotMatch(html, /operator-secret|postmark-token/);
  assert.match(html, /&lt;p&gt;HTML&lt;\/p&gt;/);
});

test('email sender server binds only to loopback', async () => {
  const source = await readFile(new URL('../../scripts/send-email.mjs', import.meta.url), 'utf8');
  assert.match(source, /listen\(0, '127\.0\.0\.1'/);
  assert.doesNotMatch(source, /listen\([^,]+, ['"]0\.0\.0\.0['"]/);
});
