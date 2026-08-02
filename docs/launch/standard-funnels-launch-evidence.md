# Standard Funnels Launch Evidence

Status: implementation-ready; provider and production gates remain open

## Reviewed source

- Branch: `codex/owned-funnel-launch`
- Code commit: `27c71df`; privacy/evidence follow-up: `543e0ee`
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
| Functions tests | passed | 40 tests, 0 failures |
| Focused Astro/type check | passed for changed standard files; repository check blocked | `dodo.ts` and `migrations.test.mts` fixes type-check; `npm run typecheck` still reports 17 pre-existing `packages/mcp` diagnostics because `@modelcontextprotocol/sdk` is unavailable |
| Live Dodo products/webhook | unverified | Requires Dodo live credentials and account readback |
| Dodo `$1` canary sequence | unverified | Requires owner approval and card entry |
| Admaxxer live website/CAPI | unverified | Shared BWS has no `ADMAXXER_API_KEY` |
| Production D1 migration | unverified | Requires Cloudflare access, backup, and remote migration |
| Production deployment | unverified | Requires approved release credentials |

## Read-only Cloudflare baseline

- D1 database: `owned-funnel-builder` (`f37a6e92-fcc6-43fd-898c-e8a7bf87767f`)
- Remote migration readback: `0006_stripe_provider.sql` and
  `0007_webhook_retry_and_revocations.sql` are pending; no migration was
  applied by this execution.
- Time Travel recovery bookmark:
  `00000031-00000000-000050bb-d66926ee30685fcaf0f1dfdb1179dd8e`
- Current Pages production readback includes older `main` deployments (latest
  observed source `25bbc4a`); the launch branches have not been promoted.
- Preview readback includes historical Blueprint candidates, not the final
  accepted Blueprint SHA. A fresh Woodpecker preview is required before
  promotion.
- Aggregate remote read-only counts at baseline: `offer_products=11`,
  `webhook_events=11`, `fulfillments=16`, `funnel_runs=29`; the query reported
  zero writes.

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

1. D1 export/time-travel recovery coordinate and remote migrations 0006/0007.
2. Test/live Dodo product and webhook readbacks.
3. Admaxxer website, Lead, visitor, Purchase, and Meta CAPI traces.
4. Owner-approved `$1` canary charges, immediate refunds, and revocation proof.
5. Exact production deployment SHA and rollback coordinate.
