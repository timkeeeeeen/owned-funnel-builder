import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { startStaticServer, type RunningStaticServer } from '../../tooling/quality/static-server.mts';

let browser: Browser;
let server: RunningStaticServer;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  server = await startStaticServer('dist/client');
});

after(async () => {
  await browser.close();
  await server.close();
});

test('video and primary CTA fit inside a 1366x768 viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${server.origin}/owned-funnel-builder-video-lead/`);
  await page.evaluate(async () => document.fonts.ready);

  const media = page
    .locator('[data-video-lead="hero"] [role="img"], [data-video-lead="hero"] iframe')
    .first();
  const cta = page.locator('[data-video-lead="hero"] [data-placement="hero"]');
  const [mediaBox, ctaBox, viewportHeight, overflow] = await Promise.all([
    media.boundingBox(),
    cta.boundingBox(),
    page.evaluate(() => window.innerHeight),
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ]);

  assert.ok(mediaBox, 'hero media must render');
  assert.ok(ctaBox, 'hero CTA must render');
  assert.ok(mediaBox.x >= 0, 'hero media must not overflow left');
  assert.ok(mediaBox.y >= 0, 'hero media must not overflow above the viewport');
  assert.ok(mediaBox.x + mediaBox.width <= 1366, 'hero media must not overflow right');
  assert.ok(mediaBox.y + mediaBox.height <= viewportHeight, 'hero media must fit above the fold');
  assert.ok(ctaBox.x >= 0, 'hero CTA must not overflow left');
  assert.ok(ctaBox.y >= 0, 'hero CTA must not overflow above the viewport');
  assert.ok(ctaBox.x + ctaBox.width <= 1366, 'hero CTA must not overflow right');
  assert.ok(ctaBox.y + ctaBox.height <= viewportHeight, 'hero CTA must fit above the fold');
  assert.ok(overflow <= 1, `desktop page must not overflow horizontally: ${overflow}px`);
  await page.close();
});

test('mobile keeps its normal flow without horizontal overflow', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${server.origin}/owned-funnel-builder-video-lead/`);
  const cta = page.locator('[data-video-lead="hero"] [data-placement="hero"]');
  await cta.scrollIntoViewIfNeeded();
  const [box, overflow] = await Promise.all([
    cta.boundingBox(),
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ]);

  assert.ok(box, 'mobile hero CTA must remain reachable');
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'mobile hero CTA must stay inside the viewport');
  assert.ok(overflow <= 1, `mobile page must not overflow horizontally: ${overflow}px`);
  await page.close();
});
