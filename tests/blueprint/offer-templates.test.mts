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

  const sectionMarkers = ['hero', 'included', 'features', 'proof', 'bonus', 'steps', 'faq'];
  let previousMarkerIndex = -1;
  for (const marker of sectionMarkers) {
    const markerIndex = source.indexOf(`data-video-lead="${marker}"`);
    assert.ok(markerIndex > previousMarkerIndex, `${marker} section must follow the prior section`);
    previousMarkerIndex = markerIndex;
  }

  assert.match(
    source,
    /const checkoutSlug = offer\.checkoutFunnelSlug \?\? offer\.slug;\s+const checkoutOffer = checkoutSlug === offer\.slug \? offer : \{ \.\.\.offer, slug: checkoutSlug \};/
  );
  assert.match(
    source,
    /<OfferCheckoutDialog offer=\{checkoutOffer\} checkout=\{checkoutOffer\.checkout\} \/>/
  );
  assert.match(source, /<OfferAnalytics offerSlug=\{offer\.slug\} \/>/);
  assert.equal((source.match(/data-offer-cta/g) ?? []).length, 4);
  assert.equal((source.match(/^\s*data-offer-checkout$/gm) ?? []).length, 4);
  assert.equal(
    (source.match(/data-offer-checkout-trigger=\{usesManagedCheckout \? '' : undefined\}/g) ?? [])
      .length,
    4
  );

  assert.match(source, /\.video-lead-theme \{/);
  assert.match(source, /--color-background: oklch\(100% 0 0\);/);
  assert.match(source, /--color-foreground: oklch\(19% 0\.01 260\);/);
  assert.match(source, /--color-card: oklch\(98% 0\.003 260\);/);
  assert.match(source, /--color-muted: oklch\(96\.8% 0\.003 260\);/);
  assert.match(source, /--color-muted-foreground: oklch\(49% 0\.012 260\);/);
  assert.match(source, /--color-border: oklch\(91\.5% 0\.006 260\);/);
  assert.match(source, /--color-brand: oklch\(56% 0\.21 255\);/);
  assert.match(source, /--color-brand-foreground: oklch\(100% 0 0\);/);
  assert.match(source, /--color-ring: var\(--color-brand\);/);
  assert.equal((source.match(/linear-gradient\(/g) ?? []).length, 1);
  assert.match(
    source,
    /background: linear-gradient\(135deg, oklch\(72% 0\.18 250\), oklch\(75% 0\.18 335\)\);/
  );
  assert.doesNotMatch(source, /perspective/i);
});
