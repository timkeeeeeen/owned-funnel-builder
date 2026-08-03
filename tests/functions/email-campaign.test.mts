import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { onRequestPost as campaign } from '../../functions/api/email/campaign.ts';
import type { D1Database, D1PreparedStatement, D1RunResult } from '../../functions/_lib/runtime.ts';

type Subscriber = { id: string; email: string };

class Statement implements D1PreparedStatement {
  private values: Array<string | number | null> = [];
  constructor(
    private readonly query: string,
    private readonly handle: (
      query: string,
      values: Array<string | number | null>,
      method: 'run' | 'first' | 'all'
    ) => unknown
  ) {}
  bind(...values: Array<string | number | null>): D1PreparedStatement {
    this.values = values;
    return this;
  }
  async run(): Promise<D1RunResult> {
    return this.handle(this.query, this.values, 'run') as D1RunResult;
  }
  async first<T>(): Promise<T | null> {
    return this.handle(this.query, this.values, 'first') as T | null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    return this.handle(this.query, this.values, 'all') as { results?: T[] };
  }
}

class CampaignDatabase implements D1Database {
  queries: string[] = [];
  campaignWrites = 0;
  recipientWrites = 0;
  recipientUpdates: Array<{ status: string; errorCode: string | number | null }> = [];
  constructor(
    private readonly options: {
      initialAudience?: Subscriber[];
      finalAudience?: Subscriber[];
    } = {}
  ) {}
  prepare(query: string): D1PreparedStatement {
    this.queries.push(query);
    return new Statement(query, (_statement, values, method) => {
      if (method === 'all' && query.includes('FROM email_subscribers')) {
        const audience = this.options.initialAudience ?? [
          { id: 'subscriber-1', email: 'one@example.com' },
          { id: 'subscriber-2', email: 'two@example.com' },
        ];
        return {
          results: query.includes('latest_consent')
            ? audience.filter((subscriber, index) =>
                audience.slice(0, index).every((earlier) => earlier.email !== subscriber.email)
              )
            : audience,
        };
      }
      if (method === 'all' && query.includes('FROM email_campaign_recipients')) {
        if (values[1] === 'pending' || values[1] === 'transient_failure') {
          return {
            results:
              this.options.finalAudience ??
              (values[1] === 'transient_failure'
                ? [{ id: 'subscriber-2', email: 'two@example.com' }]
                : this.options.initialAudience ?? [
                    { id: 'subscriber-1', email: 'one@example.com' },
                    { id: 'subscriber-2', email: 'two@example.com' },
                  ]),
          };
        }
        return {
          results: [{ id: 'subscriber-2', email: 'two@example.com' }],
        };
      }
      if (method === 'first' && query.includes('FROM email_campaigns')) {
        return {
          id: 'campaign-1',
          offer_slug: 'owned-funnel-builder',
          subject: 'A useful funnel update',
          preheader: 'One short update for builders.',
          text_body: 'Here is the update.',
          html_body: '<p>Here is the update.</p>',
        };
      }
      if (query.includes('INSERT INTO email_campaigns')) this.campaignWrites += 1;
      if (query.includes('INSERT INTO email_campaign_recipients')) this.recipientWrites += 1;
      if (query.includes('UPDATE email_campaign_recipients')) {
        this.recipientUpdates.push(
          query.includes("error_code = NULL")
            ? { status: 'permanent_failure', errorCode: null }
            : query.includes('provider_message_id = NULL')
              ? { status: String(values[0]), errorCode: values[1] as number | null }
              : { status: String(values[0]), errorCode: values[2] as number | null }
        );
      }
      if (method === 'run') return { success: true, meta: { changes: 1 } };
      if (method === 'all') return { results: [] };
      return null;
    });
  }
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const environment = (database: D1Database) => ({
  LEADS: database,
  EMAIL_OPERATOR_SECRET: 'operator-secret-at-least-32-characters',
  EMAIL_UNSUBSCRIBE_SECRET: 'unsubscribe-secret-at-least-32-characters',
  POSTMARK_SERVER_TOKEN: 'postmark-test',
  EMAIL_TRANSACTIONAL_FROM: 'Access <access@example.com>',
  EMAIL_MARKETING_FROM: 'Updates <updates@example.com>',
  EMAIL_REPLY_TO: 'help@example.com',
  EMAIL_SENDER_NAME: 'Owned Funnel Builder',
  EMAIL_POSTAL_ADDRESS: '123 Main Street, New York, NY 10001',
  PUBLIC_SITE_URL: 'https://funnels.example',
});

const request = (
  action: 'preview' | 'send' | 'retry',
  authorized = true,
  options: { offerSlug?: string | null } = {}
) =>
  new Request('https://funnels.example/api/email/campaign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorized ? { Authorization: 'Bearer operator-secret-at-least-32-characters' } : {}),
    },
    body: JSON.stringify({
      action,
      campaignId: action === 'retry' ? 'campaign-1' : undefined,
      ...(options.offerSlug === null
        ? {}
        : { offerSlug: options.offerSlug ?? 'owned-funnel-builder' }),
      subject: 'A useful funnel update',
      preheader: 'One short update for builders.',
      textBody: 'Here is the update.',
      htmlBody: '<p>Here is the update.</p>',
    }),
  });

test('campaign endpoint rejects unauthorized requests before querying subscribers', async () => {
  const database = new CampaignDatabase();
  const response = await campaign({
    request: request('preview', false),
    env: environment(database),
  });
  assert.equal(response.status, 401);
  assert.equal(database.queries.length, 0);
});

test('campaign preview counts only opted-in and non-suppressed subscribers', async () => {
  const database = new CampaignDatabase();
  const response = await campaign({ request: request('preview'), env: environment(database) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { eligibleRecipients: 2, capped: false });
  const audienceQuery = database.queries.find((query) => query.includes('FROM email_subscribers'));
  assert.match(audienceQuery ?? '', /status = 'subscribed'/);
  assert.match(audienceQuery ?? '', /email_suppressions/);
});

test('campaign send snapshots recipients and records Postmark results', async () => {
  const database = new CampaignDatabase();
  let providerBody: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    return Response.json([
      { ErrorCode: 0, Message: 'OK', MessageID: 'message-1' },
      { ErrorCode: 0, Message: 'OK', MessageID: 'message-2' },
    ]);
  };
  const response = await campaign({ request: request('send'), env: environment(database) });
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.accepted, 2);
  assert.equal(body.failed, 0);
  assert.equal(database.campaignWrites, 1);
  assert.equal(database.recipientWrites, 2);
  assert.equal(providerBody[0]?.ReplyTo, 'help@example.com');
  assert.deepEqual(
    (providerBody[0]?.TemplateModel as Record<string, unknown>).sender_name,
    'Owned Funnel Builder'
  );
});

test('campaign retry sends only transient failures without creating a new campaign', async () => {
  const database = new CampaignDatabase();
  let providerBody: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    return Response.json([{ ErrorCode: 0, Message: 'OK', MessageID: 'message-retry' }]);
  };

  const response = await campaign({ request: request('retry'), env: environment(database) });
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.campaignId, 'campaign-1');
  assert.equal(body.accepted, 1);
  assert.equal(providerBody.length, 1);
  assert.equal(database.campaignWrites, 0);
  assert.equal(database.recipientWrites, 0);
  assert.ok(
    database.queries.some(
      (query) =>
        query.includes('FROM email_campaign_recipients') && query.includes("'transient_failure'")
    )
  );
});

test('campaign rechecks suppression eligibility before its Postmark batch', async () => {
  const database = new CampaignDatabase({
    finalAudience: [{ id: 'subscriber-1', email: 'one@example.com' }],
  });
  let providerBody: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    return Response.json([{ ErrorCode: 0, Message: 'OK', MessageID: 'message-1' }]);
  };

  const response = await campaign({ request: request('send'), env: environment(database) });
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(providerBody.length, 1);
  assert.equal(body.failed, 1);
  assert.ok(
    database.recipientUpdates.some(
      (update) => update.status === 'permanent_failure' && update.errorCode === null
    )
  );
  assert.ok(
    database.queries.some((query) =>
      query.includes("error_message = 'Recipient was suppressed before delivery.'")
    )
  );
});

test('campaign records a terminal state when the Postmark batch request throws', async () => {
  const database = new CampaignDatabase();
  globalThis.fetch = async () => {
    throw new Error('network timeout');
  };

  const response = await campaign({ request: request('send'), env: environment(database) });

  assert.equal(response.status, 502);
  assert.equal(database.recipientUpdates.length, 2);
  assert.ok(database.recipientUpdates.every((update) => update.status === 'permanent_failure'));
  assert.ok(database.recipientUpdates.every((update) => update.errorCode === null));
});

test('global campaigns send only the newest subscribed consent per normalized email', async () => {
  const database = new CampaignDatabase({
    initialAudience: [
      { id: 'subscriber-new', email: 'person@example.com' },
      { id: 'subscriber-old', email: 'person@example.com' },
    ],
    finalAudience: [{ id: 'subscriber-new', email: 'person@example.com' }],
  });
  let providerBody: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    return Response.json([{ ErrorCode: 0, Message: 'OK', MessageID: 'message-1' }]);
  };

  const response = await campaign({
    request: request('send', true, { offerSlug: null }),
    env: environment(database),
  });

  assert.equal(response.status, 200);
  assert.equal(providerBody.length, 1);
  assert.equal(providerBody[0]?.To, 'person@example.com');
});
