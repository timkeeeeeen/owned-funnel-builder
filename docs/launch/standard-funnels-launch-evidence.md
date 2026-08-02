# Standard Funnels Launch Evidence

Status: implementation-ready; provider and production gates remain open

## Reviewed source

- Branch: `codex/owned-funnel-launch`
- Source commit: `ee9437b`
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
| Functions tests | passed | 36 tests, 0 failures |
| Focused Astro/type check | passed for changed standard files; repository check blocked | `dodo.ts` and `migrations.test.mts` fixes type-check; `npm run typecheck` still reports 17 pre-existing `packages/mcp` diagnostics because `@modelcontextprotocol/sdk` is unavailable |
| Live Dodo products/webhook | unverified | Requires Dodo live credentials and account readback |
| Dodo `$1` canary sequence | unverified | Requires owner approval and card entry |
| Admaxxer live website/CAPI | unverified | Shared BWS has no `ADMAXXER_API_KEY` |
| Production D1 migration | unverified | Requires Cloudflare access, backup, and remote migration |
| Production deployment | unverified | Requires approved release credentials |

## Code changes

- `payment.succeeded` events with `source=owned-funnel-diagnostic` are durable
  no-ops and return success.
- Active duplicate webhook claims return retryable `503`; failed claims can be
  reclaimed after the five-minute lease.
- Refund and dispute events record one revocation row per payment/provider event.
- Migration `0007` is additive and preserves existing rows.

## Required next evidence

1. D1 export/time-travel recovery coordinate and remote migrations 0006/0007.
2. Test/live Dodo product and webhook readbacks.
3. Admaxxer website, Lead, visitor, Purchase, and Meta CAPI traces.
4. Owner-approved `$1` canary charges, immediate refunds, and revocation proof.
5. Exact production deployment SHA and rollback coordinate.
