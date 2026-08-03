import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../../functions/_lib/emailTokens.ts';
import * as unsubscribeHandlers from '../../functions/api/email/unsubscribe.ts';
import { onRequestPost as unsubscribe } from '../../functions/api/email/unsubscribe.ts';
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

class UnsubscribeDatabase implements D1Database {
  subscriberStatus = 'subscribed';
  suppressions = 0;
  queries: string[] = [];
  prepare(query: string): D1PreparedStatement {
    this.queries.push(query);
    return new Statement(query, (_statement, values, method) => {
      if (query.includes('SELECT email FROM email_subscribers')) {
        return values[0] === 'subscriber-1' ? { email: 'person@example.com' } : null;
      }
      if (query.includes('UPDATE email_subscribers')) {
        this.subscriberStatus = 'unsubscribed';
        return { success: true, meta: { changes: 1 } };
      }
      if (query.includes('INSERT INTO email_suppressions')) {
        this.suppressions += 1;
        return { success: true, meta: { changes: 1 } };
      }
      if (method === 'run') return { success: true, meta: { changes: 0 } };
      if (method === 'all') return { results: [] };
      return null;
    });
  }
}

test('unsubscribe tokens reject tampering and expiry', async () => {
  const token = await createUnsubscribeToken({
    subscriberId: 'subscriber-1',
    secret: 'unsubscribe-secret-at-least-32-characters',
    nowSeconds: 1_000,
    ttlSeconds: 300,
  });
  assert.deepEqual(
    await verifyUnsubscribeToken({
      token,
      secret: 'unsubscribe-secret-at-least-32-characters',
      nowSeconds: 1_200,
    }),
    { subscriberId: 'subscriber-1' }
  );
  assert.equal(
    await verifyUnsubscribeToken({
      token: `${token.slice(0, -1)}x`,
      secret: 'unsubscribe-secret-at-least-32-characters',
      nowSeconds: 1_200,
    }),
    null
  );
  assert.equal(
    await verifyUnsubscribeToken({
      token,
      secret: 'unsubscribe-secret-at-least-32-characters',
      nowSeconds: 1_301,
    }),
    null
  );
});

test('unsubscribe immediately suppresses marketing and is idempotent', async () => {
  const database = new UnsubscribeDatabase();
  const secret = 'unsubscribe-secret-at-least-32-characters';
  const token = await createUnsubscribeToken({
    subscriberId: 'subscriber-1',
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const makeRequest = () =>
    new Request(`https://funnels.example/api/email/unsubscribe?token=${token}`, {
      method: 'POST',
    });

  const first = await unsubscribe({
    request: makeRequest(),
    env: { LEADS: database, EMAIL_UNSUBSCRIBE_SECRET: secret },
  });
  const duplicate = await unsubscribe({
    request: makeRequest(),
    env: { LEADS: database, EMAIL_UNSUBSCRIBE_SECRET: secret },
  });

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(database.subscriberStatus, 'unsubscribed');
  assert.equal(database.suppressions, 2);
  const suppressionWrite = database.queries.find((query) =>
    query.includes('INSERT INTO email_suppressions')
  );
  assert.match(suppressionWrite ?? '', /WHERE email_suppressions\.reason = 'unsubscribe'/);
});

test('visible unsubscribe links open a confirmation page without mutating consent', async () => {
  const database = new UnsubscribeDatabase();
  const secret = 'unsubscribe-secret-at-least-32-characters';
  const token = await createUnsubscribeToken({
    subscriberId: 'subscriber-1',
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const getHandler = (
    unsubscribeHandlers as unknown as {
      onRequestGet?: (context: {
        request: Request;
        env: { LEADS: D1Database; EMAIL_UNSUBSCRIBE_SECRET: string };
      }) => Promise<Response>;
    }
  ).onRequestGet;

  assert.equal(typeof getHandler, 'function');
  if (!getHandler) return;
  const response = await getHandler({
    request: new Request(
      `https://funnels.example/api/email/unsubscribe?token=${encodeURIComponent(token)}`
    ),
    env: { LEADS: database, EMAIL_UNSUBSCRIBE_SECRET: secret },
  });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /Confirm unsubscribe/i);
  assert.equal(database.subscriberStatus, 'subscribed');
  assert.equal(database.suppressions, 0);
});
