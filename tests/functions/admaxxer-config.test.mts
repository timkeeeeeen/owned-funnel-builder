import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../../functions/api/admaxxer-config';

test('public Admaxxer config exposes only browser-safe settings', async () => {
  const response = onRequestGet({
    request: new Request('https://shop.maestrogtm.com/api/admaxxer-config'),
    env: {
      PUBLIC_ADMAXXER_WEBSITE_ID: 'website-123',
      PUBLIC_ADMAXXER_DOMAIN: 'shop.maestrogtm.com',
      PUBLIC_ADMAXXER_SCRIPT_URL: 'https://admaxxer.example/script.js',
      ADMAXXER_API_KEY: 'private-api-key',
    },
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), {
    enabled: true,
    websiteId: 'website-123',
    domain: 'shop.maestrogtm.com',
    scriptUrl: 'https://admaxxer.example/script.js',
  });
  assert.doesNotMatch(body, /private-api-key/);
});

test('public Admaxxer config stays disabled when identity is incomplete', async () => {
  const response = onRequestGet({
    request: new Request('https://shop.maestrogtm.com/api/admaxxer-config'),
    env: { PUBLIC_ADMAXXER_WEBSITE_ID: 'website-123' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await response.text()), { enabled: false });
});
