# Five-Funnel Paid-Traffic Launch Design

Date: 2026-08-02

Status: revised after self-review; pending written-spec approval

## Summary

Prepare and launch five funnels on Facebook/Meta with production Dodo payments,
Admaxxer attribution, Meta Conversions API, verified fulfillment, editable copy,
and explicit per-funnel readiness evidence. The five campaigns may be activated
together only after every funnel passes its own release gate and the shared
payment and tracking infrastructure passes once end to end.

The five funnel families are:

1. **Owned Funnel Builder** — $49 base product, $19 order bump, and two upsells.
2. **Talking-Head Ad Machine** — $27 base product, $9 order bump, and one upsell.
3. **Vibe Code Anything** — $29 base product, $19 order bump, and two upsells.
4. **Authority Snapshot to $5 CMO Game Plan** — free acquisition product and
   one $5 paid product across four audience variants.
5. **App Idea Evaluator** — free Buildability Report and one $29 Complete Build
   Pack.

This is one launch program, not one deployment. It spans the Owned Funnel
Builder repository and Cloudflare project, the canonical Maestro Blueprint
backend, and the Maestro Template App Idea application. Each system retains its
existing authority; the launch must not create a parallel checkout, entitlement,
analytics, or generation backend.

## Goals

- Make all five funnels ready for paid Meta traffic.
- Run Dodo in live mode with environment-specific keys, products, webhook
  secrets, and return URLs.
- Preserve the existing test environment for safe end-to-end purchase tests.
- Configure Admaxxer page, Lead, visitor, revenue, and Meta CAPI attribution.
- Repair the known Dodo webhook routing failure without weakening signature or
  idempotency guarantees.
- Apply pending database migrations without losing existing leads, purchases,
  fulfillment, or product mappings.
- Let the owner revise customer-visible copy in plain language, using Keystatic
  where it is already canonical and agent-applied edits elsewhere.
- Build every Meta campaign paused, verify its exact URL and events, then
  activate all five in one coordinated release window.

## Non-Goals

- No new universal funnel framework or cross-repository CMS.
- No Stripe migration.
- No replacement for Maestro's Blueprint or App Idea product backends.
- No live charge without separate approval of the amount and refund handling.
- No automatic publishing of generated content or customer media.
- No launch of the optional $99/month Blueprint Activation subscription. It
  remains informational until its own billing, capacity, cancellation, credit,
  and entitlement contract is approved and tested.
- No fabricated proof, testimonials, performance claims, urgency, or scarcity.

## Current-State Evidence

The following facts were observed before writing this design:

- `shop.maestrogtm.com` is the Cloudflare production domain for the Owned
  Funnel Builder project.
- Production serves commit `25bbc4a`, while repository `main` is `b1a1da2`.
- The latest Blueprint preview deployment serves `b1a1da2`, but its purchase
  actions remain fail-closed without the Blueprint runtime environment.
- Owned Funnel Builder and Vibe Code Anything are published with checkout
  enabled. Talking-Head Ad Machine is unpublished and checkout-disabled.
- The standard D1 product registry contains all 11 configured standard-funnel
  products and their expected prices.
- Production D1 has migrations 0001 through 0005. Migration
  `0006_stripe_provider.sql` is not applied, although current `main` expects its
  provider columns and migrated product table.
- Existing production data includes 9 converted Owned Funnel Builder leads,
  19 additional Owned Funnel Builder checkout sessions, one Vibe Code Anything
  checkout session, and 16 sent fulfillment records.
- Nine `payment.succeeded` webhooks with source `owned-funnel-builder` were
  processed. Two signed diagnostic payments with source
  `owned-funnel-diagnostic` failed because they lacked funnel metadata.
- The shared Admaxxer pixel and server-side payment ingestion exist on `main`,
  but the standard production funnel pages do not currently load the pixel
  because production is behind `main`.
- Blueprint PRs 3638 and 3639 are merged in the Maestro repository. The
  production Blueprint pages remain disabled previews and require a current
  deployed canary, runtime bindings, proof permission, and Dodo test purchase.
- The App Idea Evaluator was merged through PR 16 at `4aa0b268`, with focused
  tests passing. Its production Cloudflare deployment predates the funnel and
  its environment-specific Convex and release bindings remain unresolved.

Historical context affecting this design is indexed at ctx session
`fe892dc0-696a-7e2f-941e-449cf48aece0`, event
`3d64288f-69f1-7088-aed8-981ca81de33b` for the Blueprint launch contract, and
ctx session `b1b2a005-b17b-745b-91cb-0c9e9eab4cec`, event
`67f279e9-135f-7758-9dfb-6b8726770a6b` for the App Idea product and operations
contract.

## System Boundaries

### Owned Funnel Builder platform

Owns the landing pages, email capture, D1 attribution, Dodo checkout, optional
bump, post-purchase upsells, standard-product fulfillment, Admaxxer pixel, and
Admaxxer Payments API ingestion for Owned Funnel Builder, Talking-Head Ad
Machine, and Vibe Code Anything.

Shared payment code remains centralized. Offer copy and funnel economics remain
separate content records. A fix to shared checkout, webhook, fulfillment, or
tracking behavior must be covered once at the shared boundary and verified for
all three offer definitions.

### Maestro Blueprint platform

Owns the free Authority Snapshot, durable recovery, $5 Game Plan checkout,
payment truth, paid audit, retained artifacts, CMO continuation, and four
audience variants. The Owned Funnel Builder site is the public acquisition
surface only. It must call the existing Maestro Blueprint runtime and must not
gain a second Blueprint database or payment authority.

### Maestro Template App Idea platform

Owns the free evaluation, report claim and revision, $29 Complete Build Pack
checkout, Dodo webhook entitlement, checkpointed paid generation, exports,
Maestro credit, and template mapping. Implementation begins from a clean
worktree at current `main`; the existing worktree with a modified generated file
is not reused.

## Commercial and Copy Contract

Before a provider product or Meta campaign is changed, every funnel receives an
approved offer sheet containing:

- one primary buyer;
- one repeatable outcome;
- one primary action;
- exact price, currency, bump, and upsell sequence;
- tangible deliverables and delivery timing;
- prerequisites and disqualifiers;
- refund or guarantee terms;
- permitted proof and its source;
- prohibited claims;
- ad promise, landing headline, and CTA message match;
- launch geography and any tracking-consent requirement it creates;
- support contact, refund owner, and customer-response expectation.

The intended message hierarchy is:

| Funnel | Traffic promise | Paid action |
| --- | --- | --- |
| Owned Funnel Builder | Own and reuse a complete funnel instead of renting another platform | Get the complete builder for $49 |
| Talking-Head Ad Machine | Turn an existing raw clip into a reviewable Meta ad with a coding agent | Get the Ad Machine for $27 |
| Vibe Code Anything | Start from a serious application shell instead of a blank repository | Get the full template for $29 |
| Authority Snapshot / Game Plan | Find the visible authority weakness, then get a focused 30-day publishing plan | Get the free Snapshot, then the $5 Game Plan |
| App Idea Evaluator | Learn whether an app idea is worth testing, then learn exactly how to build it | Get the free report, then the $29 Complete Build Pack |

The three standard funnels remain editable through their Keystatic-backed offer
and funnel records. Blueprint and App Idea copy remains in their existing
canonical product records. The agent presents proposed replacements in a copy
deck and applies approved edits; no second source of truth is introduced.

The copy deck covers every launch-visible surface: Meta primary text, headline,
description, landing-page first fold, body claims, CTA, checkout labels, bump and
upsell copy, thank-you or recovery copy, fulfillment email, support language,
privacy disclosure, and refund language. One complete ad package per funnel is
required for launch; extra variants wait until the baseline journey is proven.
Approval records the final text and source path so deployment cannot silently
mix copy revisions.

Paid-ad proof is stricter than page proof. Blueprint testimonials and prior
performance claims require source records and explicit paid-ad permission. Any
claim without that evidence is removed from ads and acquisition pages before
launch. Synthetic examples remain labeled as examples.

## Database Migration Design

Migration 0006 must precede deployment of current Owned Funnel Builder `main`.
The release sequence is:

1. Record the current production deployment and D1 recovery identifier.
2. Create a D1 export or time-travel bookmark.
3. Apply migrations through 0006 to an isolated preview database populated
   with representative existing rows.
4. Verify the migrated `offer_products`, `checkout_leads`, and `funnel_runs`
   schemas and all 11 Dodo mappings.
5. Run checkout, webhook, fulfillment, and attribution tests against the
   migrated schema.
6. Apply 0006 to production without deleting or rewriting real business rows.
7. Read back migration history, product mappings, lead counts, conversion
   counts, and fulfillment counts.
8. Deploy the exact reviewed commit only after the readback passes.

Rollback restores the prior Pages deployment. D1 rollback uses the recorded
export or time-travel point only if the migration causes an observed data or
schema failure; it is never used to erase valid transactions created afterward.

Blueprint and App Idea schema changes use their existing Convex deployment and
migration authorities. Staging and production deployments must be distinct,
and a shared Convex backend is forbidden.

## Dodo Live-Mode Design

Test and live Dodo environments remain completely separate. Each environment
has its own API key, webhook secret, products, customers, transactions, and
return URLs. The live environment must never reference a product created in
test mode.

Live-mode work cannot begin until Dodo KYC and business verification are
approved and the live account's business details, support details, payout
access, and refund/dispute owner are confirmed. Every runtime passes
`test_mode` or `live_mode` explicitly; an unset or unrecognized value fails
closed to test mode or blocks startup and never silently selects live mode.

Thirteen products are required for this launch:

- 11 standard products across the first three funnels;
- one $5 CMO Game Plan product;
- one $29 Complete Build Pack product.

For every product, the launch operator must read back:

- product name and product ID;
- exact price and currency;
- tax category;
- active status;
- delivery or entitlement configuration;
- refund terms;
- environment identity.

Each environment has its own HTTPS webhook registration and signing secret.
The subscribed one-time-purchase event set is `payment.succeeded`,
`payment.failed`, `refund.succeeded`, `dispute.opened`, `dispute.accepted`,
`dispute.won`, and `dispute.lost`, plus `entitlement_grant.delivered`,
`entitlement_grant.failed`, and `entitlement_grant.revoked` where Dodo Digital
Files is authoritative. The endpoint URL, event set, secret binding name, and a
successful signed delivery are read back separately in test and live mode.

Standard downloadable products use real Dodo Digital Files entitlements and
plain-language access instructions. Blueprint and App Idea purchases grant
application access only from their canonical verified webhook handlers. A
checkout return is never payment truth.

Refund and dispute handling follows the product's real access model. Standard
downloads are marked refunded or disputed, cannot be fulfilled again, and
revoke any revocable Dodo entitlement; already downloaded files are not
pretended to be recoverable. Blueprint and App Idea revoke gated paid access
and future paid generation according to their existing entitlement authority
without deleting customer-authored input. Out-of-order events cannot downgrade
a successful payment to failed or re-grant access after a terminal revocation;
when event order is ambiguous, the current Dodo resource state is authoritative.

Verification occurs at three levels:

1. **Fixtures:** invalid signature, duplicate webhook, failed payment, refund,
   dispute, missing product, stale lock, and retry behavior.
2. **Test mode:** one full base purchase per funnel, bump declined and selected
   where applicable, every upsell declined, each upsell accepted in a safe test
   flow, and fulfillment or application access verified.
3. **Live mode without charge:** open one checkout per base product, confirm the
   response reports live mode, confirm cart and total, and stop before payment.

A real live purchase is optional evidence and requires separate explicit
approval of the product, amount, test email, and refund plan.

## Webhook Repair Design

The known standard-platform failure is a routing-boundary defect, not a
signature or fulfillment defect. The account-wide Dodo endpoint received valid
diagnostic payments that were not created by a funnel run. The current handler
attempted to process them as funnel purchases, could not find funnel metadata,
returned a failure, and invited retries.

The minimum root-cause fix is:

1. Verify the raw request and Dodo signature exactly as today.
2. Persist the original signed event before returning `2xx`; persistence
   failure returns non-`2xx` so Dodo retries.
3. Acquire one atomic processing claim per `webhook-id`. A duplicate may return
   `2xx` only when the event is terminal or another non-stale claim owns it; a
   failed or stale claim remains reclaimable.
4. Classify the event by trusted `metadata.source` and configured product.
5. Process `owned-funnel-builder` events through the existing funnel handler.
6. Acknowledge diagnostic or unrelated account payments as an intentional
   no-op instead of a processing failure.
7. Preserve the original event payload and terminal result for audit; source
   classification remains derivable from the verified payload.
8. Keep unknown events retryable only when they claim to be funnel events but
   violate the funnel contract.

Durable conversion, entitlement, and fulfillment writes remain independently
idempotent by payment and product. Email and Admaxxer are external effects: a
retry may attempt them again, so each uses its existing stable fulfillment or
transaction key. A webhook is not terminally processed until all required
effects have either succeeded or have a durable retry record. Missing live
Admaxxer configuration is a launch-blocking configuration failure, not a silent
successful attribution result.

Tests must prove:

- a missing or invalid signature grants nothing;
- a valid diagnostic payment returns 2xx and grants nothing;
- a valid funnel payment converts the correct lead and fulfills once;
- concurrent duplicate webhooks have one processing owner and produce no
  duplicate fulfillment or revenue event;
- a failed or stale processing claim can be retried safely;
- a failed external fulfillment remains retryable;
- a temporary Admaxxer failure can retry without duplicating fulfillment;
- missing Admaxxer configuration cannot silently pass in live mode;
- logs contain no email, API key, raw flow token, or payment details.

The two historical failed rows remain immutable audit evidence. Readiness
requires no new unclassified failure during the canary window.

Blueprint and App Idea webhook handlers must independently prove raw-body
verification, webhook-ID idempotency, payment-to-product binding, delayed return
recovery, refund/dispute revocation, and no entitlement from the return URL.

## Admaxxer and Meta CAPI Design

Admaxxer is the acquisition and revenue attribution layer. Product analytics
already present in Maestro or App Idea may remain; they do not replace
Admaxxer's campaign attribution.

Use one Admaxxer website for `shop.maestrogtm.com`, segmented by `offer_slug`,
plus one for the Blueprint runtime hostname and one for the App Idea production
hostname. The Blueprint handoff carries attribution through an existing
server-side record or signed opaque state; it does not put email, secrets, or a
raw flow token in the URL. Every hostname that renders an acquisition or
conversion step loads exactly one intended pixel. Website IDs and public
tracking domains are environment values, never hard-coded into reusable
components.

The canonical event flow is:

```text
Meta ad with UTMs and fbclid
  -> Admaxxer page view
  -> successful durable acquisition action
  -> identify the visitor and emit one Lead
  -> attach admx_visitor_id to Dodo metadata
  -> verify payment.succeeded webhook
  -> complete idempotent fulfillment
  -> ingest one Admaxxer Purchase using the Dodo payment ID
  -> forward the configured server event to Meta CAPI
```

The durable Lead boundary differs by funnel:

| Funnel | Lead fires after | Stable identity |
| --- | --- | --- |
| Owned Funnel Builder | Dodo checkout session is created | checkout lead ID |
| Talking-Head Ad Machine | Dodo checkout session is created | checkout lead ID |
| Vibe Code Anything | Dodo checkout session is created | checkout lead ID |
| Authority Snapshot | Snapshot is durably saved or claimed | snapshot/lead ID |
| App Idea Evaluator | free report is durably saved or claimed | report/lead ID |

PageView is browser-side. Lead fires once at the boundary above, not on typing,
button click, invalid email, bot rejection, or failed provider work. Purchase is
server-side only after a verified successful-payment webhook, with Dodo
`payment_id` as the transaction and deduplication key. `offer_slug`, value,
currency, UTMs, `fbclid`, and the Admaxxer visitor ID survive every cross-domain
handoff and enter the payment metadata where the provider permits it.

Purchase must not fire from the browser or return URL. No second browser
Purchase is added unless Admaxxer's current documentation supplies an explicit
shared deduplication contract.

The owner supplies or approves Meta CAPI access inside Admaxxer. Meta tokens
must not enter any repository. A first-party tracking hostname such as
`t.maestrogtm.com` may be configured after its exact Admaxxer website is known;
it never replaces the storefront hostname and is not a launch blocker unless
Admaxxer requires it for the selected configuration.

Production verification must demonstrate:

- one live page view per intended hostname;
- one successful Lead after checkout-session creation;
- a non-empty visitor ID in the payment metadata;
- preservation of UTMs and `fbclid`;
- one API-ingested Purchase with correct value and currency;
- the correct Meta pixel/dataset destination;
- browser/server deduplication where Admaxxer emits both sides;
- no test purchase contamination in production reporting.

Privacy copy must disclose visitor identifiers, email identification, campaign
parameters, payment attribution, Admaxxer, and server-side advertising events.
Raw Meta or Admaxxer secrets never reach the browser, logs, Dodo metadata, or
repositories. Launch geography determines consent behavior: where prior opt-in
is legally required for nonessential advertising tracking, the pixel remains
blocked until consent; elsewhere the approved notice and opt-out behavior must
still be present. User-data transmission follows the provider's required
normalization or hashing contract and is verified without logging the value.

## Funnel-Specific Release Gates

### Owned Funnel Builder

- Copy, $49 price, $19 bump, both upsells, guarantee, and delivery agree.
- All four live products and Digital Files attachments read back correctly.
- Bump defaults off; upsell accept, decline, failure, and fallback paths pass.
- Keystatic exposes intended copy without product IDs or secrets.

### Talking-Head Ad Machine

- Windows 11 x64, Apple Silicon, and Intel Mac deliverables are real and tested.
- The raw/finished demonstration and compatibility claims are accurate.
- $27 base, $9 bump, and $37 upsell read back from Dodo.
- Test entitlement downloads work before `published` and checkout are enabled.
- Linux, Windows ARM, phone-app, auto-publishing, and unsupported performance
  expectations remain explicitly disqualified.

### Vibe Code Anything

- The route name, Maestro SaaS UI Template product name, and ad promise form one
  coherent offer rather than implying literally any application is complete.
- $29 base, $19 bump, $39 blueprint upsell, and $79 launch-pack upsell agree.
- Claims about implemented surfaces, providers, and production readiness are
  tied to current product evidence.
- Delivery provides the exact template release and setup instructions promised.

### Authority Snapshot and $5 CMO Game Plan

- All four audience variants preserve one audience, one outcome, and one action.
- Snapshot handles LinkedIn unavailable/private/rate-limited paths safely.
- A current Maestro canary produces a durable saved Snapshot without invented
  proof.
- Recovery, thank-you bridge, direct $5 entry, checkout return, claim, paid
  audit, retained outputs, and CMO continuation pass on staging.
- The paid result produces the promised 30-day plan and retained first five
  drafts, compared with an owner-approved reference output for specificity,
  factuality, usefulness, and absence of fabricated proof.
- Proof and testimonial permissions cover landing pages and paid ads, or the
  affected proof is removed.
- Blueprint runtime URLs, Turnstile, live flag, workspace, and lead-magnet
  identities read back from the exact deployment.

### App Idea Evaluator and $29 Complete Build Pack

- Work starts from a clean current-main worktree, not the existing dirty
  release worktree.
- The configured Convex workflow-output smoke passes without faking deployment
  access.
- Staging and production Cloudflare, Convex, email, Dodo, LLM, analytics, and
  storage bindings are environment-isolated.
- Free evaluation, claim, revision, download, share, and library flows pass.
- $29 checkout, delayed webhook, entitlement, refund/dispute, and Maestro credit
  pass.
- All eight Build Pack stages checkpoint, resume, and avoid repurchase after a
  recoverable failure.
- Low-fit ideas suppress the Maestro sale and keep the portable Build Pack.
- Admaxxer acquisition and revenue events coexist with privacy-safe product
  analytics.

## Quality and Verification

Every surface must be checked at desktop, tablet, and mobile sizes. Verification
includes:

- format, lint, typecheck, production build, Functions or Convex compilation,
  and focused tests;
- content and publish-mode validation;
- payment, bump, upsell, webhook, idempotency, fulfillment, refund, and dispute
  tests proportional to each funnel;
- browser console and failed-resource inspection;
- horizontal overflow, keyboard, focus, headings, labels, touch targets,
  contrast, serious/critical Axe findings, and 200% text resizing;
- canonical URL, metadata, robots policy, social image, privacy, terms, and
  support links;
- fresh screenshots tied to the reviewed commit;
- exact preview and production commit verification;
- stable rollback identifier for each deployment.

Broad tests for Maestro repositories run on `maestro-worker` after committing
the relevant branch head. Broad local tests on the control Mac use
`host-test-slot`. Woodpecker is the sole CI authority.

## Meta Campaign Design

Create five campaign families with independently measurable ad sets and ads.
The three direct-sale funnels use the Sales objective optimized for Purchase.
Authority Snapshot and App Idea Evaluator begin with the objective optimized for
their durable Lead boundary because the ad promise is a free result; Purchase
remains the downstream revenue event. Changing a free-entry campaign to
Purchase optimization requires enough clean attributed purchase volume to make
that decision evidence-based.

Campaign URLs use a consistent convention:

- `utm_source={{site_source_name}}` so automatic placements report their real
  Meta source;
- `utm_medium=paid_social`;
- a stable funnel slug in `utm_campaign`;
- `utm_id={{campaign.id}}`;
- `utm_term={{adset.id}}`;
- `utm_content={{ad.id}}`, with the readable audience, angle, and creative
  variant retained in Meta's ad-set and ad names;
- Meta `fbclid` preserved automatically.

Every ad must match the first landing-page fold on audience, outcome, and next
action. The minimum launch inventory is one approved copy-and-creative ad, one
destination URL, and one explicitly named audience per funnel. Additional hooks,
creatives, and retargeting sets are not launch blockers. Campaigns are created
paused. Before activation, each campaign receives one destination click and
trace through page view and the deepest safe no-charge event.

All five campaigns may be activated in the same launch window only when the
launch ledger contains five green funnel rows and one green shared-infrastructure
row. Budgets remain independent so one funnel can be paused without affecting
the others.

## Launch Ledger and Status Rules

Each required check is reported as `passed`, `failed`, `unverified`, or
`intentionally uncharged`. A funnel is green only when:

- approved copy and proof are live;
- exact production commit and hostname are verified;
- Dodo test purchase and live no-charge checkout pass;
- fulfillment or application entitlement passes;
- Admaxxer PageView, Lead, and visitor metadata pass;
- Purchase attribution passes end to end in test mode, while production is
  either proven by an approved live purchase or explicitly marked
  `intentionally uncharged` with its live configuration read back;
- Meta destination and event reception pass;
- responsive, accessibility, and browser checks pass;
- monitoring and rollback are ready;
- no unresolved high-severity finding remains.

An environment key being present by name is not proof that its value or mode is
correct. A script tag is not proof that an event arrived. A checkout return is
not proof that payment succeeded. A Git push is not proof of deployment.

`Intentionally uncharged` is allowed only for the final live Purchase event. It
does not waive a test-mode end-to-end purchase, a live no-charge checkout, live
webhook registration, product and destination readback, or first-customer
monitoring. The first real production purchase becomes the canary: if Dodo,
fulfillment, Admaxxer, and Meta do not agree on payment ID, value, and currency,
the affected campaign pauses before more spend accumulates.

## Error Handling and Monitoring

Monitor:

- checkout creation failures by offer and provider;
- Dodo webhook delivery, classification, processing, and retry status;
- fulfillment and entitlement failures;
- Admaxxer ingestion failures and transaction deduplication;
- Meta CAPI event reception, match quality, and deduplication;
- Blueprint and App Idea generation failures and resume state;
- page errors, failed assets, and unexpected response codes;
- spend, landing views, Leads, checkout starts, Purchases, conversion rate, and
  revenue by funnel.

Provider `402`, `429`, or usage-limit errors are environmental blockers. They do
not trigger repeated identical launches or speculative code fixes. A funnel may
be paused independently while the other four remain available.

The first-day review points are activation, 15 minutes, 30 minutes, 60 minutes,
4 hours, and 24 hours. Any spend with zero expected PageViews, a paid order
without fulfillment, a payment without one attributed Purchase, or a material
price/currency mismatch pauses the affected funnel immediately. Other alert
thresholds are recorded in the launch ledger before activation, not invented
during an incident.

## Implementation Planning Boundary

This program produces four execution plans under one launch ledger, not one
cross-repository mega-change:

1. standard platform: copy, migration 0006, shared webhook repair, Dodo catalog,
   Admaxxer, and the first three funnels;
2. Blueprint: Authority Snapshot variants, $5 Game Plan, runtime bindings,
   cross-domain attribution, and release proof;
3. App Idea: clean-worktree release, environment bindings, free report, $29
   Build Pack, entitlement, and attribution;
4. Meta activation: approved ads, paused campaign construction, destination
   traces, six-row ledger review, activation, and first-day monitoring.

Each repository uses its own branch, CI result, deployment identifier, and
rollback. The plans may prepare independently, but production promotion follows
the dependency order below and campaign activation remains the final gate.

## Deployment and Launch Sequence

1. Approve the five offer sheets and copy deck.
2. Confirm Dodo live-account approval, business details, and refund ownership.
3. Record deployment, database, product, webhook, and tracking baselines.
4. Test and apply Owned Funnel Builder migration 0006.
5. Add the webhook source-classification and retry-ownership regression tests,
   then apply the root-cause fix.
6. Verify the standard platform in preview against the migrated schema.
7. Provision or read back all test and live Dodo products, webhooks, and
   entitlements.
8. Complete test-mode purchase matrices for all five funnels.
9. Configure Admaxxer websites, cross-domain handoffs, pixels, server ingestion,
   consent behavior, and privacy copy.
10. Connect the owner-provided Meta CAPI destination inside Admaxxer.
11. Deploy and verify the current Owned Funnel Builder production commit.
12. Deploy and verify Blueprint staging, run all audience canaries, then promote
    the exact accepted versions.
13. Provision App Idea release bindings, run the configured Convex smoke, deploy
    staging, verify the free and paid journeys, then promote the accepted version.
14. Open live-mode no-charge Dodo checkouts for all five base products.
15. Verify Admaxxer and Meta events end to end, using `intentionally uncharged`
    only for the final production Purchase when no live charge was approved.
16. Create Meta campaigns paused and verify their exact destination URLs.
17. Review the six-row launch ledger: shared infrastructure plus five funnels.
18. Activate all five campaign families in the approved launch window.
19. Monitor continuously for the first hour and at scheduled checkpoints over
    the first 24 hours; pause only the affected funnel when a localized failure
    appears.

## Human Approvals

The owner is asked only for decisions or authority that cannot be inferred:

- approve final offer copy, prices, proof, guarantees, and prohibited claims;
- approve Cloudflare or DNS access if a browser authorization is required;
- provide or approve Meta CAPI connection information inside Admaxxer;
- approve Dodo live-account access when required;
- approve campaign geography, audiences, budgets, and any consent-dependent
  tracking behavior;
- approve any real live charge with its amount and refund plan;
- approve final campaign activation and budgets.

The owner is never asked to edit source, run commands, identify product IDs,
name environment variables, or paste secrets into a repository.

## Completion Criteria

The program is complete when all five public funnels are reachable at their
stable production URLs, their exact commits are recorded, their copy is
approved, full test-mode purchases pass, live Dodo checkouts are verified, and
the live Purchase gate is either proven by an approved charge or explicitly
recorded as `intentionally uncharged`. Webhooks and fulfillment are healthy,
Admaxxer and Meta CAPI show the required events at the evidence level defined by
the launch ledger, campaigns are active, and the first 24-hour monitoring window
ends without an unresolved launch-blocking defect.
