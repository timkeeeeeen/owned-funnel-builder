# Meta Activation and First-Day Monitoring

Revision: 2026-08-02-r1  
Status: run only after the six-row ledger is green and the owner approves five
campaign IDs, budgets, geography, and a launch window.

## Release record

- Approval owner / timestamp: TBD
- Campaign IDs (redacted): TBD
- Activation window (UTC): TBD
- Deployment SHAs and rollback coordinates: TBD
- Dodo, Admaxxer, Meta CAPI, and support owners: TBD

Activate only the five reviewed campaigns in one window. Unrelated drafts stay
paused. Record the resulting state and timestamp for each campaign.

## Checkpoints

| Check | Delivery/spend | PageView / Lead | Checkout / Dodo | Purchase / fulfillment | Admaxxer + CAPI | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Activation | TBD | TBD | TBD | TBD | TBD | no activation if any preflight fails |
| +15 min | TBD | TBD | TBD | TBD | TBD | pause localized failure |
| +30 min | TBD | TBD | TBD | TBD | TBD | pause localized failure |
| +60 min | TBD | TBD | TBD | TBD | TBD | pause shared failure across all five |
| +4 h | TBD | TBD | TBD | TBD | TBD | reconcile latency and spend |
| +24 h | TBD | TBD | TBD | TBD | TBD | first-day sign-off or rollback |

At each checkpoint reconcile by funnel: Meta clicks and spend, landing views,
durable Leads, checkout starts, Dodo payments/refunds, fulfillment or
entitlements, Admaxxer visitor/Lead/Purchase, Meta CAPI receipt/deduplication,
support incidents, and response errors. Normal provider latency is recorded,
not papered over.

## Immediate pause rules

Pause the affected campaign for a wrong URL, copy or price mismatch, checkout
failure, webhook/fulfillment failure, missing or duplicate event, wrong dataset,
privacy/consent failure, unexpected charge, support incident, or excess spend.
Pause all five for a shared Dodo, Admaxxer, CAPI, domain, or deployment fault.
Do not relaunch an identical configuration after a provider 402/429; record the
environmental blocker and wait for capacity or credentials.

The first real-price purchase is a canary: verify payment ID, product/value,
currency, webhook, fulfillment/entitlement, email, Admaxxer, Meta dedupe,
support, and refund readiness before continuing delivery. Temporary `$1`
canaries are excluded from performance reporting but retained as audit evidence.

## Incident record

| Time / funnel | Symptom and evidence | Action / owner | Recovery proof |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |
