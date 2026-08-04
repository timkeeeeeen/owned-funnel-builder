import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const comparisonPath = 'dist/client/owned-funnel-builder-video-lead/index.html';

test('the unpublished comparison build emits noindex metadata', async () => {
  const html = await readFile(comparisonPath, 'utf8');

  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});

test('the generated sitemap excludes only the unpublished comparison offer', async () => {
  const sitemap = await readFile('dist/client/sitemap-0.xml', 'utf8');

  assert.doesNotMatch(sitemap, /\/owned-funnel-builder-video-lead\//);
  assert.match(sitemap, /\/owned-funnel-builder\//);
});

test('rendered checkout keeps payment and analytics offer identities separate', async () => {
  const [comparisonHtml, originalHtml] = await Promise.all([
    readFile(comparisonPath, 'utf8'),
    readFile('dist/client/owned-funnel-builder/index.html', 'utf8'),
  ]);

  assert.match(comparisonHtml, /data-offer-slug="owned-funnel-builder"/);
  assert.match(comparisonHtml, /data-analytics-offer-slug="owned-funnel-builder-video-lead"/);
  assert.match(originalHtml, /data-offer-slug="owned-funnel-builder"/);
  assert.match(originalHtml, /data-analytics-offer-slug="owned-funnel-builder"/);
});
