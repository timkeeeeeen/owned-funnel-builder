import assert from 'node:assert/strict';
import { test } from 'node:test';

import { D1IdentityClaimStore } from '../../functions/_lib/tracking-identity.ts';
import type { D1Database } from '../../functions/_lib/runtime.ts';
import {
  createWorkerIdentityClaimStore,
  PAGES_TRACKING_SECURITY_BINDINGS,
} from '../../workers/events/src/tracking-security.ts';

test('the Worker owns the D1 identity adapter while Pages exposes no tracking D1 binding', () => {
  const database = {
    prepare: () => ({
      bind: () => ({
        run: async () => ({ success: true }),
        first: async () => null,
        all: async () => ({}),
      }),
    }),
    batch: async () => [],
  } as unknown as D1Database;
  assert.ok(
    createWorkerIdentityClaimStore({
      TRACKING_DB: database,
      TRACKING_IDENTITY_HMAC_KEY_ID: 'current',
    }) instanceof D1IdentityClaimStore
  );
  assert.equal('TRACKING_DB' in PAGES_TRACKING_SECURITY_BINDINGS, false);
});
