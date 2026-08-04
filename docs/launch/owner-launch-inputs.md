# Owner Launch Inputs

This is the final handoff for the five-funnel launch. Do not paste secrets or
card details into chat, GitHub, documents, or logs. Enter credentials in the
approved secret manager and enter the card directly into the hosted Dodo
checkout when the canary operator is present.

## Current operator readback (2026-08-04)

- The three standard destinations are live at `shop.maestrogtm.com` from
  `b314acf`; Owned Funnel Builder is the recommended first canary.
- The App Idea main SHA is `7fbbf5cff3783e9544366bf9eab61e2a8daefa60`, but
  guarded Woodpecker staging pipeline `#118` was refused by the durable
  promotion authority. Its Pages project still serves deployment
  `32bda8c4-236b-4be7-8b9b-57356e3986a6` from stale commit `ffab2d9b`. Do not
  raw-deploy around that gate.
- Blueprint is still fail-closed because its production runtime bindings are
  absent; do not send paid traffic to it.
- The secure operator store currently lacks `DODO_PAYMENTS_API_KEY`,
  `DODO_PAYMENTS_WEBHOOK_KEY`, `ADMAXXER_API_KEY`, `META_ACCESS_TOKEN`, and
  `META_DATASET_ID`. It also lacks the Blueprint public runtime bindings.

## Required secure inputs

- Dodo live API key and live webhook signing key.
- Admaxxer API key, website/domain identity, and the approved Meta CAPI
  connection (dataset/pixel ID, access token, and test-event configuration).
- Approval to set production `PUBLIC_SITE_URL` to
  `https://shop.maestrogtm.com` and to apply D1 migrations `0006` and `0007`.
- Final copy/price/guarantee approval for all five funnel families.
- Meta ad account, Page identity, timezone/currency, verified domain, billing,
  geography, audiences, budgets, placements, creative revisions, and launch
  window.
- Approval for thirteen temporary live `$1` products and the immediate
  refund/revocation procedure.

## Operator sequence after inputs arrive

1. Read back live Dodo products, exact prices/currencies, webhook event set,
   return URL, and refund authority.
2. Apply migrations, deploy the reviewed SHAs, and verify canonical/OG URLs.
3. Create the 13 non-public canary products with trusted
   `launch_canary=true` metadata.
4. Run each paid stage with the owner-entered live card. Test mode is not
   sufficient for one-click upsells.
5. Capture payment, webhook, fulfillment/entitlement, Admaxxer Purchase,
   Meta CAPI, refund, and revocation evidence for every stage.
6. Deactivate canary products, restore real product mappings, and keep the
   first real-price campaigns paused.
7. Create five paused Meta campaigns, perform the final ledger sign-off, then
   activate only in the approved window.

## Canary count

| Funnel | Live `$1` stages |
| --- | ---: |
| Owned Funnel Builder | 4 |
| Talking-Head Ad Machine | 3 |
| Vibe Code Anything | 4 |
| Blueprint CMO Game Plan | 1 |
| App Idea Complete Build Pack | 1 |
| **Total** | **13** |
