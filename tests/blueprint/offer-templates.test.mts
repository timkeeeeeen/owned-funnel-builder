import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOfferTemplate } from '../../src/data/offerTemplates.ts';

test('offer templates default safely and reject unknown names', () => {
  assert.equal(resolveOfferTemplate(), 'default');
  assert.equal(resolveOfferTemplate('video-lead'), 'video-lead');
  assert.throws(() => resolveOfferTemplate('missing'), /Unknown offer template: missing/);
});
