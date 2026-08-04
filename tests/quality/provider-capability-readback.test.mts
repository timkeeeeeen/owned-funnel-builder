import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('provider capabilities remain disabled without a verified readback', async () => {
  const capabilities = JSON.parse(await readFile('config/provider-capabilities.json', 'utf8')) as { readback_status: string; providers: Array<{ enabled: boolean; readback: { status: string } }> };
  assert.equal(capabilities.readback_status, 'unverified');
  assert.ok(capabilities.providers.every((provider) => !provider.enabled && provider.readback.status === 'unverified'));
});
