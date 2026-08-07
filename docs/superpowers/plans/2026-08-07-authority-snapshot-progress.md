# Authority Snapshot Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Authority Snapshot wait message with a truthful, reload-safe milestone timeline driven by Maestro's existing redacted progress receipts.

**Architecture:** Add one pure progress parser/state module and keep DOM rendering in the existing funnel client. The thank-you page owns static semantic markup; the existing five-second watch request supplies persisted events, counts, activity timestamps, completion, and failure without adding an endpoint or dependency.

**Tech Stack:** Astro 7, TypeScript 5.9, browser DOM APIs, Node test runner with `tsx`, Tailwind CSS, Cloudflare Pages.

## Global Constraints

- Every visible progress claim comes from a persisted backend receipt or the accepted local session fact.
- Do not add token streaming, partial scores/drafts, percentages, countdowns, dependencies, endpoints, or backend mutations.
- Never display captured source bodies, URLs, emails, provider identifiers, or internal errors.
- Unknown or malformed progress must not break completion polling.
- Rendering must be monotonic within a page visit and reconstruct from persisted receipts after reload.
- Announce only new milestones and stall/failure transitions; never announce the elapsed timer.
- Completion may unlock checkout only after the durable result parses successfully.
- Preserve the currently hidden synthetic result sections until successful parsing.

## Delivery Batches

### Batch 1: Truthful Snapshot progress experience

- Tasks: 1–3
- Branch/head: `codex/authority-runtime-enable` (working head `e0a9304`; freeze the implementation head after Task 3)
- Base: `b7f08d9`
- PR target: `main`
- Focused checks: pure progress tests, Blueprint contract tests, focused ESLint and Prettier
- Whole-batch review: inspect `rtk git diff b7f08d9...HEAD`, confirm no checkout/provider/tracking files changed, then run one code review
- Required verification: typecheck, production build, Pages Functions build, clean diff, exact-head Cloudflare deployment, and one same-tab production journey without checkout

---

### Task 1: Pure progress contract and monotonic state

**Files:**

- Create: `src/scripts/blueprint-progress.ts`
- Create: `tests/blueprint/progress.test.mts`

**Interfaces:**

- Consumes: untrusted `result.progress` JSON and `Date.now()` supplied by the caller.
- Produces: `parseBlueprintProgress(value): BlueprintProgress | null`, `mergeBlueprintProgress(previous, next): BlueprintProgress`, `latestProgressEvent(progress): BlueprintProgressEvent | null`, and `isBlueprintProgressStalled(progress, now): boolean`.

- [ ] **Step 1: Write failing parser and state tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBlueprintProgressStalled,
  latestProgressEvent,
  mergeBlueprintProgress,
  parseBlueprintProgress,
} from '../../src/scripts/blueprint-progress.ts';

const accepted = {
  startedAt: 100,
  lastActivityAt: 120,
  stallAfterMs: 120_000,
  sourceCounts: { profiles: 0, posts: 0, total: 0, truncated: false },
  events: [{ key: 'accepted', occurredAt: 100, summary: 'Snapshot request accepted.', previews: [] }],
};

test('parses only the redacted public progress contract', () => {
  const parsed = parseBlueprintProgress({
    ...accepted,
    secret: 'discard me',
    events: [{ ...accepted.events[0], rawBody: 'discard me' }],
  });
  assert.deepEqual(parsed, accepted);
});

test('ignores unknown events without rejecting valid progress', () => {
  const parsed = parseBlueprintProgress({
    ...accepted,
    events: [...accepted.events, { key: 'future_stage', occurredAt: 130, summary: 'Future.', previews: [] }],
  });
  assert.deepEqual(parsed?.events.map((event) => event.key), ['accepted']);
});

test('merges sparse responses without regressing reached milestones', () => {
  const research = parseBlueprintProgress({
    ...accepted,
    lastActivityAt: 200,
    events: [...accepted.events, { key: 'research_started', occurredAt: 200, summary: 'Research started.', previews: [] }],
  });
  const merged = mergeBlueprintProgress(research!, parseBlueprintProgress(accepted)!);
  assert.equal(latestProgressEvent(merged)?.key, 'research_started');
  assert.equal(merged.lastActivityAt, 200);
});

test('uses the server stall threshold against the last verified activity', () => {
  const progress = parseBlueprintProgress(accepted)!;
  assert.equal(isBlueprintProgressStalled(progress, 120_119), false);
  assert.equal(isBlueprintProgressStalled(progress, 120_120), true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk host-test-slot --class focused rtk node --import tsx --test tests/blueprint/progress.test.mts`

Expected: FAIL because `src/scripts/blueprint-progress.ts` does not exist.

- [ ] **Step 3: Implement the smallest strict parser and merge model**

```ts
export const BLUEPRINT_PROGRESS_KEYS = [
  'accepted',
  'research_started',
  'sources_discovered',
  'evidence_organized',
  'dimensions_evaluated',
  'post_drafting',
  'result_finalized',
] as const;

export type BlueprintProgressKey = (typeof BLUEPRINT_PROGRESS_KEYS)[number];
type BlueprintProgressEventKey = BlueprintProgressKey | 'failed';
export type BlueprintProgressEvent = {
  key: BlueprintProgressEventKey;
  occurredAt: number;
  summary: string;
  previews: Array<{ kind: 'profile' | 'post'; label: string; observedAt: number }>;
};
export type BlueprintProgress = {
  startedAt: number;
  lastActivityAt: number;
  stallAfterMs: number;
  sourceCounts: { profiles: number; posts: number; total: number; truncated: boolean };
  events: BlueprintProgressEvent[];
};

export function parseBlueprintProgress(value: unknown): BlueprintProgress | null {
  if (!isRecord(value) || !isRecord(value.sourceCounts) || !Array.isArray(value.events)) return null;
  const startedAt = number(value.startedAt);
  const lastActivityAt = number(value.lastActivityAt);
  const stallAfterMs = number(value.stallAfterMs);
  const profiles = count(value.sourceCounts.profiles);
  const posts = count(value.sourceCounts.posts);
  const total = count(value.sourceCounts.total);
  if (
    startedAt === null || lastActivityAt === null || stallAfterMs === null ||
    profiles === null || posts === null || total === null ||
    typeof value.sourceCounts.truncated !== 'boolean'
  ) return null;
  const events: BlueprintProgressEvent[] = [];
  for (const item of value.events) {
    if (!isRecord(item) || typeof item.key !== 'string') return null;
    if (![...BLUEPRINT_PROGRESS_KEYS, 'failed'].includes(item.key as BlueprintProgressEventKey)) continue;
    const occurredAt = number(item.occurredAt);
    if (occurredAt === null || typeof item.summary !== 'string' || !Array.isArray(item.previews)) return null;
    const previews = item.previews.slice(0, 5).map(parsePreview);
    if (previews.some((preview) => preview === null)) return null;
    events.push({
      key: item.key as BlueprintProgressEventKey,
      occurredAt,
      summary: item.summary,
      previews: previews.filter((preview) => preview !== null),
    });
  }
  return {
    startedAt,
    lastActivityAt,
    stallAfterMs,
    sourceCounts: { profiles, posts, total, truncated: value.sourceCounts.truncated },
    events: events.sort((left, right) => left.occurredAt - right.occurredAt),
  };
}

export function mergeBlueprintProgress(
  previous: BlueprintProgress,
  next: BlueprintProgress
): BlueprintProgress {
  const events = new Map(previous.events.map((event) => [event.key, event]));
  for (const event of next.events) {
    const current = events.get(event.key);
    if (!current || event.occurredAt >= current.occurredAt) events.set(event.key, event);
  }
  return {
    startedAt: Math.min(previous.startedAt, next.startedAt),
    lastActivityAt: Math.max(previous.lastActivityAt, next.lastActivityAt),
    stallAfterMs: next.stallAfterMs,
    sourceCounts: {
      profiles: Math.max(previous.sourceCounts.profiles, next.sourceCounts.profiles),
      posts: Math.max(previous.sourceCounts.posts, next.sourceCounts.posts),
      total: Math.max(previous.sourceCounts.total, next.sourceCounts.total),
      truncated: previous.sourceCounts.truncated || next.sourceCounts.truncated,
    },
    events: [...events.values()].sort((left, right) => left.occurredAt - right.occurredAt),
  };
}

export function latestProgressEvent(progress: BlueprintProgress) {
  return progress.events.at(-1) ?? null;
}

export function isBlueprintProgressStalled(progress: BlueprintProgress, now: number) {
  return now - progress.lastActivityAt >= progress.stallAfterMs;
}

function parsePreview(value: unknown): BlueprintProgressEvent['previews'][number] | null {
  if (!isRecord(value) || (value.kind !== 'profile' && value.kind !== 'post')) return null;
  const observedAt = number(value.observedAt);
  return typeof value.label === 'string' && observedAt !== null
    ? { kind: value.kind, label: value.label, observedAt }
    : null;
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `rtk host-test-slot --class focused rtk node --import tsx --test tests/blueprint/progress.test.mts`

Expected: 4 tests pass.

- [ ] **Step 5: Commit the pure model**

```bash
rtk git add src/scripts/blueprint-progress.ts tests/blueprint/progress.test.mts
rtk git commit -m "feat: model Snapshot progress receipts"
```

### Task 2: Semantic timeline and browser reconciliation

**Files:**

- Modify: `src/components/blueprint/SnapshotThankYouPage.astro`
- Modify: `src/scripts/blueprint-funnel-client.ts`
- Modify: `tests/blueprint/contract.test.mts`

**Interfaces:**

- Consumes: Task 1's parser, monotonic merge, newest-event, and stall functions.
- Produces: `[data-blueprint-progress]`, seven `[data-blueprint-progress-step]` rows, source receipt, elapsed label, and runtime reconciliation from `watchSnapshot`.

- [ ] **Step 1: Add failing DOM-contract assertions**

```ts
test('the Snapshot wait screen exposes a truthful seven-step progress surface', async () => {
  const page = await readRepositoryFile('src/components/blueprint/SnapshotThankYouPage.astro');
  const client = await readRepositoryFile('src/scripts/blueprint-funnel-client.ts');
  for (const key of [
    'accepted', 'research_started', 'sources_discovered', 'evidence_organized',
    'dimensions_evaluated', 'post_drafting', 'result_finalized',
  ]) assert.match(page, new RegExp(`data-blueprint-progress-step="${key}"`));
  assert.match(page, /data-blueprint-progress hidden/);
  assert.match(page, /data-blueprint-progress-source-summary/);
  assert.match(page, /data-blueprint-progress-elapsed/);
  assert.match(client, /parseBlueprintProgress/);
  assert.match(client, /isBlueprintProgressStalled/);
  assert.match(client, /data-blueprint-progress-step/);
});
```

- [ ] **Step 2: Run Blueprint tests and verify RED**

Run: `rtk host-test-slot --class focused rtk npm run test:blueprint`

Expected: the new seven-step progress contract fails.

- [ ] **Step 3: Add semantic hidden-by-default progress markup**

```astro
<section
  data-blueprint-progress
  hidden
  aria-labelledby="snapshot-progress-title"
  class="mt-8 max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
>
  <h2 id="snapshot-progress-title" class="text-xl font-bold sm:text-2xl">
    Building your Authority Snapshot
  </h2>
  <p
    data-blueprint-runtime-status
    role="status"
    aria-live="polite"
    aria-atomic="true"
    class="mt-2 text-sm font-semibold text-muted-foreground sm:text-base"
  >
    Snapshot request accepted.
  </p>
  <ol class="mt-6 grid gap-3">
    <li data-blueprint-progress-step="accepted" data-state="current" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">●</span>
      <span>Request accepted</span><span data-blueprint-progress-state>Latest update</span>
    </li>
    <li data-blueprint-progress-step="research_started" data-state="pending" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">○</span>
      <span>Researching your public profile</span><span data-blueprint-progress-state>Waiting</span>
    </li>
    <li data-blueprint-progress-step="sources_discovered" data-state="pending" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">○</span>
      <span>Finding public sources</span><span data-blueprint-progress-state>Waiting</span>
    </li>
    <li data-blueprint-progress-step="evidence_organized" data-state="pending" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">○</span>
      <span>Organizing evidence</span><span data-blueprint-progress-state>Waiting</span>
    </li>
    <li data-blueprint-progress-step="dimensions_evaluated" data-state="pending" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">○</span>
      <span>Evaluating authority dimensions</span><span data-blueprint-progress-state>Waiting</span>
    </li>
    <li data-blueprint-progress-step="post_drafting" data-state="pending" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">○</span>
      <span>Drafting your starter post</span><span data-blueprint-progress-state>Waiting</span>
    </li>
    <li data-blueprint-progress-step="result_finalized" data-state="pending" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm transition-opacity duration-200 data-[state=pending]:opacity-55 motion-reduce:transition-none">
      <span data-blueprint-progress-marker aria-hidden="true" class="font-bold text-brand">○</span>
      <span>Finalizing your Snapshot</span><span data-blueprint-progress-state>Waiting</span>
    </li>
  </ol>
  <p data-blueprint-progress-source hidden class="mt-4 rounded-xl border border-border px-4 py-3 text-sm font-semibold">
    <span data-blueprint-progress-source-summary></span>
  </p>
  <div class="mt-4 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
    <p data-blueprint-progress-elapsed>Elapsed: less than a minute</p>
    <p>Your session is saved. You can safely reload this page.</p>
  </div>
</section>
```

Use the existing semantic colors, card radius, border, spacing, and mobile-first utilities. State changes use text plus `✓`, `●`, or `○`; motion is limited to a 200 ms opacity transition under `prefers-reduced-motion: no-preference`.

- [ ] **Step 4: Wire the existing watch loop to render every valid receipt**

```ts
function renderSnapshotProgress(
  config: RuntimeConfig,
  result: Record<string, unknown>,
  previous: BlueprintProgress | null
) {
  const parsed = parseBlueprintProgress(result.progress);
  if (!parsed) return previous;
  const progress = previous ? mergeBlueprintProgress(previous, parsed) : parsed;
  const panel = document.querySelector<HTMLElement>('[data-blueprint-progress]');
  if (!panel) return progress;
  panel.removeAttribute('hidden');
  const latest = latestProgressEvent({
    ...progress,
    events: progress.events.filter((event) => event.key !== 'failed'),
  });
  const latestIndex = latest
    ? BLUEPRINT_PROGRESS_KEYS.findIndex((key) => key === latest.key)
    : 0;
  panel
    .querySelectorAll<HTMLElement>('[data-blueprint-progress-step]')
    .forEach((row, index) => {
      const state = index < latestIndex ? 'complete' : index === latestIndex ? 'current' : 'pending';
      row.dataset.state = state;
      setText(row, '[data-blueprint-progress-marker]', state === 'complete' ? '✓' : state === 'current' ? '●' : '○');
      setText(row, '[data-blueprint-progress-state]', state === 'complete' ? 'Complete' : state === 'current' ? 'Latest update' : 'Waiting');
    });
  const sources = panel?.querySelector<HTMLElement>('[data-blueprint-progress-source]');
  const sourceEvent = progress.events.find((event) => event.key === 'sources_discovered');
  sources?.toggleAttribute('hidden', !sourceEvent);
  if (sourceEvent) setText(panel, '[data-blueprint-progress-source-summary]', sourceEvent.summary);
  setText(panel, '[data-blueprint-progress-elapsed]', elapsedLabel(progress.startedAt, Date.now()));
  setStatus(
    config,
    isBlueprintProgressStalled(progress, Date.now())
      ? 'Still working — profile research can sometimes take longer. Your session is saved, and reloading is safe.'
      : latest?.summary ?? 'Snapshot request accepted.'
  );
  return progress;
}

async function watchSnapshot(
  config: RuntimeConfig,
  session: StoredSession,
  onComplete: (result: Record<string, unknown>) => void,
  onUpdate?: (result: Record<string, unknown>) => void
) {
  onUpdate?.(result);
}

function elapsedLabel(startedAt: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  return minutes < 1 ? 'Elapsed: less than a minute' : `Elapsed: ${String(minutes)} min`;
}
```

In `initializeThankYou`, add `let latestProgress: BlueprintProgress | null = null`, reveal `[data-blueprint-progress]` only after `readSession` succeeds, and pass this exact update callback:

```ts
(result) => {
  latestProgress = renderSnapshotProgress(config, result, latestProgress);
}
```

After `renderSavedSnapshot` succeeds, set `[data-blueprint-progress]` to hidden. In the existing failed-stage branch, reveal `[data-blueprint-restart-link]` when `config.mode === 'thank-you'`. Direct visits leave the progress panel hidden.

- [ ] **Step 5: Run progress and Blueprint tests and verify GREEN**

Run: `rtk host-test-slot --class focused rtk npm run test:blueprint`

Expected: all Blueprint tests pass, including progress parsing and the timeline contract.

- [ ] **Step 6: Run focused format and lint checks**

Run: `rtk prettier --check src/components/blueprint/SnapshotThankYouPage.astro src/scripts/blueprint-funnel-client.ts src/scripts/blueprint-progress.ts tests/blueprint/contract.test.mts tests/blueprint/progress.test.mts`

Run: `rtk eslint src/scripts/blueprint-funnel-client.ts src/scripts/blueprint-progress.ts tests/blueprint/contract.test.mts tests/blueprint/progress.test.mts`

Expected: both commands exit 0.

- [ ] **Step 7: Commit the timeline**

```bash
rtk git add src/components/blueprint/SnapshotThankYouPage.astro src/scripts/blueprint-funnel-client.ts tests/blueprint/contract.test.mts
rtk git commit -m "feat: show live Snapshot progress"
```

### Task 3: Integration review, release verification, and production proof

**Files:**

- Verify only; no planned source changes.

**Interfaces:**

- Consumes: the completed Batch 1 head.
- Produces: a frozen exact commit, Cloudflare deployment record, and production journey evidence.

- [ ] **Step 1: Review the whole batch and confirm scope**

Run: `rtk git diff --stat b7f08d9...HEAD && rtk git diff --check && rtk git status --short --branch`

Expected: only the design/plan, progress model/tests, thank-you component, and funnel client changed; worktree clean.

- [ ] **Step 2: Run the full local release gate through the shared semaphore**

Run: `rtk host-test-slot --class full rtk zsh -lc 'rtk npm run typecheck && rtk npm run build && rtk npm run check:functions'`

Expected: typecheck, production build, and Pages Functions compilation exit 0.

- [ ] **Step 3: Push and deploy the frozen exact head**

Run: `rtk git push origin codex/authority-runtime-enable`

Run: `rtk headless-bws-env exec rtk npm run publish`

Expected: Cloudflare reports a successful production deployment whose source equals `rtk git rev-parse HEAD`.

- [ ] **Step 4: Verify the custom-domain artifact**

Run: `rtk curl -fsSL https://shop.maestrogtm.com/authority-snapshot/solo-experts/thank-you/ | rtk rg 'data-blueprint-progress|data-blueprint-progress-step|data-blueprint-result-content hidden'`

Expected: the deployed HTML contains the hidden progress panel, all milestone rows, and hidden result sections.

- [ ] **Step 5: Run one same-tab production journey without checkout**

Use Playwright to submit the Snapshot, record milestone labels and source counts as they advance, verify synthetic results remain invisible, wait for the real result, verify progress hides and checkout unlocks, reload, and verify the same result restores. Do not select the checkout action or enter payment details.

Expected: at least two truthful milestone states are observed before completion; completion and reload pass; zero checkout-start requests occur.
