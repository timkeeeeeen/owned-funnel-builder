# Authority Snapshot And CMO Game Plan Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch the four Authority Snapshot variants and shared $5 CMO Game
Plan through Maestro's canonical Blueprint backend with Dodo, Admaxxer, Meta
CAPI, durable claim handoff, retained outputs, and CMO continuation.

**Architecture:** `shop.maestrogtm.com` remains the public acquisition surface;
Maestro remains the only Snapshot, checkout, payment, claim, content, and CMO
authority. Extend the existing v2 handoff with one optional Admaxxer visitor ID,
emit Lead after a durable Snapshot, ingest Purchase from the verified Maestro
Dodo route, and deploy exact accepted commits through Woodpecker.

**Tech Stack:** Astro/TypeScript/Cloudflare Pages in Owned Funnel Builder;
React/Notion Kit, Convex, `@convex-dev/workflow`, Dodo, Cloudflare Workers, and
Woodpecker in Maestro; Admaxxer and Meta CAPI.

## Global Constraints

- Repositories: `/Users/headless/owned-funnel-builder` and
  `/Users/headless/maestro`; execute both in new isolated clean worktrees from
  current `origin/main`. Never use the dirty Maestro checkout.
- Historical context: ctx session `fe892dc0-696a-7e2f-941e-449cf48aece0`, event
  `3d64288f-69f1-7088-aed8-981ca81de33b`.
- PRs 3638 and 3639 are merged; current work verifies and releases existing
  canonical behavior rather than rebuilding it.
- No parallel Blueprint database, checkout, audit, generator, content store, or
  analytics authority.
- Free promise: reveal the visible authority weakness and first fix. Paid
  promise: a focused personalized 30-day publishing plan with five retained
  first drafts.
- The optional $99/month Blueprint Activation is out of scope and remains
  disabled/informational.
- No invented proof, automatic publishing, secret logging, or production
  promotion before staging acceptance. The temporary live `$1` canary remains
  blocked until separate charge approval and owner card entry.
- Maestro source changes require a Linear-linked approved plan bundle unless a
  deployment-only change is explicitly `plan-exempt`; Woodpecker is the sole CI
  and deployment authority.

## File And Boundary Map

- `src/scripts/blueprint-funnel-client.ts`: public v2 client, Snapshot Lead,
  visitor ID, and checkout handoff.
- `tests/blueprint/contract.test.mts`: acquisition-side transport and copy
  contracts.
- `packages/convex/convex/checks/blueprintAcquisitionContext.ts`: allowlisted
  public attribution data.
- `packages/convex/convex/capabilities/billing/blueprintCheckoutStarts.ts` and
  `workflows/billing/startBlueprintGamePlanCheckout.ts`: optional visitor ID
  carried to checkout.
- `packages/convex/convex/adapters/blueprintCheckout.ts`: Dodo metadata binding.
- `packages/convex/convex/adapters/admaxxerPayments.ts`: one provider adapter for
  verified revenue ingestion.
- `packages/convex/convex/adapters/dodoPaymentWebhooks.ts` and
  `dodoWebhookRoutes.ts`: durable payment first, Admaxxer second, retry on
  attribution failure.
- `.woodpecker/deploy.yml` and `tooling/ci/woodpecker-deploy.sh`: existing exact
  staging/production path; do not add another deploy system.
- `docs/launch/blueprint-paid-traffic-evidence.md`: canary, Dodo, output,
  attribution, release, and rollback evidence.

---

### Task 1: Establish Clean Release Bases And Existing Authority

**Files:**

- Create: `docs/launch/blueprint-paid-traffic-evidence.md` in the coordination
  repository.

**Interfaces:**

- Produces: exact Owned and Maestro SHAs, current staging/production deployment
  IDs, Convex deployment names, generated contract hash, workflow manifest hash,
  Dodo environment/product/webhook readback, and rollback coordinates.
- Consumes: current `origin/main`, Woodpecker, Cloudflare, Convex, Dodo, and
  prior launch evidence without changing them.

- [ ] **Step 1: Create isolated worktrees and record exact bases**

Use `superpowers:using-git-worktrees`. In each worktree run:

```bash
rtk git status --short
rtk git rev-parse HEAD
rtk git log -1 --oneline
```

Expected: clean output and a commit reachable from current `origin/main`.

- [ ] **Step 2: Read back the current public and runtime surfaces**

Record response status, canonical URL, robots mode, deployed commit, and runtime
identity for all four Snapshot routes, all four Game Plan routes,
`/blueprint/asset`, `/blueprint/checkout/return`, and Maestro's claim/Game Plan
routes. Do not enable disabled CTAs yet.

- [ ] **Step 3: Read back the existing Dodo and Woodpecker authority**

Confirm test/live separation, the `$5 USD` `blueprint_game_plan` product, live
KYC/business approval, webhook URL/event set/signature secret binding name,
current Woodpecker staging/production target availability, and exact rollback
versions. Record redacted identifiers only.

- [ ] **Step 4: Commit the baseline evidence in the coordination repository**

```bash
rtk git add docs/launch/blueprint-paid-traffic-evidence.md
rtk git commit -m "docs: record Blueprint launch baseline"
```

### Task 2: Add Snapshot Lead And Visitor Handoff

**Files:**

- Modify: `src/scripts/blueprint-funnel-client.ts`
- Test: `tests/blueprint/contract.test.mts`
- Modify: `src/pages/privacy.astro`

**Interfaces:**

- Produces: one browser Lead after a saved Snapshot and optional sanitized
  `admaxxerVisitorId` on the existing checkout-start request.
- Consumes: canonical `window.admaxxer`, public session token, Snapshot result,
  current journey ID, and existing checkout workflow. Visitor ID is attribution
  only and never authorization.

- [ ] **Step 1: Write failing acquisition-side tests**

```ts
assert.match(client, /admaxxer\?\.identify\?\./);
assert.match(client, /admaxxer\?\('Lead'/);
assert.match(client, /admaxxerVisitorId/);
assert.match(client, /result\.authoritySnapshot/);
assert.doesNotMatch(client, /admaxxer\?\('Purchase'/);
assert.doesNotMatch(client, /email.*searchParams|searchParams.*email/);
```

Also assert Lead is called only after `watchPersonalization` returns a durable
Snapshot and is deduplicated by journey ID.

- [ ] **Step 2: Run the Blueprint contract test and confirm failure**

```bash
rtk host-test-slot --class focused pnpm test:blueprint
```

Expected: FAIL because the Blueprint client currently has UTMs and `journey_id`
but no Admaxxer Lead or visitor handoff.

- [ ] **Step 3: Add the minimum browser integration**

```ts
type AdmaxxerClient = {
  (event: 'Lead', properties: Record<string, unknown>): void;
  identify?: (email: string) => void;
  getVisitorId?: () => string | null;
};

function admaxxer() {
  return (window as Window & { admaxxer?: AdmaxxerClient }).admaxxer;
}

function trackSnapshotLead(email: string, audience: string, journeyId: string) {
  const client = admaxxer();
  if (!client || sessionStorage.getItem(`blueprint:lead:${journeyId}`) === '1') return;
  client.identify?.(email);
  client('Lead', { offer_slug: 'authority-snapshot', audience, journey_id: journeyId });
  sessionStorage.setItem(`blueprint:lead:${journeyId}`, '1');
}
```

Call it only after the saved Snapshot result is parsed. At checkout start send
`admaxxerVisitorId: admaxxer()?.getVisitorId?.() ?? undefined`; do not place it
in the URL or public session token.

- [ ] **Step 4: Update privacy copy and pass Owned Funnel Builder gates**

```bash
rtk host-test-slot --class focused pnpm test:blueprint
rtk pnpm typecheck
rtk pnpm build
rtk pnpm check:functions
```

Expected: saved-Snapshot Lead and optional visitor handoff pass; no browser
Purchase or sensitive URL state exists.

- [ ] **Step 5: Commit the acquisition tracking boundary**

```bash
rtk git add src/scripts/blueprint-funnel-client.ts src/pages/privacy.astro tests/blueprint/contract.test.mts
rtk git commit -m "feat: attribute Blueprint acquisition"
```

### Task 3: Carry Visitor Attribution Through Maestro Checkout

**Files:**

- Modify: `packages/convex/convex/checks/blueprintAcquisitionContext.ts`
- Test: `packages/convex/convex/checks/blueprintAcquisitionContext.test.ts`
- Modify: `packages/convex/convex/capabilities/billing/blueprintCheckoutStarts.ts`
- Modify: `packages/convex/convex/workflows/billing/startBlueprintGamePlanCheckout.ts`
- Modify: `packages/convex/convex/capabilities/billing/blueprintCheckoutProvider.ts`
- Modify: `packages/convex/convex/adapters/blueprintCheckout.ts`
- Test: `packages/convex/convex/adapters/blueprintCheckout.test.ts`

**Interfaces:**

- Produces: `admaxxerVisitorId?: string` validated to 1-180 URL-safe provider
  characters and Dodo metadata key `admx_visitor_id`.
- Consumes: the existing public checkout start, durable workflow, provider
  capability, and Dodo adapter; no new workflow or database table.

- [ ] **Step 1: Write failing validation and Dodo metadata tests**

```ts
expect(normalizeAdmaxxerVisitorId(' visitor_123 ')).toBe('visitor_123');
expect(normalizeAdmaxxerVisitorId('<script>')).toBeNull();
expect(checkoutRequest.metadata).toMatchObject({
  maestro_product_key: 'blueprint_game_plan',
  admx_visitor_id: 'visitor_123',
});
```

- [ ] **Step 2: Run focused tests and confirm the optional field is rejected**

```bash
rtk maestro-remote-test -- pnpm --dir packages/convex exec vitest run convex/checks/blueprintAcquisitionContext.test.ts convex/adapters/blueprintCheckout.test.ts
```

Expected: FAIL until the validator and exact optional argument are wired.

- [ ] **Step 3: Add the deterministic validator and thread the field through
      existing signatures**

```ts
const ADMAXXER_VISITOR_ID = /^[A-Za-z0-9._:-]{1,180}$/u;

export function normalizeAdmaxxerVisitorId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  return ADMAXXER_VISITOR_ID.test(normalized) ? normalized : null;
}
```

The public action rejects a supplied invalid value with `INVALID_ARGUMENT`.
Omitted values remain valid. Pass the normalized value unchanged through the
existing workflow/capability and conditionally add `admx_visitor_id` to Dodo
metadata.

- [ ] **Step 4: Run focused tests and Convex typecheck**

```bash
rtk maestro-remote-test -- pnpm --dir packages/convex exec vitest run convex/checks/blueprintAcquisitionContext.test.ts convex/adapters/blueprintCheckout.test.ts convex/workflows/billing/startBlueprintGamePlanCheckout.test.ts
rtk maestro-remote-test -- pnpm --dir packages/convex typecheck
```

Expected: optional visitor ID reaches the checkout adapter and invalid input
cannot cross the public boundary.

- [ ] **Step 5: Commit the checkout attribution transport**

```bash
rtk git add packages/convex/convex/checks/blueprintAcquisitionContext* packages/convex/convex/capabilities/billing/blueprintCheckoutStarts.ts packages/convex/convex/workflows/billing/startBlueprintGamePlanCheckout* packages/convex/convex/capabilities/billing/blueprintCheckoutProvider.ts packages/convex/convex/adapters/blueprintCheckout*
rtk git commit -m "feat: carry Blueprint visitor attribution"
```

### Task 4: Ingest Verified Blueprint Revenue Into Admaxxer

**Files:**

- Create: `packages/convex/convex/adapters/admaxxerPayments.ts`
- Test: `packages/convex/convex/adapters/admaxxerPayments.test.ts`
- Modify: `packages/convex/convex/adapters/env.ts`
- Modify: `packages/convex/convex/checks/dodoBlueprintPayment.ts`
- Test: `packages/convex/convex/checks/dodoBlueprintPayment.test.ts`
- Modify: `packages/convex/convex/schema/blueprintPurchases.ts`
- Modify: `packages/convex/convex/capabilities/billing/blueprintPurchases.ts`
- Modify: `packages/convex/convex/adapters/dodoPaymentWebhooks.ts`
- Modify: `packages/convex/convex/adapters/dodoWebhookRoutes.ts`
- Test: `packages/convex/convex/adapters/dodoWebhookRoutes.test.ts`

**Interfaces:**

- Produces:
  `recordAdmaxxerPayment(input: { paymentId: string; amountMinor: number; currency: string; visitorId?: string; email?: string }): Promise<void>`.
- Consumes: only a signature-verified `blueprint_game_plan` payment. The receipt
  persists first with optional `admaxxerReportedAt`; Admaxxer failure returns
  retryable non-`2xx`; a duplicate with no report timestamp retries attribution.
  Dodo and Admaxxer deduplicate by payment ID.

- [ ] **Step 1: Write failing adapter and route tests**

```ts
expect(request.url).toBe('https://admaxxer.com/api/v1/payments');
expect(await request.json()).toEqual({
  amount: 5,
  currency: 'USD',
  transaction_id: 'pay_blueprint_1',
  admaxxer_visitor_id: 'visitor_123',
  email: 'buyer@example.com',
});
expect(request.headers.get('authorization')).toBe('Bearer test-key');
```

Add route cases for invalid signature (no call), concurrent duplicate payment
(same transaction ID), duplicate after failed attribution (retry call),
duplicate after recorded attribution (no call), missing production key
(retryable failure), provider 500 (retryable failure), and successful Dodo
receipt plus Admaxxer ingestion.

- [ ] **Step 2: Run focused tests and confirm the adapter is absent**

```bash
rtk maestro-remote-test -- pnpm --dir packages/convex exec vitest run convex/adapters/admaxxerPayments.test.ts convex/adapters/dodoWebhookRoutes.test.ts
```

Expected: FAIL because verified Blueprint payments are not yet reported to
Admaxxer.

- [ ] **Step 3: Implement the provider adapter without a new dependency**

Use `fetch`, `AbortSignal.timeout(10_000)`, the existing typed env boundary, and
`Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits` for minor-unit
normalization. Never log email, visitor ID, body, or API key. Return an error on
non-2xx so Dodo redelivery retries.

- [ ] **Step 4: Return the parsed revenue envelope from payment routing and
      call Admaxxer after the durable receipt**

Only `payment.succeeded` with `maestro_product_key=blueprint_game_plan` produces
the envelope. Extend the existing closed parser to read the allowlisted visitor
ID and provider customer email from the exact signed fixture fields; malformed
optional values are omitted, while payment ID, amount, currency, checkout, and
intent remain required. Subscription and Activation events do not enter this
launch destination. The stable interface is:

```ts
type BlueprintRevenue = {
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly visitorId?: string;
  readonly email?: string;
};
```

- [ ] **Step 5: Run focused webhook tests, typecheck, and required Maestro gates**

```bash
rtk maestro-remote-test -- pnpm --dir packages/convex exec vitest run convex/adapters/admaxxerPayments.test.ts convex/checks/dodoBlueprintPayment.test.ts convex/adapters/dodoWebhookRoutes.test.ts
rtk maestro-remote-test -- pnpm --dir packages/convex typecheck
rtk maestro-remote-test -- pnpm check:secret-canaries
```

Expected: one verified `$5 USD` Purchase, retry on temporary attribution failure,
no duplicate entitlement, and no secret/user-data logging.

- [ ] **Step 6: Commit verified revenue attribution**

```bash
rtk git add packages/convex/convex/adapters/admaxxerPayments* packages/convex/convex/adapters/env.ts packages/convex/convex/checks/dodoBlueprintPayment* packages/convex/convex/schema/blueprintPurchases.ts packages/convex/convex/capabilities/billing/blueprintPurchases.ts packages/convex/convex/adapters/dodoPaymentWebhooks.ts packages/convex/convex/adapters/dodoWebhookRoutes*
rtk git commit -m "feat: attribute Blueprint purchases"
```

### Task 5: Deploy And Accept Blueprint Staging

**Files:**

- Modify: `docs/launch/blueprint-paid-traffic-evidence.md`

**Interfaces:**

- Produces: an exact staging-accepted Maestro SHA, exact Owned Funnel Builder
  preview SHA, four audience canaries, Dodo fixture evidence, an approved live
  `$1` canary, retained Game Plan/drafts, CMO continuation, Admaxxer/Meta
  evidence, and rollback IDs.
- Consumes: current Woodpecker `staging` deployment target and environment-
  isolated Cloudflare, Convex, Dodo, Turnstile, model, email, and Admaxxer
  bindings.

- [ ] **Step 1: Pass the exact focused and broad gates before deployment**

Owned Funnel Builder:

```bash
rtk pnpm format:check
rtk pnpm lint
rtk pnpm typecheck
rtk host-test-slot --class focused pnpm test:blueprint
rtk pnpm build
rtk pnpm check:functions
```

Maestro after committing the branch head:

```bash
rtk maestro-remote-test -- pnpm --dir packages/convex exec vitest run convex/checks/blueprintAcquisitionContext.test.ts convex/adapters/blueprintCheckout.test.ts convex/adapters/admaxxerPayments.test.ts convex/adapters/dodoWebhookRoutes.test.ts
rtk maestro-remote-test -- pnpm verify
```

Expected: exact branch heads pass. Qlty is advisory; Woodpecker
`ci/woodpecker/pr/verify` is the merge authority.

- [ ] **Step 2: Merge through protected GitHub and deploy exact Maestro main to
      Woodpecker staging**

The deployment event target is `staging`. Confirm `CI_COMMIT_SHA` equals the
merged main SHA, staging uses its own Convex deployment and Dodo test key, and
the receipt records Convex deployment, Worker version, rollback version, and
smoke success.

- [ ] **Step 3: Deploy an Owned Funnel Builder preview bound to staging**

Set the preview-only public runtime URL, app URL, Turnstile site key, workspace,
lead-magnet slug, and enable flag. Verify contract tests before and after the
preview deploy; production remains disabled.

- [ ] **Step 4: Run all four safe Snapshot canaries**

For agency owners, consultants, coaches, and solo experts: valid LinkedIn;
private/unavailable LinkedIn; rate-limit/provider recovery; durable result;
thank-you bridge; direct `$5` entry; and recovery. Use owner-approved canary
identity only. Check specific, factual, non-fabricated output.

- [ ] **Step 5: Complete fixtures, then the approved live `$1` canary**

Use test mode for signature, duplicate, delayed-return, failure, refund, and
dispute fixtures only. Create one non-public live `$1 USD` Game Plan product;
its controlled checkout adds trusted metadata `launch_canary=true`. Create a
new canary-only offer-policy version with `amountMinor=100` and the canary
product mapping; never edit the approved `$5` policy version in place.
After separate charge, identity, card-entry, and refund approval, the owner
enters the card in Dodo. Prove checkout, pending return, signed webhook,
product binding, claim, audit, plan, five drafts, export, revision, continuation,
Admaxxer Purchase `$1`, Meta event, refund, and revocation. Restore the real `$5`
mapping and deactivate/archive the canary. Do not test `$99` Activation.
Read back the restored `$5` policy and product before promotion.

- [ ] **Step 6: Commit staging evidence**

```bash
rtk git add docs/launch/blueprint-paid-traffic-evidence.md
rtk git commit -m "docs: record Blueprint staging acceptance"
```

### Task 6: Promote Exact Accepted Builds And Verify Live No-Charge Behavior

**Files:**

- Modify: `docs/launch/blueprint-paid-traffic-evidence.md`

**Interfaces:**

- Produces: stable public URLs, exact production SHAs, live Dodo/Admaxxer/Meta
  readback, no-charge checkout proof, and production rollback coordinates.
- Consumes: Task 5 staging acceptance and explicit campaign-activation approval.

- [ ] **Step 1: Bind production without reusing staging authority**

Read back production Convex, Worker, Dodo live product and webhook, Turnstile,
model/provider, Admaxxer website/key, Meta destination, support, refund, and
runtime identities. `STAGING_ACCEPTED_SHA` must exactly match the production
deploy SHA.

- [ ] **Step 2: Promote Maestro through the existing Woodpecker `production`
      target**

Do not use the free-only `blueprint-production` lane for the paid journey; it
intentionally excludes Dodo and the web runtime. Record the full deployment
receipt and rollback command.

- [ ] **Step 3: Deploy the exact accepted Owned Funnel Builder commit and enable
      the production runtime only after the Maestro receipt passes**

Verify all four Snapshot routes, four Game Plan routes, asset, return, claim,
and Game Plan routes show the intended robots/canonical behavior and exact copy.

- [ ] **Step 4: Verify live mode without charging**

Open the `$5` checkout, confirm `live_mode`, product, USD total, production
return URL, and customer support/refund language, then stop before payment.
Verify live PageView, durable Snapshot Lead, cross-domain visitor handoff, live
webhook registration, and correct Meta dataset. Mark Purchase
`intentionally uncharged` unless a separate live charge is approved.

- [ ] **Step 5: Commit final production evidence**

```bash
rtk git add docs/launch/blueprint-paid-traffic-evidence.md
rtk git commit -m "docs: record Blueprint production proof"
```

## Completion Audit

- Four audience variants retain one audience, one outcome, and one action.
- Snapshot unavailable/private/rate-limited paths fail safely and retain state.
- Durable Snapshot Lead fires once; visitor attribution crosses to Dodo without
  entering URLs or authorization.
- Verified Dodo payment is the sole entitlement and Purchase authority.
- Approved live `$1` canary proves claim, audit, plan, five drafts, export,
  revision, refund, and continuation.
- Admaxxer and Meta agree on canary payment ID, `$1`, USD, visitor, and funnel;
  the real `$5` checkout is verified without charge.
- Production uses the exact staging-accepted commits and full Woodpecker lane.
- Live checkout is proven without charge and Purchase is explicitly
  `intentionally uncharged` unless separately approved.
