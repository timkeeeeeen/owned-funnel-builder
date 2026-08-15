import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser } from 'playwright';
import {
  startStaticServer,
  type RunningStaticServer,
} from '../../tooling/quality/static-server.mts';

let browser: Browser | undefined;
let server: RunningStaticServer | undefined;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  server = await startStaticServer('dist/client');
});

after(async () => {
  await browser?.close();
  await server?.close();
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1366, height: 768 },
]) {
  test(`progress panel is accessible without overflow at ${viewport.width}px`, async () => {
    assert.ok(browser, 'browser must launch');
    assert.ok(server, 'static server must start');
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(`${server.origin}/authority-snapshot/solo-experts/thank-you/`);

    const panel = page.locator('[data-blueprint-progress]');
    assert.equal(await panel.getAttribute('hidden'), '');
    await panel.evaluate((element) => element.removeAttribute('hidden'));

    const rowBoxes = await panel.locator('[data-blueprint-progress-step]').evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect();
        return { left: box.left, right: box.right };
      })
    );
    assert.equal(rowBoxes.length, 7);
    for (const box of rowBoxes) {
      assert.ok(box.left >= 0, `progress row must not overflow left: ${box.left}px`);
      assert.ok(
        box.right <= viewport.width,
        `progress row must not overflow right: ${box.right - viewport.width}px`
      );
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert.ok(overflow <= 1, `page must not overflow horizontally: ${overflow}px`);

    const axe = await new AxeBuilder({ page }).include('[data-blueprint-progress]').analyze();
    const serious = axe.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? '')
    );
    assert.deepEqual(
      serious.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      })),
      []
    );
    await context.close();
  });
}

test('progress row transitions are disabled for reduced motion', async () => {
  assert.ok(browser, 'browser must launch');
  assert.ok(server, 'static server must start');
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`${server.origin}/authority-snapshot/solo-experts/thank-you/`);
  const panel = page.locator('[data-blueprint-progress]');
  await panel.evaluate((element) => element.removeAttribute('hidden'));
  const transitionProperty = await panel
    .locator('[data-blueprint-progress-step]')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionProperty);
  assert.equal(transitionProperty, 'none');
  await context.close();
});
