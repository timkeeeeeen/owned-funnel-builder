import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveOfferTemplate } from '../../src/data/offerTemplates.ts';

test('offer templates default safely and reject unknown names', () => {
  assert.equal(resolveOfferTemplate(), 'default');
  assert.equal(resolveOfferTemplate('video-lead'), 'video-lead');
  assert.throws(() => resolveOfferTemplate('missing'), /Unknown offer template: missing/);
});

test('video-lead comparison reuses the original offer content and checkout', async () => {
  const original = JSON.parse(
    await readFile('src/content/offers/owned-funnel-builder.json', 'utf8')
  );
  const comparison = JSON.parse(
    await readFile('src/content/offers/owned-funnel-builder-video-lead.json', 'utf8')
  );

  assert.equal(comparison.published, false);
  assert.equal(comparison.slug, 'owned-funnel-builder-video-lead');
  assert.equal(comparison.template, 'video-lead');
  assert.equal(comparison.checkoutFunnelSlug, 'owned-funnel-builder');
  assert.equal(comparison.productName, original.productName);
  assert.equal(comparison.headline, original.headline);
  assert.equal(comparison.subheadline, original.subheadline);
  assert.deepEqual(comparison.included, original.included);
  assert.deepEqual(comparison.proof, original.proof);
  assert.deepEqual(comparison.faqs, original.faqs);
});

test('video-lead adapter forwards the checkout funnel slug', async () => {
  const source = await readFile(
    'src/components/offers/templates/VideoLeadOfferLandingPage.astro',
    'utf8'
  );

  assert.match(source, /const checkoutSlug = offer\.checkoutFunnelSlug \?\? offer\.slug;/);
  assert.match(source, /<OfferLandingPage offer=\{\{ \.\.\.offer, slug: checkoutSlug \}\} \/>/);
});
