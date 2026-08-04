# Market Opportunity Plan Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, browser-viewable strategy page that turns the completed Meta-ad research and current Maestro/funnel portfolio into a prioritized offer, funnel, service, and product test plan.

**Architecture:** Add one static, `noindex` Astro route using the existing `OfferLayout` and design tokens. Keep its captured research records page-local, add one built-output behavior test, and avoid runtime APIs, client-side state, new components, and dependencies.

**Tech Stack:** Astro 7, Tailwind CSS 4, Node's built-in test runner

## Global Constraints

- Preserve every unrelated edit in the primary checkout; work only in the isolated `codex/market-opportunity-plan` worktree.
- Label active-ad duration and reachable pages as competitive-persistence signals, not verified sales, spend, profit, or ROAS.
- Preserve Maestro's invite-beta, source-backed, human-review, export-only launch boundary.
- Use exact landing-page and direct Meta Ad Library URLs from `/Users/headless/ad-research/meta-ads-live-shortlist.csv`.
- Keep the page unlinked from the public offer catalog and excluded from search indexing.
- Add no dependency, runtime request, form, custom global style, or reusable abstraction.

---

### Task 1: Static market opportunity plan

**Files:**

- Create: `tests/market-opportunity-plan.test.mts`
- Create: `src/pages/market-opportunity-plan.astro`

**Interfaces:**

- Consumes: `OfferLayout` from `src/layouts/OfferLayout.astro` and the repository's existing global design tokens.
- Produces: static route `/market-opportunity-plan/` and built file `dist/client/market-opportunity-plan/index.html`.

- [ ] **Step 1: Write the failing built-output behavior test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../dist/client/market-opportunity-plan/index.html', import.meta.url);

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
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk node --test tests/market-opportunity-plan.test.mts`

Expected: FAIL with `ENOENT` for `dist/client/market-opportunity-plan/index.html` because the route does not exist.

- [ ] **Step 3: Implement the static route**

Create `src/pages/market-opportunity-plan.astro` with:

- `OfferLayout` metadata title `Market Opportunity Plan — Maestro` and `noindex={true}`;
- a compact anchor navigation for recommendation, market demand, portfolio gaps, tests, products, evidence, and sequence;
- research facts `3,275 collected ads`, `411 curated combinations`, `159 high-signal funnels`, `150 live landing pages`, and `138 live-page advertisers`;
- the two recommended service lanes and an explicit rejection of generic agency positioning;
- the five current funnel families and their readiness boundaries;
- two complete free-to-recurring offer ladders;
- six prioritized funnel experiments covering direct-to-call, lead magnet, low-ticket, trial/demo, and checkout;
- explicit service decisions for web development, funnel building, ads management, and AI-brain implementation;
- ranked digital/SaaS candidates plus a do-not-build list;
- at least eighteen evidence records, each with advertiser, observed signal, exact landing page, and exact Meta Ad Library link;
- a 30-day sequence and shared pass, iterate, and kill rules.

Use semantic `header`, `nav`, `section`, `article`, `table`, and `footer` elements, one `h1`, sequential heading levels, responsive cards, and `overflow-x-auto` around comparison tables. Every external link uses `target="_blank" rel="noreferrer"` and names its destination.

- [ ] **Step 4: Build and verify GREEN**

Run: `rtk npm run build`

Expected: Astro reports the new `/market-opportunity-plan/index.html` route and exits 0.

Run: `rtk node --test tests/market-opportunity-plan.test.mts`

Expected: 1 test, 1 pass, 0 fail.

- [ ] **Step 5: Run focused repository checks**

Run: `rtk npm run typecheck`

Expected: Astro check exits 0 with no diagnostics.

Run: `rtk npm run test:quality`

Expected: all existing quality tests pass after the current build.

Run: `rtk npx prettier --check src/pages/market-opportunity-plan.astro tests/market-opportunity-plan.test.mts`

Expected: both files pass Prettier.

- [ ] **Step 6: Inspect the rendered page**

Start: `rtk npm run dev -- --host 127.0.0.1`

Inspect `/market-opportunity-plan/` at 375px and 1440px. Verify one clear first-fold recommendation, readable tables, no horizontal page overflow, visible keyboard focus, and working external landing/ad links.

- [ ] **Step 7: Commit the implementation**

```bash
rtk git add src/pages/market-opportunity-plan.astro tests/market-opportunity-plan.test.mts docs/superpowers/plans/2026-08-04-market-opportunity-plan.md
rtk git commit -m "feat: add market opportunity plan page"
```
