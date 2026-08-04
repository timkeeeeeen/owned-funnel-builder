# Five-Funnel Launch Ledger

Revision: 2026-08-03-r2
Canonical artifact: this ledger owns funnel/canary state. The first-party event
pipeline spec owns tracking, consent, identity, and destination behavior;
Admaxxer/legacy-sender rows below are historical evidence only and cannot be
used to enable forwarding. `five-funnel-canary-matrix.json` is its machine
readback, and any future campaign ledger is a paused sub-ledger linked here,
not a second launch authority.
Rule: blank evidence is **unverified**, never green. `intentionally uncharged`
is permitted only for a final real-price Purchase after live configuration and
the separate $1 canary are proven.

Important Dodo constraint: test mode cannot validate one-click upsells. Test
mode may cover rendering, signatures, retries, and webhook fixtures, but every
paid stage—including each one-click upsell—must use its own temporary live `$1`
product and an owner-entered live card. Refund and revoke immediately after the
stage proof; never use the real-price catalog for this test.

## Shared infrastructure

| Gate | Status | Evidence / owner | Rollback |
| --- | --- | --- | --- |
| Dodo live account, mode, products, prices, attachments | unverified | Dodo readback; owner/provider | Disable checkout routes; restore prior catalog mapping |
| Dodo webhook URL, signature secret, retry/idempotency | passed locally / unverified live | `npm run test:functions`; production delivery readback | Revert deployment; keep webhook retryable |
| D1 migrations 0006/0007, backup/time-travel marker | passed for schema / deployment still unverified | Remote migration receipt: `0006_stripe_provider.sql` and `0007_webhook_retry_and_revocations.sql` applied successfully; readback confirms `offer_products`, `checkout_leads`, `funnel_runs`, `funnel_step_runs`, `webhook_events`, `payment_revocations`, and `fulfillments`; Time Travel bookmark `00000031-00000000-000050bb-d66926ee30685fcaf0f1dfdb1179dd8e` recorded | Restore bookmark; do not run ads |
| Admaxxer websites, pixel, Lead/Purchase API, Meta CAPI | unverified | owner CAPI connection + redacted event traces | Disable server ingestion/campaigns |
| Privacy/consent, terms, refund/support owner | unverified | approved copy and production URL check | Pause all campaigns |
| Meta dataset/domain/billing/permissions | unverified | Events Manager and Ads Manager readback | Keep campaigns paused |
| Monitoring, alerts, budgets, pause owners | unverified | monitoring log and named approvers | Pause affected/all campaigns |

## Current CI/runtime evidence

- All three launch branches are clean, pushed, and represented by ready-for-review PRs: standard `505761b`, App Idea `ca11b2427`, Blueprint `865f25917d`.
- Standard local function suite is green (`42/42`) and its Functions build passes.
- App Idea targeted commerce tests are green: create-root integration `8/8`, release adapter/manifest/template `36/36`, and agent-pack create `7/7`; reviewed-release ownership hashes were refreshed on `ca11b2427`, and Woodpecker re-verification is required before merge.
- Blueprint remote focused suite and typecheck are green; lint fixes are on `865f25917d`, and Woodpecker re-verification is required before merge.
- Standard production is live from `b314acf`; App Idea and Blueprint remain
  blocked by their guarded runtime/deployment gates.

## Funnel rows

| Funnel / objective | Deployment + copy | Dodo / canary | Events + entitlement | Destination / rollback | Row |
| --- | --- | --- | --- | --- | --- |
| Owned Funnel Builder / Sales → Purchase | Code `b314acf`; Pages deployment `04d99875-9bcc-4998-950d-9e0294303594`; URL HTTP 200; copy freeze still needs owner approval | $49/$19/$39/$79 mapping read back previously; 4-stage live $1 canary unverified; real-price checkout intentionally uncharged | PageView/Lead/Purchase/fulfillment: live trace unverified | Canonical/OG `shop.maestrogtm.com` verified; UTMs/`fbclid`, mobile/accessibility, rollback trace remain unverified | partial |
| Talking-Head Ad Machine / Sales → Purchase | Code `b314acf`; same Pages deployment; URL HTTP 200; checkout enabled; copy freeze still needs owner approval | $27/$9/$37 mapping read back previously; 3-stage live $1 canary unverified; real-price checkout intentionally uncharged | PageView/Lead/Purchase/fulfillment: live trace unverified | Canonical/OG `shop.maestrogtm.com` verified; UTMs/`fbclid`, mobile/accessibility, rollback trace remain unverified | partial |
| Vibe Code Anything / Sales → Purchase | Code `b314acf`; same Pages deployment; URL HTTP 200; copy freeze still needs owner approval | $29/$19/$39/$79 mapping read back previously; 4-stage live $1 canary unverified; real-price checkout intentionally uncharged | PageView/Lead/Purchase/fulfillment: live trace unverified | Canonical/OG `shop.maestrogtm.com` verified; UTMs/`fbclid`, mobile/accessibility, rollback trace remain unverified | partial |
| Authority Snapshot → $5 Game Plan / Leads → Lead | Blueprint runtime remains fail-closed (`data-enabled="false"`); production page is not launch-ready | Free lead + $5 product readback unverified; one live $1 paid-stage canary unverified; real-price checkout intentionally uncharged | PageView; durable Snapshot Lead; visitor handoff; $5 Purchase/plan artifact: unverified | Four variants, consent, recovery, and rollback: unverified | blocked |
| App Idea Evaluator → $29 Build Pack / Leads → Lead | Main `7fbbf5cff3783e9544366bf9eab61e2a8daefa60`; guarded Woodpecker staging pipeline `#118` refused by durable promotion authority; production Pages serves stale generic shell | Free report + $29 product readback unverified; one live $1 paid-stage canary unverified; real-price checkout intentionally uncharged | PageView; durable report Lead; visitor handoff; Purchase, entitlement, credit, resume: unverified | Production promotion and rollback remain unverified; do not raw-deploy around authority | blocked |

## Closure and approvals

Before activation, attach redacted URLs/IDs, commit SHAs, event traces, and
refund/revocation evidence to every row. Owner must approve final copy,
geography/audiences/budgets, Meta activation window, CAPI connection, and each
live `$1` canary/card entry. A row cannot become green because a script tag,
checkout return, or environment variable merely exists.

The consolidated owner handoff is [`owner-launch-inputs.md`](./owner-launch-inputs.md).

## Campaign readiness gate

[`meta-campaign-ledger.md`](./meta-campaign-ledger.md) is a paused,
evidence-only sub-ledger. Campaign gate: not created / paused for every funnel.
Draft copy remains in [`five-funnel-copy-deck.md`](./five-funnel-copy-deck.md)
until owner approval. `campaign_enabled` is not recorded: every funnel lacks
the exact-SHA, canary/refund, privacy/DSAR, threshold, rollback, and fresh
enablement-approval evidence required to advance.

## Live `$1` canary matrix

These are temporary non-public live products, not replacements for the approved
catalog. Every product carries trusted `launch_canary=true` metadata, is charged
only after owner approval, and is refunded immediately after the stage-specific
proof.

| Funnel | Stages requiring one live `$1` product |
| --- | --- |
| Owned Funnel Builder | `owned-funnel-builder`, `owned-funnel-conversion-copy-swipe-file`, `owned-funnel-ten-blueprints`, `owned-funnel-agency-toolkit` |
| Talking-Head Ad Machine | `talking-head-ad-machine`, `talking-head-hook-recording-pack`, `talking-head-ad-test-lab` |
| Vibe Code Anything | `vibe-code-anything`, `vibe-code-prompt-pack`, `vibe-code-five-app-blueprints`, `vibe-code-production-launch-pack` |
| Authority Snapshot → CMO Game Plan | temporary `blueprint_game_plan` canary product |
| App Idea Evaluator → Complete Build Pack | temporary Complete Build Pack canary product |

After each charge, record Dodo payment ID, webhook receipt, fulfillment or
entitlement, Admaxxer Purchase, Meta event, refund, and revocation. For a
one-click upsell, do not mark the stage green until the preceding checkout,
upsell acceptance, and resulting fulfillment are all visible in that same
live trace. Remove the canary mapping and deactivate the temporary product
before restoring the real price. The `$99/month` Blueprint Activation is never
part of this matrix.
