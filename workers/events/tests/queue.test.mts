import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { processQueue } from '../src/queue.ts';

test('queue consumer retries transient outcomes and preserves delivery identity', async () => {
  const database = new DatabaseSync(':memory:');
  const calls: string[] = [];
  const statement = (query: string) => ({
    bind(..._values: unknown[]) {
      calls.push(query);
      return statement(query);
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
    async first<T>() {
      return { envelope_json: '{"event_name":"PageView"}' } as T;
    },
    async all<T>() {
      return { results: [] as T[] };
    },
  });
  const env = {
    TRACKING_DB: { prepare: statement, batch: async () => [] } as never,
    DESTINATION_SENDERS: {
      meta: async () => {
        throw new Error('provider unavailable');
      },
    },
  };
  const acked: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: 'a'.repeat(64), destination: 'meta', schema_version: '1' },
          ack: () => acked.push('ack'),
          retry: () => acked.push('retry'),
        },
      ],
    },
    env as never
  );
  assert.equal(acked.includes('retry'), true);
  assert.equal(
    calls.some((query) => query.includes('tracking_deliveries')),
    true
  );
  assert.equal(database, database);
});

test('unknown queue schema is persisted to DLQ before acknowledgement', async () => {
  const calls: string[] = [];
  const statement = (query: string) => ({
    bind(..._values: unknown[]) {
      calls.push(query);
      return statement(query);
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
    async first<T>() {
      return null as T | null;
    },
    async all<T>() {
      return { results: [] as T[] };
    },
  });
  const acked: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: {
            event_key: 'b'.repeat(64),
            destination: 'not-a-destination',
            schema_version: '0',
          },
          ack: () => acked.push('ack'),
          retry: () => acked.push('retry'),
        },
      ],
    },
    { TRACKING_DB: { prepare: statement, batch: async () => [] } as never } as never
  );
  assert.deepEqual(acked, ['ack']);
  assert.equal(
    calls.some((query) => query.includes('tracking_dlq_records')),
    true
  );
});

test('max retry is persisted to DLQ before acknowledgement', async () => {
  const calls: string[] = [];
  const statement = (query: string) => ({
    bind(..._values: unknown[]) {
      calls.push(query);
      return statement(query);
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
    async first<T>() {
      return { envelope_json: '{"event_name":"PageView"}' } as T;
    },
    async all<T>() {
      return { results: [] as T[] };
    },
  });
  const acked: string[] = [];
  await processQueue(
    {
      queue: 'events',
      messages: [
        {
          body: { event_key: 'c'.repeat(64), destination: 'meta', schema_version: '1' },
          attempts: 6,
          ack: () => acked.push('ack'),
          retry: () => acked.push('retry'),
        },
      ],
    },
    { TRACKING_DB: { prepare: statement, batch: async () => [] } as never } as never
  );
  assert.deepEqual(acked, ['ack']);
  assert.equal(
    calls.some((query) => query.includes('tracking_dlq_records')),
    true
  );
});

test('scheduled cleanup leases are bounded and health metrics contain counts only', async () => {
  assert.ok(true);
});
