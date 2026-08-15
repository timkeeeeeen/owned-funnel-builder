# First-Party Event Pipeline Spec Review

Date: 2026-08-04  
Reviewers: architecture/privacy, delivery/operations, and independent
privacy/security passes

## Verdict

The design direction is sound, but the original spec/plan was not ready to
implement safely. The main issue was not the choice of Cloudflare Worker, D1,
Queue, and Tinybird; it was missing ownership and recovery contracts at the
boundaries.

## Findings resolved in the spec and plan

| Finding | Resolution |
| --- | --- |
| Source outbox could strand after a business-D1 commit because the Worker cannot read business D1 | Each Pages/Convex source owns a lease/ack/retry dispatcher and reconciliation; the Worker scans only tracking D1. |
| Source payloads and canonical JSON had no enforceable sensitive-data expiry | Added source `expires_at`/lease/redaction, seven-day cleanup, canonical redaction, and cleanup watermark evidence. |
| One shared bridge key could authorize another source | Added per-source/environment issuer keys and manifest-bound tenant/site/funnel/product checks. |
| Pages claim path contradicted the no-tracking-D1 binding rule | Reduced to one Pages proxy → signed Worker claim path. |
| Cookie signing and external-ID rotation were underspecified | Added Worker-only signing, verify-only Pages material, environment/name binding, and persisted opaque external IDs. |
| CSRF, webhook replay, context-token lifecycle, and operator controls were named but not executable | Added CSRF nonce, webhook freshness/delivery-ID ledger, operation-specific tokens, and authenticated/audited operator operations. |
| Tinybird deletion and schema promotion were incomplete | Added versioned subject keys, datasource/pipe promotion/readback, dedup fixtures, and source deletion acknowledgements. |
| Launch “green” was subjective | Added exact-SHA, sample/window, latency, duplicate-rate, field-presence, privacy, canary, and rollback fields to each funnel gate. |
| CI/deployment/browser coverage was incomplete | Removed duplicate Worker test, made Woodpecker authority conditional, added protected migration/readback jobs, environment-isolation checks, Playwright preview coverage, and probe/alert evidence. |

## Deliberate scope decisions

- “All possible data” means all reviewed, purpose-permitted allowlist fields; it
  does not include arbitrary DOM, keystrokes, credentials, or fingerprinting.
- Anonymous visitors remain in the tracking ledger, not the CRM, until a
  concrete consented CRM contract exists.
- A 400-day browser cookie is the practical continuity limit; durable
  continuity comes from a verified person identity, not a claimed 30-year
  cookie.

## Additional hardening changes

- Added executable consent-banner, GPC, CSRF/fetch-metadata, cache/log
  redaction, and cost controls.
- Removed the Blueprint GET/token contradiction and made the Pages claim path
  Worker-only; source outboxes persist only opaque context references.
- Isolated bridge keys per source/runtime and added exact-SHA, migration,
  preview-resource, and crash-safe canary gates.
- Added field-level retention across source authorities, queues, logs, provider
  copies, Tinybird, and source-runtime erasure receipts.
- Made the tracking domain/cookie relationship an explicit gate for App-Idea and
  Blueprint and marked stale Admaxxer instructions superseded.

## Remaining launch blockers

The implementation must still prove the exact App-Idea/Blueprint authorities,
DNS/sibling trust inventory, source-runtime SHAs, protected migration/readback,
and the live `$1` validation evidence. No provider, DNS, ad, or live-payment
mutation is authorized by this review.
