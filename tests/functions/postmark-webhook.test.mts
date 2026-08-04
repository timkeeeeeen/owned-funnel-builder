import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onRequestPost as receivePostmarkWebhook } from '../../functions/api/webhooks/postmark.ts';
import type { D1Database, D1PreparedStatement, D1RunResult } from '../../functions/_lib/runtime.ts';

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

class WebhookDatabase implements D1Database {
  fingerprints = new Set<string>();
  suppressions = 0;
  suppression: {
    reason: string;
    source: string;
    suppressedAt: string;
    updatedAt: string;
  } | null = null;
  subscriberUpdates = 0;
  softBounces = 0;
  queries: string[] = [];
  prepare(query: string): D1PreparedStatement {
    this.queries.push(query);
    return new Statement(query, (_statement, values, method) => {
      if (query.includes('INSERT OR IGNORE INTO email_provider_events')) {
        const fingerprint = String(values[0]);
        if (this.fingerprints.has(fingerprint)) return { success: true, meta: { changes: 0 } };
        this.fingerprints.add(fingerprint);
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('INSERT INTO email_suppressions')) {
        if (query.includes("'soft_bounce'") && this.softBounces < 3) {
          return { success: true, meta: { changes: 0 } };
        }
        const reason = query.includes("'soft_bounce'") ? 'soft_bounce' : String(values[1]);
        const preserveExistingReason =
          query.includes("excluded.reason = 'unsubscribe'") &&
          reason === 'unsubscribe' &&
          this.suppression?.reason !== 'unsubscribe';
        const preserveExistingSuppression =
          query.includes("WHERE excluded.reason <> 'unsubscribe'") &&
          reason === 'unsubscribe' &&
          this.suppression?.reason !== 'unsubscribe';
        const onlyUpdateSoftBounce =
          query.includes("WHERE email_suppressions.reason = 'soft_bounce'") &&
          this.suppression?.reason !== 'soft_bounce';
        const suppressedAt = String(values[query.includes("'soft_bounce'") ? 1 : 2]);
        const updatedAt = String(values[query.includes("'soft_bounce'") ? 2 : 3]);
        if (!this.suppression) {
          this.suppression = { reason, source: 'postmark', suppressedAt, updatedAt };
        } else if (!preserveExistingSuppression && !onlyUpdateSoftBounce) {
          this.suppression = {
            reason: preserveExistingReason ? this.suppression.reason : reason,
            source: 'postmark',
            suppressedAt,
            updatedAt,
          };
        }
        this.suppressions += 1;
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('UPDATE email_subscribers')) {
        if (query.includes('soft_bounce_count')) this.softBounces += 1;
        this.subscriberUpdates += 1;
        return { success: true, meta: { changes: 1 } };
      }
      if (method === 'run') return { success: true, meta: { changes: 0 } };
      if (method === 'all') return { results: [] };
      return null;
    });
  }

  async batch(_statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    return [];
  }
}

const environment = (database: D1Database) => ({
  LEADS: database,
  POSTMARK_WEBHOOK_USERNAME: 'postmark',
  POSTMARK_WEBHOOK_PASSWORD: 'webhook-secret',
});

test('Postmark suppresses after three distinct soft bounces', async () => {
  const database = new WebhookDatabase();
  for (let index = 1; index <= 3; index += 1) {
    const response = await receivePostmarkWebhook({
      request: request({
        RecordType: 'Bounce',
        Type: 'SoftBounce',
        Email: 'person@example.com',
        MessageID: `message-soft-${index}`,
        MessageStream: 'broadcast',
        BouncedAt: `2026-08-0${index}T12:00:00.000Z`,
      }),
      env: environment(database),
    });
    assert.equal(response.status, 200);
  }
  assert.equal(database.softBounces, 3);
  assert.equal(database.suppressions, 1);
});

const request = (payload: Record<string, unknown>, authenticated = true) =>
  new Request('https://funnels.example/api/webhooks/postmark', {
    method: 'POST',
    headers: authenticated
      ? { Authorization: `Basic ${btoa('postmark:webhook-secret')}` }
      : undefined,
    body: JSON.stringify(payload),
  });

test('Postmark webhook authenticates before storing events', async () => {
  const database = new WebhookDatabase();
  const response = await receivePostmarkWebhook({
    request: request({ RecordType: 'Bounce' }, false),
    env: environment(database),
  });
  assert.equal(response.status, 401);
  assert.equal(database.queries.length, 0);
});

test('Postmark hard bounce suppresses marketing once across webhook retries', async () => {
  const database = new WebhookDatabase();
  const payload = {
    RecordType: 'Bounce',
    Type: 'HardBounce',
    Email: 'PERSON@example.com',
    MessageID: 'message-1',
    MessageStream: 'broadcast',
    BouncedAt: '2026-08-02T12:00:00.000Z',
  };
  const first = await receivePostmarkWebhook({
    request: request(payload),
    env: environment(database),
  });
  const duplicate = await receivePostmarkWebhook({
    request: request(payload),
    env: environment(database),
  });
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(database.fingerprints.size, 1);
  assert.equal(database.suppressions, 1);
  assert.equal(database.subscriberUpdates, 1);
  assert.equal(
    database.queries.some((query) => query.includes('payload_json')),
    false
  );
});

test('Postmark unsubscribe and spam complaint suppress marketing immediately', async () => {
  for (const payload of [
    {
      RecordType: 'SubscriptionChange',
      Recipient: 'person@example.com',
      MessageID: 'message-2',
      MessageStream: 'broadcast',
      SuppressSending: true,
      ChangedAt: '2026-08-02T12:00:00.000Z',
    },
    {
      RecordType: 'SpamComplaint',
      Email: 'person@example.com',
      MessageID: 'message-3',
      MessageStream: 'broadcast',
      BouncedAt: '2026-08-02T12:00:00.000Z',
    },
  ]) {
    const database = new WebhookDatabase();
    const response = await receivePostmarkWebhook({
      request: request(payload),
      env: environment(database),
    });
    assert.equal(response.status, 200);
    assert.equal(database.suppressions, 1);
  }
});

test('Postmark retains permanent and operator suppressions across later events', async () => {
  const database = new WebhookDatabase();
  const post = async (payload: Record<string, unknown>) => {
    const response = await receivePostmarkWebhook({
      request: request(payload),
      env: environment(database),
    });
    assert.equal(response.status, 200);
  };

  await post({
    RecordType: 'Bounce',
    Type: 'HardBounce',
    Email: 'person@example.com',
    MessageID: 'hard-bounce',
    MessageStream: 'broadcast',
    BouncedAt: '2026-08-02T12:00:00.000Z',
  });
  await post({
    RecordType: 'SubscriptionChange',
    Recipient: 'person@example.com',
    MessageID: 'unsubscribe',
    MessageStream: 'broadcast',
    SuppressSending: true,
    ChangedAt: '2026-08-03T12:00:00.000Z',
  });
  assert.equal(database.suppression?.reason, 'hard_bounce');

  for (let index = 1; index <= 3; index += 1) {
    await post({
      RecordType: 'Bounce',
      Type: 'SoftBounce',
      Email: 'person@example.com',
      MessageID: `soft-bounce-${index}`,
      MessageStream: 'broadcast',
      BouncedAt: `2026-08-0${index + 3}T12:00:00.000Z`,
    });
  }
  assert.equal(database.suppression?.reason, 'hard_bounce');

  const operatorDatabase = new WebhookDatabase();
  operatorDatabase.suppression = {
    reason: 'manual',
    source: 'operator',
    suppressedAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
  };
  for (let index = 1; index <= 3; index += 1) {
    const response = await receivePostmarkWebhook({
      request: request({
        RecordType: 'Bounce',
        Type: 'SoftBounce',
        Email: 'operator@example.com',
        MessageID: `operator-soft-bounce-${index}`,
        MessageStream: 'broadcast',
        BouncedAt: `2026-08-0${index + 3}T12:00:00.000Z`,
      }),
      env: environment(operatorDatabase),
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(operatorDatabase.suppression, {
    reason: 'manual',
    source: 'operator',
    suppressedAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
  });

  const operatorUnsubscribeDatabase = new WebhookDatabase();
  operatorUnsubscribeDatabase.suppression = {
    reason: 'manual',
    source: 'operator',
    suppressedAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
  };
  const response = await receivePostmarkWebhook({
    request: request({
      RecordType: 'SubscriptionChange',
      Recipient: 'operator@example.com',
      MessageID: 'operator-unsubscribe',
      MessageStream: 'broadcast',
      SuppressSending: true,
      ChangedAt: '2026-08-06T12:00:00.000Z',
    }),
    env: environment(operatorUnsubscribeDatabase),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(operatorUnsubscribeDatabase.suppression, {
    reason: 'manual',
    source: 'operator',
    suppressedAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
  });
});
