# Five-Funnel Meta Campaign Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approve copy, build five paused Meta campaigns, prove destinations and
events, activate together, and monitor the first 24 hours with pause rules.

**Architecture:** Keep ads separate from product releases. Every funnel first
passes the six-row launch ledger. Create one simple ad per funnel with stable
slugs and Meta dynamic IDs in UTMs, publish paused, then activate only the five
reviewed campaigns in one release window.

**Tech Stack:** Meta Ads Manager/Marketing API, Admaxxer, Meta Events Manager,
Cloudflare funnels, Dodo, and Markdown evidence in Owned Funnel Builder.

## Global Constraints

- Coordination repository: `/Users/headless/owned-funnel-builder`; execute in a
  clean isolated worktree from current `origin/main`.
- Activation waits for the standard, Blueprint, and App Idea plans and six
  green ledger rows.
- Create campaigns, ad sets, and ads paused. Publishing is not activation.
- One copy-and-creative ad per funnel is enough. Extra variants, dynamic
  creative, automated rules, and experiments wait for baseline data.
- No fabricated proof, outcomes, urgency, scarcity, or testimonials.
- No secrets, tokens, card/customer data, or raw event payloads in evidence.
- The optional `$99/month` Blueprint Activation remains excluded.
- Campaign activation authorizes no charge. Live `$1` canaries retain their
  separate product-plan approvals.

## Campaign Contract

| Funnel slug | Promise | Objective / website event |
| --- | --- | --- |
| `owned-funnel-builder` | Own and reuse a complete funnel | Sales / Purchase |
| `talking-head-ad-machine` | Turn a raw clip into a reviewable Meta ad | Sales / Purchase |
| `vibe-code-anything` | Start from a serious app shell | Sales / Purchase |
| `authority-snapshot` | Find the visible authority weakness | Leads / Lead |
| `app-idea-evaluator` | Learn whether an app idea is worth testing | Leads / Lead |

Every destination uses exactly:

```text
utm_source={{site_source_name}}
utm_medium=paid_social
utm_campaign=owned-funnel-builder
utm_id={{campaign.id}}
utm_term={{adset.id}}
utm_content={{ad.id}}
```

Replace only the `utm_campaign` value with the corresponding literal slug from
the campaign table for the other four funnels. Preserve Meta's `fbclid`; do not
add it manually.

## Files And Evidence

- Create: `docs/launch/five-funnel-copy-deck.md`
- Create: `docs/launch/five-funnel-launch-ledger.md`
- Create: `docs/launch/meta-campaign-build-evidence.md`
- Create: `docs/launch/meta-activation-monitoring.md`
- Modify canonical copy files only after owner approval.

---

### Task 1: Approve Five Offer And Copy Packages

**Files:**

- Create: `docs/launch/five-funnel-copy-deck.md`
- Modify after approval: canonical funnel/content files named in the deck

**Interfaces:** Produces one approved buyer, promise, offer, CTA, proof set, and
launch ad per funnel. Consumes deployed commercial terms; creates no second copy
authority.

- [ ] **Step 1: Draft one complete package per funnel**

Include Meta primary text, headline, description, creative script/shot list,
landing first fold/body/CTA, price, bump/upsell where applicable, checkout,
recovery/thank-you, fulfillment email, support, privacy, and refund copy. Cite
the canonical source path for each surface.

- [ ] **Step 2: Review claims and message match**

Remove unsupported proof, testimonials, numbers, urgency, or outcomes. Confirm
the ad, landing page, checkout, and actual delivery promise the same thing.

- [ ] **Step 3: Obtain approval and apply only approved text**

Record approval date/text. Use existing Keystatic JSON for standard funnels and
existing canonical Maestro/App Idea records for application funnels. Add no CMS.

- [ ] **Step 4: Run the exact focused copy/build gates from each product plan**

Expected: deployed copy matches one approved deck revision without mixed text.

- [ ] **Step 5: Commit coordination copy**

```bash
rtk git add docs/launch/five-funnel-copy-deck.md src/content
rtk git commit -m "copy: approve five paid-traffic offers"
```

Commit Maestro/App Idea copy in their repositories and record the same deck
revision in their audits.

### Task 2: Build The Six-Row Launch Ledger

**Files:**

- Create: `docs/launch/five-funnel-launch-ledger.md`

**Interfaces:** Produces shared-infrastructure plus five funnel rows. Each gate
has evidence, owner, rollback, and `passed|failed|unverified|intentionally
uncharged` status.

- [ ] **Step 1: Add shared infrastructure**

Require live Dodo/account approval, environment isolation, webhooks, migrations,
Admaxxer websites, Meta dataset/CAPI, privacy/consent, monitoring, support,
refund ownership, and rollback.

- [ ] **Step 2: Add one row per funnel**

Require deployed SHA/URL, approved copy/proof, responsive/accessibility, Dodo
product/webhook readback, applicable paid-stage `$1` canary evidence, real-price
no-charge checkout, fulfillment/entitlement, PageView, Lead, visitor metadata,
Purchase, Meta destination, and rollback.

- [ ] **Step 3: Validate closure**

No blank cell is green. `Intentionally uncharged` applies only to a final
real-price Purchase after the separate `$1` canary; it cannot waive webhook,
attribution, refund, or entitlement evidence.

- [ ] **Step 4: Commit the ledger**

```bash
rtk git add docs/launch/five-funnel-launch-ledger.md
rtk git commit -m "docs: assemble five-funnel launch ledger"
```

### Task 3: Create Five Campaigns Paused

**Files:**

- Create: `docs/launch/meta-campaign-build-evidence.md`

**Interfaces:** Produces five paused campaigns, five initial ad sets, and five
initial ads with stable names, destinations, budgets, objectives, attribution,
and UTMs. Consumes owner-approved geography, budgets, audiences, identity,
dataset, and creatives.

- [ ] **Step 1: Read back Meta authority**

Record redacted ad account, page/identity, pixel/dataset, verified domains,
billing, timezone/currency, CAPI destination, permissions, and spend limits.
Stop if destination ownership is wrong.

- [ ] **Step 2: Create three direct-sale campaigns paused**

Use Sales with website Purchase for Owned, Talking-Head, and Vibe Code. Use the
approved budget/audience; no unapproved Advantage+ expansion or creative.

- [ ] **Step 3: Create two lead campaigns paused**

Use Leads with website Lead for Authority Snapshot and App Idea. Do not use an
Instant Form; the durable website action is the Lead boundary.

- [ ] **Step 4: Add one approved ad and exact UTMs per campaign**

Check mobile/desktop Feed, Stories, and Reels previews where eligible. Remove
incompatible placements instead of publishing broken crops or text.

- [ ] **Step 5: Record IDs and retain `PAUSED` state**

Record redacted ID suffixes, full URL, objective/event, budget, audience,
creative revision, review state, and `PAUSED`; never the access token.

### Task 4: Prove Destinations And Events

**Files:**

- Modify: `docs/launch/meta-campaign-build-evidence.md`

**Interfaces:** Produces one browser-to-server trace per funnel from exact ad
URL through Admaxxer and Meta test events.

- [ ] **Step 1: Open every exact ad destination**

Verify HTTP/canonical/robots, mobile first fold, approved copy, offer slug,
dynamic UTM substitution or representative preview IDs, and `fbclid` retention.

- [ ] **Step 2: Prove PageView and durable Lead**

For each funnel verify one PageView and one Lead at its defined boundary. Confirm
no Lead on load, typing, invalid input, or failed provider action.

- [ ] **Step 3: Reconcile Purchase without another charge**

Link product-plan `$1` canary payment evidence. Confirm Admaxxer and Meta agree
on transaction ID, value, currency, visitor, offer slug, and dataset.

- [ ] **Step 4: Confirm all ads are approved and paused**

For rejection, fix only the concrete policy/destination issue, reapprove copy,
and repeat the trace. Never activate processing or rejected ads.

### Task 5: Activate Together And Monitor 24 Hours

**Files:**

- Create: `docs/launch/meta-activation-monitoring.md`
- Modify: `docs/launch/five-funnel-launch-ledger.md`

**Interfaces:** Produces one coordinated activation and checks at activation,
15m, 30m, 60m, 4h, and 24h. Consumes explicit owner approval of campaign IDs,
budgets, and launch window after all ledger rows are green.

- [ ] **Step 1: Capture final preflight and approval**

Read back campaigns, budgets, audiences, objectives/events, destinations,
creatives, reviews, spend limit, billing, event traces, and rollback owners.

- [ ] **Step 2: Activate only the five reviewed campaigns**

Set those campaign objects active in one window; unrelated drafts remain paused.
Record exact timestamps and resulting states.

- [ ] **Step 3: Check activation, 15, 30, and 60 minutes**

Read delivery, spend, destination errors, landing views, Leads, checkouts,
Dodo/webhook failures, Admaxxer health, CAPI/deduplication, support, and runtime.

- [ ] **Step 4: Check 4 and 24 hours**

Reconcile Meta clicks/views, Admaxxer visitors/Leads/Purchases, Dodo
payments/refunds, internal leads/entitlements, and spend by funnel. Record normal
data latency rather than forcing immediate equality.

- [ ] **Step 5: Enforce pause rules**

Pause the affected campaign for wrong destination/copy/price, checkout,
webhook/fulfillment, missing/duplicate event, wrong dataset, privacy failure,
unexpected charge, support incident, or excess spend. Pause all five for a
shared Dodo, Admaxxer, CAPI, domain, or deployment failure.

- [ ] **Step 6: Treat the first real-price purchase as canary**

Verify product/value, webhook, fulfillment/entitlement, email, Admaxxer, Meta
dedupe, support, and refund readiness before allowing delivery to continue.

- [ ] **Step 7: Commit monitoring evidence**

```bash
rtk git add docs/launch/meta-activation-monitoring.md docs/launch/five-funnel-launch-ledger.md
rtk git commit -m "docs: record five-funnel Meta activation"
```

## Completion Audit

- Five copy packages match deployed destinations; six ledger rows are green.
- Exactly five baseline campaigns have required objectives/events and UTMs.
- Every campaign was reviewed paused with a full destination/event trace.
- Activation had explicit ID, budget, and window approval.
- Checks exist at activation, 15m, 30m, 60m, 4h, and 24h.
- The first real-price purchase passed or the affected campaign was paused.
- No Blueprint Activation subscription or unapproved experiment launched.
