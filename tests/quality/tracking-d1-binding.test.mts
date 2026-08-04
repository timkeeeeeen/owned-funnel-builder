import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Pages and the events Worker retain separate D1 authorities', async () => {
  const [pages, worker] = await Promise.all([readFile('wrangler.jsonc', 'utf8'), readFile('workers/events/wrangler.jsonc', 'utf8')]);
  assert.match(pages, /"binding": "LEADS"/);
  assert.doesNotMatch(pages, /TRACKING_DB/);
  assert.match(worker, /"binding": "TRACKING_DB"/);
  assert.doesNotMatch(worker, /"binding": "LEADS"/);
});
