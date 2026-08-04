import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onRequestPost } from '../../functions/api/funnel/browser-events.ts';

test('legacy browser claims endpoint is disabled', async () => {
  const response = await onRequestPost({
    request: new Request('https://funnels.example/api/funnel/browser-events', { method: 'POST' }),
    env: {},
  });
  assert.equal(response.status, 403);
});
