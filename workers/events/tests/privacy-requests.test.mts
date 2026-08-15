import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrivacyRequest, privacyRequestBody } from '../src/privacy-requests.ts';

test('privacy requests require a verified channel and create a tombstone before purge', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true });
  const env = { TINYBIRD_TOMBSTONE_APPEND_URL: 'https://tinybird.test/events', TINYBIRD_TOMBSTONE_APPEND_TOKEN: 'test-token', TRACKING_DB: { batch: async (statements: Array<{ run(): Promise<unknown> }>) => { for (const statement of statements) await statement.run(); return [{ success: true }]; }, prepare: (sql: string) => ({ bind: () => ({ run: async () => { calls.push(sql); return { success: true, meta: { changes: 1 } }; } }) }) } } as never;
  await createPrivacyRequest(env, { action: 'deletion', subjectId: 'visitor_1', verified: true });
  globalThis.fetch = originalFetch;
  assert.match(calls[0], /tracking_suppression_tombstones/);
  assert.throws(() => privacyRequestBody({ action: 'deletion', subject_id: 'visitor_1', verified: false }));
});

test('tombstone append failure leaves request pending', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'down' }, { status: 503 });
  const env = { TINYBIRD_TOMBSTONE_APPEND_URL: 'https://tinybird.test/events', TINYBIRD_TOMBSTONE_APPEND_TOKEN: 'test-token', TRACKING_DB: { batch: async (statements: Array<{ run(): Promise<unknown> }>) => { for (const statement of statements) await statement.run(); return [{ success: true }]; }, prepare: (sql: string) => ({ bind: () => ({ run: async () => { calls.push(sql); return { success: true, meta: { changes: 1 } }; } }) }) } } as never;
  await assert.rejects(createPrivacyRequest(env, { action: 'deletion', subjectId: 'visitor_1', verified: true }));
  globalThis.fetch = originalFetch;
  assert.equal(calls.some((sql) => sql.includes("state = 'tombstone_committed'")), false);
});
