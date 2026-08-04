import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  InMemoryIdentityClaimStore,
  deriveAliasKey,
  deriveAliasKeysForRotation,
  resolveIdentityClaim,
} from '../../functions/_lib/tracking-identity.ts';

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

const aliasInput = {
  tenantId: 'tenant-a', identifierType: 'email', issuerNamespace: 'checkout', normalizationVersion: 'email-v1', canonicalValue: 'buyer@example.com',
};

test('derives domain-separated aliases and supports current/previous key lookup during rotation', async () => {
  const current = await hmacKey('current-identity-key');
  const previous = await hmacKey('previous-identity-key');
  const alias = await deriveAliasKey(aliasInput, current);
  const phoneAlias = await deriveAliasKey({ ...aliasInput, identifierType: 'phone' }, current);
  const normalizedAlias = await deriveAliasKey({ ...aliasInput, normalizationVersion: 'email-v2' }, current);
  const rotating = await deriveAliasKeysForRotation(aliasInput, { current: { id: 'new', key: current }, previous: { id: 'old', key: previous } });

  assert.notEqual(alias, phoneAlias);
  assert.notEqual(alias, normalizedAlias);
  assert.deepEqual(rotating.map(({ id }) => id), ['new', 'old']);
  assert.equal((await deriveAliasKeysForRotation(aliasInput, { current: { id: 'new', key: current } })).length, 1);
});

test('quarantines revoked and asserted conflicts without silently merging people', async () => {
  const store = new InMemoryIdentityClaimStore();
  store.revoke('revoked-alias');
  assert.deepEqual(
    await resolveIdentityClaim({ tenantId: 'tenant-a', aliasKey: 'revoked-alias', verificationClass: 'verified', store }),
    { personId: null, state: 'conflict' }
  );
  await store.seed('shared-alias', 'person-a', 'verified');
  assert.deepEqual(
    await resolveIdentityClaim({ tenantId: 'tenant-a', aliasKey: 'shared-alias', verificationClass: 'asserted', personId: 'person-b', store }),
    { personId: null, state: 'conflict' }
  );
  assert.equal(store.conflicts.length, 1);
});

test('concurrent verified claims choose a stable winner and record a redirect', async () => {
  const store = new InMemoryIdentityClaimStore();
  await store.seed('shared-alias', 'person-b', 'verified');
  const [first, second] = await Promise.all([
    resolveIdentityClaim({ tenantId: 'tenant-a', aliasKey: 'shared-alias', verificationClass: 'verified', personId: 'person-a', store }),
    resolveIdentityClaim({ tenantId: 'tenant-a', aliasKey: 'shared-alias', verificationClass: 'verified', personId: 'person-a', store }),
  ]);

  assert.equal(first.personId, 'person-a');
  assert.equal(second.personId, 'person-a');
  assert.equal(store.redirects.get('person-b'), 'person-a');
});
