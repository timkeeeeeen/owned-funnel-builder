# Authority Snapshot Progress Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the persisted-receipt Authority Snapshot progress experience from frozen candidate `9bd0460206562f10a04feca60f44376594d212fb` onto exact main `2a5f9318a92fe6ac3c798ddfd536af93a9be1032` without regressing newer tracking, video-lead, or market-plan behavior.

**Architecture:** Add one pure progress-projection module and let the existing five-second Snapshot watcher feed it. The thank-you page owns hidden semantic markup; the existing main client remains authoritative for sessions, durable result parsing, Turnstile, and tracking-aware checkout proxy calls.

**Tech Stack:** Astro 7, TypeScript 5.9, Node test runner, Playwright, Axe, Tailwind CSS.

## Global Constraints

- Main at `2a5f9318a92fe6ac3c798ddfd536af93a9be1032` is merge authority; frozen candidate `9bd0460206562f10a04feca60f44376594d212fb` is reference only.
- Do not port the candidate's Turnstile test bypass or direct checkout transport.
- Preserve `trackingContextToken`, `candidateEventId`, `/api/blueprint/checkout-start`, and `/api/blueprint/checkout-status` behavior.
- Do not change video-lead, market-plan, payment, deployment, campaign, live-traffic, or provider-credential behavior.
- Display only persisted redacted receipt summaries; never infer milestones, percentages, ETAs, model thoughts, raw source content, URLs, emails, or provider identifiers.
- Do not deploy production.
- Run build, test, typecheck, browser, hook, and review processes one at a time. Before the first gate, confirm the active template typecheck has exited and track any existing PID instead of relaunching it.

## File Map

- Create `src/scripts/blueprint-progress.ts`: strict public projection parser, monotonic merge, exact-receipt states, stall predicate.
- Create `tests/blueprint/progress.test.mts`: executable checks for parsing, future keys, sparse responses, stall threshold, and exact-receipt states.
- Modify `src/components/blueprint/SnapshotThankYouPage.astro`: hidden semantic timeline, restart link, and hidden real-result surfaces.
- Modify `src/scripts/blueprint-funnel-client.ts`: feed watch responses to the model, reconcile the panel, reveal only parsed durable results, preserve checkout proxy flow.
- Modify `tests/blueprint/contract.test.mts`: structural contract for the progress panel and preservation assertions for tracking checkout.
- Create `tests/browser/blueprint-progress-ui.test.mts`: built-output mobile/desktop, reduced-motion, overflow, and Axe review.

## Delivery Batches

### Batch 1: Receipt-driven progress recovery

- Tasks: 1-3.
- Branch: `codex/authority-progress-reconcile`.
- Base/PR target: `main` at `2a5f9318a92fe6ac3c798ddfd536af93a9be1032`.
- Focused checks: progress unit test; Blueprint suite; focused Prettier/ESLint; Blueprint proxy test; built progress UI browser test.
- Whole-batch review: one independent code review of `2a5f9318...HEAD`, followed by fixes only for verified in-scope findings.
- Required verification: one serialized `typecheck && build && check:functions` gate on the frozen head, then video-lead fold and market-plan focused tests against that same build.
- Frozen head: record after all fixes and before push.
- PR: one normal PR to `main`; merge only after independently green checks and review.

---

### Task 1: Pure persisted-receipt model

**Files:**

- Create: `src/scripts/blueprint-progress.ts`
- Create: `tests/blueprint/progress.test.mts`

**Interfaces:**

- Consumes: unknown `result.progress` values from the existing watch response.
- Produces: `parseBlueprintProgress`, `mergeBlueprintProgress`, `blueprintProgressStepStates`, `latestProgressEvent`, `isBlueprintProgressStalled`, and `BlueprintProgress`.

- [ ] **Step 1: Write the failing model tests**

Create `tests/blueprint/progress.test.mts` with five Node tests:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blueprintProgressStepStates,
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

test('never marks a milestone complete without its own persisted receipt', () => {
  const progress = parseBlueprintProgress({
    ...accepted,
    lastActivityAt: 300,
    events: [...accepted.events, { key: 'evidence_organized', occurredAt: 300, summary: 'Public evidence organized for evaluation.', previews: [] }],
  })!;
  assert.deepEqual(blueprintProgressStepStates(progress), [
    { key: 'accepted', state: 'complete' },
    { key: 'research_started', state: 'pending' },
    { key: 'sources_discovered', state: 'pending' },
    { key: 'evidence_organized', state: 'current' },
    { key: 'dimensions_evaluated', state: 'pending' },
    { key: 'post_drafting', state: 'pending' },
    { key: 'result_finalized', state: 'pending' },
  ]);
});
```

- [ ] **Step 2: Confirm no competing typecheck/test process before RED**

Run: `rtk proxy pgrep -af 'astro check|npm run typecheck|node .*--test|playwright'`

Expected: no active repository typecheck, test, or Playwright PID. If one exists, track that exact PID until it exits; do not launch another gate.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `rtk host-test-slot --class focused rtk node --import tsx --test tests/blueprint/progress.test.mts`

Expected: FAIL because `src/scripts/blueprint-progress.ts` does not exist.

- [ ] **Step 4: Implement the minimum pure model**

Create `src/scripts/blueprint-progress.ts` with the reviewed candidate implementation from `9bd0460`: the seven-key constant, strict nonnegative number/count parsing, maximum five validated previews, unknown-key filtering, monotonic merge, exact-receipt state derivation, and stall predicate. Copy the complete 141-line file from:

Run: `rtk git show 9bd0460206562f10a04feca60f44376594d212fb:src/scripts/blueprint-progress.ts`

The copied file must remain byte-for-byte identical at this task boundary:

Run: `rtk proxy zsh -c 'test "$(git show 9bd0460206562f10a04feca60f44376594d212fb:src/scripts/blueprint-progress.ts | shasum -a 256 | cut -d" " -f1)" = "$(shasum -a 256 src/scripts/blueprint-progress.ts | cut -d" " -f1)"'`

Expected: exit 0.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `rtk host-test-slot --class focused rtk node --import tsx --test tests/blueprint/progress.test.mts`

Expected: 5 tests pass.

- [ ] **Step 6: Commit the model**

Run:

```bash
rtk git add src/scripts/blueprint-progress.ts tests/blueprint/progress.test.mts
rtk git commit -m "feat: restore Snapshot progress receipts"
```

Expected: one focused commit; worktree clean.

### Task 2: Semantic panel and watcher reconciliation

**Files:**

- Modify: `src/components/blueprint/SnapshotThankYouPage.astro`
- Modify: `src/scripts/blueprint-funnel-client.ts`
- Modify: `tests/blueprint/contract.test.mts`

**Interfaces:**

- Consumes: Task 1's `BlueprintProgress` model and the existing `watchSnapshot` response.
- Produces: hidden `[data-blueprint-progress]`, seven receipt rows, source summary, elapsed label, restart link, hidden `[data-blueprint-result-content]`, and an optional watch update callback.

- [ ] **Step 1: Add failing structural contracts**

Append one contract test that reads the thank-you page and client and asserts:

```ts
test('the Snapshot wait screen exposes a truthful receipt-driven progress surface', async () => {
  const [page, client] = await Promise.all([
    readRepositoryFile('src/components/blueprint/SnapshotThankYouPage.astro'),
    readRepositoryFile('src/scripts/blueprint-funnel-client.ts'),
  ]);
  for (const key of [
    'accepted', 'research_started', 'sources_discovered', 'evidence_organized',
    'dimensions_evaluated', 'post_drafting', 'result_finalized',
  ]) assert.match(page, new RegExp(`data-blueprint-progress-step="${key}"`));
  assert.match(page, /data-blueprint-progress\s+hidden|hidden\s+data-blueprint-progress/);
  assert.match(page, /data-blueprint-result-content\s+hidden|hidden\s+data-blueprint-result-content/);
  assert.match(page, /data-blueprint-restart-link\s+hidden|hidden\s+data-blueprint-restart-link/);
  assert.match(page, /data-blueprint-progress-source-summary/);
  assert.match(page, /data-blueprint-progress-elapsed/);
  assert.match(page, /role="status"/);
  assert.match(client, /parseBlueprintProgress/);
  assert.match(client, /blueprintProgressStepStates/);
  assert.match(client, /\[data-blueprint-result-content\][^;]*removeAttribute\('hidden'\)/s);
  assert.doesNotMatch(client, /turnstile-disabled-for-testing/);
  assert.match(client, /callCheckoutProxy\(config, 'checkout-start'/);
  assert.match(client, /tracking_context_token: session\.trackingContextToken/);
});
```

- [ ] **Step 2: Run the Blueprint suite and verify RED**

Run: `rtk host-test-slot --class focused rtk npm run test:blueprint`

Expected: the new progress-surface assertions fail; all pre-existing tests remain green.

- [ ] **Step 3: Add the hidden accessible panel and result boundaries**

In `SnapshotThankYouPage.astro`:

- add `role="status"` and `aria-atomic="true"` to the existing runtime status;
- add a hidden `section[data-blueprint-progress]` labelled by `snapshot-progress-title`;
- render the seven keys as an ordered list, with `✓`, `●`, and `○` markers marked `aria-hidden="true"`;
- use `rounded-xl`, semantic color tokens, `transition-opacity duration-200 motion-reduce:transition-none`;
- use `grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]` and place each state label at `col-start-2 sm:col-start-auto` so 375px does not overflow;
- add hidden source-summary and elapsed/reload text;
- add a hidden restart link to `/authority-snapshot/${audience.slug}` with a 44px minimum target;
- add `data-blueprint-result-content hidden` to both the result grid and the downstream paid-next-step section.

Use these exact labels in order:

```ts
[
  ['accepted', 'Request accepted'],
  ['research_started', 'Researching your public profile'],
  ['sources_discovered', 'Finding public sources'],
  ['evidence_organized', 'Organizing evidence'],
  ['dimensions_evaluated', 'Evaluating authority dimensions'],
  ['post_drafting', 'Drafting your starter post'],
  ['result_finalized', 'Finalizing your Snapshot'],
]
```

- [ ] **Step 4: Reconcile valid watch responses without changing checkout transport**

At the top of `blueprint-funnel-client.ts`, replace `export {};` with:

```ts
import {
  blueprintProgressStepStates,
  isBlueprintProgressStalled,
  latestProgressEvent,
  mergeBlueprintProgress,
  parseBlueprintProgress,
  type BlueprintProgress,
} from './blueprint-progress';
```

Change `watchSnapshot` to accept `onUpdate?: (result: Record<string, unknown>) => void`, call it for each record before completion/failure checks, and preserve the existing query path and five-second delay.

In `initializeThankYou`, reveal restart for a missing session; otherwise reveal the panel, initialize `let latestProgress: BlueprintProgress | null = null`, pass an update callback that calls `renderSnapshotProgress`, hide the panel on a successfully parsed completion, and leave checkout enablement unchanged.

Add these helpers, using `textContent` through the existing `setText` helper:

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
  for (const { key, state } of blueprintProgressStepStates(progress)) {
    const row = panel.querySelector<HTMLElement>(`[data-blueprint-progress-step="${key}"]`);
    if (!row) continue;
    row.dataset.state = state;
    setText(row, '[data-blueprint-progress-marker]', state === 'complete' ? '✓' : state === 'current' ? '●' : '○');
    setText(row, '[data-blueprint-progress-state]', state === 'complete' ? 'Complete' : state === 'current' ? 'Latest update' : 'Waiting');
  }
  const sourceEvent = progress.events.find((event) => event.key === 'sources_discovered');
  const source = panel.querySelector<HTMLElement>('[data-blueprint-progress-source]');
  source?.toggleAttribute('hidden', !sourceEvent);
  if (sourceEvent) setText(panel, '[data-blueprint-progress-source-summary]', sourceEvent.summary);
  setText(panel, '[data-blueprint-progress-elapsed]', elapsedLabel(progress.startedAt, Date.now()));
  setStatus(config, isBlueprintProgressStalled(progress, Date.now())
    ? 'Still working — profile research can sometimes take longer. Your session is saved, and reloading is safe.'
    : (latest?.summary ?? 'Snapshot request accepted.'));
  return progress;
}

function elapsedLabel(startedAt: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  return minutes < 1 ? 'Elapsed: less than a minute' : `Elapsed: ${String(minutes)} min`;
}

function revealSnapshotRestart(config: RuntimeConfig) {
  if (config.mode === 'thank-you') {
    document.querySelector<HTMLElement>('[data-blueprint-restart-link]')?.removeAttribute('hidden');
  }
}
```

Call `revealSnapshotRestart(config)` on failed and expired watch states. After `renderSavedDraft` succeeds in `renderSavedSnapshot`, reveal every `[data-blueprint-result-content]` element. Do not edit `beginCheckoutForSession`, `callCheckoutProxy`, stored tracking fields, or Turnstile behavior.

- [ ] **Step 5: Run focused checks one at a time**

Run in order, waiting for each exact process to exit:

```bash
rtk host-test-slot --class focused rtk npm run test:blueprint
rtk prettier --check src/components/blueprint/SnapshotThankYouPage.astro src/scripts/blueprint-funnel-client.ts src/scripts/blueprint-progress.ts tests/blueprint/contract.test.mts tests/blueprint/progress.test.mts
rtk npm exec -- eslint src/scripts/blueprint-funnel-client.ts src/scripts/blueprint-progress.ts tests/blueprint/contract.test.mts tests/blueprint/progress.test.mts
rtk host-test-slot --class focused rtk node --import tsx --test tests/functions/blueprint-proxy.test.mts
```

Expected: all commands exit 0; Blueprint reports the added model and contract tests; proxy tests retain tracking token/candidate-event behavior.

- [ ] **Step 6: Inspect the minimal diff and commit**

Run: `rtk git diff --check && rtk git diff --stat af75efc...HEAD && rtk git status --short --branch`

Expected: only the design/plan, progress model/tests, thank-you page, client, and Blueprint contract changed.

Run:

```bash
rtk git add src/components/blueprint/SnapshotThankYouPage.astro src/scripts/blueprint-funnel-client.ts tests/blueprint/contract.test.mts
rtk git commit -m "feat: restore live Snapshot progress"
```

### Task 3: Built UI review, frozen-head verification, and PR

**Files:**

- Create: `tests/browser/blueprint-progress-ui.test.mts`
- Verify only: tracking, video-lead, market-plan, functions, and build outputs.

**Interfaces:**

- Consumes: built thank-you output from Tasks 1-2.
- Produces: one deterministic local UI review, one independent code-review verdict, a frozen verified SHA, and one normal PR.

- [ ] **Step 1: Write the deterministic built-output review**

Create one Node/Playwright test following `tests/browser/video-lead-fold.test.mts`. Start `dist/client` with `startStaticServer`, open `/authority-snapshot/solo-experts/thank-you/` at 375x812 and 1366x768, assert the progress panel starts hidden, reveal it with `removeAttribute('hidden')`, and assert every row stays inside the viewport. With reduced motion enabled, assert the first row's computed `transitionProperty` is `none`. Run `AxeBuilder` scoped to the revealed panel and fail on serious or critical violations. Close every page, browser, and server in `after`.

- [ ] **Step 2: Run the single broad build gate**

First run: `rtk proxy pgrep -af 'astro check|npm run typecheck|node .*--test|playwright'`

Expected: no competing gate. Then run one process with a 15-minute budget:

Run: `rtk host-test-slot --class full rtk zsh -lc 'rtk npm run typecheck && rtk npm run build && rtk npm run check:functions'`

Expected: typecheck 0 errors, Astro build and postbuild pass, Functions compile exits 0. Track this exact session if it yields; never relaunch it.

- [ ] **Step 3: Run focused built-output checks serially**

Run in order:

```bash
rtk host-test-slot --class focused rtk node --import tsx --test tests/browser/blueprint-progress-ui.test.mts
rtk host-test-slot --class focused rtk node --import tsx --test tests/browser/video-lead-fold.test.mts
rtk host-test-slot --class focused rtk node --import tsx --test tests/market-opportunity-plan.test.mts tests/build/offer-template-output.test.mjs
```

Expected: all pass against the same unchanged `dist/client` and delivery head.

- [ ] **Step 4: Commit the browser review and freeze the head**

Run:

```bash
rtk git add tests/browser/blueprint-progress-ui.test.mts
rtk git commit -m "test: review Snapshot progress UI"
rtk git diff --check
rtk git status --short --branch
rtk git rev-parse HEAD
```

Expected: clean worktree and one recorded frozen SHA.

- [ ] **Step 5: Perform one independent review**

Use `requesting-code-review` once on exact range `2a5f9318a92fe6ac3c798ddfd536af93a9be1032...<frozen-head>`. Require explicit checks for receipt honesty, privacy, direct-visit/failure/completion behavior, tracking proxy preservation, video-lead/market-plan non-regression, accessibility, and test adequacy. Apply only verified in-scope findings, then rerun only checks affected by changed files and freeze a new SHA.

- [ ] **Step 6: Audit the final diff before publication**

Run:

```bash
rtk git diff --name-status 2a5f9318a92fe6ac3c798ddfd536af93a9be1032...HEAD
rtk git diff --check
rtk git status --short --branch
rtk git grep -n 'turnstile-disabled-for-testing' HEAD -- src/scripts/blueprint-funnel-client.ts
rtk git grep -n "callCheckoutProxy(config, 'checkout-start'" HEAD -- src/scripts/blueprint-funnel-client.ts
rtk git grep -n 'tracking_context_token: session.trackingContextToken' HEAD -- src/scripts/blueprint-funnel-client.ts
```

Expected: only planned files changed; worktree clean; old bypass absent; main proxy/tracking assertions present.

- [ ] **Step 7: Push and open one normal PR**

Run:

```bash
rtk git push -u origin codex/authority-progress-reconcile
rtk gh pr create --base main --head codex/authority-progress-reconcile --title "feat: restore live Snapshot progress" --body 'Recovers the persisted-receipt Snapshot progress UI from frozen candidate 9bd0460206562f10a04feca60f44376594d212fb onto exact base 2a5f9318a92fe6ac3c798ddfd536af93a9be1032. Preserves the tracking-aware checkout proxy and newer video-lead and market-plan work; excludes the old Turnstile bypass. Verified with serialized Blueprint, proxy, typecheck, build, Functions, progress UI, video-lead, and market-plan checks plus one independent review. Production was not deployed.'
```

The PR body must name the exact base and frozen candidate, summarize the minimal boundary, list serialized checks and independent review evidence, and state that production was not deployed.

- [ ] **Step 8: Merge only if independently safe**

Inspect the PR head SHA, review state, checks, and mergeability. If the exact head is green and independently approved, merge normally through GitHub. Otherwise leave the PR open and report the specific blocker. Do not deploy or mutate any provider.
