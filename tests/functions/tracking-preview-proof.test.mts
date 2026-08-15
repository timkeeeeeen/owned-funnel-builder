import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../../functions/api/internal/tracking-preview-proof.ts';

test('Pages preview proof route is fail-closed outside the explicit preview gate', async () => {
  const request = new Request(
    'https://tracking-preview.owned-funnel-builder.pages.dev/api/internal/tracking-preview-proof',
    {
      method: 'POST',
      headers: { authorization: 'Bearer proof-secret', 'content-type': 'application/json' },
      body: '{}',
    }
  );
  assert.equal((await onRequestPost({ request, env: {} })).status, 401);
  assert.equal(
    (
      await onRequestPost({
        request,
        env: {
          TRACKING_ENVIRONMENT: 'preview',
          TRACKING_PREVIEW_NON_PAYMENT_PROOF: 'true',
          TRACKING_PREVIEW_PROOF_TOKEN: 'proof-secret',
        },
      })
    ).status,
    503
  );
});
