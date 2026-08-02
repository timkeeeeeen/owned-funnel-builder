# Standard Funnels Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Owned Funnel Builder, Talking-Head Ad Machine, and Vibe Code
Anything production-ready with approved copy, migrated D1 state, correct Dodo
live products, retry-safe webhooks, Admaxxer attribution, and verified delivery.

**Architecture:** Keep all three offers on the existing shared Astro, Cloudflare
Pages Functions, D1, Dodo, fulfillment, and Admaxxer boundaries. Add only the
small D1 state needed for retry ownership and payment revocation, fix routing in
the shared Dodo webhook, and leave offer-specific copy and economics in their
existing JSON records.

**Tech Stack:** Astro 7, TypeScript 5.9, Cloudflare Pages/Functions and D1,
Dodo Payments SDK and Checkout, Keystatic, Admaxxer, Node test runner,
Playwright, Wrangler.

## Global Constraints

- Canonical repository: `/Users/headless/owned-funnel-builder`; execute from a
  new isolated worktree based on current `origin/main`.
- Preserve all existing production leads, funnel runs, webhook events,
  fulfillments, and 11 standard-product mappings.
- Dodo test and live environments use different explicit keys, products,
  webhooks, secrets, customers, transactions, and return URLs.
- Test mode does not prove one-click upsells. The full sequence uses 11
  temporary non-public live `$1 USD` products—one per base, bump, and upsell
  stage—only after separate charge approval and owner card entry in Dodo.
- Never expose or print Dodo, Admaxxer, Meta, Cloudflare, or Resend secrets.
- Never place a live order without explicit approval of amount, test email,
  card-entry moment, and refund plan. Card data stays in owner-entered checkout.
- Bumps default off; every decline path remains readable and actionable.
- Purchase is emitted only from a verified payment webhook and uses the Dodo
  payment ID as the transaction key.
- No new CMS, payment abstraction, queue, analytics wrapper, or funnel framework.
- Woodpecker is the only CI authority; Buildkite and Fabro are not used.

## File And Boundary Map

- `src/content/offers/*.json`: approved landing-page copy for the three offers.
- `src/content/funnels/*.json`: products, bump, upsells, publish flags, delivery,
  and completion copy.
- `docs/launch/five-funnel-copy-deck.md`: owner-readable copy freeze and source
  map shared with the Meta plan.
- `migrations/0006_stripe_provider.sql`: already-pending provider migration;
  apply unchanged after preview proof.
- `migrations/0007_webhook_retry_and_revocations.sql`: new retry-lease and
  payment-revocation state only.
- `functions/api/webhooks/dodo.ts`: raw-body verification, routing,
  retry ownership, fulfillment, revocation, and Admaxxer result handling.
- `functions/_lib/admaxxer.ts`: existing Payments API boundary; no new client.
- `scripts/configure-dodo-webhook.mjs`: exact event subscription and secret
  retrieval for the selected Dodo environment.
- `tests/functions/payment.test.mts`: shared payment and webhook behavior.
- `tests/*/contract.test.mts`: price, copy, delivery, and publish contracts.
- `docs/launch/standard-funnels-launch-evidence.md`: immutable deployment,
  migration, product, checkout, event, fulfillment, and rollback receipts.

---

### Task 1: Freeze The Three Offer Contracts And Copy

**Files:**

- Create: `docs/launch/five-funnel-copy-deck.md`
- Modify: `src/content/offers/owned-funnel-builder.json`
- Modify: `src/content/offers/talking-head-ad-machine.json`
- Modify: `src/content/offers/vibe-code-anything.json`
- Modify: `src/content/funnels/owned-funnel-builder.json`
- Modify: `src/content/funnels/talking-head-ad-machine.json`
- Modify: `src/content/funnels/vibe-code-anything.json`
- Test: `tests/functions/payment.test.mts`
- Test: `tests/talking-head-ad-machine/contract.test.mts`

**Interfaces:**

- Produces: an approved copy deck keyed by exact JSON source path and a frozen
  commercial contract for `$49 + $19 + two upsells`, `$27 + $9 + $37`, and
  `$29 + $19 + $39 + $79`.
- Consumes: existing Keystatic schemas and generated funnel catalog; no product
  ID or secret enters content.

- [ ] **Step 1: Write contract assertions before editing copy**

In `tests/talking-head-ad-machine/contract.test.mts`, reuse its existing
`readJson` helper to load each offer/funnel pair and pin the launch promises,
prices, bump default, upsell order, refund copy, support contact, delivery text,
and prohibited-claim boundary. The core price assertion is:

```ts
const [ownedFunnel, talkingHeadFunnel, vibeCodeFunnel] = await Promise.all(
  [
    'src/content/funnels/owned-funnel-builder.json',
    'src/content/funnels/talking-head-ad-machine.json',
    'src/content/funnels/vibe-code-anything.json',
  ].map(readJson),
);

assert.deepEqual(
  [ownedFunnel, talkingHeadFunnel, vibeCodeFunnel].map((funnel) => ({
    base: [funnel.base.productKey, funnel.base.priceAmount],
    bump: funnel.bump && [funnel.bump.productKey, funnel.bump.priceAmount],
    upsells: funnel.upsells.map((step) => [step.product.productKey, step.product.priceAmount]),
  })),
  [
    {
      base: ['owned-funnel-builder', 49],
      bump: ['owned-funnel-conversion-copy-swipe-file', 19],
      upsells: [
        ['owned-funnel-ten-blueprints', 39],
        ['owned-funnel-agency-toolkit', 79],
      ],
    },
    {
      base: ['talking-head-ad-machine', 27],
      bump: ['talking-head-hook-recording-pack', 9],
      upsells: [['talking-head-ad-test-lab', 37]],
    },
    {
      base: ['vibe-code-anything', 29],
      bump: ['vibe-code-prompt-pack', 19],
      upsells: [
        ['vibe-code-five-app-blueprints', 39],
        ['vibe-code-production-launch-pack', 79],
      ],
    },
  ]
);
```

- [ ] **Step 2: Run the contract tests and record any real key-name drift**

Run:

```bash
rtk host-test-slot --class focused pnpm test:functions
rtk host-test-slot --class focused pnpm test:blueprint
rtk host-test-slot --class focused node --import tsx --test tests/talking-head-ad-machine/*.test.mts
```

Expected: the new assertions fail only where current copy or economics differs
from the approved contract. If generated product keys differ, use the existing
keys and update the assertion and copy deck together; do not create aliases.

- [ ] **Step 3: Write the copy deck and apply the same approved language to the
      canonical JSON records**

The copy deck must contain, for each funnel, the primary buyer, repeatable
outcome, action, exact stack, deliverables, delivery timing, prerequisites,
disqualifiers, refund terms, permitted proof source, prohibited claims, Meta
primary text/headline/description, landing first fold, checkout, bump, upsells,
thank-you, fulfillment, privacy, support, and exact source paths. Use these
first-fold baselines:

```md
| Funnel | Headline | Primary action |
| --- | --- | --- |
| Owned Funnel Builder | Own and reuse the funnel instead of renting another platform. | Get the complete builder for $49 |
| Talking-Head Ad Machine | Turn one raw clip into a reviewable Meta ad with your coding agent. | Get the Ad Machine for $27 |
| Vibe Code Anything | Start from a serious application shell instead of a blank repository. | Get the full template for $29 |
```

- [ ] **Step 4: Regenerate the catalog and pass content contracts**

Run:

```bash
rtk pnpm generate:funnels
rtk pnpm validate:config
rtk host-test-slot --class focused pnpm test:functions
rtk host-test-slot --class focused node --import tsx --test tests/talking-head-ad-machine/*.test.mts
```

Expected: all three offers resolve, exact prices and product order pass, bumps
remain opt-in, and no unknown content field is reported.

- [ ] **Step 5: Commit the frozen offer contracts**

```bash
rtk git add docs/launch/five-funnel-copy-deck.md src/content/offers src/content/funnels tests
rtk git commit -m "docs: freeze standard funnel launch offers"
```

### Task 2: Prove And Apply D1 Migrations 0006 And 0007

**Files:**

- Create: `migrations/0007_webhook_retry_and_revocations.sql`
- Create: `tests/functions/migrations.test.mts`
- Modify: `docs/launch/standard-funnels-launch-evidence.md`

**Interfaces:**

- Produces: `webhook_events.attempt_started_at` and
  `payment_revocations(payment_id, event_type, provider_event_id, created_at)`.
- Consumes: the existing migration runner and production D1 time-travel/export
  authority.

- [ ] **Step 1: Write a migration test against representative pre-0006 rows**

The test must insert the observed row shapes, apply 0006 then 0007, and assert
that row counts, all 11 Dodo mappings, provider defaults, and fulfillment status
survive. Pin 0007 to additive SQL:

```sql
ALTER TABLE webhook_events ADD COLUMN attempt_started_at TEXT;

CREATE TABLE IF NOT EXISTS payment_revocations (
  payment_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Run the migration test and confirm it fails before 0007 exists**

Run:

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/migrations.test.mts
```

Expected: FAIL because the retry lease and revocation table are absent.

- [ ] **Step 3: Add the additive migration and pass the representative test**

Run the same command. Expected: PASS with identical business-row counts and 11
live mappings after both migrations.

- [ ] **Step 4: Create a production recovery point and test the exact migration
      sequence on an isolated preview D1 database**

Use `wrangler d1 export` or Cloudflare D1 time travel without printing row
contents. Record only database ID, bookmark/export checksum, migration list,
aggregate counts, and timestamp in the evidence document. Apply:

```bash
rtk pnpm exec wrangler d1 migrations apply "$FUNNEL_D1_DATABASE" --local
rtk pnpm validate:config
rtk host-test-slot --class focused pnpm test:functions
```

Expected: migrations 0006 and 0007 apply once; checkout, webhook, fulfillment,
and product-registry tests pass on the migrated shape.

- [ ] **Step 5: Commit the migration and proof harness**

```bash
rtk git add migrations/0007_webhook_retry_and_revocations.sql tests/functions/migrations.test.mts docs/launch/standard-funnels-launch-evidence.md
rtk git commit -m "feat: add webhook retry state"
```

### Task 3: Fix Dodo Routing, Retry Ownership, And Revocation

**Files:**

- Modify: `functions/api/webhooks/dodo.ts`
- Test: `tests/functions/payment.test.mts`

**Interfaces:**

- Produces:
  `classifyDodoEvent(source: string, productKey: string): 'funnel' | 'noop' | 'invalid-funnel'`,
  `claimWebhookEvent(database, webhookId, now, staleBefore): Promise<'owner' | 'processed' | 'busy'>`,
  and idempotent revocation writes keyed by payment ID.
- Consumes: verified raw payload, `webhook-id`, existing fulfillment lock, and
  immutable Dodo payment ID.

- [ ] **Step 1: Add failing tests for diagnostic no-op, concurrent duplicates,
      stale recovery, missing live Admaxxer, refund-before-success, and late
      payment failure**

```ts
test('valid diagnostic payment is an audited no-op', async () => {
  const response = await sendSignedDodoEvent({
    type: 'payment.succeeded',
    data: { payment_id: 'pay_diag', metadata: { source: 'owned-funnel-diagnostic' } },
  });
  assert.equal(response.status, 200);
  assert.equal(database.fulfillment, undefined);
  assert.equal(database.events.get('evt_diag')?.status, 'processed');
});

test('nonterminal duplicate remains retryable', async () => {
  database.events.set('evt_busy', {
    status: 'received',
    attempt_started_at: new Date().toISOString(),
  });
  const response = await sendSignedDodoEvent(funnelPayment, 'evt_busy');
  assert.equal(response.status, 503);
});

test('refund arriving before success prevents later fulfillment', async () => {
  await sendSignedDodoEvent(refundEvent('pay_refunded'));
  await sendSignedDodoEvent(paymentEvent('pay_refunded'));
  assert.equal(database.fulfillment, undefined);
});
```

- [ ] **Step 2: Run the focused webhook tests and confirm the current handler
      fails the new behavior**

Run:

```bash
rtk host-test-slot --class focused node --import tsx --test --test-name-pattern="Dodo|webhook|refund|duplicate" tests/functions/payment.test.mts
```

Expected: failures show diagnostics entering funnel processing, no atomic lease,
and no revocation guard.

- [ ] **Step 3: Implement the minimum shared classification and claim**

Use the existing `webhook_events` row; do not add a queue. The claim is one
conditional D1 update. Terminal duplicates return `200`; busy synchronous
claims return `503`; failed or older-than-two-minutes claims can be reacquired.

```ts
function classifyDodoEvent(metadata: Record<string, string>):
  | 'funnel'
  | 'noop'
  | 'invalid-funnel' {
  if (metadata.source !== 'owned-funnel-builder') return 'noop';
  return metadata.funnel_id && metadata.lead_id && metadata.product_key
    ? 'funnel'
    : 'invalid-funnel';
}

const claim = await database
  .prepare(
    `UPDATE webhook_events
     SET status = 'received', attempt_started_at = ?, error_message = NULL
     WHERE webhook_id = ?
       AND status != 'processed'
       AND (status = 'failed' OR attempt_started_at IS NULL OR attempt_started_at < ?)`
  )
  .bind(now, webhookId, staleBefore)
  .run();
```

Before fulfillment, query `payment_revocations`; if the payment is revoked,
mark the event processed without delivery. `payment.failed` must never downgrade
an already-succeeded run. Refund and terminal dispute events insert the stable
payment ID into `payment_revocations`; Dodo Digital Files remains the authority
for revocable file access.

- [ ] **Step 4: Make live Admaxxer absence fail loudly after idempotent
      fulfillment**

```ts
const attributed = await recordAdmaxxerPayment(env, payment);
if (!attributed && environment === 'live_mode') {
  throw new Error('Live payment attribution is not configured.');
}
```

The retry reuses the unique fulfillment `(payment_id, product_key)` and
Admaxxer `transaction_id`; it must not charge, convert, or email twice.

- [ ] **Step 5: Pass focused payment tests and compile Functions**

```bash
rtk host-test-slot --class focused pnpm test:functions
rtk pnpm check:functions
rtk pnpm typecheck
```

Expected: signature, diagnostic, concurrent duplicate, stale retry,
refund/dispute, fulfillment retry, and Admaxxer retry tests pass.

- [ ] **Step 6: Commit the root-cause webhook repair**

```bash
rtk git add functions/api/webhooks/dodo.ts tests/functions/payment.test.mts
rtk git commit -m "fix: route Dodo webhooks safely"
```

### Task 4: Configure The Exact Dodo Catalog And Webhook Event Set

**Files:**

- Modify: `scripts/configure-dodo-webhook.mjs`
- Modify: `scripts/configure-dodo.mjs`
- Test: `tests/functions/payment.test.mts`
- Modify: `docs/launch/standard-funnels-launch-evidence.md`

**Interfaces:**

- Produces: 11 environment-specific Dodo product mappings and one HTTPS webhook
  subscribed to the exact handled event set.
- Consumes: local secret settings and Dodo APIs without printing secret values.

- [ ] **Step 1: Add a failing script-contract test for the event set**

```ts
assert.deepEqual(configuredDodoEvents, [
  'payment.succeeded',
  'payment.failed',
  'refund.succeeded',
  'dispute.opened',
  'dispute.accepted',
  'dispute.won',
  'dispute.lost',
  'entitlement_grant.delivered',
  'entitlement_grant.failed',
  'entitlement_grant.revoked',
]);
```

- [ ] **Step 2: Update the existing webhook in place when its event set drifts**

Keep the metadata marker `owned_funnel_builder=true`. Retrieve and save the
environment-specific secret without printing it. Do not create a second webhook
when the URL and marker already identify one.

- [ ] **Step 3: Run test-mode setup and read back every product**

Run through the existing friendly scripts so secrets stay in local settings:

```bash
rtk pnpm setup:dodo
rtk pnpm validate:config
```

For each product, record name, ID suffix only, price, USD currency, tax category,
active state, Digital Files entitlement, refund terms, and `test_mode` identity.
Repeat in live mode only after Dodo KYC/business approval is confirmed. Never
copy a test product ID into live configuration.

- [ ] **Step 4: Pass setup and payment tests, then commit**

```bash
rtk host-test-slot --class focused pnpm test:functions
rtk git add scripts/configure-dodo-webhook.mjs scripts/configure-dodo.mjs tests/functions/payment.test.mts docs/launch/standard-funnels-launch-evidence.md
rtk git commit -m "fix: align Dodo launch catalog"
```

### Task 5: Prove Admaxxer, Privacy, And Live Page Behavior

**Files:**

- Modify: `src/pages/privacy.astro`
- Modify: `tests/functions/payment.test.mts`
- Modify: `docs/launch/standard-funnels-launch-evidence.md`

**Interfaces:**

- Produces: one `shop.maestrogtm.com` Admaxxer website segmented by
  `offer_slug`, one browser PageView, one post-checkout Lead, visitor metadata on
  Dodo, and one server Purchase per payment.
- Consumes: existing `AdmaxxerPixel.astro`, `OfferCheckoutDialog.astro`,
  `/api/checkout`, and `recordAdmaxxerPayment`.

- [ ] **Step 1: Verify the existing browser and server contracts before adding
      code**

Assert the pixel is rendered once by `OfferLayout`, Lead remains after successful
checkout creation, `admx_visitor_id` is sanitized and saved, and no browser
Purchase exists. Add only missing assertions; do not create another tracker.

- [ ] **Step 2: Update privacy copy for the exact data flow**

Name visitor identifiers, email identification, UTMs and `fbclid`, payment
attribution, Admaxxer, server-side Meta events, consent/opt-out behavior, and the
fact that identifiers are attribution metadata rather than authentication.

- [ ] **Step 3: Configure Admaxxer and Meta without putting Meta credentials in
      the repository**

Follow `skills/configure-admaxxer/SKILL.md` and current Admaxxer live docs.
Store only `PUBLIC_ADMAXXER_WEBSITE_ID`, `PUBLIC_ADMAXXER_DOMAIN`, and private
`ADMAXXER_API_KEY` in the environment. Connect Meta CAPI inside Admaxxer.

- [ ] **Step 4: Pass focused tests and commit any privacy/test delta**

```bash
rtk host-test-slot --class focused pnpm test:functions
rtk pnpm build
rtk git add src/pages/privacy.astro tests/functions/payment.test.mts docs/launch/standard-funnels-launch-evidence.md
rtk git commit -m "docs: disclose paid traffic attribution"
```

### Task 6: Deploy And Verify The Three Standard Funnels

**Files:**

- Modify: `docs/launch/standard-funnels-launch-evidence.md`

**Interfaces:**

- Produces: exact preview and production commit, D1 recovery coordinate,
  migration readback, 11 product readbacks, fixture and live `$1` canary proof,
  real-price no-charge checkouts, delivery, Admaxxer events, and rollback.
- Consumes: Tasks 1-5 and an approved production deployment window.

- [ ] **Step 1: Run the complete repository gate**

```bash
rtk pnpm format:check
rtk pnpm lint
rtk pnpm typecheck
rtk host-test-slot --class focused pnpm test:functions
rtk host-test-slot --class focused pnpm test:blueprint
rtk pnpm build
rtk pnpm check:functions
rtk pnpm validate:config -- --publish
```

Expected: every command passes on the exact committed SHA.

- [ ] **Step 2: Deploy a preview and complete the fixture matrix**

In test mode prove signatures, ordinary checkout, decline navigation, duplicate
delivery, provider failure, refund/dispute fixtures, download entitlement,
branded email, PageView, Lead, visitor metadata, and Meta test destination. Do
not mark one-click acceptance proven in test mode.

- [ ] **Step 3: Run approved live `$1` product-stage canaries**

Create 11 clearly named non-public live `$1 USD` products mirroring every paid
stage. Add `launch_canary=true` to their trusted checkout metadata. Read back
environment, price, currency, tax, entitlement, and webhook. Export the 11 real
`offer_products` rows, then apply a canary-only mapping whose expected amount is
`$1 USD`; do not mutate the canonical content prices. The checkout and webhook
must bind provider product, mapped stage, and expected amount.
After separate approval of total, identity, card-entry moment, and refund plan,
the owner enters the card in Dodo. Prove base purchase, bump declined/selected,
every upsell declined/accepted, signed webhook, idempotent fulfillment, email,
Admaxxer Purchase `$1` per accepted stage, Meta CAPI, immediate refund, and
revocation. Restore and read back all exported real mappings before deactivating
or archiving canary products.

- [ ] **Step 4: Apply production migrations before deploying current code**

Run the existing publish path only after the recovery coordinate and preview
proof are in the evidence document:

```bash
rtk pnpm publish
```

Expected: 0006 and 0007 apply once, aggregate row counts and 11 mappings match
the baseline, exact reviewed commit deploys, and the previous Pages deployment
ID remains recorded for rollback.

- [ ] **Step 5: Verify production without a charge**

Open each base checkout with bump off and on, then stop before payment. Confirm
`live_mode`, real base/bump IDs and prices, USD totals, return URLs, and support
copy. Read back every real upsell product and application route mapping; the `$1`
canary remains the one-click proof because real upsells are post-charge. Confirm
live PageView/Lead and mark real-price Purchases `intentionally uncharged` unless
separately approved.

- [ ] **Step 6: Publish Talking-Head only after its deliverables pass**

Verify actual Windows 11 x64, Apple Silicon, and Intel Mac downloads and their
instructions before changing `published` and checkout flags. Linux, Windows
ARM, phone app, and automatic publishing remain disqualified.

- [ ] **Step 7: Commit the immutable launch evidence**

```bash
rtk git add docs/launch/standard-funnels-launch-evidence.md
rtk git commit -m "docs: record standard funnel launch proof"
```

## Completion Audit

- Copy deck paths match deployed JSON and one baseline Meta ad per funnel.
- Migrations 0001-0007 and aggregate production counts are read back.
- All 11 live Dodo products and the exact live webhook event set are read back.
- Diagnostics are audited no-ops; invalid funnel events retry; concurrent and
  stale claims do not lose or duplicate work.
- Refund-before-success and late-failure ordering cannot regrant or downgrade.
- Test-mode fixtures pass; all 11 live `$1` stage products then prove checkout,
  bump, one-click upsell, entitlement, email, attribution, refund, and
  revocation for all three offers.
- Live checkouts are proven without charge; production Purchase is either
  approved evidence or `intentionally uncharged`.
- Exact preview/production commits, Cloudflare deployment IDs, D1 recovery
  coordinate, and rollback command are recorded.
