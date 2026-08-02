# Meta Campaign Build Evidence

Revision: 2026-08-02-r1  
Status: not built — owner must provide Meta account, identity, dataset/CAPI,
geography, audiences, budgets, and activation window.

All campaign, ad-set, and ad objects are created **paused**. This file records
redacted IDs only; never paste tokens, card data, or raw event payloads.

## Authority preflight

| Check | Result | Evidence |
| --- | --- | --- |
| Ad account, page identity, timezone/currency, billing, spend limit | unverified | Ads Manager readback / redacted suffix |
| Dataset/pixel and verified domains | unverified | Events Manager readback |
| Admaxxer Meta CAPI destination and permissions | unverified | Admaxxer settings + test event trace |
| Privacy/consent and destination ownership | unverified | production URL check |

## Campaign inventory (paused baseline)

| Funnel | Objective/event | Destination | UTM campaign | Campaign/ad set/ad IDs | State/review |
| --- | --- | --- | --- | --- | --- |
| Owned Funnel Builder | Sales / Purchase | `https://shop.maestrogtm.com/owned-funnel-builder/` | `owned-funnel-builder` | TBD | not created / paused |
| Talking-Head Ad Machine | Sales / Purchase | `https://shop.maestrogtm.com/talking-head-ad-machine/` | `talking-head-ad-machine` | TBD | not created / paused |
| Vibe Code Anything | Sales / Purchase | `https://shop.maestrogtm.com/vibe-code-anything/` | `vibe-code-anything` | TBD | not created / paused |
| Authority Snapshot | Leads / Lead | approved Maestro runtime URL | `authority-snapshot` | TBD | not created / paused |
| App Idea Evaluator | Leads / Lead | approved App Idea production URL | `app-idea-evaluator` | TBD | not created / paused |

Every destination uses this exact query string (replace only the campaign
slug):

```text
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign=<slug>&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```

Meta appends `fbclid`; do not add or strip it. Use one approved ad per funnel
for the baseline. Record budget, audience, placements, creative revision,
destination HTTP/canonical/robots checks, and redacted object IDs after each
paused build. No campaign is active until the ledger has six green rows and the
owner approves the exact IDs, budgets, and launch window.

## Destination/event trace

For each row, attach one browser-to-server trace from the exact ad URL:

1. PageView arrives once and the page preserves UTMs and `fbclid`.
2. Lead fires only after the durable boundary (checkout session, Snapshot, or
   report); no Lead occurs on load, typing, invalid input, or provider failure.
3. The live `$1` canary payment ID is present in Dodo metadata and produces one
   verified server Purchase in Admaxxer/Meta with matching value/currency.
4. Fulfillment/entitlement succeeds and refund/revocation evidence is linked.
5. Ads remain approved and paused after the trace.

Current trace status: all five unverified (provider credentials and deployments
are intentionally not available in this worktree).
