# Paused Meta Campaign Ledger

Status: evidence-only sub-ledger. The canonical activation authority is
[`five-funnel-launch-ledger.md`](./five-funnel-launch-ledger.md); this file
cannot create, enable, or change rollout state.

All rows are `not created / paused`. Owner approval is absent, so IDs, budget,
audience, geography, schedule, attribution, and spend cap are unverified.

| Funnel | Objective/event | Destination | UTM campaign | Campaign/ad set/ad IDs | State |
| --- | --- | --- | --- | --- | --- |
| Owned Funnel Builder | Sales / Purchase | `https://shop.maestrogtm.com/owned-funnel-builder/` | `owned-funnel-builder` | — | not created / paused |
| Talking-Head Ad Machine | Sales / Purchase | `https://shop.maestrogtm.com/talking-head-ad-machine/` | `talking-head-ad-machine` | — | not created / paused |
| Vibe Code Anything | Sales / Purchase | `https://shop.maestrogtm.com/vibe-code-anything/` | `vibe-code-anything` | — | not created / paused |
| Authority Snapshot | Leads / Lead | runtime URL unverified | `authority-snapshot` | — | not created / paused |
| App Idea Evaluator | Leads / Lead | runtime URL unverified | `app-idea-evaluator` | — | not created / paused |

Exact UTM query string (replace only `<slug>`):

```text
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign=<slug>&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```

Meta may append `fbclid`; it is neither added nor stripped. App-Idea and
Blueprint remain shadow/unverified. A fresh, target-specific campaign creation
approval is required before a paused object can exist; enablement needs a
separate approval and a green canonical ledger gate.
