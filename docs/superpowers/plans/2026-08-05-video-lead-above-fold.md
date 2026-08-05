# Video Lead Above-the-Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the centered video-lead hero while fitting its complete media block and primary checkout button inside a 1366×768 desktop viewport.

**Architecture:** Make one responsive-layout change inside the existing `VideoLeadOfferLandingPage` template. Add one real-browser regression check against the built static page so the fold requirement is measured from element bounding boxes instead of inferred from CSS tokens.

**Tech Stack:** Astro, Tailwind CSS, Node test runner, Playwright, Cloudflare Pages

## Global Constraints

- Preserve the centered single-column composition, copy, checkout behavior, colors, and remaining page sections.
- At 1366×768, the hero video and primary hero button must have bounding rectangles fully inside the viewport.
- Keep the existing mobile flow and readable type sizes; do not force the entire mobile hero above the fold.
- Keep the CTA in normal document flow rather than making it sticky.
- Add no dependencies and do not modify payment, analytics, publication, or sitemap behavior.

## Delivery Batches

- **Batch 1 — strict fold fit:** Task 1 on branch `codex/video-lead-fold`, based on and targeting `main`. Focused checks: the browser regression and `npm run test:blueprint`. Whole-batch review: compare `origin/main...HEAD` against this plan and design spec. Required verification: `npm run typecheck && npm run build`, followed by the browser regression against that exact build.

---

### Task 1: Compact the centered hero at strict laptop height

**Files:**
- Create: `tests/browser/video-lead-fold.test.mts`
- Modify: `src/components/offers/templates/VideoLeadOfferLandingPage.astro:53-184`

**Interfaces:**
- Consumes: the built route at `/owned-funnel-builder-video-lead/`, the existing `data-video-lead="hero"` section marker, and the existing `data-placement="hero"` CTA marker.
- Produces: a centered responsive hero whose media and CTA bottoms are at or above `window.innerHeight` at 1366×768.

- [ ] **Step 1: Write the failing browser regression**

```ts
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
  const [mediaBox, ctaBox, viewportHeight] = await Promise.all([
    media.boundingBox(),
    cta.boundingBox(),
    page.evaluate(() => window.innerHeight),
  ]);

  assert.ok(mediaBox, 'hero media must render');
  assert.ok(ctaBox, 'hero CTA must render');
  assert.ok(mediaBox.y + mediaBox.height <= viewportHeight, 'hero media must fit above the fold');
  assert.ok(ctaBox.y + ctaBox.height <= viewportHeight, 'hero CTA must fit above the fold');
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
```

- [ ] **Step 2: Build the unchanged page and verify the desktop check fails for the fold assertion**

Run: `rtk npm run build && rtk node --import tsx --test tests/browser/video-lead-fold.test.mts`

Expected: build passes; the desktop test fails with `hero CTA must fit above the fold`; the mobile test passes.

- [ ] **Step 3: Apply the minimum responsive spacing and sizing changes**

In `VideoLeadOfferLandingPage.astro`, change only the hero classes:

```astro
<header class="px-4 py-3 sm:px-6 lg:py-2">
```

```astro
<section
  class="px-4 pb-20 pt-10 text-center sm:px-6 sm:pb-24 sm:pt-14 lg:pb-12 lg:pt-3"
```

```astro
class="mx-auto mt-3 max-w-4xl text-balance text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl md:text-[3.25rem] lg:text-[3.5rem]"
```

```astro
class="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg lg:max-w-3xl lg:text-base lg:leading-6"
```

```astro
class="mx-auto mt-6 max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:mt-5 lg:max-w-[35rem]"
```

For the fallback video card, add only desktop-density overrides:

```astro
class="flex min-h-[22rem] flex-col justify-between bg-foreground p-5 text-left text-background sm:aspect-video sm:min-h-0 sm:p-8 lg:p-5"
```

```astro
<div class="my-8 max-w-2xl lg:my-4">
  <p class="text-balance text-2xl font-semibold leading-tight sm:text-4xl lg:text-2xl">
```

```astro
<p class="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-background/70 sm:text-base lg:mt-3 lg:text-sm lg:leading-5">
```

```astro
<ol class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-1.5" aria-label="Launch workflow">
  <li class="rounded-xl border border-background/20 bg-background/5 p-3 lg:p-2">
```

Compact the CTA group and remove its redundant standalone desktop price because the button label already contains `$49`:

```astro
<div class="mx-auto mt-5 flex max-w-xl flex-col items-center gap-3 lg:mt-4 lg:gap-2">
  <p class="text-2xl font-bold tabular-nums lg:hidden">{offer.currentPrice}</p>
```

- [ ] **Step 4: Rebuild and verify the browser regression passes**

Run: `rtk npm run build && rtk node --import tsx --test tests/browser/video-lead-fold.test.mts`

Expected: 30 pages build; both browser tests pass.

- [ ] **Step 5: Run focused template coverage**

Run: `rtk npm run test:blueprint`

Expected: 24 tests pass, 0 fail.

- [ ] **Step 6: Commit the task**

```bash
rtk git add src/components/offers/templates/VideoLeadOfferLandingPage.astro tests/browser/video-lead-fold.test.mts
rtk git commit -m "fix: keep video lead CTA above fold"
```

- [ ] **Step 7: Run batch verification on the frozen head**

Run: `rtk npm run typecheck && rtk npm run build && rtk node --import tsx --test tests/browser/video-lead-fold.test.mts`

Expected: zero type errors; 30 pages build; both browser tests pass.

- [ ] **Step 8: Refresh the Cloudflare preview and verify its route**

Run: `rtk wrangler pages deploy dist/client --project-name owned-funnel-builder --branch video-lead-preview`

Expected: preview deployment succeeds and `https://video-lead-preview.owned-funnel-builder.pages.dev/owned-funnel-builder-video-lead/` returns HTTP 200.
