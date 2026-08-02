import http from 'node:http';
import { randomBytes } from 'node:crypto';

import { renderEmailSenderPage } from './email-sender-page.mjs';
import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const settings = await readLocalSettings();
const siteUrl = new URL(requireSetting(settings, 'PUBLIC_SITE_URL'));
const operatorSecret = requireSetting(settings, 'EMAIL_OPERATOR_SECRET');
const browserToken = randomBytes(24).toString('base64url');

const readForm = async (request) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 180_000) throw new Error('Email form is too large.');
  }
  return new URLSearchParams(body);
};

const valuesFrom = (form) => ({
  offerSlug: (form.get('offerSlug') ?? '').trim(),
  subject: (form.get('subject') ?? '').trim(),
  preheader: (form.get('preheader') ?? '').trim(),
  textBody: (form.get('textBody') ?? '').trim(),
  htmlBody: (form.get('htmlBody') ?? '').trim(),
});

const callCampaign = async (action, values) => {
  const response = await fetch(new URL('/api/email/campaign', siteUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operatorSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...values }),
    signal: AbortSignal.timeout(action === 'send' ? 60_000 : 15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Email service returned ${response.status}.`);
  return result;
};

const sendPage = (response, html, status = 200) => {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(html);
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (
    request.method === 'GET' &&
    url.pathname === '/email' &&
    url.searchParams.get('token') === browserToken
  ) {
    sendPage(response, renderEmailSenderPage({ token: browserToken }));
    return;
  }
  if (request.method === 'POST' && ['/preview', '/send'].includes(url.pathname)) {
    try {
      const form = await readForm(request);
      if (form.get('token') !== browserToken) {
        sendPage(response, 'This sender link is invalid.', 403);
        return;
      }
      const values = valuesFrom(form);
      if (url.pathname === '/send' && form.get('confirmation') !== 'SEND') {
        sendPage(
          response,
          renderEmailSenderPage({
            token: browserToken,
            values,
            error: 'Send confirmation is missing.',
          }),
          400
        );
        return;
      }
      const result = await callCampaign(url.pathname === '/send' ? 'send' : 'preview', values);
      sendPage(
        response,
        renderEmailSenderPage({
          token: browserToken,
          values,
          ...(url.pathname === '/send' ? { result } : { preview: result }),
        })
      );
      return;
    } catch (error) {
      sendPage(
        response,
        renderEmailSenderPage({
          token: browserToken,
          error: error instanceof Error ? error.message : 'Email request failed.',
        }),
        400
      );
      return;
    }
  }
  response.writeHead(404).end('Not found');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not open the email sender.');
  console.log(
    `Open this private email sender: http://127.0.0.1:${address.port}/email?token=${browserToken}`
  );
});
