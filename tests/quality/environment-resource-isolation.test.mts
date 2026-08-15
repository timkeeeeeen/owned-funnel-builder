import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Worker configuration keeps preview and live resource names distinct', async () => {
  const config = await readFile('workers/events/wrangler.jsonc', 'utf8');
  for (const pair of [['maestro-tracking-preview', 'maestro-tracking-live'], ['maestro-events-preview', 'maestro-events-live'], ['maestro-events-preview-dlq', 'maestro-events-live-dlq']]) {
    assert.match(config, new RegExp(pair[0]));
    assert.match(config, new RegExp(pair[1]));
    assert.notEqual(pair[0], pair[1]);
  }
});
