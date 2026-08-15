import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../dist/client/market-opportunity-plan/index.html', import.meta.url);
const sitemapUrl = new URL('../dist/client/sitemap-0.xml', import.meta.url);

test('builds the complete market opportunity decision page', async () => {
  const html = await readFile(pageUrl, 'utf8');

  assert.match(html, /The market is buying bounded outcomes/);
  assert.match(html, /Launch Rescue/);
  assert.match(html, /Source-Backed Growth System/);
  assert.match(html, /persistence signals, not verified profitability/i);
  assert.match(html, /Direct-to-call/);
  assert.match(html, /Lead magnet/);
  assert.match(html, /Low-ticket/);
  assert.match(html, /Trial \/ demo/);
  assert.match(html, /Checkout/);
  assert.match(html, /Digital and SaaS candidates/);
  assert.match(html, /https:\/\/go\.vibecodesherpa\.ai\/landers/);
  assert.match(html, /https:\/\/www\.facebook\.com\/ads\/library\/\?id=1755843278920686/);

  const scrollRegions = html.match(/<div[^>]+data-scroll-region[^>]*>/g) ?? [];
  assert.equal(scrollRegions.length, 5);
  for (const region of scrollRegions) {
    assert.match(region, /tabindex="0"/);
    assert.match(region, /aria-label=/);
  }
});

test('keeps the private planning page out of the sitemap', async () => {
  const sitemap = await readFile(sitemapUrl, 'utf8');

  assert.doesNotMatch(sitemap, /\/market-opportunity-plan\//);
});
