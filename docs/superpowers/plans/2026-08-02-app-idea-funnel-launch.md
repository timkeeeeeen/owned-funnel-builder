# App Idea Evaluator Funnel Launch Implementation Plan

> **Superseded:** Tracking, identity, consent, and destination steps in this
> historical plan are replaced by
> `docs/superpowers/plans/2026-08-03-first-party-event-pipeline.md`. Do not
> enable Admaxxer or any legacy Meta sender from this document.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the merged App Idea Evaluator from its free Buildability
Report through the $29 Complete Build Pack with production Cloudflare, Convex,
Dodo, Admaxxer, Meta CAPI, support, and rollback evidence.

**Architecture:** Start from current `origin/main` in a clean worktree and close
only launch gaps. Keep the existing evaluator, Confect/Convex commerce,
checkpointed Build Pack, entitlement, Maestro credit, and analytics boundaries.
Land the existing Woodpecker adapter instead of creating another release path;
add Admaxxer at the durable-report and verified-payment boundaries.

**Tech Stack:** TypeScript, React/TanStack Start, Effect/Confect, Convex, Dodo,
Cloudflare, Woodpecker, Admaxxer, Meta CAPI, Vitest, and Playwright.

## Global Constraints

- Repository: `/Users/headless/maestro-template-saas-ui`; execute in a new clean
  worktree from current `origin/main`. Never use the dirty long-lived checkout.
- Historical context: ctx session `b1b2a005-b17b-745b-91cb-0c9e9eab4cec`,
  event `67f279e9-135f-7758-9dfb-6b8726770a6b`.
- PR 16 is merged at `4aa0b268a96a2c748018f39fb4e19679923b7c43`; PR 21
  refreshed the audit. Do not rebuild proven product behavior.
- Woodpecker is the only CI/deployment authority. Buildkite may be removed or
  described as historical, but must not be invoked or restored.
- Reuse the reviewed `feat/woodpecker-template-deployment` work if applicable to
  current main; do not reimplement its guarded deployment contracts.
- Staging and production must not share Convex, provider, Dodo, webhook,
  Cloudflare, hosted-URL, or Admaxxer authority.
- Dodo test mode proves fixtures, not the live payment path. The paid canary uses
  one temporary non-public live `$1 USD` Build Pack product only after the owner
  separately approves the charge, test identity, card-entry moment, and refund.
- The owner enters card data directly in hosted Dodo checkout. It never enters
  an agent, tool, log, file, or repository.
- Never log or commit secrets, emails, raw ideas/reports, payment bodies, or
  visitor IDs.

## File And Boundary Map

- `.woodpecker/verify.yml`, `.woodpecker/deploy.yml`: sole hosted gates and
  staging/production promotion.
- `tooling/ci/staging-deploy.sh`, `production-promote.sh`,
  `rollback-promote.sh`: existing guarded release contracts.
- `docs/template/env-manifest.json`, `env-manifest.md`: environment ownership.
- `tooling/generators/src/workflow-output-smoke.ts`: configured Convex proof;
  never weaken or fake it.
- `apps/web/src/features/public-funnel/funnel-analytics.ts`: durable Lead.
- `packages/convex/confect/commerce/checkout.impl.ts`: visitor metadata.
- `packages/convex/confect/commerce/webhooks.impl.ts`: verified product/payment,
  actual paid amount, equal credit, and revocation authority.
- `packages/integrations/src/admaxxer.ts`: minimal server payment adapter.
- `docs/template/app-idea-funnel-launch-audit.md`: release evidence.

---

### Task 1: Establish A Clean Release Baseline

**Files:**

- Modify: `docs/template/app-idea-funnel-launch-audit.md`

**Interfaces:** Produces exact source/deployment SHAs, environment names,
unresolved bindings, current route state, and rollback coordinates from
read-only provider state.

- [ ] **Step 1: Create a clean worktree and record the base**

Use `superpowers:using-git-worktrees`, fetch current main, then run:

```bash
rtk git status --short
rtk git rev-parse HEAD
rtk git log -1 --oneline
```

Expected: clean current `origin/main`, including PRs 16 and 21.

- [ ] **Step 2: Refresh the audit without guessing**

Read back the production hostname, deployed SHA/date, Cloudflare project,
Convex deployment, runtime mode, Dodo environment, public routes, and rollback
version. Store redacted identifiers; mark absent values `unverified`.

- [ ] **Step 3: Commit the baseline**

```bash
rtk git add docs/template/app-idea-funnel-launch-audit.md
rtk git commit -m "docs: record App Idea release baseline"
```

### Task 2: Land Woodpecker As Deployment Authority

**Work package:** `template-gap`

**Files:**

- Create/adopt: `.woodpecker/verify.yml`, `.woodpecker/deploy.yml`
- Move/adopt: `tooling/ci/*.sh`
- Modify: `docs/template/env-manifest.json`, `docs/template/env-manifest.md`
- Modify: `docs/template/system-decisions/deployment-authority.md`
- Test: `tooling/quality/woodpecker-template-pipeline.test.mts`
- Modify only as required: existing release/quality files listed by
  `feat/woodpecker-template-deployment`
- Delete after parity proof: `.buildkite/pipeline.yml`,
  `.buildkite/scripts/upload-pipeline.sh`

**Interfaces:** Produces Woodpecker verify, staging, production, and rollback
targets while preserving signed receipts, exact-SHA checks, canaries, and
environment-isolated `TEMPLATE_STAGING_*` / `TEMPLATE_PRODUCTION_*` bindings.

- [ ] **Step 1: Compare the reviewed adapter with current main**

```bash
rtk git diff --stat origin/main..feat/woodpecker-template-deployment
rtk git diff --check origin/main..feat/woodpecker-template-deployment
```

Adopt the existing branch through review or rebase only minimal current-main
conflict fixes. Do not create a second adapter.

- [ ] **Step 2: Confirm unadapted main fails authority tests**

```bash
rtk host-test-slot --class focused pnpm exec vitest run tooling/quality/woodpecker-template-pipeline.test.mts tooling/quality/check-deploy-authority.test.mts
```

Expected: FAIL because `.woodpecker` is absent and Buildkite remains configured.

- [ ] **Step 3: Adopt the adapter and migrate the manifest**

Preserve guarded release APIs. Remove Buildkite authority entries; add
Woodpecker repository, token, and deployment-target ownership without renaming
product-provider bindings.

- [ ] **Step 4: Pass authority and secret-boundary tests**

```bash
rtk host-test-slot --class focused pnpm exec vitest run tooling/quality/woodpecker-template-pipeline.test.mts tooling/quality/check-deploy-authority.test.mts tooling/quality/src/env-manifest.test.mts
rtk pnpm check:secret-canaries
```

- [ ] **Step 5: Commit or merge the reviewed adapter**

```bash
rtk git add .woodpecker tooling/ci docs/template tooling/quality tooling/release package.json project.config.json
rtk git commit -m "ci: make Woodpecker the template deploy authority"
```

### Task 3: Add Durable Lead And Visitor Attribution

**Files:**

- Modify/Test: `apps/web/src/features/public-funnel/funnel-analytics.ts`
- Modify/Test: `apps/web/src/features/public-funnel/intake/evaluation-adapter.ts`
- Modify/Test: `apps/web/src/features/public-funnel/checkout/checkout-route.tsx`
- Modify: `apps/web/src/routes/privacy.tsx`

**Interfaces:** Produces one Admaxxer Lead only after a Buildability Report is
durably saved/claimed and optional sanitized `admaxxerVisitorId` on checkout.
Consumes existing consent, event dedupe, report/evaluation ID, owner-safe email,
UTMs, and `fbclid`; idea/report text never enters analytics.

- [ ] **Step 1: Write failing tests**

Assert no Lead on typing, validation error, or provider failure; one Lead after
the durable report result; no replay duplicate; no browser Purchase; and an
optional visitor ID in checkout arguments but never in URLs.

- [ ] **Step 2: Confirm focused failure**

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- funnel-analytics intake-analytics checkout-route
```

Expected: FAIL because current analytics is PostHog-only.

- [ ] **Step 3: Extend the existing boundary minimally**

Use existing consent and dedupe. Identify only after durable report; emit Lead
with `offer_slug=app-idea-evaluator` and the stable report/evaluation ID.
Validate the optional visitor ID to Admaxxer's documented character/length
contract at the public boundary.

- [ ] **Step 4: Pass UI/privacy/type checks and commit**

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- funnel-analytics intake-analytics checkout-route cookie-consent
rtk pnpm --dir apps/web typecheck
rtk git add apps/web/src/features/public-funnel apps/web/src/routes/privacy.tsx
rtk git commit -m "feat: attribute App Idea leads"
```

### Task 4: Attribute Verified Purchases

**Files:**

- Create/Test: `packages/integrations/src/admaxxer.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `packages/convex/confect/evaluator/providerConfig.ts`
- Modify: `packages/convex/confect/tables/purchases.ts`
- Modify: `docs/template/env-manifest.json`, `docs/template/env-manifest.md`
- Create: `docs/template/migrations/2026-08-02-app-idea-attribution.md`
- Modify: `packages/convex/confect/commerce/checkout.impl.ts`
- Modify/Test: `packages/convex/confect/commerce/webhooks.impl.ts`
- Test: `packages/convex/test/app-idea-commerce-capabilities.test.ts`
- Test: `packages/convex/test/build-pack-pipeline.test.ts`

**Interfaces:** Produces one Admaxxer Purchase after verified durable
`payment.succeeded`, keyed by Dodo payment ID. Consumes provider-confirmed
product ID, amount/currency/email, checkout/report metadata, and optional
`admx_visitor_id`. The purchase records the actual amount and equal credit plus
optional `admaxxerReportedAt`; a duplicate retries only an unreported payment.

- [ ] **Step 1: Write failing adapter and route tests**

Cover invalid signature, missing/mismatched checkout, unconfigured product ID,
wrong product, wrong configured amount/currency, missing live key, provider 500,
duplicate delivery, retry after durable payment, refund/dispute, equal
purchase/credit amount, and one redacted request keyed by payment ID. Prove the
real `$29` and temporary `$1` configurations separately; reject all mismatch.

- [ ] **Step 2: Confirm focused failure**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations test -- admaxxer dodo
rtk host-test-slot --class focused pnpm --dir packages/convex test -- app-idea-commerce-capabilities build-pack-pipeline
```

- [ ] **Step 3: Add the minimum server path**

Use `fetch` and existing typed env/provider boundaries. Add required live-mode
`DODO_BUILD_PACK_EXPECTED_AMOUNT_CENTS` and optional fail-closed
`DODO_BUILD_PACK_LAUNCH_CANARY`. A controlled canary deployment temporarily
sets the existing `DODO_BUILD_PACK_PRODUCT_ID` to the canary product, expected
amount to `100`, and canary flag to `true`; normal production reads back the
real product, `2900`, and false/absent flag. Put visitor/report IDs in Dodo
metadata plus `launch_canary=true` only when the flag is true. Extend the closed
verified parser to require product ID, actual total, currency, checkout session,
and allowlisted metadata. Bind them to stored checkout before granting access.
Persist the actual payment amount and equal Maestro credit first. Mark
`admaxxerReportedAt` only after success. A temporary failure returns retryable
non-`2xx`; a duplicate with no timestamp retries attribution without duplicating
commerce writes. Document the optional schema addition and env rotation; add no
parallel DTO or raw-payload store.

- [ ] **Step 4: Pass commerce/type/secret checks and commit**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations test -- admaxxer dodo
rtk host-test-slot --class focused pnpm --dir packages/convex test -- app-idea-commerce-capabilities build-pack-pipeline
rtk pnpm --dir packages/convex typecheck
rtk pnpm confect:manifest
rtk pnpm check:schema-migration-notes
rtk pnpm check:secret-canaries
rtk git add packages/integrations packages/convex/confect/evaluator/providerConfig.ts packages/convex/confect/tables/purchases.ts packages/convex/confect/commerce packages/convex/test docs/template/env-manifest.json docs/template/env-manifest.md docs/template/migrations/2026-08-02-app-idea-attribution.md
rtk git commit -m "feat: attribute App Idea purchases"
```

### Task 5: Configure And Accept Staging

**Files:**

- Modify: `docs/template/app-idea-funnel-launch-audit.md`

**Interfaces:** Produces configured Convex smoke, exact staging SHA, free-report
canary, Dodo fixtures, Admaxxer/Meta trace, and rollback receipt from isolated
staging bindings.

- [ ] **Step 1: Provision isolated staging bindings**

Use `headless-bws-env check` before requesting shared credentials. Configure
Cloudflare project/account, Convex deployment/key, hosted URL, Dodo test
product/webhook, model, email, Admaxxer, and Meta test destination under exact
manifest names without printing values.

- [ ] **Step 2: Run the configured Convex output smoke**

```bash
rtk pnpm template:workflow-output-smoke
```

Expected: PASS against real isolated Convex; never fake the connection.

- [ ] **Step 3: Pass exact-SHA gates and deploy staging**

```bash
rtk host-test-slot --class focused pnpm exec playwright test --config=playwright.funnel.config.ts
rtk host-test-slot --class full pnpm verify
```

Deploy the committed SHA through Woodpecker staging. Receipt must bind commit,
Cloudflare/Convex deployments, manifest hash, hosted URL, smoke, and rollback.

- [ ] **Step 4: Run staging acceptance**

Prove intake, useful report, claim/recovery, revision, share/revoke, checkout,
delayed webhook, signed fixture payment, checkpointed Build Pack, export,
refund/dispute denial, credit, support resume, PageView, Lead, visitor handoff,
Admaxxer test Purchase, and Meta test event.

- [ ] **Step 5: Commit evidence**

```bash
rtk git add docs/template/app-idea-funnel-launch-audit.md
rtk git commit -m "docs: record App Idea staging acceptance"
```

### Task 6: Run The Approved $1 Live Canary And Promote

**Files:**

- Modify: `docs/template/app-idea-funnel-launch-audit.md`

**Interfaces:** Produces temporary live `$1` product proof, refund/revocation,
exact production promotion, final `$29` no-charge checkout, and rollback. Card
details stay exclusively in owner-entered hosted checkout.

- [ ] **Step 1: Create/read back the temporary product**

Create one clearly named non-public live `$1 USD` Build Pack product; its
controlled checkout adds trusted metadata `launch_canary=true`. Record redacted
ID, environment, price, currency, tax, active state, webhook, refund owner, and
mapping rollback. Keep the real `$29` product unchanged.

- [ ] **Step 2: Obtain explicit approval and run one checkout**

Verify signed payment, product binding, entitlement, eight checkpointed outputs,
credit, Admaxxer Purchase `$1`, Meta event, delayed-return recovery, and no
duplicate side effects.

- [ ] **Step 3: Refund, prove revocation, and deactivate the canary product**

Verify webhook, purchase/entitlement/credit revocation, future-generation
denial, preserved customer input, and support visibility. Restore the `$29`
mapping and deactivate/archive the temporary product.

- [ ] **Step 4: Promote exact accepted SHA and verify without charge**

Promote through Woodpecker production. Complete a free report, open the real
`$29` live checkout, verify mode/cart/return/support, PageView, Lead, visitor,
and Meta destination, then stop before payment. Mark real-product Purchase
`intentionally uncharged`.

- [ ] **Step 5: Commit production evidence**

```bash
rtk git add docs/template/app-idea-funnel-launch-audit.md
rtk git commit -m "docs: record App Idea production proof"
```

## Completion Audit

- Existing free/paid product journeys remain canonical and proven.
- Woodpecker alone verifies, stages, promotes, and rolls back exact commits.
- Configured Convex output smoke passes; staging/production bindings differ.
- Durable report emits one Lead; verified payment emits one Purchase.
- Approved live `$1` checkout, refund, revocation, attribution, and Meta event
  pass; the temporary product is then deactivated.
- Production `$29` checkout is verified without charge and marked
  `intentionally uncharged`; rollback coordinates are recorded.
