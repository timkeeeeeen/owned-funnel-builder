import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../dist/client/market-opportunity-plan/index.html', import.meta.url);
const sitemapUrl = new URL('../dist/client/sitemap-0.xml', import.meta.url);
const content360Landing =
  'https://get.content360.io/lifetime-page-3411?utm_source=facebook&utm_medium=ads&utm_campaign=%7B%7Bcampaign.name%7D%7D&utm_content=%7B%7Badset.name%7D%7D&utm_term=%7B%7Bad.name%7D%7D&campaign_id=%7B%7Bcampaign.id%7D%7D&adset_id=%7B%7Badset.id%7D%7D&ad_id=%7B%7Bad.id%7D%7D';

test('builds the complete market opportunity decision page', async () => {
  const html = await readFile(pageUrl, 'utf8');

  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal((html.match(/<main(?:\s|>)/g) ?? []).length, 1);
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
  assert.match(html, /Open Wonderment Apps landing page/);
  assert.match(html, /Open Wonderment Apps Meta ad/);
  assert.ok(html.includes(content360Landing.replaceAll('&', '&amp;')));

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
