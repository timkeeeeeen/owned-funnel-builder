# Five-Funnel Launch Ledger

Revision: 2026-08-02-r1  
Rule: blank evidence is **unverified**, never green. `intentionally uncharged`
is permitted only for a final real-price Purchase after live configuration and
the separate $1 canary are proven.

## Shared infrastructure

| Gate | Status | Evidence / owner | Rollback |
| --- | --- | --- | --- |
| Dodo live account, mode, products, prices, attachments | unverified | Dodo readback; owner/provider | Disable checkout routes; restore prior catalog mapping |
| Dodo webhook URL, signature secret, retry/idempotency | passed locally / unverified live | `npm run test:functions`; production delivery readback | Revert deployment; keep webhook retryable |
| D1 migrations 0006/0007, backup/time-travel marker | unverified | Remote readback shows both pending; Time Travel bookmark `00000031-00000000-000050bb-d66926ee30685fcaf0f1dfdb1179dd8e` recorded; migration receipt still required | Restore bookmark; do not run ads |
| Admaxxer websites, pixel, Lead/Purchase API, Meta CAPI | unverified | owner CAPI connection + redacted event traces | Disable server ingestion/campaigns |
| Privacy/consent, terms, refund/support owner | unverified | approved copy and production URL check | Pause all campaigns |
| Meta dataset/domain/billing/permissions | unverified | Events Manager and Ads Manager readback | Keep campaigns paused |
| Monitoring, alerts, budgets, pause owners | unverified | monitoring log and named approvers | Pause affected/all campaigns |

## Funnel rows

| Funnel / objective | Deployment + copy | Dodo / canary | Events + entitlement | Destination / rollback | Row |
| --- | --- | --- | --- | --- | --- |
| Owned Funnel Builder / Sales → Purchase | Code `27c71df`; URL/deploy unverified; deck r1 pending | $49/$19/upsells readback unverified; 4-stage live $1 canary unverified; real-price checkout intentionally uncharged | PageView, checkout Lead, visitor metadata, Purchase, fulfillment: unverified | URL/UTMs/`fbclid` and mobile/accessibility: unverified; rollback owner: standard release owner | unverified |
| Talking-Head Ad Machine / Sales → Purchase | Code `27c71df`; URL/deploy unverified; deck r1 pending; publish/checkout flag readback required | $27/$9/$37 readback unverified; 3-stage live $1 canary unverified; real-price checkout intentionally uncharged | Same event chain + supported-platform delivery: unverified | Exact slug and paused campaign destination: unverified; rollback owner: standard release owner | unverified |
| Vibe Code Anything / Sales → Purchase | Code `27c71df`; URL/deploy unverified; deck r1 pending | $29/$19/$39/$79 readback unverified; 4-stage live $1 canary unverified; real-price checkout intentionally uncharged | Same event chain + exact template entitlement: unverified | Exact slug and paused campaign destination: unverified; rollback owner: standard release owner | unverified |
| Authority Snapshot → $5 Game Plan / Leads → Lead | Maestro code `8741af7a23`; runtime URL/deploy unverified; Blueprint copy/proof approval pending | Free lead + $5 product readback unverified; one live $1 paid-stage canary unverified; real-price checkout intentionally uncharged | PageView; durable Snapshot Lead; visitor handoff; $5 Purchase/plan artifact: unverified | Four variants, consent, and recovery: unverified; rollback owner: Blueprint release owner | unverified |
| App Idea Evaluator → $29 Build Pack / Leads → Lead | App Idea code `60307f669`; URL/deploy unverified; canonical copy approval pending | Free report + $29 product readback unverified; one live $1 paid-stage canary unverified; real-price checkout intentionally uncharged | PageView; durable report Lead; visitor handoff; Purchase, entitlement, credit, resume: unverified | Low-fit suppression and exact destination: unverified; rollback owner: App Idea release owner | unverified |

## Closure and approvals

Before activation, attach redacted URLs/IDs, commit SHAs, event traces, and
refund/revocation evidence to every row. Owner must approve final copy,
geography/audiences/budgets, Meta activation window, CAPI connection, and each
live `$1` canary/card entry. A row cannot become green because a script tag,
checkout return, or environment variable merely exists.

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
entitlement, Admaxxer Purchase, Meta event, refund, and revocation. Remove the
canary mapping and deactivate the temporary product before restoring the real
price. The `$99/month` Blueprint Activation is never part of this matrix.
