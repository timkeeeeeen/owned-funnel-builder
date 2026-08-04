# Standard Funnels Launch Evidence

Status: standard pages live; provider canaries and paid-traffic gates remain open

## Reviewed source

- Branch: `main`
- Production code: `b314acf` (`launch talking head funnel`; canonical/OG URLs use
  `shop.maestrogtm.com`)
- Offers: Owned Funnel Builder, Talking-Head Ad Machine, Vibe Code Anything
- Dodo production catalog: 11 real paid stages; temporary live canary catalog:
  11 separate `$1 USD` products, not yet created

## Local verification

| Check | Result | Evidence |
| --- | --- | --- |
| Funnel configuration | passed | `npm run validate:config` — 3 pages, 11 products |
| Migration preservation | passed | `tests/functions/migrations.test.mts` |
| Functions build | passed | `npm run check:functions` |
| Static build | passed | `npm run build` — 29 pages |
| Functions tests | passed | 42 tests, 0 failures |
| Focused Astro/type check | passed for changed standard files; repository check blocked | `dodo.ts` and `migrations.test.mts` fixes type-check; `npm run typecheck` still reports 17 pre-existing `packages/mcp` diagnostics because `@modelcontextprotocol/sdk` is unavailable |
| Live Dodo products/webhook | unverified | Requires Dodo live credentials and account readback |
| Dodo `$1` canary sequence | unverified | Test mode cannot validate one-click upsells; requires one temporary live `$1` product and owner-entered live card for each of the 11 paid stages, with immediate refund/revocation |
| Admaxxer live website/CAPI | unverified | Production secret name exists; local BWS lacks `ADMAXXER_API_KEY`, and live API/CAPI event readback is still required |
| Production D1 migration | passed | Cloudflare remote receipt applied `0006_stripe_provider.sql` and `0007_webhook_retry_and_revocations.sql`; schema and product mapping readback passed |
| Production deployment | passed | Cloudflare Pages deployment `04d99875-9bcc-4998-950d-9e0294303594` from `b314acf`; all three canonical routes returned HTTP 200 on 2026-08-03 |

## Read-only Cloudflare baseline

- D1 database: `owned-funnel-builder` (`f37a6e92-fcc6-43fd-898c-e8a7bf87767f`)
- Remote migration readback: `0006_stripe_provider.sql` and
  `0007_webhook_retry_and_revocations.sql` applied successfully; a subsequent
  remote readback reports no migrations remaining.
- Time Travel recovery bookmark:
  `00000031-00000000-000050bb-d66926ee30685fcaf0f1dfdb1179dd8e`
- Current Pages production deployment is `04d99875-9bcc-4998-950d-9e0294303594`
  from source `b314acf`; the three standard routes are live at
  `https://shop.maestrogtm.com/{owned-funnel-builder,talking-head-ad-machine,vibe-code-anything}/`.
- Preview readback includes historical Blueprint candidates, not the final
  accepted Blueprint SHA. A fresh Woodpecker preview is required before
  promotion.
- Cloudflare confirms the custom domain `shop.maestrogtm.com` is attached to
  the project, and fresh no-cache HTML readback confirms all three live pages
  emit `shop.maestrogtm.com` canonical and OG URLs.
- Production Pages secret names include Dodo, Admaxxer, D1, return-URL,
  webhook, public website, and support bindings. Secret values were not read or
  printed; presence by name is not mode, value, or end-to-end tracking proof.
- Aggregate remote read-only counts at baseline: `offer_products=11`,
  `webhook_events=11`, `fulfillments=16`, `funnel_runs=29`; the query reported
  zero writes.
- Webhook status baseline: `processed=9`, `failed=2`; the two historical failed
  rows remain immutable evidence and require explicit retry/recovery review
  after the new migration and deployment.

### Live route and tracking readback (2026-08-03)

- `owned-funnel-builder`, `talking-head-ad-machine`, and `vibe-code-anything`
  each returned HTTP 200 and contained the managed checkout trigger.
- `/api/admaxxer-config` returned `enabled: true` for website
  `admx_OHYmH6sbXbCbSf42sWVh659w` on `shop.maestrogtm.com`.
- An unsigned `POST` to `/api/webhooks/dodo` is rejected; no browser Purchase
  event is emitted by the landing pages.
- Invalid checkout POSTs returned HTTP 400 for all three offer slugs, and a
  representative Facebook UTM/`fbclid` URL stayed on the canonical route.
- These checks prove route availability and boundary behavior only; they do not
  replace a live Dodo payment, fulfillment, Admaxxer Purchase, or Meta CAPI
  canary.

### Host verification note (2026-08-04)

- Fresh local `validate:config`, `check:functions`, and `build` attempts were
  terminated by Node heap exhaustion while recursively scanning the shared,
  heavily loaded workspace. They emitted no source assertion or compiler error.
- The focused Functions suite remains queued behind `host-test-slot`; this is a
  host-capacity result, not evidence that the funnel contract failed.
- Earlier isolated function/build evidence remains recorded above; a clean
  remote or Woodpecker run is required before treating this host note as green.

### Production mapping readback (IDs redacted to suffix)

| Product key | Dodo ID suffix | Amount | Currency |
| --- | --- | ---: | --- |
| `owned-funnel-builder` | `vPxAFG` | $49.00 | USD |
| `owned-funnel-conversion-copy-swipe-file` | `vZOKUc` | $19.00 | USD |
| `owned-funnel-ten-blueprints` | `aoKtSq` | $39.00 | USD |
| `owned-funnel-agency-toolkit` | `zAZFCe` | $79.00 | USD |
| `talking-head-ad-machine` | `vt1Gb5` | $27.00 | USD |
| `talking-head-hook-recording-pack` | `zJ87XW` | $9.00 | USD |
| `talking-head-ad-test-lab` | `MgTBbh` | $37.00 | USD |
| `vibe-code-anything` | `yzSSBC` | $29.00 | USD |
| `vibe-code-prompt-pack` | `7y8kWo` | $19.00 | USD |
| `vibe-code-five-app-blueprints` | `kZjFhy` | $39.00 | USD |
| `vibe-code-production-launch-pack` | `OBeEWj` | $79.00 | USD |

## Code changes

- `payment.succeeded` events with `source=owned-funnel-diagnostic` are durable
  no-ops and return success.
- Active duplicate webhook claims return retryable `503`; failed claims can be
  reclaimed after the five-minute lease.
- The live webhook configuration reconciles the exact handled event set in place.
- Refund and terminal losing-dispute events record one revocation row per
  payment/provider event, and out-of-order success cannot fulfill a revoked
  payment.
- Missing live Admaxxer attribution fails the webhook retryably instead of
  acknowledging a payment without a Purchase event.
- Migration `0007` is additive and preserves existing rows.

## Required next evidence

1. Deployment of the reviewed SHA and post-deploy D1/route readback.
2. Test/live Dodo product and webhook readbacks.
3. Admaxxer website, Lead, visitor, Purchase, and Meta CAPI traces.
4. Owner-approved `$1` canary charges, immediate refunds, and revocation proof.
5. Exact production deployment SHA and rollback coordinate.
