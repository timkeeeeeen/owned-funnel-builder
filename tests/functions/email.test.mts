import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PostmarkEmailError, createPostmarkEmailProvider } from '../../functions/_lib/email.ts';
import {
  postmarkTemplates,
  postmarkWebhookDefinitions,
} from '../../scripts/lib/postmark-setup.mjs';

test('transactional email uses the outbound stream and stable metadata', async () => {
  let url = '';
  let headers: Headers | undefined;
  let body: Record<string, unknown> | undefined;
  const provider = createPostmarkEmailProvider({
    token: 'server-token',
    transactionalFrom: 'Access <access@example.com>',
    marketingFrom: 'Updates <updates@example.com>',
    fetch: async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ ErrorCode: 0, Message: 'OK', MessageID: 'message-1' });
    },
  });

  const result = await provider.sendTransactional({
    to: 'buyer@example.com',
    templateAlias: 'purchase-access',
    templateModel: { product_name: 'Owned Funnel Builder' },
    idempotencyKey: 'fulfillment:payment-1:product-1',
  });

  assert.equal(url, 'https://api.postmarkapp.com/email/withTemplate');
  assert.equal(headers?.get('X-Postmark-Server-Token'), 'server-token');
  assert.deepEqual(body, {
    From: 'Access <access@example.com>',
    To: 'buyer@example.com',
    TemplateAlias: 'purchase-access',
    TemplateModel: { product_name: 'Owned Funnel Builder' },
    MessageStream: 'outbound',
    TrackOpens: false,
    TrackLinks: 'None',
    Metadata: { idempotencyKey: 'fulfillment:payment-1:product-1' },
  });
  assert.deepEqual(result, { messageId: 'message-1' });
});

test('broadcast email uses the broadcast stream and preserves partial results', async () => {
  let body: Array<Record<string, unknown>> = [];
  const provider = createPostmarkEmailProvider({
    token: 'server-token',
    transactionalFrom: 'Access <access@example.com>',
    marketingFrom: 'Updates <updates@example.com>',
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      return Response.json([
        { ErrorCode: 0, Message: 'OK', MessageID: 'accepted-1' },
        { ErrorCode: 406, Message: 'Inactive recipient', MessageID: null },
      ]);
    },
  });

  const results = await provider.sendBroadcast([
    {
      recipientKey: 'subscriber-1',
      to: 'one@example.com',
      templateAlias: 'simple-broadcast',
      templateModel: { subject: 'News' },
      campaignId: 'campaign-1',
      unsubscribeUrl: 'https://funnels.example/api/email/unsubscribe?token=one',
    },
    {
      recipientKey: 'subscriber-2',
      to: 'two@example.com',
      templateAlias: 'simple-broadcast',
      templateModel: { subject: 'News' },
      campaignId: 'campaign-1',
      unsubscribeUrl: 'https://funnels.example/api/email/unsubscribe?token=two',
    },
  ]);

  assert.equal(body[0]?.MessageStream, 'broadcast');
  assert.equal(body[0]?.From, 'Updates <updates@example.com>');
  assert.deepEqual(results, [
    { recipientKey: 'subscriber-1', status: 'accepted', messageId: 'accepted-1' },
    {
      recipientKey: 'subscriber-2',
      status: 'permanent_failure',
      errorCode: 406,
      message: 'Inactive recipient',
    },
  ]);
});

test('Postmark transport failures classify retryable status codes', async () => {
  const provider = createPostmarkEmailProvider({
    token: 'server-token',
    transactionalFrom: 'Access <access@example.com>',
    marketingFrom: 'Updates <updates@example.com>',
    fetch: async () => Response.json({ Message: 'Busy' }, { status: 503 }),
  });

  await assert.rejects(
    provider.sendTransactional({
      to: 'buyer@example.com',
      templateAlias: 'purchase-access',
      templateModel: {},
      idempotencyKey: 'fulfillment:payment-1:product-1',
    }),
    (error: unknown) =>
      error instanceof PostmarkEmailError && error.retryable && error.status === 503
  );
});

test('Postmark setup defines stable transactional and broadcast templates', () => {
  const templates = postmarkTemplates();
  assert.deepEqual(
    templates.map((template) => template.Alias),
    ['purchase-access', 'simple-broadcast']
  );
  assert.match(templates[0]?.HtmlBody ?? '', /access_url/);
  assert.match(templates[1]?.HtmlBody ?? '', /unsubscribe_url/);
  assert.match(templates[1]?.HtmlBody ?? '', /postal_address/);
  assert.ok(templates.every((template) => template.TextBody));
});

test('Postmark setup creates authenticated webhooks for both message streams', () => {
  const webhooks = postmarkWebhookDefinitions({
    siteUrl: 'https://funnels.example',
    username: 'postmark',
    password: 'secret',
  });
  assert.deepEqual(
    webhooks.map((webhook) => webhook.MessageStream),
    ['outbound', 'broadcast']
  );
  assert.ok(
    webhooks.every((webhook) => webhook.Url === 'https://funnels.example/api/webhooks/postmark')
  );
  assert.ok(webhooks.every((webhook) => webhook.HttpAuth.Password === 'secret'));
});
