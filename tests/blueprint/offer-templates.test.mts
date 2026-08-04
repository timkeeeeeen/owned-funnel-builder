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

test('video-lead template composes the complete dedicated landing page', async () => {
  const source = await readFile(
    'src/components/offers/templates/VideoLeadOfferLandingPage.astro',
    'utf8'
  );

  assert.match(source, /OfferCheckoutDialog/);
  assert.match(source, /OfferAnalytics/);
  assert.match(source, /video-lead-theme/);
  assert.match(source, /data-video-lead="hero"/);
  assert.match(source, /data-video-lead="included"/);
  assert.match(source, /data-video-lead="features"/);
  assert.match(source, /data-video-lead="proof"/);
  assert.match(source, /data-video-lead="bonus"/);
  assert.match(source, /data-video-lead="steps"/);
  assert.match(source, /data-video-lead="faq"/);
  assert.doesNotMatch(source, /strategy\.perspective|160 Qualified Leads|6,000\+ customers/);
});
