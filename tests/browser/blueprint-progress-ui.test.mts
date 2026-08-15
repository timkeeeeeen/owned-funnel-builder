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

type WatchResponse = Record<string, unknown>;

async function openRuntimePage(responses: WatchResponse[], withSession = true) {
  assert.ok(browser, 'browser must launch');
  assert.ok(server, 'static server must start');
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.addInitScript('globalThis.__name = (value) => value;');
  await context.addInitScript((hasSession) => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout = 0, ...args: unknown[]) =>
      nativeSetTimeout(handler, timeout === 5_000 ? 200 : timeout, ...args)) as typeof setTimeout;
    (
      window as typeof window & {
        turnstileRenders: number;
        turnstile: {
          render: (
            container: HTMLElement,
            options: { callback?: (token: string) => void }
          ) => string;
          reset: () => void;
        };
      }
    ).turnstileRenders = 0;
    (
      window as typeof window & {
        turnstileRenders: number;
        turnstile: {
          render: (
            container: HTMLElement,
            options: { callback?: (token: string) => void }
          ) => string;
          reset: () => void;
        };
      }
    ).turnstile = {
      render: (_container, options) => {
        (window as typeof window & { turnstileRenders: number }).turnstileRenders += 1;
        nativeSetTimeout(() => {
          if (typeof options.callback === 'function') options.callback('local-test-token');
        }, 0);
        return 'local-test-widget';
      },
      reset: () => {},
    };
    if (hasSession) {
      sessionStorage.setItem(
        'blueprint:session:solo-experts',
        JSON.stringify({
          publicSessionToken: 'local-session-token',
          publicSessionExpiresAt: Date.now() + 60_000,
          journeyId: 'journey_local_test_1234',
          checkoutIdempotencyKey: 'checkout_local_test',
          trackingContextToken: 'tracking-local-test',
        })
      );
    }
  }, withSession);

  const routePath = '/authority-snapshot/solo-experts/thank-you/';
  await context.route(`${server.origin}${routePath}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace('data-enabled="false"', 'data-enabled="true"')
      .replace(
        'data-convex-url data-app-url data-turnstile-site-key',
        'data-convex-url="https://local-test.convex.cloud" data-app-url="https://app.maestrogtm.com" data-turnstile-site-key="local-test-key"'
      );
    await route.fulfill({ response, body });
  });

  let requestCount = 0;
  await context.route('https://local-test.convex.cloud/api/query', async (route) => {
    const value = responses[Math.min(requestCount, responses.length - 1)] ?? {
      stage: 'failed',
    };
    requestCount += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value }),
    });
  });

  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${server.origin}${routePath}`);
  const runtime = page.locator('[data-blueprint-runtime]');
  assert.equal(await runtime.getAttribute('data-enabled'), 'true');
  assert.equal(await runtime.getAttribute('data-convex-url'), 'https://local-test.convex.cloud');
  assert.equal(await runtime.getAttribute('data-app-url'), 'https://app.maestrogtm.com');
  assert.equal(await runtime.getAttribute('data-turnstile-site-key'), 'local-test-key');
  await page
    .waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-blueprint-runtime]')?.dataset.initialized ===
        'true',
      undefined,
      { timeout: 5_000 }
    )
    .catch((error: unknown) => {
      throw new Error(
        `runtime did not initialize: ${error instanceof Error ? error.message : String(error)}; page errors: ${pageErrors.join(' | ')}`
      );
    });
  await page
    .waitForFunction(
      () => (window as typeof window & { turnstileRenders: number }).turnstileRenders === 1,
      undefined,
      { timeout: 5_000 }
    )
    .catch(async (error: unknown) => {
      const turnstileState = await page.evaluate(() => ({
        renders: (window as typeof window & { turnstileRenders: number }).turnstileRenders,
        type: typeof window.turnstile,
      }));
      throw new Error(
        `Turnstile did not render: ${error instanceof Error ? error.message : String(error)}; state: ${JSON.stringify(turnstileState)}; page errors: ${pageErrors.join(' | ')}`
      );
    });
  return { context, page, requestCount: () => requestCount };
}

function progress(
  events: Array<{ key: string; occurredAt: number; summary: string; previews: never[] }>,
  stallAfterMs = 10_000
) {
  return {
    startedAt: events[0]?.occurredAt ?? Date.now(),
    lastActivityAt: events.at(-1)?.occurredAt ?? Date.now(),
    stallAfterMs,
    sourceCounts: { profiles: 1, posts: 2, total: 3, truncated: false },
    events,
  };
}

function savedResult() {
  return {
    complete: true,
    authoritySnapshot: {
      total: 8,
      maximum: 10,
      dimensions: [],
      findings: [],
      unassessedDimensionKeys: [],
    },
    posts: [{ title: 'Verified starter', body: 'A durable saved post.' }],
    postOutcomes: [{ outcome: 'ready', questionsLeft: [] }],
  };
}

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

test('direct thank-you visits stay hidden and never watch', async () => {
  const { context, page, requestCount } = await openRuntimePage([], false);
  await assert.doesNotReject(
    page.locator('[data-blueprint-restart-link]').waitFor({ state: 'visible' })
  );
  assert.equal(await page.locator('[data-blueprint-progress]').getAttribute('hidden'), '');
  assert.equal(requestCount(), 0);
  await context.close();
});

test('watcher keeps exact receipt states through repeated, sparse, invalid, stalled, and failed polls', async () => {
  const now = Date.now();
  const accepted = {
    key: 'accepted',
    occurredAt: now,
    summary: 'Snapshot request accepted.',
    previews: [] as never[],
  };
  const evidence = {
    key: 'evidence_organized',
    occurredAt: now + 1,
    summary: 'Public evidence organized for evaluation.',
    previews: [] as never[],
  };
  const { context, page } = await openRuntimePage([
    { progress: progress([accepted]) },
    { progress: progress([accepted]) },
    { progress: progress([accepted, evidence]) },
    { progress: progress([accepted, evidence], 1) },
    { progress: { ...progress([accepted, evidence]), stallAfterMs: 0 } },
    { stage: 'failed' },
  ]);

  await page.locator('[data-blueprint-runtime-status]').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const status = document.querySelector('[data-blueprint-runtime-status]');
    if (!status) throw new Error('status missing');
    (window as typeof window & { statusMutations: number }).statusMutations = 0;
    new MutationObserver(() => {
      (window as typeof window & { statusMutations: number }).statusMutations += 1;
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });

  await page
    .locator('[data-blueprint-progress-step="evidence_organized"][data-state="current"]')
    .waitFor();
  assert.equal(
    await page
      .locator('[data-blueprint-progress-step="research_started"]')
      .getAttribute('data-state'),
    'pending'
  );
  await page.getByText('Still working — profile research can sometimes take longer.').waitFor();
  await page.locator('[data-blueprint-restart-link]').waitFor({ state: 'visible' });
  assert.equal(
    await page.evaluate(
      () => (window as typeof window & { statusMutations: number }).statusMutations
    ),
    3
  );
  assert.equal(
    await page
      .locator('[data-blueprint-progress-step="evidence_organized"]')
      .getAttribute('data-state'),
    'current'
  );
  assert.equal(
    await page.locator('[data-blueprint-result-content]').first().getAttribute('hidden'),
    ''
  );
  assert.equal(await page.locator('[data-blueprint-thank-you-checkout]').isDisabled(), true);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('blueprint:session:solo-experts')),
    null
  );
  await context.close();
});

test('synthetic completion stays hidden and locked', async () => {
  const now = Date.now();
  const { context, page } = await openRuntimePage([
    {
      complete: true,
      progress: progress([
        {
          key: 'result_finalized',
          occurredAt: now,
          summary: 'Snapshot finalized.',
          previews: [],
        },
      ]),
    },
  ]);
  await page.getByText('Your Snapshot is saved, but its result could not be displayed.').waitFor();
  assert.equal(
    await page.locator('[data-blueprint-result-content]').first().getAttribute('hidden'),
    ''
  );
  assert.equal(await page.locator('[data-blueprint-thank-you-checkout]').isDisabled(), true);
  await context.close();
});

test('durable completion reveals results, unlocks checkout, and restores after reload', async () => {
  const now = Date.now();
  const final = {
    ...savedResult(),
    progress: progress([
      {
        key: 'result_finalized',
        occurredAt: now,
        summary: 'Snapshot finalized.',
        previews: [],
      },
    ]),
  };
  const { context, page, requestCount } = await openRuntimePage([final, final]);
  await page.locator('[data-blueprint-result-content]').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-blueprint-progress]').getAttribute('hidden'), '');
  assert.equal(await page.locator('[data-blueprint-thank-you-checkout]').isEnabled(), true);
  assert.equal(
    await page.locator('[data-blueprint-draft-title]').textContent(),
    'Verified starter'
  );

  await page.reload();
  await page.locator('[data-blueprint-result-content]').first().waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('[data-blueprint-draft-title]').textContent(),
    'Verified starter'
  );
  assert.equal(requestCount(), 2);
  await context.close();
});
